import { errorAmounts, formatValue, isErr, resolveRangeText, type ChartDef, type ErrorBars, type FormulaLocale, type Scalar, type SeriesType, type Workbook } from '@suitenova/calc-engine';
import { CHART_COLORS, setChartNumberFormatter, chartOption as coreOption, type ChartData, type ChartPalette } from '@suitenova/chart-core';

export { CHART_COLORS, type ChartPalette, type ChartSeriesData } from '@suitenova/chart-core';

// las etiquetas de los ejes y de los estadísticos usan el formato de números de las celdas
setChartNumberFormatter((v, f) => formatValue(v, f, 'en').text);

/** Values and display labels of a referenced range, in row-major order. */
function readRange(wb: Workbook, text: string | undefined, fallbackSheet: number, locale: FormulaLocale): { values: Scalar[]; labels: string[] } {
  const r = resolveRangeText(wb, text, fallbackSheet);
  if (!r) return { values: [], labels: [] };
  const sheet = wb.sheet(r.sheetId);
  const values: Scalar[] = [];
  const labels: string[] = [];
  const r2 = Math.min(r.rect.r2, Math.max(sheet.maxRow, r.rect.r1));
  const c2 = Math.min(r.rect.c2, Math.max(sheet.maxCol, r.rect.c1));
  for (let row = r.rect.r1; row <= r2; row++) {
    for (let col = r.rect.c1; col <= c2; col++) {
      const cell = sheet.cells.get(row * 16384 + col);
      const v = cell?.value ?? null;
      values.push(v);
      labels.push(formatValue(v, wb.styles.get(cell?.style ?? 0).numFmt, locale).text);
    }
  }
  return { values, labels };
}

const num = (v: Scalar): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Valores de error personalizados: una lista («1;2;3»), un número o un rango. */
function readCustom(wb: Workbook, text: string | undefined, sheetId: number, locale: FormulaLocale): (number | null)[] {
  if (!text) return [];
  const t = text.trim().replace(/^=/, '').replace(/^\{|\}$/g, '');
  if (!t.includes('!') && /^[\d\s.,;+\-eE]+$/.test(t) && !/^[A-Za-z]+\d/.test(t)) return t.split(/[;,]/).map((x) => num(Number(x.trim()))).filter((x, i, a) => !(x === null && i === a.length - 1));
  return readRange(wb, t, sheetId, locale).values.map((v) => (isErr(v) ? null : num(v)));
}

/** The numbers and labels behind a chart, read from the workbook. */
export function chartData(def: ChartDef, wb: Workbook, sheetId: number, locale: FormulaLocale): ChartData {
  const series = def.series.map((s, i) => {
    const vals = readRange(wb, s.values, sheetId, locale);
    const cats = readRange(wb, s.categories, sheetId, locale);
    const nameCell = s.nameRef ? readRange(wb, s.nameRef, sheetId, locale).labels[0] : undefined;
    const type: SeriesType = s.type ?? (def.type === 'bar' || def.type === 'column' ? 'column' : def.type === 'area' ? 'area' : def.type === 'scatter' ? 'scatter' : 'line');
    const values = vals.values.map((v) => (isErr(v) ? null : num(v)));
    const x = cats.values.map(num);
    const amounts = (eb: ErrorBars | undefined, of: (number | null)[]) =>
      eb ? errorAmounts(of, eb, eb.kind === 'custom' ? { plus: readCustom(wb, eb.plus, sheetId, locale), minus: readCustom(wb, eb.minus ?? eb.plus, sheetId, locale) } : undefined) : undefined;
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

/** The option echarts draws for a chart of the workbook. */
export function chartOption(def: ChartDef, wb: Workbook, sheetId: number, locale: FormulaLocale, palette: ChartPalette): Record<string, unknown> {
  return coreOption(def, chartData(def, wb, sheetId, locale), locale, palette);
}
