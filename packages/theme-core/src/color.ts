import type { DocTheme, SchemeSlot, ThemeColors } from './types';

export type Rgb = [number, number, number];

export function parseHex(c: string): Rgb {
  const h = c.replace('#', '');
  const f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.padEnd(6, '0');
  return [parseInt(f.slice(0, 2), 16) || 0, parseInt(f.slice(2, 4), 16) || 0, parseInt(f.slice(4, 6), 16) || 0];
}

export const toHex = ([r, g, b]: Rgb): string => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** Hue 0-360, saturation and lightness 0-1 (the HLS of Office). */
export function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb([h, s, l]: [number, number, number]): Rgb {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    const x = ((t % 1) + 1) % 1;
    return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p;
  };
  const k = h / 360;
  return [f(k + 1 / 3) * 255, f(k) * 255, f(k - 1 / 3) * 255];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Excel's «tint and shade»: from -1 (darker, to black) to +1 (lighter, to white). This is the «Lighter 40 %» / «Darker 25 %» of the colour gallery. */
export function tintColor(color: string, tint: number): string {
  const [h, s, l] = rgbToHsl(parseHex(color));
  const nl = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  return toHex(hslToRgb([h, s, clamp01(nl)]));
}

/** DrawingML `lumMod` and `lumOff` (as fractions: 0.4 and 0.6 are `lumMod 40000` and `lumOff 60000`) and `satMod`. */
export function modColor(color: string, m: { lumMod?: number; lumOff?: number; satMod?: number }): string {
  const [h, s, l] = rgbToHsl(parseHex(color));
  const nl = clamp01(l * (m.lumMod ?? 1) + (m.lumOff ?? 0));
  const ns = clamp01(s * (m.satMod ?? 1));
  return toHex(hslToRgb([h, ns, nl]));
}

/** The four names of the document's colour map: background and text, light and dark. */
export type MapSlot = 'bg1' | 'tx1' | 'bg2' | 'tx2';
export const MAP_TO_SLOT: Record<MapSlot, SchemeSlot> = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };

/** The colour of a slot of the theme (`bg1`, `tx1`, `bg2` and `tx2` are read through the usual colour map). */
export function themeColor(theme: { colors: ThemeColors }, slot: SchemeSlot | MapSlot): string {
  return theme.colors[(MAP_TO_SLOT as Record<string, SchemeSlot>)[slot] ?? (slot as SchemeSlot)];
}

/** The tints of one column of Office's colour gallery, top to bottom (after the colour itself). */
export const GALLERY_TINTS: Record<'bg1' | 'tx1' | 'bg2' | 'tx2' | 'accent', number[]> = {
  bg1: [-0.05, -0.15, -0.25, -0.35, -0.5],
  tx1: [0.5, 0.35, 0.25, 0.15, 0.05],
  bg2: [-0.1, -0.25, -0.5, -0.75, -0.9],
  tx2: [0.8, 0.6, 0.4, -0.25, -0.5],
  accent: [0.8, 0.6, 0.4, -0.25, -0.5],
};

export interface GalleryColumn {
  slot: MapSlot | SchemeSlot;
  /** Name in the colour menu: «Fondo 1», «Texto 1», «Énfasis 3». */
  label: string;
  /** The colour and its five variants. */
  colors: string[];
}

const COLUMNS: { slot: MapSlot | SchemeSlot; label: string; kind: keyof typeof GALLERY_TINTS }[] = [
  { slot: 'bg1', label: 'Fondo 1', kind: 'bg1' },
  { slot: 'tx1', label: 'Texto 1', kind: 'tx1' },
  { slot: 'bg2', label: 'Fondo 2', kind: 'bg2' },
  { slot: 'tx2', label: 'Texto 2', kind: 'tx2' },
  ...(['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const).map((s, i) => ({ slot: s, label: `Énfasis ${i + 1}`, kind: 'accent' as const })),
];

/** The «Theme colors» of the colour menu: ten columns of six (the colour and five variants), as Word, Excel and PowerPoint show them. */
export function themeGallery(theme: { colors: ThemeColors }): GalleryColumn[] {
  return COLUMNS.map((c) => {
    const base = themeColor(theme, c.slot);
    return { slot: c.slot, label: c.label, colors: [base, ...GALLERY_TINTS[c.kind].map((t) => tintColor(base, t))] };
  });
}

/** A palette in the shape the tables, charts and shapes use: the six accents and the dark and light colours. */
export function paletteOf(theme: Pick<DocTheme, 'colors'>): { accents: string[]; dark: string; light: string; dk2: string; lt2: string; hlink: string; folHlink: string } {
  const c = theme.colors;
  return { accents: [c.accent1, c.accent2, c.accent3, c.accent4, c.accent5, c.accent6], dark: c.dk1, light: c.lt1, dk2: c.dk2, lt2: c.lt2, hlink: c.hlink, folHlink: c.folHlink };
}
