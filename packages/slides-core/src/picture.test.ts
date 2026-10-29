import { describe, expect, it } from 'vitest';
import { cropBy, fitCrop, fullImageSize, panCrop, withAdjust } from './picture';
import type { PicEl, Xfrm } from './types';

const pic = (srcRect?: PicEl['srcRect']): PicEl => ({ kind: 'pic', id: 'p', src: 'a', xfrm: { x: 100, y: 50, w: 200, h: 100 }, ...(srcRect ? { srcRect } : {}) });

describe('picture crop', () => {
  it('cropping an edge keeps the image where it is on the slide', () => {
    const el = pic();
    const x = el.xfrm as Xfrm;
    const r = cropBy(el, x, 'w', 50, 0);
    expect(r.xfrm.x).toBe(150);
    expect(r.xfrm.w).toBe(150);
    expect(r.srcRect.l).toBeCloseTo(25000);
    // the whole image keeps its size
    const a = fullImageSize(r.xfrm, r.srcRect);
    expect(a.w).toBeCloseTo(200);
    // growing back is limited by the image
    const back = cropBy({ ...el, srcRect: r.srcRect }, r.xfrm, 'w', -500, 0);
    expect(back.srcRect.l).toBeCloseTo(0);
    expect(back.xfrm.x).toBeCloseTo(100);
  });
  it('corners crop two edges; a rotated picture does not jump', () => {
    const el = pic();
    const r = cropBy(el, { ...(el.xfrm as Xfrm), rot: 90 }, 'se', -50, -20);
    expect(r.srcRect.r).toBeCloseTo(25000);
    expect(r.srcRect.b).toBeCloseTo(20000);
    // the top-left corner of the image is still at the same place on the slide
    const c0 = { x: 200, y: 100 };
    const c1 = { x: r.xfrm.x + r.xfrm.w / 2, y: r.xfrm.y + r.xfrm.h / 2 };
    expect(Math.hypot(c1.x - c0.x, c1.y - c0.y)).toBeGreaterThan(1);
  });
  it('panning moves the image inside the frame, within its edges', () => {
    const el = pic({ l: 10000, t: 0, r: 10000, b: 0 });
    const x = el.xfrm as Xfrm;
    const p = panCrop(el, x, 1000, 0);
    expect(p.l).toBeCloseTo(0);
    expect(p.r).toBeCloseTo(20000);
    expect(p.t).toBe(0);
  });
  it('fill crops the overflow, fit pads', () => {
    const f = fitCrop({ w: 200, h: 100 }, 400, 100, 'fill');
    expect(f.l).toBeCloseTo(25000);
    expect(f.t).toBe(0);
    const t = fitCrop({ w: 200, h: 100 }, 400, 100, 'fit');
    expect(t.t).toBeLessThan(0);
    expect(t.l).toBe(0);
  });
  it('adjustments drop their defaults', () => {
    expect(withAdjust(undefined, { bright: 0 })).toBeUndefined();
    expect(withAdjust({ gray: true }, { bright: 20 })).toEqual({ gray: true, bright: 20 });
  });
});
