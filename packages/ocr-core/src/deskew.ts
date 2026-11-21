import type { Box } from './model';

/*
 * Two repairs that real pictures need before an engine reads them: a page photographed a few degrees crooked is straightened, and the ruled lines of
 * a table (which engines take for letters, or for a reason to turn the page) are taken out. Both work on grey levels (0 black … 255 white), dark text
 * on a light page.
 */

/** Pixels that are dark enough to be ink. */
const INK = 140;

/**
 * How many degrees clockwise the lines of text are turned (0 when the page is straight or there is not enough text to tell). The page is looked at as a
 * cloud of dark points: when it is straight the rows hold the points in a few thick bands and the sums per row are very uneven; the angle that makes them
 * most uneven is the skew. Looks at ±`max` degrees.
 */
export function estimateSkew(grey: Uint8ClampedArray, w: number, h: number, max = 12): number {
  // a small copy is enough (and quick): every `step`th pixel
  const step = Math.max(1, Math.round(Math.max(w, h) / 700));
  const pts: number[] = [];
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (grey[y * w + x]! < INK) pts.push((x - w / 2) / step, (y - h / 2) / step);
  if (pts.length < 200) return 0;
  const n = pts.length / 2;
  const span = Math.ceil(Math.hypot(w, h) / step) + 2;
  const hist = new Float64Array(span);
  const score = (deg: number): number => {
    const a = (deg * Math.PI) / 180;
    const s = Math.sin(a);
    const c = Math.cos(a);
    hist.fill(0);
    for (let i = 0; i < n; i++) hist[Math.round(-pts[2 * i]! * s + pts[2 * i + 1]! * c + span / 2) | 0]!++;
    let sum = 0;
    for (let i = 0; i < span; i++) sum += hist[i]! * hist[i]!;
    return sum;
  };
  const best = (from: number, to: number, by: number): number => {
    let bd = 0;
    let bs = -1;
    for (let d = from; d <= to + 1e-9; d += by) {
      const sc = score(d);
      if (sc > bs) [bd, bs] = [d, sc];
    }
    return bd;
  };
  const straight = score(0);
  const coarse = best(-max, max, 0.5);
  const fine = best(coarse - 0.5, coarse + 0.5, 0.1);
  // a real skew makes the bands clearly thicker than they are straight; otherwise leave the page alone
  if (Math.abs(fine) < 0.8 || score(fine) < straight * 1.08) return 0;
  return Math.round(fine * 10) / 10;
}

/** Rotates the picture `deg` degrees clockwise about its centre, on a canvas big enough to hold it, filling with white. */
export function rotateGrey(grey: Uint8ClampedArray, w: number, h: number, deg: number): { grey: Uint8ClampedArray; w: number; h: number } {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const nw = Math.ceil(Math.abs(w * c) + Math.abs(h * s));
  const nh = Math.ceil(Math.abs(w * s) + Math.abs(h * c));
  const out = new Uint8ClampedArray(nw * nh).fill(255);
  for (let y = 0; y < nh; y++)
    for (let x = 0; x < nw; x++) {
      const dx = x - nw / 2;
      const dy = y - nh / 2;
      const sx = dx * c + dy * s + w / 2;
      const sy = -dx * s + dy * c + h / 2;
      if (sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1) continue;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(w - 1, x0 + 1);
      const y1 = Math.min(h - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const top = grey[y0 * w + x0]! * (1 - fx) + grey[y0 * w + x1]! * fx;
      const bot = grey[y1 * w + x0]! * (1 - fx) + grey[y1 * w + x1]! * fx;
      out[y * nw + x] = top * (1 - fy) + bot * fy;
    }
  return { grey: out, w: nw, h: nh };
}

/** A box in a picture rotated by `rotateGrey(…, deg)` (size `nw`×`nh`), back in the picture it was made from (size `w`×`h`): the box that holds its corners. */
export function unrotateBox(b: Box, deg: number, w: number, h: number, nw: number, nh: number): Box {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([x, y]) => {
    const dx = x! - nw / 2;
    const dy = y! - nh / 2;
    return [dx * c + dy * s + w / 2, -dx * s + dy * c + h / 2] as const;
  });
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * Paints white the ruled lines of a table: dark runs that are long (more than `minRun` pixels, a tenth of the picture by default) and thin (no more than
 * `maxThick` pixels), horizontal or vertical. Letters have no such runs, and a dark block (a black bar behind light letters) is thick, so it stays.
 */
export function removeRules(grey: Uint8ClampedArray, w: number, h: number, o: { minRun?: number; maxThick?: number } = {}): Uint8ClampedArray {
  const minRun = o.minRun ?? Math.max(50, Math.round(Math.max(w, h) * 0.1));
  const maxThick = o.maxThick ?? 8;
  const hm = new Uint8Array(w * h);
  const vm = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (grey[y * w + x]! >= INK) { x++; continue; }
      let e = x;
      while (e < w && grey[y * w + e]! < INK) e++;
      if (e - x >= minRun) for (let i = x; i < e; i++) hm[y * w + i] = 1;
      x = e;
    }
  }
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (grey[y * w + x]! >= INK) { y++; continue; }
      let e = y;
      while (e < h && grey[e * w + x]! < INK) e++;
      if (e - y >= minRun) for (let i = y; i < e; i++) vm[i * w + x] = 1;
      y = e;
    }
  }
  // thick runs are not lines: a block of rows (or columns) of the mask longer than `maxThick` is dropped
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!hm[y * w + x]) { y++; continue; }
      let e = y;
      while (e < h && hm[e * w + x]) e++;
      if (e - y > maxThick) for (let i = y; i < e; i++) hm[i * w + x] = 0;
      y = e;
    }
  }
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!vm[y * w + x]) { x++; continue; }
      let e = x;
      while (e < w && vm[y * w + e]) e++;
      if (e - x > maxThick) for (let i = x; i < e; i++) vm[y * w + i] = 0;
      x = e;
    }
  }
  const out = new Uint8ClampedArray(grey);
  let any = false;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!hm[y * w + x] && !vm[y * w + x]) continue;
      any = true;
      // the line and the soft edge around it
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && grey[ny * w + nx]! < 200) out[ny * w + nx] = 255;
        }
    }
  return any ? out : grey;
}
