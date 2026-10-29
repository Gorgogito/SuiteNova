/** Colour resolution for SpreadsheetML: ARGB, theme + tint, and the legacy indexed palette. */

export const INDEXED_COLORS: string[] = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
];

/** Office 2013+ default theme, used when a workbook has no theme part. Order: lt1, dk1, lt2, dk2, accent1-6, hlink, folHlink. */
export const DEFAULT_THEME: string[] = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72'];

export interface ColorSpec {
  rgb?: string;
  theme?: string;
  indexed?: string;
  tint?: string;
  auto?: string;
}

function hslFromRgb(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function rgbFromHsl(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}

export function applyTint(hex: string, tint: number): string {
  if (!tint) return hex;
  const n = parseInt(hex, 16);
  const [h, s, l0] = hslFromRgb((n >> 16) & 255, (n >> 8) & 255, n & 255);
  let l = l0;
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const [r, g, b] = rgbFromHsl(h, s, Math.min(1, Math.max(0, l)));
  const to = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

/** Resolve a colour element to "#rrggbb"; undefined for "automatic". */
export function resolveColor(c: ColorSpec | undefined, theme: string[]): string | undefined {
  if (!c) return undefined;
  let hex: string | undefined;
  if (c.rgb) hex = c.rgb.slice(-6).toUpperCase();
  else if (c.theme !== undefined) hex = theme[Number(c.theme)] ?? undefined;
  else if (c.indexed !== undefined) hex = INDEXED_COLORS[Number(c.indexed)];
  if (!hex) return undefined;
  if (c.tint !== undefined) hex = applyTint(hex, Number(c.tint));
  return `#${hex.toLowerCase()}`;
}
