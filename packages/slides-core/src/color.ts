import type { Clr, ClrMod, ColorMap, ColorName, SchemeSlot, Theme } from './types';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const DEFAULT_CLRMAP: ColorMap = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2', accent1: 'accent1', accent2: 'accent2', accent3: 'accent3', accent4: 'accent4', accent5: 'accent5', accent6: 'accent6', hlink: 'hlink', folHlink: 'folHlink' };

export function parseHex(hex: string): Rgba {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return { r: parseInt(full.slice(0, 2), 16) || 0, g: parseInt(full.slice(2, 4), 16) || 0, b: parseInt(full.slice(4, 6), 16) || 0, a: 1 };
}
const to2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
export const toHex = (c: Rgba): string => `#${to2(c.r)}${to2(c.g)}${to2(c.b)}`;
export const toCss = (c: Rgba): string => (c.a >= 0.999 ? toHex(c) : `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${Math.round(c.a * 1000) / 1000})`);

function rgbToHsl({ r, g, b }: Rgba): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === rr ? (gg - bb) / d + (gg < bb ? 6 : 0) : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  h /= 6;
  return [h, s, l];
}
function hslToRgb(h: number, s: number, l: number, a: number): Rgba {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255, a };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return { r: f(h + 1 / 3) * 255, g: f(h) * 255, b: f(h - 1 / 3) * 255, a };
}

const toLin = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLin = (c: number) => 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export function applyMod(c: Rgba, m: ClrMod): Rgba {
  const v = (m.v ?? 0) / 100000;
  switch (m.t) {
    case 'alpha':
      return { ...c, a: v };
    case 'alphaMod':
      return { ...c, a: c.a * v };
    case 'alphaOff':
      return { ...c, a: Math.max(0, Math.min(1, c.a + v)) };
    case 'lumMod':
    case 'lumOff':
    case 'lum':
    case 'satMod':
    case 'satOff':
    case 'sat':
    case 'hueMod':
    case 'hueOff':
    case 'hue': {
      const [h, s, l] = rgbToHsl(c);
      let nh = h;
      let ns = s;
      let nl = l;
      if (m.t === 'lumMod') nl = l * v;
      else if (m.t === 'lumOff') nl = l + v;
      else if (m.t === 'lum') nl = v;
      else if (m.t === 'satMod') ns = s * v;
      else if (m.t === 'satOff') ns = s + v;
      else if (m.t === 'sat') ns = v;
      else if (m.t === 'hueMod') nh = (h * v) % 1;
      else if (m.t === 'hueOff') nh = (((h + (m.v ?? 0) / 21600000) % 1) + 1) % 1;
      else nh = (m.v ?? 0) / 21600000;
      return hslToRgb(nh, Math.max(0, Math.min(1, ns)), Math.max(0, Math.min(1, nl)), c.a);
    }
    case 'tint': {
      // mixes with white in linear RGB
      const mix = (x: number) => fromLin(toLin(x) * v + (1 - v));
      return { r: mix(c.r), g: mix(c.g), b: mix(c.b), a: c.a };
    }
    case 'shade': {
      const mix = (x: number) => fromLin(toLin(x) * v);
      return { r: mix(c.r), g: mix(c.g), b: mix(c.b), a: c.a };
    }
    case 'comp': {
      const [h, s, l] = rgbToHsl(c);
      return hslToRgb((h + 0.5) % 1, s, l, c.a);
    }
    case 'inv':
      return { r: 255 - c.r, g: 255 - c.g, b: 255 - c.b, a: c.a };
    case 'gray': {
      const y = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
      return { r: y, g: y, b: y, a: c.a };
    }
    case 'red':
      return { ...c, r: v * 255 };
    case 'green':
      return { ...c, g: v * 255 };
    case 'blue':
      return { ...c, b: v * 255 };
    case 'redMod':
      return { ...c, r: c.r * v };
    case 'greenMod':
      return { ...c, g: c.g * v };
    case 'blueMod':
      return { ...c, b: c.b * v };
    case 'redOff':
      return { ...c, r: c.r + v * 255 };
    case 'greenOff':
      return { ...c, g: c.g + v * 255 };
    case 'blueOff':
      return { ...c, b: c.b + v * 255 };
    default:
      return c;
  }
}

export interface ColorContext {
  theme: Theme;
  clrMap?: Partial<ColorMap>;
  /** colour that `phClr` stands for */
  phClr?: Rgba;
}

export function schemeToHex(name: ColorName, ctx: ColorContext): Rgba {
  if (name === 'phClr') return ctx.phClr ?? { r: 0, g: 0, b: 0, a: 1 };
  const map = { ...DEFAULT_CLRMAP, ...ctx.clrMap } as Record<string, SchemeSlot>;
  const slot = (map[name] ?? name) as SchemeSlot;
  const hex = ctx.theme.colors[slot] ?? ctx.theme.colors[name as SchemeSlot] ?? '#000000';
  return parseHex(hex);
}

export function resolveClr(c: Clr | undefined, ctx: ColorContext): Rgba {
  let base: Rgba = c?.scheme ? schemeToHex(c.scheme, ctx) : c?.rgb ? parseHex(c.rgb) : { r: 0, g: 0, b: 0, a: 1 };
  for (const m of c?.mods ?? []) base = applyMod(base, m);
  return base;
}
export const clrCss = (c: Clr | undefined, ctx: ColorContext): string => toCss(resolveClr(c, ctx));

/** Perceived brightness 0–1, for choosing text colour over a background. */
export const luminance = (c: Rgba): number => (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;

export const rgb = (hex: string): Clr => ({ rgb: hex.startsWith('#') ? hex : `#${hex}` });
export const scheme = (name: ColorName, mods?: ClrMod[]): Clr => ({ scheme: name, ...(mods ? { mods } : {}) });
