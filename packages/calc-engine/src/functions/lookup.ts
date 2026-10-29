import { colToName, formatA1, MAX_COLS, MAX_ROWS } from '../addr';
import { compareScalars, toBool, toNum, toText } from '../coerce';
import { evaluate } from '../evaluator';
import { parseFormula } from '../parser';
import { arr, E, isArray, isErr, isRange, isRefs, type ArrayVal, type CalcError, type RangeVal, type Scalar, type Value } from '../values';
import { quoteSheet } from '../formula';
import { rawFn } from './registry';
import type { Ctx } from './registry';
import { dimsOf, gridVector, matrixToValue, scalarOf, toGrid, toMatrix, type Grid, type Seq } from './util';

const num = (v: Value | undefined, ctx: Ctx, dflt: number): number | CalcError => {
  if (v === undefined) return dflt;
  const s = scalarOf(v, ctx);
  if (s === null) return dflt;
  return toNum(s);
};

function wildcardRegex(p: string): RegExp {
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === '~' && i + 1 < p.length) re += '\\' + p[++i];
    else if (c === '*') re += '[\\s\\S]*';
    else if (c === '?') re += '[\\s\\S]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

function equalScalars(a: Scalar, b: Scalar): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  if (typeof a !== typeof b) return false;
  return a === b;
}

/** Index of an exact match (optionally with wildcards), searching forwards or backwards. */
function findExact(look: Scalar, list: Seq, wildcards: boolean, reverse = false): number {
  const re = wildcards && typeof look === 'string' && /[*?~]/.test(look) ? wildcardRegex(look) : null;
  const test = (v: Scalar) => (re ? typeof v === 'string' && re.test(v) : equalScalars(look, v));
  if (reverse) {
    for (let i = list.length - 1; i >= 0; i--) if (test(list.at(i))) return i;
  } else {
    for (let i = 0; i < list.length; i++) if (test(list.at(i))) return i;
  }
  return -1;
}

/** Binary search: last index whose value <= look in an ascending list (or >= in descending); -1 if none. */
function approxIndex(look: Scalar, list: Seq, ascending: boolean): number {
  let lo = 0;
  let hi = list.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const item = list.at(mid);
    const sameType = typeof item === typeof look || (item === null && look === null);
    if (!sameType) {
      // mixed types: scan outwards linearly for a comparable neighbour
      let j = mid;
      while (j >= lo && !(typeof list.at(j) === typeof look)) j--;
      if (j < lo) {
        lo = mid + 1;
        continue;
      }
      const c = compareScalars(list.at(j), look);
      if (ascending ? c <= 0 : c >= 0) {
        best = j;
        lo = mid + 1;
      } else hi = j - 1;
      continue;
    }
    const c = compareScalars(item, look);
    if (c === 0) {
      best = mid;
      lo = mid + 1; // keep going right for the last equal
    } else if (ascending ? c < 0 : c > 0) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

function vector(v: Value, ctx: Ctx): Seq | null {
  return gridVector(toGrid(v, ctx, 'all'));
}

function matchImpl(look: Scalar, list: Seq, type: number): number {
  if (type === 0) return findExact(look, list, true);
  const idx = approxIndex(look, list, type > 0);
  return idx;
}

rawFn('MATCH', 2, 3, (args, ctx) => {
  const look = scalarOf(args[0]!, ctx);
  if (isErr(look)) return look;
  const list = vector(args[1]!, ctx);
  if (!list) return E.NA;
  const t = num(args[2], ctx, 1);
  if (isErr(t)) return t;
  const i = matchImpl(look, list, Math.sign(t));
  return i < 0 ? E.NA : i + 1;
});

function tableLookup(name: string, byRow: boolean): void {
  rawFn(name, 3, 4, (args, ctx) => {
    const look = scalarOf(args[0]!, ctx);
    if (isErr(look)) return look;
    const table = toGrid(args[1]!, ctx, 'rows');
    const idxN = num(args[2], ctx, 1);
    if (isErr(idxN)) return idxN;
    const idx = Math.trunc(idxN);
    const approxV = args[3] === undefined ? true : toBool(scalarOf(args[3], ctx));
    if (isErr(approxV)) return approxV;
    const h = table.rows;
    const w = table.cols;
    if (idx < 1) return E.VALUE;
    if (idx > (byRow ? h : w)) return E.REF;
    const keys: Seq = byRow ? { length: w, at: (j) => table.get(0, j) } : { length: h, at: (i) => table.get(i, 0) };
    const pos = approxV ? approxIndex(look, keys, true) : findExact(look, keys, true);
    if (pos < 0) return E.NA;
    return (byRow ? table.get(idx - 1, pos) : table.get(pos, idx - 1)) ?? 0;
  });
}
tableLookup('VLOOKUP', false);
tableLookup('HLOOKUP', true);

rawFn('LOOKUP', 2, 3, (args, ctx) => {
  const look = scalarOf(args[0]!, ctx);
  if (isErr(look)) return look;
  const keys = vector(args[1]!, ctx);
  if (!keys) return E.NA;
  const res = args[2] ? vector(args[2], ctx) : keys;
  if (!res) return E.NA;
  const i = approxIndex(look, keys, true);
  return i < 0 || i >= res.length ? E.NA : res.at(i);
});

function xSearch(look: Scalar, keys: Seq, matchMode: number, searchMode: number): number {
  const reverse = searchMode === -1;
  if (searchMode === 2 || searchMode === -2) {
    const asc = searchMode === 2;
    const i = approxIndex(look, keys, asc);
    if (i >= 0 && compareScalars(keys.at(i), look) === 0) return i;
    if (matchMode === 0) return -1;
    if (matchMode === -1) return i;
    // next larger (asc) / next smaller position
    const j = asc ? i + 1 : i + 1;
    return j < keys.length ? j : -1;
  }
  if (matchMode === 0 || matchMode === 2) return findExact(look, keys, matchMode === 2, reverse);
  // exact or nearest smaller/larger, linear
  let best = -1;
  for (let k = 0; k < keys.length; k++) {
    const i = reverse ? keys.length - 1 - k : k;
    const v = keys.at(i);
    if (typeof v !== typeof look) continue;
    const c = compareScalars(v, look);
    if (c === 0) return i;
    if (matchMode === -1 && c < 0 && (best < 0 || compareScalars(v, keys.at(best)) > 0)) best = i;
    if (matchMode === 1 && c > 0 && (best < 0 || compareScalars(v, keys.at(best)) < 0)) best = i;
  }
  return best;
}

rawFn('XMATCH', 2, 4, (args, ctx) => {
  const look = scalarOf(args[0]!, ctx);
  if (isErr(look)) return look;
  const keys = vector(args[1]!, ctx);
  if (!keys) return E.VALUE;
  const mm = num(args[2], ctx, 0);
  const sm = num(args[3], ctx, 1);
  if (isErr(mm)) return mm;
  if (isErr(sm)) return sm;
  const i = xSearch(look, keys, mm, sm);
  return i < 0 ? E.NA : i + 1;
});

rawFn('XLOOKUP', 3, 6, (args, ctx) => {
  const look = scalarOf(args[0]!, ctx);
  if (isErr(look)) return look;
  const keys = vector(args[1]!, ctx);
  if (!keys) return E.VALUE;
  const ret: Grid = toGrid(args[2]!, ctx, 'none');
  const mm = num(args[4], ctx, 0);
  const sm = num(args[5], ctx, 1);
  if (isErr(mm)) return mm;
  if (isErr(sm)) return sm;
  const i = xSearch(look, keys, mm, sm);
  if (i < 0) return args[3] === undefined ? E.NA : (isRange(args[3]) || isArray(args[3]) ? args[3] : args[3]);
  const keysAlongRow = toGrid(args[1]!, ctx, 'none').rows === 1;
  if (keysAlongRow) {
    // keys run along a row: return column i
    if (i >= ret.cols) return E.VALUE;
    return matrixToValue(Array.from({ length: ret.rows }, (_x, r) => [ret.get(r, i) ?? 0]));
  }
  if (i >= ret.rows) return E.VALUE;
  return matrixToValue([Array.from({ length: ret.cols }, (_x, c) => ret.get(i, c) ?? 0)]);
});

rawFn('INDEX', 2, 4, (args, ctx) => {
  let a = args[0]!;
  if (isRefs(a)) {
    // INDEX((A1:A3,C1:C3), row, col, area): the fourth argument picks the area
    const n = args[3] === undefined ? 1 : num(args[3], ctx, 1);
    if (isErr(n)) return n;
    const area = a.areas[Math.trunc(n) - 1];
    if (!area) return E.REF;
    a = area;
  }
  const { rows: h, cols: w } = dimsOf(a, ctx);
  const rN = num(args[1], ctx, 0);
  if (isErr(rN)) return rN;
  let r = Math.trunc(rN);
  let c = 0;
  if (args[2] !== undefined) {
    const cN = num(args[2], ctx, 0);
    if (isErr(cN)) return cN;
    c = Math.trunc(cN);
  } else if (h === 1 && w > 1) {
    c = r;
    r = 1;
  }
  if (r < 0 || c < 0 || r > h || c > w) return E.REF;
  if (isRange(a)) {
    const out: RangeVal = {
      kind: 'range',
      sheetId: a.sheetId,
      r1: r === 0 ? a.r1 : a.r1 + r - 1,
      r2: r === 0 ? a.r2 : a.r1 + r - 1,
      c1: c === 0 ? a.c1 : a.c1 + c - 1,
      c2: c === 0 ? a.c2 : a.c1 + c - 1,
    };
    return out;
  }
  const m = toMatrix(a, ctx);
  const rows = r === 0 ? m : [m[r - 1]!];
  return matrixToValue(c === 0 ? rows : rows.map((row) => [row[c - 1]!]));
});

rawFn('ROW', 0, 1, (args, ctx) => {
  const a = args[0];
  if (a === undefined) return ctx.row + 1;
  if (!isRange(a)) return E.VALUE;
  const col: Scalar[][] = [];
  for (let r = a.r1; r <= a.r2; r++) col.push([r + 1]);
  return matrixToValue(col);
});
rawFn('COLUMN', 0, 1, (args, ctx) => {
  const a = args[0];
  if (a === undefined) return ctx.col + 1;
  if (!isRange(a)) return E.VALUE;
  const row: Scalar[] = [];
  for (let c = a.c1; c <= a.c2; c++) row.push(c + 1);
  return matrixToValue([row]);
});
rawFn('ROWS', 1, 1, (args, ctx) => dimsOf(args[0]!, ctx).rows);
rawFn('COLUMNS', 1, 1, (args, ctx) => dimsOf(args[0]!, ctx).cols);

rawFn(
  'OFFSET',
  3,
  5,
  (args, ctx) => {
    const ref = args[0]!;
    if (!isRange(ref)) return E.VALUE;
    const dr = num(args[1], ctx, 0);
    const dc = num(args[2], ctx, 0);
    const hN = num(args[3], ctx, ref.r2 - ref.r1 + 1);
    const wN = num(args[4], ctx, ref.c2 - ref.c1 + 1);
    for (const n of [dr, dc, hN, wN]) if (isErr(n)) return n;
    const [rr, cc, hh, ww] = [dr, dc, hN, wN].map((n) => Math.trunc(n as number)) as [number, number, number, number];
    if (hh < 1 || ww < 1) return E.REF;
    const r1 = ref.r1 + rr;
    const c1 = ref.c1 + cc;
    if (r1 < 0 || c1 < 0 || r1 + hh > MAX_ROWS || c1 + ww > MAX_COLS) return E.REF;
    return { kind: 'range', sheetId: ref.sheetId, r1, c1, r2: r1 + hh - 1, c2: c1 + ww - 1 };
  },
  { volatile: true },
);

rawFn(
  'INDIRECT',
  1,
  2,
  (args, ctx) => {
    const t = toText(scalarOf(args[0]!, ctx));
    if (isErr(t)) return t;
    try {
      const node = parseFormula(t.trim());
      if (node.t !== 'ref' && node.t !== 'range' && node.t !== 'tref' && node.t !== 'name') return E.REF;
      const v = evaluate(node, ctx);
      return isRange(v) ? v : E.REF;
    } catch {
      return E.REF;
    }
  },
  { volatile: true },
);

rawFn('ADDRESS', 2, 5, (args, ctx) => {
  const r = num(args[0], ctx, 1);
  const c = num(args[1], ctx, 1);
  if (isErr(r)) return r;
  if (isErr(c)) return c;
  const abs = num(args[2], ctx, 1);
  if (isErr(abs)) return abs;
  const a1 = args[3] === undefined ? true : toBool(scalarOf(args[3], ctx));
  if (isErr(a1)) return a1;
  if (r < 1 || c < 1 || r > MAX_ROWS || c > MAX_COLS) return E.VALUE;
  const absRow = abs === 1 || abs === 2;
  const absCol = abs === 1 || abs === 3;
  let ref: string;
  if (a1) ref = formatA1(r - 1, c - 1, absRow, absCol);
  else ref = `R${absRow ? r : `[${r}]`}C${absCol ? c : `[${c}]`}`;
  if (args[4] !== undefined) {
    const sh = toText(scalarOf(args[4], ctx));
    if (isErr(sh)) return sh;
    ref = `${quoteSheet(sh)}!${ref}`;
  }
  void colToName;
  return ref;
});

// ---- dynamic arrays --------------------------------------------------------------------------
rawFn('TRANSPOSE', 1, 1, (args, ctx) => {
  const m = toMatrix(args[0]!, ctx);
  const h = m.length;
  const w = m[0]?.length ?? 0;
  return matrixToValue(Array.from({ length: w }, (_x, j) => Array.from({ length: h }, (_y, i) => m[i]![j]!)));
});

function compareForSort(a: Scalar, b: Scalar): number {
  // errors last, blanks last
  if (isErr(a) || isErr(b)) return isErr(a) ? (isErr(b) ? 0 : 1) : -1;
  if (a === null || b === null) return a === null ? (b === null ? 0 : 1) : -1;
  return compareScalars(a, b);
}

function sortRows(rows: Scalar[][], keys: { col: number; asc: boolean }[]): Scalar[][] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((x, y) => {
      for (const k of keys) {
        const c = compareForSort(x.r[k.col]!, y.r[k.col]!);
        if (c !== 0) {
          const bothPlain = !isErr(x.r[k.col]!) && !isErr(y.r[k.col]!) && x.r[k.col] !== null && y.r[k.col] !== null;
          return bothPlain && !k.asc ? -c : c;
        }
      }
      return x.i - y.i;
    })
    .map((x) => x.r);
}

const transposeM = (m: Scalar[][]): Scalar[][] => Array.from({ length: m[0]?.length ?? 0 }, (_x, j) => m.map((r) => r[j]!));

rawFn('SORT', 1, 4, (args, ctx) => {
  let m = toMatrix(args[0]!, ctx);
  const idx = num(args[1], ctx, 1);
  const ord = num(args[2], ctx, 1);
  if (isErr(idx)) return idx;
  if (isErr(ord)) return ord;
  const byCol = args[3] === undefined ? false : toBool(scalarOf(args[3], ctx));
  if (isErr(byCol)) return byCol;
  if (byCol) m = transposeM(m);
  if (idx < 1 || idx > (m[0]?.length ?? 0)) return E.VALUE;
  const sorted = sortRows(m, [{ col: idx - 1, asc: ord !== -1 }]);
  return matrixToValue(byCol ? transposeM(sorted) : sorted);
});

rawFn('SORTBY', 2, 255, (args, ctx) => {
  const m = toMatrix(args[0]!, ctx);
  const keyCols: { col: number; asc: boolean }[] = [];
  const augmented = m.map((r) => [...r]);
  for (let i = 1; i < args.length; i += 2) {
    const by = toMatrix(args[i]!, ctx).flat();
    if (by.length !== m.length) return E.VALUE;
    const ord = num(args[i + 1], ctx, 1);
    if (isErr(ord)) return ord;
    by.forEach((v, r) => augmented[r]!.push(v));
    keyCols.push({ col: (m[0]?.length ?? 0) + keyCols.length, asc: ord !== -1 });
  }
  const w = m[0]?.length ?? 0;
  return matrixToValue(sortRows(augmented, keyCols).map((r) => r.slice(0, w)));
});

rawFn('UNIQUE', 1, 3, (args, ctx) => {
  let m = toMatrix(args[0]!, ctx);
  const byCol = args[1] === undefined ? false : toBool(scalarOf(args[1], ctx));
  const once = args[2] === undefined ? false : toBool(scalarOf(args[2], ctx));
  if (isErr(byCol)) return byCol;
  if (isErr(once)) return once;
  if (byCol) m = transposeM(m);
  const keyOf = (r: Scalar[]) => r.map((v) => (typeof v === 'string' ? `s:${v.toLowerCase()}` : `${typeof v}:${String(v)}`)).join('\u0001');
  const counts = new Map<string, number>();
  for (const r of m) counts.set(keyOf(r), (counts.get(keyOf(r)) ?? 0) + 1);
  const seen = new Set<string>();
  const out: Scalar[][] = [];
  for (const r of m) {
    const k = keyOf(r);
    if (once ? counts.get(k) === 1 : !seen.has(k)) out.push(r);
    seen.add(k);
  }
  if (!out.length) return E.CALC;
  return matrixToValue(byCol ? transposeM(out) : out);
});

rawFn('FILTER', 2, 3, (args, ctx) => {
  const m = toMatrix(args[0]!, ctx);
  const inc = toMatrix(args[1]!, ctx);
  const rowMode = inc.length === m.length && (inc[0]?.length ?? 0) === 1;
  const colMode = inc.length === 1 && (inc[0]?.length ?? 0) === (m[0]?.length ?? 0);
  if (!rowMode && !colMode) return E.VALUE;
  const flags = rowMode ? inc.map((r) => r[0]!) : inc[0]!;
  for (const f of flags) if (isErr(f)) return f;
  const truthy = (f: Scalar) => (typeof f === 'number' ? f !== 0 : f === true);
  const out = rowMode ? m.filter((_r, i) => truthy(flags[i]!)) : m.map((r) => r.filter((_c, j) => truthy(flags[j]!)));
  if (!out.length || !out[0]!.length) return args[2] ?? E.CALC;
  return matrixToValue(out);
});

rawFn('SEQUENCE', 1, 4, (args, ctx) => {
  const rows = num(args[0], ctx, 1);
  const cols = num(args[1], ctx, 1);
  const start = num(args[2], ctx, 1);
  const step = num(args[3], ctx, 1);
  for (const n of [rows, cols, start, step]) if (isErr(n)) return n;
  const [r, c, s, st] = [rows, cols, start, step] as number[] as [number, number, number, number];
  if (r < 1 || c < 1 || r * c > 1_000_000) return E.CALC;
  const out: Scalar[][] = [];
  for (let i = 0; i < Math.trunc(r); i++) out.push(Array.from({ length: Math.trunc(c) }, (_x, j) => s + (i * Math.trunc(c) + j) * st));
  return matrixToValue(out);
});

rawFn(
  'RANDARRAY',
  0,
  5,
  (args, ctx) => {
    const rows = num(args[0], ctx, 1);
    const cols = num(args[1], ctx, 1);
    const lo = num(args[2], ctx, 0);
    const hi = num(args[3], ctx, 1);
    for (const n of [rows, cols, lo, hi]) if (isErr(n)) return n;
    const integer = args[4] === undefined ? false : toBool(scalarOf(args[4], ctx));
    const [r, c, a, b] = [rows, cols, lo, hi] as number[] as [number, number, number, number];
    if (r < 1 || c < 1 || a > b) return E.VALUE;
    const out = Array.from({ length: Math.trunc(r) }, () =>
      Array.from({ length: Math.trunc(c) }, () => (integer === true ? Math.ceil(a) + Math.floor(ctx.host.random() * (Math.floor(b) - Math.ceil(a) + 1)) : a + ctx.host.random() * (b - a))),
    );
    return matrixToValue(out);
  },
  { volatile: true },
);

function slice(name: string, take: boolean): void {
  rawFn(name, 2, 3, (args, ctx) => {
    const m = toMatrix(args[0]!, ctx);
    const r = num(args[1], ctx, 0);
    const c = num(args[2], ctx, 0);
    if (isErr(r)) return r;
    if (isErr(c)) return c;
    const h = m.length;
    const w = m[0]?.length ?? 0;
    const pick = (n: number, total: number): [number, number] => {
      const k = Math.trunc(n);
      if (take) return k >= 0 ? [0, Math.min(k, total)] : [Math.max(total + k, 0), total];
      return k >= 0 ? [Math.min(k, total), total] : [0, Math.max(total + k, 0)];
    };
    const [r0, r1] = args[1] === undefined || (take && r === 0 && false) ? [0, h] : pick(r, h);
    const [c0, c1] = args[2] === undefined ? [0, w] : pick(c, w);
    const out = m.slice(r0, r1).map((row) => row.slice(c0, c1));
    if (!out.length || !out[0]!.length) return E.CALC;
    return matrixToValue(out);
  });
}
slice('TAKE', true);
slice('DROP', false);

rawFn('VSTACK', 1, 254, (args, ctx) => {
  const mats = args.map((a) => toMatrix(a, ctx));
  const w = Math.max(...mats.map((m) => m[0]?.length ?? 0));
  return matrixToValue(mats.flatMap((m) => m.map((r) => Array.from({ length: w }, (_x, j) => r[j] ?? E.NA))));
});
rawFn('HSTACK', 1, 254, (args, ctx) => {
  const mats = args.map((a) => toMatrix(a, ctx));
  const h = Math.max(...mats.map((m) => m.length));
  return matrixToValue(Array.from({ length: h }, (_x, i) => mats.flatMap((m) => (m[0] ?? []).map((_c, j) => m[i]?.[j] ?? E.NA))));
});
rawFn('TOCOL', 1, 3, (args, ctx) => {
  const ignore = num(args[1], ctx, 0);
  if (isErr(ignore)) return ignore;
  const flat = toMatrix(args[0]!, ctx).flat().filter((v) => !(ignore === 1 || ignore === 3 ? v === null : false) && !(ignore === 2 || ignore === 3 ? isErr(v) : false));
  return flat.length ? matrixToValue(flat.map((v) => [v])) : E.CALC;
});
rawFn('TOROW', 1, 3, (args, ctx) => {
  const ignore = num(args[1], ctx, 0);
  if (isErr(ignore)) return ignore;
  const flat = toMatrix(args[0]!, ctx).flat().filter((v) => !(ignore === 1 || ignore === 3 ? v === null : false) && !(ignore === 2 || ignore === 3 ? isErr(v) : false));
  return flat.length ? matrixToValue([flat]) : E.CALC;
});
rawFn('CHOOSECOLS', 2, 255, (args, ctx) => {
  const m = toMatrix(args[0]!, ctx);
  const w = m[0]?.length ?? 0;
  const idx: number[] = [];
  for (const a of args.slice(1)) {
    for (const v of toMatrix(a, ctx).flat()) {
      const n = toNum(v);
      if (isErr(n)) return n;
      const k = Math.trunc(n);
      const j = k < 0 ? w + k : k - 1;
      if (k === 0 || j < 0 || j >= w) return E.VALUE;
      idx.push(j);
    }
  }
  return matrixToValue(m.map((r) => idx.map((j) => r[j]!)));
});
rawFn('CHOOSEROWS', 2, 255, (args, ctx) => {
  const m = toMatrix(args[0]!, ctx);
  const idx: number[] = [];
  for (const a of args.slice(1)) {
    for (const v of toMatrix(a, ctx).flat()) {
      const n = toNum(v);
      if (isErr(n)) return n;
      const k = Math.trunc(n);
      const i = k < 0 ? m.length + k : k - 1;
      if (k === 0 || i < 0 || i >= m.length) return E.VALUE;
      idx.push(i);
    }
  }
  return matrixToValue(idx.map((i) => m[i]!));
});

void arr;
void ({} as ArrayVal);
