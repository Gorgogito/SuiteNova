import { describe, expect, it } from 'vitest';
import { estimateSkew, removeRules, rotateGrey, unrotateBox } from './deskew';
import { prepare, unmapBox } from './prepare';

/** A page of text-like bars (dark lines of small blocks) on white. */
function page(w: number, h: number, rows: number): Uint8ClampedArray {
  const g = new Uint8ClampedArray(w * h).fill(255);
  for (let r = 0; r < rows; r++) {
    const y0 = 20 + r * 40;
    for (let x = 20; x < w - 20; x += 14) for (let y = y0; y < y0 + 16; y++) for (let k = 0; k < 9; k++) g[y * w + x + k] = 0;
  }
  return g;
}

describe('straightening a crooked page', () => {
  it('finds how many degrees clockwise a page is turned, in both directions, and leaves a straight page alone', () => {
    const g = page(600, 300, 6);
    expect(estimateSkew(g, 600, 300)).toBe(0);
    for (const deg of [-6, -3, 2.5, 5, 9]) {
      const r = rotateGrey(g, 600, 300, deg);
      expect(Math.abs(estimateSkew(r.grey, r.w, r.h) - deg)).toBeLessThanOrEqual(0.7);
    }
  });

  it('a page with almost nothing on it is not guessed at', () => {
    const g = new Uint8ClampedArray(300 * 300).fill(255);
    for (let i = 0; i < 20; i++) g[100 * 300 + 100 + i] = 0;
    expect(estimateSkew(g, 300, 300)).toBe(0);
  });

  it('a box found in the straightened picture goes back to where it is in the crooked one', () => {
    const g = page(600, 300, 6);
    const deg = 6;
    const crooked = rotateGrey(g, 600, 300, deg);
    // straighten it again (what prepare does) and look for the block that started at (20, 20)
    const back = rotateGrey(crooked.grey, crooked.w, crooked.h, -deg);
    let first: { x: number; y: number } | null = null;
    for (let y = 0; y < back.h && !first; y++) for (let x = 0; x < back.w; x++) if (back.grey[y * back.w + x]! < 100) { first = { x, y }; break; }
    const box = unrotateBox({ x: first!.x, y: first!.y, w: 9, h: 16 }, -deg, crooked.w, crooked.h, back.w, back.h);
    // the corner of the first block in the crooked picture is near where the rotation put (20, 20)
    const a = (deg * Math.PI) / 180;
    const cx = 20 - 300;
    const cy = 20 - 150;
    const ex = cx * Math.cos(a) - cy * Math.sin(a) + crooked.w / 2;
    const ey = cx * Math.sin(a) + cy * Math.cos(a) + crooked.h / 2;
    expect(Math.abs(box.x + box.w / 2 - ex)).toBeLessThan(40);
    expect(Math.abs(box.y + box.h / 2 - ey)).toBeLessThan(40);
  });

  it('prepare straightens the page, keeps the transform to undo it, and boxes map back inside the original', () => {
    const g = page(600, 300, 6);
    const r = rotateGrey(g, 600, 300, 5);
    const data = new Uint8ClampedArray(r.w * r.h * 4);
    r.grey.forEach((v, i) => { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; });
    const { pixels, transform } = prepare({ data, w: r.w, h: r.h });
    expect(transform.skew).toBeDefined();
    expect(Math.abs(transform.skew!.deg + 5)).toBeLessThanOrEqual(0.7);
    const b = unmapBox({ x: 0, y: 0, w: pixels.w, h: pixels.h }, transform);
    // the straightened canvas is bigger than the picture (white corners), around the same centre
    expect(Math.abs(b.x + b.w / 2 - r.w / 2)).toBeLessThan(3);
    expect(Math.abs(b.y + b.h / 2 - r.h / 2)).toBeLessThan(3);
    expect(prepare({ data, w: r.w, h: r.h }, { deskew: false }).transform.skew).toBeUndefined();
  });
});

describe('taking out the ruled lines of a table', () => {
  const table = () => {
    const w = 400;
    const h = 200;
    const g = new Uint8ClampedArray(w * h).fill(255);
    for (const y of [20, 100, 180]) for (let x = 20; x < 380; x++) for (let t = 0; t < 3; t++) g[(y + t) * w + x] = 0;
    for (const x of [20, 200, 380]) for (let y = 20; y < 182; y++) for (let t = 0; t < 3; t++) g[y * w + x + t - (x === 380 ? 3 : 0)] = 0;
    // a letter-like block inside a cell, and its pixel count
    for (let y = 50; y < 70; y++) for (let x = 60; x < 75; x++) g[y * w + x] = 0;
    return { g, w, h };
  };
  it('paints the lines white and leaves the letters', () => {
    const { g, w, h } = table();
    const out = removeRules(g, w, h);
    expect(out[21 * w + 100]).toBe(255);
    expect(out[100 * w + 21]).toBe(255);
    expect(out[60 * w + 65]).toBe(0);
  });
  it('a thick dark bar (a header with light letters) is not a line and stays', () => {
    const w = 300;
    const h = 100;
    const g = new Uint8ClampedArray(w * h).fill(255);
    for (let y = 10; y < 40; y++) for (let x = 10; x < 290; x++) g[y * w + x] = 0;
    expect(removeRules(g, w, h)[20 * w + 100]).toBe(0);
  });
  it('a picture with no lines is returned as it came', () => {
    const g = new Uint8ClampedArray(200 * 100).fill(255);
    for (let x = 10; x < 20; x++) g[50 * 200 + x] = 0;
    expect(removeRules(g, 200, 100)).toBe(g);
  });
});
