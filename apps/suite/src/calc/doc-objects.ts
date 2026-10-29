import {
  MAX_COLS,
  colOffsetPx,
  formatA1,
  hyperlinkAt,
  invalidCells,
  newPivot,
  newSparklineGroup,
  newValidation,
  normRect,
  parseA1,
  parseFormula,
  printFormula,
  rectContains,
  rowOffsetPx,
  safeUrl,
  shiftRefs,
  tableAt,
  tableParts,
  validTableName,
  validateEntry,
  type CellComment,
  type DataValidation,
  type Hyperlink,
  type PageSetup,
  type PivotDef,
  type PivotLabels,
  type Rect,
  type Scalar,
  type Sheet,
  type SheetImage,
  type SlicerDef,
  type SparklineGroup,
  type SparklineType,
  type TableDef,
  type Workbook,
} from '@suitenova/calc-engine';
import { PIVOT_LABELS_EN, PIVOT_LABELS_ES } from '@suitenova/calc-engine';
import type { CalcDoc } from './doc';

let counter = 0;
export const uid = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export const HYPERLINK_COLOR = '#0563c1';

/** Returned by `commitEdit` while a validation alert waits for the user (nothing to show as an error). */
export const ENTRY_PENDING = '\u0001entry';

export type ObjectKind = 'image' | 'slicer';

/** What the user has to answer when a typed value breaks a validation rule. */
export interface EntryAlert {
  rule: DataValidation;
  title: string;
  message: string;
  /** "stop" cannot be accepted; the others can. */
  style: DataValidation['errorStyle'];
  move: 'down' | 'right' | 'up' | 'left' | 'none';
}

/** Operations on the objects of a sheet: validation, links, notes, pictures, tables, sparklines, pivots, slicers, printing. */
export class DocObjects {
  /** Draw a circle around values that break their rule. */
  circleInvalid = false;
  selectedImage: string | null = null;
  selectedSlicer: string | null = null;
  /** The pivot table whose field list is open. */
  pivotPane: string | null = null;
  /** Set while a typed value is waiting for the user's decision. */
  alert: EntryAlert | null = null;

  constructor(private d: CalcDoc) {}

  private get id(): number {
    return this.d.activeSheetId;
  }
  private get sheet(): Sheet {
    return this.d.sheet;
  }
  private get wb() {
    return this.d.wb;
  }

  get pivotLabels(): PivotLabels {
    return this.d.locale === 'en' ? PIVOT_LABELS_EN : PIVOT_LABELS_ES;
  }

  // ------------------------------------------------------------------------------------------------ selection of objects
  selectObject(kind: ObjectKind | null, id: string | null): void {
    this.selectedImage = kind === 'image' ? id : null;
    this.selectedSlicer = kind === 'slicer' ? id : null;
    if (kind) this.d.selectedChart = null;
    this.d.touch();
  }

  // ------------------------------------------------------------------------------------------------ data validation
  validationAtActive(): DataValidation | undefined {
    const { row, col } = this.d.sel.active;
    return this.sheet.validations.find((v) => v.ranges.some((r) => rectContains(normRect(r), row, col)));
  }

  /** Apply a rule to the selected cells, replacing any rule that covered them. */
  setValidation(rule: Omit<DataValidation, 'id' | 'ranges'>, ranges: Rect[] = this.d.sel.ranges.map((r) => normRect(r))): void {
    this.d.commitIfEditing();
    this.d.run('Validación de datos', () =>
      this.wb.editObjects(this.id, (s) => {
        s.validations = this.withoutCells(s.validations, ranges);
        if (rule.type !== 'any' || rule.inputMessage || rule.showInput) s.validations.push({ ...newValidation(uid('dv'), ranges), ...rule, ranges });
      }),
    );
  }

  clearValidation(ranges: Rect[] = this.d.sel.ranges.map((r) => normRect(r))): void {
    this.d.run('Borrar validación de datos', () =>
      this.wb.editObjects(this.id, (s) => {
        s.validations = this.withoutCells(s.validations, ranges);
      }),
    );
  }

  /** The rules minus the cells of `cut` (a rule that loses all its cells disappears). */
  private withoutCells(rules: DataValidation[], cut: Rect[]): DataValidation[] {
    return rules.flatMap((v) => {
      let parts = v.ranges.map((r) => normRect(r));
      for (const c of cut) parts = parts.flatMap((p) => subtract(p, normRect(c)));
      return parts.length ? [{ ...v, ranges: parts }] : [];
    });
  }

  /** Check a value being typed. Returns the alert to show when it is not acceptable. */
  checkEntry(sheetId: number, row: number, col: number, value: Scalar, move: EntryAlert['move']): EntryAlert | null {
    const { ok, rule } = validateEntry(this.wb, sheetId, row, col, value);
    if (ok || !rule || !rule.showError) return null;
    const style = rule.errorStyle;
    const title = rule.errorTitle || (style === 'stop' ? 'Valor no válido' : style === 'warning' ? 'Advertencia' : 'Información');
    const message = rule.errorMessage || 'El valor que ha escrito no es válido. Otro usuario ha restringido los valores que pueden escribirse en esta celda.';
    return { rule, title, message, style, move };
  }

  /** The user's answer to a validation alert: keep editing, accept the value, or drop the edit. Returns an error text to show. */
  resolveAlert(action: 'retry' | 'accept' | 'cancel'): string | null {
    const a = this.alert;
    this.alert = null;
    if (!a) return null;
    if (action === 'accept') return this.d.commitEdit(a.move, { force: true });
    if (action === 'cancel') this.d.cancelEdit();
    this.d.touch();
    return null;
  }

  /** Write an item picked from a drop-down list into the active cell. */
  chooseListValue(text: string): string | null {
    this.d.beginEdit({ text, mode: 'enter' });
    return this.d.commitEdit('none', { force: true });
  }

  invalid(): { row: number; col: number }[] {
    return invalidCells(this.wb, this.id);
  }

  toggleCircleInvalid(): void {
    this.circleInvalid = !this.circleInvalid;
    this.d.touch();
  }

  // ------------------------------------------------------------------------------------------------ hyperlinks
  hyperlinkAtActive(): Hyperlink | undefined {
    const { row, col } = this.d.sel.active;
    return hyperlinkAt(this.sheet, row, col);
  }

  /** Make the selected cell a link. `text` replaces the cell's text when given. */
  setHyperlink(link: { url?: string; location?: string; tooltip?: string; text?: string }, rect: Rect = normRect(this.d.activeRange)): void {
    this.d.commitIfEditing();
    this.d.run('Insertar hipervínculo', () => {
      const patches = [];
      const anchor = { row: rect.r1, col: rect.c1 };
      if (link.text !== undefined && link.text !== '') patches.push(this.wb.setInput(this.id, anchor.row, anchor.col, link.text.startsWith('=') ? `'${link.text}` : link.text));
      else if (this.wb.getValue(this.id, anchor.row, anchor.col) === null) patches.push(this.wb.setInput(this.id, anchor.row, anchor.col, link.url ?? link.location ?? ''));
      patches.push(
        this.wb.editObjects(this.id, (s) => {
          s.hyperlinks = s.hyperlinks.filter((h) => !overlaps(normRect(h.rect), rect));
          s.hyperlinks.push({ rect, url: link.url || undefined, location: link.location || undefined, tooltip: link.tooltip || undefined });
        }),
      );
      // the cell looks like a link unless it already has its own colour
      const st = this.wb.getStyle(this.id, anchor.row, anchor.col);
      if (!st.color && !st.underline) patches.push(this.wb.formatRange(this.id, rect, { color: HYPERLINK_COLOR, underline: true }));
      return patches;
    });
  }

  removeHyperlink(rect: Rect = normRect(this.d.activeRange)): void {
    this.d.run('Quitar hipervínculo', () => {
      const patches = [
        this.wb.editObjects(this.id, (s) => {
          s.hyperlinks = s.hyperlinks.filter((h) => !overlaps(normRect(h.rect), rect));
        }),
      ];
      const st = this.wb.getStyle(this.id, rect.r1, rect.c1);
      if (st.color === HYPERLINK_COLOR && st.underline) patches.push(this.wb.formatRange(this.id, rect, { color: undefined, underline: undefined }));
      return patches;
    });
  }

  /** Follow a link: internal places are selected, external addresses go to `open` (the system's handler). Returns an error text. */
  followHyperlink(h: Hyperlink, open: (url: string) => void): string | null {
    if (h.location) {
      return this.d.goTo(h.location) ? null : `No se encontró «${h.location}».`;
    }
    if (h.url) {
      const safe = safeUrl(h.url);
      if (!safe) return 'Por seguridad solo se abren direcciones web (http, https), de correo (mailto) y de teléfono (tel).';
      open(safe);
    }
    return null;
  }

  // ------------------------------------------------------------------------------------------------ notes (comments)
  commentAtActive(): CellComment | undefined {
    const { row, col } = this.d.sel.active;
    return this.sheet.comments.find((c) => c.row === row && c.col === col);
  }

  saveComment(row: number, col: number, text: string, author: string): void {
    this.d.commitIfEditing();
    this.d.run('Nota', () =>
      this.wb.editObjects(this.id, (s) => {
        const i = s.comments.findIndex((c) => c.row === row && c.col === col);
        if (!text.trim()) {
          if (i >= 0) s.comments.splice(i, 1);
        } else if (i >= 0) s.comments[i] = { ...s.comments[i]!, text };
        else s.comments.push({ row, col, author, text });
      }),
    );
  }

  deleteComments(rect: Rect = normRect(this.d.activeRange)): void {
    this.d.run('Eliminar nota', () =>
      this.wb.editObjects(this.id, (s) => {
        s.comments = s.comments.filter((c) => !rectContains(rect, c.row, c.col));
      }),
    );
  }

  toggleCommentVisible(row: number, col: number): void {
    this.d.run('Mostrar u ocultar nota', () =>
      this.wb.editObjects(this.id, (s) => {
        const c = s.comments.find((x) => x.row === row && x.col === col);
        if (c) c.visible = !c.visible;
      }),
    );
  }

  setAllCommentsVisible(visible: boolean): void {
    this.d.run(visible ? 'Mostrar todas las notas' : 'Ocultar todas las notas', () =>
      this.wb.editObjects(this.id, (s) => {
        for (const c of s.comments) c.visible = visible;
      }),
    );
  }

  /** Move to the next (or previous) note of the sheet, in reading order. */
  goToComment(dir: 1 | -1): boolean {
    const list = [...this.sheet.comments].sort((a, b) => a.row - b.row || a.col - b.col);
    if (!list.length) return false;
    const { row, col } = this.d.sel.active;
    const here = (c: CellComment) => c.row * MAX_COLS + c.col;
    const cur = row * MAX_COLS + col;
    const next = dir > 0 ? (list.find((c) => here(c) > cur) ?? list[0]!) : ([...list].reverse().find((c) => here(c) < cur) ?? list[list.length - 1]!);
    this.d.selectCell(next.row, next.col);
    return true;
  }

  // ------------------------------------------------------------------------------------------------ pictures
  /** Put a picture on the sheet at the active cell. Sizes are in pixels; big pictures are scaled to fit. */
  insertImage(mime: string, data: Uint8Array, width: number, height: number, name: string): string {
    this.d.commitIfEditing();
    const maxW = 480;
    const scale = width > maxW ? maxW / width : 1;
    const w = Math.max(16, Math.round(width * scale));
    const h = Math.max(16, Math.round(height * scale));
    const { row, col } = this.d.sel.active;
    const img: SheetImage = { id: uid('img'), media: this.wb.addMedia(mime, data), x: colOffsetPx(this.sheet, col), y: rowOffsetPx(this.sheet, row), width: w, height: h, name };
    this.d.run('Insertar imagen', () => this.wb.editObjects(this.id, (s) => void s.images.push(img)));
    this.selectObject('image', img.id);
    return img.id;
  }

  updateImage(id: string, patch: Partial<Omit<SheetImage, 'id'>>, label = 'Modificar imagen'): void {
    this.d.run(label, () =>
      this.wb.editObjects(this.id, (s) => {
        const i = s.images.findIndex((x) => x.id === id);
        if (i >= 0) s.images[i] = { ...s.images[i]!, ...patch };
      }),
    );
  }

  deleteImage(id: string): void {
    this.d.run('Eliminar imagen', () => this.wb.editObjects(this.id, (s) => void (s.images = s.images.filter((x) => x.id !== id))));
    if (this.selectedImage === id) this.selectedImage = null;
    this.d.touch();
  }

  // ------------------------------------------------------------------------------------------------ tables
  tableAtActive(): { sheet: Sheet; table: TableDef } | undefined {
    const { row, col } = this.d.sel.active;
    const t = tableAt(this.sheet, row, col);
    return t ? { sheet: this.sheet, table: t } : undefined;
  }

  /** Make a table of the selection (or of the data block around the cursor). */
  createTable(hasHeader: boolean, rect?: Rect): string | null {
    this.d.commitIfEditing();
    const r = rect ?? this.defaultBlock();
    if (!r) return 'Selecciona las celdas que quieres convertir en tabla.';
    const id = uid('tbl');
    let error: string | null = null;
    this.d.run('Crear tabla', () => {
      try {
        return this.wb.createTable(this.id, r, { id, header: hasHeader });
      } catch (e) {
        error = (e as Error).message;
        return [];
      }
    });
    if (!error) this.d.selectCell(r.r1, r.c1);
    return error;
  }

  /** The selection, or the block of data around the active cell when only one cell is selected. */
  defaultBlock(): Rect | null {
    const r = normRect(this.d.activeRange);
    if (r.r1 !== r.r2 || r.c1 !== r.c2) return r;
    return this.d.usedBlock();
  }

  editTable(id: string, label: string, fn: (t: TableDef) => void): void {
    this.d.run(label, () =>
      this.wb.editObjects(
        this.id,
        (s) => {
          const t = s.tables.find((x) => x.id === id);
          if (t) fn(t);
        },
        false,
      ),
    );
  }

  setTableTotals(id: string, on: boolean): void {
    this.d.run('Fila de totales', () => this.wb.setTableTotals(this.id, id, on));
  }

  setTableColumnTotal(id: string, index: number, total: NonNullable<TableDef['columns'][number]['total']>): void {
    this.d.run('Función de totales', () => this.wb.setTableColumnTotal(this.id, id, index, total));
  }

  renameTable(id: string, name: string): string | null {
    if (!validTableName(name)) return 'El nombre de la tabla no es válido: use letras, números, guiones bajos y puntos, sin espacios.';
    let error: string | null = null;
    this.d.run('Cambiar nombre de tabla', () => {
      try {
        return this.wb.renameTable(this.id, id, name);
      } catch (e) {
        error = (e as Error).message;
        return [];
      }
    });
    return error;
  }

  resizeTable(id: string, rect: Rect): string | null {
    let error: string | null = null;
    this.d.run('Cambiar tamaño de la tabla', () => {
      try {
        return this.wb.resizeTable(this.id, id, rect);
      } catch (e) {
        error = (e as Error).message;
        return [];
      }
    });
    return error;
  }

  convertTableToRange(id: string): void {
    this.d.run('Convertir en rango', () => this.wb.removeTable(this.id, id));
  }

  /**
   * Called with a typed entry: a cell just under a table (or beside its header) makes the table grow, and a formula typed in a
   * column that has none turns it into a calculated column. Returns the patches to put in the same undo step.
   */
  afterEntry(sheetId: number, row: number, col: number, text: string): ReturnType<Workbook['resizeTable']>[] {
    const sheet = this.wb.sheet(sheetId);
    const patches: ReturnType<Workbook['resizeTable']>[] = [];
    if (!sheet.tables.length) return patches;
    const v = this.wb.getValue(sheetId, row, col);
    const hasValue = v !== null || text.trim() !== '';
    for (const t of sheet.tables) {
      const r = normRect(t.ref);
      const below = !t.totals && row === r.r2 + 1 && col >= r.c1 && col <= r.c2 && hasValue;
      const right = t.header && col === r.c2 + 1 && row === r.r1 && hasValue && typeof v === 'string';
      if (below) {
        // the whole row below must be otherwise empty, as in Excel
        patches.push(this.wb.resizeTable(sheetId, t.id, { ...r, r2: r.r2 + 1 }));
      } else if (right) {
        patches.push(this.wb.resizeTable(sheetId, t.id, { ...r, c2: r.c2 + 1 }));
      }
    }
    const t = tableAt(this.wb.sheet(sheetId), row, col);
    if (t && text.startsWith('=')) {
      const parts = tableParts(t);
      const idx = col - parts.all.c1;
      if (row >= parts.data.r1 && row <= parts.data.r2 && t.columns[idx] && !t.columns[idx]!.calc) {
        let othersEmpty = true;
        for (let rr = parts.data.r1; rr <= parts.data.r2; rr++) if (rr !== row && this.wb.getCell(sheetId, rr, col)?.value != null) othersEmpty = false;
        const cell = this.wb.getCell(sheetId, row, col);
        if (othersEmpty && cell?.formula && parts.data.r2 > parts.data.r1) patches.push(this.wb.setCalculatedColumn(sheetId, t.id, idx, cell.formula.text, row));
      }
    }
    return patches;
  }

  // ------------------------------------------------------------------------------------------------ sparklines
  /**
   * Put a sparkline in each cell of `location`, drawing the matching row (or column) of `data`.
   * Returns an error text when the shapes do not fit.
   */
  insertSparklines(type: SparklineType, data: Rect, location: Rect): string | null {
    const dr = normRect(data);
    const lr = normRect(location);
    const nLoc = (lr.r2 - lr.r1 + 1) * (lr.c2 - lr.c1 + 1);
    const dRows = dr.r2 - dr.r1 + 1;
    const dCols = dr.c2 - dr.c1 + 1;
    const sheetName = this.sheet.name;
    const q = /^[A-Za-z_][\w.]*$/.test(sheetName) ? sheetName : `'${sheetName.replace(/'/g, "''")}'`;
    const items: SparklineGroup['items'] = [];
    const cells: { row: number; col: number }[] = [];
    for (let r = lr.r1; r <= lr.r2; r++) for (let c = lr.c1; c <= lr.c2; c++) cells.push({ row: r, col: c });
    const abs = (x: Rect) => `${q}!${formatA1(x.r1, x.c1, true, true)}${x.r1 === x.r2 && x.c1 === x.c2 ? '' : ':' + formatA1(x.r2, x.c2, true, true)}`;
    if (nLoc === 1) {
      items.push({ ...cells[0]!, source: abs(dr) });
    } else if (nLoc === dRows && dCols >= 1) {
      cells.forEach((c, i) => items.push({ ...c, source: abs({ r1: dr.r1 + i, r2: dr.r1 + i, c1: dr.c1, c2: dr.c2 }) }));
    } else if (nLoc === dCols && dRows >= 1) {
      cells.forEach((c, i) => items.push({ ...c, source: abs({ c1: dr.c1 + i, c2: dr.c1 + i, r1: dr.r1, r2: dr.r2 }) }));
    } else return 'El número de celdas del rango de ubicación no coincide con el de filas o columnas de los datos.';
    this.d.run('Insertar minigráficos', () =>
      this.wb.editObjects(this.id, (s) => {
        // a cell shows one sparkline: replace those already there
        for (const g of s.sparklines) g.items = g.items.filter((i) => !items.some((n) => n.row === i.row && n.col === i.col));
        s.sparklines = s.sparklines.filter((g) => g.items.length);
        s.sparklines.push({ ...newSparklineGroup(uid('sp'), type), items });
      }),
    );
    return null;
  }

  editSparklineGroup(id: string, patch: Partial<SparklineGroup>): void {
    this.d.run('Formato de minigráficos', () =>
      this.wb.editObjects(this.id, (s) => {
        const g = s.sparklines.find((x) => x.id === id);
        if (g) Object.assign(g, patch);
      }),
    );
  }

  clearSparklines(rect: Rect = normRect(this.d.activeRange), wholeGroup = false): void {
    this.d.run('Borrar minigráficos', () =>
      this.wb.editObjects(this.id, (s) => {
        const hit = (i: { row: number; col: number }) => rectContains(rect, i.row, i.col);
        const groupsHit = new Set(s.sparklines.filter((g) => g.items.some(hit)).map((g) => g.id));
        for (const g of s.sparklines) g.items = wholeGroup && groupsHit.has(g.id) ? [] : g.items.filter((i) => !hit(i));
        s.sparklines = s.sparklines.filter((g) => g.items.length);
      }),
    );
  }

  // ------------------------------------------------------------------------------------------------ names
  /** Define a name; `sheetScope` makes it local to the active sheet. */
  defineName(name: string, text: string, sheetScope: boolean): string | null {
    if (!/^[A-Za-z_À-￿][\w.À-￿]*$/.test(name) || parseA1(name)) return 'El nombre no es válido.';
    try {
      parseFormula(text.replace(/^=/, ''));
    } catch {
      return 'La fórmula del nombre no es válida.';
    }
    this.wb.defineName(name, text, sheetScope ? this.id : undefined);
    this.d.dirty = true;
    this.d.touch();
    return null;
  }

  removeName(name: string, scope: 'sheet' | 'workbook'): void {
    this.wb.removeName(name, scope === 'sheet' ? this.id : undefined);
    this.d.dirty = true;
    this.d.touch();
  }

  // ------------------------------------------------------------------------------------------------ printing
  setPrintArea(add = false): void {
    const areas = this.d.sel.ranges.map((r) => normRect(r));
    this.d.run('Establecer área de impresión', () =>
      this.wb.editObjects(this.id, (s) => {
        s.print.areas = add ? [...s.print.areas, ...areas] : areas;
      }),
    );
  }

  clearPrintArea(): void {
    this.d.run('Borrar área de impresión', () => this.wb.editObjects(this.id, (s) => void (s.print.areas = [])));
  }

  setPrintTitles(rows: { r1: number; r2: number } | undefined, cols: { c1: number; c2: number } | undefined): void {
    this.d.run('Títulos de impresión', () =>
      this.wb.editObjects(this.id, (s) => {
        s.print.titleRows = rows;
        s.print.titleCols = cols;
      }),
    );
  }

  setPage(patch: Partial<PageSetup>, label = 'Configurar página'): void {
    this.d.run(label, () =>
      this.wb.editObjects(this.id, (s) => {
        s.print.page = { ...s.print.page, ...patch };
      }),
    );
  }

  /** Insert a manual page break above/left of the active cell (or remove the one there). */
  togglePageBreaks(): void {
    const { row, col } = this.d.sel.active;
    this.d.run('Salto de página', () =>
      this.wb.editObjects(this.id, (s) => {
        const toggle = (list: number[], at: number) => {
          const i = list.indexOf(at - 1);
          if (i >= 0) list.splice(i, 1);
          else if (at > 0) list.push(at - 1);
        };
        // a break goes between index-1 and index: stored as the last row/column before the break
        if (row > 0) toggle(s.print.rowBreaks, row);
        if (col > 0) toggle(s.print.colBreaks, col);
      }),
    );
  }

  clearPageBreaks(): void {
    this.d.run('Restablecer saltos de página', () =>
      this.wb.editObjects(this.id, (s) => {
        s.print.rowBreaks = [];
        s.print.colBreaks = [];
      }),
    );
  }

  // ------------------------------------------------------------------------------------------------ pivot tables
  pivotAtActive(): { sheet: Sheet; pivot: PivotDef } | undefined {
    const { row, col } = this.d.sel.active;
    const p = this.wb.pivotAt(this.id, row, col);
    return p ? { sheet: this.sheet, pivot: p } : undefined;
  }

  pivotById(id: string | null): { sheet: Sheet; pivot: PivotDef } | undefined {
    return id ? this.wb.pivotById(id) : undefined;
  }

  /** Create an empty pivot table at a cell of a sheet. Returns an error text, or the id on success. */
  createPivot(source: PivotDef['source'], destSheetId: number, row: number, col: number): { error?: string; id?: string } {
    this.d.commitIfEditing();
    const taken = new Set(this.wb.sheets.flatMap((s) => s.pivots.map((p) => p.name.toLowerCase())));
    let n = 1;
    while (taken.has(`tabladinámica${n}`) || taken.has(`pivottable${n}`)) n++;
    const name = this.d.locale === 'en' ? `PivotTable${n}` : `TablaDinámica${n}`;
    const def = newPivot(uid('pv'), name, source, row, col);
    // fail early if the source does not exist
    if (!this.wb.pivotData(def)) return { error: 'No se encuentra el origen de datos.' };
    let error: string | undefined;
    const prev = this.d.activeSheetId;
    this.d.run('Crear tabla dinámica', () => {
      try {
        return this.wb.addPivot(destSheetId, def, this.pivotLabels);
      } catch (e) {
        error = (e as Error).message;
        return [];
      }
    });
    if (error) return { error };
    if (destSheetId !== prev) this.d.activateSheet(destSheetId);
    this.d.selectCell(row, col);
    this.pivotPane = def.id;
    this.d.touch();
    return { id: def.id };
  }

  updatePivot(id: string, label: string, fn: (p: PivotDef) => void): string | null {
    const found = this.wb.pivotById(id);
    if (!found) return 'La tabla dinámica ya no existe.';
    let error: string | null = null;
    this.d.run(label, () => {
      try {
        return this.wb.updatePivot(found.sheet.id, id, fn, this.pivotLabels);
      } catch (e) {
        error = (e as Error).message;
        return [];
      }
    });
    return error;
  }

  refreshPivot(id: string): string | null {
    const found = this.wb.pivotById(id);
    if (!found) return 'La tabla dinámica ya no existe.';
    let error: string | null = null;
    this.d.run('Actualizar tabla dinámica', () => {
      try {
        return this.wb.renderPivot(found.sheet.id, id, this.pivotLabels);
      } catch (e) {
        error = (e as Error).message;
        return [];
      }
    });
    return error;
  }

  refreshAllPivots(): string | null {
    let error: string | null = null;
    this.d.run('Actualizar todo', () => {
      const patches = [];
      for (const s of this.wb.sheets) {
        for (const p of s.pivots) {
          try {
            patches.push(this.wb.renderPivot(s.id, p.id, this.pivotLabels));
          } catch (e) {
            error = (e as Error).message;
          }
        }
      }
      return patches;
    });
    return error;
  }

  deletePivot(id: string): void {
    const found = this.wb.pivotById(id);
    if (!found) return;
    this.d.run('Eliminar tabla dinámica', () => this.wb.removePivot(found.sheet.id, id, true));
    if (this.pivotPane === id) this.pivotPane = null;
    this.d.touch();
  }

  // ------------------------------------------------------------------------------------------------ slicers
  insertSlicer(target: SlicerDef['target'], field: string): string {
    const sheet = this.sheet;
    const existing = sheet.slicers.length;
    let { row, col } = this.d.sel.active;
    // next to the report it filters, not on top of it
    const home = target.kind === 'pivot' ? this.wb.pivotById(target.id) : undefined;
    if (home && home.sheet.id === this.id) {
      row = home.pivot.row;
      col = home.pivot.col + (home.pivot.size?.cols ?? 3) + 1;
    }
    const sl: SlicerDef = {
      id: uid('sl'),
      name: `${field}${existing ? ` ${existing + 1}` : ''}`,
      caption: field,
      target,
      field,
      selected: null,
      x: colOffsetPx(sheet, col) + existing * 24,
      y: rowOffsetPx(sheet, row) + existing * 24,
      width: 180,
      height: 220,
      columns: 1,
    };
    this.d.run('Insertar segmentación', () => this.wb.editObjects(this.id, (s) => void s.slicers.push(sl)));
    this.selectObject('slicer', sl.id);
    return sl.id;
  }

  setSlicer(id: string, selected: string[] | null): void {
    this.d.run('Segmentación', () => this.wb.setSlicerSelection(this.id, id, selected));
  }

  updateSlicer(id: string, patch: Partial<Omit<SlicerDef, 'id'>>, label = 'Modificar segmentación'): void {
    this.d.run(label, () =>
      this.wb.editObjects(this.id, (s) => {
        const i = s.slicers.findIndex((x) => x.id === id);
        if (i >= 0) s.slicers[i] = { ...s.slicers[i]!, ...patch };
      }),
    );
  }

  deleteSlicer(id: string): void {
    this.d.run('Eliminar segmentación', () => this.wb.editObjects(this.id, (s) => void (s.slicers = s.slicers.filter((x) => x.id !== id))));
    if (this.selectedSlicer === id) this.selectedSlicer = null;
    this.d.touch();
  }

  /** The calculated formula text of a column for the first data row, shifted to another row (used by the UI for previews). */
  shiftedCalc(formula: string, byRows: number): string {
    return printFormula(shiftRefs(parseFormula(formula), byRows, 0));
  }
}

// ---------------------------------------------------------------------------------------------------- helpers
export function overlaps(a: Rect, b: Rect): boolean {
  return a.r1 <= b.r2 && a.r2 >= b.r1 && a.c1 <= b.c2 && a.c2 >= b.c1;
}

/** `r` minus `cut`, as up to four rectangles. */
export function subtract(r: Rect, cut: Rect): Rect[] {
  if (!overlaps(r, cut)) return [r];
  const out: Rect[] = [];
  if (cut.r1 > r.r1) out.push({ ...r, r2: cut.r1 - 1 });
  if (cut.r2 < r.r2) out.push({ ...r, r1: cut.r2 + 1 });
  const r1 = Math.max(r.r1, cut.r1);
  const r2 = Math.min(r.r2, cut.r2);
  if (cut.c1 > r.c1) out.push({ r1, r2, c1: r.c1, c2: cut.c1 - 1 });
  if (cut.c2 < r.c2) out.push({ r1, r2, c1: cut.c2 + 1, c2: r.c2 });
  return out;
}

