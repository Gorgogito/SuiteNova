import { describe, expect, it } from 'vitest';
import { connectEnd, endsOf, nearestSite, rerouteConnectors, sitesOf } from './connectors';
import { newDeck } from './defaults';
import { newLine, newShape } from './factory';
import { updateElement } from './ops';
import type { ConnEl, Deck, ShapeEl, Slide, SlideElement } from './types';

const xf = (_s: Slide, e: SlideElement) => e.xfrm!;

describe('connection sites', () => {
  it('a rectangle has four, on the middle of its sides; an ellipse has eight', () => {
    const r = newShape('rect', 100, 100, 200, 100);
    expect(sitesOf(r, r.xfrm!).map((s) => [s.x, s.y])).toEqual([[200, 100], [100, 150], [200, 200], [300, 150]]);
    const e = newShape('ellipse', 0, 0, 100, 100);
    expect(sitesOf(e, e.xfrm!)).toHaveLength(8);
  });
  it('the nearest site within reach, and none out of reach', () => {
    const d = newDeck();
    const r = newShape('rect', 100, 100, 200, 100);
    d.slides[0]!.shapes.push(r);
    const near = nearestSite(d.slides[0]!, (e) => e.xfrm ?? { x: 0, y: 0, w: 1, h: 1 }, { x: 303, y: 152 }, 10);
    expect(near?.site.idx).toBe(3);
    expect(nearestSite(d.slides[0]!, (e) => e.xfrm ?? { x: 0, y: 0, w: 1, h: 1 }, { x: 400, y: 400 }, 10)).toBeNull();
    expect(nearestSite(d.slides[0]!, (e) => e.xfrm ?? { x: 0, y: 0, w: 1, h: 1 }, { x: 303, y: 152 }, 10, [r.id])).toBeNull();
  });
});

describe('connectors follow the shapes', () => {
  const setup = (): { d: Deck; a: ShapeEl; b: ShapeEl; c: ConnEl } => {
    const d = newDeck();
    const a = newShape('rect', 100, 100, 100, 60);
    const b = newShape('rect', 400, 100, 100, 60);
    const c = newLine('straightConnector1', 200, 130, 400, 130);
    d.slides[0]!.shapes.push(a, b, c);
    let n = connectEnd(d, d.slides[0]!.id, c.id, 'start', { id: a.id, idx: 3 });
    n = connectEnd(n, n.slides[0]!.id, c.id, 'end', { id: b.id, idx: 1 });
    return { d: n, a, b, c };
  };
  it('connecting records the shapes by number and gives them one', () => {
    const { d, a, b, c } = setup();
    const s = d.slides[0]!;
    const cx = s.shapes.find((e) => e.id === c.id) as ConnEl;
    expect(cx.start?.idx).toBe(3);
    expect(cx.end?.idx).toBe(1);
    expect(s.shapes.find((e) => e.id === a.id)!.srcId).toBe(cx.start!.id);
    expect(s.shapes.find((e) => e.id === b.id)!.srcId).toBe(cx.end!.id);
    expect(cx.start!.id).not.toBe(cx.end!.id);
  });
  it('moving a shape lays the connector again, and an unchanged slide returns the same deck', () => {
    const { d, b, c } = setup();
    expect(rerouteConnectors(d, d.slides[0]!.id, xf)).toBe(d);
    const moved = updateElement(d, d.slides[0]!.id, b.id, (e) => ({ ...e, xfrm: { ...e.xfrm!, x: 500, y: 300 } }) as SlideElement);
    const r = rerouteConnectors(moved, d.slides[0]!.id, xf);
    const cx = r.slides[0]!.shapes.find((e) => e.id === c.id) as ConnEl;
    const { a: p0, b: p1 } = endsOf(cx.xfrm!);
    expect([p0.x, p0.y]).toEqual([200, 130]);
    expect([p1.x, p1.y]).toEqual([500, 330]);
  });
  it('a free end stays where it is', () => {
    const { d, b, c } = setup();
    const freed = connectEnd(d, d.slides[0]!.id, c.id, 'end', null);
    const moved = updateElement(freed, d.slides[0]!.id, b.id, (e) => ({ ...e, xfrm: { ...e.xfrm!, x: 500 } }) as SlideElement);
    const cx = rerouteConnectors(moved, d.slides[0]!.id, xf).slides[0]!.shapes.find((e) => e.id === c.id) as ConnEl;
    expect(endsOf(cx.xfrm!).b.x).toBe(400);
  });
});
