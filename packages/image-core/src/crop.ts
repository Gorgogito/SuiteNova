/*
 * Cropping a picture. As in DrawingML (`a:srcRect`) a crop says how much is cut from each side, in thousandths of a percent of the whole
 * image (100000 = all of it). The image itself is never changed: the part that shows is the rest.
 */

export interface Crop {
  l: number;
  t: number;
  r: number;
  b: number;
}
export const NO_CROP: Crop = { l: 0, t: 0, r: 0, b: 0 };
export const isCropped = (c?: Crop | null): boolean => !!c && (c.l !== 0 || c.t !== 0 || c.r !== 0 || c.b !== 0);
/** The least that can be left showing in each direction: 1 %. */
const MIN_VISIBLE = 1000;

/** A crop that is valid: no negative cut (a negative one in a file would add a margin, which is not supported) and 1 % at least left in each direction. */
export function clampCrop(c: Crop): Crop {
  let { l, t, r, b } = c;
  l = Math.max(0, l);
  t = Math.max(0, t);
  r = Math.max(0, r);
  b = Math.max(0, b);
  if (l + r > 100000 - MIN_VISIBLE) {
    const k = (100000 - MIN_VISIBLE) / (l + r);
    l *= k;
    r *= k;
  }
  if (t + b > 100000 - MIN_VISIBLE) {
    const k = (100000 - MIN_VISIBLE) / (t + b);
    t *= k;
    b *= k;
  }
  return { l: Math.round(l), t: Math.round(t), r: Math.round(r), b: Math.round(b) };
}

/** The part of an image of `w` × `h` pixels that shows. */
export function visibleRect(w: number, h: number, c: Crop = NO_CROP): { x: number; y: number; w: number; h: number } {
  const x = (w * c.l) / 100000;
  const y = (h * c.t) / 100000;
  return { x, y, w: w * (1 - (c.l + c.r) / 100000), h: h * (1 - (c.t + c.b) / 100000) };
}

/** The crop that leaves exactly that rectangle (in pixels of the image) showing. */
export function cropFromRect(w: number, h: number, rect: { x: number; y: number; w: number; h: number }): Crop {
  return clampCrop({ l: (rect.x / w) * 100000, t: (rect.y / h) * 100000, r: ((w - rect.x - rect.w) / w) * 100000, b: ((h - rect.y - rect.h) / h) * 100000 });
}

export interface AspectRatio {
  id: string;
  name: string;
  w: number;
  h: number;
}
/** The ratios of «Relación de aspecto» in Office. */
export const ASPECT_RATIOS: AspectRatio[] = [
  { id: '1:1', name: 'Cuadrado 1:1', w: 1, h: 1 },
  { id: '2:3', name: 'Vertical 2:3', w: 2, h: 3 },
  { id: '3:4', name: 'Vertical 3:4', w: 3, h: 4 },
  { id: '3:5', name: 'Vertical 3:5', w: 3, h: 5 },
  { id: '4:5', name: 'Vertical 4:5', w: 4, h: 5 },
  { id: '3:2', name: 'Horizontal 3:2', w: 3, h: 2 },
  { id: '4:3', name: 'Horizontal 4:3', w: 4, h: 3 },
  { id: '5:3', name: 'Horizontal 5:3', w: 5, h: 3 },
  { id: '5:4', name: 'Horizontal 5:4', w: 5, h: 4 },
  { id: '16:9', name: 'Horizontal 16:9', w: 16, h: 9 },
  { id: '16:10', name: 'Horizontal 16:10', w: 16, h: 10 },
];

/** The largest rectangle of that ratio inside what shows now, centred in it. The image and the ratio are `w`/`h` and `ratio` (width ÷ height). */
export function cropToAspect(w: number, h: number, current: Crop, ratio: number): Crop {
  const v = visibleRect(w, h, current);
  let nw = v.w;
  let nh = nw / ratio;
  if (nh > v.h) {
    nh = v.h;
    nw = nh * ratio;
  }
  return cropFromRect(w, h, { x: v.x + (v.w - nw) / 2, y: v.y + (v.h - nh) / 2, w: nw, h: nh });
}

/** «Relleno»: the picture fills the whole frame; what does not fit is cropped, centred. The frame is `fw` × `fh`. */
export function fillCrop(w: number, h: number, fw: number, fh: number): Crop {
  return cropToAspect(w, h, NO_CROP, fw / fh);
}

/** «Ajustar»: the whole picture inside the frame (no crop); the size it takes, keeping the proportion. */
export function fitSize(w: number, h: number, fw: number, fh: number): { w: number; h: number } {
  const k = Math.min(fw / w, fh / h);
  return { w: w * k, h: h * k };
}

/**
 * The frame of a picture (`fw` × `fh`) when the crop changes from `from` to `to` and the image must stay where it is: the frame
 * loses or gains what was cut at each side, so its size follows the part that shows.
 */
export function frameForCrop(fw: number, fh: number, from: Crop, to: Crop): { w: number; h: number; dx: number; dy: number } {
  const vf = 1 - (from.l + from.r) / 100000;
  const vt = 1 - (to.l + to.r) / 100000;
  const hf = 1 - (from.t + from.b) / 100000;
  const ht = 1 - (to.t + to.b) / 100000;
  const full = { w: fw / vf, h: fh / hf };
  return { w: full.w * vt, h: full.h * ht, dx: (full.w * (to.l - from.l)) / 100000, dy: (full.h * (to.t - from.t)) / 100000 };
}
