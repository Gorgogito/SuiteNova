import { BaseDb, applyFieldKinds, basic, encryptDb, type CompactReport, type AggFn, type ColumnFilter, type SortKey, defaultFormLayout, defaultLabelLayout, defaultReportLayout, loadSql, recordObject, subformData, newColumn, newDesign, type ColumnDef, type DataSet, type FormLayout, type Handler, type ReportControl, type Row, type QueryDesign, type QueryResult, type ReportDef, type Value } from '@suitenova/base-core';
import { BaseRuntime, type ModuleDef } from './runtime';

type MacroDef = basic.MacroDef;

/** Most records a report lays out. */
export const REPORT_MAX_ROWS = 50_000;

export type TabKind = 'table' | 'design' | 'query' | 'form' | 'report' | 'relations' | 'macro' | 'module';
/** Objects of the database that have a name (everything but the relationships window). */
export type ObjKind = 'table' | 'query' | 'form' | 'report' | 'macro' | 'module';

export interface Tab {
  id: string;
  kind: TabKind;
  /** Table, query, form or report name (a draft name while the object is new). */
  name: string;
  /** The object has not been saved yet. */
  isNew?: boolean;
}

export interface QueryState {
  mode: 'sql' | 'design';
  sql: string;
  design: QueryDesign;
  saved: boolean;
  /** Answers to the [parameters] of the query, by bind name. */
  values?: Record<string, string>;
}

export interface FormDef {
  table: string;
  fields: string[] | null;
  /** Free layout made in the form designer. Forms without one show their fields in a column. */
  layout?: FormLayout;
}

/** What macros and procedures can do with an open form. */
export interface FormHandle {
  name: string;
  table: string;
  get(field: string): Value;
  set(field: string, v: Value): void;
  goto(where: 'first' | 'last' | 'next' | 'previous' | 'new'): void;
  requery(): void;
  /** The fields of the current record (macro expressions read them). */
  record?(): Record<string, Value>;
}

/** Layout, sort and filter of a datasheet. It is saved in the file with the table (as Access does). */
export interface SheetState {
  sorts: SortKey[];
  filters: ColumnFilter[];
  /** the filters are applied (the filter can be switched off without losing it) */
  filterOn: boolean;
  hidden: string[];
  /** how many columns stay in place while the rest scrolls */
  frozen: number;
  widths: Record<string, number>;
  totals: Record<string, AggFn>;
  showTotals: boolean;
  fontSize: number;
  zebra: boolean;
  gridlines: boolean;
  rowHeight: number;
}
export const DEFAULT_SHEET: SheetState = { sorts: [], filters: [], filterOn: true, hidden: [], frozen: 0, widths: {}, totals: {}, showTotals: false, fontSize: 13, zebra: false, gridlines: true, rowHeight: 26 };

/** What the open datasheet offers to the ribbon (it lives in the component, which publishes it here). */
export interface SheetApi {
  tabId: string;
  table: string;
  rowCount: number;
  /** the column of the active cell */
  activeCol: string | null;
  activeRow: number | null;
  selectedRows: number[];
  newRecord(): void;
  deleteSelected(): void;
  copy(cut?: boolean): Promise<void>;
  paste(): Promise<void>;
  goto(where: 'first' | 'previous' | 'next' | 'last' | 'new'): void;
  /** value of the active cell as text */
  activeValue(): string | null;
  refresh(): void;
}

export interface SheetDialog {
  kind: 'find' | 'replace' | 'filter' | 'columns' | 'width' | 'rowHeight';
  col?: string;
}

/** Dialogs for importing, exporting, copying tables and documenting the database. */
export interface ExchangeDialog {
  kind: 'import' | 'export' | 'copyTable' | 'document' | 'wizDups' | 'wizUnmatched' | 'wizForm' | 'files' | 'compact' | 'password';
  arg?: { start?: 'file' | 'paste'; format?: 'xlsx' | 'csv' | 'tsv' | 'json' | 'xml' | 'html' | 'sql'; table?: string; report?: CompactReport };
}

export class BaseCtl {
  db: BaseDb | null = null;
  xDialog: ExchangeDialog | null = null;
  loading = true;
  error: string | null = null;
  fileName: string | null = null;
  filePath: string | null = null;
  /** The password the file is saved with (null: not encrypted). Kept only while the database is open. */
  password: string | null = null;
  dirty = false;
  /** How the navigation pane lists the objects: by type, or in the groups the user made. */
  navView: 'type' | 'groups' = 'type';
  tabs: Tab[] = [];
  active: string | null = null;
  navFilter = '';
  /** Layout, sort and filter of each open datasheet, by tab id. */
  sheets = new Map<string, SheetState>();
  sheetApi: SheetApi | null = null;
  sheetDialog: SheetDialog | null = null;
  /** Per-tab state kept while a tab is open. */
  queries = new Map<string, QueryState>();
  /** Last result of each open query tab (for export). */
  results = new Map<string, QueryResult>();
  drafts = new Map<string, ColumnDef[]>();
  forms = new Map<string, FormDef>();
  /** The forms that are open in form view, by name. */
  formHandles = new Map<string, FormHandle>();
  reports = new Map<string, ReportDef>();
  macros = new Map<string, MacroDef>();
  /** Forms opened with a WHERE condition (OpenForm), by tab id. */
  formFilters = new Map<string, string>();
  /** Macros and modules: runs them, keeps the Debug.Print output. */
  runtime = new BaseRuntime(this);
  /**
   * Macros, code and form events run only when the user allows it: a file that carries them opens with them off
   * (like the protected view of Office), a new database starts with them on.
   */
  contentEnabled = true;
  /** Last message about an undo/redo, shown in the status bar. */
  notice = '';
  /** Bumped when the database is replaced by an undo, so open designers reload. */
  epoch = 0;
  private keepNotice = false;
  private version = 0;
  private listeners = new Set<() => void>();
  private seq = 0;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = (): number => this.version;
  touch(): void {
    if (this.db?.dirty) this.dirty = true;
    if (this.keepNotice) this.keepNotice = false;
    else this.notice = '';
    this.version++;
    this.listeners.forEach((l) => l());
  }

  get docTitle(): string {
    return (this.fileName ?? 'Base de datos1') + (this.dirty ? ' •' : '');
  }
  get tab(): Tab | null {
    return this.tabs.find((t) => t.id === this.active) ?? null;
  }

  // ---------- lifecycle ----------

  async init(locateFile?: (f: string) => string): Promise<void> {
    try {
      const SQL = await loadSql(locateFile);
      this.db = BaseDb.open(SQL);
      this.runtime.attach();
      this.error = null;
    } catch (e) {
      this.error = `No se pudo iniciar el motor de bases de datos: ${(e as Error).message}`;
    }
    this.loading = false;
    this.touch();
  }

  private reset(db: BaseDb, name: string | null, path: string | null): void {
    this.db?.close();
    this.db = db;
    this.runtime.attach();
    this.fileName = name;
    this.filePath = path;
    this.password = null;
    this.tabs = [];
    this.active = null;
    this.queries.clear();
    this.drafts.clear();
    this.forms.clear();
    this.reports.clear();
    this.macros.clear();
    this.formFilters.clear();
    this.formHandles.clear();
    this.runtime.reset();
    this.contentEnabled = true;
    this.dirty = false;
    db.dirty = false;
    this.touch();
  }

  newDb(): void {
    this.reset(BaseDb.open(this.db!.SQL), null, null);
  }

  openBytes(bytes: Uint8Array, name: string, path: string | null): void {
    this.reset(BaseDb.open(this.db!.SQL, bytes), name, path);
    // a file with macros, modules or events starts with them switched off
    this.contentEnabled = !this.hasActiveContent();
    if (!this.contentEnabled) this.touch();
  }

  /** Does the database carry macros, modules or form events? */
  hasActiveContent(): boolean {
    const db = this.db!;
    if (db.objects('macro').length || db.objects('module').length) return true;
    // data macros of a table
    if (db.objects('tableprops').some((t) => Object.keys(db.getMeta(t).dataMacros ?? {}).length)) return true;
    // anything a form is bound to: events, shortcuts, button handlers, controls events (saved macro, procedure or embedded macro)
    return db.objects('form').some((n) => {
      const l = db.getObject<FormDef>('form', n)?.layout;
      return !!l && /"kind":"(macro|proc|embedded)"/.test(JSON.stringify(l));
    });
  }

  enableContent(): void {
    this.contentEnabled = true;
    this.touch();
  }

  /** The file to save: the database, encrypted when it has a password. */
  async exportFile(): Promise<Uint8Array> {
    const bytes = this.db!.export();
    return this.password ? encryptDb(bytes, this.password) : bytes;
  }

  /** Choose (or remove) the password of the file; it is saved with it the next time. */
  setPassword(password: string | null): void {
    this.password = password;
    this.dirty = true;
    if (this.db) this.db.dirty = true;
    this.touch();
  }

  // ---------- groups of the navigation pane ----------

  navGroups(): { name: string; items: { kind: ObjKind; name: string }[] }[] {
    return this.db?.getObject<{ groups: { name: string; items: { kind: ObjKind; name: string }[] }[] }>('navgroups', 'groups')?.groups ?? [];
  }
  private saveNavGroups(groups: { name: string; items: { kind: ObjKind; name: string }[] }[]): void {
    if (groups.length) this.db!.saveObject('navgroups', 'groups', { groups });
    else this.db!.deleteObject('navgroups', 'groups');
    this.touch();
  }
  addNavGroup(name: string): void {
    const n = name.trim();
    if (!n) throw new Error('El grupo necesita un nombre.');
    const groups = this.navGroups();
    if (groups.some((g) => g.name.toLowerCase() === n.toLowerCase())) throw new Error(`Ya existe un grupo llamado "${n}".`);
    this.saveNavGroups([...groups, { name: n, items: [] }]);
  }
  removeNavGroup(name: string): void {
    this.saveNavGroups(this.navGroups().filter((g) => g.name !== name));
  }
  /** Put an object in a group (an object can be in several). */
  addToNavGroup(group: string, item: { kind: ObjKind; name: string }): void {
    this.saveNavGroups(this.navGroups().map((g) => (g.name === group && !g.items.some((x) => x.kind === item.kind && x.name === item.name) ? { ...g, items: [...g.items, item] } : g)));
  }
  removeFromNavGroup(group: string, item: { kind: ObjKind; name: string }): void {
    this.saveNavGroups(this.navGroups().map((g) => (g.name === group ? { ...g, items: g.items.filter((x) => !(x.kind === item.kind && x.name === item.name)) } : g)));
  }

  markSaved(name: string, path: string | null): void {
    this.fileName = name;
    this.filePath = path;
    this.dirty = false;
    if (this.db) this.db.dirty = false;
    this.touch();
  }

  // ---------- tabs ----------

  private id(kind: string, name: string): string {
    return `${kind}:${name}`;
  }

  private open(tab: Tab): void {
    if (!this.tabs.some((t) => t.id === tab.id)) this.tabs = [...this.tabs, tab];
    this.active = tab.id;
    this.touch();
  }

  activate(id: string): void {
    this.active = id;
    this.touch();
  }

  close(id: string): void {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    this.tabs = this.tabs.filter((t) => t.id !== id);
    this.queries.delete(id);
    this.sheets.delete(id);
    this.results.delete(id);
    this.drafts.delete(id);
    this.forms.delete(id);
    this.reports.delete(id);
    this.macros.delete(id);
    this.formFilters.delete(id);
    if (this.active === id) this.active = this.tabs[Math.min(i, this.tabs.length - 1)]?.id ?? null;
    this.touch();
  }

  /** The state of the datasheet of a tab (read from the file the first time). */
  sheetOf(tab: Tab): SheetState {
    let s = this.sheets.get(tab.id);
    if (!s) {
      const saved = tab.kind === 'table' && this.db ? this.db.getObject<Partial<SheetState>>('sheet', tab.name) : null;
      s = { ...DEFAULT_SHEET, ...(saved ?? {}) };
      this.sheets.set(tab.id, s);
    }
    return s;
  }
  /** Changes the datasheet of a tab and saves its layout in the file. */
  setSheet(tab: Tab, patch: Partial<SheetState>): void {
    const next = { ...this.sheetOf(tab), ...patch };
    this.sheets.set(tab.id, next);
    if (tab.kind === 'table' && this.db) {
      const same = JSON.stringify(next) === JSON.stringify(DEFAULT_SHEET);
      if (same) this.db.deleteObject('sheet', tab.name);
      else this.db.saveObject('sheet', tab.name, next);
    }
    this.touch();
  }

  openTable(name: string): void {
    this.open({ id: this.id('table', name), kind: 'table', name });
  }

  openDesign(name: string): void {
    const id = this.id('design', name);
    this.drafts.set(id, this.db!.columns(name));
    this.open({ id, kind: 'design', name });
  }

  newTable(): void {
    const name = this.freeName('Tabla', this.db!.tableNames());
    const id = this.id('design', name);
    this.drafts.set(id, [{ ...newColumn('Id', 'INTEGER'), primaryKey: true, autoIncrement: true }, newColumn('Campo1', 'TEXT')]);
    this.open({ id, kind: 'design', name, isNew: true });
  }

  freeName(base: string, existing: string[]): string {
    const taken = new Set(existing.map((s) => s.toLowerCase()));
    for (let i = 1; ; i++) if (!taken.has(`${base}${i}`.toLowerCase())) return `${base}${i}`;
  }

  openQuery(name: string): void {
    const id = this.id('query', name);
    if (!this.queries.has(id)) {
      const def = this.db!.getObject<{ mode: 'sql' | 'design'; sql: string; design: QueryDesign }>('query', name);
      this.queries.set(id, { mode: def?.mode ?? 'sql', sql: def?.sql ?? '', design: def?.design ?? newDesign(), saved: true });
    }
    this.open({ id, kind: 'query', name });
  }

  newQuery(sql = ''): void {
    const name = this.freeName('Consulta', this.db!.objects('query'));
    const id = this.id('query', name + `#${++this.seq}`);
    this.queries.set(id, { mode: 'sql', sql, design: newDesign(), saved: false });
    this.open({ id, kind: 'query', name, isNew: true });
  }

  /** A new query that starts in design view. */
  newDesignQuery(): void {
    const name = this.freeName('Consulta', this.db!.objects('query'));
    const id = this.id('query', name + `#${++this.seq}`);
    this.queries.set(id, { mode: 'design', sql: '', design: newDesign(), saved: false });
    this.open({ id, kind: 'query', name, isNew: true });
  }

  openRelations(): void {
    this.open({ id: 'relations:', kind: 'relations', name: 'Relaciones' });
  }

  saveQuery(tabId: string, name: string): void {
    const q = this.queries.get(tabId);
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!q || !tab) return;
    const n = name.trim();
    if (!n) throw new Error('El nombre no puede estar vacío.');
    if (n !== tab.name && this.db!.objects('query').some((x) => x.toLowerCase() === n.toLowerCase())) throw new Error(`Ya existe una consulta llamada "${n}".`);
    if (!tab.isNew && n !== tab.name) this.db!.renameObject('query', tab.name, n);
    this.db!.saveObject('query', n, { mode: q.mode, sql: q.sql, design: q.design });
    q.saved = true;
    const newId = this.id('query', n);
    this.queries.delete(tabId);
    this.queries.set(newId, q);
    this.tabs = this.tabs.map((t) => (t.id === tabId ? { id: newId, kind: 'query', name: n } : t));
    if (this.active === tabId) this.active = newId;
    this.touch();
  }

  openForm(name: string): void {
    const id = this.id('form', name);
    if (!this.forms.has(id)) {
      const def = this.db!.getObject<FormDef>('form', name);
      if (!def) return;
      this.forms.set(id, def);
    }
    this.open({ id, kind: 'form', name });
  }

  newForm(table: string): void {
    const name = this.freeName('Formulario', this.db!.objects('form'));
    const def: FormDef = { table, fields: null, layout: applyFieldKinds(defaultFormLayout(this.db!.columns(table), this.db!), this.db!.getMeta(table).fields) };
    this.db!.saveObject('form', name, def);
    this.forms.set(this.id('form', name), def);
    this.open({ id: this.id('form', name), kind: 'form', name });
  }

  /** A form built by the wizard (or any ready layout) on a table. */
  newFormWith(table: string, layout: FormLayout): void {
    const name = this.freeName('Formulario', this.db!.objects('form'));
    const def: FormDef = { table, fields: null, layout };
    this.db!.saveObject('form', name, def);
    this.forms.set(this.id('form', name), def);
    this.open({ id: this.id('form', name), kind: 'form', name });
  }

  saveForm(id: string, def: FormDef): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    this.forms.set(id, def);
    this.db!.saveObject('form', tab.name, def);
    this.touch();
  }

  openReport(name: string): void {
    const id = this.id('report', name);
    if (!this.reports.has(id)) {
      const def = this.db!.getObject<ReportDef>('report', name);
      if (!def) return;
      this.reports.set(id, def);
    }
    this.open({ id, kind: 'report', name });
  }

  newReport(def: ReportDef): void {
    const name = this.freeName('Informe', this.db!.objects('report'));
    this.db!.saveObject('report', name, def);
    this.reports.set(this.id('report', name), def);
    this.open({ id: this.id('report', name), kind: 'report', name });
  }

  saveReport(id: string, def: ReportDef): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    this.reports.set(id, def);
    this.db!.saveObject('report', tab.name, def);
    this.touch();
  }

  /** SQL of a saved query (designer queries are generated), for reports and exports. */
  sqlOfQuery(name: string, depth = 0): string {
    if (depth > 12) throw new Error('Las consultas se usan unas a otras en círculo.');
    const def = this.db!.getObject<{ mode: 'sql' | 'design'; sql: string; design: QueryDesign }>('query', name);
    if (!def) throw new Error(`No existe la consulta "${name}".`);
    if (def.mode !== 'design') return def.sql;
    return this.db!.designSql(def.design, { resolveQuery: (n) => this.sqlOfQuery(n, depth + 1) }).sql;
  }

  /** The columns a saved query returns (so that another query can use it as a table). Empty when it cannot be read or needs parameters. */
  queryColumns(name: string): string[] {
    try {
      return this.db!.execute(`SELECT * FROM (${this.sqlOfQuery(name).replace(/[;\s]+$/, '')}) LIMIT 0`).columns;
    } catch {
      return [];
    }
  }

  // ---------- macros and modules ----------

  openMacro(name: string): void {
    const id = this.id('macro', name);
    if (!this.macros.has(id)) {
      const def = this.db!.getObject<MacroDef>('macro', name);
      if (!def) return;
      this.macros.set(id, def);
    }
    this.open({ id, kind: 'macro', name });
  }
  newMacro(): void {
    const name = this.freeName('Macro', this.db!.objects('macro'));
    const def: MacroDef = { steps: [] };
    this.db!.saveObject('macro', name, def);
    this.macros.set(this.id('macro', name), def);
    this.open({ id: this.id('macro', name), kind: 'macro', name });
  }
  saveMacro(id: string, def: MacroDef): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    this.macros.set(id, def);
    this.db!.saveObject('macro', tab.name, def);
    this.touch();
  }

  openModule(name: string): void {
    if (!this.db!.objects('module').includes(name)) return;
    this.open({ id: this.id('module', name), kind: 'module', name });
  }
  newModule(kind: 'module' | 'class' = 'module'): void {
    const name = this.freeName(kind === 'class' ? 'Clase' : 'Modulo', this.db!.objects('module'));
    const def: ModuleDef =
      kind === 'class'
        ? { kind: 'class', code: 'Option Explicit\n\nPrivate mNombre As String\n\nPrivate Sub Class_Initialize()\n    mNombre = "sin nombre"\nEnd Sub\n\nPublic Property Get Nombre() As String\n    Nombre = mNombre\nEnd Property\n\nPublic Property Let Nombre(valor As String)\n    mNombre = valor\nEnd Property\n\nPublic Function Saluda() As String\n    Saluda = "Hola, soy " & mNombre\nEnd Function\n' }
        : { code: 'Option Explicit\n\nSub Principal()\n    MsgBox "Hola desde Nova Base"\nEnd Sub\n' };
    this.db!.saveObject('module', name, def);
    this.open({ id: this.id('module', name), kind: 'module', name });
  }
  saveModule(name: string, code: string): void {
    const old = this.db!.getObject<ModuleDef>('module', name);
    this.db!.saveObject('module', name, { code, ...(old?.kind ? { kind: old.kind } : {}) } satisfies ModuleDef);
    this.touch();
  }

  /** Names of the procedures that can be bound to an event (Subs without required arguments). */
  procedureNames(): string[] {
    if (!this.db) return [];
    try {
      return this.runtime
        .procedures()
        .filter((p) => p.kind === 'sub' && p.params.every((x) => x.optional || x.paramArray))
        .map((p) => p.name);
    } catch {
      return [];
    }
  }

  /** Run a macro or a procedure: what an event of a form is bound to. */
  async runHandler(h: Handler, ctx: { form?: string } = {}): Promise<{ error?: string; cancel?: boolean }> {
    if (!this.contentEnabled) return { error: 'El contenido activo (macros, código y eventos) está deshabilitado. Use "Habilitar contenido" en la barra amarilla.' };
    const r = this.runtime.run(h, ctx.form);
    return r.ok ? (r.cancel ? { cancel: true } : {}) : { error: r.error };
  }

  setFormFilter(name: string, where: string): void {
    this.formFilters.set(this.id('form', name), where);
  }

  /** Close open tabs by kind and name. With no name: the active tab. */
  closeObject(kind: 'form' | 'report' | 'table' | 'query' | 'any', name?: string): void {
    const hit = this.tabs.filter((t) => {
      if (kind !== 'any' && !(t.kind === kind || (kind === 'table' && t.kind === 'design'))) return false;
      return name ? t.name.toLowerCase() === name.toLowerCase() : t.id === this.active;
    });
    for (const t of hit) this.close(t.id);
  }

  // ---------- undo ----------

  undo(): void {
    const label = this.db?.undo();
    if (label) this.afterRestore(`Se deshizo: ${label}`);
  }
  redo(): void {
    const label = this.db?.redo();
    if (label) this.afterRestore(`Se rehízo: ${label}`);
  }

  /** The database was replaced by an earlier copy: close what no longer exists and make designers reload. */
  private afterRestore(notice: string): void {
    const db = this.db!;
    const tables = new Set(db.tableNames());
    for (const t of [...this.tabs]) {
      if ((t.kind === 'table' || t.kind === 'design') && !tables.has(t.name) && !t.isNew) this.close(t.id);
      else if (t.kind === 'form' || t.kind === 'report') {
        const def = db.getObject(t.kind, t.name);
        if (!def) this.close(t.id);
        else (t.kind === 'form' ? this.forms : this.reports).set(t.id, def as never);
      }
    }
    for (const t of this.tabs) if (t.kind === 'design' && !t.isNew) this.drafts.set(t.id, db.columns(t.name));
    this.epoch++;
    this.notice = notice;
    this.keepNotice = true;
    this.touch();
  }

  // ---------- report data ----------

  private sourceSql(def: ReportDef): string {
    return def.source.kind === 'table' ? `SELECT * FROM "${def.source.name.replace(/"/g, '""')}"` : this.sqlOfQuery(def.source.name).replace(/[;\s]+$/, '');
  }
  /** Field names of the data source of a report. */
  reportColumns(def: ReportDef): string[] {
    if (def.source.kind === 'table') return this.db!.columns(def.source.name).map((c) => c.name);
    return this.db!.execute(`SELECT * FROM (${this.sourceSql(def)}) LIMIT 0`).columns;
  }
  /** The records of the data source as objects, up to REPORT_MAX_ROWS. */
  reportDataset(def: ReportDef): { data: DataSet; truncated: boolean } {
    const r = this.db!.execute(this.sourceSql(def), REPORT_MAX_ROWS);
    return { data: { columns: r.columns, rows: r.rows.map((row) => recordObject(r.columns, row)) as Row[] }, truncated: r.truncated };
  }
  /** Rows of a subreport for one record of the main report. */
  subreportRows(c: Extract<ReportControl, { type: 'subreport' }>, parent: Row): { columns: string[]; rows: unknown[][] } {
    return subformData(this.db!, { id: c.id, name: c.name, type: 'subform', x: 0, y: 0, w: 0, h: 0, table: c.table, childField: c.childField, parentField: c.parentField, columns: c.columns }, parent);
  }

  /** A new report with a free design, from the columns of a table. */
  newReportDesign(table: string): void {
    const cols = this.db!.columns(table);
    const name = this.freeName('Informe', this.db!.objects('report'));
    const def: ReportDef = { source: { kind: 'table', name: table }, title: table, columns: cols.map((c) => c.name), groupBy: null, sums: [], landscape: false, layout: defaultReportLayout(cols.map((c) => c.name), { title: table, numeric: cols.filter((c) => /INT|REAL|NUM|FLOA|DOUB/i.test(c.type)).map((c) => c.name), decimal: cols.filter((c) => /REAL|FLOA|DOUB|NUM/i.test(c.type)).map((c) => c.name) }) };
    this.db!.saveObject('report', name, def);
    this.reports.set(this.id('report', name), def);
    this.open({ id: this.id('report', name), kind: 'report', name });
  }
  /** A new sheet of labels (the first fields of the table, one per line). */
  newLabelReport(table: string): void {
    const cols = this.db!.columns(table);
    const text = cols.filter((c) => !c.primaryKey).map((c) => c.name);
    const name = this.freeName('Etiquetas', this.db!.objects('report'));
    const def: ReportDef = { source: { kind: 'table', name: table }, title: table, columns: text, groupBy: null, sums: [], landscape: false, layout: defaultLabelLayout(text.length ? text : cols.map((c) => c.name)) };
    this.db!.saveObject('report', name, def);
    this.reports.set(this.id('report', name), def);
    this.open({ id: this.id('report', name), kind: 'report', name });
  }

  // ---------- objects ----------

  /** Rename a table, query, form or report; open tabs follow. */
  rename(kind: ObjKind, from: string, to: string): void {
    const n = to.trim();
    if (!n || n === from) return;
    if (kind === 'table') {
      const meta = this.db!.objects('tableprops').includes(from) ? this.db!.getMeta(from) : null;
      this.db!.renameTable(from, n);
      if (this.db!.objects('sheet').includes(from)) this.db!.renameObject('sheet', from, n);
      if (meta) {
        // the validation triggers carry the old name: they are made again for the new one
        this.db!.deleteObject('tableprops', from);
        this.db!.setMeta(n, meta, false);
      }
    } else this.db!.renameObject(kind, from, n);
    // the groups of the navigation pane follow the new name
    const ng = this.navGroups();
    if (ng.some((g) => g.items.some((x) => x.kind === kind && x.name === from))) this.saveNavGroups(ng.map((g) => ({ ...g, items: g.items.map((x) => (x.kind === kind && x.name === from ? { ...x, name: n } : x)) })));
    const map = (t: Tab): Tab => {
      const sameKind = t.kind === kind || (kind === 'table' && t.kind === 'design');
      return sameKind && t.name === from ? { ...t, id: t.id.replace(`:${from}`, `:${n}`), name: n } : t;
    };
    const old = this.tabs;
    this.tabs = old.map(map);
    for (const m of [this.queries, this.forms, this.reports, this.drafts, this.macros, this.formFilters, this.sheets] as Map<string, unknown>[]) {
      for (const [k, v] of [...m]) {
        if (k.endsWith(`:${from}`)) {
          m.delete(k);
          m.set(k.replace(/:[^:]*$/, `:${n}`), v);
        }
      }
    }
    if (this.active) this.active = this.tabs[old.findIndex((t) => t.id === this.active)]?.id ?? this.active;
    this.touch();
  }

  remove(kind: ObjKind, name: string): void {
    if (kind === 'table') {
      this.db!.dropTable(name);
      this.db!.deleteObject('sheet', name);
      this.db!.deleteObject('tableprops', name);
    } else this.db!.deleteObject(kind, name);
    for (const t of [...this.tabs]) if (t.name === name && (t.kind === kind || (kind === 'table' && t.kind === 'design'))) this.close(t.id);
    this.touch();
  }
}
