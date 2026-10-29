import type { Database, SqlJsStatic } from 'sql.js';
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

export type ObjectKind = 'query' | 'form' | 'report' | 'macro' | 'module';
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

export class BaseDb {
  private constructor(private db: Database, readonly SQL: SqlJsStatic) {
    this.db.run('PRAGMA foreign_keys = ON');
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
    this.db.run('PRAGMA foreign_keys = ON'); // export resets the connection
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
    if (!this.undoUnavailable) this.undoStack.pop();
  }
  private snapshot(): Uint8Array {
    const data = this.db.export();
    this.db.run('PRAGMA foreign_keys = ON');
    return data;
  }

  /** Saved queries, forms and reports are not "data": they survive an undo as they are now. */
  private readObjectRows(): unknown[][] {
    const has = this.db.exec(`SELECT 1 FROM sqlite_master WHERE name=${lit(OBJECTS_TABLE)}`).length > 0;
    return has ? (this.db.exec(`SELECT kind, name, def FROM ${OBJECTS_TABLE}`)[0]?.values ?? []) : [];
  }
  private restore(snap: Snapshot): void {
    const objects = this.readObjectRows();
    const next = new this.SQL.Database(snap.bytes);
    next.run('PRAGMA foreign_keys = ON');
    this.db.close();
    this.db = next;
    this.ensureObjects();
    this.db.run(`DELETE FROM ${OBJECTS_TABLE}`);
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
    const info = this.db.exec(`PRAGMA table_info(${q(table)})`)[0]?.values ?? [];
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
    return info.map((r) => {
      const name = String(r[1]);
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
    const losses = detectLosses(this.tableSql(name));
    if (losses.length && !opts.acceptLoss) throw new AlterLossError(losses);
    const composite = (opts.fks ?? this.compositeFks(name)).filter((fk) => fk.childCols.every((c) => cols.some((x) => x.orig === c || (!x.orig && x.name === c))));
    const mapped = cols.filter((c) => c.orig && old.some((o) => o.name === c.orig));
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
      this.db.run(createTableSql(tmp, cols.map(({ orig, ...c }) => (void orig, c)), composite.map(fkSql)));
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
    const where = this.searchClause(cols, opts.search, opts.filter);
    const order = opts.orderBy && cols.some((c) => c.name === opts.orderBy) ? ` ORDER BY ${q(opts.orderBy)} ${opts.desc ? 'DESC' : 'ASC'}` : '';
    const sql = `SELECT rowid AS "__rid", * FROM ${q(table)}${where}${order} LIMIT ${Math.max(1, opts.limit ?? 200)} OFFSET ${Math.max(0, opts.offset ?? 0)}`;
    return this.execute(sql);
  }

  count(table: string, search?: string, filter?: string): number {
    return Number(this.db.exec(`SELECT count(*) FROM ${q(table)}${this.searchClause(this.columns(table), search, filter)}`)[0]?.values[0]?.[0] ?? 0);
  }

  /** `search` looks for text in every column; `filter` is a SQL condition (a form opened with a WHERE). */
  private searchClause(cols: ColumnDef[], search?: string, filter?: string): string {
    const parts: string[] = [];
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
function detectLosses(sql: string): string[] {
  const t = stripLiterals(sql);
  const out: string[] = [];
  if (/\bCHECK\s*\(/i.test(t)) out.push('restricciones CHECK');
  if (/\bGENERATED\b|\bAS\s*\(/i.test(t)) out.push('campos calculados (GENERATED)');
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
