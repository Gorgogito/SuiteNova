import { numberToText, toNum, toText } from '../coerce';
import { erf, erfc } from '../special';
import { E, isErr, type CalcError, type Scalar } from '../values';
import { rawFn, scalarFn } from './registry';
import { flatten as flat } from './util';

const num = (v: Scalar): number | CalcError => toNum(v);

// ---- number bases ------------------------------------------------------------------------------------
const DIGITS = '0123456789ABCDEF';

/** Digits of a base-`base` number (at most 10, two's complement when the top bit is set) -> value, or an error. */
function parseBase(v: Scalar, base: number): number | CalcError {
  const t = typeof v === 'boolean' ? E.VALUE : toText(v);
  if (isErr(t)) return t;
  const s = t.toUpperCase();
  if (s.length > 10) return E.NUM;
  if (s === '') return 0;
  let n = 0;
  for (const ch of s) {
    const d = DIGITS.indexOf(ch);
    if (d < 0 || d >= base) return E.NUM;
    n = n * base + d;
  }
  const bits = base === 2 ? 10 : base === 8 ? 30 : 40;
  const full = 2 ** bits;
  return s.length === 10 && n >= full / 2 ? n - full : n;
}

function formatBase(n: number, base: number, places: Scalar | undefined, lo: number, hi: number): Scalar {
  n = Math.trunc(n);
  if (n < lo || n > hi) return E.NUM;
  const bits = base === 2 ? 10 : base === 8 ? 30 : 40;
  let v = n;
  let out: string;
  if (v < 0) {
    v += 2 ** bits;
    out = v.toString(base).toUpperCase();
    if (places !== undefined && places !== null) {
      const p = num(places);
      if (isErr(p)) return p;
    }
    return out; // negative numbers ignore the places argument
  }
  out = v.toString(base).toUpperCase();
  if (places !== undefined && places !== null) {
    const p = num(places);
    if (isErr(p)) return p;
    const pl = Math.trunc(p);
    if (pl < 1 || pl > 10 || out.length > pl) return E.NUM;
    out = out.padStart(pl, '0');
  }
  return out;
}

const RANGES: Record<number, [number, number]> = { 2: [-512, 511], 8: [-536870912, 536870911], 16: [-549755813888, 549755813887] };
const NAMES: Record<number, string> = { 2: 'BIN', 8: 'OCT', 16: 'HEX', 10: 'DEC' };
for (const from of [2, 8, 10, 16]) {
  for (const to of [2, 8, 10, 16]) {
    if (from === to) continue;
    const name = `${NAMES[from]}2${NAMES[to]}`;
    const takesPlaces = to !== 10;
    scalarFn(name, 1, takesPlaces ? 2 : 1, ([x, places]) => {
      let n: number | CalcError;
      if (from === 10) {
        n = num(x!);
        if (isErr(n)) return n;
        const [lo, hi] = RANGES[to]!;
        return formatBase(n, to, places, lo, hi);
      }
      n = parseBase(x!, from);
      if (isErr(n)) return n;
      if (to === 10) return n;
      const [lo, hi] = RANGES[to]!;
      return formatBase(n, to, places, lo, hi);
    });
  }
}

// ---- bit operations ----------------------------------------------------------------------------------
const MAX_BIT = 2 ** 48;
function bitFn(name: string, f: (a: number, b: number) => number): void {
  scalarFn(name, 2, 2, ([a, b]) => {
    const x = num(a!);
    const y = num(b!);
    if (isErr(x)) return x;
    if (isErr(y)) return y;
    if (x < 0 || y < 0 || x !== Math.floor(x) || y !== Math.floor(y) || x >= MAX_BIT || y >= MAX_BIT) return E.NUM;
    // BigInt keeps all 48 bits exact
    return Number(f(x, y));
  });
}
const big = (f: (a: bigint, b: bigint) => bigint) => (a: number, b: number) => Number(f(BigInt(a), BigInt(b)));
bitFn('BITAND', big((a, b) => a & b));
bitFn('BITOR', big((a, b) => a | b));
bitFn('BITXOR', big((a, b) => a ^ b));
function shiftFn(name: string, left: boolean): void {
  scalarFn(name, 2, 2, ([a, b]) => {
    const x = num(a!);
    const s = num(b!);
    if (isErr(x)) return x;
    if (isErr(s)) return s;
    if (x < 0 || x !== Math.floor(x) || x >= MAX_BIT || Math.abs(s) > 53) return E.NUM;
    const sh = BigInt(Math.trunc(Math.abs(s)));
    const dir = (s >= 0) === left;
    const r = dir ? BigInt(x) << sh : BigInt(x) >> sh;
    return r >= BigInt(MAX_BIT) ? E.NUM : Number(r);
  });
}
shiftFn('BITLSHIFT', true);
shiftFn('BITRSHIFT', false);

scalarFn('DELTA', 1, 2, ([a, b]) => {
  const x = num(a!);
  const y = b === undefined || b === null ? 0 : num(b);
  if (isErr(x)) return x;
  if (isErr(y)) return y;
  return x === y ? 1 : 0;
});
scalarFn('GESTEP', 1, 2, ([a, b]) => {
  const x = num(a!);
  const y = b === undefined || b === null ? 0 : num(b);
  if (isErr(x)) return x;
  if (isErr(y)) return y;
  return x >= y ? 1 : 0;
});

// ---- error function ----------------------------------------------------------------------------------
scalarFn('ERF', 1, 2, ([a, b]) => {
  const x = num(a!);
  if (isErr(x)) return x;
  if (b === undefined || b === null) return erf(x);
  const y = num(b);
  if (isErr(y)) return y;
  return erf(y) - erf(x);
});
scalarFn('ERF.PRECISE', 1, 1, ([a]) => {
  const x = num(a!);
  return isErr(x) ? x : erf(x);
});
scalarFn('ERFC', 1, 1, ([a]) => {
  const x = num(a!);
  if (isErr(x)) return x;
  return x < 0 ? E.NUM : erfc(x);
});
scalarFn('ERFC.PRECISE', 1, 1, ([a]) => {
  const x = num(a!);
  return isErr(x) ? x : erfc(x);
});

// ---- Bessel functions --------------------------------------------------------------------------------
/** Trapezoid on a periodic integrand converges exponentially, so these are accurate to rounding error. */
function besselJ(n: number, x: number): number {
  const N = Math.max(64, Math.ceil(Math.abs(x) * 2 + n * 2 + 40));
  let s = 0;
  for (let k = 0; k < N; k++) {
    const t = (2 * Math.PI * k) / N;
    s += Math.cos(n * t - x * Math.sin(t));
  }
  return s / N;
}
function besselI(n: number, x: number): number {
  const N = Math.max(64, Math.ceil(Math.abs(x) * 2 + n * 2 + 40));
  let s = 0;
  for (let k = 0; k < N; k++) {
    const t = (2 * Math.PI * k) / N;
    s += Math.exp(x * Math.cos(t)) * Math.cos(n * t);
  }
  return s / N;
}
function besselK(n: number, x: number): number {
  // K_n(x) = ∫0^∞ exp(-x cosh t) cosh(n t) dt
  const h = 0.02;
  let s = 0.5 * Math.exp(-x);
  for (let k = 1; k < 5000; k++) {
    const t = k * h;
    const term = Math.exp(-x * Math.cosh(t)) * Math.cosh(n * t);
    s += term;
    if (term < 1e-300 || (term < s * 1e-18 && t > 1)) break;
  }
  return s * h;
}
function besselY(n: number, x: number): number {
  // Y_n(x) = (1/π)∫0^π sin(x sin θ − nθ) dθ − (1/π)∫0^∞ (e^{nt} + (−1)^n e^{−nt}) e^{−x sinh t} dt, both by Simpson's rule
  const simpson = (f: (t: number) => number, lo: number, hi: number, steps: number): number => {
    const m = steps + (steps % 2);
    const h = (hi - lo) / m;
    let s = f(lo) + f(hi);
    for (let k = 1; k < m; k++) s += (k % 2 ? 4 : 2) * f(lo + k * h);
    return (s * h) / 3;
  };
  const first = simpson((t) => Math.sin(x * Math.sin(t) - n * t), 0, Math.PI, 4000 + Math.ceil(x * 40));
  const g = (t: number) => (Math.exp(n * t) + (n % 2 ? -1 : 1) * Math.exp(-n * t)) * Math.exp(-x * Math.sinh(t));
  // the integrand dies out where x·sinh t is large; grow the end until it is negligible
  let top = 0.5;
  while (top < 60 && Math.abs(g(top)) > 1e-18) top += 0.5;
  const second = simpson(g, 0, top, Math.ceil(top / 0.002));
  return (first - second) / Math.PI;
}
function bessel(name: string, f: (n: number, x: number) => number, needsPositive: boolean): void {
  scalarFn(name, 2, 2, ([a, b]) => {
    const x = num(a!);
    const n = num(b!);
    if (isErr(x)) return x;
    if (isErr(n)) return n;
    const order = Math.trunc(n);
    if (order < 0 || (needsPositive && x <= 0)) return E.NUM;
    const r = f(order, x);
    return Number.isFinite(r) ? r : E.NUM;
  });
}
bessel('BESSELJ', besselJ, false);
bessel('BESSELI', besselI, false);
bessel('BESSELK', besselK, true);
bessel('BESSELY', besselY, true);

// ---- complex numbers ---------------------------------------------------------------------------------
interface Cx {
  re: number;
  im: number;
  suffix: 'i' | 'j';
}

function parseComplex(v: Scalar): Cx | CalcError {
  if (typeof v === 'number') return { re: v, im: 0, suffix: 'i' };
  if (typeof v === 'boolean') return E.VALUE;
  const t = toText(v);
  if (isErr(t)) return t;
  const s = t.trim();
  if (s === '') return { re: 0, im: 0, suffix: 'i' };
  // only an imaginary part: i, -i, 3i, -2.5j
  let m = /^([+-]?)((?:\d+\.?\d*|\.\d+)(?:E[+-]?\d+)?)?([ij])$/i.exec(s);
  if (m) return { re: 0, im: (m[1] === '-' ? -1 : 1) * (m[2] === undefined ? 1 : Number(m[2])), suffix: m[3]!.toLowerCase() as 'i' | 'j' };
  // only a real part
  m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:E[+-]?\d+)?$/i.exec(s);
  if (m) return { re: Number(s), im: 0, suffix: 'i' };
  // real part, then the sign and imaginary part
  const full = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:E[+-]?\d+)?)([+-])((?:\d+\.?\d*|\.\d+)(?:E[+-]?\d+)?)?([ij])$/i.exec(s);
  if (full) return { re: Number(full[1]), im: (full[2] === '-' ? -1 : 1) * (full[3] === undefined ? 1 : Number(full[3])), suffix: full[4]!.toLowerCase() as 'i' | 'j' };
  return E.NUM;
}

function cxText(re: number, im: number, suffix: 'i' | 'j' = 'i'): string {
  const r = (x: number) => (Math.abs(x) < 1e-15 * Math.max(1, Math.abs(re), Math.abs(im)) ? 0 : x);
  const a = r(re);
  const b = r(im);
  const imag = b === 0 ? '' : b === 1 ? suffix : b === -1 ? `-${suffix}` : `${numberToText(b)}${suffix}`;
  if (b === 0) return numberToText(a);
  if (a === 0) return imag;
  return `${numberToText(a)}${b > 0 ? '+' : ''}${imag}`;
}

function cxFn1(name: string, f: (z: Cx) => Scalar): void {
  scalarFn(name, 1, 1, ([a]) => {
    const z = parseComplex(a!);
    return isErr(z) ? z : f(z);
  });
}
function cxMap(name: string, f: (re: number, im: number) => [number, number]): void {
  cxFn1(name, (z) => {
    const [re, im] = f(z.re, z.im);
    return Number.isFinite(re) && Number.isFinite(im) ? cxText(re, im, z.suffix) : E.NUM;
  });
}

scalarFn('COMPLEX', 2, 3, ([a, b, c]) => {
  const re = num(a!);
  const im = num(b!);
  if (isErr(re)) return re;
  if (isErr(im)) return im;
  const suf = c === undefined || c === null ? 'i' : c;
  if (suf !== 'i' && suf !== 'j') return E.VALUE;
  return cxText(re, im, suf);
});
cxFn1('IMREAL', (z) => z.re);
cxFn1('IMAGINARY', (z) => z.im);
cxFn1('IMABS', (z) => Math.hypot(z.re, z.im));
cxFn1('IMARGUMENT', (z) => (z.re === 0 && z.im === 0 ? E.DIV0 : Math.atan2(z.im, z.re)));
cxMap('IMCONJUGATE', (a, b) => [a, -b]);
cxMap('IMEXP', (a, b) => [Math.exp(a) * Math.cos(b), Math.exp(a) * Math.sin(b)]);
cxMap('IMSQRT', (a, b) => {
  const m = Math.hypot(a, b);
  const re = Math.sqrt((m + a) / 2);
  const im = Math.sqrt((m - a) / 2);
  return [re, b < 0 ? -im : im];
});
const ln = (a: number, b: number): [number, number] => [Math.log(Math.hypot(a, b)), Math.atan2(b, a)];
cxFn1('IMLN', (z) => (z.re === 0 && z.im === 0 ? E.NUM : cxText(...ln(z.re, z.im), z.suffix)));
cxFn1('IMLOG10', (z) => (z.re === 0 && z.im === 0 ? E.NUM : cxText(ln(z.re, z.im)[0] / Math.LN10, ln(z.re, z.im)[1] / Math.LN10, z.suffix)));
cxFn1('IMLOG2', (z) => (z.re === 0 && z.im === 0 ? E.NUM : cxText(ln(z.re, z.im)[0] / Math.LN2, ln(z.re, z.im)[1] / Math.LN2, z.suffix)));
cxMap('IMSIN', (a, b) => [Math.sin(a) * Math.cosh(b), Math.cos(a) * Math.sinh(b)]);
cxMap('IMCOS', (a, b) => [Math.cos(a) * Math.cosh(b), -Math.sin(a) * Math.sinh(b)]);
cxMap('IMSINH', (a, b) => [Math.sinh(a) * Math.cos(b), Math.cosh(a) * Math.sin(b)]);
cxMap('IMCOSH', (a, b) => [Math.cosh(a) * Math.cos(b), Math.sinh(a) * Math.sin(b)]);
const cdiv = (a: number, b: number, c: number, d: number): [number, number] => {
  const den = c * c + d * d;
  return [(a * c + b * d) / den, (b * c - a * d) / den];
};
cxMap('IMTAN', (a, b) => cdiv(Math.sin(a) * Math.cosh(b), Math.cos(a) * Math.sinh(b), Math.cos(a) * Math.cosh(b), -Math.sin(a) * Math.sinh(b)));
cxMap('IMCOT', (a, b) => cdiv(Math.cos(a) * Math.cosh(b), -Math.sin(a) * Math.sinh(b), Math.sin(a) * Math.cosh(b), Math.cos(a) * Math.sinh(b)));
cxMap('IMSEC', (a, b) => cdiv(1, 0, Math.cos(a) * Math.cosh(b), -Math.sin(a) * Math.sinh(b)));
cxMap('IMCSC', (a, b) => cdiv(1, 0, Math.sin(a) * Math.cosh(b), Math.cos(a) * Math.sinh(b)));
cxMap('IMSECH', (a, b) => cdiv(1, 0, Math.cosh(a) * Math.cos(b), Math.sinh(a) * Math.sin(b)));
cxMap('IMCSCH', (a, b) => cdiv(1, 0, Math.sinh(a) * Math.cos(b), Math.cosh(a) * Math.sin(b)));

scalarFn('IMDIV', 2, 2, ([x, y]) => {
  const a = parseComplex(x!);
  const b = parseComplex(y!);
  if (isErr(a)) return a;
  if (isErr(b)) return b;
  if (b.re === 0 && b.im === 0) return E.NUM;
  const [re, im] = cdiv(a.re, a.im, b.re, b.im);
  return cxText(re, im, a.suffix);
});
scalarFn('IMSUB', 2, 2, ([x, y]) => {
  const a = parseComplex(x!);
  const b = parseComplex(y!);
  if (isErr(a)) return a;
  if (isErr(b)) return b;
  return cxText(a.re - b.re, a.im - b.im, a.suffix);
});
scalarFn('IMPOWER', 2, 2, ([x, y]) => {
  const a = parseComplex(x!);
  const p = num(y!);
  if (isErr(a)) return a;
  if (isErr(p)) return p;
  if (a.re === 0 && a.im === 0) return p > 0 ? '0' : E.NUM;
  if (Number.isInteger(p) && Math.abs(p) <= 4096) {
    let re = 1;
    let im = 0;
    let bre = a.re;
    let bim = a.im;
    for (let e = Math.abs(p); e > 0; e = Math.floor(e / 2)) {
      if (e % 2) [re, im] = [re * bre - im * bim, re * bim + im * bre];
      [bre, bim] = [bre * bre - bim * bim, 2 * bre * bim];
    }
    if (p < 0) [re, im] = cdiv(1, 0, re, im);
    return Number.isFinite(re) && Number.isFinite(im) ? cxText(re, im, a.suffix) : E.NUM;
  }
  const r = Math.hypot(a.re, a.im) ** p;
  const th = Math.atan2(a.im, a.re) * p;
  return cxText(r * Math.cos(th), r * Math.sin(th), a.suffix);
});

function cxFold(name: string, init: [number, number], f: (acc: [number, number], z: Cx) => [number, number]): void {
  rawFn(name, 1, 255, (args, ctx) => {
    let acc = init;
    let suffix: 'i' | 'j' = 'i';
    let first = true;
    for (const a of args) {
      const items: Scalar[] = typeof a === 'object' && a !== null && 'kind' in a ? flat(a, ctx) : [a as Scalar];
      for (const it of items) {
        if (it === null) continue;
        const z = parseComplex(it);
        if (isErr(z)) return z;
        if (first) suffix = z.suffix;
        first = false;
        acc = f(acc, z);
      }
    }
    return cxText(acc[0], acc[1], suffix);
  });
}
cxFold('IMSUM', [0, 0], (acc, z) => [acc[0] + z.re, acc[1] + z.im]);
cxFold('IMPRODUCT', [1, 0], (acc, z) => [acc[0] * z.re - acc[1] * z.im, acc[0] * z.im + acc[1] * z.re]);

// ---- unit conversion ---------------------------------------------------------------------------------
interface Unit {
  kind: string;
  /** Factor to the base unit of its kind (temperatures are handled apart). */
  f: number;
  /** Accepts metric prefixes. */
  metric?: boolean;
}
const U: Record<string, Unit> = {};
const unit = (kind: string, f: number, metric: boolean, ...names: string[]) => names.forEach((n) => (U[n] = { kind, f, metric }));
// mass (grams)
unit('mass', 1, true, 'g');
unit('mass', 14593.9029372064, false, 'sg');
unit('mass', 453.59237, false, 'lbm');
unit('mass', 1.66053886e-24, true, 'u');
unit('mass', 28.349523125, false, 'ozm');
unit('mass', 0.06479891, false, 'grain');
unit('mass', 45359.237, false, 'cwt', 'shweight');
unit('mass', 50802.34544, false, 'uk_cwt', 'lcwt', 'hweight');
unit('mass', 6350.29318, false, 'stone');
unit('mass', 907184.74, false, 'ton');
unit('mass', 1016046.9088, false, 'uk_ton', 'LTON', 'brton');
// distance (metres)
unit('distance', 1, true, 'm');
unit('distance', 1609.344, false, 'mi');
unit('distance', 1852, false, 'Nmi');
unit('distance', 0.0254, false, 'in');
unit('distance', 0.3048, false, 'ft');
unit('distance', 0.9144, false, 'yd');
unit('distance', 1e-10, true, 'ang');
unit('distance', 1.143, false, 'ell');
unit('distance', 9.46073047258e15, false, 'ly');
unit('distance', 3.08567758128e16, false, 'parsec', 'pc');
unit('distance', 0.000352777777777778, false, 'Pica');
unit('distance', 0.00035277777777777, false, 'pica');
unit('distance', 1609.3472186944373, false, 'survey_mi');
// time (seconds)
unit('time', 31557600, false, 'yr');
unit('time', 86400, false, 'day', 'd');
unit('time', 3600, false, 'hr');
unit('time', 60, false, 'mn', 'min');
unit('time', 1, true, 'sec', 's');
// pressure (pascal)
unit('pressure', 1, true, 'Pa', 'p');
unit('pressure', 101325, true, 'atm', 'at');
unit('pressure', 133.322368421053, true, 'mmHg');
unit('pressure', 6894.757293168, false, 'psi');
unit('pressure', 133.322368421053, false, 'Torr');
// force (newton)
unit('force', 1, true, 'N');
unit('force', 1e-5, true, 'dyn', 'dy');
unit('force', 4.4482216152605, false, 'lbf');
unit('force', 0.00980665, true, 'pond');
// energy (joule)
unit('energy', 1, true, 'J');
unit('energy', 1e-7, true, 'e');
unit('energy', 4.184, true, 'c');
unit('energy', 4.1868, true, 'cal');
unit('energy', 1.602176487e-19, true, 'eV', 'ev');
unit('energy', 2684519.53769618, false, 'HPh', 'hh');
unit('energy', 3600, true, 'Wh', 'wh');
unit('energy', 1.3558179483314, false, 'flb');
unit('energy', 1055.05585262, false, 'BTU', 'btu');
// power (watt)
unit('power', 745.69987158227, false, 'HP', 'h');
unit('power', 735.49875, false, 'PS');
unit('power', 1, true, 'W', 'w');
// magnetism (tesla)
unit('magnetism', 1, true, 'T');
unit('magnetism', 1e-4, true, 'ga');
// volume (litres)
unit('volume', 0.00492892159375, false, 'tsp');
unit('volume', 0.01478676478125, false, 'tbs');
unit('volume', 0.0295735295625, false, 'oz');
unit('volume', 0.2365882365, false, 'cup');
unit('volume', 0.473176473, false, 'pt', 'us_pt');
unit('volume', 0.56826125, false, 'uk_pt');
unit('volume', 0.946352946, false, 'qt');
unit('volume', 1.1365225, false, 'uk_qt');
unit('volume', 3.785411784, false, 'gal');
unit('volume', 4.54609, false, 'uk_gal');
unit('volume', 1, true, 'l', 'L', 'lt');
unit('volume', 1000, true, 'm3');
unit('volume', 0.016387064, false, 'in3');
unit('volume', 28.316846592, false, 'ft3');
unit('volume', 764.554857984, false, 'yd3');
unit('volume', 158.987294928, false, 'barrel');
// area (square metres)
unit('area', 1, true, 'm2', 'm^2');
unit('area', 0.00064516, false, 'in2', 'in^2');
unit('area', 0.09290304, false, 'ft2', 'ft^2');
unit('area', 0.83612736, false, 'yd2', 'yd^2');
unit('area', 2589988.110336, false, 'mi2', 'mi^2');
unit('area', 100, false, 'ar');
unit('area', 10000, false, 'ha');
unit('area', 4046.8564224, false, 'uk_acre', 'us_acre');
// speed (metres per second)
unit('speed', 1, true, 'm/s', 'm/sec');
unit('speed', 1 / 3600, true, 'm/h', 'm/hr');
unit('speed', 0.44704, false, 'mph');
unit('speed', 0.514444444444444, false, 'kn');
unit('speed', 0.514773333333333, false, 'admkn');
// information (bits)
unit('information', 1, true, 'bit');
unit('information', 8, true, 'byte');

const PREFIX: Record<string, number> = { Y: 1e24, Z: 1e21, E: 1e18, P: 1e15, T: 1e12, G: 1e9, M: 1e6, k: 1e3, h: 1e2, da: 10, e: 10, d: 0.1, c: 0.01, m: 0.001, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15, a: 1e-18, z: 1e-21, y: 1e-24 };
const BINARY: Record<string, number> = { Yi: 2 ** 80, Zi: 2 ** 70, Ei: 2 ** 60, Pi: 2 ** 50, Ti: 2 ** 40, Gi: 2 ** 30, Mi: 2 ** 20, ki: 2 ** 10 };
const TEMPS = new Set(['C', 'cel', 'F', 'fah', 'K', 'kel', 'Rank', 'Reau']);

function findUnit(name: string): { u: Unit; mult: number } | { temp: string } | null {
  if (TEMPS.has(name)) return { temp: name };
  if (U[name]) return { u: U[name]!, mult: 1 };
  for (const len of [2, 1]) {
    const p = name.slice(0, len);
    const rest = name.slice(len);
    const u = U[rest];
    if (u?.metric && PREFIX[p] !== undefined && rest !== '') return { u, mult: PREFIX[p]! };
    if (u?.kind === 'information' && BINARY[p] !== undefined && rest !== '') return { u, mult: BINARY[p]! };
  }
  return null;
}

const toKelvin = (v: number, t: string): number => (t === 'C' || t === 'cel' ? v + 273.15 : t === 'F' || t === 'fah' ? ((v - 32) * 5) / 9 + 273.15 : t === 'Rank' ? (v * 5) / 9 : t === 'Reau' ? (v * 5) / 4 + 273.15 : v);
const fromKelvin = (k: number, t: string): number => (t === 'C' || t === 'cel' ? k - 273.15 : t === 'F' || t === 'fah' ? ((k - 273.15) * 9) / 5 + 32 : t === 'Rank' ? (k * 9) / 5 : t === 'Reau' ? ((k - 273.15) * 4) / 5 : k);

scalarFn('CONVERT', 3, 3, ([a, f, t]) => {
  const x = num(a!);
  if (isErr(x)) return x;
  if (typeof f !== 'string' || typeof t !== 'string') return E.NA;
  const from = findUnit(f);
  const to = findUnit(t);
  if (!from || !to) return E.NA;
  if ('temp' in from || 'temp' in to) {
    if (!('temp' in from) || !('temp' in to)) return E.NA;
    return fromKelvin(toKelvin(x, from.temp), to.temp);
  }
  if (from.u.kind !== to.u.kind) return E.NA;
  return (x * from.mult * from.u.f) / (to.mult * to.u.f);
});

