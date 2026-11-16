import { MAX_COLS, MAX_ROWS, normRect, type Rect } from './addr';
import type { Node } from './ast';
import { adjustForStructure, printFormula, renameSheetRefs, type StructureChange } from './formula';
import { parseFormula } from './parser';
import type { ChartSeries, ChartSpec, ChartType, StockKind } from '@suitenova/chart-core';
import type { Scalar } from './values';
import type { Sheet, Workbook } from './workbook';
import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT } from './workbook';

import { DEFAULT_3D } from '@suitenova/chart-core';
export { DEFAULT_3D, SERIES_TYPES, STOCK_SERIES } from '@suitenova/chart-core';
export type { Chart3D, ChartAxis, ChartSeries, ChartSpec, ChartType, SeriesType, StockKind } from '@suitenova/chart-core';

/** Un gráfico de una hoja: el modelo común más su sitio en ella. */
export interface ChartDef extends ChartSpec {
  id: string;
  /** Position and size in sheet pixels (zoom 100%), measured from the top-left of cell A1. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResolvedRange {
  sheetId: number;
  rect: Rect;
}

/** Parse "Hoja1!$A$1:$B$4" (or an unqualified ref, resolved against `fallbackSheet`). */
export function resolveRangeText(wb: Workbook, text: string | undefined, fallbackSheet: number): ResolvedRange | null {
  if (!text) return null;
  let node: Node;
  try {
    node = parseFormula(text);
  } catch {
    return null;
  }
  if (node.t !== 'ref' && node.t !== 'range') return null;
  const sheet = node.sheet === undefined ? wb.sheets.find((s) => s.id === fallbackSheet) : wb.sheetByName(node.sheet);
  if (!sheet) return null;
  const a = node.a;
  const b = node.t === 'range' ? node.b : node.a;
  return { sheetId: sheet.id, rect: normRect({ r1: a.row, c1: a.col, r2: b.row, c2: b.col }) };
}

/** Values of a referenced range in row-major order, limited to the sheet's used area. */
export function readRangeValues(wb: Workbook, text: string | undefined, fallbackSheet: number): Scalar[] {
  const r = resolveRangeText(wb, text, fallbackSheet);
  if (!r) return [];
  const sheet = wb.sheet(r.sheetId);
  const out: Scalar[] = [];
  const r2 = Math.min(r.rect.r2, Math.max(sheet.maxRow, r.rect.r1));
  const c2 = Math.min(r.rect.c2, Math.max(sheet.maxCol, r.rect.c1));
  for (let row = r.rect.r1; row <= r2; row++) for (let col = r.rect.c1; col <= c2; col++) out.push(wb.getValue(r.sheetId, row, col));
  return out;
}

export function rangeText(sheetName: string, rect: Rect): string {
  const q = /^[A-Za-z_][\w.]*$/.test(sheetName) ? sheetName : `'${sheetName.replace(/'/g, "''")}'`;
  const col = (n: number) => {
    let s = '';
    let x = n + 1;
    while (x > 0) {
      s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
      x = Math.floor((x - 1) / 26);
    }
    return s;
  };
  const a = `$${col(rect.c1)}$${rect.r1 + 1}`;
  const b = `$${col(rect.c2)}$${rect.r2 + 1}`;
  return `${q}!${rect.r1 === rect.r2 && rect.c1 === rect.c2 ? a : `${a}:${b}`}`;
}

/** Pixel offsets of columns/rows, honouring custom sizes and hidden items. */
export function colOffsetPx(sheet: Sheet, col: number): number {
  let x = col * DEFAULT_COL_WIDTH;
  for (const [c, w] of sheet.colWidths) if (c < col) x += w - DEFAULT_COL_WIDTH;
  for (const c of sheet.hiddenCols) if (c < col) x -= sheet.colWidths.get(c) ?? DEFAULT_COL_WIDTH;
  return x;
}
export function rowOffsetPx(sheet: Sheet, row: number): number {
  let y = row * DEFAULT_ROW_HEIGHT;
  for (const [r, h] of sheet.rowHeights) if (r < row) y += h - DEFAULT_ROW_HEIGHT;
  for (const r of new Set([...sheet.hiddenRows, ...sheet.filterHidden])) if (r < row) y -= sheet.rowHeights.get(r) ?? DEFAULT_ROW_HEIGHT;
  return y;
}
export function colAtPx(sheet: Sheet, px: number): { col: number; offset: number } {
  let col = 0;
  let x = 0;
  while (col < MAX_COLS - 1) {
    const w = sheet.hiddenCols.has(col) ? 0 : (sheet.colWidths.get(col) ?? DEFAULT_COL_WIDTH);
    if (x + w > px) break;
    x += w;
    col++;
  }
  return { col, offset: px - x };
}
export function rowAtPx(sheet: Sheet, px: number): { row: number; offset: number } {
  let row = 0;
  let y = 0;
  while (row < MAX_ROWS - 1) {
    const h = sheet.hiddenRows.has(row) || sheet.filterHidden.has(row) ? 0 : (sheet.rowHeights.get(row) ?? DEFAULT_ROW_HEIGHT);
    if (y + h > px) break;
    y += h;
    row++;
  }
  return { row, offset: px - y };
}

const mapText = (text: string | undefined, fn: (n: Node) => Node): string | undefined => {
  if (!text) return text;
  try {
    return printFormula(fn(parseFormula(text)));
  } catch {
    return text;
  }
};

/** Keep chart references valid when rows/columns are inserted or deleted. */
export function adjustChartRefs(charts: ChartDef[], formulaSheet: string, ch: StructureChange): ChartDef[] {
  return charts.map((c) => ({
    ...c,
    series: c.series.map((s) => ({
      ...s,
      nameRef: mapText(s.nameRef, (n) => adjustForStructure(n, formulaSheet, ch)),
      categories: mapText(s.categories, (n) => adjustForStructure(n, formulaSheet, ch)),
      values: mapText(s.values, (n) => adjustForStructure(n, formulaSheet, ch)) ?? s.values,
    })),
  }));
}

export function renameChartRefs(charts: ChartDef[], oldName: string, newName: string): ChartDef[] {
  return charts.map((c) => ({
    ...c,
    series: c.series.map((s) => ({
      ...s,
      nameRef: mapText(s.nameRef, (n) => renameSheetRefs(n, oldName, newName)),
      categories: mapText(s.categories, (n) => renameSheetRefs(n, oldName, newName)),
      values: mapText(s.values, (n) => renameSheetRefs(n, oldName, newName)) ?? s.values,
    })),
  }));
}

/**
 * Guess a sensible chart definition for a selected block: a text first column becomes the categories,
 * a text first row names the series, every other numeric column becomes a series.
 */
export function suggestChart(wb: Workbook, sheetId: number, rect: Rect, type: ChartType): Omit<ChartDef, 'id' | 'x' | 'y' | 'width' | 'height'> | null {
  const r = normRect(rect);
  const sheet = wb.sheet(sheetId);
  const r2 = Math.min(r.r2, sheet.maxRow);
  const c2 = Math.min(r.c2, sheet.maxCol);
  if (r2 < r.r1 || c2 < r.c1) return null;
  const isNum = (row: number, col: number) => typeof wb.getValue(sheetId, row, col) === 'number';
  const isText = (row: number, col: number) => typeof wb.getValue(sheetId, row, col) === 'string' && wb.getValue(sheetId, row, col) !== '';

  // header row: first row is all text (or empty corner) and the next row has numbers
  let firstDataRow = r.r1;
  let hasHeader = false;
  if (r2 > r.r1) {
    const cols = Array.from({ length: c2 - r.c1 + 1 }, (_x, i) => r.c1 + i);
    const textHeader = cols.every((c) => isText(r.r1, c) || wb.getValue(sheetId, r.r1, c) === null);
    const numbersBelow = cols.some((c) => isNum(r.r1 + 1, c));
    if (textHeader && numbersBelow) {
      hasHeader = true;
      firstDataRow = r.r1 + 1;
    }
  }
  // categories: first column, if it holds text or dates rather than plain numbers
  let firstSeriesCol = r.c1;
  let catCol: number | null = null;
  if (c2 > r.c1) {
    let textCells = 0;
    let numCells = 0;
    for (let row = firstDataRow; row <= r2; row++) {
      if (isText(row, r.c1)) textCells++;
      else if (isNum(row, r.c1)) numCells++;
    }
    const dateLike = typeof wb.styles.get(wb.getCell(sheetId, firstDataRow, r.c1)?.style ?? 0).numFmt === 'string' && /[dmy]/i.test(wb.styles.get(wb.getCell(sheetId, firstDataRow, r.c1)?.style ?? 0).numFmt ?? '');
    if (textCells > 0 || dateLike || type === 'scatter') {
      catCol = r.c1;
      firstSeriesCol = r.c1 + 1;
    } else if (numCells > 0 && numCells === r2 - firstDataRow + 1 && c2 - r.c1 === 1 && type === 'pie') {
      catCol = null;
    }
  }
  const sheetName = sheet.name;
  const series: ChartSeries[] = [];
  for (let c = firstSeriesCol; c <= c2; c++) {
    let numeric = 0;
    for (let row = firstDataRow; row <= r2; row++) if (isNum(row, c)) numeric++;
    if (numeric === 0) continue;
    const s: ChartSeries = { values: rangeText(sheetName, { r1: firstDataRow, c1: c, r2, c2: c }) };
    if (hasHeader) s.nameRef = rangeText(sheetName, { r1: r.r1, c1: c, r2: r.r1, c2: c });
    if (catCol !== null) s.categories = rangeText(sheetName, { r1: firstDataRow, c1: catCol, r2, c2: catCol });
    series.push(s);
    if (type === 'pie' || type === 'doughnut') break;
  }
  if (!series.length) return null;
  const out: Omit<ChartDef, 'id' | 'x' | 'y' | 'width' | 'height'> = { type, legend: type === 'pie' || type === 'doughnut' || series.length > 1, series };
  if (type === 'stock') {
    // High-Low-Close, Open-High-Low-Close, or either with the volume first
    const name = (sh: ChartSeries) => (sh.nameRef ? String(readRangeValues(wb, sh.nameRef, sheetId)[0] ?? '') : '');
    const kind: StockKind | null = series.length === 3 ? 'hlc' : series.length === 4 ? (/vol/i.test(name(series[0]!)) ? 'vhlc' : 'ohlc') : series.length === 5 ? 'vohlc' : null;
    if (!kind) return null;
    out.stock = { kind };
    out.legend = true;
  }
  if (type === 'surface') {
    if (series.length < 2) return null;
    out.threeD = { ...DEFAULT_3D, rotX: 15, rotY: 20, rightAngle: false, perspective: 30 };
    out.legend = true;
  }
  return out;
}
