import { describe, expect, it } from 'vitest';
import { settleContainers } from './container';
import { boundsOf, rectsIntersect } from './geometry';
import { groupShapes } from './groups';
import { autoLayout, LAYOUT_KINDS, resetPorts } from './layout';
import { newDiagram, type Page } from './model';
import { addConnector, addShape, newConnector } from './ops';

/** A small hierarchy: a → b, c ; b → d, e ; c → f, scattered on the page. */
function sample(): { page: Page; ids: Record<string, string> } {
  let page: Page = newDiagram().pages[0]!;
  const ids: Record<string, string> = {};
  const at: Record<string, [number, number]> = { a: [700, 500], b: [100, 100], c: [400, 650], d: [900, 150], e: [250, 400], f: [800, 300] };
  for (const [k, [x, y]] of Object.entries(at)) {
    const r = addShape(page, 'rect', x, y, { w: 100, h: 50 });
    page = r.page;
    ids[k] = r.shape.id;
  }
  for (const [from, to] of [['a', 'b'], ['a', 'c'], ['b', 'd'], ['b', 'e'], ['c', 'f']] as const) {
    page = addConnector(page, newConnector({ shape: ids[from]!, port: 'auto' }, { shape: ids[to]!, port: 'auto' }));
  }
  return { page, ids };
}

const box = (page: Page, id: string) => boundsOf(page.shapes.find((s) => s.id === id)!);
const noOverlap = (page: Page) => {
  const bs = page.shapes.map(boundsOf);
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) expect(rectsIntersect(bs[i]!, bs[j]!), `${i} overlaps ${j}`).toBe(false);
};

describe('automatic layout', () => {
  it('layered, top to bottom: each connector goes down a layer, layers are aligned, nothing overlaps', () => {
    const { page, ids } = sample();
    const q = autoLayout(page, { kind: 'layered', dir: 'TB' });
    for (const [from, to] of [['a', 'b'], ['a', 'c'], ['b', 'd'], ['b', 'e'], ['c', 'f']] as const) expect(box(q, ids[to]!).y).toBeGreaterThan(box(q, ids[from]!).y);
    // the same layer, the same height
    expect(box(q, ids.b!).y).toBeCloseTo(box(q, ids.c!).y, 3);
    expect(box(q, ids.d!).y).toBeCloseTo(box(q, ids.e!).y, 3);
    expect(box(q, ids.d!).y).toBeCloseTo(box(q, ids.f!).y, 3);
    // the parent sits over its children
    const cx = (id: string) => box(q, id).x + box(q, id).w / 2;
    expect(cx(ids.b!)).toBeGreaterThan(Math.min(cx(ids.d!), cx(ids.e!)) - 1);
    expect(cx(ids.b!)).toBeLessThan(Math.max(cx(ids.d!), cx(ids.e!)) + 1);
    noOverlap(q);
    // the top left of the drawing stays where it was
    const was = page.shapes.map(boundsOf);
    const now = q.shapes.map(boundsOf);
    expect(Math.min(...now.map((b) => b.x))).toBeCloseTo(Math.min(...was.map((b) => b.x)), 3);
    expect(Math.min(...now.map((b) => b.y))).toBeCloseTo(Math.min(...was.map((b) => b.y)), 3);
  });

  it('the four directions mirror and turn the layers', () => {
    const { page, ids } = sample();
    const lr = autoLayout(page, { kind: 'layered', dir: 'LR' });
    expect(box(lr, ids.b!).x).toBeGreaterThan(box(lr, ids.a!).x);
    expect(box(lr, ids.d!).x).toBeGreaterThan(box(lr, ids.b!).x);
    const rl = autoLayout(page, { kind: 'layered', dir: 'RL' });
    expect(box(rl, ids.b!).x).toBeLessThan(box(rl, ids.a!).x);
    const bt = autoLayout(page, { kind: 'layered', dir: 'BT' });
    expect(box(bt, ids.b!).y).toBeLessThan(box(bt, ids.a!).y);
    noOverlap(lr);
    noOverlap(rl);
    noOverlap(bt);
  });

  it('copes with cycles, self-connections, free ends and disconnected shapes', () => {
    let { page, ids } = sample();
    page = addConnector(page, newConnector({ shape: ids.f!, port: 'auto' }, { shape: ids.a!, port: 'auto' }));
    page = addConnector(page, newConnector({ shape: ids.a!, port: 'auto' }, { shape: ids.a!, port: 'auto' }));
    page = addConnector(page, newConnector({ shape: ids.a!, port: 'auto' }, { x: 10, y: 10 }));
    const lone = addShape(page, 'ellipse', 50, 700, { w: 60, h: 60 });
    for (const kind of LAYOUT_KINDS) {
      const q = autoLayout(lone.page, { kind });
      expect(q.shapes).toHaveLength(7);
      for (const s of q.shapes) {
        expect(Number.isFinite(s.x) && Number.isFinite(s.y), kind).toBe(true);
      }
      if (kind !== 'organic') noOverlap(q);
    }
  });

  it('a tree centres each parent over its children; the radial layout puts levels on rings', () => {
    const { page, ids } = sample();
    const t = autoLayout(page, { kind: 'tree', dir: 'TB' });
    const cx = (id: string) => box(t, id).x + box(t, id).w / 2;
    expect(cx(ids.b!)).toBeCloseTo((cx(ids.d!) + cx(ids.e!)) / 2, 3);
    expect(cx(ids.a!)).toBeCloseTo((cx(ids.b!) + cx(ids.c!)) / 2, 0);
    noOverlap(t);
    const r = autoLayout(page, { kind: 'radial' });
    const c = (id: string) => ({ x: box(r, id).x + box(r, id).w / 2, y: box(r, id).y + box(r, id).h / 2 });
    const dist = (a: string, b: string) => Math.hypot(c(a).x - c(b).x, c(a).y - c(b).y);
    expect(dist(ids.a!, ids.b!)).toBeCloseTo(dist(ids.a!, ids.c!), 3);
    expect(dist(ids.a!, ids.d!)).toBeGreaterThan(dist(ids.a!, ids.b!));
    noOverlap(r);
  });

  it('circular puts every shape at the same distance from the centre; grid makes rows and columns', () => {
    const { page } = sample();
    const ci = autoLayout(page, { kind: 'circular' });
    const cs = ci.shapes.map((s) => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 }));
    const mx = cs.reduce((a, b) => a + b.x, 0) / cs.length;
    const my = cs.reduce((a, b) => a + b.y, 0) / cs.length;
    const rs = cs.map((p) => Math.hypot(p.x - mx, p.y - my));
    expect(Math.max(...rs) - Math.min(...rs)).toBeLessThan(2);
    const g = autoLayout(page, { kind: 'grid' });
    const rows = new Set(g.shapes.map((s) => Math.round(s.y)));
    const cols = new Set(g.shapes.map((s) => Math.round(s.x)));
    expect(rows.size * cols.size).toBeGreaterThanOrEqual(6);
    expect(rows.size).toBeLessThanOrEqual(3);
    noOverlap(g);
  });

  it('organic is repeatable and keeps connected shapes close', () => {
    const { page, ids } = sample();
    const a = autoLayout(page, { kind: 'organic' });
    const b = autoLayout(page, { kind: 'organic' });
    expect(a.shapes.map((s) => [s.x, s.y])).toEqual(b.shapes.map((s) => [s.x, s.y]));
    const c = (q: Page, id: string) => ({ x: box(q, id).x, y: box(q, id).y });
    const d = (q: Page, x: string, y: string) => Math.hypot(c(q, x).x - c(q, y).x, c(q, x).y - c(q, y).y);
    expect(d(a, ids.a!, ids.b!)).toBeLessThan(d(a, ids.b!, ids.f!) * 1.5);
  });

  it('only the chosen shapes move; a group moves as one; a container takes its members', () => {
    const { page, ids } = sample();
    const only = autoLayout(page, { kind: 'grid', ids: [ids.a!, ids.b!, ids.c!] });
    expect(box(only, ids.d!)).toEqual(box(page, ids.d!));
    expect(box(only, ids.e!)).toEqual(box(page, ids.e!));
    // group d and e: they stay at the same distance from each other
    const g = groupShapes(page, [ids.d!, ids.e!])!;
    const before = { dx: box(g.page, ids.e!).x - box(g.page, ids.d!).x, dy: box(g.page, ids.e!).y - box(g.page, ids.d!).y };
    const q = autoLayout(g.page, { kind: 'layered' });
    expect(box(q, ids.e!).x - box(q, ids.d!).x).toBeCloseTo(before.dx, 3);
    expect(box(q, ids.e!).y - box(q, ids.d!).y).toBeCloseTo(before.dy, 3);
    // a container with a shape inside
    let p: Page = newDiagram().pages[0]!;
    const k = addShape(p, 'container', 200, 200, { w: 300, h: 200 });
    const inner = addShape(k.page, 'rect', 200, 220, { w: 60, h: 40 });
    const other = addShape(inner.page, 'rect', 800, 600, { w: 60, h: 40 });
    p = settleContainers(addConnector(other.page, newConnector({ shape: k.shape.id, port: 'auto' }, { shape: other.shape.id, port: 'auto' })));
    const laid = autoLayout(p, { kind: 'layered', dir: 'LR' });
    const ks = laid.shapes.find((s) => s.id === k.shape.id)!;
    const is = laid.shapes.find((s) => s.id === inner.shape.id)!;
    expect(is.x - ks.x).toBeCloseTo(p.shapes.find((s) => s.id === inner.shape.id)!.x - p.shapes.find((s) => s.id === k.shape.id)!.x, 3);
    expect(is.parent).toBe(k.shape.id);
  });

  it('a layout that outgrows the page makes the page bigger; ports can be released', () => {
    let page: Page = { ...newDiagram().pages[0]!, width: 300, height: 300 };
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = addShape(page, 'rect', 100, 100, { w: 100, h: 50 });
      page = r.page;
      ids.push(r.shape.id);
    }
    for (let i = 1; i < 6; i++) page = addConnector(page, newConnector({ shape: ids[0]!, port: 1 }, { shape: ids[i]!, port: 3 }));
    const q = autoLayout(page, { kind: 'layered', dir: 'TB' });
    expect(q.width).toBeGreaterThan(300);
    const r = resetPorts(q);
    expect(r.connectors.every((c) => 'shape' in c.from && c.from.port === 'auto')).toBe(true);
  });
});
