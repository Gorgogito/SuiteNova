/**
 * Segunda tanda de funciones financieras de Excel: flujos con fechas (XNPV, XIRR), MIRR, tasas, depreciación (DB, DDB, SYD, VDB),
 * pagos acumulados, fracciones de dólar y valores de renta fija (cupones, PRECIO, RENDTO, DURACION, letras del tesoro…).
 */
import { toBool, toNum } from '../coerce';
import { daysInMonth, serialFromYMD, ymdFromSerial } from '../dates';
import { E, isErr, type CalcError, type Scalar, type Value } from '../values';
import { interestPart, pmt, solve } from './financial';
import { rawFn, scalarFn } from './registry';
import { flatten } from './util';

// ---- argumentos ------------------------------------------------------------------------------------
/** Number argument i, or the default when it is missing/empty. */
function arg(a: Scalar[], i: number, dflt?: number): number | CalcError {
  const v = a[i];
  if (v === undefined || v === null) return dflt === undefined ? E.VALUE : dflt;
  return toNum(v);
}
function nums(a: Scalar[], spec: (number | undefined)[]): number[] | CalcError {
  const out: number[] = [];
  for (let i = 0; i < spec.length; i++) {
    const n = arg(a, i, spec[i]);
    if (isErr(n)) return n;
    out.push(n);
  }
  return out;
}
/** Serial dates are truncated to whole days. */
function dates(v: number[], idx: number[]): void {
  for (const i of idx) v[i] = Math.floor(v[i]!);
}

// ---- recuento de días ------------------------------------------------------------------------------
const lastDayOfFeb = (y: number, m: number, d: number) => m === 2 && d === daysInMonth(y, 2);

/** 30/360. `eu` = método europeo; si no, el americano (NASD) de Excel. */
export function days360(a: number, b: number, eu: boolean): number {
  const s = ymdFromSerial(a);
  const e = ymdFromSerial(b);
  let d1 = s.d;
  let d2 = e.d;
  if (eu) {
    d1 = Math.min(d1, 30);
    d2 = Math.min(d2, 30);
  } else {
    if (lastDayOfFeb(s.y, s.m, s.d) && lastDayOfFeb(e.y, e.m, e.d)) d2 = 30;
    if (lastDayOfFeb(s.y, s.m, s.d)) d1 = 30;
    if (d2 === 31 && d1 >= 30) d2 = 30;
    if (d1 === 31) d1 = 30;
  }
  return 360 * (e.y - s.y) + 30 * (e.m - s.m) + (d2 - d1);
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Días entre dos fechas según la base (0 EE. UU. 30/360, 1 real, 2 real, 3 real, 4 europea 30/360). */
function dayDiff(basis: number, a: number, b: number): number {
  return basis === 0 ? days360(a, b, false) : basis === 4 ? days360(a, b, true) : b - a;
}

/** Fracción de año entre dos fechas (como YEARFRAC). */
export function yearFrac(a: number, b: number, basis: number): number {
  if (a > b) [a, b] = [b, a];
  switch (basis) {
    case 0:
      return days360(a, b, false) / 360;
    case 2:
      return (b - a) / 360;
    case 3:
      return (b - a) / 365;
    case 4:
      return days360(a, b, true) / 360;
    default: {
      const s = ymdFromSerial(a);
      const e = ymdFromSerial(b);
      let denom: number;
      const oneYear = e.y === s.y || (e.y === s.y + 1 && (e.m < s.m || (e.m === s.m && e.d <= s.d)));
      if (oneYear) {
        if (e.y === s.y) denom = isLeap(s.y) ? 366 : 365;
        else {
          const feb29a = isLeap(s.y) && a <= serialFromYMD(s.y, 2, 29) && serialFromYMD(s.y, 2, 29) <= b;
          const feb29b = isLeap(e.y) && a <= serialFromYMD(e.y, 2, 29) && serialFromYMD(e.y, 2, 29) <= b;
          denom = feb29a || feb29b ? 366 : 365;
        }
      } else {
        let total = 0;
        for (let y = s.y; y <= e.y; y++) total += isLeap(y) ? 366 : 365;
        denom = total / (e.y - s.y + 1);
      }
      return (b - a) / denom;
    }
  }
}

scalarFn('DAYS360', 2, 3, ([a, b, m]) => {
  const x = toNum(a!);
  const y = toNum(b!);
  if (isErr(x)) return x;
  if (isErr(y)) return y;
  const eu = m === undefined || m === null ? false : toBool(m);
  if (isErr(eu)) return eu;
  return days360(Math.floor(x), Math.floor(y), eu);
});

// ---- flujos de caja con fechas ----------------------------------------------------------------------
function pairsOf(values: Value, dts: Value, ctx: Parameters<typeof flatten>[1]): { v: number[]; d: number[] } | CalcError {
  const A = flatten(values, ctx);
  const B = flatten(dts, ctx);
  if (A.length !== B.length || A.length === 0) return E.NUM;
  const v: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < A.length; i++) {
    const x = toNum(A[i]!);
    const y = toNum(B[i]!);
    if (isErr(x)) return x;
    if (isErr(y)) return y;
    if (y < 0) return E.NUM;
    v.push(x);
    d.push(Math.floor(y));
  }
  if (d.some((x) => x < d[0]!)) return E.NUM;
  return { v, d };
}

rawFn('XNPV', 3, 3, (args, ctx) => {
  const r = toNum(flatten(args[0]!, ctx)[0] ?? null);
  if (isErr(r)) return r;
  if (r <= -1) return E.NUM;
  const p = pairsOf(args[1]!, args[2]!, ctx);
  if (!('v' in p)) return p;
  return p.v.reduce((acc, cf, i) => acc + cf / Math.pow(1 + r, (p.d[i]! - p.d[0]!) / 365), 0);
});

/** Raíz de f en (-1, +∞): Newton desde la estimación y, si falla, bisección sobre un cambio de signo. */
function rootRate(f: (x: number) => number, guess: number): number | null {
  const n = solve(f, guess);
  if (n !== null && n > -1) return n;
  let lo = -0.999999;
  let hi = 1;
  let flo = f(lo);
  let fhi = f(hi);
  for (let i = 0; i < 60 && Math.sign(flo) === Math.sign(fhi); i++) {
    hi *= 2;
    fhi = f(hi);
  }
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || Math.sign(flo) === Math.sign(fhi)) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}

rawFn('XIRR', 2, 3, (args, ctx) => {
  const p = pairsOf(args[0]!, args[1]!, ctx);
  if (!('v' in p)) return p;
  if (!p.v.some((x) => x > 0) || !p.v.some((x) => x < 0)) return E.NUM;
  const g = args[2] === undefined ? 0.1 : toNum(flatten(args[2], ctx)[0] ?? null);
  if (isErr(g)) return g;
  if (g <= -1) return E.NUM;
  const r = rootRate((x) => p.v.reduce((acc, cf, i) => acc + cf / Math.pow(1 + x, (p.d[i]! - p.d[0]!) / 365), 0), g);
  return r === null ? E.NUM : r;
});

rawFn('MIRR', 3, 3, (args, ctx) => {
  const vals: number[] = [];
  for (const x of flatten(args[0]!, ctx)) {
    if (isErr(x)) return x;
    if (typeof x === 'number') vals.push(x);
  }
  const fr = toNum(flatten(args[1]!, ctx)[0] ?? null);
  const rr = toNum(flatten(args[2]!, ctx)[0] ?? null);
  if (isErr(fr)) return fr;
  if (isErr(rr)) return rr;
  const n = vals.length;
  if (n < 2 || !vals.some((x) => x > 0) || !vals.some((x) => x < 0)) return E.DIV0;
  const npv = (rate: number, pick: (x: number) => number) => vals.reduce((acc, cf, i) => acc + pick(cf) / Math.pow(1 + rate, i + 1), 0);
  const pos = npv(rr, (x) => (x > 0 ? x : 0));
  const neg = npv(fr, (x) => (x < 0 ? x : 0));
  return Math.pow((-pos * Math.pow(1 + rr, n)) / (neg * (1 + fr)), 1 / (n - 1)) - 1;
});

// ---- tasas -----------------------------------------------------------------------------------------
scalarFn('EFFECT', 2, 2, (a) => {
  const v = nums(a, [undefined, undefined]);
  if (isErr(v)) return v;
  const n = Math.trunc(v[1]!);
  return v[0]! <= 0 || n < 1 ? E.NUM : Math.pow(1 + v[0]! / n, n) - 1;
});
scalarFn('NOMINAL', 2, 2, (a) => {
  const v = nums(a, [undefined, undefined]);
  if (isErr(v)) return v;
  const n = Math.trunc(v[1]!);
  return v[0]! <= 0 || n < 1 ? E.NUM : n * (Math.pow(1 + v[0]!, 1 / n) - 1);
});
scalarFn('RRI', 3, 3, (a) => {
  const v = nums(a, [undefined, undefined, undefined]);
  if (isErr(v)) return v;
  const [n, pv, fv] = v as [number, number, number];
  if (n <= 0 || pv === 0) return E.NUM;
  const q = fv / pv;
  return q < 0 ? E.NUM : Math.pow(q, 1 / n) - 1;
});
scalarFn('PDURATION', 3, 3, (a) => {
  const v = nums(a, [undefined, undefined, undefined]);
  if (isErr(v)) return v;
  const [r, pv, fv] = v as [number, number, number];
  return r <= 0 || pv <= 0 || fv <= 0 ? E.NUM : (Math.log(fv) - Math.log(pv)) / Math.log(1 + r);
});
scalarFn('ISPMT', 4, 4, (a) => {
  const v = nums(a, [undefined, undefined, undefined, undefined]);
  if (isErr(v)) return v;
  const [r, per, nper, pv] = v as [number, number, number, number];
  return nper === 0 ? E.DIV0 : pv * r * (per / nper - 1);
});
rawFn('FVSCHEDULE', 2, 2, (args, ctx) => {
  const p = toNum(flatten(args[0]!, ctx)[0] ?? null);
  if (isErr(p)) return p;
  let out = p;
  for (const x of flatten(args[1]!, ctx)) {
    const r = toNum(x);
    if (isErr(r)) return r;
    out *= 1 + r;
  }
  return out;
});

scalarFn('CUMIPMT', 6, 6, (a) => cumulative(a, false));
scalarFn('CUMPRINC', 6, 6, (a) => cumulative(a, true));
function cumulative(a: Scalar[], principal: boolean): Scalar {
  const v = nums(a, [undefined, undefined, undefined, undefined, undefined, undefined]);
  if (isErr(v)) return v;
  const [rate, nper, pv, s, e, type] = v as [number, number, number, number, number, number];
  const start = Math.trunc(s);
  const end = Math.trunc(e);
  if (rate <= 0 || nper <= 0 || pv <= 0 || start < 1 || end < start || end > nper || (type !== 0 && type !== 1)) return E.NUM;
  const payment = pmt(rate, nper, pv, 0, type);
  let total = 0;
  for (let per = start; per <= end; per++) {
    const i = interestPart(rate, per, nper, pv, 0, type);
    if (isErr(i)) return i;
    total += principal ? payment - i : i;
  }
  return total;
}

// ---- depreciación ----------------------------------------------------------------------------------
scalarFn('SYD', 4, 4, (a) => {
  const v = nums(a, [undefined, undefined, undefined, undefined]);
  if (isErr(v)) return v;
  const [cost, salvage, life, per] = v as [number, number, number, number];
  if (life <= 0 || per <= 0 || per > life || salvage < 0 || cost < 0) return E.NUM;
  return ((cost - salvage) * (life - per + 1) * 2) / (life * (life + 1));
});

scalarFn('DB', 4, 5, (a) => {
  const v = nums(a, [undefined, undefined, undefined, undefined, 12]);
  if (isErr(v)) return v;
  const [cost, salvage, life, period, m] = v as [number, number, number, number, number];
  const month = Math.trunc(m);
  const p = Math.trunc(period);
  if (cost < 0 || salvage < 0 || life <= 0 || p < 1 || month < 1 || month > 12) return E.NUM;
  if (p > life + (month < 12 ? 1 : 0)) return E.NUM;
  if (cost === 0) return 0;
  const rate = Math.round((1 - Math.pow(salvage / cost, 1 / life)) * 1000) / 1000;
  let total = 0;
  let dep = 0;
  for (let i = 1; i <= p; i++) {
    dep = i === 1 ? (cost * rate * month) / 12 : i === Math.trunc(life) + 1 ? ((cost - total) * rate * (12 - month)) / 12 : (cost - total) * rate;
    total += dep;
  }
  return dep;
});

scalarFn('DDB', 4, 5, (a) => {
  const v = nums(a, [undefined, undefined, undefined, undefined, 2]);
  if (isErr(v)) return v;
  const [cost, salvage, life, period, factor] = v as [number, number, number, number, number];
  if (cost < 0 || salvage < 0 || life <= 0 || period <= 0 || period > life || factor <= 0) return E.NUM;
  let total = 0;
  let dep = 0;
  for (let i = 1; i <= Math.ceil(period); i++) {
    dep = Math.min(((cost - total) * factor) / life, Math.max(cost - salvage - total, 0));
    total += dep;
  }
  return dep;
});

scalarFn('VDB', 5, 7, (a) => {
  const v = nums(a, [undefined, undefined, undefined, undefined, undefined, 2, 0]);
  if (isErr(v)) return v;
  const [cost, salvage, life, start, end, factor] = v as [number, number, number, number, number, number, number];
  const ns = a[6] === undefined || a[6] === null ? false : toBool(a[6]);
  if (isErr(ns)) return ns;
  if (cost < 0 || salvage < 0 || life <= 0 || start < 0 || end < start || end > life || factor <= 0) return E.NUM;
  let book = cost;
  let total = 0;
  for (let i = 0; i < Math.ceil(end); i++) {
    const ddb = Math.min((book * factor) / life, Math.max(book - salvage, 0));
    const sl = !ns && life - i > 0 ? Math.max(book - salvage, 0) / (life - i) : 0;
    const dep = Math.max(ddb, sl);
    const overlap = Math.max(0, Math.min(end, i + 1) - Math.max(start, i));
    total += dep * overlap;
    book -= dep;
  }
  return total;
});

// ---- fracciones de dólar ---------------------------------------------------------------------------
scalarFn('DOLLARDE', 2, 2, (a) => dollar(a, true));
scalarFn('DOLLARFR', 2, 2, (a) => dollar(a, false));
function dollar(a: Scalar[], toDecimal: boolean): Scalar {
  const v = nums(a, [undefined, undefined]);
  if (isErr(v)) return v;
  const f = Math.trunc(v[1]!);
  if (f < 0) return E.NUM;
  if (f === 0) return E.DIV0;
  const digits = Math.ceil(Math.log10(f));
  const sign = v[0]! < 0 ? -1 : 1;
  const x = Math.abs(v[0]!);
  const whole = Math.floor(x);
  const frac = x - whole;
  return sign * (toDecimal ? whole + (frac * Math.pow(10, digits)) / f : whole + (frac * f) / Math.pow(10, digits));
}

// ---- cupones y valores de renta fija ----------------------------------------------------------------
const FREQS = new Set([1, 2, 4]);

/** Fecha de cupón: `k` periodos antes (k>0) del vencimiento; si el vencimiento es fin de mes, los cupones también. */
function couponDate(maturity: number, k: number, step: number): number {
  const m = ymdFromSerial(maturity);
  const eom = m.d === daysInMonth(m.y, m.m);
  const total = m.y * 12 + (m.m - 1) - k * step;
  const y = Math.floor(total / 12);
  const mo = (total % 12) + 1;
  const dim = daysInMonth(y, mo);
  return serialFromYMD(y, mo, eom ? dim : Math.min(m.d, dim));
}

interface Coupon {
  pcd: number;
  ncd: number;
  num: number;
}
function coupon(settle: number, maturity: number, freq: number): Coupon {
  const step = 12 / freq;
  let k = 0;
  let prev = maturity;
  for (;;) {
    const d = couponDate(maturity, k, step);
    if (d <= settle) return { pcd: d, ncd: prev, num: k };
    prev = d;
    k++;
    if (k > 10000) return { pcd: d, ncd: prev, num: k };
  }
}
const periodDays = (basis: number, c: Coupon, freq: number) => (basis === 1 ? c.ncd - c.pcd : basis === 3 ? 365 / freq : 360 / freq);

interface Sec {
  settle: number;
  maturity: number;
  freq: number;
  basis: number;
  c: Coupon;
  A: number;
  E: number;
  DSC: number;
}
function security(settle: number, maturity: number, freq: number, basis: number): Sec | CalcError {
  if (!FREQS.has(freq) || basis < 0 || basis > 4 || settle >= maturity) return E.NUM;
  const c = coupon(settle, maturity, freq);
  const A = dayDiff(basis, c.pcd, settle);
  const Ee = periodDays(basis, c, freq);
  const DSC = basis === 0 || basis === 4 ? Ee - A : c.ncd - settle;
  return { settle, maturity, freq, basis, c, A, E: Ee, DSC };
}

const bondPrice = (s: Sec, rate: number, yld: number, redemption: number): number => {
  const f = s.freq;
  const cf = (100 * rate) / f;
  const frac = s.DSC / s.E;
  const base = 1 + yld / f;
  let pv = redemption / Math.pow(base, s.c.num - 1 + frac);
  for (let k = 1; k <= s.c.num; k++) pv += cf / Math.pow(base, k - 1 + frac);
  return pv - cf * (s.A / s.E);
};

function secArgs(a: Scalar[], spec: (number | undefined)[]): number[] | CalcError {
  const v = nums(a, spec);
  if (isErr(v)) return v;
  dates(v, [0, 1]);
  return v;
}

scalarFn('COUPNUM', 3, 4, (a) => couponInfo(a, 'num'));
scalarFn('COUPPCD', 3, 4, (a) => couponInfo(a, 'pcd'));
scalarFn('COUPNCD', 3, 4, (a) => couponInfo(a, 'ncd'));
scalarFn('COUPDAYBS', 3, 4, (a) => couponInfo(a, 'bs'));
scalarFn('COUPDAYS', 3, 4, (a) => couponInfo(a, 'days'));
scalarFn('COUPDAYSNC', 3, 4, (a) => couponInfo(a, 'nc'));
function couponInfo(a: Scalar[], what: 'num' | 'pcd' | 'ncd' | 'bs' | 'days' | 'nc'): Scalar {
  const v = secArgs(a, [undefined, undefined, undefined, 0]);
  if (isErr(v)) return v;
  const s = security(v[0]!, v[1]!, Math.trunc(v[2]!), Math.trunc(v[3]!));
  if (!('c' in s)) return s;
  const sec = s;
  switch (what) {
    case 'num':
      return sec.c.num;
    case 'pcd':
      return sec.c.pcd;
    case 'ncd':
      return sec.c.ncd;
    case 'bs':
      return sec.A;
    case 'days':
      return sec.E;
    default:
      return sec.DSC;
  }
}

scalarFn('PRICE', 6, 7, (a) => {
  const v = secArgs(a, [undefined, undefined, undefined, undefined, undefined, undefined, 0]);
  if (isErr(v)) return v;
  const [st, mt, rate, yld, red, f, b] = v as [number, number, number, number, number, number, number];
  if (rate < 0 || yld < 0 || red <= 0) return E.NUM;
  const s = security(st, mt, Math.trunc(f), Math.trunc(b));
  return 'c' in s ? bondPrice(s, rate, yld, red) : s;
});

scalarFn('YIELD', 6, 7, (a) => {
  const v = secArgs(a, [undefined, undefined, undefined, undefined, undefined, undefined, 0]);
  if (isErr(v)) return v;
  const [st, mt, rate, pr, red, f, b] = v as [number, number, number, number, number, number, number];
  if (rate < 0 || pr <= 0 || red <= 0) return E.NUM;
  const s = security(st, mt, Math.trunc(f), Math.trunc(b));
  if (!('c' in s)) return s;
  // El precio baja al subir el rendimiento: bisección.
  let lo = -s.freq * 0.999;
  let hi = 10;
  if (bondPrice(s, rate, lo, red) < pr) return E.NUM;
  while (bondPrice(s, rate, hi, red) > pr && hi < 1e6) hi *= 2;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    if (bondPrice(s, rate, mid, red) > pr) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
});

function duration(a: Scalar[], modified: boolean): Scalar {
  const v = secArgs(a, [undefined, undefined, undefined, undefined, undefined, 0]);
  if (isErr(v)) return v;
  const [st, mt, rate, yld, f, b] = v as [number, number, number, number, number, number];
  if (rate < 0 || yld < 0) return E.NUM;
  const s = security(st, mt, Math.trunc(f), Math.trunc(b));
  if (!('c' in s)) return s;
  const frac = s.DSC / s.E;
  const base = 1 + yld / s.freq;
  const cf = (100 * rate) / s.freq;
  let weighted = 0;
  let pv = 0;
  for (let k = 1; k <= s.c.num; k++) {
    const t = k - 1 + frac;
    const flow = (k === s.c.num ? cf + 100 : cf) / Math.pow(base, t);
    pv += flow;
    weighted += (t / s.freq) * flow;
  }
  const d = weighted / pv;
  return modified ? d / base : d;
}
scalarFn('DURATION', 5, 6, (a) => duration(a, false));
scalarFn('MDURATION', 5, 6, (a) => duration(a, true));

// ---- valores sin cupón / a vencimiento ----------------------------------------------------------------
function basisArg(v: number[], i: number): number | CalcError {
  const b = Math.trunc(v[i] ?? 0);
  return b < 0 || b > 4 ? E.NUM : b;
}

scalarFn('DISC', 4, 5, (a) => {
  const v = secArgs(a, [undefined, undefined, undefined, undefined, 0]);
  if (isErr(v)) return v;
  const [st, mt, pr, red] = v as [number, number, number, number];
  const b = basisArg(v, 4);
  if (isErr(b)) return b;
  if (pr <= 0 || red <= 0 || st >= mt) return E.NUM;
  return ((red - pr) / red) / yearFrac(st, mt, b);
});
scalarFn('INTRATE', 4, 5, (a) => {
  const v = secArgs(a, [undefined, undefined, undefined, undefined, 0]);
  if (isErr(v)) return v;
  const [st, mt, inv, red] = v as [number, number, number, number];
  const b = basisArg(v, 4);
  if (isErr(b)) return b;
  if (inv <= 0 || red <= 0 || st >= mt) return E.NUM;
  return ((red - inv) / inv) / yearFrac(st, mt, b);
});
scalarFn('RECEIVED', 4, 5, (a) => {
  const v = secArgs(a, [undefined, undefined, undefined, undefined, 0]);
  if (isErr(v)) return v;
  const [st, mt, inv, disc] = v as [number, number, number, number];
  const b = basisArg(v, 4);
  if (isErr(b)) return b;
  if (inv <= 0 || disc <= 0 || st >= mt) return E.NUM;
  const den = 1 - disc * yearFrac(st, mt, b);
  return den <= 0 ? E.NUM : inv / den;
});
scalarFn('PRICEDISC', 4, 5, (a) => {
  const v = secArgs(a, [undefined, undefined, undefined, undefined, 0]);
  if (isErr(v)) return v;
  const [st, mt, disc, red] = v as [number, number, number, number];
  const b = basisArg(v, 4);
  if (isErr(b)) return b;
  if (disc <= 0 || red <= 0 || st >= mt) return E.NUM;
  return red - disc * red * yearFrac(st, mt, b);
});
scalarFn('YIELDDISC', 4, 5, (a) => {
  const v = secArgs(a, [undefined, undefined, undefined, undefined, 0]);
  if (isErr(v)) return v;
  const [st, mt, pr, red] = v as [number, number, number, number];
  const b = basisArg(v, 4);
  if (isErr(b)) return b;
  if (pr <= 0 || red <= 0 || st >= mt) return E.NUM;
  return ((red - pr) / pr) / yearFrac(st, mt, b);
});
scalarFn('PRICEMAT', 5, 6, (a) => {
  const v = nums(a, [undefined, undefined, undefined, undefined, undefined, 0]);
  if (isErr(v)) return v;
  dates(v, [0, 1, 2]);
  const [st, mt, is, rate, yld] = v as [number, number, number, number, number];
  const b = basisArg(v, 5);
  if (isErr(b)) return b;
  if (rate < 0 || yld < 0 || st >= mt || is > st) return E.NUM;
  const dim = yearFrac(is, mt, b);
  const dsm = yearFrac(st, mt, b);
  const acc = yearFrac(is, st, b);
  return (100 + dim * rate * 100) / (1 + dsm * yld) - acc * rate * 100;
});
scalarFn('YIELDMAT', 5, 6, (a) => {
  const v = nums(a, [undefined, undefined, undefined, undefined, undefined, 0]);
  if (isErr(v)) return v;
  dates(v, [0, 1, 2]);
  const [st, mt, is, rate, pr] = v as [number, number, number, number, number];
  const b = basisArg(v, 5);
  if (isErr(b)) return b;
  if (rate < 0 || pr <= 0 || st >= mt || is > st) return E.NUM;
  const dim = yearFrac(is, mt, b);
  const dsm = yearFrac(st, mt, b);
  const acc = yearFrac(is, st, b);
  const cost = pr / 100 + acc * rate;
  return ((1 + dim * rate - cost) / cost) / dsm;
});
scalarFn('ACCRINTM', 4, 5, (a) => {
  const v = nums(a, [undefined, undefined, undefined, 1000, 0]);
  if (isErr(v)) return v;
  dates(v, [0, 1]);
  const [is, st, rate, par] = v as [number, number, number, number];
  const b = basisArg(v, 4);
  if (isErr(b)) return b;
  if (rate <= 0 || par <= 0 || is >= st) return E.NUM;
  return par * rate * yearFrac(is, st, b);
});

function tbill(a: Scalar[]): { dsm: number; x: number } | CalcError {
  const v = nums(a, [undefined, undefined, undefined]);
  if (isErr(v)) return v;
  dates(v, [0, 1]);
  const dsm = v[1]! - v[0]!;
  if (v[2]! <= 0 || dsm <= 0 || dsm > 365) return E.NUM;
  return { dsm, x: v[2]! };
}
scalarFn('TBILLPRICE', 3, 3, (a) => {
  const t = tbill(a);
  if (!('dsm' in t)) return t;
  const p = 100 * (1 - (t.x * t.dsm) / 360);
  return p <= 0 ? E.NUM : p;
});
scalarFn('TBILLYIELD', 3, 3, (a) => {
  const v = nums(a, [undefined, undefined, undefined]);
  if (isErr(v)) return v;
  dates(v, [0, 1]);
  const dsm = v[1]! - v[0]!;
  if (v[2]! <= 0 || dsm <= 0 || dsm > 365) return E.NUM;
  return ((100 - v[2]!) / v[2]!) * (360 / dsm);
});
scalarFn('TBILLEQ', 3, 3, (a) => {
  const t = tbill(a);
  if (!('dsm' in t)) return t;
  const { dsm, x: d } = t;
  if (d * dsm >= 360) return E.NUM;
  if (dsm <= 182) return (365 * d) / (360 - d * dsm);
  const price = 1 - (d * dsm) / 360;
  const qa = dsm / 730 - 0.25;
  const qb = dsm / 365;
  const qc = (price - 1) / price;
  const disc = qb * qb - 4 * qa * qc;
  return disc < 0 ? E.NUM : (-qb + Math.sqrt(disc)) / (2 * qa);
});

scalarFn('ACCRINT', 6, 8, (a) => {
  const v = nums(a, [undefined, undefined, undefined, undefined, 1000, undefined, 0]);
  if (isErr(v)) return v;
  dates(v, [0, 1, 2]);
  const [issue, first, settle, rate, par, f] = v as [number, number, number, number, number, number];
  const freq = Math.trunc(f);
  const b = basisArg(v, 6);
  if (isErr(b)) return b;
  const method = a[7] === undefined || a[7] === null ? true : toBool(a[7]);
  if (isErr(method)) return method;
  if (rate <= 0 || par <= 0 || !FREQS.has(freq) || issue >= settle) return E.NUM;
  const step = 12 / freq;
  // fechas de cupón alrededor de la primera de interés
  let k = 0;
  let start = first;
  while (start > issue) {
    k++;
    start = couponDate(first, k, step);
  }
  let total = 0;
  let periodStart = start;
  let n = k;
  for (let guard = 0; guard < 100000 && periodStart < settle; guard++) {
    const periodEnd = couponDate(first, n - 1, step);
    const nl = b === 1 ? periodEnd - periodStart : b === 3 ? 365 / freq : 360 / freq;
    const from = Math.max(periodStart, method ? issue : first);
    const to = Math.min(periodEnd, settle);
    if (to > from) total += ((par * rate) / freq) * (dayDiff(b, from, to) / nl);
    periodStart = periodEnd;
    n--;
  }
  return total;
});
