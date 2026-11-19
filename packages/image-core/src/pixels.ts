/*
 * Picture effects on raw RGBA pixels (as in a canvas ImageData): background removal and artistic effects. They work on a copy and
 * return the new pixels; nothing here touches the DOM, so they can be tested without a browser.
 */

export interface Pixels {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

export const copy = (p: Pixels): Pixels => ({ data: new Uint8ClampedArray(p.data), w: p.w, h: p.h });

/** A point of the picture in pixels. */
export interface Pt {
  x: number;
  y: number;
}
/** The areas the user marked: «keep» stays even if it looks like the background, «remove» goes even if it does not touch the border. */
export interface BackgroundMarks {
  keep?: Pt[];
  remove?: Pt[];
}

// ------------------------------------------------------------------------------------------------ background removal

const dist = (d: Uint8ClampedArray, i: number, r: number, g: number, b: number) => Math.hypot(d[i]! - r, d[i + 1]! - g, d[i + 2]! - b);

/** The colour most of the corner areas share (the likely background), or null when the corners disagree. */
export function backgroundColour(p: Pixels): [number, number, number] | null {
  const k = Math.max(2, Math.min(8, Math.floor(Math.min(p.w, p.h) / 20)));
  const samples: [number, number, number][] = [];
  for (const [x0, y0] of [[0, 0], [p.w - k, 0], [0, p.h - k], [p.w - k, p.h - k]] as const) {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = y0; y < y0 + k; y++)
      for (let x = x0; x < x0 + k; x++) {
        const i = (y * p.w + x) * 4;
        if (p.data[i + 3]! < 10) continue;
        r += p.data[i]!;
        g += p.data[i + 1]!;
        b += p.data[i + 2]!;
        n++;
      }
    if (n) samples.push([r / n, g / n, b / n]);
  }
  if (samples.length < 2) return null;
  // the sample that agrees with most others
  let best: [number, number, number] | null = null;
  let votes = 0;
  for (const s of samples) {
    const v = samples.filter((o) => Math.hypot(o[0] - s[0], o[1] - s[1], o[2] - s[2]) < 40).length;
    if (v > votes) ((votes = v), (best = s));
  }
  return votes >= 2 ? best : null;
}

/**
 * Makes transparent the area that touches the border and is close in colour to the background (a flood fill, so the same colour inside
 * the subject stays). `tolerance` is the colour distance (0–255·√3); the edge is softened over a few pixels.
 */
export function removeBackground(p: Pixels, tolerance: number, bg?: [number, number, number] | null, marks?: BackgroundMarks): { pixels: Pixels; removed: number } {
  const out = copy(p);
  const { w, h } = p;
  const inside = (pt: Pt) => pt.x >= 0 && pt.y >= 0 && pt.x < w && pt.y < h;
  /** The area around a point whose colour stays within the tolerance of the colour at the point. */
  const region = (pt: Pt): Uint8Array => {
    const mark = new Uint8Array(w * h);
    const x0 = Math.floor(pt.x);
    const y0 = Math.floor(pt.y);
    const c = (y0 * w + x0) * 4;
    const col = [p.data[c]!, p.data[c + 1]!, p.data[c + 2]!] as const;
    const st: number[] = [y0 * w + x0];
    mark[y0 * w + x0] = 1;
    while (st.length) {
      const k = st.pop()!;
      const x = k % w;
      const y = (k - x) / w;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (mark[n] || dist(p.data, n * 4, col[0], col[1], col[2]) > tolerance) continue;
        mark[n] = 1;
        st.push(n);
      }
    }
    return mark;
  };
  const keep = new Uint8Array(w * h);
  for (const pt of marks?.keep ?? []) if (inside(pt)) region(pt).forEach((v, k) => v && (keep[k] = 1));
  const col = bg ?? backgroundColour(p);
  const extra: Uint8Array[] = (marks?.remove ?? []).filter(inside).map(region);
  if (!col && !extra.length) return { pixels: out, removed: 0 };
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const k = y * w + x;
    if (x < 0 || y < 0 || x >= w || y >= h || seen[k] || keep[k]) return;
    if (p.data[k * 4 + 3]! > 10 && dist(p.data, k * 4, col![0], col![1], col![2]) > tolerance) return;
    seen[k] = 1;
    stack.push(k);
  };
  if (col) {
    for (let x = 0; x < w; x++) (push(x, 0), push(x, h - 1));
    for (let y = 0; y < h; y++) (push(0, y), push(w - 1, y));
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % w;
      const y = (k - x) / w;
      push(x + 1, y);
      push(x - 1, y);
      push(x, y + 1);
      push(x, y - 1);
    }
  }
  for (const m of extra) m.forEach((v, k) => v && !keep[k] && (seen[k] = 1));
  let removed = 0;
  for (let k = 0; k < w * h; k++) if (seen[k]) ((out.data[k * 4 + 3] = 0), removed++);
  // soften: pixels next to removed ones fade by how far they are from the background colour
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (seen[k]) continue;
      const near = (x > 0 && seen[k - 1]) || (x < w - 1 && seen[k + 1]) || (y > 0 && seen[k - w]) || (y < h - 1 && seen[k + w]);
      if (!near) continue;
      const d = col ? dist(p.data, k * 4, col[0], col[1], col[2]) : tolerance * 2;
      out.data[k * 4 + 3] = Math.round(p.data[k * 4 + 3]! * Math.min(1, Math.max(0.15, (d - tolerance * 0.5) / (tolerance * 1.5 + 1))));
    }
  return { pixels: out, removed };
}

// ------------------------------------------------------------------------------------------------ artistic effects

/** Box blur (two passes of a running average per axis). */
export function boxBlur(p: Pixels, radius: number): Pixels {
  const r = Math.max(0, Math.round(radius));
  if (!r) return copy(p);
  let src = copy(p);
  for (let pass = 0; pass < 2; pass++) {
    for (const horizontal of [true, false]) {
      const dst = copy(src);
      const len = horizontal ? p.w : p.h;
      const lines = horizontal ? p.h : p.w;
      for (let l = 0; l < lines; l++) {
        const at = (i: number) => (horizontal ? (l * p.w + i) * 4 : (i * p.w + l) * 4);
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          let n = 0;
          for (let i = -r; i <= r; i++) {
            const j = Math.min(len - 1, Math.max(0, i));
            sum += src.data[at(j) + c]!;
            n++;
          }
          for (let i = 0; i < len; i++) {
            dst.data[at(i) + c] = sum / n;
            const out = Math.min(len - 1, Math.max(0, i - r));
            const inn = Math.min(len - 1, Math.max(0, i + r + 1));
            sum += src.data[at(inn) + c]! - src.data[at(out) + c]!;
          }
        }
      }
      src = dst;
    }
  }
  return src;
}

/** Mosaic: every block of `size` pixels takes its average colour. */
export function mosaic(p: Pixels, size: number): Pixels {
  const s = Math.max(2, Math.round(size));
  const out = copy(p);
  for (let by = 0; by < p.h; by += s)
    for (let bx = 0; bx < p.w; bx += s) {
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let y = by; y < Math.min(p.h, by + s); y++)
        for (let x = bx; x < Math.min(p.w, bx + s); x++) {
          const i = (y * p.w + x) * 4;
          for (let c = 0; c < 4; c++) acc[c]! += p.data[i + c]!;
          n++;
        }
      for (let y = by; y < Math.min(p.h, by + s); y++)
        for (let x = bx; x < Math.min(p.w, bx + s); x++) {
          const i = (y * p.w + x) * 4;
          for (let c = 0; c < 4; c++) out.data[i + c] = acc[c]! / n;
        }
    }
  return out;
}

/** Fewer colours: each channel is cut to `levels` steps. */
export function posterize(p: Pixels, levels: number): Pixels {
  const out = copy(p);
  const l = Math.max(2, Math.round(levels));
  for (let i = 0; i < out.data.length; i += 4)
    for (let c = 0; c < 3; c++) out.data[i + c] = Math.round((Math.round((out.data[i + c]! / 255) * (l - 1)) / (l - 1)) * 255);
  return out;
}

/** Pencil sketch: grey, inverted and blurred, blended with the grey one by colour dodge. */
export function pencilSketch(p: Pixels, radius = 4): Pixels {
  const gray = copy(p);
  for (let i = 0; i < gray.data.length; i += 4) {
    const v = 0.299 * gray.data[i]! + 0.587 * gray.data[i + 1]! + 0.114 * gray.data[i + 2]!;
    gray.data[i] = gray.data[i + 1] = gray.data[i + 2] = v;
  }
  const inv = copy(gray);
  for (let i = 0; i < inv.data.length; i += 4) for (let c = 0; c < 3; c++) inv.data[i + c] = 255 - inv.data[i + c]!;
  const blur = boxBlur(inv, radius);
  const out = copy(gray);
  for (let i = 0; i < out.data.length; i += 4) {
    const v = gray.data[i]!;
    const b = blur.data[i]!;
    const d = b >= 255 ? 255 : Math.min(255, (v * 255) / (255 - b));
    out.data[i] = out.data[i + 1] = out.data[i + 2] = d;
  }
  return out;
}

/** Film grain: noise from a seeded generator so the result is repeatable. */
export function grain(p: Pixels, amount = 40, seed = 7): Pixels {
  const out = copy(p);
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 2;
  for (let i = 0; i < out.data.length; i += 4) {
    const n = rnd() * amount;
    for (let c = 0; c < 3; c++) out.data[i + c] = out.data[i + c]! + n;
  }
  return out;
}

/** Soft focus: the blurred picture over the sharp one. */
export function glow(p: Pixels, radius = 6): Pixels {
  const blur = boxBlur(p, radius);
  const out = copy(p);
  for (let i = 0; i < out.data.length; i += 4) for (let c = 0; c < 3; c++) out.data[i + c] = 255 - ((255 - out.data[i + c]!) * (255 - blur.data[i + c]!)) / 255;
  return out;
}

export interface Artistic {
  id: string;
  name: string;
  run: (p: Pixels) => Pixels;
}

/** Effects offered in the ribbon. `scale` makes radii proportional to the size of the picture. */
export const ARTISTIC: Artistic[] = [
  { id: 'blur', name: 'Desenfoque', run: (p) => boxBlur(p, Math.max(2, Math.round(Math.min(p.w, p.h) / 60))) },
  { id: 'mosaic', name: 'Mosaico', run: (p) => mosaic(p, Math.max(4, Math.round(Math.min(p.w, p.h) / 40))) },
  { id: 'sketch', name: 'Boceto a lápiz', run: (p) => pencilSketch(p, Math.max(2, Math.round(Math.min(p.w, p.h) / 150))) },
  { id: 'posterize', name: 'Carteles (pocos colores)', run: (p) => posterize(p, 4) },
  { id: 'grain', name: 'Grano de película', run: (p) => grain(p, 50) },
  { id: 'glow', name: 'Enfoque suave', run: (p) => glow(p, Math.max(3, Math.round(Math.min(p.w, p.h) / 80))) },
];
