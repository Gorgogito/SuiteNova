import type { PageSetup } from './page';
import { defaultPage } from './page';

/** Text columns of a section. Widths (pt) are only set for unequal columns. */
export interface Columns {
  count: number;
  /** Space between columns, pt. */
  space: number;
  /** Line between columns. */
  sep: boolean;
  widths: number[] | null;
}

export type SectionStart = 'nextPage' | 'continuous' | 'evenPage' | 'oddPage';
export type HFKind = 'default' | 'first' | 'even';
/** Ids of the header/footer parts of a section; `null` means "same as the previous section". */
export interface HFRefs {
  default: string | null;
  first: string | null;
  even: string | null;
}

/** Everything a section stores (the attributes of the `section` node). */
export interface SectionProps {
  id: string;
  start: SectionStart;
  page: PageSetup;
  cols: Columns;
  /** A different first page. */
  titlePg: boolean;
  header: HFRefs;
  footer: HFRefs;
  /** Restart page numbering at this number. */
  pgNumStart: number | null;
  /** Page number format. */
  pgNumFmt: 'decimal' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman';
}

export const noRefs = (): HFRefs => ({ default: null, first: null, even: null });
export const oneColumn = (): Columns => ({ count: 1, space: 36, sep: false, widths: null });

let counter = 0;
export const newSectionId = (): string => `s${Date.now().toString(36)}${(counter++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export function defaultSection(page: PageSetup = defaultPage()): SectionProps {
  return { id: newSectionId(), start: 'nextPage', page, cols: oneColumn(), titlePg: false, header: noRefs(), footer: noRefs(), pgNumStart: null, pgNumFmt: 'decimal' };
}

/** Width of each column in pt for a page and column definition. */
export function columnWidths(page: PageSetup, cols: Columns): number[] {
  const total = page.width - page.marginLeft - page.marginRight;
  if (cols.count <= 1) return [total];
  if (cols.widths && cols.widths.length === cols.count) return cols.widths;
  const each = (total - cols.space * (cols.count - 1)) / cols.count;
  return Array.from({ length: cols.count }, () => each);
}

export function formatPageNumber(n: number, fmt: SectionProps['pgNumFmt']): string {
  switch (fmt) {
    case 'lowerLetter':
      return letters(n).toLowerCase();
    case 'upperLetter':
      return letters(n);
    case 'lowerRoman':
      return roman(n).toLowerCase();
    case 'upperRoman':
      return roman(n);
    default:
      return String(n);
  }
}

function letters(n: number): string {
  let s = '';
  let v = Math.max(1, n);
  while (v > 0) {
    v--;
    s = String.fromCharCode(65 + (v % 26)) + s;
    v = Math.floor(v / 26);
  }
  return s;
}

export function roman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  const t: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  let v = n;
  for (const [k, s] of t) while (v >= k) { out += s; v -= k; }
  return out;
}
