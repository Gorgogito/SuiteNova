import { describe, expect, it } from 'vitest';
import { COLORS_CATALOG, LAYOUT_CATALOG, STYLE_CATALOG, changeColors, changeLayout, changeStyle, counterIds, flatten, newSmartArt, parseColorsDef, parseLayoutDef, parseSmartArt, parseStyleDef, resize, treeOf, writeSmartArt, outlineToTree, newTree, renderSmartArt, setText, serializeXml } from './index';

const size = { width: 640, height: 380 };
const pt = (v: number) => v / 12700;

describe('catálogo propio', () => {
  it('los diseños, estilos y colores se leen y tienen identificador y nombre', () => {
    for (const l of LAYOUT_CATALOG) {
      const d = parseLayoutDef(l.xml);
      expect(d.uniqueId, l.name).toBe(l.id);
      expect(d.title).toBe(l.name);
      expect(l.id.startsWith('urn:suitenova/layout/')).toBe(true);
    }
    for (const s of STYLE_CATALOG) expect(parseStyleDef(s.xml).styleLbls.length).toBeGreaterThan(10);
    for (const c of COLORS_CATALOG) expect(parseColorsDef(c.xml).styleLbls.length).toBeGreaterThan(10);
    expect(new Set(LAYOUT_CATALOG.map((l) => l.id)).size).toBe(LAYOUT_CATALOG.length);
  });

  it('cada diseño dibuja su texto de ejemplo dentro del dibujo, con aspecto y sin salirse', () => {
    for (const l of LAYOUT_CATALOG) {
      const sa = newSmartArt({ layout: l.id, text: l.sample, ...size, ids: counterIds('c') });
      const shapes = sa.drawing!;
      const nodes = flatten(treeOf(sa)).length;
      expect(shapes.length, l.name).toBeGreaterThanOrEqual(Math.min(nodes, 3));
      for (const s of shapes) {
        if (s.custGeom) continue;
        expect(s.w, l.name).toBeGreaterThan(0);
        expect(pt(s.x), `${l.name} x`).toBeGreaterThanOrEqual(-1);
        expect(pt(s.y), `${l.name} y`).toBeGreaterThanOrEqual(-1);
        expect(pt(s.x + s.w), `${l.name} derecha`).toBeLessThanOrEqual(size.width + 1);
        expect(pt(s.y + s.h), `${l.name} abajo`).toBeLessThanOrEqual(size.height + 1);
      }
      expect(shapes.some((s) => s.spPr.length > 0), `${l.name} con aspecto`).toBe(true);
      // el texto de cada nodo de primer nivel está en alguna forma
      const text = JSON.stringify(shapes.map((s) => s.txBody));
      for (const n of flatten(treeOf(sa)).filter((x) => x.level === 0)) expect(text, `${l.name}: ${n.text}`).toContain(n.text);
    }
  });

  it('geometría conocida (cifras medidas con PowerPoint para diseños equivalentes)', () => {
    const near = (a: number, b: number, tol: number, msg: string) => expect(Math.abs(a - b), `${msg}: ${a} vs ${b}`).toBeLessThanOrEqual(tol);
    const list = newSmartArt({ layout: 'urn:suitenova/layout/blocklist', text: 'Uno\nDos\nTres\nCuatro\nCinco', ...size }).drawing!;
    near(pt(list[3]!.x), 110, 0.5, 'bloque 4');
    near(pt(list[0]!.w), 200, 0.5, 'bloque');
    const pyra = newSmartArt({ layout: 'urn:suitenova/layout/pyramid', text: 'Uno\nDos\nTres', ...size }).drawing!;
    expect(pyra.map((s) => [Math.round(pt(s.x)), Math.round(pt(s.w))])).toEqual([[213, 213], [107, 427], [0, 640]]);
    const cyc = newSmartArt({ layout: 'urn:suitenova/layout/cycle', text: 'Uno\nDos\nTres\nCuatro\nCinco', ...size }).drawing!;
    expect(cyc.filter((s) => s.prst === 'ellipse')).toHaveLength(5);
    expect(cyc.filter((s) => s.prst === 'rightArrow')).toHaveLength(5);
    near(pt(cyc[0]!.w), 114.7, 0.5, 'nodo del ciclo');
    const proc = newSmartArt({ layout: 'urn:suitenova/layout/process', text: 'Uno\nDos\nTres', ...size }).drawing!;
    near(pt(proc[0]!.w), 168.1, 0.6, 'nodo del proceso');
  });

  it('la jerarquía dibuja un conector por cada nodo que no es raíz y el Venn se adapta al número de círculos', () => {
    const h = newSmartArt({ layout: 'urn:suitenova/layout/hierarchy', text: 'Uno\n\tDos\n\t\tTres\n\t\tCuatro\n\tCinco', ...size }).drawing!;
    expect(h.filter((s) => s.custGeom)).toHaveLength(4);
    expect(h.filter((s) => s.prst === 'roundRect')).toHaveLength(10);
    for (let n = 1; n <= 5; n++) {
      const v = newSmartArt({ layout: 'urn:suitenova/layout/venn', text: Array.from({ length: n }, (_, i) => `C${i + 1}`).join('\n'), ...size }).drawing!;
      expect(v.filter((s) => s.prst === 'ellipse'), `${n} círculos`).toHaveLength(n);
    }
  });

  it('un cambio de texto, de diseño, de estilo y de colores rehace el dibujo y todo se guarda y se lee igual', () => {
    const sa = newSmartArt({ layout: 'urn:suitenova/layout/process', text: 'A\nB', ...size, ids: counterIds('d') });
    const tree = setText(treeOf(sa), treeOf(sa).roots[0]!.id, 'Inicio');
    expect(JSON.stringify(resize({ ...sa }, { width: 320, height: 190 }).drawing![0]!.w)).not.toBe(JSON.stringify(sa.drawing![0]!.w));
    const swapped = changeLayout(sa, 'urn:suitenova/layout/blocklist', size);
    expect(swapped.layout.uniqueId).toBe('urn:suitenova/layout/blocklist');
    expect(swapped.drawing!.every((s) => s.prst === 'rect')).toBe(true);
    expect(treeOf(swapped).docPr.loTypeId).toBe('urn:suitenova/layout/blocklist');
    const flat = changeStyle(swapped, 'urn:suitenova/quickStyle/flat', size);
    expect(serializeXml(flat.drawing![0]!.spPr[1]!)).toBe('<a:ln><a:noFill/></a:ln>');
    const red = changeColors(flat, 'urn:suitenova/colors/accent2', size);
    expect(serializeXml(red.drawing![0]!.spPr[0]!)).toContain('accent2');
    // los nodos y su identificador no cambian con el diseño
    expect(flatten(treeOf(red)).map((n) => n.id)).toEqual(flatten(treeOf(sa)).map((n) => n.id));
    const back = parseSmartArt(writeSmartArt(red));
    expect(back.layout.uniqueId).toBe(red.layout.uniqueId);
    expect(back.colors.uniqueId).toBe('urn:suitenova/colors/accent2');
    expect(back.drawing).toEqual(red.drawing);
    expect(tree.roots[0]!.text).toBe('Inicio');
  });

  it('el colorido reparte los acentos entre las formas y el árbol vacío no rompe nada', () => {
    const sa = newSmartArt({ layout: 'urn:suitenova/layout/blocklist', text: 'A\nB\nC', colors: 'urn:suitenova/colors/colorful', ...size });
    const fills = sa.drawing!.map((s) => /schemeClr val="(accent\d)"/.exec(serializeXml(s.spPr[0]!))![1]);
    expect(fills).toEqual(['accent2', 'accent3', 'accent4']);
    const empty = newSmartArt({ layout: 'urn:suitenova/layout/venn', text: newTree({ layout: 'x', style: 'y', colors: 'z' }), ...size });
    expect(renderSmartArt(empty, size)).toEqual([]);
    expect(() => newSmartArt({ layout: 'urn:desconocido', text: '', ...size })).toThrow();
  });

  it('el panel de texto reutiliza los nodos al editar', () => {
    const sa = newSmartArt({ layout: 'urn:suitenova/layout/process', text: 'A\nB', ...size, ids: counterIds('e') });
    const t = outlineToTree('A\nB\nC', treeOf(sa), counterIds('f'));
    expect(flatten(t).map((n) => n.id).slice(0, 2)).toEqual(flatten(treeOf(sa)).map((n) => n.id));
  });
});
