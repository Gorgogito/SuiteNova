/**
 * Líneas de tendencia y barras de error de los gráficos (como en Excel): ajuste por mínimos cuadrados de los seis tipos,
 * R², ecuación en texto y cantidades de error. Solo matemáticas: no sabe nada de cómo se dibuja.
 */

export type TrendType = 'linear' | 'exp' | 'log' | 'poly' | 'power' | 'movingAvg';
export const TREND_TYPES: TrendType[] = ['linear', 'exp', 'log', 'poly', 'power', 'movingAvg'];

export interface Trendline {
  type: TrendType;
  /** Grado del polinomio (2 a 6). */
  order?: number;
  /** Periodos de la media móvil (2 o más). */
  period?: number;
  /** Cuánto se prolonga hacia delante y hacia atrás, en unidades del eje X (periodos en gráficos de categorías). */
  forward?: number;
  backward?: number;
  /** Corte con el eje Y forzado (lineal y exponencial). */
  intercept?: number;
  dispEq?: boolean;
  dispR2?: boolean;
  /** Nombre en la leyenda; si falta, el de Excel («Lineal (Serie1)»). */
  name?: string;
  color?: string;
}

export type ErrorKind = 'fixed' | 'percent' | 'stdev' | 'stderr' | 'custom';
export const ERROR_KINDS: ErrorKind[] = ['fixed', 'percent', 'stdev', 'stderr', 'custom'];

export interface ErrorBars {
  kind: ErrorKind;
  /** Valor fijo, porcentaje o número de desviaciones; según el tipo. */
  value?: number;
  /** Personalizado: un rango («Hoja1!$C$2:$C$6»), una lista («1,2,3») o un solo número. */
  plus?: string;
  minus?: string;
  direction: 'both' | 'plus' | 'minus';
  /** Sin remate en los extremos. */
  noCap?: boolean;
}

export interface Fit {
  type: TrendType;
  /** Valor de la tendencia en x (NaN si no se puede calcular ahí). */
  predict(x: number): number;
  /** «y = 2x + 1»; vacío en la media móvil. */
  equation: string;
  /** Coeficiente de determinación; null si no se define. */
  r2: number | null;
  /** Coeficientes del polinomio (de menor a mayor grado), o [a, b] del resto de tipos. */
  coeffs: number[];
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Un número con hasta 5 cifras significativas, como lo muestra Excel en la ecuación. */
export function fmtCoeff(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) {
    const [m, e] = v.toExponential(4).split('e');
    const ex = Number(e);
    return `${Number(m)}E${ex < 0 ? '-' : '+'}${String(Math.abs(ex)).padStart(2, '0')}`;
  }
  return String(Number(v.toPrecision(5)));
}

const SUP: Record<string, string> = { '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶' };

/** Resuelve A·c = b por eliminación gaussiana con pivote parcial; null si es singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (Math.abs(M[piv]![col]!) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    for (let r = col + 1; r < n; r++) {
      const f = M[r]![col]! / M[col]![col]!;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r]![n]!;
    for (let c = r + 1; c < n; c++) s -= M[r]![c]! * x[c]!;
    x[r] = s / M[r]![r]!;
  }
  return x;
}

/** Ajuste de un polinomio de grado `deg` (con `deg = 1` es la recta). */
function polyFit(xs: number[], ys: number[], deg: number): number[] | null {
  if (xs.length <= deg) return null;
  const k = deg + 1;
  // se centra x para que el sistema no se degrade; los coeficientes se devuelven en x original
  const xm = xs.reduce((a, x) => a + x, 0) / xs.length;
  const t = xs.map((x) => x - xm);
  const A = Array.from({ length: k }, (_r, i) => Array.from({ length: k }, (_c, j) => t.reduce((a, v) => a + Math.pow(v, i + j), 0)));
  const rhs = Array.from({ length: k }, (_r, i) => t.reduce((a, v, p) => a + Math.pow(v, i) * ys[p]!, 0));
  const c = solve(A, rhs);
  if (!c) return null;
  // p(t) = Σ c_i t^i con t = x - xm  →  coeficientes de x
  const out = new Array<number>(k).fill(0);
  for (let i = 0; i < k; i++) {
    // c_i (x - xm)^i = c_i Σ_j C(i,j) x^j (-xm)^(i-j)
    let binom = 1;
    for (let j = i; j >= 0; j--) {
      out[j]! += c[i]! * binom * Math.pow(-xm, i - j);
      binom = (binom * j) / (i - j + 1);
    }
  }
  return out;
}

const polyAt = (c: number[], x: number): number => c.reduceRight((acc, a) => acc * x + a, 0);

function r2Of(ys: number[], pred: number[], base?: number): number | null {
  const mean = base ?? ys.reduce((a, y) => a + y, 0) / ys.length;
  const tot = ys.reduce((a, y) => a + (y - mean) * (y - mean), 0);
  const res = ys.reduce((a, y, i) => a + (y - pred[i]!) * (y - pred[i]!), 0);
  return tot === 0 ? (res === 0 ? 1 : null) : 1 - res / tot;
}

function signed(c: number, term: string, first: boolean): string {
  const mag = fmtCoeff(Math.abs(c));
  const body = mag === '1' && term ? term : `${mag}${term}`;
  return first ? `${c < 0 ? '-' : ''}${body}` : ` ${c < 0 ? '-' : '+'} ${body}`;
}

/** Ajusta la tendencia a los puntos (x, y); null si no se puede (pocos puntos, o valores no positivos en log/exp/potencia). */
export function fitTrend(points: { x: number; y: number }[], tl: Trendline): Fit | null {
  const pts = points.filter((p) => finite(p.x) && finite(p.y));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const n = pts.length;
  if (tl.type === 'movingAvg') {
    const period = Math.max(2, Math.trunc(tl.period ?? 2));
    if (n < period) return null;
    const sorted = pts.slice();
    return {
      type: 'movingAvg',
      predict: (x) => {
        const i = sorted.findIndex((p) => p.x === x);
        return i < period - 1 ? NaN : sorted.slice(i - period + 1, i + 1).reduce((a, p) => a + p.y, 0) / period;
      },
      equation: '',
      r2: null,
      coeffs: [],
    };
  }
  if (n < 2) return null;

  if (tl.type === 'linear' || tl.type === 'poly') {
    const deg = tl.type === 'linear' ? 1 : Math.min(6, Math.max(2, Math.trunc(tl.order ?? 2)));
    let c: number[] | null;
    let base: number | undefined;
    if (tl.type === 'linear' && finite(tl.intercept)) {
      const c0 = tl.intercept;
      const sxx = xs.reduce((a, x) => a + x * x, 0);
      if (sxx === 0) return null;
      c = [c0, xs.reduce((a, x, i) => a + x * (ys[i]! - c0), 0) / sxx];
      base = c0;
    } else c = polyFit(xs, ys, deg);
    if (!c) return null;
    const coeffs = c;
    const pred = xs.map((x) => polyAt(coeffs, x));
    // con el corte forzado el total se mide respecto a él, como hace Excel
    const r2 = base === undefined ? r2Of(ys, pred) : r2Of(ys, pred, base);
    let eq = 'y = ';
    let first = true;
    for (let p = deg; p >= 0; p--) {
      const a = coeffs[p]!;
      if (p === 0 && !first && a === 0 && finite(tl.intercept)) continue;
      eq += signed(a, p === 0 ? '' : p === 1 ? 'x' : `x${SUP[String(p)]}`, first);
      first = false;
    }
    return { type: tl.type, predict: (x) => polyAt(coeffs, x), equation: eq, r2, coeffs };
  }

  if (tl.type === 'log') {
    if (xs.some((x) => x <= 0)) return null;
    const c = polyFit(xs.map(Math.log), ys, 1);
    if (!c) return null;
    const [a, b] = c as [number, number];
    const pred = xs.map((x) => a + b * Math.log(x));
    return { type: 'log', predict: (x) => (x > 0 ? a + b * Math.log(x) : NaN), equation: `y = ${signed(b, 'ln(x)', true)}${signed(a, '', false)}`, r2: r2Of(ys, pred), coeffs: [a, b] };
  }

  if (tl.type === 'exp') {
    if (ys.some((y) => y <= 0)) return null;
    const ly = ys.map(Math.log);
    let la: number;
    let b: number;
    if (finite(tl.intercept) && tl.intercept > 0) {
      la = Math.log(tl.intercept);
      const sxx = xs.reduce((s, x) => s + x * x, 0);
      if (sxx === 0) return null;
      b = xs.reduce((s, x, i) => s + x * (ly[i]! - la), 0) / sxx;
    } else {
      const c = polyFit(xs, ly, 1);
      if (!c) return null;
      [la, b] = c as [number, number];
    }
    const a = Math.exp(la);
    // Excel mide R² del ajuste lineal de ln(y)
    const r2 = r2Of(ly, xs.map((x) => la + b * x));
    return { type: 'exp', predict: (x) => a * Math.exp(b * x), equation: `y = ${fmtCoeff(a)}e^${fmtCoeff(b)}x`, r2, coeffs: [a, b] };
  }

  // potencia
  if (xs.some((x) => x <= 0) || ys.some((y) => y <= 0)) return null;
  const lx = xs.map(Math.log);
  const ly = ys.map(Math.log);
  const c = polyFit(lx, ly, 1);
  if (!c) return null;
  const [la, b] = c as [number, number];
  const a = Math.exp(la);
  return { type: 'power', predict: (x) => (x > 0 ? a * Math.pow(x, b) : NaN), equation: `y = ${fmtCoeff(a)}x^${fmtCoeff(b)}`, r2: r2Of(ly, lx.map((x) => la + b * x)), coeffs: [a, b] };
}

/** Puntos de la línea de tendencia sobre [min − atrás, max + adelante]; para la media móvil, un punto por cada x que tiene valor. */
export function trendPath(fit: Fit, points: { x: number; y: number }[], tl: Trendline): [number, number][] {
  const pts = points.filter((p) => finite(p.x) && finite(p.y)).sort((a, b) => a.x - b.x);
  if (!pts.length) return [];
  if (fit.type === 'movingAvg') {
    return pts.map((p) => [p.x, fit.predict(p.x)] as [number, number]).filter((p) => finite(p[1]));
  }
  const lo = pts[0]!.x - Math.max(0, tl.backward ?? 0);
  const hi = pts[pts.length - 1]!.x + Math.max(0, tl.forward ?? 0);
  const steps = fit.type === 'linear' ? 1 : 80;
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const x = lo + ((hi - lo) * i) / steps;
    const y = fit.predict(x);
    if (finite(y)) out.push([x, y]);
  }
  return out;
}

/** Nombre de la tendencia en la leyenda, como en Excel. */
export function trendName(tl: Trendline, seriesName: string, es: boolean): string {
  if (tl.name) return tl.name;
  if (tl.type === 'movingAvg') {
    const p = Math.max(2, Math.trunc(tl.period ?? 2));
    return es ? `${p} per. Media móvil (${seriesName})` : `${p} per. Mov. Avg. (${seriesName})`;
  }
  const label: Record<Exclude<TrendType, 'movingAvg'>, [string, string]> = {
    linear: ['Lineal', 'Linear'],
    exp: ['Exponencial', 'Expon.'],
    log: ['Logarítmica', 'Log.'],
    poly: ['Polinómica', 'Poly.'],
    power: ['Potencial', 'Power'],
  };
  return `${label[tl.type][es ? 0 : 1]} (${seriesName})`;
}

/** Cantidades de error por punto. `custom` trae ya los valores leídos de los rangos. */
export function errorAmounts(values: (number | null)[], eb: ErrorBars, custom?: { plus: (number | null)[]; minus: (number | null)[] }): { plus: (number | null)[]; minus: (number | null)[] } {
  const nums = values.filter(finite);
  const mean = nums.reduce((a, v) => a + v, 0) / (nums.length || 1);
  const sd = nums.length > 1 ? Math.sqrt(nums.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (nums.length - 1)) : 0;
  const per = (v: number | null, i: number, side: 'plus' | 'minus'): number | null => {
    if (!finite(v)) return null;
    switch (eb.kind) {
      case 'fixed':
        return Math.abs(eb.value ?? 1);
      case 'percent':
        return (Math.abs(v) * Math.abs(eb.value ?? 5)) / 100;
      case 'stdev':
        return sd * Math.abs(eb.value ?? 1);
      case 'stderr':
        return nums.length ? sd / Math.sqrt(nums.length) : 0;
      default: {
        const arr = custom?.[side];
        const x = arr ? (arr.length === 1 ? arr[0] : arr[i]) : null;
        return finite(x) ? Math.abs(x) : 0;
      }
    }
  };
  return {
    plus: values.map((v, i) => (eb.direction === 'minus' ? 0 : per(v, i, 'plus'))),
    minus: values.map((v, i) => (eb.direction === 'plus' ? 0 : per(v, i, 'minus'))),
  };
}
