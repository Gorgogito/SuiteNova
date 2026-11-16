import { describe, expect, it } from 'vitest';
import { COLORS, DATA, DRAWING, LAYOUT, LAYOUT_PROCESS, STYLE } from './fixtures';
import { dataModelToTree, parseSmartArt, updateSmartArt, writeDataModel, writeSmartArt, addChild, allNodes, approxMetrics, buildGraph, indexStyles, layout, outlineToTree, parseColorsDef, parseDrawing, parseLayoutDef, parseStyleDef, present, render, select, serializeXml, styleLabelOf, writeDrawing, type DrawnShape, type SmartTree } from './index';
import { counterIds } from './model';

const empty: SmartTree = { docId: '{D}', docPr: {}, roots: [] };
const treeOf = (outline: string): SmartTree => outlineToTree(outline, empty, counterIds('t'));
const pt = (v: number) => v / 12700;
const near = (a: number, b: number, tol: number, msg: string) => expect(Math.abs(a - b), `${msg}: ${a} vs ${b}`).toBeLessThanOrEqual(tol);
const frame = { width: 640, height: 380 };

describe('ejes y selectores de datos', () => {
  const g = buildGraph(treeOf('A\n\tA1\n\tA2\nB\nC'));
  const [a, b, c] = g.doc.children;
  const sel = (axis: string, type: string, extra: Record<string, number[] | boolean[]> = {}) =>
    ({ axis: [axis], ptType: [type], hideLastTrans: [true], st: [0], cnt: [0], step: [1], ...extra }) as Parameters<typeof select>[1];

  it('ch con todos los tipos da, por hijo: su transición de padre, él y su transición de hermano', () => {
    const kinds = (hide: boolean) => select(g.doc, sel('ch', 'all', { hideLastTrans: [hide] })).map((d) => d.kind);
    expect(kinds(false)).toEqual(['parTrans', 'node', 'sibTrans', 'parTrans', 'node', 'sibTrans', 'parTrans', 'node', 'sibTrans']);
    // por omisión se oculta la transición de hermano del último
    expect(kinds(true)).toEqual(['parTrans', 'node', 'sibTrans', 'parTrans', 'node', 'sibTrans', 'parTrans', 'node']);
    expect(select(g.doc, sel('ch', 'node')).map((d) => d.node!.text)).toEqual(['A', 'B', 'C']);
  });

  it('followSib de transiciones empieza por la del propio nodo y oculta la del último', () => {
    expect(select(a!, sel('followSib', 'sibTrans')).map((d) => d.owner!.node!.text)).toEqual(['A', 'B']);
    expect(select(b!, sel('followSib', 'sibTrans', { cnt: [1] })).map((d) => d.owner!.node!.text)).toEqual(['B']);
    expect(select(c!, sel('followSib', 'sibTrans')).length).toBe(0);
    expect(select(c!, sel('followSib', 'sibTrans', { hideLastTrans: [false] })).length).toBe(1);
  });

  it('inicio (desde 1), número y paso; listas de pasos', () => {
    expect(select(g.doc, sel('ch', 'node', { st: [2], cnt: [1] })).map((d) => d.node!.text)).toEqual(['B']);
    expect(select(g.doc, sel('ch', 'node', { step: [2] })).map((d) => d.node!.text)).toEqual(['A', 'C']);
    const two = { axis: ['ch', 'ch'], ptType: ['node', 'node'], hideLastTrans: [true], st: [1, 1], cnt: [1, 0], step: [1] } as Parameters<typeof select>[1];
    expect(select(g.doc, two).map((d) => d.node!.text)).toEqual(['A1', 'A2']);
    expect(select(a!, sel('desOrSelf', 'node')).map((d) => d.node!.text)).toEqual(['A', 'A1', 'A2']);
    expect(select(a!.children[0]!, sel('par', 'node')).map((d) => d.node!.text)).toEqual(['A']);
  });
});

describe('árbol de presentación', () => {
  it('un forEach repite el nodo por cada dato y las transiciones salen entre ellos (no tras el último)', () => {
    const root = present(parseLayoutDef(LAYOUT), treeOf('Uno\nDos\nTres'));
    expect(root.children.map((c) => c.name)).toEqual(['node', 'sibTrans', 'node', 'sibTrans', 'node']);
    expect(root.alg?.type).toBe('snake');
    expect(root.children[0]!.present.map((d) => d.node!.text)).toEqual(['Uno']);
  });

  it('choose resuelve por la variable dir (norm por omisión) y por el recuento de nodos', () => {
    const def = parseLayoutDef(LAYOUT_PROCESS);
    expect(present(def, treeOf('A\nB')).alg?.params).toEqual([]);
    const rtl = present(def, treeOf('A\nB'), { dir: 'rev' });
    expect(rtl.alg?.params.find((p) => p.type === 'linDir')?.val).toBe('fromR');
  });
});

describe('colocación: cifras medidas con PowerPoint en un dibujo de 640 x 380 pt', () => {
  it('lista de bloques (snake): 5 nodos van 3 + 2, centrados, de 200 x 120 con 20 de separación', () => {
    const s = render(parseLayoutDef(LAYOUT), treeOf('Uno\nDos\nTres\nCuatro\nCinco'), frame);
    const want = [[0, 60], [220, 60], [440, 60], [110, 200], [330, 200]];
    expect(s).toHaveLength(5);
    s.forEach((sh, i) => {
      near(pt(sh.x), want[i]![0]!, 0.5, `x${i}`);
      near(pt(sh.y), want[i]![1]!, 0.5, `y${i}`);
      near(pt(sh.w), 200, 0.5, 'ancho');
      near(pt(sh.h), 120, 0.5, 'alto');
      expect(sh.prst).toBe('rect');
    });
  });

  it('3 nodos no van en una fila (saldrían de 200 pt): se eligen 2 + 1 de 292 x 175, como hace Office', () => {
    const s = render(parseLayoutDef(LAYOUT), treeOf('A\nB\nC'), frame);
    expect(s.map((x) => Math.round(pt(x.x)))).toEqual([13, 335, 174]);
    near(pt(s[0]!.w), 292.3, 0.5, 'ancho');
    near(pt(s[0]!.h), 175.4, 0.5, 'alto');
  });

  it('una fila de 2 nodos: caben en una fila y se centran en vertical', () => {
    const s = render(parseLayoutDef(LAYOUT), treeOf('A\nB'), frame);
    expect(s.map((x) => Math.round(pt(x.y)))).toEqual([s[0]!.y, s[0]!.y].map((v) => Math.round(pt(v))));
    near(pt(s[0]!.y) + pt(s[0]!.h) / 2, 190, 0.5, 'centro vertical');
  });

  it('proceso (lin + conn): 3 nodos de 168 x 101 con flechas de 36 x 42 en los huecos', () => {
    const s = render(parseLayoutDef(LAYOUT_PROCESS), treeOf('Uno\nDos\nTres'), frame);
    expect(s.map((x) => x.prst)).toEqual(['roundRect', 'rightArrow', 'roundRect', 'rightArrow', 'roundRect']);
    near(pt(s[0]!.x), 0.6, 0.8, 'x1');
    near(pt(s[0]!.w), 168.1, 0.6, 'ancho');
    near(pt(s[0]!.h), 100.9, 0.6, 'alto');
    near(pt(s[1]!.x), 185.5, 0.6, 'flecha x');
    near(pt(s[1]!.w), 35.6, 0.6, 'flecha ancho');
    near(pt(s[1]!.h), 41.7, 0.6, 'flecha alto');
    // el conjunto va centrado y las flechas entre cada par de nodos
    near(pt(s[4]!.x) + pt(s[4]!.w), 640, 1, 'borde derecho');
    expect(s[0]!.adj).toEqual({ adj: 10000 });
  });

  it('el mismo proceso con dos nodos no se reduce: caben a su tamaño máximo', () => {
    const s = render(parseLayoutDef(LAYOUT_PROCESS), treeOf('A\nB'), frame);
    // dos nodos y una flecha: 2w + 0.4w = 640 → w = 266.7
    near(pt(s[0]!.w), 266.7, 0.6, 'ancho');
  });

  it('dir inverso coloca los nodos de derecha a izquierda', () => {
    const def = parseLayoutDef(LAYOUT_PROCESS);
    const tree = treeOf('Uno\nDos\nTres');
    const rtl = render(def, tree, { ...frame, vars: { dir: 'rev' } });
    const ltr = render(def, tree, frame);
    expect(pt(rtl[0]!.x)).toBeGreaterThan(pt(ltr[0]!.x) + 300);
    // el texto «Uno» está en la forma de la derecha
    const text = (s: DrawnShape) => JSON.stringify(s.txBody);
    expect(text(rtl[0]!)).toContain('Uno');
  });
});

describe('texto', () => {
  it('cada nodo lleva su texto, con el mismo tamaño de letra en todos (op equ) y a lo sumo el máximo', () => {
    const s = render(parseLayoutDef(LAYOUT), treeOf('Uno\nCuatro\nTres'), frame);
    const sizes = s.map((x) => Number(/sz":"(\d+)"/.exec(JSON.stringify(x.txBody))![1]) / 100);
    expect(new Set(sizes).size).toBe(1);
    expect(sizes[0]).toBeLessThanOrEqual(65);
    expect(sizes[0]).toBeGreaterThanOrEqual(40);
    expect(JSON.stringify(s[1]!.txBody)).toContain('Cuatro');
  });

  it('un texto largo reduce la letra; uno muy largo llega al mínimo de la regla', () => {
    const short = render(parseLayoutDef(LAYOUT), treeOf('Hola\nMundo'), frame);
    const long = render(parseLayoutDef(LAYOUT), treeOf('Hola\nUn texto bastante largo que no cabe en un solo renglón de este bloque'), frame);
    const sz = (s: DrawnShape) => Number(/sz":"(\d+)"/.exec(JSON.stringify(s.txBody))![1]) / 100;
    expect(sz(long[0]!)).toBeLessThan(sz(short[0]!));
    expect(sz(long[0]!)).toBeGreaterThanOrEqual(5);
  });

  it('los subniveles del nodo salen como párrafos con viñeta dentro de su forma', () => {
    const s = render(parseLayoutDef(LAYOUT_PROCESS), treeOf('Uno\n\tdetalle\nDos'), frame);
    const body = JSON.stringify(s[0]!.txBody);
    expect(body).toContain('Uno');
    expect(body).toContain('detalle');
    expect(body).toContain('buChar');
  });

  it('un nodo vacío se dibuja sin texto (se mide con el marcador)', () => {
    const tree = treeOf('Uno\nDos');
    tree.roots[1]!.text = '';
    const s = render(parseLayoutDef(LAYOUT), tree, frame);
    expect(JSON.stringify(s[1]!.txBody)).not.toContain('<a:t>');
    expect(s).toHaveLength(2);
  });

  it('las medidas son sustituibles (letra más ancha, letra más pequeña)', () => {
    const wide = { width: (t: string, size: number) => approxMetrics.width(t, size) * 2 };
    const a = render(parseLayoutDef(LAYOUT), treeOf('Cuatro\nCinco'), frame);
    const b = layout(parseLayoutDef(LAYOUT), treeOf('Cuatro\nCinco'), { ...frame, metrics: wide });
    void b;
    const c = render(parseLayoutDef(LAYOUT), treeOf('Cuatro\nCinco'), { ...frame, metrics: wide });
    const sz = (s: DrawnShape) => Number(/sz":"(\d+)"/.exec(JSON.stringify(s.txBody))![1]) / 100;
    expect(sz(c[0]!)).toBeLessThan(sz(a[0]!));
  });
});

describe('robustez', () => {
  it('sin nodos no hay formas y un algoritmo desconocido no rompe nada', () => {
    expect(render(parseLayoutDef(LAYOUT), empty, frame)).toEqual([]);
    const odd = LAYOUT.replace('type="snake"', 'type="algoritmoRaro"');
    expect(() => render(parseLayoutDef(odd), treeOf('A\nB'), frame)).not.toThrow();
  });

  it('el resultado se escribe como dsp:drawing y vuelve igual', () => {
    const s = render(parseLayoutDef(LAYOUT_PROCESS), treeOf('Uno\nDos'), frame);
    expect(parseDrawing(writeDrawing(s))).toEqual(s);
  });

  it('un dibujo más pequeño reduce los nodos', () => {
    const big = render(parseLayoutDef(LAYOUT), treeOf('A\nB\nC'), frame);
    const small = render(parseLayoutDef(LAYOUT), treeOf('A\nB\nC'), { width: 320, height: 190 });
    near(pt(small[0]!.w), pt(big[0]!.w) / 2, 0.5, 'la mitad');
  });
});

describe('estilos y colores (fase 3)', () => {
  const style = parseStyleDef(STYLE);
  const colors = parseColorsDef(COLORS);
  const xml = (s: DrawnShape) => s.spPr.map(serializeXml).join('');
  const OFFS = '<a:hueOff val="0"/><a:satOff val="0"/><a:lumOff val="0"/><a:alphaOff val="0"/>';

  it('una forma de nodo lleva el relleno y la línea de su etiqueta, con los desplazamientos a cero y el estilo rápido', () => {
    const s = render(parseLayoutDef(LAYOUT), treeOf('A\nB'), { ...frame, style, colors });
    expect(xml(s[0]!)).toBe(
      `<a:solidFill><a:schemeClr val="accent1">${OFFS}</a:schemeClr></a:solidFill><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="lt1">${OFFS}</a:schemeClr></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:effectLst/>`,
    );
    expect(s[0]!.style!.name).toBe('dsp:style');
    expect(serializeXml(s[0]!.style!)).toContain('<a:lnRef idx="2">');
  });

  it('una flecha de proceso es sibTrans2D1: relleno aclarado, sin línea, y el color se reparte entre las flechas (span)', () => {
    const s = render(parseLayoutDef(LAYOUT_PROCESS), treeOf('A\nB\nC'), { ...frame, style, colors });
    const arrows = s.filter((x) => x.prst === 'rightArrow');
    expect(arrows).toHaveLength(2);
    expect(xml(arrows[0]!)).toBe(`<a:solidFill><a:schemeClr val="accent1"><a:tint val="60000"/>${OFFS}</a:schemeClr></a:solidFill><a:ln><a:noFill/></a:ln><a:effectLst/>`);
    // la segunda flecha toma el otro extremo de la lista
    expect(xml(arrows[1]!)).toBe(`<a:solidFill><a:schemeClr val="accent1">${OFFS}</a:schemeClr></a:solidFill><a:ln><a:noFill/></a:ln><a:effectLst/>`);
  });

  it('sin estilo y colores las formas salen sin aspecto, y con una etiqueta que no existe también', () => {
    const plain = render(parseLayoutDef(LAYOUT), treeOf('A'), frame);
    expect(plain[0]!.spPr).toEqual([]);
    const missing = render(parseLayoutDef(LAYOUT), treeOf('A'), { ...frame, style: { ...style, styleLbls: [] }, colors });
    expect(missing[0]!.spPr).toEqual([]);
  });

  it('etiquetas automáticas: node + nivel, y sibTrans2D / parChTrans1D + nivel para los conectores', () => {
    const root = present(parseLayoutDef(LAYOUT_PROCESS), treeOf('A\n\tA1\nB'));
    const nodes = allNodes(root);
    expect(nodes.filter((n) => n.name === 'node').map(styleLabelOf)).toEqual(['node1', 'node1']);
    expect(nodes.filter((n) => n.name === 'arrow').map(styleLabelOf)).toEqual(['sibTrans2D1']);
    // el diseño puede fijar la etiqueta
    const fixed = parseLayoutDef(LAYOUT_PROCESS.replace('<dgm:layoutNode name="node">', '<dgm:layoutNode name="node" styleLbl="fgShp">'));
    expect(allNodes(present(fixed, treeOf('A'))).filter((n) => n.name === 'node').map(styleLabelOf)).toEqual(['fgShp']);
  });

  it('presStyleIdx/presStyleCnt: posición entre las formas con la misma etiqueta, contando una vez lo que presentan juntas', () => {
    const nodes = allNodes(present(parseLayoutDef(LAYOUT_PROCESS), treeOf('A\nB\nC')));
    const idx = indexStyles(nodes);
    const of = (name: string) => nodes.filter((n) => n.name === name).map((n) => `${idx.get(n)!.idx}/${idx.get(n)!.cnt}`);
    expect(of('node')).toEqual(['0/3', '1/3', '2/3']);
    expect(of('arrow')).toEqual(['0/2', '1/2']);
  });
});

describe('actualizar un SmartArt tras editarlo', () => {
  it('el árbol editado rehace los datos y el dibujo; escribir y leer da lo mismo y el dibujo ya no depende del anterior', () => {
    const sa = parseSmartArt({ data: DATA, layout: LAYOUT, style: STYLE, colors: COLORS, drawing: DRAWING });
    const tree = dataModelToTree(sa.data);
    const bigger = addChild(tree, '{N1}', 'nuevo', counterIds('n')).tree;
    const up = updateSmartArt(sa, bigger, frame, counterIds('m'));
    expect(up.drawing!).toHaveLength(2); // los ayudantes no son nodos de este diseño
    expect(JSON.stringify(up.drawing![0]!.txBody)).toContain('nuevo'); // el hijo sale como viñeta del nodo
    expect(JSON.stringify(up.data.pts)).toContain('nuevo');
    expect(up.data.extLst).toBeUndefined(); // el dibujo anterior ya no vale
    const again = parseSmartArt(writeSmartArt(up));
    expect(again.drawing).toEqual(up.drawing);
    expect(writeDataModel(again.data)).toBe(writeDataModel(up.data)); // iguales una vez escritas (al leer aparecen los dgm:spPr vacíos)
  });
});
