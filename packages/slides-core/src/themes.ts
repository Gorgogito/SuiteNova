import { COLOR_SCHEMES as SHARED_COLORS, EFFECT_SCHEMES as SHARED_EFFECTS, FONT_SCHEMES as SHARED_FONTS, cloneFonts, officeTheme, readThemeXml, writeThemeXml, writeThmx, type DocTheme } from '@suitenova/theme-core';
import JSZip from 'jszip';
import { newDeck } from './defaults';
import { readPptx } from './pptx/read';
import { readTheme } from './pptx/themexml';
import { themeXml } from './pptx/write';
import { resizeSlide } from './ops';
import type { ColorMap, Deck, FontScheme, Layout, SchemeSlot, Theme } from './types';

/*
 * Themes: colour schemes and font pairs that can be mixed, a light/dark switch, and applying a whole template (masters, layouts and
 * themes of another presentation) to the slides of this one.
 */

type Colors = Theme['colors'];

/** The colour and font schemes are the shared ones (theme-core), the same that Writer and Calc offer. */
export const COLOR_SCHEMES: { id: string; name: string; colors: Colors }[] = SHARED_COLORS;
export const FONT_SCHEMES: { id: string; name: string; fonts: FontScheme }[] = SHARED_FONTS;

const LIGHT_MAP: Pick<ColorMap, 'bg1' | 'tx1' | 'bg2' | 'tx2'> = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
const DARK_MAP: Pick<ColorMap, 'bg1' | 'tx1' | 'bg2' | 'tx2'> = { bg1: 'dk1', tx1: 'lt1', bg2: 'dk2', tx2: 'lt2' };

/** The theme the first slide uses (through its layout and master). */
export function currentThemeId(deck: Deck, slideIndex = 0): string | undefined {
  const s = deck.slides[slideIndex];
  const l = deck.layouts.find((x) => x.id === s?.layoutId);
  const m = deck.masters.find((x) => x.id === l?.masterId) ?? deck.masters[0];
  return m?.themeId;
}

export const isDark = (deck: Deck): boolean => !!deck.masters[0] && deck.masters[0].clrMap.bg1 === 'dk1';

const mapTheme = (deck: Deck, id: string | undefined, fn: (t: Theme) => Theme): Deck => ({ ...deck, themes: deck.themes.map((t) => (t.id === id ? fn(t) : t)) });

export const setThemeColors = (deck: Deck, themeId: string | undefined, colors: Colors): Deck => mapTheme(deck, themeId, (t) => ({ ...t, colors: { ...colors } }));
export const setThemeFonts = (deck: Deck, themeId: string | undefined, fonts: FontScheme): Deck => mapTheme(deck, themeId, (t) => ({ ...t, fonts: { ...fonts } }));

/** Light or dark variant: swaps which scheme colours are "background" and "text" in every master. */
export function setDarkVariant(deck: Deck, dark: boolean): Deck {
  const map = dark ? DARK_MAP : LIGHT_MAP;
  return { ...deck, masters: deck.masters.map((m) => ({ ...m, clrMap: { ...m.clrMap, ...map } as ColorMap })) };
}

export type TemplateMode = 'theme' | 'template';

/**
 * Applies another presentation (a template or theme file) to this one. `theme` copies colours, fonts and the format scheme of its
 * first theme; `template` replaces masters, layouts and themes and moves each slide to the layout with the same name (or type).
 */
export function applyTemplate(deck: Deck, tpl: Deck, mode: TemplateMode = 'template'): Deck {
  const tTheme = tpl.themes[0];
  if (!tTheme) return deck;
  if (mode === 'theme') {
    const id = currentThemeId(deck);
    return mapTheme(deck, id, (t) => ({ ...t, name: tTheme.name, colors: { ...tTheme.colors }, fonts: { ...tTheme.fonts }, fmt: tTheme.fmt }));
  }
  if (!tpl.masters.length || !tpl.layouts.length) return deck;
  const pick = (cur: Layout | undefined): string => {
    const byName = cur && tpl.layouts.find((l) => l.name === cur.name);
    const byType = cur?.type && tpl.layouts.find((l) => l.type === cur.type);
    const fallback = tpl.layouts.find((l) => l.type === 'obj') ?? tpl.layouts[0]!;
    return (byName || byType || fallback).id;
  };
  let out: Deck = {
    ...deck,
    themes: tpl.themes,
    masters: tpl.masters,
    layouts: tpl.layouts,
    assets: { ...deck.assets, ...tpl.assets },
    slides: deck.slides.map((s) => ({ ...s, layoutId: pick(deck.layouts.find((l) => l.id === s.layoutId)), bg: s.bg })),
    defaultText: tpl.defaultText ?? deck.defaultText,
    tableStyles: tpl.tableStyles ?? deck.tableStyles,
    defaultTableStyle: tpl.defaultTableStyle ?? deck.defaultTableStyle,
  };
  if (tpl.size.w !== deck.size.w || tpl.size.h !== deck.size.h) out = resizeSlide(out, tpl.size.w, tpl.size.h, 'fit', tpl.size.type);
  return out;
}

export const schemeSlots = (c: Colors): SchemeSlot[] => ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].filter((k) => k in c) as SchemeSlot[];

/**
 * Reads a template or theme file: .potx/.pptx/.ppsx are presentations; .thmx holds only a theme, which is wrapped in a new deck so
 * that it can be applied like any other.
 */
export async function readTemplateFile(data: Uint8Array): Promise<{ deck: Deck; themeOnly: boolean }> {
  const zip = await JSZip.loadAsync(data);
  if (zip.file(/^ppt\/presentation\.xml$/i).length) return { deck: (await readPptx(data)).deck, themeOnly: false };
  const f = zip.file(/^theme\/theme\/theme\d*\.xml$/i)[0];
  if (!f) throw new Error('El archivo no contiene un tema reconocible.');
  const deck = newDeck();
  const base = deck.themes[0]!;
  const t = readTheme(await f.async('string'), base.id);
  return { deck: { ...deck, themes: [{ ...t, id: base.id }] }, themeOnly: true };
}

// ------------------------------------------------------------------------------------------------ shared themes (theme-core)

const NO_CTX = { image: () => undefined, link: () => undefined };

/** The theme as the common `DocTheme` (colours, fonts and the raw format scheme), for the shared gallery and for `.thmx` files. */
export const themeToDoc = (t: Theme): DocTheme => readThemeXml(themeXml(t, NO_CTX));

/** The `.thmx` file of a theme. */
export const exportThmx = (t: Theme): Promise<Uint8Array> => writeThmx(themeToDoc(t));

/** Slides' own format scheme (fills, lines, effects) of a shared effect scheme. */
export function fmtFromXml(fmtXml: string, id: string): Theme['fmt'] {
  return readTheme(writeThemeXml({ ...officeTheme(), fmtXml }), id).fmt;
}

export const setThemeEffects = (deck: Deck, themeId: string | undefined, fmtXml: string): Deck => mapTheme(deck, themeId, (t) => ({ ...t, fmt: fmtFromXml(fmtXml, t.id) }));

/** JSON with the keys in order, to compare two format schemes whatever the order in which they were built. */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => p.localeCompare(q))) : x));

/** Which shared effect scheme the theme has (by what it draws, not by name), or undefined. */
export function currentEffectsId(t: Theme | undefined): string | undefined {
  if (!t) return undefined;
  const mine = canon(t.fmt);
  return SHARED_EFFECTS.find((e) => canon(fmtFromXml(e.fmtXml, t.id)) === mine)?.id;
}

/** Applies a whole shared theme (colours, fonts and effects) to the theme of the deck. */
export const applyDocTheme = (deck: Deck, themeId: string | undefined, doc: DocTheme): Deck =>
  mapTheme(deck, themeId, (t) => ({ ...t, name: doc.name, colors: { ...doc.colors }, fonts: cloneFonts(doc.fonts), fmt: fmtFromXml(doc.fmtXml, t.id) }));
