import { BaseDb, basic, defaultFormLayout, defaultLabelLayout, defaultReportLayout, loadSql, recordObject, subformData, newColumn, newDesign, type ColumnDef, type DataSet, type FormLayout, type Handler, type ReportControl, type Row, type QueryDesign, type QueryResult, type ReportDef, type Value } from '@suitenova/base-core';
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

export class BaseCtl {
  db: BaseDb | null = null;
  loading = true;
  error: string | null = null;
  fileName: string | null = null;
  filePath: string | null = null;
  dirty = false;
  tabs: Tab[] = [];
  active: string | null = null;
  navFilter = '';
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
    this.fileName = name;
    this.filePath = path;
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
    return db.objects('form').some((n) => {
      const l = db.getObject<FormDef>('form', n)?.layout;
      return !!l && (!!l.events?.onOpen || !!l.events?.onCurrent || l.controls.some((c) => ('handler' in c && !!c.handler) || ('afterUpdate' in c && !!c.afterUpdate)));
    });
  }

  enableContent(): void {
    this.contentEnabled = true;
    this.touch();
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
    this.results.delete(id);
    this.drafts.delete(id);
    this.forms.delete(id);
    this.reports.delete(id);
    this.macros.delete(id);
    this.formFilters.delete(id);
    if (this.active === id) this.active = this.tabs[Math.min(i, this.tabs.length - 1)]?.id ?? null;
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
    const def: FormDef = { table, fields: null, layout: defaultFormLayout(this.db!.columns(table), this.db!) };
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
  sqlOfQuery(name: string): string {
    const def = this.db!.getObject<{ mode: 'sql' | 'design'; sql: string; design: QueryDesign }>('query', name);
    if (!def) throw new Error(`No existe la consulta "${name}".`);
    if (def.mode !== 'design') return def.sql;
    return this.db!.designSql(def.design, { resolveQuery: (n) => this.sqlOfQuery(n) }).sql;
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
  newModule(): void {
    const name = this.freeName('Modulo', this.db!.objects('module'));
    const def: ModuleDef = { code: 'Option Explicit\n\nSub Principal()\n    MsgBox "Hola desde Nova Base"\nEnd Sub\n' };
    this.db!.saveObject('module', name, def);
    this.open({ id: this.id('module', name), kind: 'module', name });
  }
  saveModule(name: string, code: string): void {
    this.db!.saveObject('module', name, { code } satisfies ModuleDef);
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
  async runHandler(h: Handler, ctx: { form?: string } = {}): Promise<{ error?: string }> {
    if (!this.contentEnabled) return { error: 'El contenido activo (macros, código y eventos) está deshabilitado. Use "Habilitar contenido" en la barra amarilla.' };
    const r = this.runtime.run(h, ctx.form);
    return r.ok ? {} : { error: r.error };
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
    if (kind === 'table') this.db!.renameTable(from, n);
    else this.db!.renameObject(kind, from, n);
    const map = (t: Tab): Tab => {
      const sameKind = t.kind === kind || (kind === 'table' && t.kind === 'design');
      return sameKind && t.name === from ? { ...t, id: t.id.replace(`:${from}`, `:${n}`), name: n } : t;
    };
    const old = this.tabs;
    this.tabs = old.map(map);
    for (const m of [this.queries, this.forms, this.reports, this.drafts, this.macros, this.formFilters] as Map<string, unknown>[]) {
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
    if (kind === 'table') this.db!.dropTable(name);
    else this.db!.deleteObject(kind, name);
    for (const t of [...this.tabs]) if (t.name === name && (t.kind === kind || (kind === 'table' && t.kind === 'design'))) this.close(t.id);
    this.touch();
  }
}
