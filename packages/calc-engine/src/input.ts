import { serialFromYMD } from './dates';
import { CalcError, type Scalar } from './values';

export interface ParsedInput {
  kind: 'text' | 'number' | 'bool' | 'error';
  value: Scalar;
  /** Number format to apply when the cell has none (percent, date, time…). */
  numFmt?: string;
}

export interface InputOptions {
  /** "1,5" is 1.5 (and "." groups thousands). */
  decimalComma?: boolean;
  /** Order for ambiguous numeric dates such as 3/4/2024. */
  dateOrder?: 'dmy' | 'mdy';
}

const PLAIN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const SLASH_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/;
const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

function validYMD(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function normaliseNumberText(t: string, decimalComma: boolean): string | null {
  if (decimalComma) {
    // "1.234,56" -> "1234.56"; "1234,5" -> "1234.5"
    if (/^[+-]?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(t)) return t.replace(/\./g, '').replace(',', '.');
    if (/^[+-]?(?:\d+,?\d*|,\d+)(?:[eE][+-]?\d+)?$/.test(t)) return t.replace(',', '.');
    if (PLAIN.test(t) && !t.includes(',')) return t;
    return null;
  }
  if (/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(t)) return t.replace(/,/g, '');
  return PLAIN.test(t) ? t : null;
}

/** Interpret text typed into a cell (formulas are handled by the caller). */
export function parseInput(raw: string, opts: InputOptions = {}): ParsedInput {
  const decimalComma = opts.decimalComma ?? false;
  const dateOrder = opts.dateOrder ?? 'dmy';
  if (raw.startsWith("'")) return { kind: 'text', value: raw.slice(1) };
  const t = raw.trim();
  if (t === '') return { kind: 'text', value: raw };

  const up = t.toUpperCase();
  if (up === 'TRUE') return { kind: 'bool', value: true };
  if (up === 'FALSE') return { kind: 'bool', value: false };
  if (t.startsWith('#')) {
    const e = CalcError.parse(t);
    if (e) return { kind: 'error', value: e };
  }

  const plain = normaliseNumberText(t, decimalComma);
  if (plain !== null) return { kind: 'number', value: Number(plain) };

  if (t.endsWith('%')) {
    const body = normaliseNumberText(t.slice(0, -1).trim(), decimalComma);
    if (body !== null) {
      const decimals = /[.,]\d+/.exec(t.slice(0, -1))?.[0].length ?? 1;
      return { kind: 'number', value: Number(body) / 100, numFmt: decimals > 1 ? `0.${'0'.repeat(decimals - 1)}%` : '0%' };
    }
  }

  let m = ISO_DATE.exec(t);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (validYMD(y, mo, d)) return { kind: 'number', value: serialFromYMD(y, mo, d), numFmt: 'yyyy-mm-dd' };
  }
  m = SLASH_DATE.exec(t);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let y = Number(m[3]);
    if (m[3]!.length === 2) y += y < 30 ? 2000 : 1900;
    const [mo, d] = dateOrder === 'dmy' ? [b, a] : [a, b];
    if (validYMD(y, mo, d)) return { kind: 'number', value: serialFromYMD(y, mo, d), numFmt: dateOrder === 'dmy' ? 'dd/mm/yyyy' : 'm/d/yyyy' };
  }
  m = TIME.exec(t);
  if (m) {
    const [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
    if (h < 24 && mi < 60 && s < 60) return { kind: 'number', value: (h * 3600 + mi * 60 + s) / 86400, numFmt: m[3] ? 'hh:mm:ss' : 'hh:mm' };
  }
  return { kind: 'text', value: raw };
}
