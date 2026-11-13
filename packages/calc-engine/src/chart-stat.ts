/**
 * Cálculos de los gráficos estadísticos de Excel 2016: histograma (clases), cajas y bigotes (cuartiles, bigotes y atípicos) y cascada.
 * Solo matemáticas, sin saber cómo se dibuja.
 */

export interface HistogramOptions {
  /** Ancho de cada clase; si falta se usa `binCount` o la regla automática de Scott. */
  binWidth?: number;
  binCount?: number;
  /** Los valores mayores que este se juntan en una última clase «> x». */
  overflow?: number;
  /** Los valores menores o iguales que este se juntan en una primera clase «≤ x». */
  underflow?: number;
  /** Intervalos cerrados por la derecha (a, b], como en Excel por omisión, o por la izquierda [a, b). */
  closed?: 'right' | 'left';
}

export interface HistogramBin {
  label: string;
  count: number;
  from: number;
  to: number;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Ancho automático de Scott: 3,49 · s / n^(1/3). */
export function scottWidth(values: number[]): number {
  const n = values.length;
  if (n < 2) return 1;
  const mean = values.reduce((a, v) => a + v, 0) / n;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (n - 1));
  return sd === 0 ? 1 : (3.49 * sd) / Math.cbrt(n);
}

const num = (v: number): string => String(Number(v.toPrecision(10)));

/** Reparte los valores en clases; devuelve las clases con su recuento y su rótulo («[1, 3]», «(3, 5]», «≤ 1», «> 9»). */
export function histogramBins(values: number[], o: HistogramOptions = {}): HistogramBin[] {
  const v = values.filter(finite);
  if (!v.length) return [];
  const closed = o.closed ?? 'right';
  const lo0 = Math.min(...v);
  const hi0 = Math.max(...v);
  const under = finite(o.underflow) && o.underflow > lo0 ? o.underflow : undefined;
  const over = finite(o.overflow) && o.overflow < hi0 ? o.overflow : undefined;
  // las clases normales cubren [lo, hi]
  const lo = under ?? lo0;
  const hi = over ?? hi0;
  let width = finite(o.binWidth) && o.binWidth > 0 ? o.binWidth : finite(o.binCount) && o.binCount >= 1 ? (hi - lo) / Math.trunc(o.binCount) : scottWidth(v);
  if (!(width > 0)) width = 1;
  let n = Math.max(1, Math.ceil((hi - lo) / width - 1e-9));
  if (finite(o.binCount) && o.binCount >= 1 && !(finite(o.binWidth) && o.binWidth > 0)) n = Math.trunc(o.binCount);
  const edges = Array.from({ length: n + 1 }, (_x, i) => lo + i * width);
  const bins: HistogramBin[] = [];
  if (under !== undefined) bins.push({ label: `≤ ${num(under)}`, count: 0, from: -Infinity, to: under });
  for (let i = 0; i < n; i++) {
    const a = edges[i]!;
    const b = edges[i + 1]!;
    const first = i === 0 && under === undefined;
    const label = closed === 'right' ? `${first ? '[' : '('}${num(a)}, ${num(b)}]` : `[${num(a)}, ${num(b)}${i === n - 1 && over === undefined ? ']' : ')'}`;
    bins.push({ label, count: 0, from: a, to: b });
  }
  if (over !== undefined) bins.push({ label: `> ${num(over)}`, count: 0, from: over, to: Infinity });
  for (const x of v) {
    let k = -1;
    for (let i = 0; i < bins.length; i++) {
      const b = bins[i]!;
      const isUnder = i === 0 && under !== undefined;
      const isOver = i === bins.length - 1 && over !== undefined;
      let hit: boolean;
      if (isUnder) hit = x <= b.to;
      else if (isOver) hit = x > b.from;
      else if (closed === 'right') hit = (x > b.from && x <= b.to) || (x === b.from && i === (under !== undefined ? 1 : 0));
      else hit = (x >= b.from && x < b.to) || (x === b.to && i === bins.length - 1 - (over !== undefined ? 1 : 0));
      if (hit) {
        k = i;
        break;
      }
    }
    if (k >= 0) bins[k]!.count++;
  }
  return bins;
}

// ------------------------------------------------------------------------------------------------ cajas y bigotes
export interface BoxStats {
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  /** Extremos de los bigotes: el menor y el mayor valor dentro de 1,5 veces el rango intercuartílico. */
  lowWhisker: number;
  highWhisker: number;
  outliers: number[];
}

const medianOf = (s: number[]): number => {
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
};

/** Estadísticos de una caja. `inclusive`: la mediana entra en las dos mitades (Excel: «mediana inclusiva»); si no, se excluye cuando n es impar. */
export function boxStats(values: number[], inclusive = false): BoxStats | null {
  const s = values.filter(finite).sort((a, b) => a - b);
  const n = s.length;
  if (!n) return null;
  const median = medianOf(s);
  const half = Math.floor(n / 2);
  const lower = inclusive ? s.slice(0, Math.ceil(n / 2)) : s.slice(0, half);
  const upper = inclusive ? s.slice(half) : s.slice(n - half);
  const q1 = n === 1 ? s[0]! : medianOf(lower);
  const q3 = n === 1 ? s[0]! : medianOf(upper);
  const iqr = q3 - q1;
  const loFence = q1 - 1.5 * iqr;
  const hiFence = q3 + 1.5 * iqr;
  const inside = s.filter((x) => x >= loFence && x <= hiFence);
  return {
    n,
    min: s[0]!,
    q1,
    median,
    q3,
    max: s[n - 1]!,
    mean: s.reduce((a, x) => a + x, 0) / n,
    lowWhisker: inside[0] ?? s[0]!,
    highWhisker: inside[inside.length - 1] ?? s[n - 1]!,
    outliers: s.filter((x) => x < loFence || x > hiFence),
  };
}

// ------------------------------------------------------------------------------------------------ cascada
export interface WaterfallStep {
  /** Donde empieza y donde acaba la barra (en valores del eje). */
  start: number;
  end: number;
  /** Lo que aporta el punto (su valor; en un total, el total). */
  value: number;
  kind: 'increase' | 'decrease' | 'total';
}

/** Pasos de un gráfico en cascada. Los puntos de `totals` parten de cero y fijan el acumulado en su valor. */
export function waterfallSteps(values: (number | null)[], totals: number[] = []): WaterfallStep[] {
  const isTotal = new Set(totals);
  let running = 0;
  return values.map((raw, i) => {
    const v = finite(raw) ? raw : 0;
    if (isTotal.has(i)) {
      running = v;
      return { start: 0, end: v, value: v, kind: 'total' as const };
    }
    const start = running;
    running += v;
    return { start, end: running, value: v, kind: v >= 0 ? ('increase' as const) : ('decrease' as const) };
  });
}
