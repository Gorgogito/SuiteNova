import { textToNumber, toNum, toText } from '../coerce';
import { formatValue } from '../format';
import { arr, E, isErr, type CalcError, type Scalar, type Value } from '../values';
import { rawFn, scalarFn } from './registry';
import { flatten, scalarOf } from './util';

const str = (v: Scalar): string | CalcError => toText(v);

/** Register a scalar function whose first argument is text and others are numbers/text. */
function textFn(name: string, min: number, max: number, f: (args: Scalar[]) => Scalar): void {
  scalarFn(name, min, max, f);
}

const intArg = (v: Scalar | undefined, dflt: number): number | CalcError => {
  if (v === undefined || v === null) return dflt;
  const n = toNum(v);
  return isErr(n) ? n : Math.trunc(n);
};

textFn('LEN', 1, 1, ([a]) => {
  const s = str(a!);
  return isErr(s) ? s : [...s].length;
});
textFn('LEFT', 1, 2, ([a, n]) => {
  const s = str(a!);
  if (isErr(s)) return s;
  const k = intArg(n, 1);
  if (isErr(k)) return k;
  return k < 0 ? E.VALUE : [...s].slice(0, k).join('');
});
textFn('RIGHT', 1, 2, ([a, n]) => {
  const s = str(a!);
  if (isErr(s)) return s;
  const k = intArg(n, 1);
  if (isErr(k)) return k;
  if (k < 0) return E.VALUE;
  const chars = [...s];
  return k === 0 ? '' : chars.slice(-k).join('');
});
textFn('MID', 3, 3, ([a, st, n]) => {
  const s = str(a!);
  if (isErr(s)) return s;
  const start = intArg(st, 1);
  const len = intArg(n, 0);
  if (isErr(start)) return start;
  if (isErr(len)) return len;
  if (start < 1 || len < 0) return E.VALUE;
  return [...s].slice(start - 1, start - 1 + len).join('');
});
textFn('UPPER', 1, 1, ([a]) => {
  const s = str(a!);
  return isErr(s) ? s : s.toUpperCase();
});
textFn('LOWER', 1, 1, ([a]) => {
  const s = str(a!);
  return isErr(s) ? s : s.toLowerCase();
});
textFn('PROPER', 1, 1, ([a]) => {
  const s = str(a!);
  return isErr(s) ? s : s.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_m, p, c: string) => p + c.toUpperCase());
});
textFn('TRIM', 1, 1, ([a]) => {
  const s = str(a!);
  return isErr(s) ? s : s.replace(/ +/g, ' ').replace(/^ | $/g, '');
});
textFn('CLEAN', 1, 1, ([a]) => {
  const s = str(a!);
  // eslint-disable-next-line no-control-regex
  return isErr(s) ? s : s.replace(/[\u0000-\u001f]/g, '');
});
textFn('EXACT', 2, 2, ([a, b]) => {
  const x = str(a!);
  const y = str(b!);
  return isErr(x) ? x : isErr(y) ? y : x === y;
});
textFn('REPT', 2, 2, ([a, n]) => {
  const s = str(a!);
  if (isErr(s)) return s;
  const k = intArg(n, 0);
  if (isErr(k)) return k;
  if (k < 0 || s.length * k > 32767) return E.VALUE;
  return s.repeat(k);
});
textFn('CONCATENATE', 1, 255, (args) => {
  let out = '';
  for (const a of args) {
    const s = str(a);
    if (isErr(s)) return s;
    out += s;
  }
  return out;
});
rawFn('CONCAT', 1, 254, (args, ctx) => {
  let out = '';
  for (const a of args) {
    for (const v of flatten(a, ctx)) {
      const s = str(v);
      if (isErr(s)) return s;
      out += s;
    }
  }
  return out;
});
rawFn('TEXTJOIN', 3, 254, (args, ctx) => {
  const delim = toText(scalarOf(args[0]!, ctx));
  if (isErr(delim)) return delim;
  const skipEmpty = scalarOf(args[1]!, ctx);
  const skip = skipEmpty === true || (typeof skipEmpty === 'number' && skipEmpty !== 0);
  const parts: string[] = [];
  for (const a of args.slice(2)) {
    for (const v of flatten(a, ctx)) {
      const s = str(v);
      if (isErr(s)) return s;
      if (skip && s === '') continue;
      parts.push(s);
    }
  }
  return parts.join(delim);
});

function wildcardToRegex(p: string): RegExp {
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === '~' && i + 1 < p.length) re += '\\' + p[++i];
    else if (c === '*') re += '[\\s\\S]*';
    else if (c === '?') re += '[\\s\\S]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re, 'i');
}

textFn('FIND', 2, 3, ([needle, hay, st]) => {
  const n = str(needle!);
  const h = str(hay!);
  if (isErr(n)) return n;
  if (isErr(h)) return h;
  const start = intArg(st, 1);
  if (isErr(start)) return start;
  if (start < 1 || start > h.length + 1) return E.VALUE;
  const i = h.indexOf(n, start - 1);
  return i < 0 ? E.VALUE : i + 1;
});
textFn('SEARCH', 2, 3, ([needle, hay, st]) => {
  const n = str(needle!);
  const h = str(hay!);
  if (isErr(n)) return n;
  if (isErr(h)) return h;
  const start = intArg(st, 1);
  if (isErr(start)) return start;
  if (start < 1 || start > h.length + 1) return E.VALUE;
  const m = wildcardToRegex(n).exec(h.slice(start - 1));
  return m ? m.index + start : E.VALUE;
});
textFn('SUBSTITUTE', 3, 4, ([a, old, neu, inst]) => {
  const s = str(a!);
  const o = str(old!);
  const n = str(neu!);
  if (isErr(s)) return s;
  if (isErr(o)) return o;
  if (isErr(n)) return n;
  if (o === '') return s;
  if (inst === undefined || inst === null) return s.split(o).join(n);
  const k = intArg(inst, 1);
  if (isErr(k)) return k;
  if (k < 1) return E.VALUE;
  let idx = -1;
  for (let i = 0; i < k; i++) {
    idx = s.indexOf(o, idx + 1);
    if (idx < 0) return s;
  }
  return s.slice(0, idx) + n + s.slice(idx + o.length);
});
textFn('REPLACE', 4, 4, ([a, st, len, neu]) => {
  const s = str(a!);
  const n = str(neu!);
  if (isErr(s)) return s;
  if (isErr(n)) return n;
  const start = intArg(st, 1);
  const l = intArg(len, 0);
  if (isErr(start)) return start;
  if (isErr(l)) return l;
  if (start < 1 || l < 0) return E.VALUE;
  return s.slice(0, start - 1) + n + s.slice(start - 1 + l);
});
textFn('VALUE', 1, 1, ([a]) => {
  if (typeof a === 'number') return a;
  const s = str(a!);
  if (isErr(s)) return s;
  const n = textToNumber(s.replace(/[$€£\s]/g, '').replace(/,(?=\d{3}(\D|$))/g, ''));
  return n === null ? E.VALUE : n;
});
textFn('NUMBERVALUE', 1, 3, ([a, dec, grp]) => {
  const s = str(a!);
  if (isErr(s)) return s;
  const d = dec === undefined || dec === null ? '.' : (str(dec) as string);
  const g = grp === undefined || grp === null ? ',' : (str(grp) as string);
  let t = s.replace(/\s/g, '');
  if (g) t = t.split(g).join('');
  if (d !== '.') t = t.split(d).join('.');
  const n = textToNumber(t);
  return n === null ? E.VALUE : n;
});
textFn('TEXT', 2, 2, ([v, f]) => {
  const fmt = str(f!);
  if (isErr(fmt)) return fmt;
  return formatValue(v!, fmt, 'en').text;
});
textFn('CHAR', 1, 1, ([a]) => {
  const n = intArg(a, 0);
  if (isErr(n)) return n;
  return n < 1 || n > 255 ? E.VALUE : String.fromCharCode(n);
});
textFn('UNICHAR', 1, 1, ([a]) => {
  const n = intArg(a, 0);
  if (isErr(n)) return n;
  return n < 1 || n > 0x10ffff ? E.VALUE : String.fromCodePoint(n);
});
textFn('CODE', 1, 1, ([a]) => {
  const s = str(a!);
  return isErr(s) ? s : s === '' ? E.VALUE : s.charCodeAt(0);
});
textFn('UNICODE', 1, 1, ([a]) => {
  const s = str(a!);
  return isErr(s) ? s : s === '' ? E.VALUE : s.codePointAt(0)!;
});
textFn('FIXED', 1, 3, ([a, d, noComma]) => {
  const n = toNum(a!);
  if (isErr(n)) return n;
  const dec = intArg(d, 2);
  if (isErr(dec)) return dec;
  const grouping = !(noComma === true || (typeof noComma === 'number' && noComma !== 0));
  const code = `${grouping ? '#,##0' : '0'}${dec > 0 ? '.' + '0'.repeat(dec) : ''}`;
  return formatValue(n, code, 'en').text;
});
textFn('DOLLAR', 1, 2, ([a, d]) => {
  const n = toNum(a!);
  if (isErr(n)) return n;
  const dec = intArg(d, 2);
  if (isErr(dec)) return dec;
  return formatValue(n, `$#,##0${dec > 0 ? '.' + '0'.repeat(dec) : ''};-$#,##0${dec > 0 ? '.' + '0'.repeat(dec) : ''}`, 'en').text;
});

function delimiters(v: Value, ctx: Parameters<typeof flatten>[1]): string[] | CalcError {
  const out: string[] = [];
  for (const x of flatten(v, ctx)) {
    const s = str(x);
    if (isErr(s)) return s;
    out.push(s);
  }
  return out;
}
function findDelim(text: string, delims: string[], instance: number, ci: boolean, fromEnd: boolean): { index: number; len: number } | null {
  const hay = ci ? text.toLowerCase() : text;
  const hits: { index: number; len: number }[] = [];
  for (let i = 0; i < hay.length; i++) {
    for (const d of delims) {
      const dd = ci ? d.toLowerCase() : d;
      if (dd && hay.startsWith(dd, i)) {
        hits.push({ index: i, len: dd.length });
        i += dd.length - 1;
        break;
      }
    }
  }
  const k = Math.abs(instance);
  if (k < 1 || k > hits.length) return null;
  return fromEnd || instance < 0 ? hits[hits.length - k]! : hits[k - 1]!;
}
function beforeAfter(name: string, after: boolean): void {
  rawFn(name, 2, 6, (args, ctx) => {
    const text = str(scalarOf(args[0]!, ctx));
    if (isErr(text)) return text;
    const ds = delimiters(args[1]!, ctx);
    if (!Array.isArray(ds)) return ds;
    const inst = intArg(args[2] ? scalarOf(args[2], ctx) : undefined, 1);
    if (isErr(inst)) return inst;
    const ci = args[3] ? toNum(scalarOf(args[3], ctx)) === 1 : false;
    const notFound = args[5] ?? E.NA;
    const hit = findDelim(text, ds, inst, ci, false);
    if (!hit) return notFound;
    return after ? text.slice(hit.index + hit.len) : text.slice(0, hit.index);
  });
}
beforeAfter('TEXTBEFORE', false);
beforeAfter('TEXTAFTER', true);

rawFn('TEXTSPLIT', 2, 6, (args, ctx) => {
  const text = str(scalarOf(args[0]!, ctx));
  if (isErr(text)) return text;
  const colD = delimiters(args[1]!, ctx);
  if (!Array.isArray(colD)) return colD;
  const rowD = args[2] ? delimiters(args[2], ctx) : [];
  if (!Array.isArray(rowD)) return rowD;
  const ignoreEmpty = args[3] ? toNum(scalarOf(args[3], ctx)) === 1 : false;
  const splitBy = (s: string, ds: string[]): string[] => {
    const real = ds.filter((d) => d !== '');
    if (!real.length) return [s];
    const re = new RegExp(real.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));
    const parts = s.split(re);
    return ignoreEmpty ? parts.filter((p) => p !== '') : parts;
  };
  const rows = (rowD.length ? splitBy(text, rowD) : [text]).map((r) => splitBy(r, colD));
  const w = Math.max(...rows.map((r) => r.length));
  return arr(rows.map((r) => Array.from({ length: w }, (_x, i) => r[i] ?? E.NA)));
});
