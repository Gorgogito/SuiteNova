import type { Database, SqlJsStatic } from 'sql.js';
import { DATA_MACRO_FUNCTION, MAX_DATA_MACRO_FIELDS, cleanMeta, dataMacroTriggers, validationTriggerPrefix, validationTriggers, type TableMeta } from './tableprops';
import { aggregateSql, filtersClause, findCondition, matches, orderClause, replaceIn, type AggFn, type ColumnFilter, type FindOptions, type SortKey } from './datasheet';
import { bindParams, compileDesign, lit, q, sqlParams, type CompileContext, type QueryDesign } from './design';

export type FieldType = 'TEXT' | 'INTEGER' | 'REAL' | 'BOOLEAN' | 'DATE' | 'DATETIME';
export const FIELD_TYPES: FieldType[] = ['TEXT', 'INTEGER', 'REAL', 'BOOLEAN', 'DATE', 'DATETIME'];

export interface ColumnDef {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
  autoIncrement: boolean;
  unique: boolean;
  /** SQL text of the default value (e.g. `0`, `'x'`, `CURRENT_TIMESTAMP`), or null. */
  defaultValue: string | null;
  references: { table: string; column: string; onDelete?: RefAction; onUpdate?: RefAction } | null;
  /** A calculated field: a generated column. `expr` is the SQL of the expression; `stored` keeps the result in the file. */
  generated?: { expr: string; stored: boolean } | null;
}

export type RefAction = 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT';
export const REF_ACTIONS: RefAction[] = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'];

/** A relationship between two tables (a foreign key), with its referential actions. */
export interface Relation {
  child: string;
  childCols: string[];
  parent: string;
  parentCols: string[];
  onDelete: RefAction;
  onUpdate: RefAction;
}

/** Foreign key over several columns (kept as a table constraint). */
export type CompositeFk = Relation;

export interface AlterOptions {
  /** Rebuild even if the table has constraints that Nova Base cannot carry over (CHECK, generated columns, collations…). */
  acceptLoss?: boolean;
  /** Composite foreign keys of the new table (default: the current ones). */
  fks?: CompositeFk[];
}

export interface AlterReport {
  /** Indexes, views and triggers that could not be recreated (they referred to a column that no longer exists). */
  skipped: { kind: 'index' | 'view' | 'trigger'; name: string; reason: string }[];
  /** How many indexes, views and triggers were recreated. */
  kept: { indexes: number; views: number; triggers: number };
}

/** The table uses features that a rebuild would lose. */
export class AlterLossError extends Error {
  constructor(readonly losses: string[]) {
    super(`Rediseñar esta tabla perdería: ${losses.join(', ')}.`);
    this.name = 'AlterLossError';
  }
}

export interface TableInfo {
  name: string;
  columns: ColumnDef[];
  rowCount: number;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  /** Rows changed by a statement that does not return rows. */
  changes: number;
  elapsedMs: number;
  truncated: boolean;
}

export type ObjectKind = 'query' | 'form' | 'report' | 'macro' | 'module' | 'sheet' | 'tableprops' | 'file' | 'navgroups';
export const OBJECTS_TABLE = '__nova_objects';
const HIDDEN = (n: string) => n.startsWith('sqlite_') || n.startsWith('__nova_');

export const newColumn = (name: string, type: string = 'TEXT'): ColumnDef => ({ name, type, notNull: false, primaryKey: false, autoIncrement: false, unique: false, defaultValue: null, references: null });

/** SQLite type affinity as a CAST target when converting the data of a column. */
function castTo(expr: string, type: string): string {
  const t = type.toUpperCase();
  if (t === 'INTEGER') return `CAST(${expr} AS INTEGER)`;
  if (t === 'REAL') return `CAST(${expr} AS REAL)`;
  if (t === 'TEXT') return `CAST(${expr} AS TEXT)`;
  return expr;
}

const refSql = (r: { table: string; column: string; onDelete?: RefAction; onUpdate?: RefAction }): string =>
  `REFERENCES ${q(r.table)}${r.column ? ` (${q(r.column)})` : ''}${r.onDelete && r.onDelete !== 'NO ACTION' ? ` ON DELETE ${r.onDelete}` : ''}${r.onUpdate && r.onUpdate !== 'NO ACTION' ? ` ON UPDATE ${r.onUpdate}` : ''}`;

export function createTableSql(name: string, cols: ColumnDef[], extra: string[] = []): string {
  const pks = cols.filter((c) => c.primaryKey);
  const single = pks.length === 1 ? pks[0]! : null;
  const parts = cols.map((c) => {
    let s = `${q(c.name)} ${c.type || 'TEXT'}`;
    if (c.generated) return `${s} GENERATED ALWAYS AS (${c.generated.expr}) ${c.generated.stored ? 'STORED' : 'VIRTUAL'}`;
    if (single === c) {
      s += ' PRIMARY KEY';
      if (c.autoIncrement && c.type.toUpperCase() === 'INTEGER') s += ' AUTOINCREMENT';
    }
    if (c.notNull && single !== c) s += ' NOT NULL';
    if (c.unique && single !== c) s += ' UNIQUE';
    if (c.defaultValue !== null && c.defaultValue !== '') s += ` DEFAULT ${c.defaultValue}`;
    return s;
  });
  if (pks.length > 1) parts.push(`PRIMARY KEY (${pks.map((c) => q(c.name)).join(', ')})`);
  for (const c of cols) if (c.references) parts.push(`FOREIGN KEY (${q(c.name)}) ${refSql(c.references)}`);
  parts.push(...extra);
  return `CREATE TABLE ${q(name)} (\n  ${parts.join(',\n  ')}\n)`;
}

export function uniqueName(base: string, existing: Iterable<string>): string {
  const taken = new Set([...existing].map((s) => s.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`.toLowerCase())) return `${base}_${i}`;
}

/** Guess a column type from sample text values. */
export function inferType(values: string[]): FieldType {
  const v = values.filter((x) => x !== '');
  if (!v.length) return 'TEXT';
  if (v.every((x) => /^-?\d{1,15}$/.test(x) && !/^-?0\d/.test(x))) return 'INTEGER';
  if (v.every((x) => /^-?\d+\.\d+$/.test(x) || (/^-?\d{1,15}$/.test(x) && !/^-?0\d/.test(x)))) return 'REAL';
  if (v.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))) return 'DATE';
  if (v.every((x) => /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/.test(x))) return 'DATETIME';
  if (v.every((x) => /^(true|false|verdadero|falso)$/i.test(x))) return 'BOOLEAN';
  return 'TEXT';
}

export function coerce(value: unknown, type: string): unknown {
  if (value === null || value === undefined) return null;
  const t = type.toUpperCase();
  const s = typeof value === 'string' ? value.trim() : value;
  if (s === '') return t === 'TEXT' ? '' : null;
  if (t === 'INTEGER') {
    const n = Number(s);
    if (!Number.isInteger(n)) throw new Error(`"${String(value)}" no es un número entero.`);
    return n;
  }
  if (t === 'REAL') {
    const n = Number(typeof s === 'string' ? s.replace(',', '.') : s);
    if (!Number.isFinite(n)) throw new Error(`"${String(value)}" no es un número.`);
    return n;
  }
  if (t === 'BOOLEAN') {
    if (typeof s === 'boolean') return s ? 1 : 0;
    if (/^(1|true|verdadero|s[ií]|yes|-1)$/i.test(String(s))) return 1;
    if (/^(0|false|falso|no)$/i.test(String(s))) return 0;
    throw new Error(`"${String(value)}" no es un valor Sí/No.`);
  }
  if (t === 'DATE' && !/^\d{4}-\d{2}-\d{2}$/.test(String(s))) throw new Error(`"${String(value)}" no es una fecha (use AAAA-MM-DD).`);
  if (t === 'DATETIME' && !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(String(s))) throw new Error(`"${String(value)}" no es una fecha y hora (use AAAA-MM-DD HH:MM).`);
  return s;
}

export interface BrowseOptions {
  orderBy?: string | null;
  desc?: boolean;
  /** several sort keys (they win over `orderBy`) */
  sorts?: SortKey[];
  /** filters of the datasheet, one per column */
  filters?: ColumnFilter[];
  search?: string;
  /** A SQL condition added to the search. */
  filter?: string;
  offset?: number;
  limit?: number;
}

interface Snapshot {
  bytes: Uint8Array;
  label: string;
}

/** Memory kept for undo and redo together. Older steps are dropped first. */
export const UNDO_BUDGET_BYTES = 96 * 1024 * 1024;
const WRITES = /\b(insert|update|delete|replace|create|drop|alter|reindex|attach|detach)\b/i;
const stripLiterals = (sql: string): string => sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\//g, ' ');

export interface CompactReport {
  sizeBefore: number;
  sizeAfter: number;
  /** What `PRAGMA integrity_check` answered: `['ok']`, or the problems that are still there. */
  integrity: string[];
  /** There was a problem and rebuilding the indexes fixed it. */
  repaired: boolean;
  /** Records without correspondence in a related table. */
  foreignKeyProblems: number;
}

export class BaseDb {
  private constructor(private db: Database, readonly SQL: SqlJsStatic) {
    this.db.run('PRAGMA foreign_keys = ON');
    this.registerFunctions(this.db);
  }
  /**
   * Called by the triggers of the data macros of a table. `row` holds the new values (the old ones for a delete) and `old` the values
   * before the change (null for an insert). Throwing refuses the statement that changed the record.
   */
  dataMacroHook: ((table: string, event: string, rowid: number, row: Record<string, unknown>, old: Record<string, unknown> | null) => void) | null = null;
  private dmDepth = 0;
  /** > 0 while a data macro runs: its changes belong to the statement that fired it, so they take no undo point of their own. */
  private dmActive = 0;
  private dmColumns = new Map<string, string[]>();
  private registerFunctions(db: Database): void {
    // sql.js registers a function with the number of arguments it declares, so there is one for each table width (3 + 2 per field)
    const run = (...a: unknown[]) => {
      const hook = this.dataMacroHook;
      if (!hook) return null;
      const table = String(a[0]);
      const cols = this.dmColumns.get(table) ?? this.columns(table).map((c) => c.name);
      const k = cols.length;
      const pick = (from: number): Record<string, unknown> => Object.fromEntries(cols.map((c, i) => [c, a[from + i] === undefined ? null : a[from + i]]));
      const ev = String(a[1]);
      const old = ev === 'afterInsert' || ev === 'beforeChange:insert' ? null : pick(3 + k);
      if (++this.dmDepth > 8) {
        this.dmDepth--;
        // sql.js only keeps the message when what is thrown is text
        throw 'Las macros de datos se llamaron unas a otras más de 8 veces seguidas: ¿hay un bucle?';
      }
      this.dmActive++;
      try {
        hook(table, ev, Number(a[2]), pick(3), old);
      } catch (e) {
        throw e instanceof Error ? e.message : String(e);
      } finally {
        this.dmActive--;
        this.dmDepth--;
      }
      return null;
    };
    for (let k = 0; k <= MAX_DATA_MACRO_FIELDS; k++) {
      const f = (...a: unknown[]) => run(...a);
      Object.defineProperty(f, 'length', { value: 3 + 2 * k });
      db.create_function(DATA_MACRO_FUNCTION, f);
    }
  }
  dirty = false;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  /** The database is too big to keep undo copies (see UNDO_BUDGET_BYTES). */
  undoUnavailable = false;

  static open(SQL: SqlJsStatic, bytes?: Uint8Array | null): BaseDb {
    const db = new SQL.Database(bytes ?? undefined);
    if (bytes) {
      try {
        db.exec('SELECT count(*) FROM sqlite_master');
      } catch (e) {
        db.close();
        throw new Error('El archivo no es una base de datos SQLite válida (los archivos de Access .accdb/.mdb no se pueden abrir).');
      }
    }
    return new BaseDb(db, SQL);
  }

  /** The database file (SQLite 3). */
  export(): Uint8Array {
    const data = this.db.export();
    this.db.run('PRAGMA foreign_keys = ON'); // export resets the connection (and with it the functions of the data macros)
    this.registerFunctions(this.db);
    return data;
  }

  close(): void {
    this.db.close();
  }

  // ---------- undo ----------

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }
  get redoLabel(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null;
  }
  clearUndo(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Remember the current state before a change so that it can be undone. */
  private checkpoint(label: string): void {
    if (this.dmActive) return;
    const bytes = this.snapshot();
    if (bytes.length > UNDO_BUDGET_BYTES) {
      this.undoUnavailable = true;
      this.clearUndo();
      return;
    }
    this.undoUnavailable = false;
    this.undoStack.push({ bytes, label });
    this.redoStack = [];
    let total = [...this.undoStack, ...this.redoStack].reduce((n, x) => n + x.bytes.length, 0);
    while (total > UNDO_BUDGET_BYTES && this.undoStack.length > 1) total -= this.undoStack.shift()!.bytes.length;
  }
  /** The change failed: forget the checkpoint taken for it. */
  private discardCheckpoint(): void {
    if (this.dmActive) return;
    if (!this.undoUnavailable) this.undoStack.pop();
  }
  private snapshot(): Uint8Array {
    const data = this.db.export();
    this.db.run('PRAGMA foreign_keys = ON');
    this.registerFunctions(this.db);
    return data;
  }

  /** Saved queries, forms and reports are not "data": they survive an undo as they are now. */
  private readObjectRows(): unknown[][] {
    const has = this.db.exec(`SELECT 1 FROM sqlite_master WHERE name=${lit(OBJECTS_TABLE)}`).length > 0;
    // the properties of the tables go with the data (their validation triggers do), so they come back with an undo
    return has ? (this.db.exec(`SELECT kind, name, def FROM ${OBJECTS_TABLE} WHERE kind <> 'tableprops'`)[0]?.values ?? []) : [];
  }
  private restore(snap: Snapshot): void {
    const objects = this.readObjectRows();
    const next = new this.SQL.Database(snap.bytes);
    next.run('PRAGMA foreign_keys = ON');
    this.registerFunctions(next);
    this.db.close();
    this.db = next;
    this.ensureObjects();
    this.db.run(`DELETE FROM ${OBJECTS_TABLE} WHERE kind <> 'tableprops'`);
    for (const r of objects) this.db.run(`INSERT INTO ${OBJECTS_TABLE} (kind, name, def) VALUES (?, ?, ?)`, r as never[]);
    this.dirty = true;
  }
  /** Undo the last change. Returns its description, or null when there is nothing to undo. */
  undo(): string | null {
    const snap = this.undoStack.pop();
    if (!snap) return null;
    this.redoStack.push({ bytes: this.snapshot(), label: snap.label });
    this.restore(snap);
    return snap.label;
  }
  /** Take the last change back as if it had never happened (it cannot be redone): for a change a form event refused. */
  cancelLast(): void {
    if (this.undo() !== null) this.redoStack.pop();
  }
  redo(): string | null {
    const snap = this.redoStack.pop();
    if (!snap) return null;
    this.undoStack.push({ bytes: this.snapshot(), label: snap.label });
    this.restore(snap);
    return snap.label;
  }

  // ---------- schema ----------

  tableNames(): string[] {
    const r = this.db.exec(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name COLLATE NOCASE`);
    return (r[0]?.values.map((v) => String(v[0])) ?? []).filter((n) => !HIDDEN(n));
  }

  viewNames(): string[] {
    const r = this.db.exec(`SELECT name FROM sqlite_master WHERE type='view' ORDER BY name COLLATE NOCASE`);
    return r[0]?.values.map((v) => String(v[0])) ?? [];
  }

  columns(table: string): ColumnDef[] {
    // table_xinfo also lists the calculated (generated) columns; hidden = 2 virtual, 3 stored
    const info = (this.db.exec(`PRAGMA table_xinfo(${q(table)})`)[0]?.values ?? []).filter((r) => Number(r[6]) !== 1);
    const fks = this.db.exec(`PRAGMA foreign_key_list(${q(table)})`)[0]?.values ?? [];
    const idx = this.db.exec(`PRAGMA index_list(${q(table)})`)[0]?.values ?? [];
    const uniqueCols = new Set<string>();
    for (const i of idx) {
      if (Number(i[2]) !== 1) continue;
      const cols = this.db.exec(`PRAGMA index_info(${q(String(i[1]))})`)[0]?.values ?? [];
      if (cols.length === 1) uniqueCols.add(String(cols[0]![2]));
    }
    const sql = String(this.db.exec(`SELECT sql FROM sqlite_master WHERE name=${lit(table)}`)[0]?.values[0]?.[0] ?? '');
    const auto = /AUTOINCREMENT/i.test(sql);
    const gen = generatedOf(sql);
    return info.map((r) => {
      const name = String(r[1]);
      const hidden = Number(r[6]);
      const fk = fks.find((f) => String(f[3]) === name && fks.filter((g) => g[0] === f[0]).length === 1);
      return {
        name,
        type: String(r[2] || 'TEXT'),
        notNull: Number(r[3]) === 1,
        defaultValue: r[4] === null ? null : String(r[4]),
        primaryKey: Number(r[5]) > 0,
        autoIncrement: auto && Number(r[5]) > 0,
        unique: uniqueCols.has(name),
        references: fk ? { table: String(fk[2]), column: String(fk[4] ?? ''), onDelete: asAction(fk[6]), onUpdate: asAction(fk[5]) } : null,
        ...(hidden >= 2 ? { generated: { expr: gen.get(name.toLowerCase()) ?? '', stored: hidden === 3 } } : {}),
      };
    });
  }

  rowCount(table: string): number {
    return Number(this.db.exec(`SELECT count(*) FROM ${q(table)}`)[0]?.values[0]?.[0] ?? 0);
  }

  tableInfo(table: string): TableInfo {
    return { name: table, columns: this.columns(table), rowCount: this.rowCount(table) };
  }

  tables(): TableInfo[] {
    return this.tableNames().map((n) => this.tableInfo(n));
  }

  createTable(name: string, cols: ColumnDef[]): void {
    this.assertName(name);
    if (!cols.length) throw new Error('Una tabla necesita al menos un campo.');
    this.assertColumns(cols);
    this.checkpoint(`Crear la tabla ${name}`);
    try {
      this.db.run(createTableSql(name, cols));
    } catch (e) {
      this.discardCheckpoint();
      throw e;
    }
    this.dirty = true;
  }

  dropTable(name: string): void {
    this.checkpoint(`Eliminar la tabla ${name}`);
    try {
      this.db.run(`DROP TABLE ${q(name)}`);
    } catch (e) {
      this.discardCheckpoint();
      throw e;
    }
    this.dirty = true;
  }

  renameTable(from: string, to: string): void {
    this.assertName(to);
    this.checkpoint(`Cambiar el nombre de la tabla ${from}`);
    try {
      this.db.run(`ALTER TABLE ${q(from)} RENAME TO ${q(to)}`);
    } catch (e) {
      this.discardCheckpoint();
      throw e;
    }
    this.dirty = true;
  }

  /** SQL of the `CREATE TABLE` statement of a table. */
  private tableSql(name: string): string {
    return String(this.db.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name=${lit(name)}`)[0]?.values[0]?.[0] ?? '');
  }

  /** Foreign keys over several columns (single-column ones are part of ColumnDef.references). */
  private compositeFks(table: string): CompositeFk[] {
    return this.relations().filter((r) => r.child === table && r.childCols.length > 1);
  }

  /**
   * Redefine a table. Every new column may carry `orig`, the name it had before, so data is kept across renames and type changes;
   * columns without `orig` are new. Renames also update the views, triggers and indexes that use the column. Indexes (including
   * expression and partial ones), views and triggers are recreated; those that depended on a column that no longer exists are
   * reported in `skipped`. The whole change happens in one transaction: on failure nothing changes.
   */
  alterTable(name: string, cols: (ColumnDef & { orig?: string })[], opts: AlterOptions = {}): AlterReport {
    this.assertColumns(cols);
    const old = this.columns(name);
    const losses = detectLosses(this.tableSql(name), old.filter((c) => c.generated).length);
    if (losses.length && !opts.acceptLoss) throw new AlterLossError(losses);
    const composite = (opts.fks ?? this.compositeFks(name)).filter((fk) => fk.childCols.every((c) => cols.some((x) => x.orig === c || (!x.orig && x.name === c))));
    const mapped = cols.filter((c) => c.orig && !c.generated && old.some((o) => o.name === c.orig));
    const renames = mapped.filter((c) => c.orig !== c.name);
    const keptOrig = new Set(mapped.map((c) => c.orig!));
    const seqRow = this.db.exec(`SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'`).length ? this.db.exec(`SELECT seq FROM sqlite_sequence WHERE name=${lit(name)}`)[0]?.values[0]?.[0] : undefined;
    const tmp = uniqueName(`__nova_tmp_${name}`, this.tableNames());
    const report: AlterReport = { skipped: [], kept: { indexes: 0, views: 0, triggers: 0 } };
    const violationsBefore = this.fkViolations(name);

    this.checkpoint(`Rediseñar la tabla ${name}`);
    this.db.run('PRAGMA foreign_keys = OFF');
    this.db.run('BEGIN');
    try {
      // 1. renames through SQLite itself, so views, triggers, indexes and other tables' foreign keys follow
      const targets = new Set(renames.map((c) => c.name.toLowerCase()));
      let n = 0;
      for (const o of old) if (!keptOrig.has(o.name) && targets.has(o.name.toLowerCase())) this.db.run(`ALTER TABLE ${q(name)} RENAME COLUMN ${q(o.name)} TO ${q(`__nova_d${n++}`)}`);
      renames.forEach((c, i) => this.db.run(`ALTER TABLE ${q(name)} RENAME COLUMN ${q(c.orig!)} TO ${q(`__nova_c${i}`)}`));
      renames.forEach((c, i) => this.db.run(`ALTER TABLE ${q(name)} RENAME COLUMN ${q(`__nova_c${i}`)} TO ${q(c.name)}`));
      // after the renames the data of every kept column is found under its new name
      const source = (c: ColumnDef & { orig?: string }) => (c.orig !== c.name ? c.name : c.orig!);

      // 2. remember the indexes of the table and every view and trigger, then drop the views and triggers
      const objs = (this.db.exec(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND ((type='index' AND tbl_name=${lit(name)}) OR type IN ('view','trigger')) ORDER BY rowid`)[0]?.values ?? []).map((r) => ({ type: String(r[0]) as 'index' | 'view' | 'trigger', name: String(r[1]), sql: String(r[2]) }));
      for (const o of objs) if (o.type !== 'index') this.db.run(`DROP ${o.type.toUpperCase()} ${q(o.name)}`);

      // 3. the new table, with the data
      // a calculated field that names a renamed field follows the new name
      const fixExpr = (e: string) => renames.reduce((s, r) => s.split(q(r.orig!)).join(q(r.name)), e);
      this.db.run(createTableSql(tmp, cols.map(({ orig, ...c }) => (void orig, c.generated ? { ...c, generated: { ...c.generated, expr: fixExpr(c.generated.expr) } } : c)), composite.map(fkSql)));
      if (mapped.length) {
        const sel = mapped.map((c) => castTo(q(source(c)), c.type)).join(', ');
        this.db.run(`INSERT INTO ${q(tmp)} (${mapped.map((c) => q(c.name)).join(', ')}) SELECT ${sel} FROM ${q(name)}`);
      }
      if (this.fkViolations(tmp) > violationsBefore) throw new Error('Algunos registros no tienen correspondencia en la tabla relacionada. Corrija esos datos o elimine la relación.');
      this.db.run(`DROP TABLE ${q(name)}`);
      this.db.run(`ALTER TABLE ${q(tmp)} RENAME TO ${q(name)}`);
      if (typeof seqRow === 'number') this.db.run(`UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?`, [seqRow, name]);

      // 4. recreate what depended on the table. SQLite reads a double-quoted name that matches no column as a text literal, so a
      // view or trigger that still names a removed column would be accepted and silently return the name: those are skipped.
      const removed = old.filter((o) => !keptOrig.has(o.name)).map((o) => o.name);
      for (const kind of ['index', 'view', 'trigger'] as const) {
        for (const o of objs.filter((x) => x.type === kind)) {
          const gone = removed.find((c) => mentions(o.sql, c));
          if (gone) {
            report.skipped.push({ kind, name: o.name, reason: `usa el campo eliminado "${gone}"` });
            continue;
          }
          try {
            this.db.run(o.sql);
          } catch (e) {
            report.skipped.push({ kind, name: o.name, reason: (e as Error).message });
          }
        }
      }
      this.dropBroken(report);
      for (const o of objs) {
        if (report.skipped.some((s) => s.name === o.name && s.kind === o.type)) continue;
        if (o.type === 'index') report.kept.indexes++;
        else if (o.type === 'view') report.kept.views++;
        else report.kept.triggers++;
      }
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      this.discardCheckpoint();
      throw e;
    } finally {
      this.db.run('PRAGMA foreign_keys = ON');
    }
    this.dirty = true;
    return report;
  }

  /**
   * Checks the calculated fields of a design before it is saved: SQLite only refuses an expression that changes from one time to the
   * next (`date('now')`, `random()`) when a record is written, so one record is written to a scratch table. Throws a readable error.
   */
  validateCalculated(cols: ColumnDef[]): void {
    const gen = cols.filter((c) => c.generated);
    if (!gen.length) return;
    const probe = cols.map((c) => (c.generated ? c : { ...c, primaryKey: false, autoIncrement: false, notNull: false, unique: false, defaultValue: null, references: null }));
    const tmp = uniqueName('__nova_calc_probe', this.tableNames());
    try {
      this.db.run(createTableSql(tmp, probe).replace(/^CREATE TABLE/, 'CREATE TEMP TABLE'));
      this.db.run(`INSERT INTO temp.${q(tmp)} DEFAULT VALUES`);
      this.db.run(`SELECT ${gen.map((c) => q(c.name)).join(', ')} FROM temp.${q(tmp)}`);
    } catch (e) {
      const m = (e as Error).message;
      if (/deterministic/i.test(m)) throw new Error('Un campo calculado solo puede usar funciones que den siempre el mismo resultado para el registro (no Fecha(), Ahora() ni números al azar).');
      throw new Error(`Un campo calculado no es válido: ${m}`);
    } finally {
      try {
        this.db.run(`DROP TABLE IF EXISTS temp.${q(tmp)}`);
      } catch {
        /* nothing to drop */
      }
    }
  }

  /**
   * Compact and repair: checks the file, rebuilds the indexes when it finds a problem, and rewrites it without the free space.
   * The undo history is kept (only the layout of the file changes, not the data).
   */
  compact(): CompactReport {
    const sizeBefore = this.export().length;
    const check = (): string[] => (this.db.exec('PRAGMA integrity_check')[0]?.values ?? []).map((r) => String(r[0]));
    let integrity = check();
    let repaired = false;
    if (!(integrity.length === 1 && integrity[0] === 'ok')) {
      try {
        this.db.run('REINDEX');
      } catch {
        /* the check below tells whether it helped */
      }
      const again = check();
      repaired = again.length === 1 && again[0] === 'ok';
      integrity = again.length === 1 && again[0] === 'ok' ? ['ok'] : again;
    }
    const foreignKeyProblems = this.db.exec('PRAGMA foreign_key_check')[0]?.values.length ?? 0;
    this.db.run('VACUUM');
    const sizeAfter = this.export().length;
    this.dirty = true;
    return { sizeBefore, sizeAfter, integrity, repaired, foreignKeyProblems };
  }

  /** Number of rows that break a foreign key of the table (checked with foreign keys turned off). */
  private fkViolations(table: string): number {
    return this.db.exec(`PRAGMA foreign_key_check(${q(table)})`)[0]?.values.length ?? 0;
  }

  /**
   * Views and triggers are not checked when they are created. A harmless rename makes SQLite check the whole schema and name
   * the first broken one, which is dropped and reported; repeated until the schema is sound.
   */
  private dropBroken(report: AlterReport): void {
    this.db.run('CREATE TABLE __nova_probe (a)');
    try {
      for (let i = 0; i < 200; i++) {
        try {
          this.db.run(`ALTER TABLE __nova_probe RENAME COLUMN a TO b`);
          return;
        } catch (e) {
          const msg = (e as Error).message;
          const m = /error in (view|trigger|index) "?(.+?)"?\s*(?:after|:)/i.exec(msg);
          if (!m) throw e;
          const kind = m[1]!.toLowerCase() as 'view' | 'trigger' | 'index';
          this.db.run(`DROP ${kind.toUpperCase()} IF EXISTS ${q(m[2]!)}`);
          const reason = msg.replace(/^error in (view|trigger|index) [^:]*:\s*/i, '');
          const found = report.skipped.find((s) => s.name === m[2] && s.kind === kind);
          if (found) found.reason = reason;
          else report.skipped.push({ kind, name: m[2]!, reason });
        }
      }
    } finally {
      this.db.run('DROP TABLE IF EXISTS __nova_probe');
    }
  }

  // ---------- relationships ----------

  /** All foreign keys of the user tables, with their referential actions. */
  relations(): Relation[] {
    const out: Relation[] = [];
    const names = this.tableNames();
    for (const child of names) {
      const rows = this.db.exec(`PRAGMA foreign_key_list(${q(child)})`)[0]?.values ?? [];
      const groups = new Map<number, unknown[][]>();
      for (const r of rows) groups.set(Number(r[0]), [...(groups.get(Number(r[0])) ?? []), r]);
      for (const g of groups.values()) {
        g.sort((a, b) => Number(a[1]) - Number(b[1]));
        const parent = String(g[0]![2]);
        const parentPk = names.includes(parent) ? this.columns(parent).filter((c) => c.primaryKey).map((c) => c.name) : [];
        out.push({
          child,
          childCols: g.map((r) => String(r[3])),
          parent,
          parentCols: g.map((r, i) => (r[4] === null || r[4] === undefined ? (parentPk[i] ?? '') : String(r[4]))),
          onUpdate: asAction(g[0]![5]),
          onDelete: asAction(g[0]![6]),
        });
      }
    }
    return out;
  }

  /** Create or change the relationship of a column (single-column keys). The table is rebuilt, keeping its data. */
  setRelation(rel: Relation, opts: AlterOptions = {}): AlterReport {
    if (rel.childCols.length !== 1 || rel.parentCols.length !== 1) throw new Error('Solo se pueden crear relaciones de un campo; las de varios campos se conservan pero no se editan.');
    if (!this.tableNames().includes(rel.child)) throw new Error(`No existe la tabla "${rel.child}".`);
    if (!this.tableNames().includes(rel.parent)) throw new Error(`No existe la tabla "${rel.parent}".`);
    const pc = this.columns(rel.parent);
    const parentCol = pc.find((c) => c.name === rel.parentCols[0]);
    if (!parentCol) throw new Error(`No existe el campo "${rel.parentCols[0]}" en "${rel.parent}".`);
    const pks = pc.filter((c) => c.primaryKey);
    if (!((parentCol.primaryKey && pks.length === 1) || parentCol.unique)) throw new Error(`"${rel.parent}.${parentCol.name}" debe ser la clave principal o un campo único para poder relacionarse.`);
    const cols = this.columns(rel.child);
    if (!cols.some((c) => c.name === rel.childCols[0])) throw new Error(`No existe el campo "${rel.childCols[0]}" en "${rel.child}".`);
    return this.alterTable(
      rel.child,
      cols.map((c) => ({ ...c, orig: c.name, references: c.name === rel.childCols[0] ? { table: rel.parent, column: rel.parentCols[0]!, onDelete: rel.onDelete, onUpdate: rel.onUpdate } : c.references })),
      opts,
    );
  }

  removeRelation(child: string, childCols: string[], opts: AlterOptions = {}): AlterReport {
    const cols = this.columns(child);
    if (childCols.length === 1) return this.alterTable(child, cols.map((c) => ({ ...c, orig: c.name, references: c.name === childCols[0] ? null : c.references })), opts);
    const key = childCols.join('\u0000');
    return this.alterTable(child, cols.map((c) => ({ ...c, orig: c.name })), { ...opts, fks: this.compositeFks(child).filter((fk) => fk.childCols.join('\u0000') !== key) });
  }

  private assertName(name: string): void {
    if (!name.trim()) throw new Error('El nombre no puede estar vacío.');
    if (HIDDEN(name)) throw new Error('Ese nombre está reservado.');
    if (this.tableNames().some((n) => n.toLowerCase() === name.toLowerCase())) throw new Error(`Ya existe una tabla llamada "${name}".`);
  }

  private assertColumns(cols: ColumnDef[]): void {
    const seen = new Set<string>();
    for (const c of cols) {
      if (!c.name.trim()) throw new Error('Todos los campos necesitan un nombre.');
      const k = c.name.toLowerCase();
      if (seen.has(k)) throw new Error(`El campo "${c.name}" está repetido.`);
      seen.add(k);
    }
  }

  // ---------- data ----------

  browse(table: string, opts: BrowseOptions = {}): QueryResult {
    const cols = this.columns(table);
    const where = this.searchClause(cols, opts.search, opts.filter, opts.filters);
    const order = opts.sorts?.length ? orderClause(opts.sorts, new Set(cols.map((c) => c.name))) : opts.orderBy && cols.some((c) => c.name === opts.orderBy) ? ` ORDER BY ${q(opts.orderBy)} ${opts.desc ? 'DESC' : 'ASC'}` : '';
    const sql = `SELECT rowid AS "__rid", * FROM ${q(table)}${where}${order} LIMIT ${Math.max(1, opts.limit ?? 200)} OFFSET ${Math.max(0, opts.offset ?? 0)}`;
    return this.execute(sql);
  }

  count(table: string, search?: string, filter?: string, filters?: ColumnFilter[]): number {
    return Number(this.db.exec(`SELECT count(*) FROM ${q(table)}${this.searchClause(this.columns(table), search, filter, filters)}`)[0]?.values[0]?.[0] ?? 0);
  }

  /** The values of a column (with how many times each appears), for the value list of a filter. */
  distinct(table: string, column: string, opts: { search?: string; filters?: ColumnFilter[]; limit?: number } = {}): { value: string | null; n: number }[] {
    const cols = this.columns(table);
    if (!cols.some((c) => c.name === column)) return [];
    // the filter of the column itself is left out, so its list still shows every value
    const filters = (opts.filters ?? []).filter((f) => f.col !== column);
    const where = this.searchClause(cols, opts.search, undefined, filters);
    const r = this.db.exec(`SELECT ${q(column)} AS v, count(*) AS n FROM ${q(table)}${where} GROUP BY ${q(column)} ORDER BY ${q(column)} LIMIT ${Math.max(1, opts.limit ?? 500)}`)[0];
    return (r?.values ?? []).map((row) => ({ value: row[0] === null || row[0] === '' ? null : String(row[0]), n: Number(row[1]) }));
  }

  /** A total of one column over the rows that pass the search and the filters. */
  aggregate(table: string, column: string, fn: AggFn, opts: { search?: string; filters?: ColumnFilter[] } = {}): number | string | null {
    const cols = this.columns(table);
    if (!cols.some((c) => c.name === column)) return null;
    const where = this.searchClause(cols, opts.search, undefined, opts.filters);
    const v = this.db.exec(`SELECT ${aggregateSql(fn, column)} FROM ${q(table)}${where}`)[0]?.values[0]?.[0];
    return v === undefined ? null : (v as number | string | null);
  }

  /** The cells that match, in the order and filter of the datasheet: row position and column. At most `limit`. */
  findCells(table: string, o: FindOptions, opts: BrowseOptions = {}, limit = 5000): { row: number; rid: number; col: string }[] {
    const cols = this.columns(table);
    const names = cols.map((c) => c.name);
    const targets = (o.cols?.length ? o.cols : names).filter((n) => names.includes(n));
    if ((!o.find && !o.test) || !targets.length) return [];
    const where = this.searchClause(cols, opts.search, opts.filter, opts.filters);
    const order = opts.sorts?.length ? orderClause(opts.sorts, new Set(names)) : opts.orderBy && names.includes(opts.orderBy) ? ` ORDER BY ${q(opts.orderBy)} ${opts.desc ? 'DESC' : 'ASC'}` : ' ORDER BY rowid';
    // a search of the product's own (wildcards, regular expression) cannot be said in SQL: the values are read and tested here
    if (o.test) {
      const rows = this.db.exec(`SELECT rn, rid, ${targets.map((n) => q(n)).join(', ')} FROM (SELECT ROW_NUMBER() OVER (${order.trim()}) - 1 AS rn, rowid AS rid, ${targets.map((n) => q(n)).join(', ')} FROM ${q(table)}${where}) ORDER BY rn`)[0];
      const found: { row: number; rid: number; col: string }[] = [];
      for (const row of rows?.values ?? []) {
        for (let i = 0; i < targets.length && found.length < limit; i++) {
          const v = row[2 + i];
          if (v !== null && v !== undefined && o.test(String(v))) found.push({ row: Number(row[0]), rid: Number(row[1]), col: targets[i]! });
        }
      }
      return found;
    }
    const sel = targets.map((n, i) => `${findCondition([n], o)} AS m${i}`).join(', ');
    const r = this.db.exec(`SELECT rn, rid, ${targets.map((_n, i) => `m${i}`).join(', ')} FROM (SELECT ROW_NUMBER() OVER (${order.trim()}) - 1 AS rn, rowid AS rid, ${sel} FROM ${q(table)}${where}) WHERE ${targets.map((_n, i) => `m${i}`).join(' OR ')} ORDER BY rn LIMIT ${Math.max(1, limit)}`)[0];
    const out: { row: number; rid: number; col: string }[] = [];
    for (const row of r?.values ?? []) targets.forEach((n, i) => row[2 + i] === 1 && out.push({ row: Number(row[0]), rid: Number(row[1]), col: n }));
    return out;
  }

  /**
   * Edits several cells and adds records in one undo step (pasting, clearing a selection). A value that the column does not take is
   * skipped and reported; nothing is changed when `inserts` or `edits` fail as a whole.
   */
  applyEdits(table: string, edits: { rid: number; col: string; value: unknown }[], inserts: Record<string, unknown>[] = [], label = `Editar ${table}`): { changed: number; added: number; errors: string[] } {
    const cols = this.columns(table);
    const errors: string[] = [];
    let changed = 0;
    let added = 0;
    if (!edits.length && !inserts.length) return { changed, added, errors };
    this.checkpoint(label);
    try {
      for (const e of edits) {
        const def = cols.find((c) => c.name === e.col);
        if (!def) continue;
        try {
          const v = coerce(e.value, def.type);
          if (v === null && def.notNull && def.defaultValue === null) throw new Error(`El campo "${e.col}" no admite valores vacíos.`);
          this.db.run(`UPDATE ${q(table)} SET ${q(e.col)} = ? WHERE rowid = ?`, [v as never, e.rid]);
          changed++;
        } catch (err) {
          errors.push((err as Error).message);
        }
      }
      for (const row of inserts) {
        const names: string[] = [];
        const vals: unknown[] = [];
        for (const c of cols) {
          if (!(c.name in row)) continue;
          try {
            names.push(q(c.name));
            vals.push(coerce(row[c.name], c.type));
          } catch (err) {
            names.pop();
            errors.push((err as Error).message);
          }
        }
        try {
          if (names.length) this.db.run(`INSERT INTO ${q(table)} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`, vals as never[]);
          else this.db.run(`INSERT INTO ${q(table)} DEFAULT VALUES`);
          added++;
        } catch (err) {
          errors.push((err as Error).message);
        }
      }
    } catch (e) {
      this.discardCheckpoint();
      throw e;
    }
    if (changed || added) this.dirty = true;
    else this.discardCheckpoint();
    return { changed, added, errors };
  }

  /** Replaces text in the cells that match, all in one undo step. Returns how many cells changed and how many could not take the new value. */
  replaceCells(table: string, o: FindOptions, to: string, cells?: { rid: number; col: string }[], opts: BrowseOptions = {}): { changed: number; failed: number } {
    const cols = this.columns(table);
    const list = cells ?? this.findCells(table, o, opts, 100_000);
    if (!list.length) return { changed: 0, failed: 0 };
    this.checkpoint(`Reemplazar en ${table}`);
    let changed = 0;
    let failed = 0;
    try {
      for (const { rid, col } of list) {
        const def = cols.find((c) => c.name === col);
        const cur = this.db.exec(`SELECT ${q(col)} FROM ${q(table)} WHERE rowid = ${Math.trunc(rid)}`)[0]?.values[0]?.[0];
        if (!def || cur === null || cur === undefined || !matches(String(cur), o)) continue;
        try {
          const v = coerce(replaceIn(String(cur), o, to), def.type);
          if (v === null && def.notNull) throw new Error('vacío');
          this.db.run(`UPDATE ${q(table)} SET ${q(col)} = ? WHERE rowid = ?`, [v as never, rid]);
          changed++;
        } catch {
          failed++;
        }
      }
    } catch (e) {
      this.discardCheckpoint();
      throw e;
    }
    if (changed) this.dirty = true;
    else this.discardCheckpoint();
    return { changed, failed };
  }

  /** `search` looks for text in every column; `filter` is a SQL condition (a form opened with a WHERE). */
  private searchClause(cols: ColumnDef[], search?: string, filter?: string, filters?: ColumnFilter[]): string {
    const parts: string[] = [];
    if (filters?.length) parts.push(...filtersClause(filters, new Map(cols.map((c) => [c.name, c.type]))));
    const s = search?.trim();
    if (s) {
      const like = lit(`%${s.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
      parts.push(`(${cols.map((c) => `CAST(${q(c.name)} AS TEXT) LIKE ${like} ESCAPE '\\'`).join(' OR ')})`);
    }
    if (filter?.trim()) parts.push(`(${filter})`);
    return parts.length ? ` WHERE ${parts.join(' AND ')}` : '';
  }

  updateCell(table: string, rid: number, column: string, value: unknown): void {
    const col = this.columns(table).find((c) => c.name === column);
    if (!col) throw new Error(`No existe el campo "${column}".`);
    if (col.generated) throw new Error(`El campo "${column}" es calculado: su valor sale de una expresión y no se puede escribir.`);
    let v = coerce(value, col.type);
    if (v === null && col.notNull && col.defaultValue === null) throw new Error(`El campo "${column}" no admite valores vacíos.`);
    if (v === null && col.notNull) v = null;
    this.checkpoint(`Editar ${table}.${column}`);
    try {
      this.db.run(`UPDATE ${q(table)} SET ${q(column)} = ? WHERE rowid = ?`, [v as never, rid]);
    } catch (e) {
      this.discardCheckpoint();
      throw e;
    }
    this.dirty = true;
  }

  insertRow(table: string, values: Record<string, unknown> = {}): number {
    const cols = this.columns(table);
    const names: string[] = [];
    const vals: unknown[] = [];
    for (const c of cols) {
      if (c.generated) {
        if (c.name in values && values[c.name] !== null && values[c.name] !== undefined && values[c.name] !== '') throw new Error(`El campo "${c.name}" es calculado: no se puede escribir.`);
        continue;
      }
      let v = c.name in values ? coerce(values[c.name], c.type) : undefined;
      if (v === undefined && c.notNull && c.defaultValue === null && !(c.primaryKey && c.type.toUpperCase() === 'INTEGER')) v = fillerFor(c.type);
      if (v !== undefined) {
        names.push(q(c.name));
        vals.push(v);
      }
    }
    this.checkpoint(`Nuevo registro en ${table}`);
    try {
      if (names.length) this.db.run(`INSERT INTO ${q(table)} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`, vals as never[]);
      else this.db.run(`INSERT INTO ${q(table)} DEFAULT VALUES`);
    } catch (e) {
      this.discardCheckpoint();
      throw e;
    }
    this.dirty = true;
    return Number(this.db.exec('SELECT last_insert_rowid()')[0]!.values[0]![0]);
  }

  deleteRows(table: string, rids: number[]): void {
    if (!rids.length) return;
    this.checkpoint(rids.length === 1 ? `Eliminar un registro de ${table}` : `Eliminar ${rids.length} registros de ${table}`);
    try {
      this.db.run(`DELETE FROM ${q(table)} WHERE rowid IN (${rids.map((r) => Math.trunc(r)).join(',')})`);
    } catch (e) {
      this.discardCheckpoint();
      throw e;
    }
    this.dirty = true;
  }

  /** Run SQL (one or several statements). The result of the last statement that returns rows is returned. */
  execute(sql: string, maxRows = 100_000, params?: Record<string, unknown>): QueryResult {
    const t0 = performance.now();
    let last: QueryResult = { columns: [], rows: [], changes: 0, elapsedMs: 0, truncated: false };
    let writes = false;
    const mayWrite = WRITES.test(stripLiterals(sql));
    if (mayWrite) this.checkpoint('Ejecutar una consulta de acción');
    const before = mayWrite ? this.undoStack.length : 0;
    try {
      last = this.run(sql, maxRows, params, (w) => (writes = w));
    } catch (e) {
      if (mayWrite && this.undoStack.length === before) this.discardCheckpoint();
      throw e;
    }
    if (writes) this.dirty = true;
    else if (mayWrite) this.discardCheckpoint(); // it only read data
    last.elapsedMs = performance.now() - t0;
    return last;
  }

  private run(sql: string, maxRows: number, params: Record<string, unknown> | undefined, markWrites: (w: boolean) => void): QueryResult {
    let last: QueryResult = { columns: [], rows: [], changes: 0, elapsedMs: 0, truncated: false };
    for (const stmt of this.db.iterateStatements(sql)) {
      if (params) {
        const own = sqlParams(stmt.getSQL());
        if (own.length) stmt.bind(bindParams(stmt.getSQL(), params) as never);
      }
      const cols = stmt.getColumnNames();
      if (cols.length) {
        const rows: unknown[][] = [];
        let truncated = false;
        while (stmt.step()) {
          if (rows.length >= maxRows) {
            truncated = true;
            break;
          }
          rows.push(stmt.get());
        }
        last = { columns: cols, rows, changes: 0, elapsedMs: 0, truncated };
      } else {
        stmt.step();
        markWrites(true);
        last = { columns: [], rows: [], changes: this.db.getRowsModified(), elapsedMs: 0, truncated: false };
      }
    }
    return last;
  }

  /** The SQL of a design. A crosstab first reads the distinct values of its column field. */
  designSql(d: QueryDesign, ctx: CompileContext = {}, values: Record<string, unknown> = {}): { sql: string; params: ReturnType<typeof compileDesign>['params'] } {
    let c = compileDesign(d, ctx);
    if (c.needsValues) {
      const vals = this.execute(c.sql, 201, values).rows.map((r) => r[0]);
      if (vals.length > 200) throw new Error('La referencia cruzada tendría más de 200 columnas. Filtre los datos o elija otro campo de columna.');
      c = compileDesign(d, { ...ctx, crosstabValues: vals });
    }
    return { sql: c.sql, params: c.params };
  }

  /** Run a design. `values` answers its [parameters] by bind name (p1, p2…). */
  runDesign(d: QueryDesign, ctx: CompileContext = {}, values: Record<string, unknown> = {}): QueryResult {
    const { sql } = this.designSql(d, ctx, values);
    if (!sql.trim()) throw new Error('Elija al menos una tabla.');
    return this.execute(sql, 100_000, values);
  }

  // ---------- saved objects (queries, forms, reports) ----------

  private ensureObjects(): void {
    this.db.run(`CREATE TABLE IF NOT EXISTS ${OBJECTS_TABLE} (kind TEXT NOT NULL, name TEXT NOT NULL, def TEXT NOT NULL, PRIMARY KEY (kind, name))`);
  }
  objects(kind: ObjectKind): string[] {
    const has = this.db.exec(`SELECT 1 FROM sqlite_master WHERE name=${lit(OBJECTS_TABLE)}`).length > 0;
    if (!has) return [];
    return (this.db.exec(`SELECT name FROM ${OBJECTS_TABLE} WHERE kind=${lit(kind)} ORDER BY name COLLATE NOCASE`)[0]?.values ?? []).map((v) => String(v[0]));
  }
  getObject<T>(kind: ObjectKind, name: string): T | null {
    if (!this.objects(kind).includes(name)) return null;
    const v = this.db.exec(`SELECT def FROM ${OBJECTS_TABLE} WHERE kind=${lit(kind)} AND name=${lit(name)}`)[0]?.values[0]?.[0];
    return v ? (JSON.parse(String(v)) as T) : null;
  }
  saveObject(kind: ObjectKind, name: string, def: unknown): void {
    if (!name.trim()) throw new Error('El nombre no puede estar vacío.');
    this.ensureObjects();
    this.db.run(`INSERT OR REPLACE INTO ${OBJECTS_TABLE} (kind, name, def) VALUES (?, ?, ?)`, [kind, name, JSON.stringify(def)]);
    this.dirty = true;
  }
  deleteObject(kind: ObjectKind, name: string): void {
    this.ensureObjects();
    this.db.run(`DELETE FROM ${OBJECTS_TABLE} WHERE kind=? AND name=?`, [kind, name]);
    this.dirty = true;
  }
  renameObject(kind: ObjectKind, from: string, to: string): void {
    if (!to.trim()) throw new Error('El nombre no puede estar vacío.');
    if (this.objects(kind).some((n) => n.toLowerCase() === to.toLowerCase() && n !== from)) throw new Error(`Ya existe "${to}".`);
    this.db.run(`UPDATE ${OBJECTS_TABLE} SET name=? WHERE kind=? AND name=?`, [to, kind, from]);
    this.dirty = true;
  }

  // ---------- copies, dumps and other databases ----------

  /** A table name that is free (the wanted one, or with _1, _2… after it). */
  freeTableName(wanted: string): string {
    const taken = new Set(this.db.exec(`SELECT name FROM sqlite_master`)[0]?.values.map((v) => String(v[0]).toLowerCase()) ?? []);
    if (!taken.has(wanted.toLowerCase())) return wanted;
    for (let i = 1; ; i++) if (!taken.has(`${wanted}_${i}`.toLowerCase())) return `${wanted}_${i}`;
  }

  /**
   * Copies a table: its structure and data, only the structure, or (append) its records into a table that exists. Returns the name of the
   * table and how many records were copied. Fields are matched by name when appending.
   */
  copyTable(from: string, to: string, mode: 'all' | 'structure' | 'append'): { table: string; rows: number } {
    const cols = this.columns(from);
    if (mode === 'append') {
      const dest = this.columns(to).map((c) => c.name.toLowerCase());
      const common = cols.filter((c) => dest.includes(c.name.toLowerCase()));
      if (!common.length) throw new Error(`"${to}" no tiene ningún campo con el mismo nombre que los de "${from}".`);
      const names = common.map((c) => q(this.columns(to).find((d) => d.name.toLowerCase() === c.name.toLowerCase())!.name));
      this.checkpoint(`Anexar ${from} a ${to}`);
      try {
        this.db.run(`INSERT INTO ${q(to)} (${names.join(', ')}) SELECT ${common.map((c) => q(c.name)).join(', ')} FROM ${q(from)}`);
      } catch (e) {
        this.discardCheckpoint();
        throw e;
      }
      this.dirty = true;
      return { table: to, rows: this.db.getRowsModified() };
    }
    const name = this.freeTableName(to);
    this.checkpoint(`Copiar la tabla ${from}`);
    try {
      // a copy does not point at the other table's rows by itself: keep the key and the references as they are
      this.db.run(createTableSql(name, cols));
      if (mode === 'all') this.db.run(`INSERT INTO ${q(name)} SELECT * FROM ${q(from)}`);
    } catch (e) {
      this.discardCheckpoint();
      throw e;
    }
    this.dirty = true;
    return { table: name, rows: mode === 'all' ? this.rowCount(name) : 0 };
  }

  /** The tables of a database file (without opening it as the current one), to choose what to import. */
  static peek(SQL: SqlJsStatic, bytes: Uint8Array): { name: string; rows: number; columns: number }[] {
    const other = new SQL.Database(bytes);
    try {
      const names = (other.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> ${lit(OBJECTS_TABLE)} ORDER BY name COLLATE NOCASE`)[0]?.values ?? []).map((v) => String(v[0]));
      return names.map((name) => ({
        name,
        rows: Number(other.exec(`SELECT count(*) FROM ${q(name)}`)[0]?.values[0]?.[0] ?? 0),
        columns: (other.exec(`PRAGMA table_info(${q(name)})`)[0]?.values ?? []).length,
      }));
    } finally {
      other.close();
    }
  }

  /**
   * Brings tables of another database file into this one: structure, data and (when the name is unchanged) indexes. A table whose name is
   * taken arrives with a new name. One undo step.
   */
  importDatabase(bytes: Uint8Array, names: string[], opts: { data?: boolean } = {}): { tables: string[]; rows: number; renamed: Record<string, string>; notes: string[] } {
    const other = new this.SQL.Database(bytes);
    const out = { tables: [] as string[], rows: 0, renamed: {} as Record<string, string>, notes: [] as string[] };
    this.checkpoint(`Importar tablas de otra base de datos`);
    try {
      this.db.run('PRAGMA foreign_keys = OFF');
      for (const name of names) {
        const sql = String(other.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name=${lit(name)}`)[0]?.values[0]?.[0] ?? '');
        if (!sql) continue;
        const target = this.freeTableName(name);
        const create = target === name ? sql : sql.replace(/^(\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)(?:"(?:[^"]|"")+"|`[^`]+`|\[[^\]]+\]|[^\s(]+)(\s*\()/i, `$1${q(target)}$2`);
        this.db.run(create);
        if (target !== name) out.renamed[name] = target;
        out.tables.push(target);
        if (opts.data !== false) {
          const res = other.exec(`SELECT * FROM ${q(name)}`)[0];
          if (res) {
            const stmt = this.db.prepare(`INSERT INTO ${q(target)} VALUES (${res.columns.map(() => '?').join(', ')})`);
            for (const row of res.values) {
              stmt.run(row as never[]);
              out.rows++;
            }
            stmt.free();
          }
        }
        const idx = other.exec(`SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=${lit(name)} AND sql IS NOT NULL`)[0]?.values ?? [];
        for (const [isql] of idx) {
          if (target !== name) {
            out.notes.push(`Los índices de «${name}» no se copiaron porque la tabla cambió de nombre.`);
            break;
          }
          try {
            this.db.run(String(isql));
          } catch {
            out.notes.push('Un índice no se pudo crear (su nombre ya existe).');
          }
        }
      }
    } catch (e) {
      this.discardCheckpoint();
      throw e;
    } finally {
      this.db.run('PRAGMA foreign_keys = ON');
      other.close();
    }
    this.dirty = true;
    return out;
  }

  /** SQL text that recreates the tables (structure, indexes, triggers of those tables and, optionally, the data). */
  dumpSql(tables: string[], withData = true): string {
    const out: string[] = ['PRAGMA foreign_keys = OFF;', 'BEGIN TRANSACTION;'];
    for (const name of tables) {
      const create = this.db.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name=${lit(name)}`)[0]?.values[0]?.[0];
      if (!create) continue;
      out.push(`${String(create)};`);
      if (withData) {
        const res = this.db.exec(`SELECT * FROM ${q(name)}`)[0];
        for (const row of res?.values ?? [])
          out.push(`INSERT INTO ${q(name)} (${res!.columns.map(q).join(', ')}) VALUES (${row.map((v) => (v instanceof Uint8Array ? `X'${[...v].map((b) => b.toString(16).padStart(2, '0')).join('')}'` : lit(v))).join(', ')});`);
      }
      for (const [sql] of this.db.exec(`SELECT sql FROM sqlite_master WHERE type IN ('index','trigger') AND tbl_name=${lit(name)} AND sql IS NOT NULL`)[0]?.values ?? []) out.push(`${String(sql)};`);
    }
    out.push('COMMIT;', 'PRAGMA foreign_keys = ON;');
    return out.join('\n') + '\n';
  }

  // ---------- table properties and indexes ----------

  /** Description, captions, formats, masks, rules and lookups of a table (empty when it has none). */
  getMeta(table: string): TableMeta {
    return this.getObject<TableMeta>('tableprops', table) ?? { fields: {} };
  }

  /**
   * Saves the properties of a table and recreates the triggers that enforce its validation rules. A rule that cannot be read is an error
   * and nothing changes. `own` = false when a checkpoint was already taken for this change (it is part of a table rebuild).
   */
  setMeta(table: string, meta: TableMeta, own = true): void {
    const clean = cleanMeta(meta);
    const trg = clean ? [...validationTriggers(table, clean), ...dataMacroTriggers(table, this.columns(table).map((c) => c.name), clean)] : [];
    if (clean) this.dmColumns.set(table, this.columns(table).map((c) => c.name));
    if (own) this.checkpoint(`Propiedades de ${table}`);
    try {
      // every trigger of ours on this table, whatever name the table had when it was made (after a rename)
      const prefix = validationTriggerPrefix('').slice(0, -2);
      const old = this.db.exec(`SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=${lit(table)} AND substr(name, 1, ${prefix.length}) = ${lit(prefix)}`)[0]?.values ?? [];
      for (const [n] of old) this.db.run(`DROP TRIGGER ${q(String(n))}`);
      for (const sql of trg) this.db.run(sql);
      this.ensureObjects();
      if (clean) this.db.run(`INSERT OR REPLACE INTO ${OBJECTS_TABLE} (kind, name, def) VALUES ('tableprops', ?, ?)`, [table, JSON.stringify(clean)]);
      else this.db.run(`DELETE FROM ${OBJECTS_TABLE} WHERE kind='tableprops' AND name=?`, [table]);
    } catch (e) {
      if (own) this.discardCheckpoint();
      throw e;
    }
    this.dirty = true;
  }

  /** The indexes of a table. Those SQLite creates by itself for keys and unique columns are marked `auto`. */
  indexes(table: string): { name: string; unique: boolean; columns: (string | null)[]; auto: boolean; partial: boolean }[] {
    const list = this.db.exec(`PRAGMA index_list(${q(table)})`)[0]?.values ?? [];
    return list.map((r) => {
      const name = String(r[1]);
      const cols = (this.db.exec(`PRAGMA index_info(${q(name)})`)[0]?.values ?? []).map((c) => (c[2] === null ? null : String(c[2])));
      return { name, unique: Number(r[2]) === 1, columns: cols, auto: String(r[3]) !== 'c', partial: Number(r[4]) === 1 };
    });
  }

  createIndex(table: string, name: string, columns: string[], unique: boolean): void {
    const n = name.trim();
    if (!n) throw new Error('El índice necesita un nombre.');
    if (!columns.length) throw new Error('Elige al menos un campo para el índice.');
    const have = this.columns(table).map((c) => c.name);
    for (const c of columns) if (!have.includes(c)) throw new Error(`No existe el campo "${c}".`);
    this.checkpoint(`Crear el índice ${n}`);
    try {
      this.db.run(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${q(n)} ON ${q(table)} (${columns.map(q).join(', ')})`);
    } catch (e) {
      this.discardCheckpoint();
      throw new Error(/UNIQUE constraint failed/i.test((e as Error).message) ? 'Hay valores repetidos: no se puede crear un índice sin duplicados.' : (e as Error).message);
    }
    this.dirty = true;
  }

  dropIndex(name: string): void {
    this.checkpoint(`Eliminar el índice ${name}`);
    try {
      this.db.run(`DROP INDEX ${q(name)}`);
    } catch (e) {
      this.discardCheckpoint();
      throw e;
    }
    this.dirty = true;
  }

  // ---------- import ----------

  /** Create a table from text rows. The first row is the header when `header` is true. Returns the table name. */
  importRows(baseName: string, rows: string[][], opts: { header?: boolean } = {}): { table: string; rows: number } {
    if (!rows.length) throw new Error('No hay datos que importar.');
    const header = opts.header !== false;
    const width = Math.max(...rows.map((r) => r.length));
    const names: string[] = [];
    for (let i = 0; i < width; i++) {
      const raw = header ? (rows[0]![i] ?? '').trim() : '';
      names.push(uniqueName(raw || `Campo${i + 1}`, names));
    }
    const body = header ? rows.slice(1) : rows;
    const cols: ColumnDef[] = names.map((n, i) => newColumn(n, inferType(body.map((r) => (r[i] ?? '').trim()))));
    const table = uniqueName(baseName.trim() || 'Tabla1', [...this.tableNames(), ...this.viewNames()]);
    this.checkpoint(`Importar ${table}`);
    this.db.run('BEGIN');
    try {
      this.db.run(createTableSql(table, cols));
      const stmt = this.db.prepare(`INSERT INTO ${q(table)} VALUES (${cols.map(() => '?').join(', ')})`);
      for (const r of body) {
        stmt.run(cols.map((c, i) => coerceImport((r[i] ?? '').trim(), c.type)) as never[]);
      }
      stmt.free();
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      this.discardCheckpoint();
      throw e;
    }
    this.dirty = true;
    return { table, rows: body.length };
  }
}

/** Table features that Nova Base's table designer cannot reproduce when it rebuilds a table. */
function detectLosses(sql: string, generatedKnown = 0): string[] {
  const t = stripLiterals(sql);
  const out: string[] = [];
  if (/\bCHECK\s*\(/i.test(t)) out.push('restricciones CHECK');
  // the calculated fields the designer understands are kept; only the ones it could not read would be lost
  if ((t.match(/\bAS\s*\(/gi) ?? []).length > generatedKnown) out.push('campos calculados (GENERATED)');
  if (/\bCOLLATE\b/i.test(t)) out.push('intercalaciones (COLLATE)');
  if (/WITHOUT\s+ROWID/i.test(t)) out.push('WITHOUT ROWID');
  if (/\bSTRICT\b/i.test(t)) out.push('tabla STRICT');
  return out;
}

/** Does the SQL name this identifier (bare, "double-quoted", `backticked` or [bracketed]) outside string literals and comments? */
function mentions(sql: string, ident: string): boolean {
  const t = sql.replace(/'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
  const esc = ident.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])["\`\\[]?${esc}["\`\\]]?(?![\\p{L}\\p{N}_])`, 'iu').test(t);
}

/** The expression of each calculated column of a `CREATE TABLE`, by lower case column name. */
function generatedOf(sql: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!/\bAS\s*\(/i.test(sql)) return out;
  const open = sql.indexOf('(');
  const body = sql.slice(open + 1, sql.lastIndexOf(')'));
  // split the column definitions on the commas that are not inside parentheses or quotes
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const ch of body) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      cur += ch;
    } else if (ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ')') {
      depth--;
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  for (const p of parts) {
    const m = /^\s*(?:"((?:[^"]|"")+)"|`([^`]+)`|\[([^\]]+)\]|([\p{L}_][\p{L}\p{N}_]*))[\s\S]*?\b(?:GENERATED\s+ALWAYS\s+)?AS\s*\(/iu.exec(p);
    if (!m) continue;
    const name = (m[1]?.replace(/""/g, '"') ?? m[2] ?? m[3] ?? m[4])!;
    const start = m[0].length;
    let d = 1;
    let i = start;
    let qt = '';
    for (; i < p.length && d > 0; i++) {
      const ch = p[i]!;
      if (qt) {
        if (ch === qt) qt = '';
      } else if (ch === '"' || ch === "'" || ch === '`') qt = ch;
      else if (ch === '(') d++;
      else if (ch === ')') d--;
    }
    out.set(name.toLowerCase(), p.slice(start, i - 1).trim());
  }
  return out;
}

const fkSql = (fk: CompositeFk): string =>
  `FOREIGN KEY (${fk.childCols.map(q).join(', ')}) REFERENCES ${q(fk.parent)} (${fk.parentCols.map(q).join(', ')})${fk.onDelete !== 'NO ACTION' ? ` ON DELETE ${fk.onDelete}` : ''}${fk.onUpdate !== 'NO ACTION' ? ` ON UPDATE ${fk.onUpdate}` : ''}`;

function asAction(v: unknown): RefAction {
  const s = String(v ?? '').toUpperCase();
  return (REF_ACTIONS as string[]).includes(s) ? (s as RefAction) : 'NO ACTION';
}

function coerceImport(v: string, type: string): unknown {
  if (v === '') return null;
  try {
    return coerce(v, type);
  } catch {
    return v;
  }
}

function fillerFor(type: string): unknown {
  switch (type.toUpperCase()) {
    case 'INTEGER':
    case 'REAL':
    case 'BOOLEAN':
      return 0;
    case 'DATE':
      return new Date().toISOString().slice(0, 10);
    case 'DATETIME':
      return new Date().toISOString().slice(0, 16).replace('T', ' ');
    default:
      return '';
  }
}
