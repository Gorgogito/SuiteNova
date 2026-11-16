import { describe, expect, it } from 'vitest';
import { LAYOUT, LAYOUT_PROCESS } from './fixtures';
import { approxMetrics, buildGraph, layout, outlineToTree, parseDrawing, parseLayoutDef, present, render, select, writeDrawing, type DrawnShape, type SmartTree } from './index';
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
