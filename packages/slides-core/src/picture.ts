import type { Clr, PicEl, Rect4, Xfrm } from './types';

/*
 * Picture tools. A cropped picture keeps the whole image and says which part of it shows (`srcRect`, in 1/1000 %); the frame is
 * the picture's box. Cropping moves one edge of the frame while the image stays where it is on the slide.
 */

export type CropHandle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

const R = (r?: Rect4): Rect4 => r ?? { l: 0, t: 0, r: 0, b: 0 };
const MIN = 8;

/** Size the whole (uncropped) image would have under the current frame and crop. */
export function fullImageSize(x: Xfrm, sr?: Rect4): { w: number; h: number } {
  const c = R(sr);
  const vw = Math.max(0.01, 1 - (c.l + c.r) / 100000);
  const vh = Math.max(0.01, 1 - (c.t + c.b) / 100000);
  return { w: x.w / vw, h: x.h / vh };
}

const rot = (px: number, py: number, cx: number, cy: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
};

/**
 * Drags an edge or corner of the frame by (dx, dy), given in the picture's own (unrotated, unflipped) directions.
 * The image stays put: the frame shrinks (or grows back, up to the image's edge) and the crop follows.
 */
export function cropBy(el: PicEl, x: Xfrm, handle: CropHandle, dx: number, dy: number): { xfrm: Xfrm; srcRect: Rect4 } {
  const c = R(el.srcRect);
  const img = fullImageSize(x, c);
  const fx = x.flipH ? -1 : 1;
  const fy = x.flipV ? -1 : 1;
  let { l, t, r, b } = c;
  let x1 = x.x;
  let y1 = x.y;
  let x2 = x.x + x.w;
  let y2 = x.y + x.h;
  // the handle names the edge as seen on the slide; under a flip it is the opposite side of the image
  const vis = { w: handle.includes('w'), e: handle.includes('e'), n: handle.includes('n'), s: handle.includes('s') };
  if (vis.w) {
    const room = ((fx === 1 ? l : r) / 100000) * img.w;
    const d = Math.min(Math.max(dx, -room), x.w - MIN);
    x1 += d;
    if (fx === 1) l += (d / img.w) * 100000;
    else r += (d / img.w) * 100000;
  }
  if (vis.e) {
    const d = Math.max(Math.min(dx, fx === 1 ? (r / 100000) * img.w : (l / 100000) * img.w), -(x.w - MIN));
    x2 += d;
    if (fx === 1) r -= (d / img.w) * 100000;
    else l -= (d / img.w) * 100000;
  }
  if (vis.n) {
    const d = Math.min(Math.max(dy, -(fy === 1 ? (t / 100000) * img.h : (b / 100000) * img.h)), x.h - MIN);
    y1 += d;
    if (fy === 1) t += (d / img.h) * 100000;
    else b += (d / img.h) * 100000;
  }
  if (vis.s) {
    const d = Math.max(Math.min(dy, fy === 1 ? (b / 100000) * img.h : (t / 100000) * img.h), -(y2 - y1 - MIN));
    y2 += d;
    if (fy === 1) b -= (d / img.h) * 100000;
    else t -= (d / img.h) * 100000;
  }
  const w = x2 - x1;
  const hh = y2 - y1;
  // a rotated picture keeps the image where it was: the new centre is the old one moved along the rotated axes
  const oc = { x: x.x + x.w / 2, y: x.y + x.h / 2 };
  const nc = rot((x1 + x2) / 2, (y1 + y2) / 2, oc.x, oc.y, x.rot ?? 0);
  return { xfrm: { ...x, x: nc.x - w / 2, y: nc.y - hh / 2, w, h: hh }, srcRect: { l, t, r, b } };
}

/** Moves the image inside its frame (the frame stays); limited by the image's edges. */
export function panCrop(el: PicEl, x: Xfrm, dx: number, dy: number): Rect4 {
  const c = R(el.srcRect);
  const img = fullImageSize(x, c);
  const sx = x.flipH ? -dx : dx;
  const sy = x.flipV ? -dy : dy;
  // moving the image right shows more of its left part
  const kx = Math.min(Math.max(sx, -(c.r / 100000) * img.w), (c.l / 100000) * img.w);
  const ky = Math.min(Math.max(sy, -(c.b / 100000) * img.h), (c.t / 100000) * img.h);
  return { l: c.l - (kx / img.w) * 100000, r: c.r + (kx / img.w) * 100000, t: c.t - (ky / img.h) * 100000, b: c.b + (ky / img.h) * 100000 };
}

/** Fills the frame with the image (cropping what overflows) or fits the whole image inside it (leaving bands). */
export function fitCrop(frame: { w: number; h: number }, imgW: number, imgH: number, mode: 'fill' | 'fit'): Rect4 {
  const ia = imgW / imgH;
  const fa = frame.w / frame.h;
  const wide = mode === 'fill' ? ia > fa : ia < fa;
  if (wide) {
    // too much width (fill) or too little (fit): crop or pad left and right
    const v = fa / ia;
    const e = ((1 - v) / 2) * 100000;
    return { l: e, r: e, t: 0, b: 0 };
  }
  const v = ia / fa;
  const e = ((1 - v) / 2) * 100000;
  return { l: 0, r: 0, t: e, b: e };
}

export const CROP_SHAPES: { prst: string; name: string }[] = [
  { prst: 'rect', name: 'Rectángulo' },
  { prst: 'roundRect', name: 'Rectángulo redondeado' },
  { prst: 'ellipse', name: 'Óvalo' },
  { prst: 'triangle', name: 'Triángulo' },
  { prst: 'diamond', name: 'Rombo' },
  { prst: 'hexagon', name: 'Hexágono' },
  { prst: 'octagon', name: 'Octógono' },
  { prst: 'star5', name: 'Estrella de 5 puntas' },
  { prst: 'heart', name: 'Corazón' },
  { prst: 'cloud', name: 'Nube' },
  { prst: 'snip2DiagRect', name: 'Esquinas recortadas' },
  { prst: 'plaque', name: 'Placa' },
];

type Adjust = NonNullable<PicEl['adjust']>;
const duo = (a: string, b: string): [Clr, Clr] => [{ rgb: a }, { rgb: b }];

/** Recolor choices: what `adjust` gets (the brightness/contrast/transparency set elsewhere are kept). */
export const RECOLORS: { id: string; name: string; patch: Partial<Adjust> }[] = [
  { id: 'none', name: 'Sin recolorear', patch: { gray: undefined, biLevel: undefined, duotone: undefined } },
  { id: 'gray', name: 'Escala de grises', patch: { gray: true, biLevel: undefined, duotone: undefined } },
  { id: 'bw', name: 'Blanco y negro (50 %)', patch: { gray: undefined, biLevel: 50, duotone: undefined } },
  { id: 'sepia', name: 'Sepia', patch: { gray: undefined, biLevel: undefined, duotone: duo('#3d2b1f', '#f5deb3') } },
  { id: 'blue', name: 'Azul', patch: { gray: undefined, biLevel: undefined, duotone: duo('#0b2a5b', '#cfe2ff') } },
  { id: 'green', name: 'Verde', patch: { gray: undefined, biLevel: undefined, duotone: duo('#12361f', '#d8f3dc') } },
  { id: 'red', name: 'Rojo', patch: { gray: undefined, biLevel: undefined, duotone: duo('#4a0d0d', '#ffd9d9') } },
  { id: 'violet', name: 'Violeta', patch: { gray: undefined, biLevel: undefined, duotone: duo('#2b1055', '#e6d9ff') } },
];

export function recolorOf(a: PicEl['adjust']): string {
  if (!a) return 'none';
  if (a.gray) return 'gray';
  if (a.biLevel !== undefined) return 'bw';
  if (a.duotone) return RECOLORS.find((r) => r.patch.duotone && r.patch.duotone[0].rgb === a.duotone![0].rgb)?.id ?? 'custom';
  return 'none';
}

/** `adjust` with a patch applied; empty fields are dropped, and no adjustment at all gives undefined. */
export function withAdjust(a: PicEl['adjust'], patch: Partial<Adjust>): PicEl['adjust'] {
  const out: Adjust = { ...(a ?? {}), ...patch };
  for (const k of Object.keys(out) as (keyof Adjust)[]) if (out[k] === undefined) delete out[k];
  if (out.bright === 0) delete out.bright;
  if (out.contrast === 0) delete out.contrast;
  if (out.alpha === 100) delete out.alpha;
  return Object.keys(out).length ? out : undefined;
}

export const CORRECTIONS: { name: string; bright: number; contrast: number }[] = [
  { name: 'Brillo −40 %', bright: -40, contrast: 0 },
  { name: 'Brillo −20 %', bright: -20, contrast: 0 },
  { name: 'Original', bright: 0, contrast: 0 },
  { name: 'Brillo +20 %', bright: 20, contrast: 0 },
  { name: 'Brillo +40 %', bright: 40, contrast: 0 },
  { name: 'Contraste −40 %', bright: 0, contrast: -40 },
  { name: 'Contraste +40 %', bright: 0, contrast: 40 },
  { name: 'Lavado', bright: 50, contrast: -50 },
];
