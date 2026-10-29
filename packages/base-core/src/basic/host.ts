import type { BaseDb } from '../db';
import { lit, q } from '../design';
import { BasicError, ERR, NOTHING, VArray, fromSerial, isObject, toBool, toDate, toNum, toStr, type BObject, type BVal } from './values';

/** An open form, as macros and procedures see it. */
export interface FormLike {
  /** The fields of the current record (what macro expressions read). */
  record?(): Record<string, BVal>;
  name: string;
  table: string;
  get(field: string): BVal;
  set(field: string, v: BVal): void;
  goto(where: 'first' | 'last' | 'next' | 'previous' | 'new'): void;
  requery(): void;
}

export interface DbHostApi {
  db: BaseDb;
  /** An open form by name, or null. */
  form(name: string): FormLike | null;
  /** The form whose event is running (`Me`). */
  me(): FormLike | null;
  openForm(name: string, where?: string): void;
  openReport(name: string): void;
  openTable(name: string): void;
  openQuery(name: string): void;
  runMacro(name: string): void;
  close(kind: 'form' | 'report' | 'table' | 'query' | 'any', name?: string): void;
  /** SQL of a saved query, for domain functions on queries. */
  querySql(name: string): string | null;
  /** Something changed in the database: redraw. */
  refresh(): void;
}

const MAX_ROWS = 200_000;

/** Access criteria to SQLite: `[Name]` → "Name", "text" → 'text', #date# → 'iso', True/False → 1/0, & → ||, Like wildcards. */
export function translateCriteria(c: string): string {
  const keep: string[] = [];
  let s = c.replace(/\[([^\]]+)\]/g, (_m, n) => {
    keep.push(q(n));
    return `\u0001${keep.length - 1}\u0001`;
  });
  s = s.replace(/#([^#]+)#/g, (_m, d: string) => {
    const iso = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/.exec(d.trim());
    const t = iso ? `${iso[3]}-${iso[1]!.padStart(2, '0')}-${iso[2]!.padStart(2, '0')}${iso[4]}` : d.trim();
    return lit(t);
  });
  s = s.replace(/"((?:[^"]|"")*)"/g, (_m, t: string) => lit(t.replace(/""/g, '"')));
  s = s.replace(/\blike\s+('(?:[^']|'')*')/gi, (_m, t: string) => `LIKE ${t.replace(/\*/g, '%').replace(/\?/g, '_')}`);
  s = s.replace(/\btrue\b/gi, '1').replace(/\bfalse\b/gi, '0').replace(/\bis\s+not\s+null\b/gi, 'IS NOT NULL').replace(/\bis\s+null\b/gi, 'IS NULL');
  s = s.replace(/&/g, '||');
  return s.replace(/\u0001(\d+)\u0001/g, (_m, i) => keep[+i]!);
}

/** A value read from SQLite as a script value: Yes/No columns are Booleans, date columns are Dates. */
function fromDb(v: unknown, type: string | undefined): BVal {
  if (v === null || v === undefined) return null;
  if (v instanceof Uint8Array) return `[${v.length} bytes]`;
  const t = (type ?? '').toUpperCase();
  if (t === 'BOOLEAN') return Number(v) !== 0;
  if ((t === 'DATE' || t === 'DATETIME') && typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
    if (m) return new Date(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  }
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'bigint') return Number(v);
  return String(v);
}

/** A script value as something SQLite stores. */
function toDb(v: BVal, type: string | undefined): string | number | null {
  if (v === null || v === undefined) return null;
  const t = (type ?? '').toUpperCase();
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    const date = `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
    return t === 'DATE' || (!v.getHours() && !v.getMinutes() && !v.getSeconds() && t !== 'DATETIME') ? date : `${date} ${p(v.getHours())}:${p(v.getMinutes())}`;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return v;
  if (v === NOTHING || v instanceof VArray) throw ERR.typeMismatch();
  return toStr(v);
}

function noMember(m: string): never {
  throw ERR.notSupported(m);
}

// ---------------------------------------------------------------------------------------------- recordset

class Field implements BObject {
  readonly typeName = 'Field';
  constructor(
    private rs: Recordset,
    private name: string,
  ) {}
  get(member: string): BVal {
    switch (member.toLowerCase()) {
      case 'value':
        return this.rs.field(this.name);
      case 'name':
        return this.name;
    }
    return noMember(member);
  }
  set(member: string, _a: BVal[], v: BVal): void {
    if (member.toLowerCase() === 'value') return this.rs.setField(this.name, v);
    noMember(member);
  }
  index(): BVal {
    return this.rs.field(this.name);
  }
  setIndex(_a: BVal[], v: BVal): void {
    this.rs.setField(this.name, v);
  }
}

class Fields implements BObject {
  readonly typeName = 'Fields';
  constructor(private rs: Recordset) {}
  get(member: string): BVal {
    if (member.toLowerCase() === 'count') return this.rs.columns.length;
    if (member.toLowerCase() === 'item') return this.index([member]);
    return noMember(member);
  }
  set(member: string): void {
    noMember(member);
  }
  index(args: BVal[]): BVal {
    const k = args[0];
    const name = typeof k === 'number' ? this.rs.columns[Math.trunc(k)] : this.rs.columns.find((c) => c.toLowerCase() === toStr(k).toLowerCase());
    if (name === undefined) throw new BasicError(3265, `No se encontró el elemento en esta colección: ${toStr(k)}`);
    return new Field(this.rs, name);
  }
  items(): BVal[] {
    return this.rs.columns.map((c) => new Field(this.rs, c));
  }
}

class Recordset implements BObject {
  readonly typeName = 'Recordset';
  columns: string[] = [];
  private types: (string | undefined)[] = [];
  private rows: unknown[][] = [];
  private rids: number[] = [];
  private pos = 0;
  private closed = false;
  private adding: Record<string, BVal> | null = null;
  private editing: Record<string, BVal> | null = null;
  noMatch = false;
  readonly table: string | null;
  private baseSql: string;

  constructor(
    private api: DbHostApi,
    source: string,
  ) {
    const s = source.trim();
    const tbl = api.db.tableNames().find((t) => t.toLowerCase() === s.toLowerCase());
    if (tbl) {
      this.table = tbl;
      this.baseSql = `SELECT rowid AS __rid, * FROM ${q(tbl)}`;
    } else if (api.db.viewNames().some((v) => v.toLowerCase() === s.toLowerCase())) {
      this.table = null;
      this.baseSql = `SELECT * FROM ${q(api.db.viewNames().find((v) => v.toLowerCase() === s.toLowerCase())!)}`;
    } else if (/^\s*(select|with)\b/i.test(s)) {
      this.table = null;
      this.baseSql = s.replace(/[;\s]+$/, '');
    } else {
      const saved = api.db.objects('query').includes(s) ? api.querySql(s) : null;
      if (!saved) throw new BasicError(3078, `El motor de base de datos no pudo encontrar la tabla o consulta de entrada: ${s}`);
      this.table = null;
      this.baseSql = saved.replace(/[;\s]+$/, '');
    }
    this.load();
  }

  private load(where?: string): void {
    const sql = where ? `SELECT * FROM (${this.baseSql}) WHERE ${where}` : this.baseSql;
    const r = this.api.db.execute(sql, MAX_ROWS);
    if (r.truncated) throw new BasicError(3052, 'El conjunto de registros es demasiado grande');
    const first = this.table ? 1 : 0;
    this.columns = r.columns.slice(first);
    this.rows = r.rows;
    this.rids = this.table ? r.rows.map((x) => Number(x[0])) : [];
    if (this.table) {
      const info = this.api.db.columns(this.table);
      this.types = this.columns.map((c) => info.find((x) => x.name === c)?.type);
    } else this.types = this.columns.map((c) => this.guessType(c));
    this.pos = 0;
  }

  /** A query column named like a Yes/No or date column of a table is read as that type (the same name must not mean two types). */
  private guessType(col: string): string | undefined {
    const found = new Set<string>();
    for (const t of this.api.db.tableNames()) {
      const c = this.api.db.columns(t).find((x) => x.name.toLowerCase() === col.toLowerCase());
      if (c) found.add(c.type.toUpperCase());
    }
    return found.size === 1 ? [...found][0] : undefined;
  }

  private offset(): number {
    return this.table ? 1 : 0;
  }
  private alive(): void {
    if (this.closed) throw new BasicError(3420, 'El objeto no es válido o ya no está definido');
  }
  get eof(): boolean {
    return this.pos >= this.rows.length;
  }
  get bof(): boolean {
    return this.pos < 0;
  }
  private current(): unknown[] {
    if (this.pos < 0 || this.pos >= this.rows.length) throw new BasicError(3021, 'No hay ningún registro actual');
    return this.rows[this.pos]!;
  }
  field(name: string): BVal {
    this.alive();
    const i = this.columns.findIndex((c) => c.toLowerCase() === name.toLowerCase());
    if (i < 0) throw new BasicError(3265, `No se encontró el elemento en esta colección: ${name}`);
    if (this.adding && name in this.adding) return this.adding[name];
    if (this.editing && name in this.editing) return this.editing[name];
    if (this.adding) return null;
    return fromDb(this.current()[i + this.offset()], this.types[i]);
  }
  setField(name: string, v: BVal): void {
    this.alive();
    if (!this.table) throw new BasicError(3027, 'No se puede actualizar: el conjunto de registros es de solo lectura');
    const col = this.columns.find((c) => c.toLowerCase() === name.toLowerCase());
    if (!col) throw new BasicError(3265, `No se encontró el elemento en esta colección: ${name}`);
    const buf = this.adding ?? this.editing;
    if (!buf) throw new BasicError(3188, 'No se puede actualizar: use Edit o AddNew antes de cambiar un campo');
    buf[col] = v;
  }
  private rowidAt(i: number): number {
    return this.rids[i]!;
  }
  private reload(selectRid?: number): void {
    this.load();
    if (selectRid !== undefined) {
      const i = this.rids.indexOf(selectRid);
      this.pos = i < 0 ? this.rows.length : i;
    }
  }

  get(member: string, args: BVal[]): BVal {
    this.alive();
    switch (member.toLowerCase()) {
      case 'eof':
        return this.eof;
      case 'bof':
        return this.bof;
      case 'recordcount':
        return this.rows.length;
      case 'nomatch':
        return this.noMatch;
      case 'fields':
        return args.length ? new Fields(this).index(args) : new Fields(this);
      case 'name':
        return this.table ?? 'Consulta';
      case 'movefirst':
        this.pos = 0;
        return undefined;
      case 'movelast':
        this.pos = Math.max(0, this.rows.length - 1);
        return undefined;
      case 'movenext':
        if (this.pos < this.rows.length) this.pos++;
        return undefined;
      case 'moveprevious':
        if (this.pos >= 0) this.pos--;
        return undefined;
      case 'move':
        this.pos = Math.max(-1, Math.min(this.rows.length, this.pos + Math.trunc(toNum(args[0]))));
        return undefined;
      case 'findfirst':
      case 'findnext':
      case 'findlast':
      case 'findprevious': {
        const m = member.toLowerCase();
        const crit = translateCriteria(toStr(args[0]));
        let found = -1;
        const pick = (idx: number[]): number => (m === 'findfirst' ? (idx[0] ?? -1) : m === 'findlast' ? (idx[idx.length - 1] ?? -1) : m === 'findnext' ? (idx.find((i) => i > this.pos) ?? -1) : ([...idx].reverse().find((i) => i < this.pos) ?? -1));
        if (this.table) {
          const probe = this.api.db.execute(`SELECT __rid FROM (${this.baseSql}) WHERE ${crit}`, MAX_ROWS);
          const hits = probe.rows.map((r) => Number(r[0]));
          found = pick(hits.map((h) => this.rids.indexOf(h)).filter((i) => i >= 0));
        } else {
          // queries: filter the loaded rows by running the criteria over them
          const all = this.api.db.execute(`SELECT * FROM (${this.baseSql}) WHERE ${crit}`, MAX_ROWS);
          const want = new Set(all.rows.map((r) => JSON.stringify(r)));
          const idx = this.rows.map((r, i) => (want.has(JSON.stringify(r)) ? i : -1)).filter((i) => i >= 0);
          found = pick(idx);
        }
        this.noMatch = found < 0;
        if (found >= 0) this.pos = found;
        return undefined;
      }
      case 'addnew':
        if (!this.table) throw new BasicError(3027, 'No se puede actualizar: el conjunto de registros es de solo lectura');
        this.adding = Object.create(null);
        this.editing = null;
        return undefined;
      case 'edit':
        if (!this.table) throw new BasicError(3027, 'No se puede actualizar: el conjunto de registros es de solo lectura');
        this.current();
        this.editing = Object.create(null);
        this.adding = null;
        return undefined;
      case 'update': {
        const t = this.table!;
        if (this.adding) {
          const cols = Object.keys(this.adding);
          const vals = cols.map((c) => toDb(this.adding![c], this.types[this.columns.indexOf(c)]));
          const rid = cols.length
            ? (this.api.db.execute(`INSERT INTO ${q(t)} (${cols.map(q).join(', ')}) VALUES (${vals.map((v) => lit(v)).join(', ')}); SELECT last_insert_rowid()`).rows[0]![0] as number)
            : (this.api.db.execute(`INSERT INTO ${q(t)} DEFAULT VALUES; SELECT last_insert_rowid()`).rows[0]![0] as number);
          this.adding = null;
          this.reload(Number(rid));
        } else if (this.editing) {
          const rid = this.rowidAt(this.pos);
          const cols = Object.keys(this.editing);
          if (cols.length) this.api.db.execute(`UPDATE ${q(t)} SET ${cols.map((c) => `${q(c)} = ${lit(toDb(this.editing![c], this.types[this.columns.indexOf(c)]))}`).join(', ')} WHERE rowid = ${rid}`);
          this.editing = null;
          this.reload(rid);
        } else throw new BasicError(3020, 'Update o CancelUpdate sin AddNew o Edit');
        this.api.refresh();
        return undefined;
      }
      case 'cancelupdate':
        this.adding = null;
        this.editing = null;
        return undefined;
      case 'delete': {
        if (!this.table) throw new BasicError(3027, 'No se puede actualizar: el conjunto de registros es de solo lectura');
        const rid = this.rowidAt(this.pos);
        this.current();
        this.api.db.execute(`DELETE FROM ${q(this.table)} WHERE rowid = ${rid}`);
        const keep = this.pos;
        this.reload();
        this.pos = Math.min(keep, this.rows.length);
        this.api.refresh();
        return undefined;
      }
      case 'requery':
        this.reload();
        return undefined;
      case 'close':
        this.closed = true;
        return undefined;
    }
    // rs.FieldName works like rs!FieldName
    if (this.columns.some((c) => c.toLowerCase() === member.toLowerCase())) return this.field(member);
    return noMember(member);
  }
  set(member: string, _a: BVal[], v: BVal): void {
    if (this.columns.some((c) => c.toLowerCase() === member.toLowerCase())) return this.setField(member, v);
    noMember(member);
  }
  index(args: BVal[]): BVal {
    return this.field(toStr(args[0]));
  }
  setIndex(args: BVal[], v: BVal): void {
    this.setField(toStr(args[0]), v);
  }
}

// ---------------------------------------------------------------------------------------------- objects

class Database implements BObject {
  readonly typeName = 'Database';
  affected = 0;
  constructor(private api: DbHostApi) {}
  get(member: string, args: BVal[]): BVal {
    switch (member.toLowerCase()) {
      case 'execute': {
        const r = this.api.db.execute(toStr(args[0]));
        this.affected = r.changes;
        this.api.refresh();
        return undefined;
      }
      case 'openrecordset':
        return new Recordset(this.api, toStr(args[0]));
      case 'recordsaffected':
        return this.affected;
      case 'name':
        return 'Base de datos';
    }
    return noMember(member);
  }
  set(member: string): void {
    noMember(member);
  }
}

class FormObject implements BObject {
  readonly typeName = 'Form';
  constructor(private form: FormLike) {}
  get(member: string, args: BVal[]): BVal {
    const m = member.toLowerCase();
    if (m === 'name') return this.form.name;
    if (m === 'recordsource') return this.form.table;
    if (m === 'requery' || m === 'refresh') {
      this.form.requery();
      return undefined;
    }
    if (m === 'value' && args.length) return this.form.get(toStr(args[0]));
    return this.form.get(member);
  }
  set(member: string, _a: BVal[], v: BVal): void {
    this.form.set(member, v);
  }
  index(args: BVal[]): BVal {
    return this.form.get(toStr(args[0]));
  }
  setIndex(args: BVal[], v: BVal): void {
    this.form.set(toStr(args[0]), v);
  }
}

class FormsCollection implements BObject {
  readonly typeName = 'Forms';
  constructor(private api: DbHostApi) {}
  get(member: string, args: BVal[]): BVal {
    if (member.toLowerCase() === 'count') return 0;
    return this.index([member, ...args]);
  }
  set(member: string): void {
    noMember(member);
  }
  index(args: BVal[]): BVal {
    const name = toStr(args[0]);
    const f = this.api.form(name);
    if (!f) throw new BasicError(2450, `Nova Base no puede encontrar el formulario "${name}": ábralo primero`);
    return new FormObject(f);
  }
}

/** Variables shared between macros and procedures. */
export class TempVars implements BObject {
  readonly typeName = 'TempVars';
  readonly values = new Map<string, BVal>();
  get(member: string, args: BVal[]): BVal {
    switch (member.toLowerCase()) {
      case 'add':
        this.values.set(toStr(args[0]).toLowerCase(), args[1]);
        return undefined;
      case 'remove':
        this.values.delete(toStr(args[0]).toLowerCase());
        return undefined;
      case 'removeall':
        this.values.clear();
        return undefined;
      case 'count':
        return this.values.size;
    }
    return this.index([member]);
  }
  set(member: string, _a: BVal[], v: BVal): void {
    this.setIndex([member], v);
  }
  index(args: BVal[]): BVal {
    return this.values.get(toStr(args[0]).toLowerCase()) ?? null;
  }
  setIndex(args: BVal[], v: BVal): void {
    this.values.set(toStr(args[0]).toLowerCase(), v);
  }
}

function formArgOf(api: DbHostApi, name: BVal): FormLike | null {
  if (name !== undefined && name !== null && toStr(name) !== '') return api.form(toStr(name));
  return api.me();
}

function doCmd(api: DbHostApi): BObject {
  return {
    typeName: 'DoCmd',
    get(member, a) {
      switch (member.toLowerCase()) {
        case 'openform':
          api.openForm(toStr(a[0]), a[3] === undefined || a[3] === null ? (a[2] === undefined || a[2] === null ? undefined : toStr(a[2])) : toStr(a[3]));
          return undefined;
        case 'openreport':
          api.openReport(toStr(a[0]));
          return undefined;
        case 'opentable':
          api.openTable(toStr(a[0]));
          return undefined;
        case 'openquery':
          api.openQuery(toStr(a[0]));
          return undefined;
        case 'runsql': {
          api.db.execute(toStr(a[0]));
          api.refresh();
          return undefined;
        }
        case 'runmacro':
          api.runMacro(toStr(a[0]));
          return undefined;
        case 'close': {
          const kinds: Record<number, 'table' | 'query' | 'form' | 'report'> = { 0: 'table', 1: 'query', 2: 'form', 3: 'report' };
          const k = a[0] === undefined ? undefined : kinds[Math.trunc(toNum(a[0]))];
          api.close(k ?? 'any', a[1] === undefined ? undefined : toStr(a[1]));
          return undefined;
        }
        case 'gotorecord': {
          const f = formArgOf(api, a[1]);
          if (!f) throw new BasicError(2046, 'El comando o acción GoToRecord no está disponible ahora');
          const rec = a[2] === undefined ? 1 : Math.trunc(toNum(a[2]));
          f.goto(rec === 0 ? 'previous' : rec === 1 ? 'next' : rec === 2 ? 'first' : rec === 3 ? 'last' : 'new');
          return undefined;
        }
        case 'requery':
          api.me()?.requery();
          api.refresh();
          return undefined;
        case 'setwarnings':
        case 'hourglass':
        case 'echo':
        case 'beep':
        case 'quit':
          return undefined;
      }
      return noMember(member);
    },
    set(member) {
      noMember(member);
    },
  };
}

/** The objects and functions that Access programs expect: CurrentDb, DoCmd, Forms, Me, TempVars and the domain functions. */
export function createHost(api: DbHostApi, tempVars = new TempVars()): { objects: Record<string, BVal>; functions: Record<string, (args: BVal[], named: Record<string, BVal>) => BVal>; tempVars: TempVars } {
  const dbObj = new Database(api);
  const domain = (fn: 'lookup' | 'count' | 'sum' | 'avg' | 'max' | 'min') => (a: BVal[]): BVal => {
    const expr = toStr(a[0]).trim();
    const domainName = toStr(a[1]).trim();
    const crit = a[2] === undefined || a[2] === null || toStr(a[2]).trim() === '' ? '' : ` WHERE ${translateCriteria(toStr(a[2]))}`;
    const tbl = api.db.tableNames().find((t) => t.toLowerCase() === domainName.toLowerCase());
    const view = api.db.viewNames().find((v) => v.toLowerCase() === domainName.toLowerCase());
    const from = tbl ? q(tbl) : view ? q(view) : api.db.objects('query').includes(domainName) && api.querySql(domainName) ? `(${api.querySql(domainName)!.replace(/[;\s]+$/, '')})` : null;
    if (!from) throw new BasicError(3078, `El motor de base de datos no pudo encontrar la tabla o consulta de entrada: ${domainName}`);
    const col = expr === '*' ? '*' : translateCriteria(expr.includes('[') ? expr : expr.match(/^[\p{L}_][\p{L}\p{N}_ ]*$/u) ? `[${expr}]` : expr);
    const agg = fn === 'lookup' ? col : fn === 'count' ? `COUNT(${col})` : `${fn.toUpperCase()}(${col})`;
    const r = api.db.execute(`SELECT ${agg} FROM ${from}${crit}${fn === 'lookup' ? ' LIMIT 1' : ''}`);
    const v = r.rows[0]?.[0];
    if (fn === 'count') return Number(v ?? 0);
    return v === undefined || v === null ? null : typeof v === 'number' || typeof v === 'string' ? v : String(v);
  };
  return {
    tempVars,
    objects: {
      docmd: doCmd(api),
      forms: new FormsCollection(api),
      tempvars: tempVars,
    },
    functions: {
      currentdb: () => dbObj,
      dlookup: domain('lookup'),
      dcount: domain('count'),
      dsum: domain('sum'),
      davg: domain('avg'),
      dmax: domain('max'),
      dmin: domain('min'),
      // Eval of constant expressions is not provided on purpose: there is no way to run arbitrary text
      me: () => {
        const f = api.me();
        return f ? new FormObject(f) : NOTHING;
      },
    },
  };
}

void isObject;
void toBool;
void toDate;
void fromSerial;
