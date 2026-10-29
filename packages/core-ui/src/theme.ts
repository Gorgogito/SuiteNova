import {
  createDarkTheme,
  createLightTheme,
  teamsHighContrastTheme,
  type BrandVariants,
  type Theme,
} from '@fluentui/react-components';

export type ThemeMode = 'light' | 'dark' | 'contrast';
export type ThemePreference = ThemeMode | 'system';

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Build the 16-step Fluent brand ramp (10..160) from a single accent colour, which lands on step 80. */
export function brandRamp(accent: string): BrandVariants {
  const [h, s] = hexToHsl(accent);
  const lightness = [0.06, 0.1, 0.15, 0.2, 0.26, 0.32, 0.38, 0.44, 0.5, 0.56, 0.62, 0.68, 0.75, 0.82, 0.89, 0.95];
  // Anchor the accent itself at index 7 (step 80) so buttons match the module colour.
  const [, , accentL] = hexToHsl(accent);
  const ramp = lightness.map((l, i) => (i === 7 ? hslToHex(h, s, accentL) : hslToHex(h, s, l)));
  const keys = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160] as const;
  return Object.fromEntries(keys.map((k, i) => [k, ramp[i]!])) as unknown as BrandVariants;
}

export function fluentTheme(mode: ThemeMode, accent: string): Theme {
  if (mode === 'contrast') return teamsHighContrastTheme;
  const ramp = brandRamp(accent);
  return mode === 'dark' ? createDarkTheme(ramp) : createLightTheme(ramp);
}

export function resolveTheme(pref: ThemePreference, systemDark: boolean, systemContrast = false): ThemeMode {
  if (pref !== 'system') return pref;
  if (systemContrast) return 'contrast';
  return systemDark ? 'dark' : 'light';
}

/** Accent colours per module. Original palette, chosen to stay distinguishable in both themes. */
export const MODULE_ACCENTS: Record<string, string> = {
  hub: '#3a5a8c',
  writer: '#2b6cb0',
  calc: '#2f855a',
  slides: '#c05621',
  base: '#97266d',
  notes: '#6b46c1',
  mail: '#0f7fa8',
  diagram: '#4c51bf',
  plan: '#2c7a7b',
  forms: '#7a8a1f',
};
