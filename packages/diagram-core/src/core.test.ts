import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import {
  CATEGORIES, STENCILS, addConnector, addItems, addPage, addShape, alignShapes, boundsOf, cloneItems, deleteItems, deletePage, distributeShapes, duplicatePage, elbow, hasStencil, hitShape, matchSize, moveConnectorEnds,
  moveShapes, movePage, newConnector, newDiagram, parseDiagram, portsOf, reorder, resizeShape, rotatePoint, routeOf, serializeDiagram, shapeRender, stencilOf, textWidth, updateShapes, wrapLines, pageToSvg, exportArea,
  connectorRender, centerOf, type Page, type Point,
} from './index';

const blank = (): Page => ({ ...newDiagram().pages[0]!, grid: 0 });
const put = (page: Page, stencil: string, cx: number, cy: number, over = {}) => addShape(page, stencil, cx, cy, over);

describe('stencils', () => {
  it('has the six categories and unique ids', () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual(['basic', 'flow', 'uml', 'network', 'bpmn', 'extra']);
    expect(new Set(STENCILS.map((s) => s.id)).size).toBe(STENCILS.length);
    expect(STENCILS.length).toBeGreaterThanOrEqual(60);
    for (const c of CATEGORIES) expect(STENCILS.some((s) => s.category === c.id), c.id).toBe(true);
  });
  it('every stencil draws valid path data inside a sane area and has usable connection points', () => {
    for (const st of STENCILS) {
      const paths = st.paths(st.w, st.h);
      expect(paths.length, st.id).toBeGreaterThan(0);
      for (const p of paths) {
        expect(p.d, st.id).toMatch(/^M[-\d.]/);
        expect(p.d, st.id).not.toMatch(/NaN|undefined|Infinity/);
      }
      expect(st.ports.length, st.id).toBeGreaterThanOrEqual(4);
      for (const p of st.ports) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      }
      const t = st.text!(st.w, st.h);
      expect(Number.isFinite(t.x + t.y + t.w + t.h), st.id).toBe(true);
      // still valid after resizing
      for (const p of st.paths(st.w * 2.5, st.h * 0.4)) expect(p.d).not.toMatch(/NaN|Infinity/);
    }
  });
  it('unknown stencils fall back to a rectangle', () => {
    expect(stencilOf('no-existe').id).toBe('rect');
    expect(hasStencil('no-existe')).toBe(false);
  });
});

describe('geometry', () => {
  it('rotates points and boxes', () => {
    const p = rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
    const { shape } = put(blank(), 'rect', 100, 100, { w: 100, h: 40, rot: 90 });
    const b = boundsOf(shape);
    expect(b.w).toBeCloseTo(40);
    expect(b.h).toBeCloseTo(100);
    expect(hitShape(shape, { x: 100, y: 140 })).toBe(true);
    expect(hitShape(shape, { x: 140, y: 100 })).toBe(false);
  });
  it('connection points follow the shape and its rotation', () => {
    const { shape } = put(blank(), 'rect', 100, 100, { w: 100, h: 40 });
    const ports = portsOf(shape);
    expect(ports.map((p) => p.dir)).toEqual([{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]);
    expect(ports[1]!.point).toEqual({ x: 150, y: 100 });
    const turned = portsOf({ ...shape, rot: 90 });
    expect(turned[1]!.point.x).toBeCloseTo(100);
    expect(turned[1]!.point.y).toBeCloseTo(150);
    expect(turned[1]!.dir).toEqual({ x: 0, y: 1 });
  });
});

describe('text layout', () => {
  it('wraps at word boundaries, keeps explicit breaks and splits long words', () => {
    const f = { size: 13, bold: false };
    expect(wrapLines('uno\ndos', 400, f)).toEqual(['uno', 'dos']);
    const lines = wrapLines('Esta es una frase bastante larga para una forma estrecha', 100, f);
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(textWidth(l, 13)).toBeLessThanOrEqual(100 + 1);
    const long = wrapLines('Supercalifragilisticoespialidoso', 60, f);
    expect(long.length).toBeGreaterThan(1);
    expect(long.join('')).toBe('Supercalifragilisticoespialidoso');
    expect(wrapLines('sin ajuste de línea aunque sea larga', 20, f, false)).toEqual(['sin ajuste de línea aunque sea larga']);
  });
  it('lays out shape text centred and UML class compartments', () => {
    const { shape } = put(blank(), 'rect', 100, 100, { w: 120, h: 70, text: 'Hola' });
    const r = shapeRender(shape);
    expect(r.texts).toHaveLength(1);
    expect(r.texts[0]!.anchor).toBe('middle');
    expect(r.texts[0]!.lines[0]!.x).toBe(60);
    const cls = put(blank(), 'umlClass', 100, 100, { text: 'Cliente\n---\n- nombre: String\n- edad: int\n---\n+ comprar()' }).shape;
    const cr = shapeRender(cls);
    expect(cr.texts).toHaveLength(3);
    expect(cr.texts[0]!.font.bold).toBe(true);
    expect(cr.texts[1]!.anchor).toBe('start');
    expect(cr.texts[1]!.lines.map((l) => l.text)).toEqual(['- nombre: String', '- edad: int']);
  });
});

describe('connectors', () => {
  const two = () => {
    let p = blank();
    const a = put(p, 'rect', 100, 100);
    p = a.page;
    const b = put(p, 'rect', 400, 300);
    p = b.page;
    return { p, a: a.shape, b: b.shape };
  };
  const axisAligned = (pts: Point[]) => pts.every((q, i) => i === 0 || Math.abs(q.x - pts[i - 1]!.x) < 0.01 || Math.abs(q.y - pts[i - 1]!.y) < 0.01);

  it('glues to the nearest connection point (auto) and leaves orthogonally', () => {
    const { p, a, b } = two();
    const c = newConnector({ shape: a.id, port: 'auto' }, { shape: b.id, port: 'auto' });
    const r = routeOf(c, addConnector(p, c));
    expect(r.points[0]).toEqual({ x: 160, y: 100 }); // right side of A
    expect(r.points[r.points.length - 1]).toEqual({ x: 340, y: 300 }); // left side of B, the nearest to A
    expect(axisAligned(r.points)).toBe(true);
  });
  it('follows a shape when it moves', () => {
    const { p, a, b } = two();
    const c = newConnector({ shape: a.id, port: 1 }, { shape: b.id, port: 0 });
    const q = addConnector(p, c);
    const before = routeOf(c, q).points;
    const moved = moveShapes(q, [b.id], 100, 0);
    const after = routeOf(c, moved).points;
    expect(after[after.length - 1]!.x).toBe(before[before.length - 1]!.x + 100);
    expect(after[0]).toEqual(before[0]);
  });
  it('elbow routes are orthogonal for every combination of directions', () => {
    const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }] as const;
    const targets: Point[] = [{ x: 300, y: 200 }, { x: -200, y: 150 }, { x: 10, y: 400 }, { x: 5, y: -300 }, { x: 40, y: 30 }];
    for (const d1 of dirs) for (const d2 of dirs) for (const e of targets) {
      const pts = elbow({ x: 0, y: 0 }, d1, e, d2);
      expect(axisAligned(pts), `${JSON.stringify([d1, d2, e])}`).toBe(true);
      expect(pts[0]).toEqual({ x: 0, y: 0 });
      expect(pts[pts.length - 1]).toEqual(e);
    }
  });
  it('straight and curved connectors, arrows and labels', () => {
    const { p, a, b } = two();
    const s = newConnector({ shape: a.id, port: 1 }, { shape: b.id, port: 3 }, { routing: 'straight', text: 'sí', startArrow: 'diamond' });
    const q = addConnector(p, s);
    const rs = connectorRender(s, q);
    expect(rs.route.points).toHaveLength(2);
    expect(rs.arrows).toHaveLength(2);
    expect(rs.label!.box.w).toBeGreaterThan(0);
    const c = newConnector({ shape: a.id, port: 1 }, { shape: b.id, port: 3 }, { routing: 'curve' });
    const rc = routeOf(c, q);
    expect(rc.d).toMatch(/^M[\d.-]+,[\d.-]+ C/);
    expect(rc.points).toHaveLength(33);
  });
  it('free ends and missing shapes do not break routing', () => {
    const p = blank();
    const c = newConnector({ x: 10, y: 10 }, { shape: 'x-gone', port: 0 });
    const r = routeOf(c, addConnector(p, c));
    expect(r.points.every((q) => Number.isFinite(q.x + q.y))).toBe(true);
  });
  it('deleting a shape leaves its connectors in place with loose ends', () => {
    const { p, a, b } = two();
    const c = newConnector({ shape: a.id, port: 1 }, { shape: b.id, port: 0 });
    const q = addConnector(p, c);
    const want = routeOf(c, q).points;
    const r = deleteItems(q, [a.id], []);
    expect(r.shapes).toHaveLength(1);
    expect(r.connectors).toHaveLength(1);
    expect(r.connectors[0]!.from).toEqual(want[0]);
    expect(routeOf(r.connectors[0]!, r).points[0]).toEqual(want[0]);
    // connectors can be removed on their own
    expect(deleteItems(q, [], [c.id]).connectors).toHaveLength(0);
  });
  it('moves loose ends only', () => {
    const { p, a } = two();
    const c = newConnector({ shape: a.id, port: 1 }, { x: 500, y: 500 });
    const q = moveConnectorEnds(addConnector(p, c), [c.id], 10, 20);
    expect(q.connectors[0]!.to).toEqual({ x: 510, y: 520 });
    expect(q.connectors[0]!.from).toEqual({ shape: a.id, port: 1 });
  });
});

describe('editing operations', () => {
  it('resizing keeps the opposite corner fixed, also when rotated', () => {
    const { shape } = put(blank(), 'rect', 200, 200, { w: 100, h: 60 });
    const grown = resizeShape(shape, 'se', { x: 300, y: 280 });
    expect([grown.x, grown.y, grown.w, grown.h]).toEqual([150, 170, 150, 110]);
    // rotated 90°: the north-west corner in local space must stay at the same world position
    const turned = { ...shape, rot: 90 };
    const anchor = (s: typeof shape) => rotatePoint({ x: s.x, y: s.y }, centerOf(s), s.rot);
    const before = anchor(turned);
    const world = rotatePoint({ x: 320, y: 290 }, centerOf(turned), 90);
    const r = resizeShape(turned, 'se', world);
    const after = anchor(r);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(r.w).toBeCloseTo(170);
    expect(r.h).toBeCloseTo(120);
    // edges change one dimension; aspect ratio can be kept on corners; never below the minimum
    expect(resizeShape(shape, 'e', { x: 400, y: 0 }).h).toBe(60);
    const ar = resizeShape(shape, 'se', { x: 350, y: 240 }, { keepAspect: true });
    expect(ar.w / ar.h).toBeCloseTo(100 / 60);
    expect(resizeShape(shape, 'e', { x: 0, y: 0 }).w).toBeGreaterThanOrEqual(8);
  });
  it('aligns and distributes using the real (rotated) bounds', () => {
    let p = blank();
    const ids: string[] = [];
    for (const [x, y] of [[100, 100], [250, 180], [500, 60]] as const) {
      const r = put(p, 'rect', x, y, { w: 60, h: 40 });
      p = r.page;
      ids.push(r.shape.id);
    }
    const left = alignShapes(p, ids, 'left');
    expect(new Set(left.shapes.map((s) => s.x)).size).toBe(1);
    const mid = alignShapes(p, ids, 'middle');
    expect(new Set(mid.shapes.map((s) => centerOf(s).y)).size).toBe(1);
    const d = distributeShapes(p, ids, 'h');
    const xs = d.shapes.map((s) => s.x);
    expect(xs[1]! - (xs[0]! + 60)).toBeCloseTo(xs[2]! - (xs[1]! + 60));
    expect(distributeShapes(p, ids.slice(0, 2), 'h')).toBe(p);
    const same = matchSize(updateShapes(p, [ids[1]!], { w: 200 }), [ids[1]!, ids[0]!], 'w');
    expect(same.shapes[0]!.w).toBe(200);
  });
  it('changes the drawing order', () => {
    let p = blank();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = put(p, 'rect', 50 + i * 10, 50);
      p = r.page;
      ids.push(r.shape.id);
    }
    const order = (q: Page) => q.shapes.map((s) => ids.indexOf(s.id));
    expect(order(reorder(p, [ids[0]!], 'front'))).toEqual([1, 2, 3, 0]);
    expect(order(reorder(p, [ids[3]!], 'back'))).toEqual([3, 0, 1, 2]);
    expect(order(reorder(p, [ids[1]!], 'forward'))).toEqual([0, 2, 1, 3]);
    expect(order(reorder(p, [ids[2]!], 'backward'))).toEqual([0, 2, 1, 3]);
    expect(order(reorder(p, [ids[0]!, ids[1]!], 'forward'))).toEqual([2, 0, 1, 3]);
    expect(order(reorder(p, [ids[3]!], 'forward'))).toEqual([0, 1, 2, 3]);
  });
  it('locked shapes do not move; clones get new ids and keep internal connectors only', () => {
    let p = blank();
    const a = put(p, 'rect', 100, 100);
    p = a.page;
    const b = put(p, 'rect', 300, 100, { locked: true });
    p = b.page;
    expect(moveShapes(p, [b.shape.id], 50, 0).shapes[1]!.x).toBe(b.shape.x);
    const c1 = newConnector({ shape: a.shape.id, port: 1 }, { shape: b.shape.id, port: 3 });
    const c2 = newConnector({ shape: a.shape.id, port: 0 }, { x: 5, y: 5 });
    p = addConnector(addConnector(p, c1), c2);
    const both = cloneItems(p, [a.shape.id, b.shape.id], [c1.id, c2.id], 20, 20);
    expect(both.shapes).toHaveLength(2);
    expect(both.connectors).toHaveLength(2);
    expect(both.shapes.every((s) => s.id !== a.shape.id && s.id !== b.shape.id)).toBe(true);
    expect(both.connectors.find((c) => !('shape' in c.to))!.to).toEqual({ x: 25, y: 25 });
    const onlyA = cloneItems(p, [a.shape.id], [c1.id, c2.id]);
    expect(onlyA.connectors).toHaveLength(1); // c1 would point at a shape that was not copied
    expect(addItems(p, onlyA.shapes, onlyA.connectors).shapes).toHaveLength(3);
  });
  it('pages: add, duplicate with new ids, move and delete (never the last)', () => {
    let d = newDiagram();
    const first = d.pages[0]!;
    const s = put(first, 'rect', 100, 100).shape;
    d = { ...d, pages: [{ ...first, shapes: [s] }] };
    const dup = duplicatePage(d, first.id)!;
    expect(dup.diagram.pages).toHaveLength(2);
    expect(dup.page.shapes[0]!.id).not.toBe(s.id);
    const add = addPage(dup.diagram);
    expect(add.diagram.pages.map((p) => p.name)).toContain('Página 3');
    expect(movePage(add.diagram, add.page.id, -1).pages[1]!.id).toBe(add.page.id);
    expect(deletePage(newDiagram(), newDiagram().pages[0]!.id).pages).toHaveLength(1);
  });
});

describe('.novadiagram', () => {
  it('round-trips', () => {
    let d = newDiagram('Mi diagrama');
    let p = d.pages[0]!;
    const a = put(p, 'decision', 200, 150, { text: 'Ok?' });
    const b = put(a.page, 'umlClass', 500, 200, { text: 'A\n---\nx' });
    p = addConnector(b.page, newConnector({ shape: a.shape.id, port: 'auto' }, { shape: b.shape.id, port: 3 }, { text: 'sí', routing: 'curve', endArrow: 'open' }));
    d = { ...d, pages: [p] };
    const { diagram, warnings } = parseDiagram(serializeDiagram(d));
    expect(warnings).toEqual([]);
    expect(diagram).toEqual(d);
  });
  it('rejects other files and repairs bad values', () => {
    expect(() => parseDiagram('hola')).toThrow(/JSON/);
    expect(() => parseDiagram('{"a":1}')).toThrow(/no es un diagrama/);
    const bad = JSON.stringify({
      format: 'novadiagram',
      pages: [{ shapes: [{ id: 'a', stencil: 'inventada', x: 'x', w: -5, h: 1e9, rot: 725, style: { fill: 'url(javascript:alert(1))', strokeWidth: 9999 } }, { id: 'a', stencil: 'rect', w: 10, h: 10 }], connectors: [{ from: { shape: 'a', port: 1 }, to: { shape: 'zzz', port: 0 } }, { from: { shape: 'a', port: 7.6 }, to: { x: 5, y: 6 }, routing: 'wavy', endArrow: 'rocket' }] }],
    });
    const { diagram, warnings } = parseDiagram(bad);
    const pg = diagram.pages[0]!;
    expect(pg.shapes.map((s) => s.stencil)).toEqual(['rect', 'rect']);
    expect(new Set(pg.shapes.map((s) => s.id)).size).toBe(2);
    expect(pg.shapes[0]!.w).toBe(1);
    expect(pg.shapes[0]!.h).toBe(20000);
    expect(pg.shapes[0]!.rot).toBe(5);
    expect(pg.shapes[0]!.style.fill).toBe('#ffffff');
    expect(pg.shapes[0]!.style.strokeWidth).toBe(40);
    expect(pg.connectors).toHaveLength(1);
    expect(pg.connectors[0]!.routing).toBe('elbow');
    expect(pg.connectors[0]!.endArrow).toBe('arrow');
    expect(warnings.length).toBe(2);
  });
});

describe('SVG export', () => {
  it('is well-formed, escapes text and draws shapes, arrows and labels', () => {
    let p = blank();
    const a = put(p, 'process', 150, 120, { text: 'A & B <c> "d"' });
    const b = put(a.page, 'decision', 450, 240, { text: '¿Listo?', style: { ...a.shape.style, shadow: true } });
    p = addConnector(b.page, newConnector({ shape: a.shape.id, port: 'auto' }, { shape: b.shape.id, port: 'auto' }, { text: 'sí' }));
    const svg = pageToSvg(p);
    expect(XMLValidator.validate(svg)).toBe(true);
    expect(svg).toContain('A &amp; B &lt;c&gt; &quot;d&quot;');
    expect(svg).toContain('feDropShadow');
    expect(svg).toContain('viewBox="0 0 1123 794"');
    const doc = new XMLParser({ ignoreAttributes: false }).parse(svg);
    expect(doc.svg['@_xmlns']).toBe('http://www.w3.org/2000/svg');
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(pageToSvg(p, { transparent: true })).not.toContain(`fill="${p.background}"/>\n<g`);
  });
  it('crops to the content or grows to include what sticks out of the page', () => {
    const p = put(blank(), 'rect', 3000, 100).page;
    expect(exportArea(p).w).toBeGreaterThan(3000);
    const q = put(blank(), 'rect', 200, 200, { w: 100, h: 50 }).page;
    const crop = exportArea(q, { area: 'content', margin: 10 });
    expect(crop).toEqual({ x: 140, y: 165, w: 120, h: 70 });
    expect(exportArea(blank(), { area: 'content' })).toEqual({ x: 0, y: 0, w: 1123, h: 794 });
  });
});
