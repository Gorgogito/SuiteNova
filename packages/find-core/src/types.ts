/*
 * Search and replace shared by the products. A product gives its texts as «units» (a paragraph, a cell, a shape…) and this package finds what
 * the person typed in them, in the way Office does: plain text, Word's wildcards, Excel's wildcards, or a regular expression.
 *
 * In the text of a unit: «\n» is a paragraph mark (^p), «\v» (U+000B) a line break (^l), «\t» a tab, «\f» a page break (^m).
 */

/** How the text typed in «Find what» is read. */
export type FindMode =
  /** Plain text with the special characters of Word (`^p`, `^t`, `^#`…); `?` and `*` are just those characters. */
  | 'normal'
  /** Word's wildcards (`?`, `*`, `[a-z]`, `[!a]`, `<`, `>`, `{n,m}`, `@`, `(…)` with `\1`) plus the special characters. */
  | 'wildcards'
  /** Excel's wildcards: `?` any character, `*` any text, `~` takes the next one literally. */
  | 'excel'
  /** A JavaScript regular expression. */
  | 'regex';

export interface FindOptions {
  mode: FindMode;
  matchCase: boolean;
  /** The match must be a whole word (ignored with wildcards, as in Word). */
  wholeWord: boolean;
  /** «e» finds «é», «ñ» finds «n». */
  ignoreAccents: boolean;
  /** The match must be the whole text of the unit (Excel's «Match entire cell contents»). */
  wholeUnit: boolean;
}

export const DEFAULT_FIND: FindOptions = { mode: 'normal', matchCase: false, wholeWord: false, ignoreAccents: false, wholeUnit: false };

/** A piece of text where to look: `id` is the product's own handle for it (a position, a cell address, a shape id…). */
export interface Unit<I = number> {
  id: I;
  text: string;
}

export interface Match {
  /** Offsets in the text of the unit (UTF-16, like JavaScript strings). */
  start: number;
  end: number;
  /** What was found, as it is written in the unit. */
  text: string;
  /** The text of the groups `(…)` (index 0 is the first group), `''` for one that did not take part. */
  groups: string[];
}

export interface UnitMatch<I = number> extends Match {
  unit: I;
  /** Index of the unit in the list that was searched. */
  index: number;
}

export interface Compiled {
  regex: RegExp;
  options: FindOptions;
  /** The texts are compared without accents: both the text and the query go through `foldAccents`. */
  fold: boolean;
}

export type CompileResult = { ok: true; query: Compiled } | { ok: false; error: 'empty' | 'invalid'; message: string };
