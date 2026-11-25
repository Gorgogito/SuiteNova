import { chart3dFor as core3d, chartSvg as coreSvg, echarts, is3D, type ChartPalette } from '@suitenova/chart-core';
import type { ChartDef, FormulaLocale, Workbook } from '@suitenova/calc-engine';
import { chartData, themed } from './chartOption';

export { echarts, is3D };

/** The 3-D picture of a chart of the workbook as SVG text. */
export function chart3dFor(def: ChartDef, wb: Workbook, sheetId: number, locale: FormulaLocale, palette: ChartPalette, width: number, height: number): string {
  return core3d(themed(def, wb), chartData(def, wb, sheetId, locale), palette, width, height);
}

/** Any chart of the workbook as static SVG text (for printing and exporting). */
export function chartSvg(def: ChartDef, wb: Workbook, sheetId: number, locale: FormulaLocale, palette: ChartPalette, width: number, height: number): string {
  return coreSvg(themed(def, wb), chartData(def, wb, sheetId, locale), locale, palette, width, height);
}
