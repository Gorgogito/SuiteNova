import { boxBlur, copy, type Pixels } from './pixels';

/*
 * Corrections and colour of a picture on raw RGBA pixels (as in a canvas ImageData). The values are the ones of Office's «Formato de imagen»:
 * brightness, contrast and sharpness from −100 to 100, saturation in percent (0–400, 100 = as it is), colour temperature in kelvin (1500–11500,
 * 6500 = as it is) and transparency in percent (0–100). Every function returns a new picture.
 */

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const byte = (v: number): number => clamp(Math.round(v), 0, 255);

/**
 * Brightness adds, contrast stretches around the middle grey (−100 flattens everything, 100 is a very hard contrast). Checked against PowerPoint
 * (`a:lum`): each alone matches to one level; together, PowerPoint moves the brightness by the average of 1 and the stretch (f), not by 1.
 */
export function brightnessContrast(p: Pixels, brightness: number, contrast: number): Pixels {
  const out = copy(p);
  const b = clamp(brightness, -100, 100) / 100;
  const c = clamp(contrast, -100, 99) / 100;
  const f = c >= 0 ? 1 / (1 - c) : 1 + c;
  for (let i = 0; i < out.data.length; i += 4)
    for (let k = 0; k < 3; k++) out.data[i + k] = byte(((out.data[i + k]! / 255 - 0.5) * f + 0.5 + (b * (1 + f)) / 2) * 255);
  return out;
}

/** Positive: sharpens (unsharp mask). Negative: softens toward a blurred copy. */
export function sharpness(p: Pixels, amount: number): Pixels {
  const a = clamp(amount, -100, 100) / 100;
  if (a === 0) return copy(p);
  const small = Math.min(p.w, p.h);
  const blur = boxBlur(p, a > 0 ? Math.max(1, Math.round(small / 300)) : Math.max(1, Math.round(small / 150)));
  const out = copy(p);
  for (let i = 0; i < out.data.length; i += 4)
    for (let k = 0; k < 3; k++) {
      const v = p.data[i + k]!;
      const bl = blur.data[i + k]!;
      out.data[i + k] = byte(a > 0 ? v + a * 2 * (v - bl) : v + -a * (bl - v));
    }
  return out;
}

/** 0 % is grey, 100 % is as it is, 400 % is very saturated. */
export function saturation(p: Pixels, percent: number): Pixels {
  const s = clamp(percent, 0, 400) / 100;
  const out = copy(p);
  for (let i = 0; i < out.data.length; i += 4) {
    const l = 0.299 * out.data[i]! + 0.587 * out.data[i + 1]! + 0.114 * out.data[i + 2]!;
    for (let k = 0; k < 3; k++) out.data[i + k] = byte(l + (out.data[i + k]! - l) * s);
  }
  return out;
}

export const NEUTRAL_TEMPERATURE = 6500;
/** Lower is cooler (bluer) and higher is warmer (more orange), as in Office. */
export function temperature(p: Pixels, kelvin: number): Pixels {
  const t = clamp((kelvin - NEUTRAL_TEMPERATURE) / 5000, -1, 1);
  const out = copy(p);
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = byte(out.data[i]! * (1 + 0.3 * t));
    out.data[i + 1] = byte(out.data[i + 1]! * (1 + 0.04 * t));
    out.data[i + 2] = byte(out.data[i + 2]! * (1 - 0.3 * t));
  }
  return out;
}

/** The picture becomes see-through by that percent (the alpha it already has is kept proportionally). */
export function transparency(p: Pixels, percent: number): Pixels {
  const k = 1 - clamp(percent, 0, 100) / 100;
  const out = copy(p);
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = byte(out.data[i]! * k);
  return out;
}
