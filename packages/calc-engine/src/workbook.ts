import { cellKey, keyCol, keyRow, MAX_COLS, MAX_ROWS, normRect, rectContains, type Rect } from './addr';
import type { Node } from './ast';
import { evaluate } from './evaluator';
import type { ChartDef } from './charts';
import { adjustCFRules, renameCFRefs, shiftRect, type CFRule } from './cf';
import { applyAutoFilter, columnValues, type AutoFilter } from './filter';
import { adjustChartRefs, renameChartRefs } from './charts';
import { adjustForStructure, mapNode, printFormula, renameSheetRefs, shiftRefs, walk, type StructureChange } from './formula';
import {
  adjustSheetObjects,
  defaultPrintSettings,
  renameSheetInObjects,
  type CellComment,
  type DataValidation,
  type Hyperlink,
  type MediaItem,
  type PivotDef,
  type PrintSettings,
  type SheetImage,
  type SheetName,
  type SlicerDef,
  type SparklineGroup,
} from './objects';
import { computePivot, pivotCovers, sourceHeaders, PIVOT_LABELS_ES, type PivotData, type PivotLabels, type PivotOutput } from './pivot';
import { pivotStyleLook, resolveTref, totalFormula as totalFormulaFor, uniqueColumnName, type TableDef } from './tables';
import './functions/index';
import { registry, type Ctx, type EvalHost } from './functions/registry';
import { parseInput } from './input';
import { parseFormula } from './parser';
import { StyleTable, type Style } from './styles';
import { arr, E, isArray, isLambda, isRange, isRefs, type CalcError, type RangeVal, type Scalar, type Value } from './values';

/** An argument of a sheet function called from a macro: a value, an array or a block of cells. */
export type ArrayLikeValue = Scalar | { kind: 'array'; rows: Scalar[][] } | { sheetId: number; rect: Rect };

export interface FormulaInfo {
  text: string;
  ast: Node;
}

export interface CellData {
  value: Scalar;
  formula?: FormulaInfo;
  style: number;
  /** Local key of the anchor cell whose array result spilled into this cell. */
  spillOf?: number;
}

export interface Sheet {
  id: number;
  name: string;
  cells: Map<number, CellData>;
  colWidths: Map<number, number>;
  rowHeights: Map<number, number>;
  hiddenCols: Set<number>;
  hiddenRows: Set<number>;
  /** Rows hidden by the autofilter (kept apart from rows the user hid). */
  filterHidden: Set<number>;
  autoFilter?: AutoFilter;
  condFormats: CFRule[];
  merges: Rect[];
  freeze: { rows: number; cols: number };
  charts: ChartDef[];
  tabColor?: string;
  showGrid: boolean;
  maxRow: number;
  maxCol: number;
  /** anchor local key -> spill extent */
  spills: Map<number, { rows: number; cols: number }>;
  /** anchors whose array result could not spill (#SPILL!) -> extent they tried to use */
  blocked: Map<number, { rows: number; cols: number }>;
  validations: DataValidation[];
  hyperlinks: Hyperlink[];
  comments: CellComment[];
  images: SheetImage[];
  tables: TableDef[];
  sparklines: SparklineGroup[];
  pivots: PivotDef[];
  slicers: SlicerDef[];
  /** Names that only exist in this sheet. */
  names: Map<string, SheetName & { ast: Node }>;
  print: PrintSettings;
}

/** The parts of a sheet that are plain data (copied for undo and for duplicating a sheet). */
export interface ObjectsSnap {
  validations: DataValidation[];
  hyperlinks: Hyperlink[];
  comments: CellComment[];
  images: SheetImage[];
  tables: TableDef[];
  sparklines: SparklineGroup[];
  pivots: PivotDef[];
  slicers: SlicerDef[];
  names: SheetName[];
  print: PrintSettings;
}

export function captureObjects(s: Sheet): ObjectsSnap {
  return structuredClone({
    validations: s.validations,
    hyperlinks: s.hyperlinks,
    comments: s.comments,
    images: s.images,
    tables: s.tables,
    sparklines: s.sparklines,
    pivots: s.pivots,
    slicers: s.slicers,
    names: [...s.names.values()].map((n) => ({ name: n.name, text: n.text })),
    print: s.print,
  });
}

export function applyObjects(s: Sheet, o: ObjectsSnap): void {
  const c = structuredClone(o);
  s.validations = c.validations;
  s.hyperlinks = c.hyperlinks;
  s.comments = c.comments;
  s.images = c.images;
  s.tables = c.tables;
  s.sparklines = c.sparklines;
  s.pivots = c.pivots;
  s.slicers = c.slicers;
  s.names = new Map();
  for (const n of c.names) {
    try {
      s.names.set(n.name.toLowerCase(), { ...n, ast: parseFormula(n.text) });
    } catch {
      // a name that no longer parses is dropped
    }
  }
  s.print = c.print;
}

/** Global cell id: sheet id and local key packed into one safe integer. */
const SHEET_STRIDE = MAX_ROWS * MAX_COLS; // 2^34
export const gkey = (sheetId: number, row: number, col: number): number => sheetId * SHEET_STRIDE + cellKey(row, col);
const gSheet = (g: number): number => Math.floor(g / SHEET_STRIDE);
const gLocal = (g: number): number => g % SHEET_STRIDE;

export const DEFAULT_COL_WIDTH = 64;
export const DEFAULT_ROW_HEIGHT = 20;

export interface CellSnap {
  value: Scalar;
  formula?: string;
  style: number;
}

export type Op =
  | { k: 'cell'; sheetId: number; key: number; before: CellSnap | null; after: CellSnap | null }
  | { k: 'struct'; before: SheetsSnapshot; after: SheetsSnapshot }
  | { k: 'meta'; sheetId: number; before: SheetMeta; after: SheetMeta };

export interface SheetMeta {
  colWidths: [number, number][];
  rowHeights: [number, number][];
  hiddenCols: number[];
  hiddenRows: number[];
  filterHidden: number[];
  autoFilter?: AutoFilter;
  condFormats: CFRule[];
  merges: Rect[];
  freeze: { rows: number; cols: number };
  charts: ChartDef[];
  name: string;
  objects: ObjectsSnap;
}

export type Patch = Op[];

type SheetsSnapshot = {
  sheets: { id: number; name: string; cells: Map<number, CellData>; meta: SheetMeta; maxRow: number; maxCol: number; spills: Map<number, { rows: number; cols: number }> }[];
};

interface RangeDep {
  sheetId: number;
  rect: Rect;
  owner: number;
}

interface Precedents {
  cells: number[];
  ranges: RangeDep[];
}

export type ChangeListener = () => void;

function snapOf(c: CellData | undefined): CellSnap | null {
  if (!c) return null;
  return { value: c.formula ? null : c.value, formula: c.formula?.text, style: c.style };
}

export class Workbook implements EvalHost {
  sheets: Sheet[] = [];
  styles = new StyleTable();
  names = new Map<string, { name: string; text: string; ast: Node }>();
  /** Set by the application: runs functions written in macro modules (=MiFuncion(A1)). */
  userFunction?: (name: string, args: Value[]) => Value | undefined;
  /** Words pivot tables use (set by the application to match the interface language). */
  pivotLabels: PivotLabels = PIVOT_LABELS_ES;
  /** Code modules (Nova Basic) saved with the workbook; the engine only keeps them. */
  macros: { name: string; code: string }[] = [];
  /** Pictures of the workbook, by key; sheets refer to them. */
  media = new Map<string, MediaItem>();
  /** Workbook-default font; per-cell fonts are stored only when they differ. */
  defaultFont = { name: 'Calibri', size: 11 };
  private nextSheetId = 1;
  private byId = new Map<number, Sheet>();
  private listeners = new Set<ChangeListener>();
  private version = 0;

  // dependency graph
  private cellDependents = new Map<number, Set<number>>();
  private rangeIndex = new Map<number, Map<number, Set<RangeDep>>>(); // sheetId -> col -> deps
  private wideRanges = new Map<number, Set<RangeDep>>(); // sheetId -> ranges spanning many columns
  private precedents = new Map<number, Precedents>();
  private volatileCells = new Set<number>();
  /** Formula cells that call SUBTOTAL (they depend on which rows are hidden). */
  private subtotalCells = new Set<number>();
  /** Formula cells that use a 3D reference. */
  private threeDCells = new Set<number>();
  private dirty = new Set<number>();

  private recording: Patch | null = null;
  /** True while an undo or redo is being applied (the patch already holds every consequence). */
  private replaying = false;
  private hasTables(): boolean {
    return this.sheets.some((s) => s.tables.length > 0);
  }
  private suspended = 0;
  private randomFn: () => number = Math.random;
  private nowFn: () => Date = () => new Date();

  // -------------------------------------------------------------------------------- sheets
  constructor() {
    this.addSheet('Hoja1');
  }

  addSheet(name?: string, index?: number): Sheet {
    const id = this.nextSheetId++;
    const sheet: Sheet = {
      id,
      name: name ?? this.uniqueSheetName('Hoja'),
      cells: new Map(),
      colWidths: new Map(),
      rowHeights: new Map(),
      hiddenCols: new Set(),
      hiddenRows: new Set(),
      filterHidden: new Set(),
      condFormats: [],
      merges: [],
      freeze: { rows: 0, cols: 0 },
      charts: [],
      showGrid: true,
      maxRow: -1,
      maxCol: -1,
      spills: new Map(),
      blocked: new Map(),
      validations: [],
      hyperlinks: [],
      comments: [],
      images: [],
      tables: [],
      sparklines: [],
      pivots: [],
      slicers: [],
      names: new Map(),
      print: defaultPrintSettings(),
    };
    this.byId.set(id, sheet);
    if (index === undefined) this.sheets.push(sheet);
    else this.sheets.splice(index, 0, sheet);
    if (this.threeDCells.size) this.sheetOrderChanged();
    else this.emit();
    return sheet;
  }

  private uniqueSheetName(base: string): string {
    let i = this.sheets.length + 1;
    while (this.sheetByName(`${base}${i}`)) i++;
    return `${base}${i}`;
  }

  sheet(id: number): Sheet {
    const s = this.byId.get(id);
    if (!s) throw new Error(`Hoja ${id} inexistente`);
    return s;
  }

  sheetByName(name: string): Sheet | undefined {
    const n = name.toLowerCase();
    return this.sheets.find((s) => s.name.toLowerCase() === n);
  }

  renameSheet(id: number, newName: string): void {
    const s = this.sheet(id);
    const clash = this.sheetByName(newName);
    if (clash && clash.id !== id) throw new Error('Ya existe una hoja con ese nombre');
    const old = s.name;
    s.name = newName;
    for (const sh of this.sheets) {
      for (const c of sh.cells.values()) {
        if (!c.formula) continue;
        const ast = renameSheetRefs(c.formula.ast, old, newName);
        c.formula = { ast, text: printFormula(ast) };
      }
      sh.charts = renameChartRefs(sh.charts, old, newName);
      sh.condFormats = renameCFRefs(sh.condFormats, old, newName);
      const renameText = (t: string): string => {
        try {
          return printFormula(renameSheetRefs(parseFormula(t), old, newName));
        } catch {
          return t;
        }
      };
      renameSheetInObjects(sh, old, newName, renameText);
      for (const n of sh.names.values()) n.ast = parseFormula(n.text);
      for (const p of sh.pivots) if ('sheet' in p.source && p.source.sheet.toLowerCase() === old.toLowerCase()) p.source = { ...p.source, sheet: newName };
    }
    for (const n of this.names.values()) {
      try {
        n.text = printFormula(renameSheetRefs(parseFormula(n.text), old, newName));
        n.ast = parseFormula(n.text);
      } catch {
        // keep as it was
      }
    }
    this.emit();
  }

  removeSheet(id: number): void {
    if (this.sheets.length <= 1) throw new Error('El libro necesita al menos una hoja');
    const s = this.sheet(id);
    for (const k of [...s.cells.keys()]) this.unregister(gkey(id, keyRow(k), keyCol(k)));
    this.sheets = this.sheets.filter((x) => x.id !== id);
    this.byId.delete(id);
    // Formulas that pointed at the removed sheet now evaluate to #REF!.
    const affected: number[] = [];
    for (const sh of this.sheets) {
      for (const [k, c] of sh.cells) {
        if (c.formula && this.refsSheet(c.formula.ast, s.name)) affected.push(gkey(sh.id, keyRow(k), keyCol(k)));
      }
    }
    if (this.threeDCells.size) this.rebuildDependencies();
    for (const g of affected) this.dirty.add(g);
    for (const g of this.threeDCells) this.dirty.add(g);
    this.recalc();
    this.emit();
  }

  private refsSheet(ast: Node, name: string): boolean {
    let found = false;
    walk(ast, (n) => {
      if ((n.t === 'ref' || n.t === 'range') && (n.sheet?.toLowerCase() === name.toLowerCase() || n.sheetEnd?.toLowerCase() === name.toLowerCase())) found = true;
    });
    return found;
  }

  // -------------------------------------------------------------------------------- EvalHost
  sheetIdByName(name: string): number | undefined {
    return this.sheetByName(name)?.id;
  }
  sheetNameById(id: number): string | undefined {
    return this.byId.get(id)?.name;
  }
  sheetCount(): number {
    return this.sheets.length;
  }
  sheetIdsBetween(first: string, last: string): number[] | undefined {
    const a = this.sheets.findIndex((s) => s.name.toLowerCase() === first.toLowerCase());
    const b = this.sheets.findIndex((s) => s.name.toLowerCase() === last.toLowerCase());
    if (a < 0 || b < 0) return undefined;
    return this.sheets.slice(Math.min(a, b), Math.max(a, b) + 1).map((s) => s.id);
  }

  /** Formulas with a 3D reference depend on which sheets sit between its ends: call after adding, removing or moving sheets. */
  sheetOrderChanged(): void {
    for (const g of this.threeDCells) this.dirty.add(g);
    this.rebuildDependencies();
    for (const g of this.threeDCells) this.dirty.add(g);
    this.recalc();
    this.emit();
  }
  rowHidden(sheetId: number, row: number, filteredOnly = false): boolean {
    const s = this.byId.get(sheetId);
    if (!s) return false;
    return filteredOnly ? s.filterHidden.has(row) : s.hiddenRows.has(row) || s.filterHidden.has(row);
  }
  cellValue(sheetId: number, row: number, col: number): Scalar {
    const s = this.byId.get(sheetId);
    return s?.cells.get(cellKey(row, col))?.value ?? null;
  }
  cellsOf(sheetId: number): ReadonlyMap<number, { value: Scalar }> | undefined {
    return this.byId.get(sheetId)?.cells;
  }
  clip(r: RangeVal): RangeVal {
    const s = this.byId.get(r.sheetId);
    if (!s) return r;
    const r2 = Math.min(r.r2, Math.max(s.maxRow, r.r1));
    const c2 = Math.min(r.c2, Math.max(s.maxCol, r.c1));
    return { ...r, r2: Math.max(r2, r.r1), c2: Math.max(c2, r.c1) };
  }
  forEachCell(r: RangeVal, cb: (row: number, col: number, v: Scalar) => void): void {
    const s = this.byId.get(r.sheetId);
    if (!s) return;
    const area = (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1);
    if (area <= s.cells.size) {
      for (let row = r.r1; row <= r.r2; row++) {
        for (let col = r.c1; col <= r.c2; col++) {
          const c = s.cells.get(cellKey(row, col));
          if (c && c.value !== null) cb(row, col, c.value);
        }
      }
    } else {
      for (const [k, c] of s.cells) {
        if (c.value === null) continue;
        const row = keyRow(k);
        const col = keyCol(k);
        if (row >= r.r1 && row <= r.r2 && col >= r.c1 && col <= r.c2) cb(row, col, c.value);
      }
    }
  }
  definedName(name: string, sheetId?: number): Node | undefined {
    const key = name.toLowerCase();
    return (sheetId !== undefined ? this.byId.get(sheetId)?.names.get(key)?.ast : undefined) ?? this.names.get(key)?.ast;
  }

  tableRef(n: Extract<Node, { t: 'tref' }>, sheetId: number, row: number, col: number): RangeVal | CalcError {
    const found = n.table !== undefined ? this.tableByName(n.table) : this.tableContaining(sheetId, row, col);
    if (!found) return E.REF;
    return resolveTref(found.sheet.id, found.table, n, row);
  }

  /** The table with this name (names are unique in a workbook), with the sheet that holds it. */
  tableByName(name: string): { sheet: Sheet; table: TableDef } | undefined {
    const key = name.toLowerCase();
    for (const sheet of this.sheets) {
      const table = sheet.tables.find((t) => t.name.toLowerCase() === key);
      if (table) return { sheet, table };
    }
    return undefined;
  }

  tableContaining(sheetId: number, row: number, col: number): { sheet: Sheet; table: TableDef } | undefined {
    const sheet = this.byId.get(sheetId);
    const table = sheet?.tables.find((t) => {
      const r = normRect(t.ref);
      return rectContains(r, row, col);
    });
    return sheet && table ? { sheet, table } : undefined;
  }
  /** Shows a formula the way the user writes it (set by the application to translate function names). */
  formulaDisplay: (canonical: string) => string = (t) => t;
  formulaText(sheetId: number, row: number, col: number): string | undefined {
    const f = this.byId.get(sheetId)?.cells.get(cellKey(row, col))?.formula;
    return f ? `=${this.formulaDisplay(f.text)}` : undefined;
  }
  now(): Date {
    return this.nowFn();
  }
  random(): number {
    return this.randomFn();
  }
  /** Test hooks. */
  setClock(now: () => Date, random: () => number): void {
    this.nowFn = now;
    this.randomFn = random;
  }

  // -------------------------------------------------------------------------------- change notification
  subscribe = (l: ChangeListener): (() => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getVersion = (): number => this.version;
  private emit(): void {
    if (this.suspended) return;
    this.version++;
    this.listeners.forEach((l) => l());
  }

  // -------------------------------------------------------------------------------- reading
  getCell(sheetId: number, row: number, col: number): CellData | undefined {
    return this.sheet(sheetId).cells.get(cellKey(row, col));
  }

  getValue(sheetId: number, row: number, col: number): Scalar {
    return this.getCell(sheetId, row, col)?.value ?? null;
  }

  getStyle(sheetId: number, row: number, col: number): Style {
    return this.styles.get(this.getCell(sheetId, row, col)?.style ?? 0);
  }

  /** The text a user would see in the formula bar for this cell. */
  getInputText(sheetId: number, row: number, col: number): string {
    const c = this.getCell(sheetId, row, col);
    if (!c) return '';
    if (c.formula) return `=${c.formula.text}`;
    const v = c.value;
    if (v === null) return '';
    if (typeof v === 'string') return /^[=']/.test(v) || parseInput(v).kind !== 'text' ? `'${v}` : v;
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return typeof v === 'number' ? String(v) : v.code;
  }

  // -------------------------------------------------------------------------------- transactions
  /** Group mutations into one undoable patch and recalculate once at the end. */
  transact(fn: () => void): Patch {
    const outer = this.recording;
    const patch: Patch = outer ?? [];
    if (!outer) this.recording = patch;
    this.suspended++;
    try {
      fn();
      if (!outer && !this.replaying && this.hasTables()) this.syncTables();
    } finally {
      this.suspended--;
      if (!outer) this.recording = null;
    }
    if (!outer) {
      this.recalc();
      this.emit();
    }
    return patch;
  }

  /** Apply a patch (or its inverse) as produced by `transact`. Returns the inverse patch. */
  applyPatch(patch: Patch, reverse = false): Patch {
    const ops = reverse ? [...patch].reverse() : patch;
    this.replaying = true;
    try {
      return this.transact(() => {
        for (const op of ops) {
          if (op.k === 'cell') {
            this.writeCell(op.sheetId, op.key, reverse ? op.before : op.after);
          } else if (op.k === 'struct') {
            this.restoreSnapshot(reverse ? op.before : op.after, reverse ? op.after : op.before);
          } else {
            this.applyMeta(op.sheetId, reverse ? op.before : op.after, reverse ? op.after : op.before);
          }
        }
      });
    } finally {
      this.replaying = false;
    }
  }

  private record(op: Op): void {
    this.recording?.push(op);
  }

  /** Low-level cell write used by every mutation. `snap === null` deletes the cell. */
  private writeCell(sheetId: number, key: number, snap: CellSnap | null, recordOp = true): void {
    const sheet = this.sheet(sheetId);
    const old = sheet.cells.get(key);
    const g = sheetId * SHEET_STRIDE + key;
    const row = keyRow(key);
    const col = keyCol(key);
    if (recordOp && this.recording) {
      this.record({ k: 'cell', sheetId, key, before: snapOf(old), after: snap });
    }
    this.unregister(g);
    this.clearSpillOf(sheet, key, old);
    sheet.blocked.delete(key);
    if (old?.spillOf !== undefined) this.dirty.add(sheet.id * SHEET_STRIDE + old.spillOf);
    for (const [anchor, ext] of sheet.blocked) {
      const ar = keyRow(anchor);
      const ac = keyCol(anchor);
      if (row >= ar && row < ar + ext.rows && col >= ac && col < ac + ext.cols) this.dirty.add(sheet.id * SHEET_STRIDE + anchor);
    }

    if (!snap) {
      sheet.cells.delete(key);
    } else {
      const cell: CellData = { value: snap.value, style: snap.style };
      if (snap.formula !== undefined) {
        const ast = parseFormula(snap.formula);
        cell.formula = { text: snap.formula, ast };
        cell.value = null;
      }
      sheet.cells.set(key, cell);
      if (row > sheet.maxRow) sheet.maxRow = row;
      if (col > sheet.maxCol) sheet.maxCol = col;
      if (cell.formula) {
        this.register(g, sheetId, cell.formula.ast);
        this.dirty.add(g);
      }
    }
    this.markDependentsDirty(g);
  }

  // -------------------------------------------------------------------------------- mutations
  /** Enter text as a user would (numbers, dates, booleans, formulas). Throws FormulaSyntaxError on a bad formula. */
  setInput(sheetId: number, row: number, col: number, text: string): Patch {
    return this.transact(() => this.setInputInner(sheetId, row, col, text));
  }

  private setInputInner(sheetId: number, row: number, col: number, text: string): void {
    const key = cellKey(row, col);
    const old = this.sheet(sheetId).cells.get(key);
    const style = old?.style ?? 0;
    if (text === '') {
      this.writeOrDelete(sheetId, key, null, style);
      return;
    }
    if (text.startsWith('=') && text.length > 1) {
      parseFormula(text.slice(1)); // validate first so a bad formula leaves the cell untouched
      this.writeCell(sheetId, key, { value: null, formula: text.slice(1), style });
      return;
    }
    const parsed = parseInput(text);
    let st = style;
    if (parsed.numFmt && !this.styles.get(style).numFmt) st = this.styles.derive(style, { numFmt: parsed.numFmt });
    this.writeCell(sheetId, key, { value: parsed.value, style: st });
  }

  private writeOrDelete(sheetId: number, key: number, value: Scalar, style: number): void {
    if (style === 0 && value === null) this.writeCell(sheetId, key, null);
    else this.writeCell(sheetId, key, { value, style });
  }

  /** Write (or delete, with null) a complete cell: value or formula plus style. */
  setCell(sheetId: number, row: number, col: number, snap: CellSnap | null): Patch {
    return this.transact(() => {
      const key = cellKey(row, col);
      if (snap === null || (snap.formula === undefined && snap.value === null && snap.style === 0)) this.writeCell(sheetId, key, null);
      else this.writeCell(sheetId, key, snap);
    });
  }

  setValue(sheetId: number, row: number, col: number, value: Scalar): Patch {
    return this.transact(() => {
      const old = this.getCell(sheetId, row, col);
      this.writeOrDelete(sheetId, cellKey(row, col), value, old?.style ?? 0);
    });
  }

  /** Clear contents (and optionally formats) of a rectangle. */
  clear(sheetId: number, rect: Rect, what: 'contents' | 'formats' | 'all' = 'contents'): Patch {
    const r = normRect(rect);
    return this.transact(() => {
      const sheet = this.sheet(sheetId);
      const keys: number[] = [];
      const area = (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1);
      if (area <= sheet.cells.size) {
        for (let row = r.r1; row <= r.r2; row++) for (let col = r.c1; col <= r.c2; col++) if (sheet.cells.has(cellKey(row, col))) keys.push(cellKey(row, col));
      } else {
        for (const k of sheet.cells.keys()) if (rectContains(r, keyRow(k), keyCol(k))) keys.push(k);
      }
      for (const k of keys) {
        const c = sheet.cells.get(k)!;
        if (c.spillOf !== undefined) continue;
        if (what === 'all') this.writeCell(sheetId, k, null);
        else if (what === 'contents') this.writeOrDelete(sheetId, k, null, c.style);
        else this.writeCell(sheetId, k, c.formula ? { value: null, formula: c.formula.text, style: 0 } : { value: c.value, style: 0 });
      }
    });
  }

  /** Apply a style patch to every cell of a rectangle (creating empty styled cells as needed). */
  formatRange(sheetId: number, rect: Rect, patch: Partial<Record<keyof Style, unknown>>): Patch {
    const r = normRect(rect);
    return this.transact(() => {
      const sheet = this.sheet(sheetId);
      const rows = Math.min(r.r2, r.r1 + 20_000) - r.r1 + 1;
      const cols = r.c2 - r.c1 + 1;
      if (rows * cols > 2_000_000) throw new Error('Rango demasiado grande para aplicar formato');
      for (let row = r.r1; row < r.r1 + rows; row++) {
        for (let col = r.c1; col <= r.c2; col++) {
          const key = cellKey(row, col);
          const c = sheet.cells.get(key);
          const style = this.styles.derive(c?.style ?? 0, patch);
          if (c && c.style === style) continue;
          if (c?.formula) this.writeCell(sheetId, key, { value: null, formula: c.formula.text, style });
          else this.writeOrDelete(sheetId, key, c?.value ?? null, style);
        }
      }
    });
  }

  // -------------------------------------------------------------------------------- layout metadata
  private metaOf(sheet: Sheet): SheetMeta {
    return {
      colWidths: [...sheet.colWidths],
      rowHeights: [...sheet.rowHeights],
      hiddenCols: [...sheet.hiddenCols],
      hiddenRows: [...sheet.hiddenRows],
      filterHidden: [...sheet.filterHidden],
      autoFilter: structuredClone(sheet.autoFilter),
      condFormats: structuredClone(sheet.condFormats),
      merges: sheet.merges.map((m) => ({ ...m })),
      freeze: { ...sheet.freeze },
      charts: structuredClone(sheet.charts),
      name: sheet.name,
      objects: captureObjects(sheet),
    };
  }
  private applyMeta(sheetId: number, meta: SheetMeta, before: SheetMeta): void {
    const s = this.sheet(sheetId);
    s.colWidths = new Map(meta.colWidths);
    s.rowHeights = new Map(meta.rowHeights);
    s.hiddenCols = new Set(meta.hiddenCols);
    s.hiddenRows = new Set(meta.hiddenRows);
    s.filterHidden = new Set(meta.filterHidden);
    s.autoFilter = structuredClone(meta.autoFilter);
    s.condFormats = structuredClone(meta.condFormats);
    s.merges = meta.merges.map((m) => ({ ...m }));
    s.freeze = { ...meta.freeze };
    s.charts = structuredClone(meta.charts);
    applyObjects(s, meta.objects);
    // only tables and names change what a formula means
    const meaning = (o: ObjectsSnap) => JSON.stringify([o.tables, o.names]);
    if (meaning(meta.objects) !== meaning(before.objects)) this.objectsChanged();
    if (meta.name !== before.name) this.renameSheet(sheetId, meta.name);
  }

  /** Mutate sheet layout (widths, heights, merges, freeze…) as one undoable step. */
  editLayout(sheetId: number, fn: (s: Sheet) => void): Patch {
    return this.transact(() => {
      const s = this.sheet(sheetId);
      const before = this.metaOf(s);
      fn(s);
      this.record({ k: 'meta', sheetId, before, after: this.metaOf(s) });
      for (const g of this.subtotalCells) this.dirty.add(g);
    });
  }

  /** Recompute which rows the autofilter hides (as one undoable step). Call after changing criteria or data. */
  reapplyFilter(sheetId: number): Patch {
    return this.editLayout(sheetId, (s) => applyAutoFilter(this, s));
  }

  /**
   * Mutate the objects of a sheet (validation rules, links, comments, pictures, tables, sparklines, pivots, slicers,
   * local names, print settings) as one undoable step. Formulas are re-read because tables and names change what they mean.
   */
  editObjects(sheetId: number, fn: (s: Sheet) => void, refreshFormulas = false): Patch {
    return this.transact(() => {
      const s = this.sheet(sheetId);
      const before = this.metaOf(s);
      fn(s);
      this.record({ k: 'meta', sheetId, before, after: this.metaOf(s) });
      if (refreshFormulas) this.objectsChanged();
    });
  }

  /** Names and tables decide what formulas refer to: rebuild the dependency graph and recalculate. */
  objectsChanged(): void {
    this.rebuildDependencies();
    for (const s of this.sheets) for (const [k, c] of s.cells) if (c.formula) this.dirty.add(s.id * SHEET_STRIDE + k);
    this.recalc();
  }

  /** Mutate the charts of a sheet as one undoable step. */
  editCharts(sheetId: number, fn: (charts: ChartDef[]) => void): Patch {
    return this.transact(() => {
      const s = this.sheet(sheetId);
      const before = this.metaOf(s);
      fn(s.charts);
      this.record({ k: 'meta', sheetId, before, after: this.metaOf(s) });
    });
  }

  colWidth(sheetId: number, col: number): number {
    const s = this.sheet(sheetId);
    return s.hiddenCols.has(col) ? 0 : (s.colWidths.get(col) ?? DEFAULT_COL_WIDTH);
  }
  rowHeight(sheetId: number, row: number): number {
    const s = this.sheet(sheetId);
    return s.hiddenRows.has(row) || s.filterHidden.has(row) ? 0 : (s.rowHeights.get(row) ?? DEFAULT_ROW_HEIGHT);
  }

  // -------------------------------------------------------------------------------- rows / columns
  private snapshotAll(): SheetsSnapshot {
    return {
      sheets: this.sheets.map((s) => ({
        id: s.id,
        name: s.name,
        cells: new Map([...s.cells].map(([k, c]) => [k, { ...c }])),
        meta: this.metaOf(s),
        maxRow: s.maxRow,
        maxCol: s.maxCol,
        spills: new Map(s.spills),
      })),
    };
  }

  private restoreSnapshot(snap: SheetsSnapshot, _other: SheetsSnapshot): void {
    void _other;
    // wipe dependency graph and rebuild from the snapshot
    this.cellDependents.clear();
    this.rangeIndex.clear();
    this.wideRanges.clear();
    this.precedents.clear();
    this.volatileCells.clear();
    for (const ss of snap.sheets) {
      const sheet = this.sheet(ss.id);
      sheet.cells = new Map([...ss.cells].map(([k, c]) => [k, { ...c }]));
      sheet.maxRow = ss.maxRow;
      sheet.maxCol = ss.maxCol;
      sheet.spills = new Map(ss.spills);
      sheet.name = ss.name;
      sheet.colWidths = new Map(ss.meta.colWidths);
      sheet.rowHeights = new Map(ss.meta.rowHeights);
      sheet.hiddenCols = new Set(ss.meta.hiddenCols);
      sheet.hiddenRows = new Set(ss.meta.hiddenRows);
      sheet.filterHidden = new Set(ss.meta.filterHidden);
      sheet.autoFilter = structuredClone(ss.meta.autoFilter);
      sheet.condFormats = structuredClone(ss.meta.condFormats);
      sheet.merges = ss.meta.merges.map((m) => ({ ...m }));
      sheet.freeze = { ...ss.meta.freeze };
      sheet.charts = structuredClone(ss.meta.charts);
      applyObjects(sheet, ss.meta.objects);
    }
    this.rebuildGraph();
  }

  private rebuildGraph(): void {
    for (const s of this.sheets) {
      for (const [k, c] of s.cells) {
        if (!c.formula) continue;
        const g = s.id * SHEET_STRIDE + k;
        this.register(g, s.id, c.formula.ast);
        this.dirty.add(g);
      }
    }
  }

  /** Insert (count > 0) or delete (count < 0) rows/columns in a sheet, rewriting references everywhere. */
  shiftStructure(sheetId: number, axis: 'row' | 'col', index: number, count: number): Patch {
    if (count === 0) return [];
    const before = this.snapshotAll();
    return this.transact(() => {
      const sheet = this.sheet(sheetId);
      const limit = axis === 'row' ? MAX_ROWS : MAX_COLS;
      const n = Math.abs(count);
      const moved = new Map<number, CellData>();
      for (const [k, c] of sheet.cells) {
        if (c.spillOf !== undefined) continue; // spill children are regenerated by their anchors
        const row = keyRow(k);
        const col = keyCol(k);
        const v = axis === 'row' ? row : col;
        let nv: number | null;
        if (count > 0) nv = v >= index ? v + n : v;
        else nv = v < index ? v : v >= index + n ? v - n : null;
        if (nv === null || nv >= limit) continue;
        moved.set(axis === 'row' ? cellKey(nv, col) : cellKey(row, nv), c);
      }
      // rewrite formulas on every sheet
      const ch: StructureChange = { sheet: sheet.name, axis, index, count };
      for (const sh of this.sheets) {
        const target = sh.id === sheetId ? moved.values() : sh.cells.values();
        for (const c of target) {
          if (!c.formula) continue;
          const ast = adjustForStructure(c.formula.ast, sh.name, ch);
          c.formula = { ast, text: printFormula(ast) };
        }
      }
      for (const sh of this.sheets) {
        sh.charts = adjustChartRefs(sh.charts, sh.name, ch);
        sh.condFormats = adjustCFRules(sh.condFormats, sh.name, sh.name, ch);
        adjustSheetObjects(sh, sh.name, ch);
        if (sh.id === sheetId) this.adjustTables(sh, ch);
        else for (const n of sh.names.values()) n.ast = parseFormula(n.text);
      }
      for (const n of this.sheet(sheetId).names.values()) n.ast = parseFormula(n.text);
      for (const n of this.names.values()) {
        try {
          n.text = printFormula(adjustForStructure(parseFormula(n.text), '', ch));
          n.ast = parseFormula(n.text);
        } catch {
          // keep as it was
        }
      }
      if (sheet.autoFilter) {
        const moved = shiftRect(sheet.autoFilter.range, { axis, index, count });
        if (!moved) sheet.autoFilter = undefined;
        else {
          const cols: Record<number, (typeof sheet.autoFilter.columns)[number]> = {};
          for (const [c, f] of Object.entries(sheet.autoFilter.columns)) {
            const shifted = axis === 'col' ? shiftRect({ r1: 0, r2: 0, c1: Number(c), c2: Number(c) }, { axis, index, count }) : { c1: Number(c), c2: Number(c), r1: 0, r2: 0 };
            if (shifted) cols[shifted.c1] = f;
          }
          sheet.autoFilter = { range: moved, columns: cols };
        }
      }
      sheet.cells = moved;
      sheet.spills.clear();
      sheet.filterHidden = new Set();
      sheet.blocked.clear();
      sheet.maxRow = -1;
      sheet.maxCol = -1;
      for (const k of moved.keys()) {
        sheet.maxRow = Math.max(sheet.maxRow, keyRow(k));
        sheet.maxCol = Math.max(sheet.maxCol, keyCol(k));
      }
      this.shiftLayout(sheet, axis, index, count);
      this.cellDependents.clear();
      this.rangeIndex.clear();
      this.wideRanges.clear();
      this.precedents.clear();
      this.volatileCells.clear();
      this.rebuildGraph();
      applyAutoFilter(this, sheet);
      this.record({ k: 'struct', before, after: this.snapshotAll() });
    });
  }

  private shiftLayout(sheet: Sheet, axis: 'row' | 'col', index: number, count: number): void {
    const n = Math.abs(count);
    const remap = (v: number): number | null => (count > 0 ? (v >= index ? v + n : v) : v < index ? v : v >= index + n ? v - n : null);
    const shiftMap = (m: Map<number, number>) => {
      const out = new Map<number, number>();
      for (const [k, v] of m) {
        const nk = remap(k);
        if (nk !== null) out.set(nk, v);
      }
      return out;
    };
    const shiftSet = (s: Set<number>) => new Set([...s].map(remap).filter((x): x is number => x !== null));
    if (axis === 'row') {
      sheet.rowHeights = shiftMap(sheet.rowHeights);
      sheet.hiddenRows = shiftSet(sheet.hiddenRows);
    } else {
      sheet.colWidths = shiftMap(sheet.colWidths);
      sheet.hiddenCols = shiftSet(sheet.hiddenCols);
    }
    sheet.merges = sheet.merges
      .map((m) => {
        const lo = axis === 'row' ? m.r1 : m.c1;
        const hi = axis === 'row' ? m.r2 : m.c2;
        const nlo = remap(lo);
        const nhi = remap(hi);
        if (count > 0) return axis === 'row' ? { ...m, r1: nlo!, r2: nhi! } : { ...m, c1: nlo!, c2: nhi! };
        const dl = index;
        const dh = index + n - 1;
        if (lo >= dl && hi <= dh) return null;
        const a = lo > dh ? lo - n : lo >= dl ? dl : lo;
        const b = hi > dh ? hi - n : hi >= dl ? dl - 1 : hi;
        return axis === 'row' ? { ...m, r1: a, r2: b } : { ...m, c1: a, c2: b };
      })
      .filter((m): m is Rect => m !== null && !(m.r1 === m.r2 && m.c1 === m.c2));
  }

  // -------------------------------------------------------------------------------- defined names
  /** Define a name for the whole workbook, or (with `sheetId`) only for one sheet. */
  defineName(name: string, formulaText: string, sheetId?: number): void {
    const text = formulaText.startsWith('=') ? formulaText.slice(1) : formulaText;
    const def = { name, text, ast: parseFormula(text) };
    if (sheetId === undefined) this.names.set(name.toLowerCase(), def);
    else this.sheet(sheetId).names.set(name.toLowerCase(), def);
    this.rebuildDependencies();
    this.recalcAll();
  }

  removeName(name: string, sheetId?: number): void {
    if (sheetId === undefined) this.names.delete(name.toLowerCase());
    else this.sheet(sheetId).names.delete(name.toLowerCase());
    this.rebuildDependencies();
    this.recalcAll();
  }

  /** Visible names for a sheet: its own first, then the workbook's that it does not hide. */
  namesFor(sheetId: number): { name: string; text: string; scope: 'sheet' | 'workbook' }[] {
    const own = [...this.sheet(sheetId).names.values()].map((n) => ({ name: n.name, text: n.text, scope: 'sheet' as const }));
    const hidden = new Set(own.map((n) => n.name.toLowerCase()));
    const global = [...this.names.values()].filter((n) => !hidden.has(n.name.toLowerCase())).map((n) => ({ name: n.name, text: n.text, scope: 'workbook' as const }));
    return [...own, ...global];
  }

  // -------------------------------------------------------------------------------- dependency graph
  private resolveSheetId(name: string | undefined, fallback: number): number | undefined {
    return name === undefined ? fallback : this.sheetByName(name)?.id;
  }

  private collectPrecedents(owner: number, ownerSheet: number, ast: Node): Precedents {
    const p: Precedents = { cells: [], ranges: [] };
    const visit = (n: Node, depth: number) => {
      walk(n, (x) => {
        if (x.t === 'ref' || x.t === 'range') {
          let ids: (number | undefined)[];
          if (x.sheetEnd !== undefined && x.sheet !== undefined) {
            this.threeDCells.add(owner);
            ids = this.sheetIdsBetween(x.sheet, x.sheetEnd) ?? [];
          } else ids = [this.resolveSheetId(x.sheet, ownerSheet)];
          for (const sid of ids) {
            if (sid === undefined) continue;
            if (x.t === 'ref') p.cells.push(gkey(sid, x.a.row, x.a.col));
            else p.ranges.push({ sheetId: sid, owner, rect: normRect({ r1: x.a.row, c1: x.a.col, r2: x.b.row, c2: x.b.col }) });
          }
        } else if (x.t === 'tref') {
          const found = x.table !== undefined ? this.tableByName(x.table) : this.tableContaining(ownerSheet, keyRow(gLocal(owner)), keyCol(gLocal(owner)));
          const r = found ? resolveTref(found.sheet.id, found.table, x, keyRow(gLocal(owner))) : null;
          if (r && isRange(r)) p.ranges.push({ sheetId: r.sheetId, owner, rect: { r1: r.r1, c1: r.c1, r2: r.r2, c2: r.c2 } });
        } else if (x.t === 'name' && depth < 5) {
          const def = this.sheetNameDef(ownerSheet, x.name);
          if (def) visit(def.ast, depth + 1);
          else {
            const found = this.tableByName(x.name);
            const r = found ? resolveTref(found.sheet.id, found.table, { area: 'data' }, 0) : null;
            if (r && isRange(r)) p.ranges.push({ sheetId: r.sheetId, owner, rect: { r1: r.r1, c1: r.c1, r2: r.r2, c2: r.c2 } });
          }
        } else if (x.t === 'call') {
          if (registry.get(x.name)?.volatile) this.volatileCells.add(owner);
          if (x.name === 'SUBTOTAL' || x.name === 'AGGREGATE') this.subtotalCells.add(owner);
          // a defined name used as a function (a LAMBDA): what its body reads is a precedent too
          if (!registry.has(x.name) && depth < 5) {
            const def = this.sheetNameDef(ownerSheet, x.name);
            if (def) visit(def.ast, depth + 1);
          }
        }
      });
    };
    visit(ast, 0);
    return p;
  }

  private sheetNameDef(sheetId: number, name: string): { ast: Node } | undefined {
    const key = name.toLowerCase();
    return this.byId.get(sheetId)?.names.get(key) ?? this.names.get(key);
  }

  private register(g: number, sheetId: number, ast: Node): void {
    const p = this.collectPrecedents(g, sheetId, ast);
    this.precedents.set(g, p);
    for (const c of p.cells) {
      let set = this.cellDependents.get(c);
      if (!set) this.cellDependents.set(c, (set = new Set()));
      set.add(g);
    }
    for (const rd of p.ranges) {
      if (rd.rect.c2 - rd.rect.c1 > 32) {
        let set = this.wideRanges.get(rd.sheetId);
        if (!set) this.wideRanges.set(rd.sheetId, (set = new Set()));
        set.add(rd);
      } else {
        let cols = this.rangeIndex.get(rd.sheetId);
        if (!cols) this.rangeIndex.set(rd.sheetId, (cols = new Map()));
        for (let c = rd.rect.c1; c <= rd.rect.c2; c++) {
          let set = cols.get(c);
          if (!set) cols.set(c, (set = new Set()));
          set.add(rd);
        }
      }
    }
  }

  private unregister(g: number): void {
    const p = this.precedents.get(g);
    this.volatileCells.delete(g);
    this.subtotalCells.delete(g);
    this.threeDCells.delete(g);
    this.dirty.delete(g);
    if (!p) return;
    this.precedents.delete(g);
    for (const c of p.cells) {
      const set = this.cellDependents.get(c);
      set?.delete(g);
      if (set && set.size === 0) this.cellDependents.delete(c);
    }
    for (const rd of p.ranges) {
      this.wideRanges.get(rd.sheetId)?.delete(rd);
      const cols = this.rangeIndex.get(rd.sheetId);
      if (cols) for (let c = rd.rect.c1; c <= rd.rect.c2; c++) cols.get(c)?.delete(rd);
    }
  }

  /** Formula cells that read the given cell. */
  private dependentsOf(g: number, out: Set<number>): void {
    const direct = this.cellDependents.get(g);
    if (direct) for (const d of direct) out.add(d);
    const sid = gSheet(g);
    const local = gLocal(g);
    const row = keyRow(local);
    const col = keyCol(local);
    const cand = this.rangeIndex.get(sid)?.get(col);
    if (cand) for (const rd of cand) if (row >= rd.rect.r1 && row <= rd.rect.r2) out.add(rd.owner);
    const wide = this.wideRanges.get(sid);
    if (wide) for (const rd of wide) if (rectContains(rd.rect, row, col)) out.add(rd.owner);
  }

  private markDependentsDirty(g: number): void {
    const s = new Set<number>();
    this.dependentsOf(g, s);
    for (const d of s) this.dirty.add(d);
  }

  // -------------------------------------------------------------------------------- recalculation
  /** Recompute every formula (used after loading and for F9). */
  recalcAll(): void {
    for (const s of this.sheets) for (const [k, c] of s.cells) if (c.formula) this.dirty.add(s.id * SHEET_STRIDE + k);
    this.recalc();
    this.emit();
  }

  /** Register all formulas without evaluating (loader path); cached values stay as loaded. */
  rebuildDependencies(): void {
    this.cellDependents.clear();
    this.rangeIndex.clear();
    this.wideRanges.clear();
    this.precedents.clear();
    this.volatileCells.clear();
    this.subtotalCells.clear();
    this.threeDCells.clear();
    for (const s of this.sheets) {
      for (const [k, c] of s.cells) {
        if (c.formula) this.register(s.id * SHEET_STRIDE + k, s.id, c.formula.ast);
      }
    }
    this.dirty.clear();
  }

  /** Put a formula cell in without recording history or evaluating (loader path). */
  loadCell(sheetId: number, row: number, col: number, cell: { value: Scalar; formula?: string; style: number }): void {
    const sheet = this.sheet(sheetId);
    const data: CellData = { value: cell.value, style: cell.style };
    if (cell.formula !== undefined) {
      try {
        data.formula = { text: cell.formula, ast: parseFormula(cell.formula) };
      } catch {
        data.value = E.NAME;
      }
    }
    sheet.cells.set(cellKey(row, col), data);
    if (row > sheet.maxRow) sheet.maxRow = row;
    if (col > sheet.maxCol) sheet.maxCol = col;
  }

  private recalc(): void {
    if (this.suspended) return;
    for (const v of this.volatileCells) this.dirty.add(v);
    let guard = 0;
    while (this.dirty.size > 0 && guard++ < 8) {
      const roots = [...this.dirty];
      this.dirty.clear();
      const changedByEval = this.evaluateClosure(roots);
      // Spill growth can touch cells other formulas read; their dependents go around again.
      for (const g of changedByEval) this.markDependentsDirty(g);
    }
  }

  private evaluateClosure(roots: number[]): number[] {
    // 1. closure of dependents
    const nodes = new Set<number>();
    const deps = new Map<number, Set<number>>();
    const stack: number[] = [];
    for (const r of roots) {
      if (this.formulaAt(r)) {
        nodes.add(r);
        stack.push(r);
      }
    }
    while (stack.length) {
      const g = stack.pop()!;
      const ds = new Set<number>();
      this.dependentsOf(g, ds);
      // dependents of this formula's spilled children also follow it
      const sheet = this.byId.get(gSheet(g));
      const sp = sheet?.spills.get(gLocal(g));
      if (sheet && sp) {
        const row = keyRow(gLocal(g));
        const col = keyCol(gLocal(g));
        for (let i = 0; i < sp.rows; i++) for (let j = 0; j < sp.cols; j++) if (i || j) this.dependentsOf(gkey(sheet.id, row + i, col + j), ds);
      }
      ds.delete(g);
      deps.set(g, ds);
      for (const d of ds) {
        if (!nodes.has(d) && this.formulaAt(d)) {
          nodes.add(d);
          stack.push(d);
        }
      }
    }
    // 2. Kahn topological order restricted to the closure
    const indeg = new Map<number, number>();
    for (const n of nodes) indeg.set(n, 0);
    for (const [from, ds] of deps) {
      for (const d of ds) if (nodes.has(d) && d !== from) indeg.set(d, (indeg.get(d) ?? 0) + 1);
    }
    const queue: number[] = [];
    for (const [n, d] of indeg) if (d === 0) queue.push(n);
    const changed: number[] = [];
    let head = 0;
    let done = 0;
    while (head < queue.length) {
      const g = queue[head++]!;
      done++;
      this.evalCell(g, changed);
      for (const d of deps.get(g) ?? []) {
        if (!nodes.has(d) || d === g) continue;
        const left = (indeg.get(d) ?? 1) - 1;
        indeg.set(d, left);
        if (left === 0) queue.push(d);
      }
    }
    // 3. anything left is on (or downstream of) a cycle
    if (done < nodes.size) {
      for (const [n, d] of indeg) {
        if (d > 0) {
          const c = this.formulaAt(n);
          if (c) c.value = E.CIRC;
        }
      }
    }
    return changed;
  }

  private formulaAt(g: number): CellData | undefined {
    const c = this.byId.get(gSheet(g))?.cells.get(gLocal(g));
    return c?.formula ? c : undefined;
  }

  private evalCell(g: number, changed: number[]): void {
    const sheetId = gSheet(g);
    const local = gLocal(g);
    const sheet = this.sheet(sheetId);
    const cell = sheet.cells.get(local);
    if (!cell?.formula) return;
    const ctx: Ctx = { host: this, sheetId, row: keyRow(local), col: keyCol(local), scope: null, volatile: false };
    let v: Value;
    try {
      v = evaluate(cell.formula.ast, ctx);
    } catch {
      v = E.VALUE;
    }
    if (ctx.volatile) this.volatileCells.add(g);
    if (isRefs(v)) v = E.VALUE;
    else if (isLambda(v)) v = E.CALC;
    if (isRange(v)) {
      v = v.r1 === v.r2 && v.c1 === v.c2 ? this.cellValue(v.sheetId, v.r1, v.c1) : arr(this.materialise(v));
    }
    if (isArray(v)) {
      if (v.rows.length === 1 && v.rows[0]!.length === 1) {
        this.clearSpillOf(sheet, local, cell);
        cell.value = v.rows[0]![0]! ?? 0;
      } else {
        cell.value = this.placeSpill(sheet, local, cell, v.rows.map((r) => r.map((x) => x ?? 0)), changed);
      }
    } else {
      this.clearSpillOf(sheet, local, cell);
      cell.value = v ?? 0; // a reference to an empty cell evaluates to 0
    }
  }

  private materialise(r: RangeVal): Scalar[][] {
    const c = this.clip(r);
    const rows: Scalar[][] = [];
    for (let row = c.r1; row <= c.r2; row++) {
      const out: Scalar[] = [];
      for (let col = c.c1; col <= c.c2; col++) out.push(this.cellValue(c.sheetId, row, col));
      rows.push(out);
    }
    return rows;
  }

  private clearSpillOf(sheet: Sheet, anchor: number, cell: CellData | undefined): void {
    const ext = sheet.spills.get(anchor);
    if (!ext) return;
    sheet.spills.delete(anchor);
    const row = keyRow(anchor);
    const col = keyCol(anchor);
    for (let i = 0; i < ext.rows; i++) {
      for (let j = 0; j < ext.cols; j++) {
        if (!i && !j) continue;
        const k = cellKey(row + i, col + j);
        const c = sheet.cells.get(k);
        if (c?.spillOf === anchor) {
          sheet.cells.delete(k);
          this.markDependentsDirty(sheet.id * SHEET_STRIDE + k);
        }
      }
    }
    void cell;
  }

  private placeSpill(sheet: Sheet, anchor: number, cell: CellData, rows: Scalar[][], changed: number[]): Scalar {
    const h = rows.length;
    const w = rows[0]!.length;
    const row = keyRow(anchor);
    const col = keyCol(anchor);
    const old = sheet.spills.get(anchor);
    sheet.blocked.delete(anchor);
    if (row + h > MAX_ROWS || col + w > MAX_COLS) {
      this.clearSpillOf(sheet, anchor, cell);
      return E.SPILL;
    }
    // blocked if any target cell (other than the anchor and our own previous spill) is occupied
    for (let i = 0; i < h; i++) {
      for (let j = 0; j < w; j++) {
        if (!i && !j) continue;
        const c = sheet.cells.get(cellKey(row + i, col + j));
        if (c && c.spillOf !== anchor && (c.formula || c.value !== null)) {
          this.clearSpillOf(sheet, anchor, cell);
          sheet.blocked.set(anchor, { rows: h, cols: w });
          return E.SPILL;
        }
      }
    }
    // remove cells of the previous extent that are no longer covered
    if (old) {
      for (let i = 0; i < old.rows; i++) {
        for (let j = 0; j < old.cols; j++) {
          if ((!i && !j) || (i < h && j < w)) continue;
          const k = cellKey(row + i, col + j);
          if (sheet.cells.get(k)?.spillOf === anchor) {
            sheet.cells.delete(k);
            changed.push(sheet.id * SHEET_STRIDE + k);
          }
        }
      }
    }
    for (let i = 0; i < h; i++) {
      for (let j = 0; j < w; j++) {
        if (!i && !j) continue;
        const k = cellKey(row + i, col + j);
        const existing = sheet.cells.get(k);
        const val = rows[i]![j]!;
        if (existing) {
          if (existing.value !== val) changed.push(sheet.id * SHEET_STRIDE + k);
          existing.value = val;
          existing.spillOf = anchor;
        } else {
          sheet.cells.set(k, { value: val, style: 0, spillOf: anchor });
          changed.push(sheet.id * SHEET_STRIDE + k);
        }
      }
    }
    sheet.maxRow = Math.max(sheet.maxRow, row + h - 1);
    sheet.maxCol = Math.max(sheet.maxCol, col + w - 1);
    sheet.spills.set(anchor, { rows: h, cols: w });
    return rows[0]![0]!;
  }

  // -------------------------------------------------------------------------------- tables
  /** Rows and columns inserted or deleted inside or around a table: keep its columns and range in step. */
  private adjustTables(sheet: Sheet, ch: StructureChange): void {
    sheet.tables = sheet.tables.flatMap((t) => {
      const old = normRect(t.ref);
      const ref = shiftRect(old, ch);
      if (!ref) return [];
      let columns = t.columns;
      if (ch.axis === 'col') {
        const rel = ch.index - old.c1;
        if (ch.count > 0 && rel > 0 && ch.index <= old.c2) {
          const names = columns.map((c) => c.name);
          const added = Array.from({ length: ch.count }, (_x, i) => {
            const name = uniqueColumnName('Columna', [...names]);
            names.push(name);
            void i;
            return { name };
          });
          columns = [...columns.slice(0, rel), ...added, ...columns.slice(rel)];
        } else if (ch.count < 0) {
          const lo = Math.max(ch.index, old.c1) - old.c1;
          const hi = Math.min(ch.index - ch.count - 1, old.c2) - old.c1;
          if (hi >= lo) columns = columns.filter((_c, i) => i < lo || i > hi);
        }
        if (!columns.length) return [];
      }
      const filter = t.filter && { ...t.filter, range: { ...ref, r2: t.totals ? ref.r2 - 1 : ref.r2 } };
      if (filter) {
        const cols: NonNullable<typeof t.filter>['columns'] = {};
        for (const [c, f] of Object.entries(t.filter!.columns)) {
          const moved = ch.axis === 'col' ? shiftRect({ r1: 0, r2: 0, c1: Number(c), c2: Number(c) }, ch) : { c1: Number(c), c2: Number(c), r1: 0, r2: 0 };
          if (moved) cols[moved.c1] = f;
        }
        filter.columns = cols;
      }
      return [{ ...t, ref, columns, filter }];
    });
  }

  /** Make the header cell text and the column name of every table agree (typing in a header renames the column). */
  private syncTables(): void {
    for (const sheet of this.sheets) {
      for (const t of sheet.tables) {
        if (!t.header) continue;
        const r = normRect(t.ref);
        const others = t.columns.map((c) => c.name);
        for (let i = 0; i < t.columns.length; i++) {
          const key = cellKey(r.r1, r.c1 + i);
          const cell = sheet.cells.get(key);
          const v = cell?.formula ? cell.value : (cell?.value ?? null);
          const text = v === null ? '' : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
          const old = t.columns[i]!.name;
          if (text === old) continue;
          const taken = others.filter((_n, j) => j !== i);
          const fixed = uniqueColumnName(text.trim() === '' ? old : text.trim(), taken);
          if (fixed.toLowerCase() === old.toLowerCase() && fixed !== text) {
            // only case changed or the typed text was refused: show the name in the cell
          }
          const before = this.metaOf(sheet);
          t.columns[i]!.name = fixed;
          others[i] = fixed;
          if (fixed !== text) this.writeCell(sheet.id, key, { value: fixed, style: cell?.style ?? 0 });
          this.renameTableColumnRefs(t.name, old, fixed);
          this.record({ k: 'meta', sheetId: sheet.id, before, after: this.metaOf(sheet) });
        }
      }
    }
  }

  /** Formulas that name a column of a table follow when the column is renamed. */
  private renameTableColumnRefs(table: string, oldName: string, newName: string): void {
    const same = (a?: string) => a !== undefined && a.toLowerCase() === oldName.toLowerCase();
    const fix = (n: Node, owner?: string): Node =>
      mapNode(n, (x) => {
        if (x.t !== 'tref') return undefined;
        if (x.table !== undefined ? x.table.toLowerCase() !== table.toLowerCase() : owner?.toLowerCase() !== table.toLowerCase()) return undefined;
        return { ...x, col1: same(x.col1) ? newName : x.col1, col2: same(x.col2) ? newName : x.col2 };
      });
    for (const sheet of this.sheets) {
      for (const [k, c] of sheet.cells) {
        if (!c.formula) continue;
        const owner = this.tableContaining(sheet.id, keyRow(k), keyCol(k))?.table.name;
        const ast = fix(c.formula.ast, owner);
        const text = printFormula(ast);
        if (text !== c.formula.text) this.writeCell(sheet.id, k, { value: null, formula: text, style: c.style });
      }
      for (const t of sheet.tables) for (const col of t.columns) if (col.calc) col.calc = printFormula(fix(parseFormula(col.calc), t.name));
    }
  }

  /** Turn a block of cells into a table. A header row is made when the block has none. Returns the patch. */
  createTable(sheetId: number, rect: Rect, o: { id: string; name?: string; header?: boolean; style?: string }): Patch {
    return this.transact(() => {
      const sheet = this.sheet(sheetId);
      let r = normRect(rect);
      for (const t of sheet.tables) {
        const x = normRect(t.ref);
        if (r.r1 <= x.r2 && r.r2 >= x.r1 && r.c1 <= x.c2 && r.c2 >= x.c1) throw new Error('El rango se superpone con otra tabla');
      }
      const hasHeader = o.header !== false;
      if (!hasHeader) {
        this.shiftStructure(sheetId, 'row', r.r1, 1);
        r = { ...r, r2: r.r2 + 1 };
      }
      if (r.r2 === r.r1 && hasHeader) r = { ...r, r2: r.r1 + 1 }; // a header needs at least one data row
      const before = this.metaOf(sheet);
      const names: string[] = [];
      for (let c = r.c1; c <= r.c2; c++) {
        const cell = sheet.cells.get(cellKey(r.r1, c));
        const v = cell?.value ?? null;
        const text = v === null ? '' : typeof v === 'string' ? v.trim() : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
        const name = uniqueColumnName(text || 'Columna', names);
        names.push(name);
        if (name !== v) this.writeCell(sheetId, cellKey(r.r1, c), { value: name, style: cell?.style ?? 0 });
      }
      const taken = new Set(this.sheets.flatMap((sh) => sh.tables.map((t) => t.name.toLowerCase())));
      let name = o.name;
      if (!name) {
        let i = 1;
        while (taken.has(`tabla${i}`)) i++;
        name = `Tabla${i}`;
      } else if (taken.has(name.toLowerCase())) throw new Error('Ya existe una tabla con ese nombre');
      sheet.tables.push({
        id: o.id,
        name,
        ref: r,
        header: true,
        totals: false,
        columns: names.map((n) => ({ name: n })),
        style: o.style ?? 'TableStyleMedium2',
        rowStripes: true,
        colStripes: false,
        firstCol: false,
        lastCol: false,
        filterButtons: true,
        filter: { range: { ...r }, columns: {} },
      });
      this.record({ k: 'meta', sheetId, before, after: this.metaOf(sheet) });
      this.objectsChanged();
    });
  }

  /**
   * Change the extent of a table (dragging its corner, typing under it, inserting a total row). New columns take their names
   * from the header cells; new rows receive the formulas of calculated columns.
   */
  resizeTable(sheetId: number, id: string, newRef: Rect): Patch {
    return this.transact(() => {
      const sheet = this.sheet(sheetId);
      const t = sheet.tables.find((x) => x.id === id);
      if (!t) return;
      const before = this.metaOf(sheet);
      const old = normRect(t.ref);
      const r = normRect(newRef);
      if (r.c1 !== old.c1 || r.r1 !== old.r1) throw new Error('Una tabla solo puede cambiar de tamaño por la esquina inferior derecha');
      const taken = new Set(this.sheets.flatMap((sh) => (sh.id === sheetId ? [] : sh.tables)).map((x) => x.id));
      void taken;
      // columns
      const width = r.c2 - r.c1 + 1;
      const names = t.columns.map((c) => c.name);
      while (t.columns.length < width) {
        const c = r.c1 + t.columns.length;
        const cell = sheet.cells.get(cellKey(r.r1, c));
        const raw = cell?.value;
        const wanted = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
        const name = uniqueColumnName(wanted || 'Columna', names);
        names.push(name);
        if (name !== raw) this.writeCell(sheetId, cellKey(r.r1, c), { value: name, style: cell?.style ?? 0 });
        t.columns.push({ name });
      }
      t.columns.length = width;
      // the totals row moves with the bottom edge
      if (t.totals && r.r2 !== old.r2) {
        for (let c = old.c1; c <= old.c2; c++) {
          const cell = sheet.cells.get(cellKey(old.r2, c));
          if (cell) this.writeCell(sheetId, cellKey(r.r2, c), { value: cell.value, formula: cell.formula?.text, style: cell.style });
          if (r.r2 > old.r2) this.writeCell(sheetId, cellKey(old.r2, c), null);
        }
      }
      t.ref = r;
      if (t.filter) t.filter = { ...t.filter, range: { ...r, r2: t.totals ? r.r2 - 1 : r.r2 } };
      // calculated columns fill the new rows
      const dataEnd = t.totals ? r.r2 - 1 : r.r2;
      const oldEnd = t.totals ? old.r2 - 1 : old.r2;
      t.columns.forEach((col, i) => {
        if (!col.calc) return;
        const first = r.r1 + (t.header ? 1 : 0);
        const ast = parseFormula(col.calc);
        for (let row = oldEnd + 1; row <= dataEnd; row++) {
          const c = r.c1 + i;
          if (sheet.cells.get(cellKey(row, c))?.value != null) continue;
          this.writeCell(sheetId, cellKey(row, c), { value: null, formula: printFormula(shiftRefs(ast, row - first, 0)), style: sheet.cells.get(cellKey(oldEnd, c))?.style ?? 0 });
        }
      });
      this.record({ k: 'meta', sheetId, before, after: this.metaOf(sheet) });
      this.objectsChanged();
    });
  }

  /** Show or hide the totals row (the function of each column is kept in the table). */
  setTableTotals(sheetId: number, id: string, on: boolean): Patch {
    return this.transact(() => {
      const sheet = this.sheet(sheetId);
      const t = sheet.tables.find((x) => x.id === id);
      if (!t || t.totals === on) return;
      const before = this.metaOf(sheet);
      const r = normRect(t.ref);
      if (on) {
        const row = r.r2 + 1;
        t.totals = true;
        t.ref = { ...r, r2: row };
        t.columns.forEach((col, i) => {
          const c = r.c1 + i;
          if (i === 0 && !col.total) col.totalLabel ??= 'Total';
          const formula = totalFormulaFor(t, i);
          if (formula) this.writeCell(sheetId, cellKey(row, c), { value: null, formula, style: 0 });
          else if (col.totalLabel) this.writeCell(sheetId, cellKey(row, c), { value: col.totalLabel, style: 0 });
        });
      } else {
        for (let c = r.c1; c <= r.c2; c++) this.writeCell(sheetId, cellKey(r.r2, c), null);
        t.totals = false;
        t.ref = { ...r, r2: r.r2 - 1 };
      }
      if (t.filter) t.filter = { ...t.filter, range: { ...normRect(t.ref), r2: t.totals ? normRect(t.ref).r2 - 1 : normRect(t.ref).r2 } };
      this.record({ k: 'meta', sheetId, before, after: this.metaOf(sheet) });
      this.objectsChanged();
    });
  }

  /** Set the function of a column in the totals row. */
  setTableColumnTotal(sheetId: number, id: string, index: number, total: NonNullable<TableDef['columns'][number]['total']>): Patch {
    return this.transact(() => {
      const sheet = this.sheet(sheetId);
      const t = sheet.tables.find((x) => x.id === id);
      const col = t?.columns[index];
      if (!t || !col) return;
      const before = this.metaOf(sheet);
      col.total = total;
      if (t.totals) {
        const r = normRect(t.ref);
        const key = cellKey(r.r2, r.c1 + index);
        const formula = totalFormulaFor(t, index);
        const style = sheet.cells.get(key)?.style ?? 0;
        if (formula) this.writeCell(sheetId, key, { value: null, formula, style });
        else if (total === 'none') this.writeCell(sheetId, key, col.totalLabel ? { value: col.totalLabel, style } : null);
      }
      this.record({ k: 'meta', sheetId, before, after: this.metaOf(sheet) });
      this.objectsChanged();
    });
  }

  /**
   * Fill a calculated column: every data cell of the column gets the formula, and new rows will too.
   * The formula is the one for the cell in `atRow` (default: the first data row); relative references move with each row.
   */
  setCalculatedColumn(sheetId: number, id: string, index: number, formula: string | undefined, atRow?: number): Patch {
    return this.transact(() => {
      const sheet = this.sheet(sheetId);
      const t = sheet.tables.find((x) => x.id === id);
      const col = t?.columns[index];
      if (!t || !col) return;
      const before = this.metaOf(sheet);
      const r = normRect(t.ref);
      const first = r.r1 + (t.header ? 1 : 0);
      // stored for the first data row
      if (formula !== undefined) formula = printFormula(shiftRefs(parseFormula(formula), first - (atRow ?? first), 0));
      col.calc = formula;
      if (formula !== undefined) {
        const end = t.totals ? r.r2 - 1 : r.r2;
        const ast = parseFormula(formula);
        for (let row = first; row <= end; row++) {
          const key = cellKey(row, r.c1 + index);
          this.writeCell(sheetId, key, { value: null, formula: printFormula(shiftRefs(ast, row - first, 0)), style: sheet.cells.get(key)?.style ?? 0 });
        }
      }
      this.record({ k: 'meta', sheetId, before, after: this.metaOf(sheet) });
      this.objectsChanged();
    });
  }

  /**
   * Stop being a table: the cells stay, and formulas that used the table now use plain references.
   * `keepFormat` leaves the colours of the table style as ordinary cell formatting.
   */
  removeTable(sheetId: number, id: string): Patch {
    return this.transact(() => {
      const sheet = this.sheet(sheetId);
      const t = sheet.tables.find((x) => x.id === id);
      if (!t) return;
      const before = this.metaOf(sheet);
      const name = t.name.toLowerCase();
      for (const sh of this.sheets) {
        for (const [k, c] of sh.cells) {
          if (!c.formula) continue;
          let touched = false;
          const ast = mapNode(c.formula.ast, (x) => {
            if (x.t !== 'tref') return undefined;
            const here = x.table !== undefined ? x.table.toLowerCase() === name : sh.id === sheetId && rectContains(normRect(t.ref), keyRow(k), keyCol(k));
            if (!here) return undefined;
            const r = resolveTref(sheetId, t, x, keyRow(k));
            if (!isRange(r)) return { t: 'err' as const, v: E.REF };
            touched = true;
            const a = { row: r.r1, col: r.c1, absRow: true, absCol: true };
            const b = { row: r.r2, col: r.c2, absRow: true, absCol: true };
            const sheetName = sh.id === sheetId ? undefined : sheet.name;
            return r.r1 === r.r2 && r.c1 === r.c2 ? { t: 'ref' as const, sheet: sheetName, a } : { t: 'range' as const, sheet: sheetName, a, b };
          });
          if (touched) this.writeCell(sh.id, k, { value: null, formula: printFormula(ast), style: c.style });
        }
      }
      sheet.tables = sheet.tables.filter((x) => x.id !== id);
      this.record({ k: 'meta', sheetId, before, after: this.metaOf(sheet) });
      this.objectsChanged();
    });
  }

  // -------------------------------------------------------------------------------- pivot tables
  /** The rows of the pivot's source, with the header names in the first position. */
  pivotData(def: PivotDef): PivotData | null {
    let sheet: Sheet | undefined;
    let r: Rect | null = null;
    if ('table' in def.source) {
      const found = this.tableByName(def.source.table);
      if (!found) return null;
      sheet = found.sheet;
      const t = found.table;
      const ref = normRect(t.ref);
      r = { ...ref, r2: t.totals ? ref.r2 - 1 : ref.r2 };
      if (!t.header) return null;
    } else {
      sheet = this.sheetByName(def.source.sheet);
      if (!sheet) return null;
      const [a, b] = def.source.ref.replace(/\$/g, '').split(':') as [string, string?];
      const p = parseFormula(`${a}:${b ?? a}`);
      if (p.t !== 'range') return null;
      r = normRect({ r1: p.a.row, c1: p.a.col, r2: p.b.row, c2: p.b.col });
    }
    const src = sheet;
    const rect = r;
    const last = Math.min(rect.r2, Math.max(src.maxRow, rect.r1));
    const cols = rect.c2 - rect.c1 + 1;
    const headers = sourceHeaders(Array.from({ length: cols }, (_x, i) => src.cells.get(cellKey(rect.r1, rect.c1 + i))?.value ?? null));
    const rows: Scalar[][] = [];
    for (let row = rect.r1 + 1; row <= last; row++) {
      const rec = Array.from({ length: cols }, (_x, i) => src.cells.get(cellKey(row, rect.c1 + i))?.value ?? null);
      if (rec.every((v) => v === null || v === '')) continue;
      rows.push(rec);
    }
    return { headers, rows };
  }

  pivotAt(sheetId: number, row: number, col: number): PivotDef | undefined {
    return this.byId.get(sheetId)?.pivots.find((p) => pivotCovers(p, row, col));
  }

  pivotById(id: string): { sheet: Sheet; pivot: PivotDef } | undefined {
    for (const sheet of this.sheets) {
      const pivot = sheet.pivots.find((p) => p.id === id);
      if (pivot) return { sheet, pivot };
    }
    return undefined;
  }

  pivotOutput(def: PivotDef, labels: PivotLabels = this.pivotLabels): PivotOutput | null {
    const data = this.pivotData(def);
    return data ? computePivot(def, data, labels) : null;
  }

  /** Evaluate a formula text (English syntax, no "=") as if it were written in A1 of a sheet. */
  evalFormula(sheetId: number, text: string): Value {
    const ctx: Ctx = { host: this, sheetId, row: 0, col: 0, scope: null, volatile: false };
    try {
      return evaluate(parseFormula(text.replace(/^=/, '')), ctx);
    } catch {
      return E.VALUE;
    }
  }

  /** Call a sheet function with values or ranges (macros: WorksheetFunction.Sum). Undefined when the function does not exist. */
  evalFunction(sheetId: number, name: string, args: ArrayLikeValue[]): Value | undefined {
    if (!registry.has(name) && name !== 'LET') return undefined;
    const scope = new Map<string, Value>();
    const nodes: Node[] = args.map((a, i) => {
      const v: Value = typeof a === 'object' && a !== null && 'rect' in a ? { kind: 'range', sheetId: a.sheetId, ...normRect(a.rect) } : (a as Value);
      scope.set(`__a${i}`, v);
      return { t: 'name', name: `__a${i}` } as Node;
    });
    const ctx: Ctx = { host: this, sheetId, row: 0, col: 0, scope, volatile: false };
    try {
      return evaluate({ t: 'call', name, args: nodes }, ctx);
    } catch {
      return E.VALUE;
    }
  }

  /** The value GETPIVOTDATA gives. */
  pivotLookup(sheetId: number, row: number, col: number, dataField: string, items: Record<string, string>): Scalar | undefined {
    const def = this.pivotAt(sheetId, row, col);
    if (!def) return undefined;
    const out = this.pivotOutput(def);
    if (!out) return undefined;
    const want = dataField.toLowerCase();
    const vi = def.values.findIndex((v, i) => v.field.toLowerCase() === want || out.captions[i]!.toLowerCase() === want);
    return vi < 0 ? undefined : out.lookup(vi, items);
  }

  /** Draw the pivot's output into the sheet (again): the old output is cleared first. Throws when it would run over other data. */
  renderPivot(sheetId: number, id: string, labels: PivotLabels = this.pivotLabels): Patch {
    return this.transact(() => {
      const sheet = this.sheet(sheetId);
      const def = sheet.pivots.find((p) => p.id === id);
      if (!def) return;
      const before = this.metaOf(sheet);
      const out = this.pivotOutput(def, labels);
      if (!out) throw new Error('No se encuentra el origen de datos de la tabla dinámica');
      const old = def.size;
      const inOld = (r: number, c: number) => !!old && r >= def.row && r < def.row + old.rows && c >= def.col && c < def.col + old.cols;
      for (let r = 0; r < out.rows; r++) {
        for (let c = 0; c < out.cols; c++) {
          const cell = sheet.cells.get(cellKey(def.row + r, def.col + c));
          if (cell && !inOld(def.row + r, def.col + c) && (cell.value !== null || cell.formula)) throw new Error('La tabla dinámica ocuparía celdas que ya tienen datos');
        }
      }
      if (def.row + out.rows > MAX_ROWS || def.col + out.cols > MAX_COLS) throw new Error('La tabla dinámica no cabe en la hoja');
      if (old) {
        for (let r = 0; r < old.rows; r++) {
          for (let c = 0; c < old.cols; c++) if (sheet.cells.has(cellKey(def.row + r, def.col + c))) this.writeCell(sheetId, cellKey(def.row + r, def.col + c), null);
        }
      }
      const look = pivotStyleLook(def.style);
      const styleFor = (cell: (typeof out.cells)[number]) => {
        const st: Style = {};
        if (cell.numFmt) st.numFmt = cell.numFmt;
        switch (cell.kind) {
          case 'filterName':
            st.bold = true;
            break;
          case 'caption':
          case 'corner':
          case 'colLabel':
            st.bold = true;
            if (look.headerBg) st.bg = look.headerBg;
            if (look.headerFg !== '#000000') st.color = look.headerFg;
            break;
          case 'subtotalLabel':
          case 'subtotalValue':
            st.bold = true;
            if (look.subtotalBg) st.bg = look.subtotalBg;
            break;
          case 'grandLabel':
          case 'grandValue':
            st.bold = true;
            if (look.grandBg) st.bg = look.grandBg;
            if (look.line) st.top = { style: 'thin', color: look.line };
            if (look.grandFg !== '#000000') st.color = look.grandFg;
            break;
          case 'rowLabel':
            if (cell.indent) {
              st.hAlign = 'left';
              st.indent = cell.indent;
            }
            break;
          default:
        }
        return this.styles.intern(st);
      };
      for (const cell of out.cells) this.writeCell(sheetId, cellKey(def.row + cell.row, def.col + cell.col), { value: cell.value, style: styleFor(cell) });
      def.size = { rows: out.rows, cols: out.cols };
      this.record({ k: 'meta', sheetId, before, after: this.metaOf(sheet) });
    });
  }

  /** Add a pivot table to a sheet and draw it. */
  addPivot(sheetId: number, def: PivotDef, labels: PivotLabels = this.pivotLabels): Patch {
    return this.transact(() => {
      const sheet = this.sheet(sheetId);
      const before = this.metaOf(sheet);
      const taken = new Set(this.sheets.flatMap((s) => s.pivots.map((p) => p.name.toLowerCase())));
      if (taken.has(def.name.toLowerCase())) throw new Error('Ya existe una tabla dinámica con ese nombre');
      sheet.pivots.push(def);
      this.record({ k: 'meta', sheetId, before, after: this.metaOf(sheet) });
      try {
        this.renderPivot(sheetId, def.id, labels);
      } catch (e) {
        sheet.pivots = sheet.pivots.filter((p) => p.id !== def.id);
        throw e;
      }
    });
  }

  /** Change the definition of a pivot (fields, layout, filters…) and draw it again. */
  updatePivot(sheetId: number, id: string, fn: (p: PivotDef) => void, labels: PivotLabels = this.pivotLabels): Patch {
    return this.transact(() => {
      const sheet = this.sheet(sheetId);
      const def = sheet.pivots.find((p) => p.id === id);
      if (!def) return;
      const before = this.metaOf(sheet);
      const snapshot = structuredClone(def);
      fn(def);
      this.record({ k: 'meta', sheetId, before, after: this.metaOf(sheet) });
      try {
        this.renderPivot(sheetId, id, labels);
      } catch (e) {
        Object.assign(def, snapshot);
        throw e;
      }
    });
  }

  /** Remove the pivot and, if asked, the cells it drew. */
  removePivot(sheetId: number, id: string, clearCells = true): Patch {
    return this.transact(() => {
      const sheet = this.sheet(sheetId);
      const def = sheet.pivots.find((p) => p.id === id);
      if (!def) return;
      const before = this.metaOf(sheet);
      if (clearCells && def.size) {
        for (let r = 0; r < def.size.rows; r++) {
          for (let c = 0; c < def.size.cols; c++) if (sheet.cells.has(cellKey(def.row + r, def.col + c))) this.writeCell(sheetId, cellKey(def.row + r, def.col + c), null);
        }
      }
      sheet.pivots = sheet.pivots.filter((p) => p.id !== id);
      sheet.slicers = sheet.slicers.filter((sl) => !(sl.target.kind === 'pivot' && sl.target.id === id));
      this.record({ k: 'meta', sheetId, before, after: this.metaOf(sheet) });
    });
  }

  // -------------------------------------------------------------------------------- slicers
  /** The buttons of a slicer: every item of its field, and whether the slicer currently keeps it. */
  slicerItems(sl: SlicerDef): { key: string; label: string; selected: boolean }[] {
    const keep = (key: string) => sl.selected === null || sl.selected.includes(key);
    if (sl.target.kind === 'pivot') {
      const found = this.pivotById(sl.target.id);
      if (!found) return [];
      const out = this.pivotOutput(found.pivot);
      return (out?.items(sl.field) ?? []).map((i) => ({ ...i, selected: keep(i.key) }));
    }
    for (const sheet of this.sheets) {
      const t = sheet.tables.find((x) => x.id === sl.target.id);
      if (!t) continue;
      const col = t.columns.findIndex((c) => c.name === sl.field);
      if (col < 0 || !t.filter) return [];
      return columnValues(this, sheet, t.filter, normRect(t.ref).c1 + col).map((v) => ({ key: v.key, label: v.key === '' ? '(en blanco)' : v.key, selected: keep(v.key) }));
    }
    return [];
  }

  /** Choose which items a slicer keeps (null keeps all); the table or pivot it is attached to is filtered to match. */
  setSlicerSelection(sheetId: number, slicerId: string, selected: string[] | null): Patch {
    return this.transact(() => {
      const sheet = this.sheet(sheetId);
      const sl = sheet.slicers.find((x) => x.id === slicerId);
      if (!sl) return;
      const before = this.metaOf(sheet);
      sl.selected = selected;
      // slicers on the same field of the same target move together
      for (const other of sheet.slicers) if (other !== sl && other.target.id === sl.target.id && other.field === sl.field) other.selected = selected;
      if (sl.target.kind === 'pivot') {
        const found = this.pivotById(sl.target.id);
        if (found) {
          const p = found.pivot;
          if (selected === null) delete p.selection[sl.field];
          else p.selection[sl.field] = [...selected];
          this.record({ k: 'meta', sheetId, before, after: this.metaOf(sheet) });
          this.renderPivot(found.sheet.id, p.id);
          return;
        }
      } else {
        const t = sheet.tables.find((x) => x.id === sl.target.id);
        const col = t?.columns.findIndex((c) => c.name === sl.field) ?? -1;
        if (t && t.filter && col >= 0) {
          const abs = normRect(t.ref).c1 + col;
          if (selected === null) delete t.filter.columns[abs];
          else t.filter.columns[abs] = { values: [...selected] };
          applyAutoFilter(this, sheet);
          for (const g of this.subtotalCells) this.dirty.add(g);
        }
      }
      this.record({ k: 'meta', sheetId, before, after: this.metaOf(sheet) });
    });
  }

  /** Store a picture once; the key is what sheets refer to. */
  addMedia(mime: string, data: Uint8Array): string {
    let h = 2166136261;
    for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i]!, 16777619) >>> 0;
    const key = `m${h.toString(16)}-${data.length}`;
    if (!this.media.has(key)) this.media.set(key, { mime, data });
    return key;
  }

  /** Rename a table; formulas that use it follow. */
  renameTable(sheetId: number, id: string, newName: string): Patch {
    return this.transact(() => {
      const sheet = this.sheet(sheetId);
      const t = sheet.tables.find((x) => x.id === id);
      if (!t) return;
      const clash = this.tableByName(newName);
      if (clash && clash.table.id !== id) throw new Error('Ya existe una tabla con ese nombre');
      const old = t.name;
      const before = this.metaOf(sheet);
      t.name = newName;
      const fix = (n: Node): Node => mapNode(n, (x) => (x.t === 'tref' && x.table?.toLowerCase() === old.toLowerCase() ? { ...x, table: newName } : undefined));
      for (const sh of this.sheets) {
        for (const [k, c] of sh.cells) {
          if (!c.formula) continue;
          const text = printFormula(fix(c.formula.ast));
          if (text !== c.formula.text) this.writeCell(sh.id, k, { value: null, formula: text, style: c.style });
        }
        for (const tb of sh.tables) for (const col of tb.columns) if (col.calc) col.calc = printFormula(fix(parseFormula(col.calc)));
      }
      for (const n of this.names.values()) {
        n.text = printFormula(fix(n.ast));
        n.ast = parseFormula(n.text);
      }
      this.record({ k: 'meta', sheetId, before, after: this.metaOf(sheet) });
      this.objectsChanged();
    });
  }

  /** Extent of an array formula anchored at the cell, if any. */
  spillExtent(sheetId: number, row: number, col: number): { rows: number; cols: number } | undefined {
    return this.sheet(sheetId).spills.get(cellKey(row, col));
  }

  usedRange(sheetId: number): Rect | null {
    const s = this.sheet(sheetId);
    if (s.maxRow < 0) return null;
    let r1 = Infinity;
    let c1 = Infinity;
    let r2 = -1;
    let c2 = -1;
    for (const [k, c] of s.cells) {
      if (c.value === null && !c.formula) continue;
      const row = keyRow(k);
      const col = keyCol(k);
      r1 = Math.min(r1, row);
      c1 = Math.min(c1, col);
      r2 = Math.max(r2, row);
      c2 = Math.max(c2, col);
    }
    return r2 < 0 ? null : { r1, c1, r2, c2 };
  }
}
