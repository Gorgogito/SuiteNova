import { chartSource, formatValue, type ChartDef, type FormulaLocale, type Workbook } from '@suitenova/calc-engine';
import { setChartNumberFormatter, chartData as coreData, chartOption as coreOption, type ChartData, type ChartPalette } from '@suitenova/chart-core';

export { CHART_COLORS, type ChartPalette, type ChartSeriesData } from '@suitenova/chart-core';

// las etiquetas de los ejes y de los estadísticos usan el formato de números de las celdas
setChartNumberFormatter((v, f) => formatValue(v, f, 'en').text);

/** The numbers and labels behind a chart, read from the workbook. */
export function chartData(def: ChartDef, wb: Workbook, sheetId: number, locale: FormulaLocale): ChartData {
  return coreData(def, chartSource(wb, sheetId, locale), locale);
}

/** The option echarts draws for a chart of the workbook. */
export function chartOption(def: ChartDef, wb: Workbook, sheetId: number, locale: FormulaLocale, palette: ChartPalette): Record<string, unknown> {
  return coreOption(def, chartData(def, wb, sheetId, locale), locale, palette);
}
