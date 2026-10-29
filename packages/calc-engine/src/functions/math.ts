import { toNum } from '../coerce';
import { E, arr, isErr, isRange, type CalcError, type Scalar, type Value } from '../values';
import { rawFn, scalarFn, alias } from './registry';
import { collectNumbers, toMatrix } from './util';

const finite = (n: number): number | CalcError => (Number.isFinite(n) ? n : E.NUM);

function fn1(name: string, f: (x: number) => number | CalcError): void {
  scalarFn(name, 1, 1, ([a]) => {
    const x = toNum(a!);
    if (isErr(x)) return x;
    const r = f(x);
    return typeof r === 'number' ? finite(r) : r;
  });
}

function fn2(name: string, min: number, f: (x: number, y: number) => number | CalcError, dflt?: number): void {
  scalarFn(name, min, 2, ([a, b]) => {
    const x = toNum(a!);
    if (isErr(x)) return x;
    const y = b === undefined || b === null ? (dflt ?? 0) : toNum(b);
    if (isErr(y)) return y;
    const r = f(x, y);
    return typeof r === 'number' ? finite(r) : r;
  });
}

/** Round half away from zero, with a nudge that fixes cases like 1.005 → 1.01. */
export function roundHalfAway(x: number, digits: number): number {
  const f = Math.pow(10, digits);
  const m = Math.abs(x) * f * (1 + Number.EPSILON);
  const r = Math.floor(m + 0.5);
  return (Math.sign(x) * r) / f;
}

fn1('ABS', Math.abs);
fn1('SQRT', (x) => (x < 0 ? E.NUM : Math.sqrt(x)));
fn1('EXP', Math.exp);
fn1('LN', (x) => (x <= 0 ? E.NUM : Math.log(x)));
fn1('LOG10', (x) => (x <= 0 ? E.NUM : Math.log10(x)));
fn1('SIN', Math.sin);
fn1('COS', Math.cos);
fn1('TAN', Math.tan);
fn1('ASIN', (x) => (x < -1 || x > 1 ? E.NUM : Math.asin(x)));
fn1('ACOS', (x) => (x < -1 || x > 1 ? E.NUM : Math.acos(x)));
fn1('ATAN', Math.atan);
fn1('SINH', Math.sinh);
fn1('COSH', Math.cosh);
fn1('TANH', Math.tanh);
fn1('DEGREES', (x) => (x * 180) / Math.PI);
fn1('RADIANS', (x) => (x * Math.PI) / 180);
fn1('INT', Math.floor);
fn1('SIGN', Math.sign);
fn1('FACT', (x) => {
  const n = Math.floor(x);
  if (n < 0 || n > 170) return E.NUM;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
});
fn1('EVEN', (x) => {
  const s = Math.sign(x) || 1;
  const a = Math.ceil(Math.abs(x));
  return s * (a % 2 === 0 ? a : a + 1);
});
fn1('ODD', (x) => {
  const s = Math.sign(x) || 1;
  const a = Math.ceil(Math.abs(x));
  return s * (a % 2 === 1 ? a : a + 1);
});

scalarFn('PI', 0, 0, () => Math.PI);
fn2('ATAN2', 2, (x, y) => (x === 0 && y === 0 ? E.DIV0 : Math.atan2(y, x)));
fn2('POWER', 2, (x, y) => (x === 0 && y === 0 ? E.NUM : Math.pow(x, y)));
fn2('MOD', 2, (x, y) => (y === 0 ? E.DIV0 : x - y * Math.floor(x / y)));
fn2('QUOTIENT', 2, (x, y) => (y === 0 ? E.DIV0 : Math.trunc(x / y)));
fn2('ROUND', 2, (x, d) => roundHalfAway(x, Math.trunc(d)));
fn2('ROUNDUP', 2, (x, d) => {
  const f = Math.pow(10, Math.trunc(d));
  return (Math.sign(x) * Math.ceil(Math.abs(x) * f - 1e-9)) / f;
});
fn2('ROUNDDOWN', 2, (x, d) => {
  const f = Math.pow(10, Math.trunc(d));
  return (Math.sign(x) * Math.floor(Math.abs(x) * f + 1e-9)) / f;
});
scalarFn('TRUNC', 1, 2, ([a, b]) => {
  const x = toNum(a!);
  if (isErr(x)) return x;
  const d = b === undefined || b === null ? 0 : toNum(b);
  if (isErr(d)) return d;
  const f = Math.pow(10, Math.trunc(d));
  return finite((Math.sign(x) * Math.floor(Math.abs(x) * f + 1e-9)) / f);
});
fn2('CEILING', 1, (x, s) => (s === 0 ? 0 : x > 0 && s < 0 ? E.NUM : Math.ceil(x / s - 1e-12) * s), 1);
fn2('FLOOR', 1, (x, s) => (s === 0 ? E.DIV0 : x > 0 && s < 0 ? E.NUM : Math.floor(x / s + 1e-12) * s), 1);
fn2('MROUND', 2, (x, m) => (m === 0 ? 0 : x * m < 0 ? E.NUM : roundHalfAway(x / m, 0) * m));
scalarFn('LOG', 1, 2, ([a, b]) => {
  const x = toNum(a!);
  if (isErr(x)) return x;
  const base = b === undefined || b === null ? 10 : toNum(b);
  if (isErr(base)) return base;
  if (x <= 0 || base <= 0 || base === 1) return E.NUM;
  return finite(Math.log(x) / Math.log(base));
});
scalarFn('RAND', 0, 0, (_a, ctx) => ctx.host.random(), { volatile: true });
scalarFn(
  'RANDBETWEEN',
  2,
  2,
  ([a, b], ctx) => {
    const lo = toNum(a!);
    if (isErr(lo)) return lo;
    const hi = toNum(b!);
    if (isErr(hi)) return hi;
    if (Math.ceil(lo) > Math.floor(hi)) return E.NUM;
    return Math.ceil(lo) + Math.floor(ctx.host.random() * (Math.floor(hi) - Math.ceil(lo) + 1));
  },
  { volatile: true },
);

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
rawFn('GCD', 1, 255, (args, ctx) => {
  const c = collectNumbers(args, ctx);
  if (c.error) return c.error;
  if (c.nums.some((n) => n < 0)) return E.NUM;
  return c.nums.reduce((a, n) => gcd(a, Math.trunc(n)), 0);
});
rawFn('LCM', 1, 255, (args, ctx) => {
  const c = collectNumbers(args, ctx);
  if (c.error) return c.error;
  if (c.nums.some((n) => n < 0)) return E.NUM;
  return c.nums.reduce((a, n) => (a === 0 || n === 0 ? 0 : (a * Math.trunc(n)) / gcd(a, Math.trunc(n))), 1);
});

// ---- aggregation ---------------------------------------------------------------------------
rawFn('SUM', 1, 255, (args, ctx) => {
  const c = collectNumbers(args, ctx);
  if (c.error) return c.error;
  let s = 0;
  for (const n of c.nums) s += n;
  return finite(s);
});
rawFn('PRODUCT', 1, 255, (args, ctx) => {
  const c = collectNumbers(args, ctx);
  if (c.error) return c.error;
  if (c.nums.length === 0) return 0;
  return finite(c.nums.reduce((a, n) => a * n, 1));
});
rawFn('MIN', 1, 255, (args, ctx) => {
  const c = collectNumbers(args, ctx);
  return c.error ?? (c.nums.length ? Math.min(...c.nums) : 0);
});
rawFn('MAX', 1, 255, (args, ctx) => {
  const c = collectNumbers(args, ctx);
  return c.error ?? (c.nums.length ? Math.max(...c.nums) : 0);
});

rawFn('SUMPRODUCT', 1, 255, (args, ctx) => {
  const mats = args.map((a) => toMatrix(a, ctx));
  const h = mats[0]!.length;
  const w = mats[0]![0]?.length ?? 0;
  if (mats.some((m) => m.length !== h || (m[0]?.length ?? 0) !== w)) return E.VALUE;
  let total = 0;
  for (let i = 0; i < h; i++) {
    for (let j = 0; j < w; j++) {
      let p = 1;
      for (const m of mats) {
        const v = m[i]![j]!;
        if (isErr(v)) return v;
        p *= typeof v === 'number' ? v : 0;
      }
      total += p;
    }
  }
  return finite(total);
});

rawFn('SUMSQ', 1, 255, (args, ctx) => {
  const c = collectNumbers(args, ctx);
  return c.error ?? finite(c.nums.reduce((a, n) => a + n * n, 0));
});

rawFn('SUBTOTAL', 2, 255, (args, ctx) => {
  const f = toNum(args[0] as Scalar);
  if (isErr(f)) return f;
  const raw = Math.trunc(f);
  const code = raw % 100;
  const names: Record<number, string> = { 1: 'AVERAGE', 2: 'COUNT', 3: 'COUNTA', 4: 'MAX', 5: 'MIN', 6: 'PRODUCT', 7: 'STDEV.S', 8: 'STDEV.P', 9: 'SUM', 10: 'VAR.S', 11: 'VAR.P' };
  const target = names[code];
  if (!target || raw < 1 || raw > 111) return E.VALUE;
  // 1-11 skip rows hidden by a filter; 101-111 also skip rows hidden by hand
  const filteredOnly = raw < 100;
  const visible = args.slice(1).map((a) => {
    if (!isRange(a)) return a;
    const c = ctx.host.clip(a);
    const rows: Scalar[][] = [];
    for (let r = c.r1; r <= c.r2; r++) {
      if (ctx.host.rowHidden(a.sheetId, r, filteredOnly)) continue;
      const line: Scalar[] = [];
      for (let col = c.c1; col <= c.c2; col++) line.push(ctx.host.cellValue(a.sheetId, r, col));
      rows.push(line);
    }
    return rows.length ? arr(rows) : arr([[null]]);
  });
  return registryCall(target, visible, ctx);
});

import { registry, type Ctx } from './registry';
function registryCall(name: string, args: Value[], ctx: Ctx): Value {
  const d = registry.get(name);
  return d ? d.impl(args, ctx) : E.NAME;
}

alias('CEILING.MATH', 'CEILING');
alias('FLOOR.MATH', 'FLOOR');
