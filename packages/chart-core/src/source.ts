import { CHART_COLORS, type ChartData, type ChartLocale } from './data';
import { errorAmounts, type ErrorBars } from './fit';
import type { ChartSpec, SeriesType } from './model';

/*
 * De dónde salen los números de un gráfico. Las series llevan referencias de rango («Hoja1!$B$2:$B$5»); cada producto sabe leerlas a
 * su manera: Calc, de su libro; Slides y Writer, de la rejilla del propio gráfico (`grid.ts`), que es lo que se incrusta como libro.
 */

/** Un valor de celda tal como lo ve un gráfico (los errores de fórmula llegan como su texto, «#DIV/0!»). */
export type ChartCell = number | string | boolean | null;

export interface RangeRead {
  /** Los valores del rango, por filas. */
  values: ChartCell[];
  /** Los mismos, como texto con el formato de la celda. */
  labels: string[];
}

export interface ChartSource {
  /** Lee un rango; vacío si la referencia no existe o no es legible. */
  range(ref: string | undefined): RangeRead;
}

const num = (v: ChartCell): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Valores de error personalizados: una lista («1;2;3»), un número o un rango. */
function readCustom(src: ChartSource, text: string | undefined): (number | null)[] {
  if (!text) return [];
  const t = text.trim().replace(/^=/, '').replace(/^\{|\}$/g, '');
  if (!t.includes('!') && /^[\d\s.,;+\-eE]+$/.test(t) && !/^[A-Za-z]+\d/.test(t)) return t.split(/[;,]/).map((x) => num(Number(x.trim()))).filter((x, i, a) => !(x === null && i === a.length - 1));
  return src.range(t).values.map(num);
}

/** Los números y las etiquetas que hay detrás de un gráfico, leídos de su fuente. */
export function chartData(def: ChartSpec, src: ChartSource, locale: ChartLocale): ChartData {
  const series = def.series.map((s, i) => {
    const vals = src.range(s.values);
    const cats = src.range(s.categories);
    const nameCell = s.nameRef ? src.range(s.nameRef).labels[0] : undefined;
    const type: SeriesType = s.type ?? (def.type === 'bar' || def.type === 'column' ? 'column' : def.type === 'area' ? 'area' : def.type === 'scatter' ? 'scatter' : 'line');
    const values = vals.values.map(num);
    const x = cats.values.map(num);
    const amounts = (eb: ErrorBars | undefined, of: (number | null)[]) =>
      eb ? errorAmounts(of, eb, eb.kind === 'custom' ? { plus: readCustom(src, eb.plus), minus: readCustom(src, eb.minus ?? eb.plus) } : undefined) : undefined;
    return {
      name: s.name ?? (nameCell || `${locale === 'es' ? 'Serie' : 'Series'} ${i + 1}`),
      values,
      x,
      labels: cats.labels,
      type,
      secondary: !!s.secondary,
      color: s.color ?? CHART_COLORS[i % CHART_COLORS.length]!,
      errY: amounts(s.errY, values),
      errX: def.type === 'scatter' ? amounts(s.errX, x) : undefined,
    };
  });
  const n = Math.max(0, ...series.map((s) => s.values.length));
  const categories = series.find((s) => s.labels.length)?.labels ?? Array.from({ length: n }, (_x, i) => String(i + 1));
  return { categories, series };
}
