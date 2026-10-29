import { E, isErr, type CalcError, type Scalar } from './values';

const NUM_TEXT_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Parse text the way a spreadsheet does for arithmetic coercion ("3", " 4.5 ", "12%"). */
export function textToNumber(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  if (NUM_TEXT_RE.test(t)) return Number(t);
  if (t.endsWith('%') && NUM_TEXT_RE.test(t.slice(0, -1).trim())) return Number(t.slice(0, -1)) / 100;
  return null;
}

/** Arithmetic coercion. Errors pass through; unparseable text is #VALUE!. */
export function toNum(v: Scalar): number | CalcError {
  if (typeof v === 'number') return v;
  if (v === null) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isErr(v)) return v;
  const n = textToNumber(v);
  return n === null ? E.VALUE : n;
}

export function toText(v: Scalar): string | CalcError {
  if (typeof v === 'string') return v;
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return numberToText(v);
  return v;
}

/** General-format text of a number (up to 15 significant digits, no trailing zeros). */
export function numberToText(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? '1E+308' : '-1E+308';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e11 || abs < 1e-9) {
    let s = n.toExponential(14).replace(/\.?0+e/, 'e');
    s = s.replace('e+', 'E+').replace('e-', 'E-');
    const m = /^(.*)E([+-])(\d+)$/.exec(s);
    return m ? `${m[1]}E${m[2]}${m[3]!.padStart(2, '0')}` : s;
  }
  const s = Number(n.toPrecision(15)).toString();
  return s;
}

export function toBool(v: Scalar): boolean | CalcError {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v === null) return false;
  if (isErr(v)) return v;
  const up = v.trim().toUpperCase();
  if (up === 'TRUE') return true;
  if (up === 'FALSE') return false;
  return E.VALUE;
}

const typeRank = (v: Scalar): number => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 0);

/**
 * Spreadsheet ordering: numbers < text < booleans; text is case-insensitive.
 * Empty compares as 0 / "" / FALSE depending on the other operand.
 */
export function compareScalars(a: Scalar, b: Scalar): number {
  if (a === null && b === null) return 0;
  if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (typeof a === 'string' && typeof b === 'string') {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const x = Number(a);
  const y = Number(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
