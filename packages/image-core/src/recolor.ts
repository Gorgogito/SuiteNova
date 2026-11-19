import { clamp } from './adjust';
import { copy, type Pixels } from './pixels';

/**
 * «Recolorear» of Office. Grey scale, sepia, black and white (with a threshold) and duotone are colour maps; «washout» is not a map
 * but a brightness and contrast pair (Office writes it as `a:lum`), so the pipeline folds it into the brightness and contrast.
 */
export type Recolor = { kind: 'gray' } | { kind: 'sepia' } | { kind: 'washout' } | { kind: 'bw'; threshold: number } | { kind: 'duotone'; dark: string; light: string };

export const WASHOUT = { brightness: 70, contrast: -70 } as const;
export const SEPIA_DUOTONE = { dark: '#3a2410', light: '#fbf0d9' } as const;

export const hexRgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const luma = (d: Uint8ClampedArray, i: number) => 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;

export function grayScale(p: Pixels): Pixels {
  const out = copy(p);
  for (let i = 0; i < out.data.length; i += 4) out.data[i] = out.data[i + 1] = out.data[i + 2] = luma(out.data, i);
  return out;
}

/** Black where the brightness is under the threshold (percent), white above. */
export function blackAndWhite(p: Pixels, threshold: number): Pixels {
  const t = (clamp(threshold, 0, 100) / 100) * 255;
  const out = copy(p);
  for (let i = 0; i < out.data.length; i += 4) out.data[i] = out.data[i + 1] = out.data[i + 2] = luma(out.data, i) < t ? 0 : 255;
  return out;
}

/** The brightness of every pixel picks a colour between `dark` and `light`. */
export function duotone(p: Pixels, dark: string, light: string): Pixels {
  const a = hexRgb(dark);
  const b = hexRgb(light);
  const out = copy(p);
  for (let i = 0; i < out.data.length; i += 4) {
    const l = luma(out.data, i) / 255;
    for (let k = 0; k < 3; k++) out.data[i + k] = Math.round(a[k]! + (b[k]! - a[k]!) * l);
  }
  return out;
}

/** Applies a colour map (not the washout, which is brightness and contrast). */
export function recolor(p: Pixels, r: Recolor): Pixels {
  switch (r.kind) {
    case 'gray':
      return grayScale(p);
    case 'sepia':
      return duotone(p, SEPIA_DUOTONE.dark, SEPIA_DUOTONE.light);
    case 'bw':
      return blackAndWhite(p, r.threshold);
    case 'duotone':
      return duotone(p, r.dark, r.light);
    case 'washout':
      return copy(p);
  }
}

export interface RecolorPreset {
  id: string;
  name: string;
  recolor: Recolor | null;
}
/** The gallery of the ribbon: the first one is «no recolor». The tinted ones are made with the accent colour of the document (`accent`). */
export function recolorPresets(accent = '#4472c4'): RecolorPreset[] {
  return [
    { id: 'none', name: 'Sin recolorear', recolor: null },
    { id: 'gray', name: 'Escala de grises', recolor: { kind: 'gray' } },
    { id: 'sepia', name: 'Sepia', recolor: { kind: 'sepia' } },
    { id: 'washout', name: 'Descolorido', recolor: { kind: 'washout' } },
    { id: 'bw25', name: 'Blanco y negro: 25 %', recolor: { kind: 'bw', threshold: 25 } },
    { id: 'bw50', name: 'Blanco y negro: 50 %', recolor: { kind: 'bw', threshold: 50 } },
    { id: 'bw75', name: 'Blanco y negro: 75 %', recolor: { kind: 'bw', threshold: 75 } },
    { id: 'dark', name: 'Oscuro con el color de énfasis', recolor: { kind: 'duotone', dark: '#101010', light: accent } },
    { id: 'light', name: 'Claro con el color de énfasis', recolor: { kind: 'duotone', dark: accent, light: '#ffffff' } },
  ];
}
