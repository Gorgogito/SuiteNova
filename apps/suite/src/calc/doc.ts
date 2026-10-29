import {
  FormulaSyntaxError,
  MAX_COLS,
  MAX_ROWS,
  Workbook,
  applyAutoFilter,
  canonicalFormula,
  cellKey,
  colToName,
  columnValues,
  hasActiveFilter,
  newRuleId,
  colOffsetPx,
  rowOffsetPx,
  suggestChart,
  formatA1,
  formatRect,
  formatValue,
  functionRegistry,
  isDateFormat,
  isErr,
  isRowHidden,
  keyCol,
  keyRow,
  localizeFormula,
  mapNode,
  normRect,
  parseA1,
  parseFormula,
  parseInput,
  printFormula,
  rectContains,
  shiftRefs,
  type AutoFilter,
  type CellSnap,
  type CFRule,
  type ChartDef,
  type ColumnFilter,
  type ColumnValue,
  type ChartType,
  type FormulaLocale,
  type Patch,
  type Rect,
  type Scalar,
  type Sheet,
  type Style,
} from '@suitenova/calc-engine';
import { applyPreset, presetById } from './chartPresets';
import { CalcRuntime } from './macros';
import { DocObjects, ENTRY_PENDING, overlaps } from './doc-objects';
import { fillSeries } from './series';

/** The parts of `r` not covered by `cut` (up to four rectangles). */
export function subtractRect(r: Rect, cut: Rect): Rect[] {
  if (cut.r1 > r.r2 || cut.r2 < r.r1 || cut.c1 > r.c2 || cut.c2 < r.c1) return [r];
  const out: Rect[] = [];
  if (cut.r1 > r.r1) out.push({ ...r, r2: cut.r1 - 1 });
  if (cut.r2 < r.r2) out.push({ ...r, r1: cut.r2 + 1 });
  const r1 = Math.max(r.r1, cut.r1);
  const r2 = Math.min(r.r2, cut.r2);
  if (cut.c1 > r.c1) out.push({ r1, r2, c1: r.c1, c2: cut.c1 - 1 });
  if (cut.c2 < r.c2) out.push({ r1, r2, c1: cut.c2 + 1, c2: r.c2 });
  return out;
}

export interface CellPos {
  row: number;
  col: number;
}

export interface Selection {
  /** Highlighted ranges; the last one is the "current" one. */
  ranges: Rect[];
  active: CellPos;
  /** Fixed corner while extending with Shift/drag. */
  anchor: CellPos;
}

export interface SheetView {
  sel: Selection;
  scrollX: number;
  scrollY: number;
}

export interface EditState {
  sheetId: number;
  row: number;
  col: number;
  text: string;
  /** "enter": arrows commit and move; "edit": arrows move the caret. */
  mode: 'enter' | 'edit';
  /** The formula bar (not the cell) has focus. */
  fromBar: boolean;
  caret?: number;
}

export interface ClipCell {
  value: Scalar;
  formula?: string;
  style: number;
}

export interface ClipData {
  sheetId: number;
  rect: Rect;
  cells: (ClipCell | null)[][];
  cut: boolean;
  tsv: string;
}

export type PasteMode = 'all' | 'values' | 'formulas' | 'formats' | 'transpose';

interface HistoryEntry {
  label: string;
  patches: Patch[];
  viewBefore: { sheetId: number; sel: Selection };
  viewAfter: { sheetId: number; sel: Selection };
}

const cloneSel = (s: Selection): Selection => ({ ranges: s.ranges.map((r) => ({ ...r })), active: { ...s.active }, anchor: { ...s.anchor } });
const singleSel = (row: number, col: number): Selection => ({ ranges: [{ r1: row, c1: col, r2: row, c2: col }], active: { row, col }, anchor: { row, col } });

export interface FindOptions {
  matchCase?: boolean;
  wholeCell?: boolean;
  inFormulas?: boolean;
  allSheets?: boolean;
  backwards?: boolean;
}

export class CalcDoc {
  wb: Workbook;
  activeSheetId: number;
  views = new Map<number, SheetView>();
  edit: EditState | null = null;
  fileName: string | null = null;
  filePath: string | null = null;
  dirty = false;
  locale: FormulaLocale = 'es';
  showFormulas = false;
  clip: ClipData | null = null;
  /** Id of the chart that has focus (instead of a cell range). */
  selectedChart: string | null = null;
  /** Validation, links, notes, pictures, tables, sparklines, pivots, slicers and printing. */
  readonly x: DocObjects = new DocObjects(this);
  /** Runs the code modules of the workbook. */
  readonly macros: CalcRuntime = new CalcRuntime(this);
  /** Macros and functions of the code modules run only when this is true (a file that comes with code opens with it off). */
  contentEnabled = true;
  /** A short message for the status bar (why something was not done). */
  notice: string | null = null;
  /** The table whose filter menu is open (the sheet's own filter when null). */
  filterTable: string | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<() => void>();
  private version = 0;
  /** Bumped when column widths / row heights / merges change (grid must rebuild axes). */
  layoutVersion = 0;

  private unsubscribeWb: (() => void) | null = null;
  /** Column where the current run of Tab presses started (Enter returns there). */
  private tabOrigin: number | null = null;

  constructor(wb = new Workbook()) {
    this.wb = wb;
    this.activeSheetId = wb.sheets[0]!.id;
    this.unsubscribeWb = wb.subscribe(() => this.touch());
    this.hookMacros();
  }

  private hookMacros(): void {
    this.wb.userFunction = (name, args) => (this.contentEnabled ? this.macros.userFunction(name, args) : undefined);
  }

  /** The user trusts the code of this file: macros and user functions may run. */
  enableContent(): void {
    this.contentEnabled = true;
    this.wb.recalcAll();
    if (this.macros.hasProcedure('Workbook_Open')) {
      const r = this.macros.run('Workbook_Open');
      if (!r.ok) this.setNotice(r.error ?? null);
    }
    this.touch();
  }

  /** Replace the whole workbook (opening a file). Resets selection, history and clipboard. */
  load(wb: Workbook, name: string | null, path: string | null): void {
    this.unsubscribeWb?.();
    this.wb = wb;
    this.unsubscribeWb = wb.subscribe(() => this.touch());
    this.hookMacros();
    // code that comes with a file does not run until the user says so
    this.contentEnabled = wb.macros.length === 0;
    this.macros.clearConsole();
    this.activeSheetId = wb.sheets[0]!.id;
    this.views.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.edit = null;
    this.clip = null;
    this.fileName = name;
    this.filePath = path;
    this.dirty = false;
    this.layoutVersion++;
    this.touch();
  }

  setNotice(message: string | null): void {
    this.notice = message;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = message ? setTimeout(() => this.setNotice(null), 6000) : null;
    this.touch();
  }

  /** Is any of these cells part of a pivot table (whose cells cannot be changed one by one)? Says so when it is. */
  blockedByPivot(rects: Rect[], sheetId = this.activeSheetId): boolean {
    const sheet = this.wb.sheet(sheetId);
    for (const r of rects) {
      const n = normRect(r);
      for (const p of sheet.pivots) {
        if (p.size && overlaps(n, { r1: p.row, c1: p.col, r2: p.row + p.size.rows - 1, c2: p.col + p.size.cols - 1 })) {
          this.setNotice('No se puede cambiar esta parte de una tabla dinámica. Use la lista de campos para modificarla.');
          return true;
        }
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------------- subscription
  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getVersion = (): number => this.version;
  touch(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  // ---------------------------------------------------------------------------------- basics
  get sheet(): Sheet {
    return this.wb.sheet(this.activeSheetId);
  }

  get view(): SheetView {
    let v = this.views.get(this.activeSheetId);
    if (!v) this.views.set(this.activeSheetId, (v = { sel: singleSel(0, 0), scrollX: 0, scrollY: 0 }));
    return v;
  }

  get sel(): Selection {
    return this.view.sel;
  }

  get activeRange(): Rect {
    return this.sel.ranges[this.sel.ranges.length - 1]!;
  }

  get decimalComma(): boolean {
    return this.locale === 'es';
  }

  get title(): string {
    return (this.fileName ?? 'Libro1') + (this.dirty ? ' *' : '');
  }

  activateSheet(id: number): void {
    if (!this.wb.sheets.some((s) => s.id === id)) return;
    this.commitIfEditing();
    if (id !== this.activeSheetId) {
      this.activeSheetId = id;
      // what was selected or open belongs to the sheet that was left
      this.x.selectedImage = null;
      this.x.selectedSlicer = null;
      this.selectedChart = null;
      const home = this.x.pivotPane ? this.wb.pivotById(this.x.pivotPane) : undefined;
      if (!home || home.sheet.id !== id) this.x.pivotPane = null;
    }
    this.touch();
  }

  // ---------------------------------------------------------------------------------- display text
  display(sheetId: number, row: number, col: number): { text: string; color?: string; value: Scalar; style: Style } {
    const c = this.wb.getCell(sheetId, row, col);
    const style = this.wb.styles.get(c?.style ?? 0);
    const value = c?.value ?? null;
    if (this.showFormulas && c?.formula) return { text: `=${localizeFormula(c.formula.text, this.locale)}`, value, style };
    const f = formatValue(value, style.numFmt, this.locale);
    return { text: f.text, color: f.color, value, style };
  }

  /** Text shown in the formula bar / cell editor for a cell. */
  editText(sheetId: number, row: number, col: number): string {
    const c = this.wb.getCell(sheetId, row, col);
    if (!c) return '';
    if (c.formula) return `=${localizeFormula(c.formula.text, this.locale)}`;
    const v = c.value;
    if (typeof v === 'number') {
      const fmt = this.wb.styles.get(c.style).numFmt;
      if (isDateFormat(fmt)) {
        const hasTime = Math.abs(v - Math.floor(v)) > 1e-9;
        const code = Math.floor(v) === 0 ? 'hh:mm:ss' : this.locale === 'es' ? (hasTime ? 'dd/mm/yyyy hh:mm:ss' : 'dd/mm/yyyy') : hasTime ? 'm/d/yyyy hh:mm:ss' : 'm/d/yyyy';
        return formatValue(v, code, this.locale).text;
      }
      if (fmt && /%/.test(fmt)) return formatValue(v, '0.##########%', this.locale).text.replace(/[.,]$/, '');
      const s = String(v);
      return this.decimalComma ? s.replace('.', ',') : s;
    }
    if (typeof v === 'string') return this.wb.getInputText(sheetId, row, col);
    if (typeof v === 'boolean') return this.locale === 'es' ? (v ? 'VERDADERO' : 'FALSO') : v ? 'TRUE' : 'FALSE';
    return isErr(v) ? v.code : '';
  }

  // ---------------------------------------------------------------------------------- selection
  private mergeAt(row: number, col: number): Rect | undefined {
    return this.sheet.merges.find((m) => rectContains(m, row, col));
  }

  /** Grow a rectangle until it contains whole merged cells. */
  expandForMerges(r: Rect): Rect {
    let cur = normRect(r);
    let changed = true;
    while (changed) {
      changed = false;
      for (const m of this.sheet.merges) {
        const overlaps = m.r1 <= cur.r2 && m.r2 >= cur.r1 && m.c1 <= cur.c2 && m.c2 >= cur.c1;
        if (overlaps && (m.r1 < cur.r1 || m.r2 > cur.r2 || m.c1 < cur.c1 || m.c2 > cur.c2)) {
          cur = { r1: Math.min(cur.r1, m.r1), c1: Math.min(cur.c1, m.c1), r2: Math.max(cur.r2, m.r2), c2: Math.max(cur.c2, m.c2) };
          changed = true;
        }
      }
    }
    return cur;
  }

  selectCell(row: number, col: number, opts: { extend?: boolean; add?: boolean } = {}): void {
    row = Math.max(0, Math.min(MAX_ROWS - 1, row));
    col = Math.max(0, Math.min(MAX_COLS - 1, col));
    this.tabOrigin = null;
    this.selectedChart = null;
    this.x.selectedImage = null;
    this.x.selectedSlicer = null;
    const v = this.view;
    if (opts.extend) {
      const r = this.expandForMerges({ r1: v.sel.anchor.row, c1: v.sel.anchor.col, r2: row, c2: col });
      v.sel.ranges[v.sel.ranges.length - 1] = r;
    } else {
      const m = this.mergeAt(row, col);
      const r = m ? { ...m } : { r1: row, c1: col, r2: row, c2: col };
      const prev = opts.add ? v.sel.ranges : [];
      v.sel = { ranges: [...prev, r], active: { row: m ? m.r1 : row, col: m ? m.c1 : col }, anchor: { row: m ? m.r1 : row, col: m ? m.c1 : col } };
    }
    this.touch();
  }

  selectRange(r: Rect, active?: CellPos): void {
    this.selectedChart = null;
    this.x.selectedImage = null;
    this.x.selectedSlicer = null;
    const n = this.expandForMerges(r);
    const a = active ?? { row: n.r1, col: n.c1 };
    this.view.sel = { ranges: [n], active: a, anchor: { row: n.r1, col: n.c1 } };
    this.touch();
  }

  selectRows(r1: number, r2: number, add = false): void {
    const r = { r1: Math.min(r1, r2), r2: Math.max(r1, r2), c1: 0, c2: MAX_COLS - 1 };
    const v = this.view;
    v.sel = { ranges: add ? [...v.sel.ranges, r] : [r], active: { row: r.r1, col: v.sel.active.col }, anchor: { row: r1, col: 0 } };
    this.touch();
  }

  selectCols(c1: number, c2: number, add = false): void {
    const r = { c1: Math.min(c1, c2), c2: Math.max(c1, c2), r1: 0, r2: MAX_ROWS - 1 };
    const v = this.view;
    v.sel = { ranges: add ? [...v.sel.ranges, r] : [r], active: { row: v.sel.active.row, col: r.c1 }, anchor: { row: 0, col: c1 } };
    this.touch();
  }

  selectAll(): void {
    this.view.sel = { ranges: [{ r1: 0, c1: 0, r2: MAX_ROWS - 1, c2: MAX_COLS - 1 }], active: { ...this.sel.active }, anchor: { row: 0, col: 0 } };
    this.touch();
  }

  /** Jump over a block of data like Ctrl+Arrow. */
  private edgeJump(row: number, col: number, dr: number, dc: number): CellPos {
    const filled = (r: number, c: number) => {
      const cell = this.sheet.cells.get(cellKey(r, c));
      return !!cell && (cell.value !== null || !!cell.formula);
    };
    const inb = (r: number, c: number) => r >= 0 && c >= 0 && r < MAX_ROWS && c < MAX_COLS;
    let r = row;
    let c = col;
    const next = () => ({ r: r + dr, c: c + dc });
    let n = next();
    if (!inb(n.r, n.c)) return { row, col };
    if (filled(r, c) && filled(n.r, n.c)) {
      while (inb(n.r, n.c) && filled(n.r, n.c)) {
        r = n.r;
        c = n.c;
        n = next();
      }
    } else {
      r = n.r;
      c = n.c;
      const limitR = dr > 0 ? Math.max(this.sheet.maxRow, r) : 0;
      const limitC = dc > 0 ? Math.max(this.sheet.maxCol, c) : 0;
      while (inb(r, c) && !filled(r, c)) {
        if ((dr > 0 && r >= limitR) || (dr < 0 && r <= 0) || (dc > 0 && c >= limitC) || (dc < 0 && c <= 0)) break;
        r += dr;
        c += dc;
      }
    }
    return { row: Math.max(0, Math.min(MAX_ROWS - 1, r)), col: Math.max(0, Math.min(MAX_COLS - 1, c)) };
  }

  moveActive(dr: number, dc: number, opts: { extend?: boolean; jump?: boolean } = {}): void {
    const { sel } = this.view;
    // when extending, move the free corner; otherwise the active cell
    const cur = opts.extend ? (() => {
      const r = this.activeRange;
      return { row: sel.anchor.row === r.r1 ? r.r2 : r.r1, col: sel.anchor.col === r.c1 ? r.c2 : r.c1 };
    })() : sel.active;
    let target: CellPos;
    if (opts.jump) target = this.edgeJump(cur.row, cur.col, dr, dc);
    else {
      let row = cur.row;
      let col = cur.col;
      // skip over merged blocks and hidden rows/columns
      const m = !opts.extend ? this.mergeAt(row, col) : undefined;
      if (m) {
        row = dr > 0 ? m.r2 : dr < 0 ? m.r1 : row;
        col = dc > 0 ? m.c2 : dc < 0 ? m.c1 : col;
      }
      row += dr;
      col += dc;
      while (row >= 0 && row < MAX_ROWS && isRowHidden(this.sheet, row) && dr !== 0) row += dr;
      while (col >= 0 && col < MAX_COLS && this.sheet.hiddenCols.has(col) && dc !== 0) col += dc;
      target = { row: Math.max(0, Math.min(MAX_ROWS - 1, row)), col: Math.max(0, Math.min(MAX_COLS - 1, col)) };
    }
    this.selectCell(target.row, target.col, { extend: opts.extend });
  }

  /** Enter / Shift+Enter in navigation mode: after a run of Tab entries it returns to the column where the run began. */
  moveEnter(up: boolean): void {
    const origin = this.tabOrigin;
    if (origin !== null) this.selectCell(this.sel.active.row + (up ? -1 : 1), origin);
    else this.moveActive(up ? -1 : 1, 0);
  }

  // ---------------------------------------------------------------------------------- history
  /** Run a mutation as one undoable step. */
  run(label: string, fn: () => Patch | Patch[] | void): void {
    const before = { sheetId: this.activeSheetId, sel: cloneSel(this.sel) };
    const result = fn();
    const list: Patch[] = result === undefined ? [] : result.length > 0 && Array.isArray(result[0]) ? (result as Patch[]) : [result as Patch];
    const patches = list.filter((p) => p.length > 0);
    if (!patches.length) return;
    this.undoStack.push({ label, patches, viewBefore: before, viewAfter: { sheetId: this.activeSheetId, sel: cloneSel(this.sel) } });
    if (this.undoStack.length > 300) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
    this.noteLayout(patches);
    this.touch();
  }

  private noteLayout(patches: Patch[]): void {
    if (patches.some((p) => p.some((o) => o.k !== 'cell'))) this.layoutVersion++;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoLabel(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.label;
  }
  get redoLabel(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.label;
  }

  undo(): void {
    this.commitIfEditing();
    const e = this.undoStack.pop();
    if (!e) return;
    for (const p of [...e.patches].reverse()) this.wb.applyPatch(p, true);
    this.restoreView(e.viewBefore);
    this.redoStack.push(e);
    this.layoutVersion++;
    this.dirty = true;
    this.touch();
  }

  redo(): void {
    this.commitIfEditing();
    const e = this.redoStack.pop();
    if (!e) return;
    for (const p of e.patches) this.wb.applyPatch(p, false);
    this.restoreView(e.viewAfter);
    this.undoStack.push(e);
    this.layoutVersion++;
    this.dirty = true;
    this.touch();
  }

  private restoreView(v: { sheetId: number; sel: Selection }): void {
    if (this.wb.sheets.some((s) => s.id === v.sheetId)) {
      this.activeSheetId = v.sheetId;
      this.view.sel = cloneSel(v.sel);
    }
  }

  markSaved(name: string, path: string | null): void {
    this.fileName = name;
    this.filePath = path;
    this.dirty = false;
    this.touch();
  }

  // ---------------------------------------------------------------------------------- editing
  beginEdit(opts: { text?: string; mode?: 'enter' | 'edit'; fromBar?: boolean } = {}): void {
    if (this.edit) return;
    const { row, col } = this.sel.active;
    const c = this.wb.getCell(this.activeSheetId, row, col);
    if (c?.spillOf !== undefined) return; // spilled results are read-only
    const text = opts.text ?? this.editText(this.activeSheetId, row, col);
    this.edit = { sheetId: this.activeSheetId, row, col, text, mode: opts.mode ?? (opts.text === undefined ? 'edit' : 'enter'), fromBar: opts.fromBar ?? false };
    this.touch();
  }

  setEditText(text: string, caret?: number): void {
    if (!this.edit) return;
    this.edit = { ...this.edit, text, caret };
    this.touch();
  }

  setEditMode(mode: 'enter' | 'edit'): void {
    if (this.edit) {
      this.edit = { ...this.edit, mode };
      this.touch();
    }
  }

  cancelEdit(): void {
    if (this.edit) {
      this.edit = null;
      this.touch();
    }
  }

  /** Convert what the user typed into the canonical text stored by the engine. */
  private canonicalInput(text: string): { kind: 'formula'; text: string } | { kind: 'value'; value: Scalar; numFmt?: string } {
    if (text.startsWith('=') && text.length > 1) return { kind: 'formula', text: canonicalFormula(text.slice(1), this.locale) };
    const p = parseInput(text, { decimalComma: this.decimalComma, dateOrder: this.locale === 'es' ? 'dmy' : 'mdy' });
    return { kind: 'value', value: p.value, numFmt: p.numFmt };
  }

  /** Write typed text into a cell (formula bar / editor / paste). Throws FormulaSyntaxError for bad formulas. */
  private writeTyped(sheetId: number, row: number, col: number, text: string): Patch {
    if (text === '') return this.wb.setInput(sheetId, row, col, '');
    const c = this.canonicalInput(text);
    if (c.kind === 'formula') return this.wb.setInput(sheetId, row, col, `=${c.text}`);
    // typed text that looks like a number must not be reinterpreted by the engine's own parser
    const old = this.wb.getCell(sheetId, row, col);
    let style = old?.style ?? 0;
    if (c.numFmt && !this.wb.styles.get(style).numFmt) style = this.wb.styles.derive(style, { numFmt: c.numFmt });
    return this.wb.setCell(sheetId, row, col, { value: c.value, style });
  }

  /** Commit the open editor. Returns an error message if the formula is invalid (the editor stays open). */
  commitEdit(move: 'down' | 'right' | 'up' | 'left' | 'none' = 'none', opts: { force?: boolean } = {}): string | null {
    const e = this.edit;
    if (!e) return null;
    if (this.blockedByPivot([{ r1: e.row, c1: e.col, r2: e.row, c2: e.col }], e.sheetId)) {
      this.edit = null;
      this.touch();
      return null;
    }
    // a typed value must satisfy the data validation rule of its cell
    if (!opts.force && this.wb.sheet(e.sheetId).validations.length) {
      let value: Scalar | undefined;
      if (e.text === '') value = null;
      else {
        try {
          const c = this.canonicalInput(e.text);
          if (c.kind === 'value') value = c.value;
        } catch {
          value = undefined;
        }
      }
      if (value !== undefined) {
        const alert = this.x.checkEntry(e.sheetId, e.row, e.col, value, move);
        if (alert) {
          this.x.alert = alert;
          this.touch();
          return ENTRY_PENDING;
        }
      }
    }
    let error: string | null = null;
    this.run('Escribir en la celda', () => {
      try {
        const patch = this.writeTyped(e.sheetId, e.row, e.col, e.text);
        const style = this.wb.getStyle(e.sheetId, e.row, e.col);
        if (style.wrap) this.autoFitRow(e.sheetId, e.row);
        return [patch, ...this.x.afterEntry(e.sheetId, e.row, e.col, e.text)];
      } catch (err) {
        error = err instanceof FormulaSyntaxError ? err.message : String(err);
        return [];
      }
    });
    if (error) return error;
    this.edit = null;
    this.x.alert = null;
    this.macros.onChange(e.sheetId, e.row, e.col);
    const origin = this.tabOrigin ?? e.col;
    if (move === 'down' && this.tabOrigin !== null) {
      this.selectCell(e.row + 1, this.tabOrigin);
    } else if (move !== 'none') {
      const dir = { down: [1, 0], up: [-1, 0], right: [0, 1], left: [0, -1] }[move];
      this.moveActive(dir[0]!, dir[1]!);
      if (move === 'right' || move === 'left') this.tabOrigin = origin;
    } else this.touch();
    return null;
  }

  commitIfEditing(): void {
    if (this.edit && this.commitEdit() !== null) this.cancelEdit();
  }

  /** Grow the row so wrapped text fits (only when the row has no explicit height). */
  autoFitRow(sheetId: number, row: number): void {
    const s = this.wb.sheet(sheetId);
    if (s.rowHeights.has(row)) return;
    let lines = 1;
    for (let c = 0; c <= s.maxCol; c++) {
      const cell = s.cells.get(cellKey(row, c));
      if (!cell || !this.wb.styles.get(cell.style).wrap || typeof cell.value !== 'string') continue;
      const width = Math.max(20, this.wb.colWidth(sheetId, c) - 6);
      const approxChars = Math.max(1, Math.floor(width / 6.5));
      const n = cell.value.split('\n').reduce((acc, line) => acc + Math.max(1, Math.ceil(line.length / approxChars)), 0);
      lines = Math.max(lines, n);
    }
    if (lines > 1) {
      this.wb.editLayout(sheetId, (sh) => sh.rowHeights.set(row, Math.min(409 * 1.333, lines * 16 + 4)));
      this.layoutVersion++;
    }
  }

  // ---------------------------------------------------------------------------------- clearing / formatting
  private eachRange<T>(fn: (r: Rect) => T): T[] {
    return this.sel.ranges.map((r) => fn(normRect(r)));
  }

  clearContents(): void {
    this.commitIfEditing();
    if (this.blockedByPivot(this.sel.ranges)) return;
    this.run('Borrar contenido', () => this.eachRange((r) => this.wb.clear(this.activeSheetId, r, 'contents')));
  }

  clearAll(what: 'all' | 'formats' | 'contents'): void {
    if (what !== 'formats' && this.blockedByPivot(this.sel.ranges)) return;
    this.run(what === 'all' ? 'Borrar todo' : what === 'formats' ? 'Borrar formatos' : 'Borrar contenido', () => this.eachRange((r) => this.wb.clear(this.activeSheetId, r, what)));
  }

  applyStyle(patch: Partial<Record<keyof Style, unknown>>, label = 'Aplicar formato'): void {
    this.commitIfEditing();
    this.run(label, () => this.eachRange((r) => this.wb.formatRange(this.activeSheetId, r, patch)));
  }

  /** Toggle a boolean style on the whole selection, based on the active cell's current state. */
  toggleStyle(key: 'bold' | 'italic' | 'underline' | 'strike' | 'wrap'): void {
    const cur = this.wb.getStyle(this.activeSheetId, this.sel.active.row, this.sel.active.col)[key];
    this.applyStyle({ [key]: cur ? undefined : true }, 'Formato de fuente');
    if (key === 'wrap') {
      const r = this.activeRange;
      for (let row = r.r1; row <= Math.min(r.r2, r.r1 + 2000); row++) this.autoFitRow(this.activeSheetId, row);
    }
  }

  currentStyle(): Style {
    return this.wb.getStyle(this.activeSheetId, this.sel.active.row, this.sel.active.col);
  }

  setBorders(kind: 'all' | 'outer' | 'none' | 'top' | 'bottom' | 'left' | 'right' | 'thickOuter' | 'topBottom' | 'inner'): void {
    this.commitIfEditing();
    const thin = { style: 'thin' as const, color: '#000000' };
    const thick = { style: 'thick' as const, color: '#000000' };
    this.run('Bordes', () =>
      this.eachRange((r) => {
        const patches: Patch[] = [];
        const id = this.activeSheetId;
        if (kind === 'none') return this.wb.formatRange(id, r, { top: undefined, right: undefined, bottom: undefined, left: undefined });
        if (kind === 'all') return this.wb.formatRange(id, r, { top: thin, right: thin, bottom: thin, left: thin });
        const b = kind === 'thickOuter' ? thick : thin;
        const edge = (rect: Rect, side: 'top' | 'right' | 'bottom' | 'left') => patches.push(this.wb.formatRange(id, rect, { [side]: b }));
        const wantTop = kind === 'outer' || kind === 'thickOuter' || kind === 'top' || kind === 'topBottom';
        const wantBottom = kind === 'outer' || kind === 'thickOuter' || kind === 'bottom' || kind === 'topBottom';
        const wantLeft = kind === 'outer' || kind === 'thickOuter' || kind === 'left';
        const wantRight = kind === 'outer' || kind === 'thickOuter' || kind === 'right';
        if (wantTop) edge({ ...r, r2: r.r1 }, 'top');
        if (wantBottom) edge({ ...r, r1: r.r2 }, 'bottom');
        if (wantLeft) edge({ ...r, c2: r.c1 }, 'left');
        if (wantRight) edge({ ...r, c1: r.c2 }, 'right');
        if (kind === 'inner') {
          patches.push(this.wb.formatRange(id, r, { top: thin, left: thin }));
        }
        return patches.flat();
      }),
    );
  }

  merge(centre: boolean): void {
    this.commitIfEditing();
    const r = this.activeRange;
    if (r.r1 === r.r2 && r.c1 === r.c2) return;
    this.run('Combinar celdas', () => {
      const id = this.activeSheetId;
      const patches: Patch[] = [];
      // clear everything but the top-left cell
      for (let row = r.r1; row <= r.r2; row++) {
        for (let col = r.c1; col <= r.c2; col++) {
          if ((row !== r.r1 || col !== r.c1) && this.wb.getCell(id, row, col)) patches.push(this.wb.setCell(id, row, col, { value: null, style: this.wb.getCell(id, row, col)!.style }));
        }
      }
      patches.push(
        this.wb.editLayout(id, (s) => {
          s.merges = s.merges.filter((m) => !(m.r1 <= r.r2 && m.r2 >= r.r1 && m.c1 <= r.c2 && m.c2 >= r.c1));
          s.merges.push({ ...r });
        }),
      );
      if (centre) patches.push(this.wb.formatRange(id, { ...r, r2: r.r1, c2: r.c1 }, { hAlign: 'center' }));
      return patches;
    });
    this.selectCell(r.r1, r.c1);
  }

  unmerge(): void {
    const r = this.activeRange;
    this.run('Separar celdas', () =>
      this.wb.editLayout(this.activeSheetId, (s) => {
        s.merges = s.merges.filter((m) => !(m.r1 <= r.r2 && m.r2 >= r.r1 && m.c1 <= r.c2 && m.c2 >= r.c1));
      }),
    );
  }

  get activeIsMerged(): boolean {
    return this.sheet.merges.some((m) => rectContains(m, this.sel.active.row, this.sel.active.col));
  }

  // ---------------------------------------------------------------------------------- layout
  setColWidth(cols: number[], px: number): void {
    this.run('Ancho de columna', () =>
      this.wb.editLayout(this.activeSheetId, (s) => {
        for (const c of cols) s.colWidths.set(c, Math.max(4, Math.round(px)));
      }),
    );
  }
  setRowHeight(rows: number[], px: number): void {
    this.run('Alto de fila', () =>
      this.wb.editLayout(this.activeSheetId, (s) => {
        for (const r of rows) s.rowHeights.set(r, Math.max(4, Math.round(px)));
      }),
    );
  }

  /** Columns covered by the current selection (whole columns if selected, else spanned columns). */
  selectedCols(): number[] {
    const out = new Set<number>();
    for (const r of this.sel.ranges) for (let c = r.c1; c <= Math.min(r.c2, r.c1 + 2000); c++) out.add(c);
    return [...out];
  }
  selectedRows(): number[] {
    const out = new Set<number>();
    for (const r of this.sel.ranges) for (let c = r.r1; c <= Math.min(r.r2, r.r1 + 20000); c++) out.add(c);
    return [...out];
  }

  setHidden(axis: 'row' | 'col', hide: boolean): void {
    this.run(hide ? (axis === 'row' ? 'Ocultar filas' : 'Ocultar columnas') : 'Mostrar', () =>
      this.wb.editLayout(this.activeSheetId, (s) => {
        const set = axis === 'row' ? s.hiddenRows : s.hiddenCols;
        const items = axis === 'row' ? this.selectedRows() : this.selectedCols();
        if (hide) items.forEach((i) => set.add(i));
        else {
          // unhide the selection and its neighbours, like Excel's "Unhide"
          const lo = Math.max(0, Math.min(...items) - 1);
          const hi = Math.max(...items) + 1;
          for (let i = lo; i <= hi; i++) set.delete(i);
        }
      }),
    );
  }

  autoFitColumns(): void {
    this.run('Autoajustar ancho', () =>
      this.wb.editLayout(this.activeSheetId, (s) => {
        for (const c of this.selectedCols()) {
          let longest = 0;
          for (const [k, cell] of s.cells) {
            if (keyCol(k) !== c) continue;
            const d = this.display(this.activeSheetId, keyRow(k), c);
            longest = Math.max(longest, ...d.text.split('\n').map((l) => l.length * (d.style.bold ? 7.4 : 6.8) * ((d.style.fontSize ?? 11) / 11)));
            void cell;
          }
          if (longest > 0) s.colWidths.set(c, Math.min(800, Math.max(24, Math.round(longest + 12))));
        }
      }),
    );
  }

  freezePanes(mode: 'none' | 'top' | 'first' | 'cursor'): void {
    const { row, col } = this.sel.active;
    this.run('Inmovilizar paneles', () =>
      this.wb.editLayout(this.activeSheetId, (s) => {
        if (mode === 'none') s.freeze = { rows: 0, cols: 0 };
        else if (mode === 'top') s.freeze = { rows: 1, cols: 0 };
        else if (mode === 'first') s.freeze = { rows: 0, cols: 1 };
        else s.freeze = { rows: row, cols: col };
      }),
    );
  }

  toggleGridlines(): void {
    this.sheet.showGrid = !this.sheet.showGrid;
    this.touch();
  }

  // ---------------------------------------------------------------------------------- clipboard
  private snapshotCell(sheetId: number, row: number, col: number): ClipCell | null {
    const c = this.wb.getCell(sheetId, row, col);
    if (!c) return null;
    return { value: c.value, formula: c.formula?.text, style: c.style };
  }

  private tsvOf(sheetId: number, r: Rect): string {
    const lines: string[] = [];
    for (let row = r.r1; row <= r.r2; row++) {
      const cols: string[] = [];
      for (let col = r.c1; col <= r.c2; col++) {
        const t = this.display(sheetId, row, col).text;
        cols.push(/[\t\n\r"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
      }
      lines.push(cols.join('\t'));
    }
    return lines.join('\r\n');
  }

  /** Copy (or cut) the current range. Returns the text for the system clipboard. */
  copy(cut = false): string {
    this.commitIfEditing();
    const r = normRect(this.activeRange);
    const rows = Math.min(r.r2, this.sheet.maxRow) - r.r1 + 1;
    const cols = Math.min(r.c2, this.sheet.maxCol) - r.c1 + 1;
    const rect: Rect = { r1: r.r1, c1: r.c1, r2: r.r1 + Math.max(0, rows - 1), c2: r.c1 + Math.max(0, cols - 1) };
    const cells: (ClipCell | null)[][] = [];
    for (let row = rect.r1; row <= rect.r2; row++) {
      const line: (ClipCell | null)[] = [];
      for (let col = rect.c1; col <= rect.c2; col++) line.push(this.snapshotCell(this.activeSheetId, row, col));
      cells.push(line);
    }
    const tsv = this.tsvOf(this.activeSheetId, rect);
    this.clip = { sheetId: this.activeSheetId, rect, cells, cut, tsv };
    this.touch();
    return tsv;
  }

  clearClipboardMarks(): void {
    if (this.clip) {
      this.clip = null;
      this.touch();
    }
  }

  /** Parse tab-separated text from the system clipboard (with quoted fields). */
  static parseTsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else quoted = false;
        } else field += ch;
      } else if (ch === '"' && field === '') quoted = true;
      else if (ch === '\t') {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else field += ch;
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  /** Paste. `systemText` is what the OS clipboard holds; if it matches our last copy, formulas/styles are used. */
  paste(systemText: string | null, mode: PasteMode = 'all'): string | null {
    this.commitIfEditing();
    const target = this.sel.active;
    const id = this.activeSheetId;
    const internal = this.clip && (systemText === null || systemText === this.clip.tsv) ? this.clip : null;
    let error: string | null = null;

    this.run('Pegar', () => {
      const patches: Patch[] = [];
      if (internal) {
        const src = internal;
        const h = src.cells.length;
        const w = src.cells[0]?.length ?? 0;
        const transpose = mode === 'transpose';
        const th = transpose ? w : h;
        const tw = transpose ? h : w;
        // if the destination selection is a multiple of the source, tile the source
        const sel = this.activeRange;
        const reps = !transpose && sel.r2 - sel.r1 + 1 >= h && sel.c2 - sel.c1 + 1 >= w && (sel.r2 - sel.r1 + 1) % h === 0 && (sel.c2 - sel.c1 + 1) % w === 0 && h * w > 0 ? { r: (sel.r2 - sel.r1 + 1) / h, c: (sel.c2 - sel.c1 + 1) / w } : { r: 1, c: 1 };
        const origin = reps.r * reps.c > 1 ? { row: sel.r1, col: sel.c1 } : target;
        if (origin.row + th * reps.r > MAX_ROWS || origin.col + tw * reps.c > MAX_COLS) {
          error = 'No se puede pegar fuera de los límites de la hoja.';
          return [];
        }
        const sameSheetMove = src.cut && src.sheetId === id;
        const moved: Patch[] = [];
        for (let rr = 0; rr < reps.r; rr++) {
          for (let rc = 0; rc < reps.c; rc++) {
            for (let i = 0; i < th; i++) {
              for (let j = 0; j < tw; j++) {
                const cell = transpose ? src.cells[j]?.[i] : src.cells[i]?.[j];
                const row = origin.row + rr * th + i;
                const col = origin.col + rc * tw + j;
                const dRow = row - (src.rect.r1 + (transpose ? j : i));
                const dCol = col - (src.rect.c1 + (transpose ? i : j));
                if (this.wb.getCell(id, row, col)?.spillOf !== undefined) continue;
                patches.push(this.pasteCell(id, row, col, cell ?? null, mode, src.cut ? 0 : dRow, src.cut ? 0 : dCol));
              }
            }
          }
        }
        if (src.cut) {
          // remove the originals (except where the paste landed on them) and redirect references
          const dest: Rect = { r1: origin.row, c1: origin.col, r2: origin.row + th - 1, c2: origin.col + tw - 1 };
          for (let row = src.rect.r1; row <= src.rect.r2; row++) {
            for (let col = src.rect.c1; col <= src.rect.c2; col++) {
              if (src.sheetId === id && rectContains(dest, row, col)) continue;
              if (this.wb.getCell(src.sheetId, row, col)) moved.push(this.wb.setCell(src.sheetId, row, col, null));
            }
          }
          patches.push(...moved);
          if (sameSheetMove && !transpose) patches.push(...this.redirectReferences(src.sheetId, src.rect, origin.row - src.rect.r1, origin.col - src.rect.c1));
          this.clip = null;
        }
        this.selectRange({ r1: origin.row, c1: origin.col, r2: origin.row + th * reps.r - 1, c2: origin.col + tw * reps.c - 1 }, { row: origin.row, col: origin.col });
        return patches;
      }

      const text = systemText ?? '';
      const grid = CalcDoc.parseTsv(text);
      const gh = grid.length;
      const gw = Math.max(0, ...grid.map((r) => r.length));
      if (!gh || !gw) return [];
      if (target.row + gh > MAX_ROWS || target.col + gw > MAX_COLS) {
        error = 'No se puede pegar fuera de los límites de la hoja.';
        return [];
      }
      for (let i = 0; i < gh; i++) {
        for (let j = 0; j < gw; j++) {
          const t = grid[i]![j] ?? '';
          try {
            if (this.wb.getCell(id, target.row + i, target.col + j)?.spillOf !== undefined) continue;
            if (mode === 'formats') continue;
            patches.push(this.writeTyped(id, target.row + i, target.col + j, t));
          } catch {
            patches.push(this.wb.setCell(id, target.row + i, target.col + j, { value: t, style: this.wb.getCell(id, target.row + i, target.col + j)?.style ?? 0 }));
          }
        }
      }
      this.selectRange({ r1: target.row, c1: target.col, r2: target.row + gh - 1, c2: target.col + gw - 1 }, target);
      return patches;
    });
    return error;
  }

  private pasteCell(sheetId: number, row: number, col: number, cell: ClipCell | null, mode: PasteMode, dRow: number, dCol: number): Patch {
    const existing = this.wb.getCell(sheetId, row, col);
    const keepStyle = existing?.style ?? 0;
    if (mode === 'formats') return this.wb.setCell(sheetId, row, col, existing ? { value: existing.formula ? null : existing.value, formula: existing.formula?.text, style: cell?.style ?? 0 } : cell && cell.style ? { value: null, style: cell.style } : null);
    if (!cell) {
      // pasting an empty source cell clears the destination
      if (mode === 'values' || mode === 'formulas') return existing ? this.wb.setCell(sheetId, row, col, { value: null, style: keepStyle }) : [];
      return existing ? this.wb.setCell(sheetId, row, col, null) : [];
    }
    let formula = cell.formula;
    if (formula && (dRow || dCol)) formula = printFormula(shiftRefs(parseFormula(formula), dRow, dCol));
    const style = mode === 'values' || mode === 'formulas' ? keepStyle : cell.style;
    if (mode === 'values') return this.wb.setCell(sheetId, row, col, { value: cell.value, style });
    return this.wb.setCell(sheetId, row, col, formula ? { value: null, formula, style } : { value: cell.value, style });
  }

  /** After a cut-paste within a sheet, make formulas that referenced the moved block follow it. */
  private redirectReferences(sheetId: number, src: Rect, dRow: number, dCol: number): Patch[] {
    const patches: Patch[] = [];
    const sheetName = this.wb.sheet(sheetId).name.toLowerCase();
    const inside = (row: number, col: number) => rectContains(src, row, col);
    for (const s of this.wb.sheets) {
      const edits: { row: number; col: number; formula: string; style: number }[] = [];
      for (const [k, c] of s.cells) {
        if (!c.formula) continue;
        let changed = false;
        const ast = mapNode(c.formula.ast, (n) => {
          const sheetOk = (name?: string) => (name ?? s.name).toLowerCase() === sheetName;
          if (n.t === 'ref' && sheetOk(n.sheet) && inside(n.a.row, n.a.col)) {
            changed = true;
            return { ...n, a: { ...n.a, row: n.a.row + dRow, col: n.a.col + dCol } };
          }
          if (n.t === 'range' && sheetOk(n.sheet) && !n.whole && inside(n.a.row, n.a.col) && inside(n.b.row, n.b.col)) {
            changed = true;
            return { ...n, a: { ...n.a, row: n.a.row + dRow, col: n.a.col + dCol }, b: { ...n.b, row: n.b.row + dRow, col: n.b.col + dCol } };
          }
          return undefined;
        });
        if (changed) edits.push({ row: keyRow(k), col: keyCol(k), formula: printFormula(ast), style: c.style });
      }
      for (const e of edits) patches.push(this.wb.setCell(s.id, e.row, e.col, { value: null, formula: e.formula, style: e.style }));
    }
    return patches;
  }

  // ---------------------------------------------------------------------------------- fill
  fillDown(): void {
    this.fillDir('down');
  }
  fillRight(): void {
    this.fillDir('right');
  }

  private fillDir(dir: 'down' | 'right'): void {
    this.commitIfEditing();
    this.run(dir === 'down' ? 'Rellenar hacia abajo' : 'Rellenar hacia la derecha', () =>
      this.eachRange((r) => {
        const patches: Patch[] = [];
        const id = this.activeSheetId;
        if (dir === 'down' && r.r1 === r.r2) return [];
        if (dir === 'right' && r.c1 === r.c2) return [];
        const lines = dir === 'down' ? r.c2 - r.c1 + 1 : r.r2 - r.r1 + 1;
        const len = dir === 'down' ? r.r2 - r.r1 : r.c2 - r.c1;
        for (let l = 0; l < lines; l++) {
          const srcRow = dir === 'down' ? r.r1 : r.r1 + l;
          const srcCol = dir === 'down' ? r.c1 + l : r.c1;
          const src = this.snapshotCell(id, srcRow, srcCol);
          for (let k = 1; k <= len; k++) {
            const row = dir === 'down' ? srcRow + k : srcRow;
            const col = dir === 'down' ? srcCol : srcCol + k;
            patches.push(this.pasteCell(id, row, col, src, 'all', dir === 'down' ? k : 0, dir === 'right' ? k : 0));
          }
        }
        return patches.flat();
      }),
    );
  }

  /** Extend `src` to `target` (the fill handle). Target must share rows or columns with src. */
  fillTo(src: Rect, target: Rect, opts: { increment?: boolean } = {}): void {
    this.commitIfEditing();
    const id = this.activeSheetId;
    const s = normRect(src);
    const t = normRect(target);
    const down = t.r2 > s.r2 && t.c1 === s.c1 && t.c2 === s.c2;
    const up = t.r1 < s.r1 && t.c1 === s.c1 && t.c2 === s.c2;
    const right = t.c2 > s.c2 && t.r1 === s.r1 && t.r2 === s.r2;
    const left = t.c1 < s.c1 && t.r1 === s.r1 && t.r2 === s.r2;
    if (!down && !up && !right && !left) return;
    const vertical = down || up;
    const forward = down || right;
    this.run('Rellenar', () => {
      const patches: Patch[] = [];
      const lines = vertical ? s.c2 - s.c1 + 1 : s.r2 - s.r1 + 1;
      const n = vertical ? s.r2 - s.r1 + 1 : s.c2 - s.c1 + 1;
      const extra = vertical ? (down ? t.r2 - s.r2 : s.r1 - t.r1) : right ? t.c2 - s.c2 : s.c1 - t.c1;
      for (let l = 0; l < lines; l++) {
        // source cells in the order the fill walks through them
        const entries = Array.from({ length: n }, (_x, i) => {
          const row = vertical ? s.r1 + i : s.r1 + l;
          const col = vertical ? s.c1 + l : s.c1 + i;
          return { row, col, cell: this.snapshotCell(id, row, col) };
        });
        if (!forward) entries.reverse();
        const plain = entries.every((e) => e.cell && !e.cell.formula);
        const series = plain ? fillSeries(entries.map((e) => e.cell!.value), extra, { increment: opts.increment }) : null;
        for (let k = 1; k <= extra; k++) {
          const row = vertical ? (down ? s.r2 + k : s.r1 - k) : s.r1 + l;
          const col = vertical ? s.c1 + l : right ? s.c2 + k : s.c1 - k;
          const from = entries[(k - 1) % n]!;
          if (series && from.cell) patches.push(this.wb.setCell(id, row, col, { value: series[k - 1] ?? null, style: from.cell.style }));
          else patches.push(this.pasteCell(id, row, col, from.cell, 'all', row - from.row, col - from.col));
        }
      }
      this.selectRange({ r1: Math.min(s.r1, t.r1), c1: Math.min(s.c1, t.c1), r2: Math.max(s.r2, t.r2), c2: Math.max(s.c2, t.c2) }, this.sel.active);
      return patches;
    });
  }

  // ---------------------------------------------------------------------------------- structure
  insertRows(): void {
    this.commitIfEditing();
    const r = this.activeRange;
    const n = r.r2 - r.r1 + 1;
    this.run('Insertar filas', () => this.wb.shiftStructure(this.activeSheetId, 'row', r.r1, n));
  }
  insertCols(): void {
    this.commitIfEditing();
    const r = this.activeRange;
    const n = r.c2 - r.c1 + 1;
    this.run('Insertar columnas', () => this.wb.shiftStructure(this.activeSheetId, 'col', r.c1, n));
  }
  deleteRows(): void {
    this.commitIfEditing();
    const r = this.activeRange;
    this.run('Eliminar filas', () => this.wb.shiftStructure(this.activeSheetId, 'row', r.r1, -(r.r2 - r.r1 + 1)));
  }
  deleteCols(): void {
    this.commitIfEditing();
    const r = this.activeRange;
    this.run('Eliminar columnas', () => this.wb.shiftStructure(this.activeSheetId, 'col', r.c1, -(r.c2 - r.c1 + 1)));
  }

  // ---------------------------------------------------------------------------------- sheets
  addSheet(): void {
    this.commitIfEditing();
    const s = this.wb.addSheet();
    this.activeSheetId = s.id;
    this.dirty = true;
    this.touch();
  }

  renameSheet(id: number, name: string): string | null {
    const clean = name.trim();
    if (!clean || /[\\/?*[\]:]/.test(clean) || clean.length > 31) return 'El nombre de la hoja no es válido (máx. 31 caracteres, sin \\ / ? * [ ] :).';
    try {
      this.wb.renameSheet(id, clean);
    } catch (e) {
      return (e as Error).message;
    }
    this.dirty = true;
    this.touch();
    return null;
  }

  deleteSheet(id: number): void {
    if (this.wb.sheets.length <= 1) return;
    const idx = this.wb.sheets.findIndex((s) => s.id === id);
    this.wb.removeSheet(id);
    this.views.delete(id);
    if (this.activeSheetId === id) this.activeSheetId = this.wb.sheets[Math.max(0, idx - 1)]!.id;
    // sheet removal is not undoable yet: clear history so undo cannot reference the sheet
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = true;
    this.touch();
  }

  duplicateSheet(id: number): void {
    const src = this.wb.sheet(id);
    const idx = this.wb.sheets.indexOf(src);
    let name = `${src.name} (2)`;
    for (let i = 3; this.wb.sheetByName(name); i++) name = `${src.name} (${i})`;
    const copy = this.wb.addSheet(name, idx + 1);
    this.wb.transact(() => {
      for (const [k, c] of src.cells) {
        if (c.spillOf !== undefined) continue;
        this.wb.setCell(copy.id, keyRow(k), keyCol(k), { value: c.formula ? null : c.value, formula: c.formula?.text, style: c.style });
      }
    });
    copy.colWidths = new Map(src.colWidths);
    copy.rowHeights = new Map(src.rowHeights);
    copy.merges = src.merges.map((m) => ({ ...m }));
    copy.freeze = { ...src.freeze };
    copy.tabColor = src.tabColor;
    this.activeSheetId = copy.id;
    this.layoutVersion++;
    this.dirty = true;
    this.touch();
  }

  moveSheet(id: number, toIndex: number): void {
    const from = this.wb.sheets.findIndex((s) => s.id === id);
    if (from < 0) return;
    const [s] = this.wb.sheets.splice(from, 1);
    this.wb.sheets.splice(Math.max(0, Math.min(this.wb.sheets.length, toIndex)), 0, s!);
    this.dirty = true;
    this.touch();
  }

  setTabColor(id: number, color: string | undefined): void {
    this.wb.sheet(id).tabColor = color;
    this.dirty = true;
    this.touch();
  }

  // ---------------------------------------------------------------------------------- data
  /** Sort the rows of a range by one column. Formulas keep working relative to their new row. */
  sortRange(rect: Rect, byCol: number, ascending: boolean, hasHeader: boolean): void {
    this.commitIfEditing();
    const r = normRect(rect);
    const id = this.activeSheetId;
    const top = hasHeader ? r.r1 + 1 : r.r1;
    if (top >= r.r2 || byCol < r.c1 || byCol > r.c2) return;
    this.run('Ordenar', () => {
      const rows: { from: number; key: Scalar; cells: (ClipCell | null)[] }[] = [];
      for (let row = top; row <= r.r2; row++) {
        rows.push({ from: row, key: this.wb.getValue(id, row, byCol), cells: Array.from({ length: r.c2 - r.c1 + 1 }, (_x, j) => this.snapshotCell(id, row, r.c1 + j)) });
      }
      const rank = (v: Scalar) => (v === null ? 4 : isErr(v) ? 3 : typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
      const cmp = (a: Scalar, b: Scalar): number => {
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, this.locale, { sensitivity: 'base', numeric: true });
        return Number(a) - Number(b);
      };
      const sorted = [...rows].sort((x, y) => {
        const blank = rank(x.key) === 4 || rank(y.key) === 4;
        const c = cmp(x.key, y.key);
        return blank ? c : ascending ? c : -c;
      });
      const patches: Patch[] = [];
      sorted.forEach((item, i) => {
        const newRow = top + i;
        item.cells.forEach((cell, j) => {
          patches.push(this.pasteCell(id, newRow, r.c1 + j, cell, 'all', newRow - item.from, 0));
        });
      });
      return patches;
    });
  }

  removeDuplicates(rect: Rect, hasHeader: boolean): number {
    const r = normRect(rect);
    const id = this.activeSheetId;
    const top = hasHeader ? r.r1 + 1 : r.r1;
    const seen = new Set<string>();
    const keep: number[] = [];
    for (let row = top; row <= r.r2; row++) {
      const key = Array.from({ length: r.c2 - r.c1 + 1 }, (_x, j) => {
        const v = this.wb.getValue(id, row, r.c1 + j);
        return typeof v === 'string' ? `s:${v.toLowerCase()}` : `${typeof v}:${String(v)}`;
      }).join('\u0001');
      if (!seen.has(key)) {
        seen.add(key);
        keep.push(row);
      }
    }
    const removed = r.r2 - top + 1 - keep.length;
    if (removed <= 0) return 0;
    this.run('Quitar duplicados', () => {
      const patches: Patch[] = [];
      const snaps = keep.map((row) => Array.from({ length: r.c2 - r.c1 + 1 }, (_x, j) => ({ cell: this.snapshotCell(id, row, r.c1 + j), row })));
      snaps.forEach((line, i) => line.forEach((s, j) => patches.push(this.pasteCell(id, top + i, r.c1 + j, s.cell, 'all', top + i - s.row, 0))));
      for (let row = top + keep.length; row <= r.r2; row++) for (let col = r.c1; col <= r.c2; col++) patches.push(this.wb.setCell(id, row, col, null));
      return patches;
    });
    return removed;
  }

  autoSum(fn: 'SUM' | 'AVERAGE' | 'COUNT' | 'MAX' | 'MIN'): void {
    this.commitIfEditing();
    const id = this.activeSheetId;
    const r = this.activeRange;
    this.run('Autosuma', () => {
      const single = r.r1 === r.r2 && r.c1 === r.c2;
      if (!single) {
        // multiple cells selected: put a total below each column (or right of a single row)
        const patches: Patch[] = [];
        if (r.r2 > r.r1 || r.c1 === r.c2) {
          for (let c = r.c1; c <= r.c2; c++) patches.push(this.wb.setInput(id, r.r2 + 1, c, `=${fn}(${formatRect({ r1: r.r1, c1: c, r2: r.r2, c2: c })})`));
          this.selectCell(r.r2 + 1, r.c1);
        } else {
          patches.push(this.wb.setInput(id, r.r1, r.c2 + 1, `=${fn}(${formatRect(r)})`));
          this.selectCell(r.r1, r.c2 + 1);
        }
        return patches;
      }
      // single cell: guess the block of numbers above, else to the left
      const { r1: row, c1: col } = r;
      const isNum = (rr: number, cc: number) => typeof this.wb.getValue(id, rr, cc) === 'number';
      let top = row - 1;
      while (top >= 0 && isNum(top, col)) top--;
      top++;
      let range: Rect | null = top < row ? { r1: top, c1: col, r2: row - 1, c2: col } : null;
      if (!range) {
        let left = col - 1;
        while (left >= 0 && isNum(row, left)) left--;
        left++;
        if (left < col) range = { r1: row, c1: left, r2: row, c2: col - 1 };
      }
      const text = range ? `=${fn}(${formatRect(range)})` : `=${fn}()`;
      const patch = this.wb.setInput(id, row, col, range ? text : '=' + fn + '(' + formatA1(row, col) + ')');
      return patch;
    });
  }

  /** The contiguous block of data around the active cell ("current region"), or null on an empty area. */
  usedBlock(): Rect | null {
    const id = this.activeSheetId;
    const filled = (r: number, c: number) => {
      if (r < 0 || c < 0 || r >= MAX_ROWS || c >= MAX_COLS) return false;
      const cell = this.sheet.cells.get(cellKey(r, c));
      return !!cell && (cell.value !== null || !!cell.formula);
    };
    void id;
    let { row: r1, col: c1 } = this.sel.active;
    let r2 = r1;
    let c2 = c1;
    const ring = (a: number, b: number, c: number, e: number) => {
      for (let r = a; r <= c; r++) for (let cc = b; cc <= e; cc++) if (filled(r, cc)) return true;
      return false;
    };
    if (!filled(r1, c1) && !ring(r1 - 1, c1 - 1, r1 + 1, c1 + 1)) return null;
    let grew = true;
    while (grew) {
      grew = false;
      if (r1 > 0 && ring(r1 - 1, c1 - 1, r1 - 1, c2 + 1)) { r1--; grew = true; }
      if (ring(r2 + 1, c1 - 1, r2 + 1, c2 + 1) && r2 < this.sheet.maxRow) { r2++; grew = true; }
      if (c1 > 0 && ring(r1 - 1, c1 - 1, r2 + 1, c1 - 1)) { c1--; grew = true; }
      if (ring(r1 - 1, c2 + 1, r2 + 1, c2 + 1) && c2 < this.sheet.maxCol) { c2++; grew = true; }
    }
    return { r1: Math.max(0, r1), c1: Math.max(0, c1), r2, c2 };
  }

  /** Heuristic: first row is all text and the rows below hold numbers or dates. */
  looksLikeHeader(rect: Rect): boolean {
    const r = normRect(rect);
    if (r.r2 <= r.r1) return false;
    const id = this.activeSheetId;
    let texts = 0;
    for (let c = r.c1; c <= r.c2; c++) {
      const v = this.wb.getValue(id, r.r1, c);
      if (typeof v === 'string' && v !== '') texts++;
    }
    if (texts !== r.c2 - r.c1 + 1) return false;
    for (let c = r.c1; c <= r.c2; c++) {
      const below = this.wb.getValue(id, r.r1 + 1, c);
      if (typeof below !== 'string') return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------------- charts
  /** Create a chart from the selected cells (or the data block around the active cell). */
  insertChart(kind: ChartType | string): string | null {
    this.commitIfEditing();
    const preset = presetById(kind) ?? presetById(kind === 'column' ? 'column' : kind);
    if (!preset) return 'Tipo de gráfico desconocido.';
    // charts that need a special arrangement of the data start from a plain line chart of the selection
    const type: ChartType = preset.type === 'stock' || preset.type === 'surface' || preset.type === 'radar' ? 'line' : preset.type === 'doughnut' ? 'pie' : preset.type;
    const id = this.activeSheetId;
    const r = this.activeRange;
    const single = r.r1 === r.r2 && r.c1 === r.c2;
    const rect = single ? this.usedBlock() : normRect(r);
    if (!rect) return 'Selecciona las celdas con los datos que quieres representar.';
    const def = suggestChart(this.wb, id, rect, type);
    if (!def) return 'No hay datos numéricos en la selección para crear un gráfico.';
    const sheet = this.sheet;
    const made: ChartDef = {
      ...def,
      id: `chart-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
      x: colOffsetPx(sheet, Math.min(rect.c2 + 2, MAX_COLS - 1)),
      y: rowOffsetPx(sheet, rect.r1),
      width: 480,
      height: 288,
    };
    const applied = applyPreset(made, preset);
    if (typeof applied === 'string') return applied;
    const chart = applied;
    this.run('Insertar gráfico', () => this.wb.editCharts(id, (cs) => cs.push(chart)));
    this.selectedChart = chart.id;
    this.touch();
    return null;
  }

  /** Change the selected chart into another kind, keeping its data. Returns why it cannot be done. */
  convertChart(presetId: string): string | null {
    const c = this.chartById(this.selectedChart);
    const preset = presetById(presetId);
    if (!c || !preset) return null;
    const next = applyPreset(c, preset);
    if (typeof next === 'string') return next;
    this.run('Tipo de gráfico', () =>
      this.wb.editCharts(this.activeSheetId, (cs) => {
        const i = cs.findIndex((x) => x.id === c.id);
        if (i >= 0) cs[i] = next;
      }),
    );
    return null;
  }

  chartById(id: string | null): ChartDef | undefined {
    return id ? this.sheet.charts.find((c) => c.id === id) : undefined;
  }

  updateChart(id: string, patch: Partial<Omit<ChartDef, 'id'>>, label = 'Modificar gráfico'): void {
    this.run(label, () =>
      this.wb.editCharts(this.activeSheetId, (cs) => {
        const i = cs.findIndex((c) => c.id === id);
        if (i >= 0) cs[i] = { ...cs[i]!, ...patch };
      }),
    );
  }

  deleteChart(id: string): void {
    this.run('Eliminar gráfico', () => this.wb.editCharts(this.activeSheetId, (cs) => void cs.splice(0, cs.length, ...cs.filter((c) => c.id !== id))));
    if (this.selectedChart === id) this.selectedChart = null;
    this.touch();
  }

  selectChart(id: string | null): void {
    this.selectedChart = id;
    this.touch();
  }

  // ---------------------------------------------------------------------------------- autofilter
  get autoFilter(): AutoFilter | undefined {
    if (this.filterTable) return this.sheet.tables.find((t) => t.id === this.filterTable)?.filter;
    return this.sheet.autoFilter;
  }

  get filterActive(): boolean {
    return !!this.sheet.autoFilter;
  }

  get hasColumnFilters(): boolean {
    return hasActiveFilter(this.sheet.autoFilter);
  }

  /** Turn the autofilter on for the selection (or the data block around the cursor), or off if it is on. */
  toggleAutoFilter(): string | null {
    this.commitIfEditing();
    const id = this.activeSheetId;
    if (this.sheet.autoFilter) {
      this.run('Quitar filtro', () =>
        this.wb.editLayout(id, (s) => {
          s.autoFilter = undefined;
          s.filterHidden = new Set();
        }),
      );
      return null;
    }
    const r = this.activeRange;
    const single = r.r1 === r.r2 && r.c1 === r.c2;
    const rect = single ? this.usedBlock() : normRect(r);
    if (!rect || rect.r2 <= rect.r1) return 'Selecciona un rango con encabezados y al menos una fila de datos para aplicar el filtro.';
    this.run('Aplicar filtro', () =>
      this.wb.editLayout(id, (s) => {
        s.autoFilter = { range: rect, columns: {} };
        s.filterHidden = new Set();
      }),
    );
    return null;
  }

  /** Set (or with null clear) the filter of one column and refresh the hidden rows. */
  setColumnFilter(col: number, filter: ColumnFilter | null): void {
    if (this.filterTable) {
      const id = this.filterTable;
      this.run(filter ? 'Filtrar' : 'Borrar filtro', () =>
        this.wb.editObjects(this.activeSheetId, (s) => {
          const t = s.tables.find((x) => x.id === id);
          if (!t?.filter) return;
          const columns = { ...t.filter.columns };
          if (filter) columns[col] = filter;
          else delete columns[col];
          t.filter = { ...t.filter, columns };
          applyAutoFilter(this.wb, s);
        }),
      );
      return;
    }
    const af = this.sheet.autoFilter;
    if (!af) return;
    this.run(filter ? 'Filtrar' : 'Borrar filtro', () =>
      this.wb.editLayout(this.activeSheetId, (s) => {
        const columns = { ...s.autoFilter!.columns };
        if (filter) columns[col] = filter;
        else delete columns[col];
        s.autoFilter = { ...s.autoFilter!, columns };
        applyAutoFilter(this.wb, s);
      }),
    );
  }

  clearColumnFilters(): void {
    if (!this.sheet.autoFilter) return;
    this.run('Borrar filtros', () =>
      this.wb.editLayout(this.activeSheetId, (s) => {
        s.autoFilter = { ...s.autoFilter!, columns: {} };
        applyAutoFilter(this.wb, s);
      }),
    );
  }

  /** Re-evaluate the filters after the data changed (Excel does this only on request). */
  reapplyFilter(): void {
    if (this.sheet.autoFilter) this.run('Volver a aplicar filtro', () => this.wb.reapplyFilter(this.activeSheetId));
  }

  filterValues(col: number): ColumnValue[] {
    const af = this.autoFilter;
    return af ? columnValues(this.wb, this.sheet, af, col) : [];
  }

  /** Text shown above a filter column: header cell text or its column letter. */
  filterHeaderLabel(col: number): string {
    const af = this.autoFilter;
    if (!af) return '';
    const h = this.wb.getValue(this.activeSheetId, normRect(af.range).r1, col);
    return typeof h === 'string' && h ? h : typeof h === 'number' ? String(h) : colToName(col);
  }

  sortByFilterColumn(col: number, ascending: boolean): void {
    const af = this.autoFilter;
    if (!af) return;
    const rect = normRect(af.range);
    // sortRange records its own history entry; the filter is re-evaluated as a second step
    this.sortRange(rect, col, ascending, true);
    this.run('Volver a aplicar filtro', () => this.wb.reapplyFilter(this.activeSheetId));
  }

  // ---------------------------------------------------------------------------------- conditional formatting
  get condFormats(): CFRule[] {
    return this.sheet.condFormats;
  }

  /** Add a rule with the highest priority (like Excel's "New rule"). */
  addCF(rule: Omit<CFRule, 'id' | 'priority'> & { id?: string }): string {
    const id = rule.id ?? newRuleId();
    this.run('Formato condicional', () =>
      this.wb.editLayout(this.activeSheetId, (s) => {
        for (const r of s.condFormats) r.priority++;
        s.condFormats.push({ ...rule, id, priority: 1 } as CFRule);
      }),
    );
    return id;
  }

  updateCF(id: string, rule: Partial<CFRule> & { type?: CFRule['type'] }, replace = false): void {
    this.run('Modificar regla', () =>
      this.wb.editLayout(this.activeSheetId, (s) => {
        const i = s.condFormats.findIndex((r) => r.id === id);
        if (i < 0) return;
        const old = s.condFormats[i]!;
        s.condFormats[i] = (replace ? { ...rule, id, ranges: rule.ranges ?? old.ranges, priority: old.priority } : { ...old, ...rule, id }) as CFRule;
      }),
    );
  }

  deleteCF(id: string): void {
    this.run('Eliminar regla', () => this.wb.editLayout(this.activeSheetId, (s) => void (s.condFormats = s.condFormats.filter((r) => r.id !== id))));
  }

  /** Move a rule up (+1 priority) or down in the evaluation order. */
  moveCF(id: string, delta: -1 | 1): void {
    this.run('Prioridad de regla', () =>
      this.wb.editLayout(this.activeSheetId, (s) => {
        const sorted = [...s.condFormats].sort((a, b) => a.priority - b.priority);
        const i = sorted.findIndex((r) => r.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= sorted.length) return;
        [sorted[i], sorted[j]] = [sorted[j]!, sorted[i]!];
        sorted.forEach((r, k) => (r.priority = k + 1));
      }),
    );
  }

  /** Remove the rules (or the parts of their ranges) that fall inside the selection, or all rules of the sheet. */
  clearCF(scope: 'selection' | 'sheet'): void {
    const sel = this.sel.ranges.map((r) => normRect(r));
    this.run('Borrar reglas', () =>
      this.wb.editLayout(this.activeSheetId, (s) => {
        if (scope === 'sheet') {
          s.condFormats = [];
          return;
        }
        s.condFormats = s.condFormats.flatMap((rule) => {
          let ranges = rule.ranges.map((r) => normRect(r));
          for (const cut of sel) ranges = ranges.flatMap((r) => subtractRect(r, cut));
          return ranges.length ? [{ ...rule, ranges }] : [];
        });
      }),
    );
  }

  // ---------------------------------------------------------------------------------- find / replace
  private cellText(sheetId: number, row: number, col: number, inFormulas: boolean): string {
    return inFormulas ? this.editText(sheetId, row, col) : this.display(sheetId, row, col).text;
  }

  private matcher(query: string, o: FindOptions): (t: string) => boolean {
    const q = o.matchCase ? query : query.toLowerCase();
    return (t) => {
      const s = o.matchCase ? t : t.toLowerCase();
      return o.wholeCell ? s === q : s.includes(q);
    };
  }

  /** Select the next cell matching `query`, starting after the active cell. Returns whether one was found. */
  findNext(query: string, o: FindOptions = {}): boolean {
    if (!query) return false;
    const test = this.matcher(query, o);
    const sheets = o.allSheets ? this.wb.sheets : [this.sheet];
    const start = sheets.findIndex((s) => s.id === this.activeSheetId);
    const cur = this.sel.active;
    const order: { sheet: Sheet; keys: number[] }[] = [];
    for (let i = 0; i < sheets.length; i++) {
      const sheet = sheets[(start + i + sheets.length) % sheets.length]!;
      order.push({ sheet, keys: [...sheet.cells.keys()].sort((a, b) => (o.backwards ? b - a : a - b)) });
    }
    const here = cellKey(cur.row, cur.col);
    for (let pass = 0; pass < 2; pass++) {
      for (let si = 0; si < order.length; si++) {
        const { sheet, keys } = order[si]!;
        for (const k of keys) {
          if (pass === 0 && si === 0 && (o.backwards ? k >= here : k <= here)) continue;
          if (pass === 1 && si === 0 && (o.backwards ? k < here : k > here)) continue;
          const row = keyRow(k);
          const col = keyCol(k);
          if (isRowHidden(sheet, row) || sheet.hiddenCols.has(col)) continue;
          if (test(this.cellText(sheet.id, row, col, !!o.inFormulas))) {
            if (sheet.id !== this.activeSheetId) this.activeSheetId = sheet.id;
            this.selectCell(row, col);
            return true;
          }
        }
      }
    }
    return false;
  }

  replaceAll(query: string, replacement: string, o: FindOptions = {}): number {
    if (!query) return 0;
    const test = this.matcher(query, o);
    const flags = o.matchCase ? 'g' : 'gi';
    const re = new RegExp(o.wholeCell ? '^' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$' : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    let count = 0;
    this.run('Reemplazar todo', () => {
      const patches: Patch[] = [];
      for (const sheet of o.allSheets ? this.wb.sheets : [this.sheet]) {
        for (const [k, c] of [...sheet.cells]) {
          if (c.spillOf !== undefined) continue;
          const row = keyRow(k);
          const col = keyCol(k);
          if (!c.formula && typeof c.value !== 'string' && o.inFormulas === false) continue;
          const text = this.cellText(sheet.id, row, col, !!o.inFormulas || !!c.formula);
          if (!test(text)) continue;
          const next = text.replace(re, () => replacement);
          try {
            patches.push(this.writeTyped(sheet.id, row, col, next));
            count++;
          } catch {
            /* leave cells whose replacement is not a valid formula */
          }
        }
      }
      return patches;
    });
    return count;
  }

  // ---------------------------------------------------------------------------------- names & misc
  /** Resolve what the Name Box shows for the current selection. */
  nameBoxText(): string {
    const r = this.activeRange;
    const rect = normRect(r);
    if (rect.r1 === 0 && rect.r2 === MAX_ROWS - 1 && rect.c1 === 0 && rect.c2 === MAX_COLS - 1) return 'A1';
    for (const def of this.wb.namesFor(this.activeSheetId).map((n) => ({ name: n.name, ast: this.wb.definedName(n.name, this.activeSheetId)! }))) {
      if (def.ast.t === 'range' && (!def.ast.sheet || def.ast.sheet.toLowerCase() === this.sheet.name.toLowerCase())) {
        const a = def.ast.a;
        const b = def.ast.b;
        if (a.row === rect.r1 && a.col === rect.c1 && b.row === rect.r2 && b.col === rect.c2) return def.name;
      }
    }
    if (rect.r1 === rect.r2 && rect.c1 === rect.c2) return formatA1(this.sel.active.row, this.sel.active.col);
    return formatRect(rect);
  }

  /** Go to an address, range or defined name typed in the Name Box. */
  goTo(text: string): boolean {
    const t = text.trim();
    const nameAst = this.wb.definedName(t, this.activeSheetId);
    if (nameAst && (nameAst.t === 'ref' || nameAst.t === 'range')) {
      const sheet = nameAst.sheet ? this.wb.sheetByName(nameAst.sheet) : this.sheet;
      if (!sheet) return false;
      this.activeSheetId = sheet.id;
      const a = nameAst.a;
      const b = nameAst.t === 'range' ? nameAst.b : nameAst.a;
      this.selectRange({ r1: a.row, c1: a.col, r2: b.row, c2: b.col });
      return true;
    }
    const m = /^(?:(?:'([^']+)'|([^!]+))!)?(.+)$/.exec(t);
    if (!m) return false;
    const sheetName = m[1] ?? m[2];
    const target = sheetName ? this.wb.sheetByName(sheetName) : this.sheet;
    if (!target) return false;
    const parts = m[3]!.split(':');
    const a = parseA1(parts[0]!.toUpperCase());
    const b = parseA1((parts[1] ?? parts[0]!).toUpperCase());
    if (!a || !b) return false;
    this.activeSheetId = target.id;
    this.selectRange({ r1: Math.min(a.row, b.row), c1: Math.min(a.col, b.col), r2: Math.max(a.row, b.row), c2: Math.max(a.col, b.col) }, { row: a.row, col: a.col });
    return true;
  }

  defineNameForSelection(name: string): string | null {
    if (!/^[A-Za-z_À-￿][\w.À-￿]*$/.test(name) || parseA1(name) || functionRegistry.has(name.toUpperCase())) return 'El nombre no es válido.';
    const r = normRect(this.activeRange);
    const a = formatA1(r.r1, r.c1, true, true);
    const text = r.r1 === r.r2 && r.c1 === r.c2 ? a : `${a}:${formatA1(r.r2, r.c2, true, true)}`;
    const sheetName = this.sheet.name;
    const q = /^[A-Za-z_][\w.]*$/.test(sheetName) ? sheetName : `'${sheetName.replace(/'/g, "''")}'`;
    this.wb.defineName(name, `${q}!${text}`);
    this.dirty = true;
    this.touch();
    return null;
  }

  /** Statistics of the numeric cells in the selection, for the status bar. */
  selectionStats(): { count: number; numeric: number; sum: number; avg: number; min: number; max: number } | null {
    const id = this.activeSheetId;
    let count = 0;
    let numeric = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    let cells = 0;
    for (const raw of this.sel.ranges) {
      const r = normRect(raw);
      cells += (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1);
      if (cells <= 1) continue;
      const area = (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1);
      const visit = (v: Scalar) => {
        if (v === null) return;
        count++;
        if (typeof v === 'number') {
          numeric++;
          sum += v;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      };
      if (area <= this.sheet.cells.size) {
        for (let row = r.r1; row <= r.r2; row++) for (let col = r.c1; col <= r.c2; col++) visit(this.wb.getValue(id, row, col));
      } else {
        for (const [k, c] of this.sheet.cells) if (rectContains(r, keyRow(k), keyCol(k))) visit(c.value);
      }
    }
    if (cells <= 1 || count === 0) return null;
    return { count, numeric, sum, avg: numeric ? sum / numeric : 0, min, max };
  }
}

export type { CellSnap };
