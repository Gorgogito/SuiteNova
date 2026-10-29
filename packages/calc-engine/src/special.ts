// Special functions behind the statistical distributions. Plain double arithmetic; no dependencies.

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** Natural log of |Γ(x)|. */
export function lgamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = LANCZOS[0]!;
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i]! / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

export function gamma(x: number): number {
  if (Number.isInteger(x) && x > 0 && x < 171) {
    let r = 1;
    for (let i = 2; i < x; i++) r *= i;
    return r;
  }
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  return Math.exp(lgamma(x));
}

const EPS = 1e-16;
const TINY = 1e-300;

/** Regularised lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (!Number.isFinite(x)) return 1;
  if (x < a + 1) {
    // series
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 1000; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * EPS) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  return 1 - gammaQcf(a, x);
}

/** Regularised upper incomplete gamma Q(a, x) by continued fraction (x ≥ a + 1). */
function gammaQcf(a: number, x: number): number {
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}

export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (!Number.isFinite(x)) return 0;
  return x < a + 1 ? 1 - gammaP(a, x) : gammaQcf(a, x);
}

export function erf(x: number): number {
  if (x === 0) return 0;
  return x > 0 ? gammaP(0.5, x * x) : -gammaP(0.5, x * x);
}

export function erfc(x: number): number {
  return x >= 0 ? gammaQ(0.5, x * x) : 1 + gammaP(0.5, x * x);
}

const SQRT2 = Math.SQRT2;
export const normPdf = (z: number): number => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
export const normCdf = (z: number): number => 0.5 * erfc(-z / SQRT2);

/** Inverse of the standard normal distribution (Acklam's rational approximation, then refined to full precision). */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let x: number;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  }
  for (let i = 0; i < 2; i++) {
    const e = normCdf(x) - p;
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
    x -= u / (1 + (x * u) / 2);
  }
  return x;
}

/** Regularised incomplete beta function I_x(a, b). */
export function betaI(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = lgamma(a + b) - lgamma(a) - lgamma(b);
  const front = Math.exp(lbeta + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (front * betaCf(x, a, b)) / a;
  return 1 - (front * betaCf(1 - x, b, a)) / b;
}

function betaCf(x: number, a: number, b: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 1000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Student's t cumulative distribution. */
export function tCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const tail = 0.5 * betaI(x, df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}

export function chiCdf(x: number, df: number): number {
  return gammaP(df / 2, x / 2);
}

export function fCdf(x: number, d1: number, d2: number): number {
  if (x <= 0) return 0;
  return betaI((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2);
}

/**
 * Solve cdf(x) = p for a nondecreasing cdf on [lo, hi] (hi may be Infinity: the bracket grows until it contains p).
 * Bisection to machine precision; slow but dependable for every distribution here.
 */
export function invert(cdf: (x: number) => number, p: number, lo: number, hi: number, start = 1): number {
  if (!Number.isFinite(hi)) {
    hi = lo + start;
    let guard = 0;
    while (cdf(hi) < p && guard++ < 2000) hi = lo + (hi - lo) * 2;
  }
  if (!Number.isFinite(lo)) {
    lo = hi - start;
    let guard = 0;
    while (cdf(lo) > p && guard++ < 2000) lo = hi - (hi - lo) * 2;
  }
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) break;
    if (cdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** ln of the binomial coefficient C(n, k). */
export const lchoose = (n: number, k: number): number => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);

export function binomPmf(k: number, n: number, p: number): number {
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(lchoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

export function binomCdf(k: number, n: number, p: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  return betaI(1 - p, n - k, k + 1);
}

export function poissonPmf(k: number, mean: number): number {
  if (mean === 0) return k === 0 ? 1 : 0;
  return Math.exp(-mean + k * Math.log(mean) - lgamma(k + 1));
}

export function poissonCdf(k: number, mean: number): number {
  if (k < 0) return 0;
  return gammaQ(k + 1, mean);
}
