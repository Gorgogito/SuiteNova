import type { Grid } from './grid';
import { parseNumber } from './number';

export type SortMode = 'text' | 'number' | 'date';

/** A date written as dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd or yyyy/mm/dd (the day first when it is ambiguous, as in Spanish); null if it is not one. */
export function parseDate(s: string): number | null {
  const t = s.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
  else {
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(t);
    if (!m) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
    if (y < 100) y += y < 50 ? 2000 : 1900;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return Date.UTC(y, mo - 1, d);
}

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/** Compares two texts: empty ones always go last; text by the collation of the language, numbers and dates by value. */
export function compareCells(a: string, b: string, mode: SortMode): number {
  const ea = !a.trim();
  const eb = !b.trim();
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  if (mode === 'number' || mode === 'date') {
    const na = mode === 'number' ? parseNumber(a) : parseDate(a);
    const nb = mode === 'number' ? parseNumber(b) : parseDate(b);
    if (na === null && nb === null) return 0;
    if (na === null) return 1;
    if (nb === null) return -1;
    return na - nb;
  }
  return collator.compare(a, b);
}

/**
 * The grid with its rows ordered by a column (the header row, if there is one, stays on top). Null when it cannot be done without breaking the
 * table: a cell merged over several rows in the part that is ordered.
 */
export function sortRows<C>(g: Grid<C>, col: number, ascending: boolean, mode: SortMode, text: (c: C) => string, header = false): Grid<C> | null {
  if (col < 0 || col >= g.cols.length) return null;
  const from = header ? 1 : 0;
  for (let r = from; r < g.rows.length; r++) {
    for (let c = 0; c < g.cols.length; c++) {
      const cell = g.rows[r]!.cells[c]!;
      if (!cell.cover && (cell.rs ?? 1) > 1) return null;
      if (cell.vm) return null;
    }
  }
  // what has no value (empty, or not a number or date in those modes) goes last whichever way the order goes
  const usable = (t: string) => !!t.trim() && (mode === 'text' || (mode === 'number' ? parseNumber(t) : parseDate(t)) !== null);
  const body = g.rows.slice(from).map((row, i) => ({ row, i, key: text(row.cells[col]!.content) }));
  body.sort((x, y) => {
    const ux = usable(x.key);
    const uy = usable(y.key);
    if (ux !== uy) return ux ? -1 : 1;
    if (!ux) {
      // text that is not a number goes before the empty cells
      const ex = !x.key.trim();
      const ey = !y.key.trim();
      return ex !== ey ? (ex ? 1 : -1) : x.i - y.i;
    }
    const k = compareCells(x.key, y.key, mode);
    return (ascending ? k : -k) || x.i - y.i;
  });
  return { ...g, rows: [...g.rows.slice(0, from), ...body.map((x) => x.row)] };
}
