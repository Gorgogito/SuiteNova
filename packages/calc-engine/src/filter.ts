import { normRect, type Rect } from './addr';
import { compareScalars, textToNumber } from './coerce';
import { formatValue } from './format';
import { inPeriod, type RelPeriod } from './reldate';
import { serialFromDate, ymdFromSerial } from './dates';
import { isErr, type Scalar } from './values';
import type { Sheet, Workbook } from './workbook';

export type FilterOp = 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le' | 'contains' | 'notContains' | 'beginsWith' | 'endsWith';

export interface FilterCondition {
  op: FilterOp;
  value: string;
}

/** Filtros dinámicos de Excel: por el promedio, por un periodo relativo a hoy, o por un trimestre/mes de cualquier año. */
export type DynamicFilter = 'aboveAverage' | 'belowAverage' | RelPeriod | { quarter: 1 | 2 | 3 | 4 } | { month: number };

export interface ColumnFilter {
  /** Allowed display texts (locale independent, see `cellKeyText`); "" stands for blank cells. */
  values?: string[];
  /** One or two conditions combined with AND/OR. */
  conditions?: { list: FilterCondition[]; and: boolean };
  /** «Diez mejores»: los n valores mayores (o menores), o el n % de ellos. */
  top?: { n: number; percent?: boolean; bottom?: boolean };
  dynamic?: DynamicFilter;
  /** Por color del relleno o de la fuente de la celda; `null` = sin relleno / color automático. */
  color?: { kind: 'cell' | 'font'; color: string | null };
  /** Agrupaciones de fecha marcadas en el filtro de valores (año, mes, día). */
  dates?: { year: number; month?: number; day?: number }[];
}

export interface AutoFilter {
  /** Includes the header row (first row of the range). */
  range: Rect;
  /** Filters by absolute column index. */
  columns: Record<number, ColumnFilter>;
}

/** Is the row hidden by the user or by a filter? */
export const isRowHidden = (s: Pick<Sheet, 'hiddenRows' | 'filterHidden'>, row: number): boolean => s.hiddenRows.has(row) || s.filterHidden.has(row);

/**
 * Text used to match a cell against a values filter. It uses the cell's number format with the
 * English locale so a saved filter does not depend on the interface language.
 */
export function cellKeyText(wb: Workbook, sheet: Sheet, row: number, col: number): string {
  const c = sheet.cells.get(row * 16384 + col);
  const v: Scalar = c?.value ?? null;
  if (v === null) return '';
  return formatValue(v, wb.styles.get(c?.style ?? 0).numFmt, 'en').text;
}

export interface ColumnValue {
  key: string;
  /** How many rows in the filter range have this value. */
  count: number;
  sample: Scalar;
}

/** Distinct values of a column of the filter range (header excluded), sorted like a spreadsheet. */
export function columnValues(wb: Workbook, sheet: Sheet, af: AutoFilter, col: number): ColumnValue[] {
  const r = normRect(af.range);
  const map = new Map<string, ColumnValue>();
  for (let row = r.r1 + 1; row <= r.r2; row++) {
    const key = cellKeyText(wb, sheet, row, col);
    const e = map.get(key.toLowerCase());
    if (e) e.count++;
    else map.set(key.toLowerCase(), { key, count: 1, sample: sheet.cells.get(row * 16384 + col)?.value ?? null });
  }
  const rank = (v: Scalar) => (v === null ? 4 : isErr(v) ? 3 : typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
  return [...map.values()].sort((a, b) => {
    const ra = rank(a.sample);
    const rb = rank(b.sample);
    return ra !== rb ? ra - rb : compareScalars(a.sample, b.sample);
  });
}

function matchesCondition(v: Scalar, text: string, cond: FilterCondition): boolean {
  const target = cond.value;
  const num = textToNumber(target);
  const lower = text.toLowerCase();
  const t = target.toLowerCase();
  switch (cond.op) {
    case 'contains':
      return lower.includes(t);
    case 'notContains':
      return !lower.includes(t);
    case 'beginsWith':
      return lower.startsWith(t);
    case 'endsWith':
      return lower.endsWith(t);
    default: {
      if (num !== null && typeof v === 'number') {
        return cond.op === 'eq' ? v === num : cond.op === 'ne' ? v !== num : cond.op === 'gt' ? v > num : cond.op === 'ge' ? v >= num : cond.op === 'lt' ? v < num : v <= num;
      }
      // text comparison (wildcards * and ? are honoured for equality)
      if ((cond.op === 'eq' || cond.op === 'ne') && /[*?]/.test(target)) {
        const re = new RegExp('^' + target.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
        return cond.op === 'eq' ? re.test(text) : !re.test(text);
      }
      const c = lower < t ? -1 : lower > t ? 1 : 0;
      return cond.op === 'eq' ? c === 0 : cond.op === 'ne' ? c !== 0 : cond.op === 'gt' ? c > 0 : cond.op === 'ge' ? c >= 0 : cond.op === 'lt' ? c < 0 : c <= 0;
    }
  }
}

interface ColStats {
  nums: number[];
  mean: number;
  /** Umbral para «diez mejores» (valor del puesto n), o null si no hay datos. */
  topCut: number | null;
}

function statsOf(sheet: Sheet, af: AutoFilter, col: number, f: ColumnFilter): ColStats {
  const r = normRect(af.range);
  const nums: number[] = [];
  for (let row = r.r1 + 1; row <= r.r2; row++) {
    const v = sheet.cells.get(row * 16384 + col)?.value;
    if (typeof v === 'number') nums.push(v);
  }
  const sorted = [...nums].sort((a, b) => a - b);
  const mean = nums.length ? nums.reduce((a, x) => a + x, 0) / nums.length : 0;
  let topCut: number | null = null;
  if (f.top && sorted.length) {
    const n = f.top.percent ? Math.max(1, Math.floor((sorted.length * f.top.n) / 100)) : Math.max(1, Math.trunc(f.top.n));
    const k = Math.min(n, sorted.length);
    topCut = f.top.bottom ? sorted[k - 1]! : sorted[sorted.length - k]!;
  }
  return { nums, mean, topCut };
}

function passesDynamic(d: DynamicFilter, v: Scalar, st: ColStats, today: number): boolean {
  if (typeof v !== 'number') return false;
  if (d === 'aboveAverage') return v > st.mean;
  if (d === 'belowAverage') return v < st.mean;
  if (typeof d === 'string') return inPeriod(v, d, today);
  const { m } = ymdFromSerial(v);
  return 'quarter' in d ? Math.floor((m - 1) / 3) + 1 === d.quarter : m === d.month;
}

/** Color del relleno o de la fuente de la celda (sin el contexto de formato condicional). */
function cellColor(wb: Workbook, sheet: Sheet, row: number, col: number, kind: 'cell' | 'font'): string | null {
  const st = wb.styles.get(sheet.cells.get(row * 16384 + col)?.style ?? 0);
  return (kind === 'cell' ? st.bg : st.color) ?? null;
}

/** Does a row pass every column filter? `cache` evita recalcular estadísticas de columna en cada fila. */
export function rowPasses(wb: Workbook, sheet: Sheet, af: AutoFilter, row: number, cache: Map<number, ColStats> = new Map()): boolean {
  for (const [colStr, f] of Object.entries(af.columns)) {
    const col = Number(colStr);
    const v: Scalar = sheet.cells.get(row * 16384 + col)?.value ?? null;
    const text = cellKeyText(wb, sheet, row, col);
    if (f.values && !f.values.some((x) => x.toLowerCase() === text.toLowerCase())) return false;
    if (f.top || f.dynamic) {
      let st = cache.get(col);
      if (!st) {
        st = statsOf(sheet, af, col, f);
        cache.set(col, st);
      }
      if (f.top && (typeof v !== 'number' || st.topCut === null || (f.top.bottom ? v > st.topCut : v < st.topCut))) return false;
      if (f.dynamic && !passesDynamic(f.dynamic, v, st, Math.floor(serialFromDate(wb.now())))) return false;
    }
    if (f.color) {
      const c = cellColor(wb, sheet, row, col, f.color.kind);
      if ((c ?? null)?.toLowerCase() !== (f.color.color ?? null)?.toLowerCase()) return false;
    }
    if (f.dates) {
      if (typeof v !== 'number') return false;
      const { y, m, d } = ymdFromSerial(v);
      if (!f.dates.some((g) => g.year === y && (g.month === undefined || g.month === m) && (g.day === undefined || g.day === d))) return false;
    }
    if (f.conditions && f.conditions.list.length) {
      const hits = f.conditions.list.map((c) => matchesCondition(v, text, c));
      if (!(f.conditions.and ? hits.every(Boolean) : hits.some(Boolean))) return false;
    }
  }
  return true;
}

/** Recompute which rows of the sheet are hidden by its autofilter. */
export function applyAutoFilter(wb: Workbook, sheet: Sheet): void {
  sheet.filterHidden = new Set();
  // the sheet's own filter and the filters of its tables each hide the rows that fail them
  const filters = [sheet.autoFilter, ...sheet.tables.map((t) => t.filter)];
  for (const af of filters) {
    if (!af) continue;
    const r = normRect(af.range);
    const cache = new Map<number, ColStats>();
    for (let row = r.r1 + 1; row <= r.r2; row++) if (!rowPasses(wb, sheet, af, row, cache)) sheet.filterHidden.add(row);
  }
}

export const hasActiveFilter = (af: AutoFilter | undefined): boolean => !!af && Object.keys(af.columns).length > 0;

/** (visible, total) data rows of the filter range. */
export function filterCounts(sheet: Sheet): { shown: number; total: number } | null {
  const af = sheet.autoFilter;
  if (!af) return null;
  const r = normRect(af.range);
  const total = Math.max(0, r.r2 - r.r1);
  let hidden = 0;
  for (let row = r.r1 + 1; row <= r.r2; row++) if (sheet.filterHidden.has(row)) hidden++;
  return { shown: total - hidden, total };
}
