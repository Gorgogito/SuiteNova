import { describe, expect, it } from 'vitest';
import {
  addChild,
  addRoot,
  addSibling,
  colorLabel,
  counterIds,
  dataModelToTree,
  demote,
  drawingRelId,
  findNode,
  flatten,
  layoutNodes,
  moveNode,
  outlineToTree,
  parseColorsDef,
  parseDataModel,
  parseDrawing,
  parseLayoutDef,
  parseSmartArt,
  parseStyleDef,
  parseXml,
  promote,
  removeNode,
  serializeXml,
  setDrawingRelId,
  setText,
  styleLabel,
  treeToDataModel,
  treeToOutline,
  writeDataModel,
  writeDrawing,
  writeSmartArt,
  type SmartTree,
} from './index';
import { COLORS, DATA, DRAWING, LAYOUT, STYLE } from './fixtures';

const lines = (t: SmartTree) => flatten(t).map((n) => `${'-'.repeat(n.level)}${n.text.replace(/\n/g, '|')}`);

describe('XML ordenado', () => {
  it('conserva el orden, los atributos, los espacios de un a:t y los caracteres especiales', () => {
    const e = parseXml('<a:p xmlns:a="x"><a:r><a:t> a &amp; b </a:t></a:r>\n  <a:br/><a:r><a:t>z</a:t></a:r></a:p>');
    expect(e.kids.map((k) => k.name)).toEqual(['a:r', 'a:br', 'a:r']);
    expect(serializeXml(e)).toBe('<a:p xmlns:a="x"><a:r><a:t> a &amp; b </a:t></a:r><a:br/><a:r><a:t>z</a:t></a:r></a:p>');
    expect(serializeXml(parseXml(serializeXml(e)))).toBe(serializeXml(e));
  });
});

describe('modelo de datos', () => {
  const dm = parseDataModel(DATA);
  it('lee puntos, conexiones y el dibujo declarado', () => {
    expect(dm.pts.filter((p) => p.type === 'node')).toHaveLength(3);
    expect(dm.pts.filter((p) => p.type === 'asst')).toHaveLength(1);
    expect(dm.pts.filter((p) => p.type === 'pres')).toHaveLength(1);
    expect(dm.cxns.filter((c) => c.type === 'parOf')).toHaveLength(4);
    expect(dm.cxns.filter((c) => c.type === 'presOf')).toHaveLength(1);
    expect(dm.pts[0]!.prSet).toMatchObject({ loTypeId: 'urn:test/layout/default', csCatId: 'accent1' });
    expect(drawingRelId(dm)).toBe('rId6');
  });

  it('escribir y volver a leer da el mismo modelo, sin pérdidas', () => {
    const again = parseDataModel(writeDataModel(dm));
    expect(again).toEqual(dm);
    expect(writeDataModel(again)).toBe(writeDataModel(dm));
  });

  it('se puede declarar y quitar el dibujo en caché', () => {
    const c = parseDataModel(writeDataModel(dm));
    setDrawingRelId(c, 'rId9');
    expect(drawingRelId(parseDataModel(writeDataModel(c)))).toBe('rId9');
    setDrawingRelId(c, null);
    expect(drawingRelId(c)).toBeUndefined();
  });
});

describe('árbol de nodos', () => {
  const tree = dataModelToTree(parseDataModel(DATA));

  it('se saca del modelo de datos con sus niveles, su texto multilínea y los ayudantes', () => {
    expect(lines(tree)).toEqual(['Uno ', 'Dos & medio', '-Hijo de dos|segunda línea', 'Ayudante']);
    expect(flatten(tree).map((n) => n.type)).toEqual(['node', 'node', 'node', 'asst']);
    expect(tree.docPr.loTypeId).toBe('urn:test/layout/default');
  });

  it('de vuelta al modelo de datos: sin puntos de presentación, con una transición de cada clase por nodo y ids estables', () => {
    const dm0 = parseDataModel(DATA);
    const dm = treeToDataModel(tree, dm0, counterIds('n'));
    expect(dm.pts.filter((p) => p.type === 'pres')).toHaveLength(0);
    expect(dm.cxns.filter((c) => c.type !== 'parOf')).toHaveLength(0);
    expect(dm.extLst).toBeUndefined();
    const ids = new Set(dm.pts.map((p) => p.modelId));
    for (const n of flatten(tree)) {
      const c = dm.cxns.find((x) => x.destId === n.id)!;
      expect(c.parTransId && ids.has(c.parTransId)).toBe(true);
      expect(c.sibTransId && ids.has(c.sibTransId)).toBe(true);
      expect(dm.pts.find((p) => p.modelId === c.parTransId)!.type).toBe('parTrans');
    }
    // los identificadores de las conexiones y transiciones que ya había se conservan
    const c3 = dm.cxns.find((c) => c.destId === '{N3}')!;
    expect(c3).toMatchObject({ modelId: '{C3}', parTransId: '{PT3}', sibTransId: '{ST3}', srcId: '{N2}' });
    // y se lee igual que antes
    expect(lines(dataModelToTree(parseDataModel(writeDataModel(dm))))).toEqual(lines(tree));
  });

  it('un nodo con el texto sin cambiar conserva su cuerpo (con el formato en negrita)', () => {
    const dm = treeToDataModel(tree, parseDataModel(DATA), counterIds());
    expect(writeDataModel(dm)).toContain('b="1"');
  });
});

describe('operaciones sobre el árbol', () => {
  const base = dataModelToTree(parseDataModel(DATA));
  const ids = counterIds('z');

  it('añadir un hijo, un hermano (después y antes) y un nodo de primer nivel', () => {
    const a = addChild(base, '{N1}', 'nuevo hijo', ids);
    expect(lines(a.tree)).toEqual(['Uno ', '-nuevo hijo', 'Dos & medio', '-Hijo de dos|segunda línea', 'Ayudante']);
    const b = addSibling(base, '{N2}', 'después', true, ids);
    expect(lines(b.tree).slice(0, 4)).toEqual(['Uno ', 'Dos & medio', '-Hijo de dos|segunda línea', 'después']);
    const c = addSibling(base, '{N1}', 'antes', false, ids);
    expect(lines(c.tree)[0]).toBe('antes');
    const d = addRoot(base, 'último', ids);
    expect(lines(d.tree).at(-1)).toBe('último');
    // el árbol de origen no se toca
    expect(lines(base)).toHaveLength(4);
  });

  it('quitar un nodo no pierde a sus hijos', () => {
    expect(lines(removeNode(base, '{N2}'))).toEqual(['Uno ', 'Hijo de dos|segunda línea', 'Ayudante']);
  });

  it('subir y bajar de nivel y mover entre hermanos', () => {
    expect(lines(promote(base, '{N3}'))).toEqual(['Uno ', 'Dos & medio', 'Hijo de dos|segunda línea', 'Ayudante']);
    expect(lines(demote(base, '{N2}'))).toEqual(['Uno ', '-Dos & medio', '--Hijo de dos|segunda línea', 'Ayudante']);
    expect(demote(base, '{N1}')).toBe(base); // el primero no tiene hermano anterior
    expect(promote(base, '{N1}')).toBe(base); // uno de primer nivel no puede subir
    expect(lines(moveNode(base, '{N1}', 1))).toEqual(['Dos & medio', '-Hijo de dos|segunda línea', 'Uno ', 'Ayudante']);
    expect(moveNode(base, '{N1}', -1)).toBe(base);
  });

  it('cambiar el texto descarta el cuerpo con formato; con el mismo texto no cambia nada', () => {
    expect(findNode(base, '{N1}')!.t).toBeDefined();
    const t = setText(base, '{N1}', 'otro');
    expect(findNode(t, '{N1}')!.text).toBe('otro');
    expect(findNode(t, '{N1}')!.t).toBeUndefined();
    expect(setText(base, '{N1}', 'Uno ')).toBe(base);
  });
});

describe('esquema de texto (panel)', () => {
  const base = dataModelToTree(parseDataModel(DATA));

  it('el esquema tiene un tabulador por nivel y se vuelve a leer', () => {
    const o = treeToOutline(base);
    expect(o).toBe('Uno \nDos & medio\n\tHijo de dos segunda línea\nAyudante');
    const back = outlineToTree(o, base);
    expect(flatten(back).map((n) => n.id)).toEqual(flatten(base).map((n) => n.id));
    expect(findNode(back, '{N1}')!.t).toBeDefined(); // texto igual: conserva el formato
  });

  it('acepta dos espacios por nivel, viñetas y líneas vacías, y no salta niveles', () => {
    const t = outlineToTree('- A\n\n    B\n      C\n          D\nE', base, counterIds('q'));
    expect(lines(t)).toEqual(['A', '-B', '--C', '---D', 'E']);
  });

  it('reutiliza los identificadores por orden y crea los que faltan', () => {
    const t = outlineToTree('Uno \nDos & medio\n\tHijo\nAyudante\nNuevo', base, counterIds('w'));
    const f = flatten(t);
    expect(f.slice(0, 4).map((n) => n.id)).toEqual(['{N1}', '{N2}', '{N3}', '{N4}']);
    expect(f[4]!.id).toBe('{w000001}');
    expect(findNode(t, '{N3}')!.t).toBeUndefined(); // el texto cambió
    expect(findNode(t, '{N4}')!.type).toBe('asst');
  });
});

describe('diseño (layoutDef)', () => {
  const def = parseLayoutDef(LAYOUT);

  it('lee la identidad, las categorías y los datos de ejemplo', () => {
    expect(def).toMatchObject({ uniqueId: 'urn:test/layout/default', title: 'Lista de bloques', cats: [{ type: 'list', pri: 400 }] });
    expect(def.sampData).toBeDefined();
    expect(def.root.name).toBe('diagram');
  });

  it('conserva el orden de los elementos de un nodo de diseño', () => {
    expect(def.root.items.map((i) => i.kind)).toEqual(['varLst', 'choose', 'shape', 'presOf', 'constrLst', 'ruleLst', 'forEach']);
  });

  it('choose/if/else, algoritmo y parámetros', () => {
    const ch = def.root.items.find((i) => i.kind === 'choose');
    if (ch?.kind !== 'choose') throw new Error('choose');
    expect(ch.ifs).toHaveLength(1);
    expect(ch.ifs[0]).toMatchObject({ func: 'var', arg: 'dir', op: 'equ', val: 'norm' });
    const alg = ch.ifs[0]!.items[0]!;
    expect(alg.kind === 'alg' && alg.type).toBe('snake');
    expect(alg.kind === 'alg' && alg.params.map((p) => `${p.type}=${p.val}`)).toEqual(['grDir=tL', 'flowDir=row', 'contDir=sameDir', 'off=ctr']);
    expect(ch.else).toHaveLength(1);
  });

  it('restricciones y reglas con sus valores por omisión', () => {
    const cl = def.root.items.find((i) => i.kind === 'constrLst');
    if (cl?.kind !== 'constrLst') throw new Error('constrLst');
    expect(cl.items).toHaveLength(5);
    expect(cl.items[1]).toMatchObject({ type: 'h', for: 'ch', forName: 'node', refType: 'w', refFor: 'ch', refForName: 'node', fact: 0.6, op: 'none', val: 0 });
    expect(cl.items[0]).toMatchObject({ fact: 1, refFor: 'self' });
    expect(cl.items[4]).toMatchObject({ type: 'primFontSz', op: 'equ', val: 65 });
    const node = layoutNodes(def).find((n) => n.name === 'node')!;
    const rl = node.items.find((i) => i.kind === 'ruleLst');
    if (rl?.kind !== 'ruleLst') throw new Error('ruleLst');
    expect(rl.items[0]!.type).toBe('primFontSz');
    expect(Number.isNaN(rl.items[0]!.fact)).toBe(true);
    expect(Number.isNaN(rl.items[0]!.max)).toBe(true);
  });

  it('forEach y nodos anidados con sus selectores', () => {
    const fe = def.root.items.find((i) => i.kind === 'forEach');
    if (fe?.kind !== 'forEach') throw new Error('forEach');
    expect(fe).toMatchObject({ name: 'Name3', axis: ['ch'], ptType: ['node'], st: [0], cnt: [0], step: [1], hideLastTrans: [true] });
    const inner = fe.items.find((i) => i.kind === 'forEach');
    if (inner?.kind !== 'forEach') throw new Error('inner');
    expect(inner).toMatchObject({ axis: ['followSib'], ptType: ['sibTrans'], cnt: [1] });
    expect(layoutNodes(def).map((n) => n.name)).toEqual(['diagram', 'node', 'sibTrans']);
    const node = layoutNodes(def)[1]!;
    const po = node.items.find((i) => i.kind === 'presOf');
    expect(po).toMatchObject({ axis: ['desOrSelf'], ptType: ['node'] });
    const shape = node.items.find((i) => i.kind === 'shape');
    expect(shape).toMatchObject({ type: 'rect', rot: 0, hideGeom: false });
    const vl = node.items.find((i) => i.kind === 'varLst');
    expect(vl).toMatchObject({ vars: { bulletEnabled: '1' } });
  });

  it('un diseño sin nodo raíz es un error claro', () => {
    expect(() => parseLayoutDef('<dgm:layoutDef xmlns:dgm="x" uniqueId="a"/>')).toThrow(/nodo raíz/);
  });
});

describe('estilos y colores', () => {
  it('estilo rápido: etiquetas con sus referencias al tema', () => {
    const s = parseStyleDef(STYLE);
    expect(s).toMatchObject({ uniqueId: 'urn:test/quickStyle/simple1', cats: [{ type: 'simple', pri: 10100 }] });
    expect(s.styleLbls.map((l) => l.name)).toEqual(['node1', 'sibTrans2D1']);
    const lnRef = styleLabel(s, 'node1')!.style!.kids.find((k) => k.name === 'a:lnRef')!;
    expect(lnRef.attrs.idx).toBe('2');
    expect(s.scene3d).toBeDefined();
  });

  it('colores: listas con su método y sentido del tono', () => {
    const c = parseColorsDef(COLORS);
    expect(colorLabel(c, 'node1')!.fill).toMatchObject({ meth: 'repeat', hueDir: 'cw' });
    expect(colorLabel(c, 'node1')!.fill.colors).toHaveLength(1);
    const sib = colorLabel(c, 'sibTrans2D1')!;
    expect(sib.fill).toMatchObject({ meth: 'span' }); // por omisión
    expect(sib.fill.colors).toHaveLength(2);
    expect(sib.lin).toMatchObject({ meth: 'cycle', hueDir: 'ccw' });
    expect(sib.lin.colors[0]!.kids[0]!.attrs.val).toBe('60000');
  });
});

describe('dibujo en caché', () => {
  const shapes = parseDrawing(DRAWING);

  it('lee las formas: posición, giro, volteo, geometría, relleno, estilo y texto', () => {
    expect(shapes).toHaveLength(2);
    expect(shapes[0]).toMatchObject({ modelId: '{P1}', x: 100, y: 200, w: 3000, h: 1800, rot: 900000, flipH: false, prst: 'roundRect', adj: { adj: 10000 } });
    expect(shapes[0]!.spPr.map((k) => k.name)).toEqual(['a:solidFill', 'a:ln']);
    expect(shapes[0]!.txXfrm).toEqual({ x: 150, y: 250, w: 2900, h: 1700, rot: 0 });
    expect(shapes[0]!.txBody).toBeDefined();
    expect(shapes[0]!.style).toBeDefined();
    expect(shapes[1]).toMatchObject({ flipH: true, prst: 'rect', adj: {} });
    expect(shapes[1]!.txBody).toBeUndefined();
  });

  it('escribir y volver a leer da las mismas formas', () => {
    expect(parseDrawing(writeDrawing(shapes))).toEqual(shapes);
  });
});

describe('las cinco partes', () => {
  const parts = { data: DATA, layout: LAYOUT, style: STYLE, colors: COLORS, drawing: DRAWING };

  it('se leen juntas y se vuelven a escribir; el diseño viaja tal cual', () => {
    const sa = parseSmartArt(parts);
    expect(sa.layout.uniqueId).toBe('urn:test/layout/default');
    expect(sa.drawing).toHaveLength(2);
    const out = writeSmartArt(sa);
    expect(out.layout).toBe(LAYOUT);
    expect(out.style).toBe(STYLE);
    expect(out.colors).toBe(COLORS);
    expect(parseSmartArt(out)).toEqual(sa);
  });

  it('sin dibujo en caché no se escribe', () => {
    const sa = parseSmartArt({ data: DATA, layout: LAYOUT, style: STYLE, colors: COLORS });
    expect(sa.drawing).toBeNull();
    expect(writeSmartArt(sa).drawing).toBeUndefined();
  });
});
