import { MAP_TO_SLOT, themeColor, tintColor, type MapSlot } from './color';
import type { SchemeSlot, ThemeColors } from './types';

/*
 * A colour that points at the theme instead of being a fixed value: «Accent 1, darker 25 %». It is what Word writes as
 * `w:themeColor="accent1" w:themeShade="BF"`; the colour it stands for changes when the theme does.
 */

/** A slot of the scheme (`accent1`, `dk2`…) or one of the four that go through the colour map (`tx1`, `bg1`, `tx2`, `bg2`). */
export type RefSlot = SchemeSlot | MapSlot;

export interface ColorRef {
  slot: RefSlot;
  /** `-1…1`: darker (negative) or lighter (positive), as Excel's `TintAndShade`. Absent or 0 = the colour itself. */
  tint?: number;
}

/** The names Word uses in `w:themeColor`. */
const WORD_NAMES: Record<string, RefSlot> = {
  dark1: 'dk1',
  light1: 'lt1',
  dark2: 'dk2',
  light2: 'lt2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hyperlink: 'hlink',
  followedHyperlink: 'folHlink',
  text1: 'tx1',
  background1: 'bg1',
  text2: 'tx2',
  background2: 'bg2',
};
const TO_WORD: Record<string, string> = Object.fromEntries(Object.entries(WORD_NAMES).map(([w, s]) => [s, w]));

/** Word keeps the tint as a byte (`BF`, `33`), so the colour it draws is the one of the rounded value, not of the exact fraction. */
const byteOf = (v: number): number => Math.max(0, Math.min(255, Math.floor(v * 255 + 1e-6)));
export const quantizeTint = (t: number): number => (t < 0 ? byteOf(1 + t) / 255 - 1 : 1 - byteOf(1 - t) / 255);

/** The colour a reference stands for in a theme. */
export function resolveRef(theme: { colors: ThemeColors }, ref: ColorRef): string {
  const base = themeColor(theme, ref.slot);
  return ref.tint ? tintColor(base, quantizeTint(ref.tint)) : base;
}

/** Word's attributes for a reference: `{ themeColor, themeTint? | themeShade? }` (the last two are hexadecimal bytes). */
export function refToWord(ref: ColorRef): { themeColor: string; themeTint?: string; themeShade?: string } {
  const out: { themeColor: string; themeTint?: string; themeShade?: string } = { themeColor: TO_WORD[ref.slot] ?? 'accent1' };
  const t = ref.tint ?? 0;
  const byte = (v: number) => byteOf(v).toString(16).toUpperCase().padStart(2, '0');
  // Word keeps the share of the colour that stays: a shade of 75 % is `BF`, a tint of 20 % (lighter 80 %) is `33`
  if (t < 0) out.themeShade = byte(1 + t);
  else if (t > 0) out.themeTint = byte(1 - t);
  return out;
}

/** The reference of Word's attributes, or undefined when the name is not a theme colour. */
export function refFromWord(themeColorName: string | undefined, themeTint?: string, themeShade?: string): ColorRef | undefined {
  const slot = themeColorName ? WORD_NAMES[themeColorName] : undefined;
  if (!slot) return undefined;
  const num = (h: string | undefined) => (h && /^[0-9a-f]{1,2}$/i.test(h) ? parseInt(h, 16) / 255 : undefined);
  const tint = num(themeTint);
  const shade = num(themeShade);
  if (shade !== undefined && shade < 1) return { slot, tint: shade - 1 };
  if (tint !== undefined && tint < 1) return { slot, tint: 1 - tint };
  return { slot };
}

export const refsEqual = (a: ColorRef | undefined | null, b: ColorRef | undefined | null): boolean => !!a && !!b && a.slot === b.slot && Math.abs((a.tint ?? 0) - (b.tint ?? 0)) < 0.005;

export { MAP_TO_SLOT };
