/**
 * Funciones de Excel que faltaban: fines de semana personalizados (…INTL), AGGREGATE, redondeos PRECISE, QUARTILE.EXC, RANK.AVG,
 * variantes de byte (LENB…), VALUETOTEXT, ENCODEURL, expresiones regulares, EXPAND/WRAPROWS/WRAPCOLS/TRIMRANGE, PERCENTOF, CELL e INFO.
 */
import { formatA1 } from '../addr';
import { toBool, toNum, toText } from '../coerce';
import { weekdayFromSerial } from '../dates';
import { arr, E, isErr, isRange, type CalcError, type Scalar, type Value } from '../values';
import { alias, rawFn, registry, scalarFn, type Ctx } from './registry';
import { numbersSorted, percentile } from './stats';
import { collectNumbers, flatten, matrixToValue, scalarOf, toMatrix } from './util';

const num = (v: Value | undefined, ctx: Ctx, dflt: number): number | CalcError => (v === undefined ? dflt : toNum(scalarOf(v, ctx)));

// ---- días laborables con fin de semana a elección ---------------------------------------------------
/** Días de la semana (0 = domingo) que son fin de semana según el código o la cadena "0000011" (lunes…domingo). */
function weekendSet(v: Value | undefined, ctx: Ctx): Set<number> | CalcError {
  const out = new Set<number>();
  const s = v === undefined ? 1 : scalarOf(v, ctx);
  if (isErr(s)) return s;
  if (typeof s === 'string' && (/^[01]{7}$/.test(s) || !/^\s*\d+\s*$/.test(s))) {
    if (!/^[01]{7}$/.test(s)) return E.VALUE;
    for (let i = 0; i < 7; i++) if (s[i] === '1') out.add((i + 1) % 7);
    return out.size === 7 ? E.VALUE : out;
  }
  const n = toNum(s);
  if (isErr(n)) return n;
  const c = Math.trunc(n);
  if (c >= 1 && c <= 7) {
    const first = (6 + c - 1) % 7;
    out.add(first);
    out.add((first + 1) % 7);
  } else if (c >= 11 && c <= 17) out.add(c - 11);
  else return E.NUM;
  return out;
}
function holidays(v: Value | undefined, ctx: Ctx): Set<number> | CalcError {
  const set = new Set<number>();
  if (v === undefined) return set;
  for (const x of flatten(v, ctx)) {
    if (isErr(x)) return x;
    if (typeof x === 'number') set.add(Math.floor(x));
    else if (x !== null) return E.VALUE;
  }
  return set;
}

rawFn('NETWORKDAYS.INTL', 2, 4, (args, ctx) => {
  const a = num(args[0], ctx, 0);
  const b = num(args[1], ctx, 0);
  if (isErr(a)) return a;
  if (isErr(b)) return b;
  const we = weekendSet(args[2], ctx);
  if (!(we instanceof Set)) return we;
  const hol = holidays(args[3], ctx);
  if (!(hol instanceof Set)) return hol;
  const s = Math.floor(a);
  const e = Math.floor(b);
  const [lo, hi] = s <= e ? [s, e] : [e, s];
  let n = 0;
  for (let d = lo; d <= hi; d++) if (!we.has(weekdayFromSerial(d)) && !hol.has(d)) n++;
  return s <= e ? n : -n;
});

rawFn('WORKDAY.INTL', 2, 4, (args, ctx) => {
  const a = num(args[0], ctx, 0);
  const b = num(args[1], ctx, 0);
  if (isErr(a)) return a;
  if (isErr(b)) return b;
  const we = weekendSet(args[2], ctx);
  if (!(we instanceof Set)) return we;
  const hol = holidays(args[3], ctx);
  if (!(hol instanceof Set)) return hol;
  let d = Math.floor(a);
  let left = Math.trunc(b);
  const step = left < 0 ? -1 : 1;
  left = Math.abs(left);
  while (left > 0) {
    d += step;
    if (!we.has(weekdayFromSerial(d)) && !hol.has(d)) left--;
  }
  return d < 0 ? E.NUM : d;
});

// ---- matemáticas ------------------------------------------------------------------------------------
scalarFn('CEILING.PRECISE', 1, 2, ([x, sig]) => {
  const n = toNum(x!);
  const s = sig === undefined ? 1 : toNum(sig!);
  if (isErr(n)) return n;
  if (isErr(s)) return s;
  return s === 0 ? 0 : Math.ceil(n / Math.abs(s)) * Math.abs(s);
});
scalarFn('FLOOR.PRECISE', 1, 2, ([x, sig]) => {
  const n = toNum(x!);
  const s = sig === undefined ? 1 : toNum(sig!);
  if (isErr(n)) return n;
  if (isErr(s)) return s;
  return s === 0 ? 0 : Math.floor(n / Math.abs(s)) * Math.abs(s);
});

rawFn('QUARTILE.EXC', 2, 2, (args, ctx) => {
  const { nums, error } = numbersSorted([args[0]!], ctx);
  if (error) return error;
  const q = toNum(scalarOf(args[1]!, ctx));
  if (isErr(q)) return q;
  const k = Math.trunc(q);
  if (k < 1 || k > 3) return E.NUM;
  return percentile(nums, k / 4, true);
});

rawFn('RANK.AVG', 2, 3, (args, ctx) => {
  const x = toNum(scalarOf(args[0]!, ctx));
  if (isErr(x)) return x;
  const { nums, error } = numbersSorted([args[1]!], ctx);
  if (error) return error;
  const order = args[2] === undefined ? 0 : toNum(scalarOf(args[2], ctx));
  if (isErr(order)) return order;
  const same = nums.filter((n) => n === x).length;
  if (!same) return E.NA;
  const better = order === 0 ? nums.filter((n) => n > x).length : nums.filter((n) => n < x).length;
  return better + 1 + (same - 1) / 2;
});

rawFn('PERCENTOF', 2, 2, (args, ctx) => {
  const a = collectNumbers([args[0]!], ctx);
  const b = collectNumbers([args[1]!], ctx);
  if (a.error) return a.error;
  if (b.error) return b.error;
  const total = b.nums.reduce((x, y) => x + y, 0);
  return total === 0 ? E.DIV0 : a.nums.reduce((x, y) => x + y, 0) / total;
});

// ---- AGGREGATE ---------------------------------------------------------------------------------------
const AGG: Record<number, string> = {
  1: 'AVERAGE', 2: 'COUNT', 3: 'COUNTA', 4: 'MAX', 5: 'MIN', 6: 'PRODUCT', 7: 'STDEV.S', 8: 'STDEV.P', 9: 'SUM', 10: 'VAR.S', 11: 'VAR.P', 12: 'MEDIAN', 13: 'MODE.SNGL',
  14: 'LARGE', 15: 'SMALL', 16: 'PERCENTILE.INC', 17: 'QUARTILE.INC', 18: 'PERCENTILE.EXC', 19: 'QUARTILE.EXC',
};
rawFn('AGGREGATE', 3, 255, (args, ctx) => {
  const f = num(args[0], ctx, 0);
  const o = num(args[1], ctx, 0);
  if (isErr(f)) return f;
  if (isErr(o)) return o;
  const target = AGG[Math.trunc(f)];
  const opt = Math.trunc(o);
  if (!target || opt < 0 || opt > 7) return E.VALUE;
  const dropHidden = opt === 1 || opt === 3 || opt === 5 || opt === 7;
  const dropErrors = opt === 2 || opt === 3 || opt === 6 || opt === 7;
  const tail = Math.trunc(f) >= 14;
  if (tail && args.length !== 4) return E.VALUE;
  const dataArgs = tail ? [args[2]!] : args.slice(2);
  const cleaned = dataArgs.map((a): Value => {
    if (!dropHidden && !dropErrors) return a;
    if (!isRange(a) && !(typeof a === 'object' && a !== null && 'rows' in a)) return a;
    const rows: Scalar[][] = [];
    if (isRange(a)) {
      const c = ctx.host.clip(a);
      for (let r = c.r1; r <= c.r2; r++) {
        if (dropHidden && ctx.host.rowHidden(a.sheetId, r, false)) continue;
        rows.push(Array.from({ length: c.c2 - c.c1 + 1 }, (_x, j) => ctx.host.cellValue(a.sheetId, r, c.c1 + j)));
      }
    } else rows.push(...toMatrix(a, ctx));
    const flat = dropErrors ? [rows.flat().filter((v) => !isErr(v))] : rows;
    return flat.length && flat[0]!.length ? arr(flat) : arr([[null]]);
  });
  const d = registry.get(target);
  if (!d) return E.NAME;
  return d.impl(tail ? [...cleaned, args[3]!] : cleaned, ctx);
});

// ---- texto ---------------------------------------------------------------------------------------------
// En un equipo sin juego de caracteres de doble byte, las variantes «B» actúan igual que las normales.
for (const [b, n] of [['LENB', 'LEN'], ['LEFTB', 'LEFT'], ['RIGHTB', 'RIGHT'], ['MIDB', 'MID'], ['FINDB', 'FIND'], ['SEARCHB', 'SEARCH'], ['REPLACEB', 'REPLACE']] as const) {
  if (registry.has(n)) alias(b, n);
}
// ASC, JIS y DBCS solo convierten con idiomas de doble byte; en los demás devuelven el texto sin cambios (como Excel).
for (const n of ['ASC', 'JIS', 'DBCS']) scalarFn(n, 1, 1, ([a]) => toText(a!));
rawFn('PHONETIC', 1, 1, (args, ctx) => {
  const v = scalarOf(args[0]!, ctx);
  return isErr(v) ? v : toText(v);
});

const display = (v: Scalar, strict: boolean): string => {
  if (isErr(v)) return v.code;
  if (typeof v === 'string') return strict ? `"${v.replace(/"/g, '""')}"` : v;
  const t = toText(v);
  return typeof t === 'string' ? t : t.code;
};
rawFn('VALUETOTEXT', 1, 2, (args, ctx) => {
  const f = num(args[1], ctx, 0);
  if (isErr(f)) return f;
  if (f !== 0 && f !== 1) return E.VALUE;
  return display(scalarOf(args[0]!, ctx), f === 1);
});
rawFn('ARRAYTOTEXT', 1, 2, (args, ctx) => {
  const f = num(args[1], ctx, 0);
  if (isErr(f)) return f;
  if (f !== 0 && f !== 1) return E.VALUE;
  const m = toMatrix(args[0]!, ctx);
  if (f === 0) return m.flat().map((v) => display(v, false)).join(', ');
  return `{${m.map((r) => r.map((v) => display(v, true)).join(',')).join(';')}}`;
});

scalarFn('ENCODEURL', 1, 1, ([a]) => {
  const s = toText(a!);
  if (isErr(s)) return s;
  try {
    return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch {
    return E.VALUE;
  }
});

// ---- expresiones regulares (Excel 365) ------------------------------------------------------------------
function regex(pattern: Scalar, caseMode: number, global: boolean): RegExp | CalcError {
  const p = toText(pattern);
  if (isErr(p)) return p;
  try {
    return new RegExp(p, `${caseMode === 1 ? 'i' : ''}${global ? 'g' : ''}u`);
  } catch {
    return E.VALUE;
  }
}
const caseOf = (v: Scalar | undefined): number | CalcError => (v === undefined || v === null ? 0 : toNum(v));

scalarFn('REGEXTEST', 2, 3, ([t, p, c]) => {
  const s = toText(t!);
  const cm = caseOf(c);
  if (isErr(s)) return s;
  if (isErr(cm)) return cm;
  if (cm !== 0 && cm !== 1) return E.VALUE;
  const re = regex(p!, cm, false);
  return re instanceof RegExp ? re.test(s) : re;
});
rawFn('REGEXEXTRACT', 2, 4, (args, ctx) => {
  const t = toText(scalarOf(args[0]!, ctx));
  const mode = num(args[2], ctx, 0);
  const cm = caseOf(args[3] === undefined ? undefined : scalarOf(args[3], ctx));
  if (isErr(t)) return t;
  if (isErr(mode)) return mode;
  if (isErr(cm)) return cm;
  if (![0, 1, 2].includes(mode) || (cm !== 0 && cm !== 1)) return E.VALUE;
  const re = regex(scalarOf(args[1]!, ctx), cm, mode === 1);
  if (!(re instanceof RegExp)) return re;
  if (mode === 1) {
    const all = [...t.matchAll(re)].map((m) => m[0]);
    return all.length ? matrixToValue(all.map((x) => [x])) : E.NA;
  }
  const m = re.exec(t);
  if (!m) return E.NA;
  if (mode === 0) return m[0];
  const groups = m.slice(1).map((g) => g ?? '');
  return groups.length ? matrixToValue([groups]) : E.VALUE;
});
rawFn('REGEXREPLACE', 3, 5, (args, ctx) => {
  const t = toText(scalarOf(args[0]!, ctx));
  const rep = toText(scalarOf(args[2]!, ctx));
  const occ = num(args[3], ctx, 0);
  const cm = caseOf(args[4] === undefined ? undefined : scalarOf(args[4], ctx));
  if (isErr(t)) return t;
  if (isErr(rep)) return rep;
  if (isErr(occ)) return occ;
  if (isErr(cm)) return cm;
  if (cm !== 0 && cm !== 1) return E.VALUE;
  const re = regex(scalarOf(args[1]!, ctx), cm, true);
  if (!(re instanceof RegExp)) return re;
  const k = Math.trunc(occ);
  if (k === 0) return t.replace(re, rep);
  const matches = [...t.matchAll(re)];
  const m = matches[k > 0 ? k - 1 : matches.length + k];
  if (!m || m.index === undefined) return t;
  const out = m[0].replace(new RegExp(re.source, re.flags.replace('g', '')), rep);
  return t.slice(0, m.index) + out + t.slice(m.index + m[0].length);
});

// ---- matrices ---------------------------------------------------------------------------------------------
rawFn('EXPAND', 2, 4, (args, ctx) => {
  const m = toMatrix(args[0]!, ctx);
  const h = m.length;
  const w = m[0]?.length ?? 0;
  const r = num(args[1], ctx, h);
  const c = args[2] === undefined ? w : num(args[2], ctx, w);
  if (isErr(r)) return r;
  if (isErr(c)) return c;
  const pad: Scalar = args[3] === undefined ? E.NA : scalarOf(args[3], ctx);
  const rows = Math.trunc(r);
  const cols = Math.trunc(c);
  if (rows < h || cols < w) return E.VALUE;
  return matrixToValue(Array.from({ length: rows }, (_x, i) => Array.from({ length: cols }, (_y, j) => (i < h && j < w ? m[i]![j]! : pad))));
});

function wrap(name: string, byRows: boolean): void {
  rawFn(name, 2, 3, (args, ctx) => {
    const flat = toMatrix(args[0]!, ctx);
    if (flat.length > 1 && (flat[0]?.length ?? 0) > 1) return E.VALUE;
    const v = flat.flat();
    const n = num(args[1], ctx, 1);
    if (isErr(n)) return n;
    const k = Math.trunc(n);
    if (k < 1) return E.NUM;
    const pad: Scalar = args[2] === undefined ? E.NA : scalarOf(args[2], ctx);
    const lines = Math.ceil(v.length / k);
    const grid = Array.from({ length: lines }, (_x, i) => Array.from({ length: k }, (_y, j) => (i * k + j < v.length ? v[i * k + j]! : pad)));
    if (byRows) return matrixToValue(grid);
    return matrixToValue(Array.from({ length: k }, (_x, j) => grid.map((row) => row[j]!)));
  });
}
wrap('WRAPROWS', true);
wrap('WRAPCOLS', false);

rawFn('TRIMRANGE', 1, 3, (args, ctx) => {
  const m = toMatrix(args[0]!, ctx);
  const rm = num(args[1], ctx, 3);
  const cm = num(args[2], ctx, 3);
  if (isErr(rm)) return rm;
  if (isErr(cm)) return cm;
  if (![0, 1, 2, 3].includes(rm) || ![0, 1, 2, 3].includes(cm)) return E.VALUE;
  const blank = (v: Scalar) => v === null || v === '';
  let r0 = 0;
  let r1 = m.length - 1;
  let c0 = 0;
  let c1 = (m[0]?.length ?? 0) - 1;
  const rowBlank = (i: number) => m[i]!.slice(c0, c1 + 1).every(blank);
  const colBlank = (j: number) => m.slice(r0, r1 + 1).every((row) => blank(row[j]!));
  if (rm === 1 || rm === 3) while (r0 <= r1 && rowBlank(r0)) r0++;
  if (rm === 2 || rm === 3) while (r1 >= r0 && rowBlank(r1)) r1--;
  if (cm === 1 || cm === 3) while (c0 <= c1 && colBlank(c0)) c0++;
  if (cm === 2 || cm === 3) while (c1 >= c0 && colBlank(c1)) c1--;
  if (r0 > r1 || c0 > c1) return E.CALC;
  return matrixToValue(m.slice(r0, r1 + 1).map((row) => row.slice(c0, c1 + 1)));
});

// ---- CELL e INFO --------------------------------------------------------------------------------------------
rawFn('CELL', 1, 2, (args, ctx) => {
  const kind = toText(scalarOf(args[0]!, ctx));
  if (isErr(kind)) return kind;
  const ref = args[1];
  if (ref !== undefined && !isRange(ref)) return E.VALUE;
  const sheetId = ref ? ref.sheetId : ctx.sheetId;
  const row = ref ? ref.r1 : ctx.row;
  const col = ref ? ref.c1 : ctx.col;
  const v = ctx.host.cellValue(sheetId, row, col);
  switch (kind.toLowerCase()) {
    case 'address': {
      const a = formatA1(row, col, true, true);
      return sheetId === ctx.sheetId ? a : `'${ctx.host.sheetNameById(sheetId) ?? ''}'!${a}`;
    }
    case 'col':
      return col + 1;
    case 'row':
      return row + 1;
    case 'contents':
      return v;
    case 'type':
      return v === null ? 'b' : typeof v === 'string' ? 'l' : 'v';
    case 'filename':
      return '';
    case 'format':
      return 'G';
    case 'prefix':
      return '';
    case 'protect':
      return 1;
    case 'color':
    case 'parentheses':
      return 0;
    case 'width':
      return 8;
    default:
      return E.VALUE;
  }
});
scalarFn('INFO', 1, 1, ([a]) => {
  const t = toText(a!);
  if (isErr(t)) return t;
  switch (t.toLowerCase()) {
    case 'recalc':
      return 'Automatic';
    case 'release':
      return '16.0';
    case 'system':
      return 'pcdos';
    case 'osversion':
      return 'Windows (32-bit) NT 10.00';
    case 'numfile':
      return 1;
    case 'origin':
      return '$A:$A$1';
    case 'directory':
    case 'memavail':
    case 'memused':
    case 'totmem':
      return E.NA;
    default:
      return E.VALUE;
  }
});

void toBool;
