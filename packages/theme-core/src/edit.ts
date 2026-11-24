import { cloneFonts } from './catalog';
import { SCHEME_SLOTS, type CustomThemes, type DocTheme, type NamedColors, type NamedFonts, type ThemeColors, type ThemeFonts } from './types';

/** The same theme with another colour scheme. */
export const withColors = (t: DocTheme, colors: ThemeColors, name: string): DocTheme => ({ ...t, colors: { ...colors }, colorsName: name });
/** The same theme with other fonts. */
export const withFonts = (t: DocTheme, fonts: ThemeFonts, name: string): DocTheme => ({ ...t, fonts: cloneFonts(fonts), fontsName: name });
/** The same theme with another effect scheme. */
export const withEffects = (t: DocTheme, fmtXml: string, name: string): DocTheme => ({ ...t, fmtXml, effectsName: name });

export const sameColors = (a: ThemeColors, b: ThemeColors): boolean => SCHEME_SLOTS.every((s) => a[s].toLowerCase() === b[s].toLowerCase());
export const sameFonts = (a: ThemeFonts, b: ThemeFonts): boolean => a.major.latin === b.major.latin && a.minor.latin === b.minor.latin;

export const emptyCustom = (): CustomThemes => ({ colors: [], fonts: [], themes: [] });

const upsert = <T extends { name: string }>(list: T[], item: T): T[] => {
  const i = list.findIndex((x) => x.name.toLowerCase() === item.name.toLowerCase());
  return i >= 0 ? list.map((x, j) => (j === i ? item : x)) : [...list, item];
};

/** Saves colours the person named (one with the same name is replaced). */
export const saveColors = (c: CustomThemes, item: NamedColors): CustomThemes => ({ ...c, colors: upsert(c.colors, { name: item.name.trim() || 'Personalizado', colors: { ...item.colors } }) });
export const saveFonts = (c: CustomThemes, item: NamedFonts): CustomThemes => ({ ...c, fonts: upsert(c.fonts, { name: item.name.trim() || 'Personalizado', fonts: cloneFonts(item.fonts) }) });
export const saveTheme = (c: CustomThemes, t: DocTheme): CustomThemes => ({ ...c, themes: upsert(c.themes, { ...t, name: t.name.trim() || 'Personalizado', colors: { ...t.colors }, fonts: cloneFonts(t.fonts) }) });

export const removeCustom = (c: CustomThemes, kind: 'colors' | 'fonts' | 'themes', name: string): CustomThemes => ({ ...c, [kind]: (c[kind] as { name: string }[]).filter((x) => x.name !== name) });

const HEX = /^#[0-9a-f]{6}$/i;
const validColors = (x: unknown): x is ThemeColors => !!x && typeof x === 'object' && SCHEME_SLOTS.every((s) => typeof (x as Record<string, unknown>)[s] === 'string' && HEX.test((x as Record<string, string>)[s]!));
const validFonts = (x: unknown): x is ThemeFonts => {
  const f = x as ThemeFonts | undefined;
  return !!f && typeof f.major?.latin === 'string' && typeof f.minor?.latin === 'string';
};

/** Reads what was saved (a text); anything that is not a valid scheme or theme is left out, never an error. */
export function parseCustom(text: string | null | undefined): CustomThemes {
  const out = emptyCustom();
  if (!text) return out;
  try {
    const j = JSON.parse(text) as Partial<CustomThemes>;
    for (const c of j.colors ?? []) if (typeof c?.name === 'string' && validColors(c.colors)) out.colors.push({ name: c.name, colors: c.colors });
    for (const f of j.fonts ?? []) if (typeof f?.name === 'string' && validFonts(f.fonts)) out.fonts.push({ name: f.name, fonts: f.fonts });
    for (const t of j.themes ?? []) if (typeof t?.name === 'string' && validColors(t.colors) && validFonts(t.fonts) && typeof t.fmtXml === 'string') out.themes.push({ ...t, colorsName: t.colorsName ?? t.name, fontsName: t.fontsName ?? t.name, effectsName: t.effectsName ?? 'Office' });
  } catch {
    /* not saved by us: nothing */
  }
  return out;
}

export const stringifyCustom = (c: CustomThemes): string => JSON.stringify(c);
