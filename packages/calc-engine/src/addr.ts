export const MAX_ROWS = 1_048_576;
export const MAX_COLS = 16_384;

const A = 'A'.charCodeAt(0);

/** 0 -> "A", 25 -> "Z", 26 -> "AA" */
export function colToName(col: number): string {
  let n = col + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(A + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** "A" -> 0; returns -1 when invalid or beyond XFD. */
export function nameToCol(name: string): number {
  if (name.length === 0 || name.length > 3) return -1;
  let n = 0;
  for (const ch of name.toUpperCase()) {
    const c = ch.charCodeAt(0);
    if (c < A || c > A + 25) return -1;
    n = n * 26 + (c - A + 1);
  }
  return n <= MAX_COLS ? n - 1 : -1;
}

export interface CellAddr {
  row: number;
  col: number;
  absRow: boolean;
  absCol: boolean;
}

const A1_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/;

export function parseA1(s: string): CellAddr | null {
  const m = A1_RE.exec(s);
  if (!m) return null;
  const col = nameToCol(m[2]!);
  const row = Number(m[4]) - 1;
  if (col < 0 || row < 0 || row >= MAX_ROWS) return null;
  return { row, col, absRow: m[3] === '$', absCol: m[1] === '$' };
}

export function formatA1(row: number, col: number, absRow = false, absCol = false): string {
  return `${absCol ? '$' : ''}${colToName(col)}${absRow ? '$' : ''}${row + 1}`;
}

/** Sparse-map key for a cell inside one sheet. */
export const cellKey = (row: number, col: number): number => row * MAX_COLS + col;
export const keyRow = (key: number): number => Math.floor(key / MAX_COLS);
export const keyCol = (key: number): number => key % MAX_COLS;

export interface Rect {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export function normRect(r: Rect): Rect {
  return { r1: Math.min(r.r1, r.r2), c1: Math.min(r.c1, r.c2), r2: Math.max(r.r1, r.r2), c2: Math.max(r.c1, r.c2) };
}

export function rectContains(r: Rect, row: number, col: number): boolean {
  return row >= r.r1 && row <= r.r2 && col >= r.c1 && col <= r.c2;
}

export function rectArea(r: Rect): number {
  return (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1);
}

export function formatRect(r: Rect): string {
  const a = formatA1(r.r1, r.c1);
  return r.r1 === r.r2 && r.c1 === r.c2 ? a : `${a}:${formatA1(r.r2, r.c2)}`;
}
