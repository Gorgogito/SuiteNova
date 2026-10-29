import { describe, expect, it } from 'vitest';
import { newDeck } from './defaults';
import { addElements } from './ops';
import { addNodeAt, boundsOfPaths, curveThrough, deleteNode, geometryToPaths, localToSlide, moveHandle, moveNode, newFreeform, normalizePaths, pathsToCust, segmentCount, setNodeKind, setSegmentKind, simplify, slideToLocal, svgToPaths, toggleClosed } from './freeform';
import { readPptx } from './pptx/read';
import { writePptx } from './pptx/write';
import { geometryOf } from './geometry/custom';
import type { ShapeEl } from './types';

const near = (a: number, b: number, e = 0.01) => expect(Math.abs(a - b)).toBeLessThan(e);

describe('freeform', () => {
  it('turns preset shapes into nodes and keeps their outline', () => {
    const rect = geometryToPaths({ prst: 'rect' }, 100, 50);
    expect(rect.length).toBe(1);
    expect(rect[0]!.closed).toBe(true);
    expect(rect[0]!.nodes.length).toBe(4);
    const b = boundsOfPaths(rect);
    near(b.w, 100);
    near(b.h, 50);
    const ell = geometryToPaths({ prst: 'ellipse' }, 100, 60);
    const eb = boundsOfPaths(ell);
    near(eb.w, 100, 0.5);
    near(eb.h, 60, 0.5);
    for (const prst of ['roundRect', 'star5', 'rightArrow', 'heart', 'cloud', 'pie', 'smileyFace', 'flowChartDelay']) {
      const g = geometryToPaths({ prst }, 120, 80);
      expect(g.length, prst).toBeGreaterThan(0);
      const bb = boundsOfPaths(g);
      expect(bb.w, prst).toBeLessThanOrEqual(126);
      expect(bb.h, prst).toBeLessThanOrEqual(84);
    }
  });

  it('writes nodes back as the same outline', () => {
    const paths = geometryToPaths({ prst: 'roundRect' }, 100, 60);
    const cust = pathsToCust(paths, 100, 60);
    const again = geometryToPaths({ cust: [cust] }, 100, 60);
    const a = boundsOfPaths(paths);
    const b = boundsOfPaths(again);
    near(a.w, b.w);
    near(a.h, b.h);
    expect(again[0]!.nodes.length).toBe(paths[0]!.nodes.length);
    void geometryOf;
  });

  it('moves nodes with their handles; smooth handles stay on one line', () => {
    let p = svgToPaths('M0 0C10 0 20 10 30 10C40 10 50 0 60 0');
    p = setNodeKind(p, 0, 1, 'smooth');
    const before = p[0]!.nodes[1]!;
    p = moveNode(p, 0, 1, { x: before.x + 5, y: before.y + 5 });
    near(p[0]!.nodes[1]!.hout!.x, before.hout!.x + 5);
    p = moveHandle(p, 0, 1, 'hout', { x: 45, y: 25 });
    const n = p[0]!.nodes[1]!;
    const a = { x: n.x - n.hin!.x, y: n.y - n.hin!.y };
    const o = { x: n.hout!.x - n.x, y: n.hout!.y - n.y };
    near(a.x * o.y - a.y * o.x, 0, 0.5);
  });

  it('adds a node without changing the curve, and deletes one', () => {
    const p0 = svgToPaths('M0 0C0 40 60 40 60 0');
    const mid = (p: typeof p0) => {
      const sp = p[0]!;
      // sample the whole path to compare shapes
      return sp.nodes.length;
    };
    void mid;
    const { paths: p1, index } = addNodeAt(p0, 0, 0, 0.5);
    expect(p1[0]!.nodes.length).toBe(3);
    expect(index).toBe(1);
    const b0 = boundsOfPaths(p0);
    const b1 = boundsOfPaths(p1);
    near(b0.h, b1.h, 0.2);
    near(b0.w, b1.w, 0.2);
    const p2 = deleteNode(p1, 0, 1);
    expect(p2[0]!.nodes.length).toBe(2);
    expect(deleteNode(p2, 0, 0).length).toBe(0);
    const line = setSegmentKind(p0, 0, 0, 'line');
    expect(line[0]!.nodes[0]!.hout).toBeUndefined();
    const curve = setSegmentKind(line, 0, 0, 'curve');
    expect(curve[0]!.nodes[0]!.hout).toBeDefined();
    expect(segmentCount(toggleClosed(p0, 0)[0]!)).toBe(2);
  });

  it('keeps every point where it was when the box changes, also rotated and flipped', () => {
    const paths = geometryToPaths({ prst: 'rect' }, 100, 50);
    const x = { x: 200, y: 100, w: 100, h: 50, rot: 30, flipH: true };
    const moved = moveNode(paths, 0, 2, { x: 160, y: 90 });
    const before = localToSlide({ x: 160, y: 90 }, x);
    const { paths: np, xfrm } = normalizePaths(moved, x);
    const n2 = np[0]!.nodes.find((n) => n.x > 0 && n.y > 0 && Math.abs(n.x - (160 - boundsOfPaths(moved).x)) < 0.01)!;
    const after = localToSlide(n2, xfrm);
    near(after.x, before.x, 0.05);
    near(after.y, before.y, 0.05);
    const p = { x: 233, y: 141 };
    const back = localToSlide(slideToLocal(p, x), x);
    near(back.x, p.x, 0.001);
    near(back.y, p.y, 0.001);
  });

  it('smooths scribbles and survives saving as a custom geometry', async () => {
    const pts = Array.from({ length: 60 }, (_, i) => ({ x: 100 + i * 5, y: 200 + Math.sin(i / 5) * 40 }));
    const simple = simplify(pts, 2);
    expect(simple.length).toBeLessThan(pts.length / 2);
    const sub = curveThrough(simple);
    expect(sub.nodes[1]!.hin).toBeDefined();
    const el = newFreeform([sub], 'Garabato');
    const bb = boundsOfPaths([sub]);
    near(el.xfrm!.x, bb.x);
    near(el.xfrm!.y, bb.y);
    near(el.xfrm!.w, bb.w);
    expect(el.fill).toEqual({ t: 'none' });
    let d = newDeck();
    d = addElements(d, d.slides[0]!.id, [el, newFreeform([{ nodes: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 50, y: 80 }], closed: true }])]);
    const back = (await readPptx((await writePptx(d)).data)).deck;
    const shapes = back.slides[0]!.shapes.filter((e): e is ShapeEl => e.kind === 'shape' && !!e.geom && 'cust' in e.geom);
    expect(shapes.length).toBe(2);
    const reread = geometryToPaths(shapes[0]!.geom, shapes[0]!.xfrm!.w, shapes[0]!.xfrm!.h);
    expect(reread[0]!.nodes.length).toBe(sub.nodes.length);
    expect(reread[0]!.closed).toBe(false);
  });
});
