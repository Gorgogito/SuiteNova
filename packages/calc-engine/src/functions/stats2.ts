import { toNum } from '../coerce';
import { E, arr, isArray, isErr, isRange, type CalcError, type Scalar, type Value } from '../values';
import { alias, rawFn, scalarFn } from './registry';
import { collectNumbers, flatten, scalarOf, toMatrix, toMatrixExact } from './util';

type Ctx = Parameters<typeof collectNumbers>[1];

const sum = (x: number[]) => x.reduce((a, b) => a + b, 0);
const mean = (x: number[]) => sum(x) / x.length;

// ---- linear algebra helpers --------------------------------------------------------------------------
type Mat = number[][];

/** Matrix of numbers from a value; any text, empty cell or error makes it invalid. */
function numMatrix(v: Value, ctx: Ctx): Mat | CalcError {
  const m = toMatrixExact(v, ctx);
  const out: Mat = [];
  for (const row of m) {
    const r: number[] = [];
    for (const c of row) {
      if (isErr(c)) return c;
      if (typeof c === 'boolean' || c === null || typeof c === 'string') return E.VALUE;
      r.push(c);
    }
    out.push(r);
  }
  return out.length && out[0]!.length ? out : E.VALUE;
}

function inverse(m: Mat): Mat | null {
  const n = m.length;
  const a = m.map((r, i) => [...r, ...Array.from({ length: n }, (_x, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[p]![c]!)) p = r;
    if (Math.abs(a[p]![c]!) < 1e-300) return null;
    [a[c], a[p]] = [a[p]!, a[c]!];
    const d = a[c]![c]!;
    for (let j = 0; j < 2 * n; j++) a[c]![j]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r]![c]!;
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) a[r]![j]! -= f * a[c]![j]!;
    }
  }
  return a.map((r) => r.slice(n));
}

function determinant(m: Mat): number {
  const n = m.length;
  const a = m.map((r) => [...r]);
  let det = 1;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[p]![c]!)) p = r;
    if (a[p]![c] === 0) return 0;
    if (p !== c) {
      [a[c], a[p]] = [a[p]!, a[c]!];
      det = -det;
    }
    det *= a[c]![c]!;
    for (let r = c + 1; r < n; r++) {
      const f = a[r]![c]! / a[c]![c]!;
      for (let j = c; j < n; j++) a[r]![j]! -= f * a[c]![j]!;
    }
  }
  return det;
}

const mul = (a: Mat, b: Mat): Mat => a.map((row) => b[0]!.map((_x, j) => row.reduce((s, v, k) => s + v * b[k]![j]!, 0)));
const transpose = (a: Mat): Mat => a[0]!.map((_x, j) => a.map((r) => r[j]!));

rawFn('MMULT', 2, 2, (args, ctx) => {
  const a = numMatrix(args[0]!, ctx);
  if (isErr(a)) return a;
  const b = numMatrix(args[1]!, ctx);
  if (isErr(b)) return b;
  if (a[0]!.length !== b.length) return E.VALUE;
  return arr(mul(a, b));
});
rawFn('MDETERM', 1, 1, (args, ctx) => {
  const a = numMatrix(args[0]!, ctx);
  if (isErr(a)) return a;
  if (a.length !== a[0]!.length) return E.VALUE;
  return determinant(a);
});
rawFn('MINVERSE', 1, 1, (args, ctx) => {
  const a = numMatrix(args[0]!, ctx);
  if (isErr(a)) return a;
  if (a.length !== a[0]!.length) return E.VALUE;
  const inv = inverse(a);
  return inv ? arr(inv) : E.NUM;
});
rawFn('MUNIT', 1, 1, (args, ctx) => {
  const n = toNum(scalarOf(args[0]!, ctx));
  if (isErr(n)) return n;
  const k = Math.trunc(n);
  if (k < 1 || k > 1000) return E.VALUE;
  return arr(Array.from({ length: k }, (_x, i) => Array.from({ length: k }, (_y, j) => (i === j ? 1 : 0))));
});

// ---- regression: LINEST, LOGEST, TREND, GROWTH ---------------------------------------------------------
interface Fit {
  /** Coefficients in the order of the x columns, then the intercept. */
  coef: number[];
  se: number[];
  r2: number;
  sey: number;
  f: number;
  df: number;
  ssreg: number;
  ssresid: number;
  k: number;
  hasIntercept: boolean;
}

/** Y as a column; X as columns (when rows ≠ the length of Y it is read as rows, as Excel does). */
function shapeXY(yv: Mat, xv: Mat | null): { y: number[]; x: number[][] } | CalcError {
  const yFlat = yv.flat();
  const n = yFlat.length;
  if (yv.length !== 1 && yv[0]!.length !== 1) return E.REF;
  if (!xv) return { y: yFlat, x: yFlat.map((_v, i) => [i + 1]) };
  let x: number[][];
  if (yv[0]!.length === 1) {
    // y is a column: each column of X is a variable
    if (xv.length !== n) return E.REF;
    x = xv;
  } else {
    // y is a row: each row of X is a variable
    if ((xv[0]?.length ?? 0) !== n) return E.REF;
    x = transpose(xv);
  }
  return { y: yFlat, x };
}

function fit(y: number[], x: number[][], intercept: boolean): Fit | CalcError {
  const n = y.length;
  const k = x[0]!.length;
  const cols = intercept ? k + 1 : k;
  if (n < cols) return E.NUM;
  const design = x.map((row) => (intercept ? [...row, 1] : row));
  const xt = transpose(design);
  const xtx = mul(xt, design);
  const inv = inverse(xtx);
  if (!inv) return E.NUM;
  const xty = mul(xt, y.map((v) => [v]));
  const beta = mul(inv, xty).map((r) => r[0]!);
  const yhat = design.map((row) => row.reduce((s, v, j) => s + v * beta[j]!, 0));
  const ssresid = y.reduce((s, v, i) => s + (v - yhat[i]!) ** 2, 0);
  const ym = mean(y);
  const sstot = intercept ? y.reduce((s, v) => s + (v - ym) ** 2, 0) : y.reduce((s, v) => s + v * v, 0);
  const df = n - cols;
  const ssreg = sstot - ssresid;
  const r2 = sstot === 0 ? 1 : ssreg / sstot;
  const sey = df > 0 ? Math.sqrt(ssresid / df) : NaN;
  const se = inv.map((row, i) => (df > 0 ? sey * Math.sqrt(row[i]!) : NaN));
  const f = df > 0 && ssresid > 0 ? ssreg / k / (ssresid / df) : NaN;
  return { coef: beta, se, r2, sey, f, df, ssreg, ssresid, k, hasIntercept: intercept };
}

function boolArg(v: Value | undefined, dflt: boolean, ctx: Ctx): boolean | CalcError {
  if (v === undefined) return dflt;
  const s = scalarOf(v, ctx);
  if (s === null) return dflt;
  const n = toNum(s);
  return isErr(n) ? n : n !== 0;
}

function linest(args: Value[], ctx: Ctx, logarithmic: boolean): Value {
  const yv = numMatrix(args[0]!, ctx);
  if (isErr(yv)) return yv;
  let xv: Mat | null = null;
  if (args[1] !== undefined && args[1] !== null && !(typeof args[1] === 'object' && 'kind' in args[1]! && false)) {
    const m = numMatrix(args[1], ctx);
    if (isErr(m)) return args[1] === null ? E.VALUE : m;
    xv = m;
  }
  const intercept = boolArg(args[2], true, ctx);
  if (isErr(intercept)) return intercept;
  const stats = boolArg(args[3], false, ctx);
  if (isErr(stats)) return stats;
  const shaped = shapeXY(yv, xv);
  if (isErr(shaped)) return shaped;
  let y = shaped.y;
  if (logarithmic) {
    if (y.some((v) => v <= 0)) return E.NUM;
    y = y.map(Math.log);
  }
  const r = fit(y, shaped.x, intercept);
  if (isErr(r)) return r;
  const k = r.k;
  // Excel lists the coefficients of the last x column first, the intercept last
  const order = Array.from({ length: k }, (_x, i) => k - 1 - i);
  const coefRow = [...order.map((i) => r.coef[i]!), intercept ? r.coef[k]! : 0];
  const seRow = [...order.map((i) => r.se[i]!), intercept ? r.se[k]! : NaN];
  const tf = (v: number) => (logarithmic ? Math.exp(v) : v);
  const out: Scalar[][] = [coefRow.map((v, i) => (logarithmic && !(i === k && !intercept) ? tf(v) : v))];
  if (logarithmic && !intercept) out[0]![k] = 1;
  if (stats) {
    const width = k + 1;
    const pad = (a: Scalar[]): Scalar[] => [...a, ...Array.from({ length: width - a.length }, () => E.NA as Scalar)];
    out.push(seRow.map((v) => (Number.isNaN(v) ? E.NA : v)));
    out.push(pad([r.r2, Number.isNaN(r.sey) ? E.NA : r.sey]));
    out.push(pad([Number.isNaN(r.f) ? E.NA : r.f, r.df]));
    out.push(pad([r.ssreg, r.ssresid]));
  }
  return arr(out);
}
rawFn('LINEST', 1, 4, (args, ctx) => linest(args, ctx, false));
rawFn('LOGEST', 1, 4, (args, ctx) => linest(args, ctx, true));

function predict(args: Value[], ctx: Ctx, logarithmic: boolean): Value {
  const yv = numMatrix(args[0]!, ctx);
  if (isErr(yv)) return yv;
  const xv = args[1] !== undefined && args[1] !== null ? numMatrix(args[1], ctx) : null;
  if (xv && isErr(xv)) return xv;
  const intercept = boolArg(args[3], true, ctx);
  if (isErr(intercept)) return intercept;
  const shaped = shapeXY(yv, xv);
  if (isErr(shaped)) return shaped;
  let y = shaped.y;
  if (logarithmic) {
    if (y.some((v) => v <= 0)) return E.NUM;
    y = y.map(Math.log);
  }
  const r = fit(y, shaped.x, intercept);
  if (isErr(r)) return r;
  const k = r.k;
  let newX: number[][];
  if (args[2] === undefined || args[2] === null) newX = shaped.x;
  else {
    const nx = numMatrix(args[2], ctx);
    if (isErr(nx)) return nx;
    newX = k === 1 ? nx.flat().map((v) => [v]) : yv[0]!.length === 1 ? nx : transpose(nx);
    if (newX[0]!.length !== k) return E.REF;
  }
  const rows = newX.map((row) => {
    const v = row.reduce((s, x, j) => s + x * r.coef[j]!, 0) + (intercept ? r.coef[k]! : 0);
    return logarithmic ? Math.exp(v) : v;
  });
  // the answer has the orientation of Y
  return arr(yv[0]!.length === 1 || yv.length === 1 && yv[0]!.length === 1 ? rows.map((v) => [v]) : [rows]);
}
rawFn('TREND', 1, 4, (args, ctx) => predict(args, ctx, false));
rawFn('GROWTH', 1, 4, (args, ctx) => predict(args, ctx, true));

// ---- paired statistics -------------------------------------------------------------------------------
function pairs(a: Value, b: Value, ctx: Ctx): { x: number[]; y: number[] } | CalcError {
  const xa = flatten(a, ctx);
  const xb = flatten(b, ctx);
  if (xa.length !== xb.length) return E.NA;
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < xa.length; i++) {
    const p = xa[i]!;
    const q = xb[i]!;
    if (isErr(p)) return p;
    if (isErr(q)) return q;
    if (typeof p === 'number' && typeof q === 'number') {
      x.push(p);
      y.push(q);
    }
  }
  return { x, y };
}

function pairFn(name: string, f: (x: number[], y: number[]) => Scalar): void {
  rawFn(name, 2, 2, (args, ctx) => {
    const p = pairs(args[0]!, args[1]!, ctx);
    return isErr(p) ? p : f(p.x, p.y);
  });
}
const covSum = (x: number[], y: number[]) => {
  const mx = mean(x);
  const my = mean(y);
  return x.reduce((s, v, i) => s + (v - mx) * (y[i]! - my), 0);
};
pairFn('COVARIANCE.P', (x, y) => (x.length < 1 ? E.DIV0 : covSum(x, y) / x.length));
alias('COVAR', 'COVARIANCE.P');
pairFn('COVARIANCE.S', (x, y) => (x.length < 2 ? E.DIV0 : covSum(x, y) / (x.length - 1)));
pairFn('RSQ', (x, y) => {
  if (x.length < 2) return E.DIV0;
  const sxy = covSum(x, y);
  const sxx = covSum(x, x);
  const syy = covSum(y, y);
  return sxx === 0 || syy === 0 ? E.DIV0 : (sxy * sxy) / (sxx * syy);
});
pairFn('STEYX', (y, x) => {
  if (x.length < 3) return E.DIV0;
  const sxx = covSum(x, x);
  const syy = covSum(y, y);
  const sxy = covSum(x, y);
  if (sxx === 0) return E.DIV0;
  return Math.sqrt(Math.max(0, syy - (sxy * sxy) / sxx) / (x.length - 2));
});
pairFn('SUMX2MY2', (x, y) => x.reduce((s, v, i) => s + v * v - y[i]! * y[i]!, 0));
pairFn('SUMX2PY2', (x, y) => x.reduce((s, v, i) => s + v * v + y[i]! * y[i]!, 0));
pairFn('SUMXMY2', (x, y) => x.reduce((s, v, i) => s + (v - y[i]!) ** 2, 0));
alias('PEARSON', 'CORREL');

// ---- one-variable statistics --------------------------------------------------------------------------
function numbersFn(name: string, min: number, f: (x: number[]) => Scalar, max = 255): void {
  rawFn(name, 1, max, (args, ctx) => {
    const c = collectNumbers(args, ctx);
    if (c.error) return c.error;
    return c.nums.length < min ? E.DIV0 : f(c.nums);
  });
}
const sdev = (x: number[], sample: boolean) => Math.sqrt(x.reduce((s, v) => s + (v - mean(x)) ** 2, 0) / (x.length - (sample ? 1 : 0)));
numbersFn('GEOMEAN', 1, (x) => (x.some((v) => v <= 0) ? E.NUM : Math.exp(mean(x.map(Math.log)))));
numbersFn('HARMEAN', 1, (x) => (x.some((v) => v <= 0) ? E.NUM : x.length / sum(x.map((v) => 1 / v))));
numbersFn('DEVSQ', 1, (x) => x.reduce((s, v) => s + (v - mean(x)) ** 2, 0));
numbersFn('AVEDEV', 1, (x) => sum(x.map((v) => Math.abs(v - mean(x)))) / x.length);
numbersFn('SKEW', 3, (x) => {
  const s = sdev(x, true);
  if (s === 0) return E.DIV0;
  const n = x.length;
  return (n / ((n - 1) * (n - 2))) * sum(x.map((v) => ((v - mean(x)) / s) ** 3));
});
numbersFn('SKEW.P', 1, (x) => {
  const s = sdev(x, false);
  return s === 0 ? E.DIV0 : sum(x.map((v) => ((v - mean(x)) / s) ** 3)) / x.length;
});
numbersFn('KURT', 4, (x) => {
  const s = sdev(x, true);
  if (s === 0) return E.DIV0;
  const n = x.length;
  const m = mean(x);
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum(x.map((v) => ((v - m) / s) ** 4)) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
});

rawFn('TRIMMEAN', 2, 2, (args, ctx) => {
  const c = collectNumbers([args[0]!], ctx);
  if (c.error) return c.error;
  const p = toNum(scalarOf(args[1]!, ctx));
  if (isErr(p)) return p;
  if (p < 0 || p >= 1 || !c.nums.length) return E.NUM;
  const sorted = c.nums.slice().sort((a, b) => a - b);
  const k = Math.floor((sorted.length * p) / 2);
  const kept = sorted.slice(k, sorted.length - k);
  return mean(kept);
});

/** The "A" statistics count text as 0 and TRUE/FALSE as 1/0 inside ranges. */
function collectA(args: Value[], ctx: Ctx): number[] | CalcError {
  const out: number[] = [];
  const push = (v: Scalar, direct: boolean): CalcError | null => {
    if (isErr(v)) return v;
    if (typeof v === 'number') out.push(v);
    else if (typeof v === 'boolean') out.push(v ? 1 : 0);
    else if (typeof v === 'string') {
      if (direct) {
        const n = toNum(v);
        if (isErr(n)) return n;
        out.push(n);
      } else out.push(0);
    }
    return null;
  };
  for (const a of args) {
    if (isRange(a)) {
      let err: CalcError | null = null;
      ctx.host.forEachCell(a, (_r, _c, v) => {
        err ??= push(v, false);
      });
      if (err) return err;
    } else if (isArray(a)) {
      for (const v of a.rows.flat()) {
        const e = push(v, false);
        if (e) return e;
      }
    } else if (a !== null) {
      const e = push(a as Scalar, true);
      if (e) return e;
    }
  }
  return out;
}
function aFn(name: string, f: (x: number[]) => Scalar): void {
  rawFn(name, 1, 255, (args, ctx) => {
    const x = collectA(args, ctx);
    return isErr(x) ? x : f(x);
  });
}
aFn('AVERAGEA', (x) => (x.length ? mean(x) : E.DIV0));
aFn('MAXA', (x) => (x.length ? Math.max(...x) : 0));
aFn('MINA', (x) => (x.length ? Math.min(...x) : 0));
aFn('STDEVA', (x) => (x.length < 2 ? E.DIV0 : sdev(x, true)));
aFn('STDEVPA', (x) => (x.length < 1 ? E.DIV0 : sdev(x, false)));
aFn('VARA', (x) => (x.length < 2 ? E.DIV0 : sdev(x, true) ** 2));
aFn('VARPA', (x) => (x.length < 1 ? E.DIV0 : sdev(x, false) ** 2));

// ---- ranks and frequencies ---------------------------------------------------------------------------
function percentRank(name: string, exclusive: boolean): void {
  rawFn(name, 2, 3, (args, ctx) => {
    const c = collectNumbers([args[0]!], ctx);
    if (c.error) return c.error;
    const x = toNum(scalarOf(args[1]!, ctx));
    if (isErr(x)) return x;
    const sig = args[2] === undefined ? 3 : toNum(scalarOf(args[2], ctx));
    if (isErr(sig)) return sig;
    if (sig < 1) return E.NUM;
    const v = c.nums.slice().sort((a, b) => a - b);
    const n = v.length;
    if (!n) return E.NA;
    if (x < v[0]! || x > v[n - 1]!) return E.NA;
    let i = 0;
    while (i < n - 1 && v[i + 1]! <= x) i++;
    let pos: number;
    if (v[i] === x) pos = i;
    else pos = i + (x - v[i]!) / (v[i + 1]! - v[i]!);
    const r = exclusive ? (pos + 1) / (n + 1) : n === 1 ? 1 : pos / (n - 1);
    if (exclusive && (pos + 1) / (n + 1) <= 0) return E.NUM;
    const f = 10 ** Math.trunc(sig);
    return Math.floor(r * f + 1e-9) / f;
  });
}
percentRank('PERCENTRANK.INC', false);
percentRank('PERCENTRANK.EXC', true);
alias('PERCENTRANK', 'PERCENTRANK.INC');

rawFn('PROB', 3, 4, (args, ctx) => {
  const xs = flatten(args[0]!, ctx);
  const ps = flatten(args[1]!, ctx);
  if (xs.length !== ps.length) return E.NA;
  const lo = toNum(scalarOf(args[2]!, ctx));
  if (isErr(lo)) return lo;
  const hi = args[3] === undefined ? lo : toNum(scalarOf(args[3], ctx));
  if (isErr(hi)) return hi;
  let total = 0;
  let inRange = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!;
    const p = ps[i]!;
    if (isErr(x)) return x;
    if (isErr(p)) return p;
    if (typeof p !== 'number' || p < 0 || p > 1) return E.NUM;
    total += p;
    if (typeof x === 'number' && x >= lo && x <= hi) inRange += p;
  }
  return Math.abs(total - 1) > 1e-9 ? E.NUM : inRange;
});

rawFn('FREQUENCY', 2, 2, (args, ctx) => {
  const data = collectNumbers([args[0]!], ctx);
  const bins = collectNumbers([args[1]!], ctx);
  if (data.error) return data.error;
  if (bins.error) return bins.error;
  const b = bins.nums.slice().sort((x, y) => x - y);
  const counts = new Array<number>(b.length + 1).fill(0);
  for (const v of data.nums) {
    let i = 0;
    while (i < b.length && v > b[i]!) i++;
    counts[i]!++;
  }
  return arr(counts.map((n) => [n]));
});

rawFn('MODE.MULT', 1, 255, (args, ctx) => {
  const c = collectNumbers(args, ctx);
  if (c.error) return c.error;
  const counts = new Map<number, number>();
  for (const v of c.nums) counts.set(v, (counts.get(v) ?? 0) + 1);
  const best = Math.max(0, ...counts.values());
  if (best < 2) return E.NA;
  const modes = c.nums.filter((v, i) => counts.get(v) === best && c.nums.indexOf(v) === i);
  return arr(modes.map((v) => [v]));
});

// ---- combinatorics and other numeric functions -------------------------------------------------------
function fact(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}
function numFn(name: string, min: number, max: number, f: (a: number[]) => number | CalcError): void {
  scalarFn(name, min, max, (args) => {
    const a: number[] = [];
    for (const x of args) {
      const n = toNum(x);
      if (isErr(n)) return n;
      a.push(n);
    }
    const r = f(a);
    return typeof r === 'number' && !Number.isFinite(r) ? E.NUM : r;
  });
}
const choose = (n: number, k: number): number => {
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
};
numFn('COMBIN', 2, 2, ([n, k]) => {
  const a = Math.trunc(n!);
  const b = Math.trunc(k!);
  return a < 0 || b < 0 || b > a ? E.NUM : choose(a, b);
});
numFn('COMBINA', 2, 2, ([n, k]) => {
  const a = Math.trunc(n!);
  const b = Math.trunc(k!);
  if (a < 0 || b < 0) return E.NUM;
  if (a === 0) return b === 0 ? 1 : E.NUM;
  return choose(a + b - 1, b);
});
numFn('PERMUT', 2, 2, ([n, k]) => {
  const a = Math.trunc(n!);
  const b = Math.trunc(k!);
  if (a < 0 || b < 0 || b > a) return E.NUM;
  let r = 1;
  for (let i = 0; i < b; i++) r *= a - i;
  return r;
});
numFn('PERMUTATIONA', 2, 2, ([n, k]) => (n! < 0 || k! < 0 ? E.NUM : Math.trunc(n!) ** Math.trunc(k!)));
numFn('FACTDOUBLE', 1, 1, ([n]) => {
  const a = Math.trunc(n!);
  if (a < -1) return E.NUM;
  let r = 1;
  for (let i = a; i > 1; i -= 2) r *= i;
  return r;
});
rawFn('MULTINOMIAL', 1, 255, (args, ctx) => {
  const c = collectNumbers(args, ctx);
  if (c.error) return c.error;
  if (c.nums.some((v) => v < 0)) return E.NUM;
  const k = c.nums.map(Math.trunc);
  return fact(sum(k)) / k.reduce((p, v) => p * fact(v), 1);
});
numFn('SQRTPI', 1, 1, ([x]) => (x! < 0 ? E.NUM : Math.sqrt(x! * Math.PI)));
numFn('ACOSH', 1, 1, ([x]) => (x! < 1 ? E.NUM : Math.acosh(x!)));
numFn('ASINH', 1, 1, ([x]) => Math.asinh(x!));
numFn('ATANH', 1, 1, ([x]) => (x! <= -1 || x! >= 1 ? E.NUM : Math.atanh(x!)));
numFn('COT', 1, 1, ([x]) => (x === 0 ? E.DIV0 : 1 / Math.tan(x!)));
numFn('COTH', 1, 1, ([x]) => (x === 0 ? E.DIV0 : 1 / Math.tanh(x!)));
numFn('CSC', 1, 1, ([x]) => (x === 0 ? E.DIV0 : 1 / Math.sin(x!)));
numFn('CSCH', 1, 1, ([x]) => (x === 0 ? E.DIV0 : 1 / Math.sinh(x!)));
numFn('SEC', 1, 1, ([x]) => 1 / Math.cos(x!));
numFn('SECH', 1, 1, ([x]) => 1 / Math.cosh(x!));
numFn('ACOT', 1, 1, ([x]) => Math.PI / 2 - Math.atan(x!));
numFn('ACOTH', 1, 1, ([x]) => (Math.abs(x!) <= 1 ? E.NUM : 0.5 * Math.log((x! + 1) / (x! - 1))));

const ROMAN: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
scalarFn('ROMAN', 1, 2, ([a]) => {
  const n = toNum(a!);
  if (isErr(n)) return n;
  let v = Math.trunc(n);
  if (v < 0 || v > 3999) return E.VALUE;
  if (v === 0) return '';
  let s = '';
  for (const [k, r] of ROMAN) while (v >= k) {
    s += r;
    v -= k;
  }
  return s;
});
scalarFn('ARABIC', 1, 1, ([a]) => {
  if (typeof a !== 'string') return E.VALUE;
  const t = a.trim().toUpperCase();
  if (t === '') return 0;
  const neg = t.startsWith('-');
  const s = neg ? t.slice(1) : t;
  const val: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = val[s[i]!];
    if (v === undefined) return E.VALUE;
    const next = val[s[i + 1] ?? ''] ?? 0;
    total += v < next ? -v : v;
  }
  return neg ? -total : total;
});
scalarFn('BASE', 2, 3, ([a, b, c]) => {
  const n = toNum(a!);
  const radix = toNum(b!);
  if (isErr(n)) return n;
  if (isErr(radix)) return radix;
  const minLen = c === undefined || c === null ? 0 : toNum(c);
  if (isErr(minLen)) return minLen;
  if (n < 0 || n >= 2 ** 53 || radix < 2 || radix > 36 || minLen < 0 || minLen > 255) return E.NUM;
  return Math.trunc(n).toString(Math.trunc(radix)).toUpperCase().padStart(Math.trunc(minLen), '0');
});
scalarFn('DECIMAL', 2, 2, ([a, b]) => {
  const radix = toNum(b!);
  if (isErr(radix)) return radix;
  if (radix < 2 || radix > 36) return E.NUM;
  const t = (typeof a === 'string' ? a : String(a)).trim().toUpperCase();
  let n = 0;
  for (const ch of t) {
    const d = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(ch);
    if (d < 0 || d >= radix) return E.NUM;
    n = n * Math.trunc(radix) + d;
  }
  return n;
});
rawFn('SERIESSUM', 4, 4, (args, ctx) => {
  const x = toNum(scalarOf(args[0]!, ctx));
  const n = toNum(scalarOf(args[1]!, ctx));
  const m = toNum(scalarOf(args[2]!, ctx));
  if (isErr(x)) return x;
  if (isErr(n)) return n;
  if (isErr(m)) return m;
  const coefs = toMatrix(args[3]!, ctx).flat();
  let total = 0;
  for (let i = 0; i < coefs.length; i++) {
    const c = coefs[i]!;
    if (isErr(c)) return c;
    if (typeof c !== 'number') return E.VALUE;
    total += c * x ** (n + i * m);
  }
  return total;
});
