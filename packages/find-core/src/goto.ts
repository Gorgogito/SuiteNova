/** «Go to» as Word and Excel read it. */

/** A number as typed in «Go to»: «5» goes to 5, «+3» three further, «-2» two back. */
export function parseGoToNumber(input: string): { n: number; relative: boolean } | null {
  const m = /^\s*([+-]?)\s*(\d{1,9})\s*$/.exec(input);
  if (!m) return null;
  const n = Number(m[2]);
  return m[1] === '-' ? { n: -n, relative: true } : m[1] === '+' ? { n, relative: true } : { n, relative: false };
}

export const MAX_COLS = 16384;
export const MAX_ROWS = 1048576;

/** Column letters to a 0-based index («A» is 0, «AA» is 26); null when it is not a column of a sheet. */
export function columnIndex(letters: string): number | null {
  if (!/^[A-Za-z]{1,3}$/.test(letters)) return null;
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n <= MAX_COLS ? n - 1 : null;
}

export interface CellRange {
  /** 0-based. */
  row: number;
  col: number;
  row2: number;
  col2: number;
}

/** A cell or range as typed in Excel's «Go to»: `B12`, `$B$12`, `A1:C5`. */
export function parseCellRef(input: string): CellRange | null {
  const one = (s: string) => {
    const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(s.trim());
    if (!m) return null;
    const col = columnIndex(m[1]!);
    const row = Number(m[2]) - 1;
    return col === null || row < 0 || row >= MAX_ROWS ? null : { row, col };
  };
  const [a, b, ...rest] = input.split(':');
  if (rest.length || a === undefined) return null;
  const p = one(a);
  const q = b === undefined ? p : one(b);
  if (!p || !q) return null;
  return { row: Math.min(p.row, q.row), col: Math.min(p.col, q.col), row2: Math.max(p.row, q.row), col2: Math.max(p.col, q.col) };
}
