import { copy, type Pixels } from './pixels';
import { visibleRect, type Crop } from './crop';

/** A new picture of `w` × `h` pixels: a box average when it shrinks and a bilinear blend when it grows. */
export function resample(p: Pixels, w: number, h: number): Pixels {
  const nw = Math.max(1, Math.round(w));
  const nh = Math.max(1, Math.round(h));
  if (nw === p.w && nh === p.h) return copy(p);
  const out: Pixels = { data: new Uint8ClampedArray(nw * nh * 4), w: nw, h: nh };
  const sx = p.w / nw;
  const sy = p.h / nh;
  for (let y = 0; y < nh; y++)
    for (let x = 0; x < nw; x++) {
      const o = (y * nw + x) * 4;
      if (sx > 1 || sy > 1) {
        // average of the source pixels that fall in this one (weighted by alpha so transparent pixels do not darken the edge)
        const x0 = Math.floor(x * sx);
        const x1 = Math.max(x0 + 1, Math.min(p.w, Math.ceil((x + 1) * sx)));
        const y0 = Math.floor(y * sy);
        const y1 = Math.max(y0 + 1, Math.min(p.h, Math.ceil((y + 1) * sy)));
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let n = 0;
        for (let yy = y0; yy < y1; yy++)
          for (let xx = x0; xx < x1; xx++) {
            const i = (yy * p.w + xx) * 4;
            const al = p.data[i + 3]!;
            r += p.data[i]! * al;
            g += p.data[i + 1]! * al;
            b += p.data[i + 2]! * al;
            a += al;
            n++;
          }
        out.data[o + 3] = a / n;
        out.data[o] = a ? r / a : 0;
        out.data[o + 1] = a ? g / a : 0;
        out.data[o + 2] = a ? b / a : 0;
      } else {
        const fx = Math.min(p.w - 1, Math.max(0, (x + 0.5) * sx - 0.5));
        const fy = Math.min(p.h - 1, Math.max(0, (y + 0.5) * sy - 0.5));
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const x1 = Math.min(p.w - 1, x0 + 1);
        const y1 = Math.min(p.h - 1, y0 + 1);
        const tx = fx - x0;
        const ty = fy - y0;
        for (let c = 0; c < 4; c++) {
          const v00 = p.data[(y0 * p.w + x0) * 4 + c]!;
          const v10 = p.data[(y0 * p.w + x1) * 4 + c]!;
          const v01 = p.data[(y1 * p.w + x0) * 4 + c]!;
          const v11 = p.data[(y1 * p.w + x1) * 4 + c]!;
          out.data[o + c] = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
        }
      }
    }
  return out;
}

/** The part of the picture that is inside the rectangle (in pixels, rounded to whole ones). */
export function cropPixels(p: Pixels, rect: { x: number; y: number; w: number; h: number }): Pixels {
  const x0 = Math.max(0, Math.round(rect.x));
  const y0 = Math.max(0, Math.round(rect.y));
  const w = Math.max(1, Math.min(p.w - x0, Math.round(rect.w)));
  const h = Math.max(1, Math.min(p.h - y0, Math.round(rect.h)));
  const out: Pixels = { data: new Uint8ClampedArray(w * h * 4), w, h };
  for (let y = 0; y < h; y++) out.data.set(p.data.subarray(((y0 + y) * p.w + x0) * 4, ((y0 + y) * p.w + x0 + w) * 4), y * w * 4);
  return out;
}

/** «Comprimir imágenes» of Office: the resolutions it offers, in pixels per inch. */
export const COMPRESS_TARGETS = [
  { id: 'hd', name: 'Alta fidelidad (330 ppp)', ppi: 330 },
  { id: 'print', name: 'Impresión (220 ppp)', ppi: 220 },
  { id: 'web', name: 'Web y pantalla (150 ppp)', ppi: 150 },
  { id: 'email', name: 'Correo electrónico (96 ppp)', ppi: 96 },
] as const;

export interface CompressPlan {
  /** Nothing to do (the picture is not larger than asked for and there is nothing cropped to delete). */
  skip: boolean;
  /** The part of the image to keep, in its pixels. */
  keep: { x: number; y: number; w: number; h: number };
  /** The size the kept part becomes. */
  size: { w: number; h: number };
  /** The crop the picture has afterwards (none when the cropped areas were deleted). */
  crop: Crop;
}

/**
 * What compressing a picture does. `frame` is the size it has on the page in inches (what shows, after the crop): the image keeps as many
 * pixels per inch as asked and never gets more (a picture is never enlarged). `deleteCropped` throws away what the crop hides.
 */
export function planCompress(img: { w: number; h: number }, crop: Crop, frame: { w: number; h: number }, ppi: number, deleteCropped: boolean): CompressPlan {
  const vis = visibleRect(img.w, img.h, crop);
  const cropped = vis.w < img.w - 0.5 || vis.h < img.h - 0.5;
  const keepAll = !deleteCropped || !cropped;
  const scale = Math.min(1, (frame.w * ppi) / vis.w, (frame.h * ppi) / vis.h);
  const keep = keepAll ? { x: 0, y: 0, w: img.w, h: img.h } : vis;
  const size = { w: Math.max(1, Math.round(keep.w * scale)), h: Math.max(1, Math.round(keep.h * scale)) };
  const skip = scale >= 1 && keepAll;
  return { skip, keep, size, crop: keepAll ? crop : { l: 0, t: 0, r: 0, b: 0 } };
}
