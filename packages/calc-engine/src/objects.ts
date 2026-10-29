import { normRect, rectContains, type Rect } from './addr';
import { evaluate } from './evaluator';
import { adjustForStructure, printFormula, shiftRefs, type StructureChange } from './formula';
import type { Ctx } from './functions/registry';
import { parseFormula } from './parser';
import { shiftRect } from './cf';
import { E, isErr, isRange, type Scalar } from './values';
import type { Sheet, Workbook } from './workbook';
import { toNum, toText } from './coerce';

// ---------------------------------------------------------------------------------------------------- data validation
export type ValidationType = 'any' | 'whole' | 'decimal' | 'list' | 'date' | 'time' | 'textLength' | 'custom';
export type ValidationOp = 'between' | 'notBetween' | 'equal' | 'notEqual' | 'greaterThan' | 'lessThan' | 'greaterThanOrEqual' | 'lessThanOrEqual';

export interface DataValidation {
  id: string;
  ranges: Rect[];
  type: ValidationType;
  op: ValidationOp;
  /** Formula text without "=": a number, a reference, an expression, or for lists a string such as "a,b,c" (quoted) or a range. */
  formula1: string;
  formula2?: string;
  /** Ignore blank cells. */
  allowBlank: boolean;
  /** List only: show the drop-down arrow. */
  showDropdown: boolean;
  showInput: boolean;
  inputTitle?: string;
  inputMessage?: string;
  showError: boolean;
  errorStyle: 'stop' | 'warning' | 'information';
  errorTitle?: string;
  errorMessage?: string;
}

export const VALIDATION_OPS: ValidationOp[] = ['between', 'notBetween', 'equal', 'notEqual', 'greaterThan', 'lessThan', 'greaterThanOrEqual', 'lessThanOrEqual'];

export const newValidation = (id: string, ranges: Rect[]): DataValidation => ({
  id,
  ranges,
  type: 'whole',
  op: 'between',
  formula1: '0',
  formula2: '100',
  allowBlank: true,
  showDropdown: true,
  showInput: true,
  showError: true,
  errorStyle: 'stop',
});

export function validationAt(sheet: Pick<Sheet, 'validations'>, row: number, col: number): DataValidation | undefined {
  for (const v of sheet.validations) if (v.ranges.some((r) => rectContains(normRect(r), row, col))) return v;
  return undefined;
}

/** Evaluate one of the rule's formulas as if written in the rule's first cell and read at (row, col). */
function evalRuleFormula(wb: Workbook, sheet: Sheet, v: DataValidation, text: string, row: number, col: number): Scalar | Scalar[][] {
  let ast;
  try {
    ast = parseFormula(text);
  } catch {
    return E.VALUE;
  }
  const first = normRect(v.ranges[0]!);
  ast = shiftRefs(ast, row - first.r1, col - first.c1);
  const ctx: Ctx = { host: wb, sheetId: sheet.id, row, col, scope: null, volatile: false };
  const r = evaluate(ast, ctx);
  if (isRange(r)) {
    const out: Scalar[][] = [];
    const c = wb.clip(r);
    for (let i = r.r1; i <= r.r2; i++) {
      const rowVals: Scalar[] = [];
      for (let j = r.c1; j <= r.c2; j++) rowVals.push(i > c.r2 || j > c.c2 ? null : wb.cellValue(r.sheetId, i, j));
      out.push(rowVals);
    }
    return out.length === 1 && out[0]!.length === 1 ? out[0]![0]! : out;
  }
  if (typeof r === 'object' && r !== null && 'kind' in r && r.kind === 'array') return r.rows.length === 1 && r.rows[0]!.length === 1 ? r.rows[0]![0]! : r.rows;
  return r as Scalar;
}

/** The choices of a list rule at a cell (text of each item), or null when the rule is not a usable list. */
export function listChoices(wb: Workbook, sheet: Sheet, v: DataValidation, row: number, col: number): { items: Scalar[]; literal: boolean } | null {
  if (v.type !== 'list') return null;
  const t = v.formula1.trim();
  // a quoted literal: "a,b,c"
  try {
    const ast = parseFormula(t);
    if (ast.t === 'str') {
      return {
        items: ast.v
          .split(',')
          .map((s) => s.trim())
          .filter((s, _i, a) => s !== '' || a.length === 1),
        literal: true,
      };
    }
  } catch {
    return null;
  }
  const r = evalRuleFormula(wb, sheet, v, t, row, col);
  if (isErr(r)) return null;
  if (Array.isArray(r)) {
    // a single row or column is a list; a block is not
    if (r.length > 1 && r[0]!.length > 1) return null;
    return { items: r.flat(), literal: false };
  }
  return { items: [r], literal: false };
}

const displayText = (v: Scalar): string => {
  const t = toText(v);
  return isErr(t) ? t.code : t;
};

function compareOp(op: ValidationOp, x: number, a: number, b: number | undefined): boolean {
  switch (op) {
    case 'between':
      return x >= Math.min(a, b ?? a) && x <= Math.max(a, b ?? a);
    case 'notBetween':
      return x < Math.min(a, b ?? a) || x > Math.max(a, b ?? a);
    case 'equal':
      return x === a;
    case 'notEqual':
      return x !== a;
    case 'greaterThan':
      return x > a;
    case 'lessThan':
      return x < a;
    case 'greaterThanOrEqual':
      return x >= a;
    default:
      return x <= a;
  }
}

/**
 * Does `value` satisfy the rule when entered at (row, col)? `override` lets a custom formula see the new value in its own cell,
 * as Excel does, before it is written.
 */
export function checkValidation(wb: Workbook, sheetId: number, v: DataValidation, row: number, col: number, value: Scalar): boolean {
  if (v.type === 'any') return true;
  if (value === null || value === '') return v.allowBlank;
  const sheet = wb.sheet(sheetId);
  if (isErr(value)) return false;
  if (v.type === 'list') {
    const list = listChoices(wb, sheet, v, row, col);
    if (!list) return false;
    const text = displayText(value);
    return list.items.some((it) => (list.literal ? displayText(it) === text : displayText(it).toLowerCase() === text.toLowerCase()));
  }
  if (v.type === 'custom') {
    const cell = sheet.cells.get(row * 16384 + col);
    const saved = cell?.value;
    let r: Scalar | Scalar[][];
    // let the formula see the value that is being entered
    const savedRow = sheet.maxRow;
    const savedCol = sheet.maxCol;
    if (cell) cell.value = value;
    else sheet.cells.set(row * 16384 + col, { value, style: 0 });
    sheet.maxRow = Math.max(sheet.maxRow, row);
    sheet.maxCol = Math.max(sheet.maxCol, col);
    try {
      r = evalRuleFormula(wb, sheet, v, v.formula1, row, col);
    } finally {
      if (cell) cell.value = saved ?? null;
      else sheet.cells.delete(row * 16384 + col);
      sheet.maxRow = savedRow;
      sheet.maxCol = savedCol;
    }
    if (Array.isArray(r)) r = r[0]?.[0] ?? null;
    if (isErr(r)) return false;
    if (typeof r === 'boolean') return r;
    const n = toNum(r);
    return !isErr(n) && n !== 0;
  }
  // numeric families
  let x: number;
  if (v.type === 'textLength') x = displayText(value).length;
  else {
    if (typeof value !== 'number') return false;
    x = value;
    if (v.type === 'whole' && !Number.isInteger(x)) return false;
    if (v.type === 'time') x = x - Math.floor(x);
  }
  const bound = (text: string | undefined): number | null => {
    if (text === undefined || text === '') return null;
    let r = evalRuleFormula(wb, sheet, v, text, row, col);
    if (Array.isArray(r)) r = r[0]?.[0] ?? null;
    const n = toNum(r as Scalar);
    return isErr(n) ? null : n;
  };
  const a = bound(v.formula1);
  if (a === null) return false;
  const needsTwo = v.op === 'between' || v.op === 'notBetween';
  const b = needsTwo ? bound(v.formula2) : undefined;
  if (needsTwo && b === null) return false;
  const norm = v.type === 'time' ? (n: number) => n - Math.floor(n) : (n: number) => n;
  return compareOp(v.op, x, norm(a), b === null || b === undefined ? undefined : norm(b));
}

/** Check a value being entered at a cell against the rule that covers it. */
export function validateEntry(wb: Workbook, sheetId: number, row: number, col: number, value: Scalar): { ok: boolean; rule?: DataValidation } {
  const rule = validationAt(wb.sheet(sheetId), row, col);
  if (!rule || rule.type === 'any') return { ok: true, rule };
  return { ok: checkValidation(wb, sheetId, rule, row, col, value), rule };
}

/** Cells holding values that break their rule ("Circle invalid data"). */
export function invalidCells(wb: Workbook, sheetId: number, limit = 5000): { row: number; col: number }[] {
  const sheet = wb.sheet(sheetId);
  const out: { row: number; col: number }[] = [];
  for (const v of sheet.validations) {
    if (v.type === 'any') continue;
    for (const r0 of v.ranges) {
      const r = normRect(r0);
      const r2 = Math.min(r.r2, sheet.maxRow);
      const c2 = Math.min(r.c2, sheet.maxCol);
      for (let row = r.r1; row <= r2; row++) {
        for (let col = r.c1; col <= c2; col++) {
          const val = wb.getValue(sheetId, row, col);
          if (val === null) continue;
          if (!checkValidation(wb, sheetId, v, row, col, val)) {
            out.push({ row, col });
            if (out.length >= limit) return out;
          }
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- hyperlinks
export interface Hyperlink {
  rect: Rect;
  /** An external address: https://…, mailto:…, a file path. */
  url?: string;
  /** A place in this workbook: "Hoja2!B3" or a defined name. */
  location?: string;
  tooltip?: string;
}

export function hyperlinkAt(sheet: Pick<Sheet, 'hyperlinks'>, row: number, col: number): Hyperlink | undefined {
  return sheet.hyperlinks.find((h) => rectContains(normRect(h.rect), row, col));
}

/** Only these kinds of address are opened; anything else (file:, javascript:, programs) is refused. */
export function safeUrl(url: string): string | null {
  const u = url.trim();
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  if (/^[\w.-]+@[\w.-]+\.\w+$/.test(u)) return `mailto:${u}`;
  if (/^www\./i.test(u)) return `https://${u}`;
  return null;
}

// ---------------------------------------------------------------------------------------------------- comments (notes)
export interface CellComment {
  row: number;
  col: number;
  author: string;
  text: string;
  /** Shown all the time instead of only on hover. */
  visible?: boolean;
  /** Size of the box in pixels. */
  width?: number;
  height?: number;
}

export const commentAt = (sheet: Pick<Sheet, 'comments'>, row: number, col: number): CellComment | undefined => sheet.comments.find((c) => c.row === row && c.col === col);

// ---------------------------------------------------------------------------------------------------- pictures
export interface SheetImage {
  id: string;
  /** Key in the workbook's media store. */
  media: string;
  /** Position and size in sheet pixels (zoom 100%) from the top-left of cell A1. */
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
  alt?: string;
}

export interface MediaItem {
  mime: string;
  data: Uint8Array;
}

// ---------------------------------------------------------------------------------------------------- sparklines
export type SparklineType = 'line' | 'column' | 'winloss';
export interface SparklineGroup {
  id: string;
  type: SparklineType;
  color: string;
  negativeColor: string;
  markerColor: string;
  highColor: string;
  lowColor: string;
  firstColor: string;
  lastColor: string;
  showMarkers: boolean;
  showHigh: boolean;
  showLow: boolean;
  showFirst: boolean;
  showLast: boolean;
  showNegative: boolean;
  lineWeight: number;
  emptyAs: 'gap' | 'zero' | 'span';
  showHidden: boolean;
  rightToLeft: boolean;
  /** Vertical axis limits: shared by the group ("group"), per sparkline ("auto") or given ("custom"). */
  minType: 'auto' | 'group' | 'custom';
  maxType: 'auto' | 'group' | 'custom';
  min?: number;
  max?: number;
  showAxis: boolean;
  /** One entry per cell that shows a sparkline; `source` is a reference such as "Hoja1!B2:G2". */
  items: { row: number; col: number; source: string }[];
}

export const newSparklineGroup = (id: string, type: SparklineType = 'line'): SparklineGroup => ({
  id,
  type,
  color: '#376092',
  negativeColor: '#d00000',
  markerColor: '#d00000',
  highColor: '#d00000',
  lowColor: '#d00000',
  firstColor: '#d00000',
  lastColor: '#d00000',
  showMarkers: false,
  showHigh: false,
  showLow: false,
  showFirst: false,
  showLast: false,
  showNegative: false,
  lineWeight: 1.5,
  emptyAs: 'gap',
  showHidden: false,
  rightToLeft: false,
  minType: 'auto',
  maxType: 'auto',
  showAxis: false,
  items: [],
});

export const sparklineAt = (sheet: Pick<Sheet, 'sparklines'>, row: number, col: number): { group: SparklineGroup; item: SparklineGroup['items'][number] } | undefined => {
  for (const group of sheet.sparklines) {
    const item = group.items.find((i) => i.row === row && i.col === col);
    if (item) return { group, item };
  }
  return undefined;
};

// ---------------------------------------------------------------------------------------------------- names and printing
export interface SheetName {
  name: string;
  text: string;
}

export interface PageSetup {
  orientation: 'portrait' | 'landscape';
  /** Paper size in millimetres. */
  paper: 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal';
  /** Margins in centimetres. */
  margins: { top: number; right: number; bottom: number; left: number };
  /** Percentage when `fit` is not used. */
  scale: number;
  /** Fit all columns in this many pages wide (0 = do not fit) and rows this many tall (0 = as many as needed). */
  fitWidth: number;
  fitHeight: number;
  gridlines: boolean;
  headings: boolean;
  centerH: boolean;
  centerV: boolean;
  header?: string;
  footer?: string;
}

export const defaultPageSetup = (): PageSetup => ({
  orientation: 'portrait',
  paper: 'A4',
  margins: { top: 1.9, right: 1.8, bottom: 1.9, left: 1.8 },
  scale: 100,
  fitWidth: 0,
  fitHeight: 0,
  gridlines: false,
  headings: false,
  centerH: false,
  centerV: false,
  header: '',
  footer: '&P',
});

export interface PrintSettings {
  /** The cells to print; none means the used area. */
  areas: Rect[];
  /** Rows (and columns) repeated on every page. */
  titleRows?: { r1: number; r2: number };
  titleCols?: { c1: number; c2: number };
  /** Rows (columns) after which a page break is forced. */
  rowBreaks: number[];
  colBreaks: number[];
  page: PageSetup;
}

export const defaultPrintSettings = (): PrintSettings => ({ areas: [], rowBreaks: [], colBreaks: [], page: defaultPageSetup() });

// ---------------------------------------------------------------------------------------------------- structure changes
/** Rewrite the objects of a sheet after rows/columns were inserted or deleted somewhere in the workbook. */
export function adjustSheetObjects(sheet: Sheet, ownerName: string, ch: StructureChange): void {
  const here = ownerName.toLowerCase() === ch.sheet.toLowerCase();
  const fix = (text: string | undefined): string | undefined => {
    if (!text) return text;
    try {
      return printFormula(adjustForStructure(parseFormula(text), ownerName, ch));
    } catch {
      return text;
    }
  };
  sheet.validations = sheet.validations.flatMap((v) => {
    const ranges = here ? v.ranges.map((r) => shiftRect(r, ch)).filter((r): r is Rect => r !== null) : v.ranges;
    if (!ranges.length) return [];
    return [{ ...v, ranges, formula1: fix(v.formula1) ?? v.formula1, formula2: fix(v.formula2) }];
  });
  if (!here) return;
  sheet.hyperlinks = sheet.hyperlinks.flatMap((h) => {
    const rect = shiftRect(h.rect, ch);
    return rect ? [{ ...h, rect }] : [];
  });
  sheet.comments = sheet.comments.flatMap((c) => {
    const r = shiftRect({ r1: c.row, r2: c.row, c1: c.col, c2: c.col }, ch);
    return r ? [{ ...c, row: r.r1, col: r.c1 }] : [];
  });
  for (const g of sheet.sparklines) {
    g.items = g.items.flatMap((i) => {
      const r = shiftRect({ r1: i.row, r2: i.row, c1: i.col, c2: i.col }, ch);
      return r ? [{ ...i, row: r.r1, col: r.c1, source: fix(i.source) ?? i.source }] : [];
    });
  }
  const p = sheet.print;
  p.areas = p.areas.map((a) => shiftRect(a, ch)).filter((a): a is Rect => a !== null);
  const shiftIdx = (list: number[], axis: 'row' | 'col') => (ch.axis === axis ? list.map((i) => shiftRect({ r1: i, r2: i, c1: i, c2: i }, ch)).filter((r): r is Rect => r !== null).map((r) => (axis === 'row' ? r.r1 : r.c1)) : list);
  p.rowBreaks = shiftIdx(p.rowBreaks, 'row');
  p.colBreaks = shiftIdx(p.colBreaks, 'col');
  if (p.titleRows && ch.axis === 'row') {
    const r = shiftRect({ r1: p.titleRows.r1, r2: p.titleRows.r2, c1: 0, c2: 0 }, ch);
    p.titleRows = r ? { r1: r.r1, r2: r.r2 } : undefined;
  }
  if (p.titleCols && ch.axis === 'col') {
    const r = shiftRect({ r1: 0, r2: 0, c1: p.titleCols.c1, c2: p.titleCols.c2 }, ch);
    p.titleCols = r ? { c1: r.c1, c2: r.c2 } : undefined;
  }
  for (const n of sheet.names.values()) n.text = fix(n.text) ?? n.text;
}

/** Objects that mention another sheet by name must follow a rename. */
export function renameSheetInObjects(sheet: Sheet, oldName: string, newName: string, rename: (text: string) => string): void {
  void oldName;
  void newName;
  for (const v of sheet.validations) {
    v.formula1 = rename(v.formula1);
    if (v.formula2) v.formula2 = rename(v.formula2);
  }
  for (const g of sheet.sparklines) for (const i of g.items) i.source = rename(i.source);
  for (const n of sheet.names.values()) n.text = rename(n.text);
}

// ---------------------------------------------------------------------------------------------------- pivot tables
export type PivotAgg = 'sum' | 'count' | 'countNums' | 'average' | 'max' | 'min' | 'product' | 'stdev' | 'stdevp' | 'var' | 'varp';
export type PivotShowAs = 'normal' | 'percentOfGrand' | 'percentOfCol' | 'percentOfRow';

export interface PivotValueField {
  field: string;
  agg: PivotAgg;
  /** Caption of the column ("Suma de Importe" when empty). */
  name?: string;
  numFmt?: string;
  showAs?: PivotShowAs;
}

/** Group the items of a field: dates by year/quarter/month/day, numbers in ranges. */
export interface PivotGroup {
  kind: 'year' | 'quarter' | 'month' | 'day' | 'number';
  start?: number;
  end?: number;
  step?: number;
}

export interface PivotDef {
  id: string;
  name: string;
  /** Where the data is: a block of a sheet, or a table. */
  source: { sheet: string; ref: string } | { table: string };
  /** Top-left cell of the output. */
  row: number;
  col: number;
  rows: string[];
  cols: string[];
  values: PivotValueField[];
  filters: string[];
  /** Selected items of a field (filter fields and row/column fields); a field without an entry shows everything. */
  selection: Record<string, string[]>;
  groups: Record<string, PivotGroup>;
  /** Order of a field's items. */
  sort: Record<string, 'asc' | 'desc'>;
  layout: 'compact' | 'outline' | 'tabular';
  grandRows: boolean;
  grandCols: boolean;
  subtotals: boolean;
  repeatLabels: boolean;
  blankRowAfterItem: boolean;
  style: string;
  rowHeaders: boolean;
  colHeaders: boolean;
  rowStripes: boolean;
  colStripes: boolean;
  /** Size of the output the last time it was drawn (to clear it before drawing again). */
  size?: { rows: number; cols: number };
}

export const newPivot = (id: string, name: string, source: PivotDef['source'], row: number, col: number): PivotDef => ({
  id,
  name,
  source,
  row,
  col,
  rows: [],
  cols: [],
  values: [],
  filters: [],
  selection: {},
  groups: {},
  sort: {},
  layout: 'compact',
  grandRows: true,
  grandCols: true,
  subtotals: true,
  repeatLabels: false,
  blankRowAfterItem: false,
  style: 'PivotStyleLight16',
  rowHeaders: true,
  colHeaders: true,
  rowStripes: false,
  colStripes: false,
});

export interface SlicerDef {
  id: string;
  name: string;
  caption: string;
  /** What it filters: a pivot table or a table of the same sheet. */
  target: { kind: 'pivot' | 'table'; id: string };
  field: string;
  /** Items kept; null means all. */
  selected: string[] | null;
  /** Position and size in sheet pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  columns: number;
}
