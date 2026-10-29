import { describe, expect, it } from 'vitest';
import { addLane, assignMembership, containerDefaults, descendantsOf, hitContainerFrame, laneAt, laneBoxes, moveLane, removeLane, renameLane, resizeLane, setContainerProps, settleContainers, withMembers, wrapInContainer } from './container';
import { boundsOf } from './geometry';
import { parseDiagram, serializeDiagram } from './io';
import { newDiagram, type Page } from './model';
import { addShape, moveShapes, updatePage, updateShapes } from './ops';
import { pageToSvg } from './svg';

const blank = (): Page => newDiagram().pages[0]!;

function box(page: Page, at = { x: 300, y: 250 }) {
  const r = addShape(page, 'container', at.x, at.y);
  return r;
}

describe('containers', () => {
  it('a container holds the shapes inside it and they move with it', () => {
    let p = blank();
    const c = box(p);
    p = c.page;
    const a = addShape(p, 'rect', 300, 260, { w: 60, h: 40 });
    p = settleContainers(a.page);
    const inner = p.shapes.find((s) => s.id === a.shape.id)!;
    expect(inner.parent).toBe(c.shape.id);
    const out = addShape(p, 'rect', 900, 600, { w: 60, h: 40 });
    p = settleContainers(out.page);
    expect(p.shapes.find((s) => s.id === out.shape.id)!.parent).toBeUndefined();
    const ids = withMembers(p, [c.shape.id]);
    expect(ids).toContain(a.shape.id);
    expect(ids).not.toContain(out.shape.id);
    // new containers sit behind
    expect(p.shapes[0]!.id).toBe(c.shape.id);
    p = moveShapes(p, ids, 40, 10);
    p = settleContainers(p);
    expect(p.shapes.find((s) => s.id === a.shape.id)!.parent).toBe(c.shape.id);
  });

  it('grows around members that move outwards, fits when asked, and stays when told never', () => {
    let p = blank();
    const c = box(p);
    p = addShape(c.page, 'rect', 300, 260, { w: 60, h: 40 }).page;
    p = settleContainers(p);
    const id = c.shape.id;
    const mem = p.shapes.find((s) => s.parent === id)!;
    // push the member towards the right edge, beyond it
    const before = p.shapes.find((s) => s.id === id)!;
    p = updateShapes(p, [mem.id], { x: before.x + before.w - 30 });
    let q = settleContainers(p);
    // the centre is inside, so it is still a member, and the container grew to hold it with its margin
    const grown = q.shapes.find((s) => s.id === id)!;
    expect(grown.w).toBeGreaterThan(before.w);
    expect(boundsOf(q.shapes.find((s) => s.id === mem.id)!).x + 60 + 16).toBeLessThanOrEqual(grown.x + grown.w + 0.01);
    // never: the size stays
    const never = settleContainers(setContainerProps(p, [id], { autoSize: 'never' }));
    expect(never.shapes.find((s) => s.id === id)!.w).toBe(before.w);
    // fit: shrinks around a single small member
    const fit = settleContainers(setContainerProps(q, [id], { autoSize: 'fit' }));
    const f = fit.shapes.find((s) => s.id === id)!;
    expect(f.w).toBeLessThan(grown.w);
    expect(f.w).toBeGreaterThanOrEqual(80);
    // and when the member leaves, the container keeps its size
    const left = settleContainers(updateShapes(fit, [mem.id], { x: 1000, y: 700 }));
    expect(left.shapes.find((s) => s.id === mem.id)!.parent).toBeUndefined();
  });

  it('nested containers: the inner one grows, then the outer one', () => {
    let p = blank();
    const outer = addShape(p, 'container', 400, 300, { w: 500, h: 400 });
    p = outer.page;
    const inner = addShape(p, 'container', 400, 320, { w: 200, h: 140 });
    p = settleContainers(inner.page);
    expect(p.shapes.find((s) => s.id === inner.shape.id)!.parent).toBe(outer.shape.id);
    const m = addShape(p, 'rect', 400, 320, { w: 60, h: 40 });
    p = settleContainers(m.page);
    expect(p.shapes.find((s) => s.id === m.shape.id)!.parent).toBe(inner.shape.id);
    // move the member far to the right (inside the outer one, beyond the inner)
    const q0 = p.shapes.find((s) => s.id === inner.shape.id)!;
    p = updateShapes(p, [m.shape.id], { x: q0.x + q0.w - 40 });
    p = settleContainers(p);
    const i2 = p.shapes.find((s) => s.id === inner.shape.id)!;
    expect(i2.w).toBeGreaterThan(q0.w);
    expect(descendantsOf(p, outer.shape.id).map((s) => s.id).sort()).toEqual([inner.shape.id, m.shape.id].sort());
  });

  it('wraps a selection in a container behind it', () => {
    let p = blank();
    const a = addShape(p, 'rect', 200, 200);
    const b = addShape(a.page, 'ellipse', 400, 260);
    const r = wrapInContainer(b.page, [a.shape.id, b.shape.id])!;
    expect(r.page.shapes[0]!.id).toBe(r.id);
    const box0 = r.page.shapes[0]!;
    for (const id of [a.shape.id, b.shape.id]) {
      const bb = boundsOf(r.page.shapes.find((s) => s.id === id)!);
      expect(bb.x).toBeGreaterThanOrEqual(box0.x);
      expect(bb.y).toBeGreaterThanOrEqual(box0.y + 28);
      expect(r.page.shapes.find((s) => s.id === id)!.parent).toBe(r.id);
    }
  });

  it('only the frame of a container is hit, not its inside', () => {
    const c = box(blank()).shape;
    expect(hitContainerFrame(c, { x: c.x + 100, y: c.y + 100 })).toBe(false);
    expect(hitContainerFrame(c, { x: c.x + 100, y: c.y + 10 })).toBe(true);
    expect(hitContainerFrame(c, { x: c.x + 2, y: c.y + 100 })).toBe(true);
  });

  it('defaults exist only for container stencils', () => {
    expect(containerDefaults('rect')).toBeNull();
    expect(containerDefaults('pool')!.props.lanes).toHaveLength(3);
    expect(containerDefaults('poolV')!.props.dir).toBe('v');
  });
});

describe('swimlanes', () => {
  function pool(): { page: Page; id: string; lanes: string[] } {
    const r = addShape(blank(), 'pool', 400, 300, { w: 640, h: 300 });
    const lanes = r.shape.container!.lanes!.map((l) => l.id);
    return { page: r.page, id: r.shape.id, lanes };
  }

  it('shapes belong to the lane they are in; lanes are laid out one below the other', () => {
    const { page, id, lanes } = pool();
    const boxes = laneBoxes(page.shapes[0]!);
    expect(boxes).toHaveLength(3);
    expect(boxes[1]!.rect.y).toBeCloseTo(boxes[0]!.rect.y + boxes[0]!.rect.h);
    const pl = page.shapes[0]!;
    const a = addShape(page, 'rect', pl.x + 200, boxes[1]!.rect.y + 50, { w: 60, h: 40 });
    const p = settleContainers(a.page);
    const m = p.shapes.find((s) => s.id === a.shape.id)!;
    expect(m.parent).toBe(id);
    expect(m.lane).toBe(lanes[1]);
    expect(laneAt(p.shapes[0]!, { x: pl.x + 10, y: boxes[2]!.rect.y + 5 })!.lane.id).toBe(lanes[2]);
  });

  it('a lane grows to hold what is in it and the lanes below move down with their shapes', () => {
    const { page, id, lanes } = pool();
    const pl = page.shapes[0]!;
    const boxes = laneBoxes(pl);
    let p = addShape(page, 'rect', pl.x + 200, boxes[0]!.rect.y + 50, { w: 60, h: 40 }).page;
    const second = addShape(p, 'rect', pl.x + 300, boxes[1]!.rect.y + 50, { w: 60, h: 40 });
    p = settleContainers(second.page);
    const firstShape = p.shapes.find((s) => s.lane === lanes[0])!;
    const secondY0 = p.shapes.find((s) => s.id === second.shape.id)!.y;
    // push the first lane's shape down, near the bottom of its lane and beyond
    p = updateShapes(p, [firstShape.id], { y: boxes[0]!.rect.y + 60 });
    p = settleContainers(p);
    const pl2 = p.shapes.find((s) => s.id === id)!;
    const lane0 = pl2.container!.lanes![0]!;
    expect(lane0.size).toBeGreaterThan(100);
    const m2 = p.shapes.find((s) => s.id === second.shape.id)!;
    expect(m2.y - secondY0).toBeCloseTo(lane0.size - 100, 3);
    expect(m2.lane).toBe(lanes[1]);
    expect(pl2.h).toBeCloseTo(pl2.container!.lanes!.reduce((a, l) => a + l.size, 0), 3);
  });

  it('the pool grows to the right for a shape that reaches past its end', () => {
    const { page, id } = pool();
    const pl = page.shapes[0]!;
    const boxes = laneBoxes(pl);
    let p = addShape(page, 'rect', pl.x + pl.w - 40, boxes[0]!.rect.y + 40, { w: 60, h: 40 }).page;
    p = settleContainers(p);
    expect(p.shapes.find((s) => s.id === id)!.w).toBeGreaterThan(pl.w);
  });

  it('add, remove, rename, resize and reorder lanes keep the members in their lanes', () => {
    const { page, id, lanes } = pool();
    const pl = page.shapes[0]!;
    const boxes = laneBoxes(pl);
    let p = addShape(page, 'rect', pl.x + 200, boxes[2]!.rect.y + 50, { w: 60, h: 40 }).page;
    p = settleContainers(p);
    const mem = p.shapes.find((s) => s.lane === lanes[2])!;
    const y0 = mem.y;
    p = addLane(p, id, 0, 'Nuevo');
    const pl2 = p.shapes.find((s) => s.id === id)!;
    expect(pl2.container!.lanes).toHaveLength(4);
    expect(pl2.container!.lanes![0]!.title).toBe('Nuevo');
    const mem2 = p.shapes.find((s) => s.id === mem.id)!;
    expect(mem2.y).toBeCloseTo(y0 + 100, 3);
    expect(settleContainers(p).shapes.find((s) => s.id === mem.id)!.lane).toBe(lanes[2]);
    p = renameLane(p, id, lanes[2]!, 'Operaciones');
    expect(p.shapes.find((s) => s.id === id)!.container!.lanes!.find((l) => l.id === lanes[2])!.title).toBe('Operaciones');
    p = resizeLane(p, id, lanes[0]!, 160);
    expect(p.shapes.find((s) => s.id === id)!.container!.lanes!.find((l) => l.id === lanes[0])!.size).toBe(160);
    p = moveLane(p, id, lanes[2]!, -1);
    const order = p.shapes.find((s) => s.id === id)!.container!.lanes!.map((l) => l.id);
    expect(order.indexOf(lanes[2]!)).toBe(order.indexOf(lanes[1]!) - 1);
    expect(settleContainers(p).shapes.find((s) => s.id === mem.id)!.lane).toBe(lanes[2]);
    // removing the lane moves its members to the neighbour and shrinks the pool
    const h0 = p.shapes.find((s) => s.id === id)!.h;
    p = removeLane(p, id, lanes[2]!);
    const after = p.shapes.find((s) => s.id === id)!;
    expect(after.container!.lanes).toHaveLength(3);
    expect(after.h).toBeLessThan(h0);
    expect(p.shapes.find((s) => s.id === mem.id)!.lane).not.toBe(lanes[2]);
  });

  it('draws lane titles and survives save and load', () => {
    const { page } = pool();
    const svg = pageToSvg(page);
    expect(svg).toContain('Carril 1');
    expect(svg).toContain('rotate(-90');
    const d = updatePage(newDiagram(), newDiagram().pages[0]!.id, () => page);
    void d;
    const diagram = newDiagram();
    diagram.pages[0] = page;
    const back = parseDiagram(serializeDiagram(diagram)).diagram.pages[0]!.shapes[0]!;
    expect(back.container!.lanes).toHaveLength(3);
    expect(back.container!.dir).toBe('h');
    expect(assignMembership(parseDiagram(serializeDiagram(diagram)).diagram.pages[0]!)).toBeTruthy();
  });
});
