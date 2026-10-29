import { normRect, rectContains, type Rect } from './addr';
import type { TableArea } from './ast';
import { E, type CalcError, type RangeVal } from './values';
import type { AutoFilter } from './filter';
import type { Sheet } from './workbook';

export type TableTotal = 'none' | 'sum' | 'average' | 'count' | 'countNums' | 'max' | 'min' | 'stdDev' | 'var' | 'custom';

export interface TableColumn {
  name: string;
  total?: TableTotal;
  /** Text shown in the totals row instead of a function (usually the first column: "Total"). */
  totalLabel?: string;
  /** Formula of a calculated column: written into every new row. */
  calc?: string;
}

export interface TableDef {
  id: string;
  /** Unique in the workbook, no spaces. */
  name: string;
  /** Includes the header row and the totals row when they exist. */
  ref: Rect;
  header: boolean;
  totals: boolean;
  columns: TableColumn[];
  style: string;
  rowStripes: boolean;
  colStripes: boolean;
  firstCol: boolean;
  lastCol: boolean;
  filterButtons: boolean;
  /** Filter state of the header buttons; its range follows the table. */
  filter?: AutoFilter;
}

export interface TableParts {
  all: Rect;
  header?: Rect;
  data: Rect;
  totals?: Rect;
}

export function tableParts(t: TableDef): TableParts {
  const r = normRect(t.ref);
  const hr = t.header ? 1 : 0;
  const tr = t.totals ? 1 : 0;
  return {
    all: r,
    header: t.header ? { ...r, r2: r.r1 } : undefined,
    data: { ...r, r1: r.r1 + hr, r2: Math.max(r.r1 + hr, r.r2 - tr) },
    totals: t.totals ? { ...r, r1: r.r2 } : undefined,
  };
}

export const tableAt = (sheet: Pick<Sheet, 'tables'>, row: number, col: number): TableDef | undefined => sheet.tables.find((t) => rectContains(normRect(t.ref), row, col));

/** SUBTOTAL numbers Excel uses for the totals row (they ignore rows hidden by a filter). */
export const TOTAL_SUBTOTAL: Record<Exclude<TableTotal, 'none' | 'custom'>, number> = { average: 101, count: 103, countNums: 102, max: 104, min: 105, stdDev: 107, sum: 109, var: 110 };

export function totalFormula(t: TableDef, col: number): string | null {
  const c = t.columns[col];
  if (!c || !c.total || c.total === 'none' || c.total === 'custom') return null;
  return `SUBTOTAL(${TOTAL_SUBTOTAL[c.total]},${t.name}[${bracketName(c.name)}])`;
}

// ------------------------------------------------------------------------------------------------ structured references
const SPECIAL_CHARS = /[\s,:.[\]#'"{}$^&*+=\-<>/\\()%!?;@~|`]/;

/** Escape the characters that have a meaning inside a structured reference. */
export const escapeColumn = (name: string): string => name.replace(/(['#[\]])/g, "'$1");
const unescapeColumn = (s: string): string => s.replace(/'(['#[\]])/g, '$1');

/** A column name as it goes inside the reference brackets. */
function bracketName(name: string): string {
  return escapeColumn(name);
}

const AREA_TEXT: Record<Exclude<TableArea, 'data' | 'thisRow' | 'headersData' | 'dataTotals'>, string> = { all: '#All', headers: '#Headers', totals: '#Totals' };

export interface PrintTrefOptions {
  /** Use [[#This Row],[Col]] (the form stored in files) instead of [@Col]. */
  file?: boolean;
}

export function printTref(n: { table?: string; area: TableArea; col1?: string; col2?: string }, o: PrintTrefOptions = {}): string {
  const table = n.table ?? '';
  const col = (name: string) => `[${escapeColumn(name)}]`;
  const cols = n.col1 === undefined ? '' : n.col2 === undefined ? col(n.col1) : `${col(n.col1)}:${col(n.col2)}`;
  const plain = (name: string) => !SPECIAL_CHARS.test(name);
  const plainData = (name: string) => !SPECIAL_CHARS.test(name.replace(/ /g, ''));
  switch (n.area) {
    case 'data':
      if (n.col1 === undefined) return `${table}[]`;
      return n.col2 === undefined && plainData(n.col1) ? `${table}[${escapeColumn(n.col1)}]` : `${table}[${cols}]`;
    case 'thisRow':
      if (!o.file) {
        if (n.col1 === undefined) return `${table}[@]`;
        if (n.col2 === undefined) return plain(n.col1) ? `${table}[@${escapeColumn(n.col1)}]` : `${table}[@${col(n.col1)}]`;
        return `${table}[@${cols}]`;
      }
      return `${table}[[#This Row]${cols ? `,${cols}` : ''}]`;
    case 'headersData':
      return `${table}[[#Headers],[#Data]${cols ? `,${cols}` : ''}]`;
    case 'dataTotals':
      return `${table}[[#Data],[#Totals]${cols ? `,${cols}` : ''}]`;
    default: {
      const tag = AREA_TEXT[n.area];
      return cols ? `${table}[[${tag}],${cols}]` : `${table}[${tag}]`;
    }
  }
}

/** Split the inside of a structured reference at top-level commas. */
function splitTop(body: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === "'" && i + 1 < body.length) {
      cur += ch + body[++i]!;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    if (ch === sep && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

const SPECIALS: Record<string, 'all' | 'data' | 'headers' | 'totals' | 'thisRow'> = { '#all': 'all', '#data': 'data', '#headers': 'headers', '#totals': 'totals', '#this row': 'thisRow' };

/** Parse what is between the outer brackets of a structured reference. Returns null when it is not valid. */
export function parseTrefBody(body: string): { area: TableArea; col1?: string; col2?: string } | null {
  let text = body.trim();
  let thisRow = false;
  if (text.startsWith('@')) {
    thisRow = true;
    text = text.slice(1).trim();
  }
  const specials = new Set<string>();
  const cols: string[] = [];
  const addItem = (item: string): boolean => {
    let it = item.trim();
    if (it.startsWith('[') && it.endsWith(']')) it = it.slice(1, -1);
    const sp = SPECIALS[it.toLowerCase()];
    if (it.startsWith('#') && !sp) return false;
    if (sp) specials.add(sp);
    else cols.push(unescapeColumn(it));
    return true;
  };
  if (text === '') {
    // Table[] and Table[@]
  } else if (!/(^|[^'])\[/.test(text)) {
    // a bare item: Col, #Data, Col1:Col2 is not valid without brackets
    if (!addItem(text)) return null;
  } else {
    for (const part of splitTop(text, ',')) {
      const range = splitTop(part, ':');
      if (range.length === 2) {
        if (!addItem(range[0]!) || !addItem(range[1]!)) return null;
      } else if (range.length === 1) {
        if (part.trim() !== '' && !addItem(part)) return null;
      } else return null;
    }
  }
  if (thisRow) specials.add('thisRow');
  if (cols.length > 2) return null;
  let area: TableArea;
  const has = (k: string) => specials.has(k);
  if (specials.size === 0) area = 'data';
  else if (specials.size === 1) area = [...specials][0] as TableArea;
  else if (specials.size === 2 && has('headers') && has('data')) area = 'headersData';
  else if (specials.size === 2 && has('data') && has('totals')) area = 'dataTotals';
  else if (specials.size === 2 && has('thisRow') && has('data')) area = 'thisRow';
  else if (specials.has('all')) area = 'all';
  else return null;
  return { area, col1: cols[0], col2: cols[1] };
}

/** The part of a table a structured reference covers; `row` is the row of the formula (for [@Col]). */
export function resolveTref(
  sheetId: number,
  t: TableDef,
  n: { area: TableArea; col1?: string; col2?: string },
  row: number,
): RangeVal | CalcError {
  const parts = tableParts(t);
  let r1: number;
  let r2: number;
  switch (n.area) {
    case 'data':
      [r1, r2] = [parts.data.r1, parts.data.r2];
      break;
    case 'all':
      [r1, r2] = [parts.all.r1, parts.all.r2];
      break;
    case 'headers':
      if (!parts.header) return E.REF;
      [r1, r2] = [parts.header.r1, parts.header.r1];
      break;
    case 'totals':
      if (!parts.totals) return E.REF;
      [r1, r2] = [parts.totals.r1, parts.totals.r1];
      break;
    case 'headersData':
      [r1, r2] = [parts.header ? parts.header.r1 : parts.data.r1, parts.data.r2];
      break;
    case 'dataTotals':
      [r1, r2] = [parts.data.r1, parts.totals ? parts.totals.r1 : parts.data.r2];
      break;
    default:
      if (row < parts.data.r1 || row > parts.data.r2) return E.VALUE;
      [r1, r2] = [row, row];
  }
  const names = t.columns.map((c) => c.name.toLowerCase());
  let c1 = 0;
  let c2 = t.columns.length - 1;
  if (n.col1 !== undefined) {
    c1 = names.indexOf(n.col1.toLowerCase());
    c2 = n.col2 === undefined ? c1 : names.indexOf(n.col2.toLowerCase());
    if (c1 < 0 || c2 < 0) return E.REF;
  }
  const base = parts.all.c1;
  return { kind: 'range', sheetId, r1, r2, c1: base + Math.min(c1, c2), c2: base + Math.max(c1, c2) };
}

// ------------------------------------------------------------------------------------------------ names
export function uniqueColumnName(wanted: string, taken: string[]): string {
  const lower = new Set(taken.map((s) => s.toLowerCase()));
  if (wanted && !lower.has(wanted.toLowerCase())) return wanted;
  const base = wanted || 'Columna';
  let i = 1;
  while (lower.has(`${base}${i}`.toLowerCase())) i++;
  return `${base}${i}`;
}

/** Is this a legal table name (letters, digits, underscore, period; not a cell reference; no spaces)? */
export function validTableName(name: string): boolean {
  return /^[A-Za-z_\\À-￿][\w.À-￿]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) && !/^[RrCc]$/.test(name) && !/^R\d*C\d*$/i.test(name);
}

// ------------------------------------------------------------------------------------------------ styles
export interface TableStyleLook {
  headerBg?: string;
  headerFg: string;
  headerBold: boolean;
  /** Colours of the two row bands (odd data rows, even data rows). */
  band1?: string;
  band2?: string;
  /** Colours of the column bands. */
  colBand1?: string;
  /** Border colour for the outside of the table and under the header. */
  line?: string;
  /** Border between all cells. */
  grid?: string;
  fg?: string;
  totalsBold: boolean;
  totalsTop?: string;
  firstColBold: boolean;
}

const ACCENTS = ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47'];

const hexToRgb = (h: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h)!;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** Mix a colour with white (t > 0) or black (t < 0). */
const tint = (hex: string, t: number): string => {
  const [r, g, b] = hexToRgb(hex);
  const mix = (c: number) => Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t));
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
};

export const TABLE_STYLE_NAMES: string[] = [
  ...Array.from({ length: 21 }, (_x, i) => `TableStyleLight${i + 1}`),
  ...Array.from({ length: 28 }, (_x, i) => `TableStyleMedium${i + 1}`),
  ...Array.from({ length: 11 }, (_x, i) => `TableStyleDark${i + 1}`),
];

export const DEFAULT_TABLE_STYLE = 'TableStyleMedium2';

/** A look for a style name. The family and colour follow Excel's numbering; the exact tints are an approximation. */
export function tableStyleLook(name: string): TableStyleLook | null {
  const m = /^TableStyle(Light|Medium|Dark)(\d+)$/.exec(name);
  if (!m) return null;
  const family = m[1]!;
  const k = Number(m[2]) - 1;
  const variant = Math.floor(k / 7);
  const slot = k % 7; // 0 = no colour, 1..6 = accent 1..6
  const base = slot === 0 ? '#595959' : ACCENTS[slot - 1]!;
  const dark = tint(base, -0.35);
  if (family === 'Light') {
    if (variant === 0) return { headerFg: '#000000', headerBold: true, band1: tint(base, 0.82), line: base, totalsBold: true, totalsTop: base, firstColBold: true };
    if (variant === 1) return { headerBg: slot === 0 ? '#000000' : base, headerFg: '#ffffff', headerBold: true, band1: undefined, line: base, grid: undefined, totalsBold: true, totalsTop: base, firstColBold: true };
    return { headerFg: '#000000', headerBold: true, band1: tint(base, 0.85), line: base, grid: base, totalsBold: true, totalsTop: base, firstColBold: true };
  }
  if (family === 'Medium') {
    if (variant === 0) return { headerBg: base, headerFg: '#ffffff', headerBold: true, band1: tint(base, 0.8), line: base, totalsBold: true, totalsTop: base, firstColBold: true };
    if (variant === 1) return { headerBg: dark, headerFg: '#ffffff', headerBold: true, band1: tint(base, 0.75), line: dark, totalsBold: true, totalsTop: dark, firstColBold: true };
    if (variant === 2) return { headerBg: base, headerFg: '#ffffff', headerBold: true, band1: tint(base, 0.8), grid: '#ffffff', line: base, totalsBold: true, totalsTop: base, firstColBold: true };
    return { headerBg: dark, headerFg: '#ffffff', headerBold: true, band1: tint(base, 0.55), grid: '#ffffff', line: dark, totalsBold: true, totalsTop: dark, firstColBold: true };
  }
  // Dark
  const body = slot === 0 ? '#4d4d4d' : dark;
  return { headerBg: '#262626', headerFg: '#ffffff', headerBold: true, band1: tint(body, 0.0), band2: tint(body, -0.12), fg: '#ffffff', line: '#262626', totalsBold: true, totalsTop: '#ffffff', firstColBold: true };
}

// ------------------------------------------------------------------------------------------------ pivot styles
export interface PivotLook {
  headerBg?: string;
  headerFg: string;
  subtotalBg?: string;
  grandBg?: string;
  grandFg: string;
  line?: string;
}

export const PIVOT_STYLE_NAMES: string[] = [
  ...Array.from({ length: 28 }, (_x, i) => `PivotStyleLight${i + 1}`),
  ...Array.from({ length: 28 }, (_x, i) => `PivotStyleMedium${i + 1}`),
  ...Array.from({ length: 28 }, (_x, i) => `PivotStyleDark${i + 1}`),
];

/** Colours a pivot style gives the headers and totals (approximate: the number picks family and accent as in Excel's gallery). */
export function pivotStyleLook(name: string): PivotLook {
  const m = /^PivotStyle(Light|Medium|Dark)(\d+)$/.exec(name);
  const family = m?.[1] ?? 'Light';
  const k = Math.max(0, (Number(m?.[2] ?? 16) - 1) % 28);
  const slot = k % 7;
  const base = slot === 0 ? '#595959' : ACCENTS[slot - 1]!;
  if (family === 'Light') return { headerBg: tint(base, 0.8), headerFg: '#000000', grandFg: '#000000', line: base };
  if (family === 'Medium') return { headerBg: base, headerFg: '#ffffff', subtotalBg: tint(base, 0.8), grandBg: tint(base, 0.6), grandFg: '#000000', line: base };
  return { headerBg: '#262626', headerFg: '#ffffff', subtotalBg: tint(base, -0.1), grandBg: tint(base, -0.25), grandFg: '#ffffff', line: '#262626' };
}
