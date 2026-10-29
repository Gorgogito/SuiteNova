import JSZip from 'jszip';
import { newDeck } from './defaults';
import { readPptx } from './pptx/read';
import { readTheme } from './pptx/themexml';
import { resizeSlide } from './ops';
import type { ColorMap, Deck, FontScheme, Layout, SchemeSlot, Theme } from './types';

/*
 * Themes: colour schemes and font pairs that can be mixed, a light/dark switch, and applying a whole template (masters, layouts and
 * themes of another presentation) to the slides of this one.
 */

type Colors = Theme['colors'];
const mk = (dk2: string, lt2: string, a: [string, string, string, string, string, string], hl = '#0563c1', fh = '#954f72', dk1 = '#000000', lt1 = '#ffffff'): Colors => ({
  dk1, lt1, dk2, lt2, accent1: a[0], accent2: a[1], accent3: a[2], accent4: a[3], accent5: a[4], accent6: a[5], hlink: hl, folHlink: fh,
});

export const COLOR_SCHEMES: { id: string; name: string; colors: Colors }[] = [
  { id: 'office', name: 'Office', colors: mk('#44546a', '#e7e6e6', ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47']) },
  { id: 'office2007', name: 'Office 2007', colors: mk('#1f497d', '#eeece1', ['#4f81bd', '#c0504d', '#9bbb59', '#8064a2', '#4bacc6', '#f79646'], '#0000ff', '#800080') },
  { id: 'gray', name: 'Escala de grises', colors: mk('#636363', '#dddddd', ['#dddddd', '#b2b2b2', '#969696', '#808080', '#5f5f5f', '#4d4d4d'], '#6b9f25', '#b26b02') },
  { id: 'blue', name: 'Azul', colors: mk('#17406d', '#dbeff9', ['#0f6fc6', '#009dd9', '#0bd0d9', '#10cf9b', '#7cca62', '#a5c249'], '#f49100', '#85dfd0') },
  { id: 'blueWarm', name: 'Azul cálido', colors: mk('#242852', '#acccea', ['#4a66ac', '#629dd1', '#297fd5', '#7f8fa9', '#5aa2ae', '#9d90a0'], '#9454c3', '#3eba2b') },
  { id: 'green', name: 'Verde', colors: mk('#455f51', '#e3ded1', ['#549e39', '#8ab833', '#c0cf3a', '#029676', '#4ab5c4', '#0989b1'], '#6b9f25', '#ba6906') },
  { id: 'orange', name: 'Naranja', colors: mk('#637052', '#ccddea', ['#e48312', '#bd582c', '#865640', '#9b8357', '#c2bc80', '#94a088'], '#2998e3', '#8c8c8c') },
  { id: 'violet', name: 'Violeta', colors: mk('#632e62', '#eaebde', ['#92278f', '#9b57d3', '#755dd9', '#665eb8', '#45a5ed', '#5982db'], '#ff8119', '#baa7b0') },
  { id: 'red', name: 'Rojo', colors: mk('#505046', '#eeece1', ['#a5300f', '#d55816', '#e19825', '#b19c7d', '#7f5f52', '#b27d49'], '#cc9900', '#96a9a9') },
  { id: 'dark', name: 'Contraste', colors: mk('#1f2a44', '#d9e2f3', ['#00a8e8', '#ff9f1c', '#2ec4b6', '#e71d36', '#9b5de5', '#fee440'], '#4cc9f0', '#b5a1e5') },
];

export const FONT_SCHEMES: { id: string; name: string; fonts: FontScheme }[] = [
  { id: 'office', name: 'Office', fonts: { major: { latin: 'Calibri Light' }, minor: { latin: 'Calibri' } } },
  { id: 'office2007', name: 'Office 2007', fonts: { major: { latin: 'Calibri' }, minor: { latin: 'Cambria' } } },
  { id: 'arial', name: 'Arial', fonts: { major: { latin: 'Arial' }, minor: { latin: 'Arial' } } },
  { id: 'georgia', name: 'Georgia y Verdana', fonts: { major: { latin: 'Georgia' }, minor: { latin: 'Verdana' } } },
  { id: 'trebuchet', name: 'Trebuchet', fonts: { major: { latin: 'Trebuchet MS' }, minor: { latin: 'Trebuchet MS' } } },
  { id: 'times', name: 'Times New Roman', fonts: { major: { latin: 'Times New Roman' }, minor: { latin: 'Times New Roman' } } },
  { id: 'segoe', name: 'Segoe UI', fonts: { major: { latin: 'Segoe UI Semibold' }, minor: { latin: 'Segoe UI' } } },
];

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
