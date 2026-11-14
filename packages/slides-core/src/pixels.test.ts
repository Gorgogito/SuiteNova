import { describe, expect, it } from 'vitest';
import { ARTISTIC, backgroundColour, boxBlur, grain, mosaic, pencilSketch, posterize, removeBackground, type Pixels } from './pixels';

const img = (w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): Pixels => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4);
  return { data, w, h };
};
const px = (p: Pixels, x: number, y: number) => [...p.data.slice((y * p.w + x) * 4, (y * p.w + x) * 4 + 4)];

// white background with a red square in the middle that has a white dot inside
const subject = img(40, 40, (x, y) => {
  if (x >= 12 && x < 28 && y >= 12 && y < 28) return x === 20 && y === 20 ? [255, 255, 255, 255] : [200, 30, 30, 255];
  return [255, 255, 255, 255];
});

describe('background removal', () => {
  it('finds the background colour from the corners', () => {
    expect(backgroundColour(subject)).toEqual([255, 255, 255]);
    const mixed = img(40, 40, (x, y) => (x < 20 && y < 20 ? [255, 0, 0, 255] : x >= 20 && y < 20 ? [0, 255, 0, 255] : x < 20 ? [0, 0, 255, 255] : [255, 255, 0, 255]));
    expect(backgroundColour(mixed)).toBeNull();
  });
  it('clears the outside but keeps the subject, and a white dot inside it', () => {
    const { pixels, removed } = removeBackground(subject, 30);
    expect(px(pixels, 0, 0)[3]).toBe(0);
    expect(px(pixels, 39, 39)[3]).toBe(0);
    expect(px(pixels, 15, 15)[3]).toBe(255);
    expect(px(pixels, 20, 20)[3]).toBe(255); // enclosed: not reachable from the border
    expect(removed).toBe(40 * 40 - 16 * 16);
  });
  it('does nothing when there is no clear background', () => {
    const noise = grain(img(30, 30, () => [128, 128, 128, 255]), 120, 3);
    const r = removeBackground(noise, 5);
    expect(r.removed).toBeLessThan(30 * 30);
  });
});

describe('artistic effects', () => {
  it('blur keeps a flat image flat and softens an edge', () => {
    const flat = img(10, 10, () => [100, 100, 100, 255]);
    expect(px(boxBlur(flat, 2), 5, 5)).toEqual([100, 100, 100, 255]);
    const edge = img(20, 4, (x) => (x < 10 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const b = boxBlur(edge, 3);
    expect(px(b, 10, 1)[0]).toBeGreaterThan(0);
    expect(px(b, 10, 1)[0]).toBeLessThan(255);
  });
  it('mosaic makes every block one colour', () => {
    const m = mosaic(img(8, 8, (x) => (x % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255])), 4);
    expect(px(m, 0, 0)).toEqual(px(m, 3, 3));
  });
  it('posterize cuts the colours to few steps', () => {
    const p = posterize(img(4, 1, (x) => [x * 60, 0, 0, 255]), 2);
    expect(new Set([0, 1, 2, 3].map((x) => px(p, x, 0)[0])).size).toBeLessThanOrEqual(2);
  });
  it('sketch is grey and every effect keeps the size', () => {
    const s = pencilSketch(subject, 2);
    expect(px(s, 15, 15)[0]).toBe(px(s, 15, 15)[1]);
    for (const fx of ARTISTIC) {
      const r = fx.run(subject);
      expect([r.w, r.h, r.data.length]).toEqual([40, 40, 6400]);
    }
  });
});
