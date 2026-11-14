import { mapDoc } from './text';
import { setDarkVariant } from './themes';
import { updateSlide } from './ops';
import type { Clr, Deck, Fill, RunProps, SlideElement } from './types';

/*
 * Design tab operations: the twelve background styles (light, tinted, dark and darker; each solid, soft gradient or strong gradient) and
 * "Reset slide" (placeholders go back to the position and format of their layout).
 */

export interface BgStyle {
  id: number;
  name: string;
  dark: boolean;
  fill: Fill;
}

const base = (second: boolean): Clr => ({ scheme: second ? 'bg2' : 'bg1' });
const shade = (c: Clr, lumMod: number): Clr => ({ ...c, mods: [{ t: 'lumMod', v: lumMod }] });
/** lighter: for dark backgrounds, where darkening black would change nothing */
const tint = (c: Clr, off: number): Clr => ({ ...c, mods: [{ t: 'lumMod', v: 100000 - off }, { t: 'lumOff', v: off }] });
const grad = (a: Clr, b: Clr): Fill => ({ t: 'grad', stops: [{ pos: 0, c: a }, { pos: 100000, c: b }], lin: { ang: 5400000, scaled: false } });

/** Style n (1-12): column = light, tinted, dark, darker; row = solid, soft gradient, strong gradient. */
export const BG_STYLES: BgStyle[] = Array.from({ length: 12 }, (_x, i) => {
  const col = i % 4;
  const row = Math.floor(i / 4);
  const dark = col >= 2;
  const b = base(col === 1 || col === 3);
  const fill: Fill = row === 0 ? { t: 'solid', c: b } : row === 1 ? grad(b, dark ? tint(b, 18000) : shade(b, 93000)) : dark ? grad(tint(b, 8000), tint(b, 35000)) : grad(b, shade(b, 75000));
  return { id: i + 1, name: `Estilo ${i + 1}`, dark, fill };
});

/** Sets the background of every master (what PowerPoint's "Background styles" do) and the light or dark colour map. */
export function applyBackgroundStyle(deck: Deck, id: number): Deck {
  const s = BG_STYLES.find((x) => x.id === id);
  if (!s) return deck;
  const d = setDarkVariant(deck, s.dark);
  return { ...d, masters: d.masters.map((m) => ({ ...m, bg: { fill: s.fill } })) };
}

/** Which style the first master uses, or 0. */
export function currentBackgroundStyle(deck: Deck): number {
  const m = deck.masters[0];
  if (!m || !m.bg || !('fill' in m.bg)) return 0;
  const dark = m.clrMap.bg1 === 'dk1';
  const j = JSON.stringify(m.bg.fill);
  return BG_STYLES.find((s) => s.dark === dark && JSON.stringify(s.fill) === j)?.id ?? 0;
}

/** Placeholders of the slide go back to the position, size and format of the layout; other objects stay as they are. */
export function resetSlide(deck: Deck, slideId: string): Deck {
  const keepLink = (r: RunProps): RunProps => (r.hlink ? { hlink: r.hlink } : {});
  return updateSlide(deck, slideId, (s) => ({
    ...s,
    shapes: s.shapes.map((e): SlideElement => {
      if (e.kind !== 'shape' || !e.ph) return e;
      const { xfrm: _x, fill: _f, ln: _l, effects: _e, ...rest } = e;
      void _x;
      void _f;
      void _l;
      void _e;
      return { ...rest, ...(e.text ? { text: { body: {}, doc: mapDoc(e.text.doc, () => ({ lvl: 0, p: {}, end: {} }), keepLink) } } : {}) };
    }),
  }));
}
