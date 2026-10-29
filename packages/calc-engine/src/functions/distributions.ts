import { toNum } from '../coerce';
import {
  betaI,
  binomCdf,
  binomPmf,
  chiCdf,
  fCdf,
  gamma,
  gammaP,
  gammaQ,
  invert,
  lchoose,
  lgamma,
  normCdf,
  normInv,
  normPdf,
  poissonCdf,
  poissonPmf,
  tCdf,
} from '../special';
import { E, isErr, type CalcError, type Scalar, type Value } from '../values';
import { alias, rawFn, scalarFn } from './registry';
import { collectNumbers, toMatrix } from './util';

type NumFn = (a: number[]) => number | CalcError;

/** A function of numbers only: arguments are coerced, anything not finite is #NUM!. */
function dist(name: string, min: number, max: number, fn: NumFn, legacy: string[] = []): void {
  scalarFn(name, min, max, (args) => {
    const a: number[] = [];
    for (const x of args) {
      if (x === null && a.length >= min) {
        a.push(NaN);
        continue;
      }
      const n = toNum(x);
      if (isErr(n)) return n;
      a.push(n);
    }
    const r = fn(a);
    if (typeof r === 'number' && !Number.isFinite(r)) return E.NUM;
    return r;
  });
  for (const l of legacy) alias(l, name);
}

const NUM = E.NUM;
const cum = (v: number | undefined): boolean => v !== 0 && v !== undefined && !Number.isNaN(v);
const int = Math.trunc;
const prob = (p: number): boolean => p > 0 && p < 1;

// ---- normal ------------------------------------------------------------------------------------------
dist('NORM.DIST', 4, 4, ([x, m, sd, c]) => (sd! <= 0 ? NUM : cum(c) ? normCdf((x! - m!) / sd!) : normPdf((x! - m!) / sd!) / sd!), ['NORMDIST']);
dist('NORM.INV', 3, 3, ([p, m, sd]) => (!prob(p!) || sd! <= 0 ? NUM : m! + sd! * normInv(p!)), ['NORMINV']);
dist('NORM.S.DIST', 2, 2, ([z, c]) => (cum(c) ? normCdf(z!) : normPdf(z!)));
dist('NORM.S.INV', 1, 1, ([p]) => (prob(p!) ? normInv(p!) : NUM), ['NORMSINV']);
dist('NORMSDIST', 1, 1, ([z]) => normCdf(z!));
dist('LOGNORM.DIST', 4, 4, ([x, m, sd, c]) => {
  if (x! <= 0 || sd! <= 0) return NUM;
  const z = (Math.log(x!) - m!) / sd!;
  return cum(c) ? normCdf(z) : normPdf(z) / (x! * sd!);
});
dist('LOGNORM.INV', 3, 3, ([p, m, sd]) => (!prob(p!) || sd! <= 0 ? NUM : Math.exp(m! + sd! * normInv(p!))), ['LOGINV']);
dist('LOGNORMDIST', 3, 3, ([x, m, sd]) => (x! <= 0 || sd! <= 0 ? NUM : normCdf((Math.log(x!) - m!) / sd!)));
dist('STANDARDIZE', 3, 3, ([x, m, sd]) => (sd! <= 0 ? NUM : (x! - m!) / sd!));
dist('GAUSS', 1, 1, ([z]) => normCdf(z!) - 0.5);
dist('PHI', 1, 1, ([x]) => normPdf(x!));

// ---- Student t ---------------------------------------------------------------------------------------
const tPdf = (x: number, df: number): number => Math.exp(lgamma((df + 1) / 2) - lgamma(df / 2) - 0.5 * Math.log(df * Math.PI) - ((df + 1) / 2) * Math.log(1 + (x * x) / df));
export function tInv(p: number, df: number): number {
  if (p === 0.5) return 0;
  if (p < 0.5) return -tInv(1 - p, df);
  return invert((x) => tCdf(x, df), p, 0, Infinity, 2);
}
dist('T.DIST', 3, 3, ([x, df, c]) => (int(df!) < 1 ? NUM : cum(c) ? tCdf(x!, int(df!)) : tPdf(x!, int(df!))));
dist('T.DIST.RT', 2, 2, ([x, df]) => (int(df!) < 1 ? NUM : 1 - tCdf(x!, int(df!))));
dist('T.DIST.2T', 2, 2, ([x, df]) => (int(df!) < 1 || x! < 0 ? NUM : 2 * (1 - tCdf(x!, int(df!)))));
dist('T.INV', 2, 2, ([p, df]) => (!prob(p!) || int(df!) < 1 ? NUM : tInv(p!, int(df!))));
dist('T.INV.2T', 2, 2, ([p, df]) => (!prob(p!) || int(df!) < 1 ? NUM : tInv(1 - p! / 2, int(df!))), ['TINV']);
dist('TDIST', 3, 3, ([x, df, tails]) => (x! < 0 || int(df!) < 1 || (int(tails!) !== 1 && int(tails!) !== 2) ? NUM : int(tails!) * (1 - tCdf(x!, int(df!)))));

// ---- chi-square --------------------------------------------------------------------------------------
const chiPdf = (x: number, df: number): number => (x === 0 ? (df === 2 ? 0.5 : df < 2 ? Infinity : 0) : Math.exp((df / 2 - 1) * Math.log(x) - x / 2 - (df / 2) * Math.LN2 - lgamma(df / 2)));
const chiInv = (p: number, df: number): number => invert((x) => chiCdf(x, df), p, 0, Infinity, df);
dist('CHISQ.DIST', 3, 3, ([x, df, c]) => (x! < 0 || int(df!) < 1 ? NUM : cum(c) ? chiCdf(x!, int(df!)) : chiPdf(x!, int(df!))));
dist('CHISQ.DIST.RT', 2, 2, ([x, df]) => (x! < 0 || int(df!) < 1 ? NUM : gammaQ(int(df!) / 2, x! / 2)), ['CHIDIST']);
dist('CHISQ.INV', 2, 2, ([p, df]) => (p! < 0 || p! >= 1 || int(df!) < 1 ? NUM : p === 0 ? 0 : chiInv(p!, int(df!))));
dist('CHISQ.INV.RT', 2, 2, ([p, df]) => (p! <= 0 || p! > 1 || int(df!) < 1 ? NUM : p === 1 ? 0 : chiInv(1 - p!, int(df!))), ['CHIINV']);

// ---- F -----------------------------------------------------------------------------------------------
const fPdf = (x: number, a: number, b: number): number => {
  if (x === 0) return a === 2 ? 1 : a < 2 ? Infinity : 0;
  const lbeta = lgamma(a / 2) + lgamma(b / 2) - lgamma((a + b) / 2);
  return Math.exp(0.5 * (a * Math.log(a * x) + b * Math.log(b) - (a + b) * Math.log(a * x + b)) - Math.log(x) - lbeta);
};
const fInv = (p: number, a: number, b: number): number => invert((x) => fCdf(x, a, b), p, 0, Infinity, 1);
dist('F.DIST', 4, 4, ([x, a, b, c]) => (x! < 0 || int(a!) < 1 || int(b!) < 1 ? NUM : cum(c) ? fCdf(x!, int(a!), int(b!)) : fPdf(x!, int(a!), int(b!))));
dist('F.DIST.RT', 3, 3, ([x, a, b]) => (x! < 0 || int(a!) < 1 || int(b!) < 1 ? NUM : 1 - fCdf(x!, int(a!), int(b!))), ['FDIST']);
dist('F.INV', 3, 3, ([p, a, b]) => (p! < 0 || p! >= 1 || int(a!) < 1 || int(b!) < 1 ? NUM : p === 0 ? 0 : fInv(p!, int(a!), int(b!))));
dist('F.INV.RT', 3, 3, ([p, a, b]) => (p! <= 0 || p! > 1 || int(a!) < 1 || int(b!) < 1 ? NUM : p === 1 ? 0 : fInv(1 - p!, int(a!), int(b!))), ['FINV']);

// ---- discrete ----------------------------------------------------------------------------------------
dist(
  'BINOM.DIST',
  4,
  4,
  ([k, n, p, c]) => {
    const kk = int(k!);
    const nn = int(n!);
    if (kk < 0 || kk > nn || p! < 0 || p! > 1) return NUM;
    return cum(c) ? binomCdf(kk, nn, p!) : binomPmf(kk, nn, p!);
  },
  ['BINOMDIST'],
);
dist('BINOM.DIST.RANGE', 3, 4, ([n, p, s, s2]) => {
  const nn = int(n!);
  const lo = int(s!);
  const hi = s2 === undefined || Number.isNaN(s2) ? lo : int(s2);
  if (nn < 0 || p! < 0 || p! > 1 || lo < 0 || lo > nn || hi < lo || hi > nn) return NUM;
  let t = 0;
  for (let k = lo; k <= hi; k++) t += binomPmf(k, nn, p!);
  return Math.min(1, t);
});
dist(
  'BINOM.INV',
  3,
  3,
  ([n, p, a]) => {
    const nn = int(n!);
    if (nn < 0 || p! < 0 || p! > 1 || a! < 0 || a! > 1) return NUM;
    let t = 0;
    for (let k = 0; k <= nn; k++) {
      t += binomPmf(k, nn, p!);
      if (t >= a! - 1e-15) return k;
    }
    return nn;
  },
  ['CRITBINOM'],
);
dist('NEGBINOM.DIST', 4, 4, ([f, s, p, c]) => {
  const ff = int(f!);
  const ss = int(s!);
  if (ff < 0 || ss < 1 || p! <= 0 || p! > 1) return NUM;
  return cum(c) ? betaI(p!, ss, ff + 1) : Math.exp(lchoose(ff + ss - 1, ss - 1) + ss * Math.log(p!) + ff * Math.log(1 - p!));
});
dist('NEGBINOMDIST', 3, 3, ([f, s, p]) => {
  const ff = int(f!);
  const ss = int(s!);
  if (ff < 0 || ss < 1 || p! <= 0 || p! > 1) return NUM;
  return Math.exp(lchoose(ff + ss - 1, ss - 1) + ss * Math.log(p!) + ff * Math.log(1 - p!));
});
dist('POISSON.DIST', 3, 3, ([x, m, c]) => (x! < 0 || m! < 0 ? NUM : cum(c) ? poissonCdf(int(x!), m!) : poissonPmf(int(x!), m!)), ['POISSON']);
dist('HYPGEOM.DIST', 5, 5, ([s, n, bigS, bigN, c]) => {
  const k = int(s!);
  const nn = int(n!);
  const SS = int(bigS!);
  const NN = int(bigN!);
  if (k < 0 || nn < 0 || SS < 0 || NN < 0 || nn > NN || SS > NN || k > nn || k > SS || nn - k > NN - SS) return NUM;
  const pmf = (x: number) => Math.exp(lchoose(SS, x) + lchoose(NN - SS, nn - x) - lchoose(NN, nn));
  if (!cum(c)) return pmf(k);
  let t = 0;
  for (let x = Math.max(0, nn - (NN - SS)); x <= k; x++) t += pmf(x);
  return Math.min(1, t);
});
dist('HYPGEOMDIST', 4, 4, ([s, n, bigS, bigN]) => {
  const k = int(s!);
  const nn = int(n!);
  const SS = int(bigS!);
  const NN = int(bigN!);
  if (k < 0 || nn < 0 || SS < 0 || NN < 0 || nn > NN || SS > NN || k > nn || k > SS || nn - k > NN - SS) return NUM;
  return Math.exp(lchoose(SS, k) + lchoose(NN - SS, nn - k) - lchoose(NN, nn));
});

// ---- continuous --------------------------------------------------------------------------------------
dist('EXPON.DIST', 3, 3, ([x, l, c]) => (x! < 0 || l! <= 0 ? NUM : cum(c) ? 1 - Math.exp(-l! * x!) : l! * Math.exp(-l! * x!)), ['EXPONDIST']);
dist('GAMMA.DIST', 4, 4, ([x, a, b, c]) => {
  if (x! < 0 || a! <= 0 || b! <= 0) return NUM;
  if (cum(c)) return gammaP(a!, x! / b!);
  if (x === 0) return a === 1 ? 1 / b! : a! < 1 ? Infinity : 0;
  return Math.exp((a! - 1) * Math.log(x!) - x! / b! - a! * Math.log(b!) - lgamma(a!));
}, ['GAMMADIST']);
dist('GAMMA.INV', 3, 3, ([p, a, b]) => (p! < 0 || p! >= 1 || a! <= 0 || b! <= 0 ? NUM : p === 0 ? 0 : b! * invert((x) => gammaP(a!, x), p!, 0, Infinity, a!)), ['GAMMAINV']);
dist('GAMMA', 1, 1, ([x]) => (x! <= 0 && Number.isInteger(x) ? NUM : gamma(x!)));
dist('GAMMALN', 1, 1, ([x]) => (x! <= 0 ? NUM : lgamma(x!)), ['GAMMALN.PRECISE']);
dist('BETA.DIST', 4, 6, ([x, a, b, c, lo, hi]) => {
  const A = lo === undefined || Number.isNaN(lo) ? 0 : lo;
  const B = hi === undefined || Number.isNaN(hi) ? 1 : hi;
  if (a! <= 0 || b! <= 0 || x! < A || x! > B || A === B) return NUM;
  const z = (x! - A) / (B - A);
  if (cum(c)) return betaI(z, a!, b!);
  if (z === 0 || z === 1) return a! === 1 && z === 0 ? b! / (B - A) : b! === 1 && z === 1 ? a! / (B - A) : (a! < 1 && z === 0) || (b! < 1 && z === 1) ? Infinity : 0;
  return Math.exp((a! - 1) * Math.log(z) + (b! - 1) * Math.log(1 - z) - (lgamma(a!) + lgamma(b!) - lgamma(a! + b!))) / (B - A);
});
dist('BETADIST', 3, 5, ([x, a, b, lo, hi]) => {
  const A = lo === undefined || Number.isNaN(lo) ? 0 : lo;
  const B = hi === undefined || Number.isNaN(hi) ? 1 : hi;
  if (a! <= 0 || b! <= 0 || x! < A || x! > B || A === B) return NUM;
  return betaI((x! - A) / (B - A), a!, b!);
});
dist('BETA.INV', 3, 5, ([p, a, b, lo, hi]) => {
  const A = lo === undefined || Number.isNaN(lo) ? 0 : lo;
  const B = hi === undefined || Number.isNaN(hi) ? 1 : hi;
  if (!(p! > 0 && p! <= 1) || a! <= 0 || b! <= 0 || A >= B) return NUM;
  return A + (B - A) * invert((x) => betaI(x, a!, b!), p!, 0, 1);
}, ['BETAINV']);
dist('WEIBULL.DIST', 4, 4, ([x, a, b, c]) => {
  if (x! < 0 || a! <= 0 || b! <= 0) return NUM;
  const z = (x! / b!) ** a!;
  return cum(c) ? 1 - Math.exp(-z) : (a! / b!) * (x! / b!) ** (a! - 1) * Math.exp(-z);
}, ['WEIBULL']);

dist('CONFIDENCE.NORM', 3, 3, ([a, sd, n]) => (a! <= 0 || a! >= 1 || sd! <= 0 || int(n!) < 1 ? NUM : (normInv(1 - a! / 2) * sd!) / Math.sqrt(int(n!))), ['CONFIDENCE']);
dist('CONFIDENCE.T', 3, 3, ([a, sd, n]) => (a! <= 0 || a! >= 1 || sd! <= 0 || int(n!) < 1 ? NUM : int(n!) === 1 ? E.DIV0 : (tInv(1 - a! / 2, int(n!) - 1) * sd!) / Math.sqrt(int(n!))));
dist('FISHER', 1, 1, ([x]) => (x! <= -1 || x! >= 1 ? NUM : 0.5 * Math.log((1 + x!) / (1 - x!))));
dist('FISHERINV', 1, 1, ([y]) => Math.tanh(y!));

// ---- tests on arrays ---------------------------------------------------------------------------------
const numbersOf = (v: Value, ctx: Parameters<typeof collectNumbers>[1]): number[] | CalcError => {
  const c = collectNumbers([v], ctx);
  return c.error ?? c.nums;
};
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const svar = (x: number[]) => {
  const m = mean(x);
  return x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1);
};

rawFn('Z.TEST', 2, 3, (args, ctx) => {
  const x = numbersOf(args[0]!, ctx);
  if (isErr(x)) return x;
  const mu = toNum(scalarFirst(args[1]!, ctx));
  if (isErr(mu)) return mu;
  if (!x.length) return E.NA;
  let sd: number;
  if (args[2] === undefined || args[2] === null) {
    if (x.length < 2) return E.DIV0;
    sd = Math.sqrt(svar(x));
  } else {
    const s = toNum(scalarFirst(args[2], ctx));
    if (isErr(s)) return s;
    sd = s;
  }
  if (sd <= 0) return NUM;
  return 1 - normCdf((mean(x) - mu) / (sd / Math.sqrt(x.length)));
});
alias('ZTEST', 'Z.TEST');

function scalarFirst(v: Value, ctx: Parameters<typeof collectNumbers>[1]): Scalar {
  return toMatrix(v, ctx)[0]?.[0] ?? null;
}

rawFn('T.TEST', 4, 4, (args, ctx) => {
  const a = numbersOf(args[0]!, ctx);
  if (isErr(a)) return a;
  const b = numbersOf(args[1]!, ctx);
  if (isErr(b)) return b;
  const tails = toNum(scalarFirst(args[2]!, ctx));
  const type = toNum(scalarFirst(args[3]!, ctx));
  if (isErr(tails)) return tails;
  if (isErr(type)) return type;
  if ((int(tails) !== 1 && int(tails) !== 2) || int(type) < 1 || int(type) > 3) return NUM;
  let t: number;
  let df: number;
  if (int(type) === 1) {
    if (a.length !== b.length) return E.NA;
    const d = a.map((x, i) => x - b[i]!);
    if (d.length < 2) return E.DIV0;
    const sd = Math.sqrt(svar(d));
    if (sd === 0) return E.DIV0;
    t = mean(d) / (sd / Math.sqrt(d.length));
    df = d.length - 1;
  } else {
    if (a.length < 2 || b.length < 2) return E.DIV0;
    const va = svar(a);
    const vb = svar(b);
    if (int(type) === 2) {
      df = a.length + b.length - 2;
      const sp = ((a.length - 1) * va + (b.length - 1) * vb) / df;
      if (sp === 0) return E.DIV0;
      t = (mean(a) - mean(b)) / Math.sqrt(sp * (1 / a.length + 1 / b.length));
    } else {
      const se = va / a.length + vb / b.length;
      if (se === 0) return E.DIV0;
      t = (mean(a) - mean(b)) / Math.sqrt(se);
      df = se ** 2 / ((va / a.length) ** 2 / (a.length - 1) + (vb / b.length) ** 2 / (b.length - 1));
    }
  }
  // the t distribution with a fractional df: use the beta form directly
  const x = df / (df + t * t);
  const oneTail = 0.5 * betaI(x, df / 2, 0.5);
  return int(tails) === 1 ? oneTail : 2 * oneTail;
});
alias('TTEST', 'T.TEST');

rawFn('F.TEST', 2, 2, (args, ctx) => {
  const a = numbersOf(args[0]!, ctx);
  if (isErr(a)) return a;
  const b = numbersOf(args[1]!, ctx);
  if (isErr(b)) return b;
  if (a.length < 2 || b.length < 2) return E.DIV0;
  const va = svar(a);
  const vb = svar(b);
  if (va === 0 || vb === 0) return E.DIV0;
  const f = va / vb;
  const p = fCdf(f, a.length - 1, b.length - 1);
  return Math.min(1, 2 * Math.min(p, 1 - p));
});
alias('FTEST', 'F.TEST');

rawFn('CHISQ.TEST', 2, 2, (args, ctx) => {
  const actual = toMatrix(args[0]!, ctx);
  const expected = toMatrix(args[1]!, ctx);
  const r = actual.length;
  const c = actual[0]?.length ?? 0;
  if (r !== expected.length || c !== (expected[0]?.length ?? 0)) return E.NA;
  let stat = 0;
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < c; j++) {
      const a = actual[i]![j]!;
      const e = expected[i]![j]!;
      if (isErr(a)) return a;
      if (isErr(e)) return e;
      if (typeof a !== 'number' || typeof e !== 'number') continue;
      if (e === 0) return E.DIV0;
      stat += (a - e) ** 2 / e;
    }
  }
  const df = r > 1 && c > 1 ? (r - 1) * (c - 1) : r > 1 ? r - 1 : c - 1;
  if (df < 1) return E.NA;
  return gammaQ(df / 2, stat / 2);
});
alias('CHITEST', 'CHISQ.TEST');
