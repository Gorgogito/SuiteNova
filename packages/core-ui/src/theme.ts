import {
  createDarkTheme,
  createLightTheme,
  teamsHighContrastTheme,
  type BrandVariants,
  type Theme,
} from '@fluentui/react-components';

/**
 * Application themes, as in Office (Colorful, Dark Gray, Black, White, Use system setting). This is the look of the
 * program, not the document theme. Colours measured on Office 2024 LTSC: docs/office-temas/MEDIDAS.md.
 */
export type ThemePreference = 'system' | 'colorful' | 'darkgray' | 'black' | 'white';
/** What is actually shown. High contrast is never chosen: it follows Windows. */
export type ThemeMode = Exclude<ThemePreference, 'system'> | 'contrast';

/** In the order Office lists them. */
export const THEME_PREFERENCES: readonly ThemePreference[] = ['colorful', 'darkgray', 'black', 'white', 'system'];

/** Values saved by earlier versions. «light» showed the coloured title bar, so it becomes Colorful. */
const LEGACY: Record<string, ThemePreference> = { light: 'colorful', dark: 'black', contrast: 'system' };

export function normalizeThemePreference(value: unknown): ThemePreference {
  if (typeof value !== 'string') return 'system';
  if ((THEME_PREFERENCES as readonly string[]).includes(value)) return value as ThemePreference;
  return Object.prototype.hasOwnProperty.call(LEGACY, value) ? LEGACY[value]! : 'system';
}

export function resolveTheme(pref: ThemePreference, systemDark: boolean, systemContrast = false): ThemeMode {
  if (systemContrast) return 'contrast';
  if (pref !== 'system') return pref;
  return systemDark ? 'black' : 'white';
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb: number[]): string {
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** `amount` of `other` mixed into `hex` (0 keeps `hex`, 1 gives `other`). */
function mix(hex: string, other: string, amount: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(other);
  return rgbToHex(a.map((v, i) => v + (b[i]! - v) * amount));
}

function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
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
  return rgbToHex([r, g, b].map((v) => (v + m) * 255));
}

/** Build the 16-step Fluent brand ramp (10..160) from a single accent colour, which lands on step 80. */
export function brandRamp(accent: string): BrandVariants {
  const [h, s, accentL] = hexToHsl(accent);
  const lightness = [0.06, 0.1, 0.15, 0.2, 0.26, 0.32, 0.38, 0.44, 0.5, 0.56, 0.62, 0.68, 0.75, 0.82, 0.89, 0.95];
  // Anchor the accent itself at index 7 (step 80) so buttons match the module colour.
  const ramp = lightness.map((l, i) => (i === 7 ? hslToHex(h, s, accentL) : hslToHex(h, s, l)));
  const keys = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160] as const;
  return Object.fromEntries(keys.map((k, i) => [k, ramp[i]!])) as unknown as BrandVariants;
}

/**
 * Accent colour per module. Writer, Calc, Slides, Notes and Base use the colours measured on Word, Excel, PowerPoint,
 * OneNote and Access. The rest are our own: Outlook was not measured, and Visio and Project showed the same blue and
 * green as Word and Excel.
 */
export const MODULE_ACCENTS: Record<string, string> = {
  hub: '#3a5a8c',
  writer: '#185abd',
  calc: '#107c41',
  slides: '#c43e1c',
  base: '#a4373a',
  notes: '#7719aa',
  mail: '#0f7fa8',
  diagram: '#4c51bf',
  plan: '#2c7a7b',
  forms: '#6b7a1b',
};

type DarkMode = 'light' | 'darkgray' | 'black';

/** Underline of the active tab, as measured on Office. Other modules derive theirs from their accent. */
const MEASURED_TAB_LINE: Record<string, Record<DarkMode, string>> = {
  writer: { light: '#1651aa', darkgray: '#aec6f0', black: '#82abf1' },
  calc: { light: '#0f703b', darkgray: '#a0d8b9', black: '#60bd82' },
  slides: { light: '#b13719', darkgray: '#edbcb0', black: '#e1966d' },
};

function tabLine(appId: string, accent: string, shade: DarkMode): string {
  const measured = MEASURED_TAB_LINE[appId]?.[shade];
  if (measured) return measured;
  const [h, s, l] = hexToHsl(accent);
  const lift = { light: -0.04, darkgray: 0.38, black: 0.27 }[shade];
  return hslToHex(h, s, Math.min(0.88, Math.max(0, l + lift)));
}

/** Search box on the coloured title bar, as measured; other modules get the same 80 % tint of their accent. */
const MEASURED_SEARCH: Record<string, string> = { writer: '#d0dcee', calc: '#cfe2d8', slides: '#efd7d1' };

/** Colours of each zone of the window, published as `--nv-*` CSS variables. */
export interface ZoneColors {
  'nv-accent': string;
  'nv-titlebar-bg': string;
  'nv-titlebar-fg': string;
  'nv-search-bg': string;
  'nv-search-fg': string;
  'nv-tabs-bg': string;
  'nv-tabs-fg': string;
  'nv-tab-line': string;
  'nv-separator': string;
  'nv-status-bg': string;
  'nv-status-fg': string;
  /** Area around a page or a slide. */
  'nv-canvas-bg': string;
}

export function zoneColors(appId: string, mode: ThemeMode): ZoneColors {
  const accent = MODULE_ACCENTS[appId] ?? MODULE_ACCENTS.hub!;
  const light = {
    'nv-accent': accent,
    'nv-tabs-bg': '#e6e6e6',
    'nv-tabs-fg': '#242424',
    'nv-tab-line': tabLine(appId, accent, 'light'),
    'nv-separator': '#d1d1d1',
    'nv-status-bg': '#f5f5f5',
    'nv-status-fg': '#242424',
    'nv-canvas-bg': '#ececec',
  };
  switch (mode) {
    case 'colorful':
      return {
        ...light,
        'nv-titlebar-bg': accent,
        'nv-titlebar-fg': '#ffffff',
        'nv-search-bg': MEASURED_SEARCH[appId] ?? mix(accent, '#ffffff', 0.8),
        'nv-search-fg': mix(accent, '#000000', 0.25),
      };
    case 'white':
      return { ...light, 'nv-titlebar-bg': '#e6e6e6', 'nv-titlebar-fg': '#242424', 'nv-search-bg': '#fafafa', 'nv-search-fg': '#616161' };
    case 'darkgray':
      return {
        'nv-accent': accent,
        'nv-titlebar-bg': '#525252',
        'nv-titlebar-fg': '#ffffff',
        'nv-search-bg': '#bdbdbd',
        'nv-search-fg': '#424242',
        'nv-tabs-bg': '#525252',
        'nv-tabs-fg': '#ffffff',
        'nv-tab-line': tabLine(appId, accent, 'darkgray'),
        'nv-separator': '#858585',
        'nv-status-bg': '#525252',
        'nv-status-fg': '#ffffff',
        'nv-canvas-bg': '#555555',
      };
    case 'black':
      return {
        'nv-accent': accent,
        'nv-titlebar-bg': '#1a1a1a',
        'nv-titlebar-fg': '#ffffff',
        'nv-search-bg': '#1f1f1f',
        'nv-search-fg': '#adadad',
        'nv-tabs-bg': '#1a1a1a',
        'nv-tabs-fg': '#ffffff',
        'nv-tab-line': tabLine(appId, accent, 'black'),
        'nv-separator': '#666666',
        'nv-status-bg': '#141414',
        'nv-status-fg': '#ffffff',
        'nv-canvas-bg': '#1c1c1c',
      };
    case 'contrast':
      return {
        'nv-accent': accent,
        'nv-titlebar-bg': '#000000',
        'nv-titlebar-fg': '#ffffff',
        'nv-search-bg': '#000000',
        'nv-search-fg': '#ffffff',
        'nv-tabs-bg': '#000000',
        'nv-tabs-fg': '#ffffff',
        'nv-tab-line': '#ffff00',
        'nv-separator': '#ffffff',
        'nv-status-bg': '#000000',
        'nv-status-fg': '#ffffff',
        'nv-canvas-bg': '#000000',
      };
  }
}

/**
 * Dark Gray keeps a light ribbon and light menus under a dark frame, so it starts from the light theme with darker
 * neutrals. Ribbon and menu surface, hover, texts, separators and selected buttons are measured. Office shows panels,
 * dialogs and the File view dark in this theme (MEDIDAS.md); that is not applied here yet.
 */
const DARK_GRAY: Partial<Theme> = {
  colorNeutralBackground1: '#bdbdbd',
  colorNeutralBackground1Hover: '#d1d1d1',
  colorNeutralBackground1Pressed: '#a8a8a8',
  colorNeutralBackground1Selected: '#cccccc',
  colorNeutralBackground2: '#b3b3b3',
  colorNeutralBackground2Hover: '#cccccc',
  colorNeutralBackground3: '#ababab',
  colorNeutralBackground3Hover: '#c2c2c2',
  colorSubtleBackgroundHover: '#d1d1d1',
  colorSubtleBackgroundPressed: '#a8a8a8',
  colorSubtleBackgroundSelected: '#cccccc',
  colorNeutralForeground1: '#242424',
  colorNeutralForeground2: '#242424',
  colorNeutralForeground3: '#333333',
  colorNeutralForegroundDisabled: '#858585',
  colorNeutralStroke1: '#666666',
  colorNeutralStroke2: '#858585',
  colorNeutralStroke3: '#999999',
  colorNeutralStrokeAccessible: '#4d4d4d',
};

/** The Fluent theme of a window plus our zone colours, so menus and dialogs (mounted outside the frame) get them too. */
export function fluentTheme(mode: ThemeMode, appId: string): Theme & ZoneColors {
  const zones = zoneColors(appId, mode);
  if (mode === 'contrast') return { ...teamsHighContrastTheme, ...zones };
  const ramp = brandRamp(zones['nv-accent']);
  if (mode === 'black') return { ...createDarkTheme(ramp), ...zones };
  const base = createLightTheme(ramp);
  return mode === 'darkgray' ? { ...base, ...DARK_GRAY, colorBrandForeground1: ramp[50], ...zones } : { ...base, ...zones };
}
