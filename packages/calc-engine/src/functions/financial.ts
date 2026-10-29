import { toNum } from '../coerce';
import { E, isErr, type CalcError, type Scalar } from '../values';
import { rawFn, scalarFn } from './registry';
import { collectNumbers } from './util';

function nums(args: Scalar[], dflt: number[]): number[] | CalcError {
  const out: number[] = [];
  for (let i = 0; i < dflt.length; i++) {
    const a = args[i];
    if (a === undefined || a === null) out.push(dflt[i]!);
    else {
      const n = toNum(a);
      if (isErr(n)) return n;
      out.push(n);
    }
  }
  return out;
}

// Excel conventions: pv + pmt*… + fv = 0, type 1 = payments at period start.
function pmt(rate: number, nper: number, pv: number, fv: number, type: number): number {
  if (rate === 0) return -(pv + fv) / nper;
  const f = Math.pow(1 + rate, nper);
  return -(rate * (pv * f + fv)) / ((1 + rate * type) * (f - 1));
}
function fvOf(rate: number, nper: number, pmtV: number, pv: number, type: number): number {
  if (rate === 0) return -(pv + pmtV * nper);
  const f = Math.pow(1 + rate, nper);
  return -(pv * f + pmtV * (1 + rate * type) * ((f - 1) / rate));
}
function pvOf(rate: number, nper: number, pmtV: number, fv: number, type: number): number {
  if (rate === 0) return -(fv + pmtV * nper);
  const f = Math.pow(1 + rate, nper);
  return -(fv + pmtV * (1 + rate * type) * ((f - 1) / rate)) / f;
}

scalarFn('PMT', 3, 5, (a) => {
  const v = nums(a, [0, 0, 0, 0, 0]);
  if (isErr(v)) return v;
  const [rate, nper, pv, fv, type] = v as [number, number, number, number, number];
  return nper === 0 ? E.NUM : pmt(rate, nper, pv, fv, type);
});
scalarFn('FV', 3, 5, (a) => {
  const v = nums(a, [0, 0, 0, 0, 0]);
  if (isErr(v)) return v;
  const [rate, nper, p, pv, type] = v as [number, number, number, number, number];
  return fvOf(rate, nper, p, pv, type);
});
scalarFn('PV', 3, 5, (a) => {
  const v = nums(a, [0, 0, 0, 0, 0]);
  if (isErr(v)) return v;
  const [rate, nper, p, fv, type] = v as [number, number, number, number, number];
  return pvOf(rate, nper, p, fv, type);
});
scalarFn('NPER', 3, 5, (a) => {
  const v = nums(a, [0, 0, 0, 0, 0]);
  if (isErr(v)) return v;
  const [rate, p, pv, fv, type] = v as [number, number, number, number, number];
  if (rate === 0) return p === 0 ? E.NUM : -(pv + fv) / p;
  const x = (p * (1 + rate * type) - fv * rate) / (p * (1 + rate * type) + pv * rate);
  return x <= 0 ? E.NUM : Math.log(x) / Math.log(1 + rate);
});
function interestPart(rate: number, per: number, nper: number, pv: number, fv: number, type: number): number | CalcError {
  if (per < 1 || per > nper) return E.NUM;
  const p = pmt(rate, nper, pv, fv, type);
  // negative of the outstanding balance before this period (Excel sign convention)
  const negBalance = per === 1 ? -pv : fvOf(rate, per - 1, p, pv, type);
  if (type === 1) return per === 1 ? 0 : (negBalance * rate) / (1 + rate);
  return negBalance * rate;
}
scalarFn('IPMT', 4, 6, (a) => {
  const v = nums(a, [0, 0, 0, 0, 0, 0]);
  if (isErr(v)) return v;
  const [rate, per, nper, pv, fv, type] = v as [number, number, number, number, number, number];
  return interestPart(rate, per, nper, pv, fv, type);
});
scalarFn('PPMT', 4, 6, (a) => {
  const v = nums(a, [0, 0, 0, 0, 0, 0]);
  if (isErr(v)) return v;
  const [rate, per, nper, pv, fv, type] = v as [number, number, number, number, number, number];
  const i = interestPart(rate, per, nper, pv, fv, type);
  return isErr(i) ? i : pmt(rate, nper, pv, fv, type) - i;
});
scalarFn('SLN', 3, 3, ([c, s, l]) => {
  const v = nums([c!, s!, l!], [0, 0, 0]);
  if (isErr(v)) return v;
  return v[2] === 0 ? E.DIV0 : (v[0]! - v[1]!) / v[2]!;
});

rawFn('NPV', 2, 255, (args, ctx) => {
  const r = toNum((args[0] as Scalar) ?? 0);
  if (isErr(r)) return r;
  const c = collectNumbers(args.slice(1), ctx);
  if (c.error) return c.error;
  return c.nums.reduce((acc, cf, i) => acc + cf / Math.pow(1 + r, i + 1), 0);
});

function solve(f: (x: number) => number, guess: number): number | null {
  let x = guess;
  for (let i = 0; i < 100; i++) {
    const y = f(x);
    const h = 1e-6 * Math.max(1, Math.abs(x));
    const d = (f(x + h) - y) / h;
    if (!Number.isFinite(d) || d === 0) return null;
    const next = x - y / d;
    if (!Number.isFinite(next)) return null;
    if (Math.abs(next - x) < 1e-12) return next;
    x = next;
  }
  return null;
}

rawFn('IRR', 1, 2, (args, ctx) => {
  const c = collectNumbers([args[0]!], ctx);
  if (c.error) return c.error;
  if (!c.nums.some((n) => n > 0) || !c.nums.some((n) => n < 0)) return E.NUM;
  const guess = args[1] === undefined ? 0.1 : toNum(args[1] as Scalar);
  if (isErr(guess)) return guess;
  const r = solve((x) => c.nums.reduce((acc, cf, i) => acc + cf / Math.pow(1 + x, i), 0), guess);
  return r === null || r <= -1 ? E.NUM : r;
});

scalarFn('RATE', 3, 6, (a) => {
  const v = nums(a, [0, 0, 0, 0, 0, 0.1]);
  if (isErr(v)) return v;
  const [nper, p, pv, fv, type, guess] = v as [number, number, number, number, number, number];
  const r = solve((x) => (x === 0 ? pv + p * nper + fv : pv * Math.pow(1 + x, nper) + p * (1 + x * type) * ((Math.pow(1 + x, nper) - 1) / x) + fv), guess);
  return r === null ? E.NUM : r;
});
