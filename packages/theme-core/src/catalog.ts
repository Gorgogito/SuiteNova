import { EFFECT_SCHEMES } from './fmt';
import { OFFICE_COLORS, OFFICE_FONTS } from './office-data';
import type { DocTheme, ThemeColors, ThemeFonts } from './types';

export interface ColorScheme {
  id: string;
  name: string;
  colors: ThemeColors;
}
export interface FontScheme {
  id: string;
  name: string;
  fonts: ThemeFonts;
}

const slots = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'] as const;
const toColors = (hex: string[]): ThemeColors => Object.fromEntries(slots.map((k, i) => [k, hex[i]!])) as ThemeColors;

/** The colour schemes of Office (their values are read from the files Office installs) and Nova's «Contraste». */
export const COLOR_SCHEMES: ColorScheme[] = [
  ...OFFICE_COLORS.map(([id, name, hex]) => ({ id, name, colors: toColors(hex) })),
  { id: 'dark', name: 'Contraste', colors: toColors(['#000000', '#ffffff', '#1f2a44', '#d9e2f3', '#00a8e8', '#ff9f1c', '#2ec4b6', '#e71d36', '#9b5de5', '#fee440', '#4cc9f0', '#b5a1e5']) },
];

const idOf = (s: string) => s.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toLowerCase());

/** The font schemes of Office (headings and body) and Segoe UI. */
export const FONT_SCHEMES: FontScheme[] = [
  ...OFFICE_FONTS.map(([file, major, minor]) => ({
    id: file === 'Office 2013 - 2022' ? 'office' : idOf(file),
    name: file === 'Office 2013 - 2022' ? 'Office' : file === 'Office 2007 - 2010' ? 'Office 2007-2010' : file.replace(/-/g, ' - '),
    fonts: { major: { latin: major }, minor: { latin: minor } } as ThemeFonts,
  })),
  { id: 'segoe', name: 'Segoe UI', fonts: { major: { latin: 'Segoe UI Semibold' }, minor: { latin: 'Segoe UI' } } },
];

export { EFFECT_SCHEMES };

export const cloneFonts = (f: ThemeFonts): ThemeFonts => ({ major: { ...f.major }, minor: { ...f.minor } });

/** The theme every document starts with. */
export function officeTheme(): DocTheme {
  const c = COLOR_SCHEMES[0]!;
  const f = FONT_SCHEMES[0]!;
  const e = EFFECT_SCHEMES[0]!;
  return { name: 'Tema de Office', colors: { ...c.colors }, colorsName: c.name, fonts: cloneFonts(f.fonts), fontsName: f.name, fmtXml: e.fmtXml, effectsName: e.name };
}

/** The themes of the gallery: each colour scheme with the fonts and effects of Office (the first one is the Office theme). */
export function themeCatalog(): DocTheme[] {
  const office = officeTheme();
  return COLOR_SCHEMES.map((c, i) => (i === 0 ? office : { ...office, name: c.name, colors: { ...c.colors }, colorsName: c.name, fonts: cloneFonts(office.fonts) }));
}
