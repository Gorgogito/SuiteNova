import { cropPixels, resample, type Pixels } from '@suitenova/image-core';
import { estimateSkew, removeRules, rotateGrey, unrotateBox } from './deskew';
import type { Box } from './model';

/**
 * What was done to a picture before it was read, so the boxes the engine gives (in the pixels of the prepared picture) can be put back in the
 * pixels of the original: the part cut, the turn and the scale, in that order.
 */
export interface Transform {
  /** Offset of the part read, in pixels of the original. */
  crop: { x: number; y: number };
  /** Quarter turns clockwise. */
  turns: 0 | 1 | 2 | 3;
  /** Size of the part read before turning and scaling (after straightening, when it was straightened). */
  w: number;
  h: number;
  /** The page was straightened: the degrees it was rotated (clockwise) and the size of the part before that. */
  skew?: { deg: number; w: number; h: number };
  /** Prepared pixels per pixel of the part read. */
  scale: number;
}

export interface PrepareOptions {
  /** The part to read, in pixels of the picture (all of it when missing). */
  zone?: Box;
  /** Quarter turns clockwise to give the picture. */
  turns?: 0 | 1 | 2 | 3;
  /** Letters are read best when their lines are about this tall: a picture whose text is smaller is enlarged (capped by `maxSide`). */
  maxSide?: number;
  minSide?: number;
  /** Straighten a page that is a few degrees crooked (on by default). */
  deskew?: boolean;
  /** Take out the ruled lines of tables (on by default). */
  rules?: boolean;
}

/** Grey levels (0–255) of each pixel, with the transparent ones taken as white (text on a transparent background). */
export function toGrey(p: Pixels): Uint8ClampedArray {
  const out = new Uint8ClampedArray(p.w * p.h);
  for (let i = 0, j = 0; i < p.data.length; i += 4, j++) {
    const a = p.data[i + 3]! / 255;
    const g = 0.299 * p.data[i]! + 0.587 * p.data[i + 1]! + 0.114 * p.data[i + 2]!;
    out[j] = Math.round(g * a + 255 * (1 - a));
  }
  return out;
}

/** Stretch the grey levels so the darkest 1 % goes to black and the lightest 1 % to white (a washed-out picture gets its contrast). */
export function stretchContrast(grey: Uint8ClampedArray): Uint8ClampedArray {
  const hist = new Array<number>(256).fill(0);
  for (const g of grey) hist[g]!++;
  const cut = grey.length * 0.01;
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255; lo++) {
    acc += hist[lo]!;
    if (acc > cut) break;
  }
  for (let acc = 0; hi > 0; hi--) {
    acc += hist[hi]!;
    if (acc > cut) break;
  }
  if (hi - lo < 16) return grey;
  const out = new Uint8ClampedArray(grey.length);
  for (let i = 0; i < grey.length; i++) out[i] = ((grey[i]! - lo) * 255) / (hi - lo);
  return out;
}

/** Light text on a dark background is turned into dark on light (engines read dark on light): when most of the picture is dark. */
export function invertIfDark(grey: Uint8ClampedArray): { grey: Uint8ClampedArray; inverted: boolean } {
  let sum = 0;
  for (const g of grey) sum += g;
  if (sum / Math.max(1, grey.length) >= 110) return { grey, inverted: false };
  return { grey: grey.map((g) => 255 - g) as Uint8ClampedArray, inverted: true };
}

export function rotate90(p: Pixels, turns: number): Pixels {
  const t = ((turns % 4) + 4) % 4;
  if (t === 0) return p;
  const w = t === 2 ? p.w : p.h;
  const h = t === 2 ? p.h : p.w;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const [nx, ny] = t === 1 ? [p.h - 1 - y, x] : t === 2 ? [p.w - 1 - x, p.h - 1 - y] : [y, p.w - 1 - x];
      const s = (y * p.w + x) * 4;
      const d = (ny * w + nx) * 4;
      out[d] = p.data[s]!;
      out[d + 1] = p.data[s + 1]!;
      out[d + 2] = p.data[s + 2]!;
      out[d + 3] = p.data[s + 3]!;
    }
  return { data: out, w, h };
}

const fromGrey = (grey: Uint8ClampedArray, w: number, h: number): Pixels => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < grey.length; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = grey[i]!;
    data[i * 4 + 3] = 255;
  }
  return { data, w, h };
};

/** The picture as the engine reads it: the part chosen, in grey, with its contrast stretched, dark on light, turned and scaled. */
export function prepare(p: Pixels, o: PrepareOptions = {}): { pixels: Pixels; transform: Transform } {
  const zone = o.zone ? clampBox(o.zone, p.w, p.h) : { x: 0, y: 0, w: p.w, h: p.h };
  const part = zone.w === p.w && zone.h === p.h ? p : cropPixels(p, zone);
  let { grey } = invertIfDark(stretchContrast(toGrey(part)));
  let gw = part.w;
  let gh = part.h;
  let skew: Transform['skew'];
  if (o.deskew !== false) {
    const a = estimateSkew(grey, gw, gh);
    if (a) {
      const r = rotateGrey(grey, gw, gh, -a);
      skew = { deg: -a, w: gw, h: gh };
      [grey, gw, gh] = [r.grey, r.w, r.h];
    }
  }
  if (o.rules !== false) grey = removeRules(grey, gw, gh);
  let px = fromGrey(grey, gw, gh);
  const turns = (o.turns ?? 0) as 0 | 1 | 2 | 3;
  px = rotate90(px, turns);
  // small pictures are enlarged (letters of fewer than ~20 px are misread) and huge ones reduced (they only slow it down)
  const minSide = o.minSide ?? 1200;
  const maxSide = o.maxSide ?? 3000;
  const side = Math.max(px.w, px.h);
  const scale = side < minSide ? Math.min(3, minSide / side) : side > maxSide ? maxSide / side : 1;
  if (scale !== 1) px = resample(px, Math.max(1, Math.round(px.w * scale)), Math.max(1, Math.round(px.h * scale)));
  return { pixels: px, transform: { crop: { x: zone.x, y: zone.y }, turns, w: gw, h: gh, scale, ...(skew ? { skew } : {}) } };
}

export function clampBox(b: Box, w: number, h: number): Box {
  const x = Math.max(0, Math.min(w - 1, Math.round(b.x)));
  const y = Math.max(0, Math.min(h - 1, Math.round(b.y)));
  return { x, y, w: Math.max(1, Math.min(w - x, Math.round(b.w))), h: Math.max(1, Math.min(h - y, Math.round(b.h))) };
}

/** A box in the prepared pixels, back in the pixels of the original picture. */
export function unmapBox(b: Box, t: Transform): Box {
  // undo the scale
  let x = b.x / t.scale;
  let y = b.y / t.scale;
  let w = b.w / t.scale;
  let h = b.h / t.scale;
  // undo the turn (the part read had t.w × t.h before turning)
  const corners: [number, number][] = [[x, y], [x + w, y + h]];
  const back = corners.map(([cx, cy]): [number, number] => {
    switch (t.turns) {
      case 1: return [cy, t.h - cx];
      case 2: return [t.w - cx, t.h - cy];
      case 3: return [t.w - cy, cx];
      default: return [cx, cy];
    }
  });
  x = Math.min(back[0]![0], back[1]![0]);
  y = Math.min(back[0]![1], back[1]![1]);
  w = Math.abs(back[1]![0] - back[0]![0]);
  h = Math.abs(back[1]![1] - back[0]![1]);
  if (t.skew) ({ x, y, w, h } = unrotateBox({ x, y, w, h }, t.skew.deg, t.skew.w, t.skew.h, t.w, t.h));
  return { x: Math.round((x + t.crop.x) * 10) / 10, y: Math.round((y + t.crop.y) * 10) / 10, w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10 };
}
