import { describe, expect, it } from 'vitest';
import { portsOf } from './geometry';
import { newDiagram, type Page } from './model';
import { addConnector, addShape, newConnector } from './ops';
import { routeOf, slotOffset } from './route';

/** Three shapes on the left, each joined to the west connection point (index 3) of one shape on the right. */
function fan(spread?: number): { page: Page; target: string; ids: string[] } {
  let page: Page = { ...newDiagram().pages[0]!, ...(spread !== undefined ? { spread } : {}) };
  const t = addShape(page, 'rect', 700, 300, { w: 120, h: 120 });
  page = t.page;
  const ids: string[] = [];
  for (const y of [100, 300, 500]) {
    const s = addShape(page, 'rect', 200, y, { w: 80, h: 40 });
    page = s.page;
    const c = newConnector({ shape: s.shape.id, port: 1 }, { shape: t.shape.id, port: 3 }, { routing: 'straight' });
    page = addConnector(page, c);
    ids.push(c.id);
  }
  return { page, target: t.shape.id, ids };
}

describe('connectors that share a connection point', () => {
  it('are spread along the side, in the order of their other ends, 10 px apart by default', () => {
    const { page, target, ids } = fan();
    const shape = page.shapes.find((s) => s.id === target)!;
    const west = portsOf(shape)[3]!.point;
    const ends = ids.map((id) => {
      const c = page.connectors.find((x) => x.id === id)!;
      const pts = routeOf(c, page).points;
      return pts[pts.length - 1]!;
    });
    // all at the left side of the shape, at different heights
    for (const e of ends) expect(e.x).toBeCloseTo(west.x, 3);
    const ys = ends.map((e) => e.y);
    expect(new Set(ys.map((y) => Math.round(y))).size).toBe(3);
    // the connector that comes from the highest shape ends highest: they do not cross
    expect(ys[0]!).toBeLessThan(ys[1]!);
    expect(ys[1]!).toBeLessThan(ys[2]!);
    expect(ys[1]! - ys[0]!).toBeCloseTo(10, 3);
    expect(ys[2]! - ys[1]!).toBeCloseTo(10, 3);
    // centred on the point
    expect((ys[0]! + ys[2]!) / 2).toBeCloseTo(west.y, 3);
  });

  it('meet at the point when the spacing is 0, and a connector alone is not moved', () => {
    const { page, ids } = fan(0);
    const e = ids.map((id) => {
      const pts = routeOf(page.connectors.find((x) => x.id === id)!, page).points;
      return pts[pts.length - 1]!;
    });
    expect(new Set(e.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)).size).toBe(1);
    const single = fan();
    const alone = { ...single.page, connectors: single.page.connectors.slice(0, 1) };
    expect(slotOffset(alone.connectors[0]!, 'to', alone)).toBe(0);
  });

  it('a larger spacing fits inside the side: it never leaves the shape', () => {
    const { page, target } = fan(200);
    const shape = page.shapes.find((s) => s.id === target)!;
    for (const c of page.connectors) {
      const pts = routeOf(c, page).points;
      const end = pts[pts.length - 1]!;
      expect(end.y).toBeGreaterThanOrEqual(shape.y);
      expect(end.y).toBeLessThanOrEqual(shape.y + shape.h);
    }
  });

  it('works for elbow and curved connectors, and for connectors glued at both ends', () => {
    const { page } = fan();
    const elbows = { ...page, connectors: page.connectors.map((c) => ({ ...c, routing: 'elbow' as const })) };
    for (const c of elbows.connectors) {
      const r = routeOf(c, elbows);
      expect(r.points.length).toBeGreaterThanOrEqual(2);
      // orthogonal segments
      for (let i = 1; i < r.points.length; i++) expect(Math.abs(r.points[i]!.x - r.points[i - 1]!.x) < 0.01 || Math.abs(r.points[i]!.y - r.points[i - 1]!.y) < 0.01).toBe(true);
    }
    const curves = { ...page, connectors: page.connectors.map((c) => ({ ...c, routing: 'curve' as const })) };
    expect(routeOf(curves.connectors[0]!, curves).d).toContain('C');
  });

  it('auto ports that land on the same side are spread too', () => {
    let page: Page = newDiagram().pages[0]!;
    const t = addShape(page, 'rect', 700, 300, { w: 120, h: 120 });
    page = t.page;
    for (const y of [150, 300, 450]) {
      const s = addShape(page, 'rect', 200, y, { w: 80, h: 40 });
      page = addConnector(s.page, newConnector({ shape: s.shape.id, port: 'auto' }, { shape: t.shape.id, port: 'auto' }, { routing: 'straight' }));
    }
    const offs = page.connectors.map((c) => slotOffset(c, 'to', page));
    expect(new Set(offs.map((o) => Math.round(o))).size).toBe(3);
  });
});
