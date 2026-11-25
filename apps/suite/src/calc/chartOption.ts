import { chartSource, formatValue, type ChartDef, type FormulaLocale, type Workbook } from '@suitenova/calc-engine';
import { seriesColors } from '@suitenova/theme-core';
import { setChartNumberFormatter, chartData as coreData, chartOption as coreOption, type ChartData, type ChartPalette } from '@suitenova/chart-core';

export { CHART_COLORS, type ChartPalette, type ChartSeriesData } from '@suitenova/chart-core';

// las etiquetas de los ejes y de los estadísticos usan el formato de números de las celdas
setChartNumberFormatter((v, f) => formatValue(v, f, 'en').text);

/** The numbers and labels behind a chart, read from the workbook. */
/** The series that have no colour of their own take the colours of the theme of the workbook (so they follow it when it changes). */
export function themed(def: ChartDef, wb: Workbook): ChartDef {
  const cols = seriesColors(wb.theme);
  return { ...def, series: def.series.map((s, i) => (s.color ? s : { ...s, color: cols[i % cols.length] })) };
}

export function chartData(def: ChartDef, wb: Workbook, sheetId: number, locale: FormulaLocale): ChartData {
  return coreData(themed(def, wb), chartSource(wb, sheetId, locale), locale);
}

/** The option echarts draws for a chart of the workbook. */
export function chartOption(def: ChartDef, wb: Workbook, sheetId: number, locale: FormulaLocale, palette: ChartPalette): Record<string, unknown> {
  return coreOption(themed(def, wb), chartData(def, wb, sheetId, locale), locale, palette);
}
