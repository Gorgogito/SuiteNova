/** Quote an identifier for SQLite. */
export const q = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** Quote a literal value. Numbers stay numbers; everything else is a string. */
export function lit(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
}

export type SortDir = 'asc' | 'desc' | null;

/** What a field does in a totals query (the "Total" row of the Access grid). */
export type TotalOp = 'group' | 'sum' | 'avg' | 'count' | 'min' | 'max' | 'where' | 'expr';
export const TOTAL_OPS: TotalOp[] = ['group', 'sum', 'avg', 'count', 'min', 'max', 'where', 'expr'];

export type QueryKind = 'select' | 'crosstab' | 'union' | 'append' | 'update' | 'delete' | 'maketable';
export const QUERY_KINDS: QueryKind[] = ['select', 'crosstab', 'union', 'append', 'update', 'delete', 'maketable'];

export interface DesignField {
  /** Table of the column. Empty for a calculated field. */
  table: string;
  /** Column name, or the name (alias) of a calculated field. */
  name: string;
  show: boolean;
  sort: SortDir;
  /** Criteria as typed in a query grid: `>5`, `"Ana"`, `Like "A*"`, `Between 1 And 5`, `Is Null`, `In (1,2)`, `>[Mínimo]`. */
  criteria: string;
  /** Second criteria row (the "O" row of the grid). */
  or?: string;
  /** Further criteria rows. Each row is ANDed across fields; the rows are ORed with each other. */
  more?: string[];
  /** Totals query: what to do with this field. */
  total?: TotalOp;
  /** Column name in the result. */
  alias?: string;
  /** SQL expression of a calculated field (`table` is empty); may use `[Parameter]`. */
  expr?: string;
  /** Crosstab: role of the field. */
  role?: 'row' | 'column' | 'value';
  /** Update query: new value (a literal as in criteria, a `[Parameter]` or `=expression`). Append query: column of the target table. */
  set?: string;
}

export interface UnionSource {
  kind: 'table' | 'query';
  name: string;
}

export interface QueryDesign {
  tables: string[];
  fields: DesignField[];
  /** Join conditions between tables when more than one is used, as written (e.g. `"a"."id"`, `"b"."a_id"`): inner joins on equality. */
  joins?: { left: string; right: string }[];
  distinct?: boolean;
  limit?: number | null;
  kind?: QueryKind;
  /** Crosstab: aggregate applied to the value field. */
  crosstabFn?: 'sum' | 'count' | 'avg' | 'min' | 'max';
  /** Union: the parts, in order. */
  union?: { sources: UnionSource[]; all: boolean };
  /** Append and make-table queries: the table written to. */
  target?: string;
}

export const newDesign = (): QueryDesign => ({ tables: [], fields: [] });

export interface QueryParam {
  /** Bind name without the colon. */
  key: string;
  /** What the user is asked for. */
  label: string;
}

export interface Compiled {
  sql: string;
  params: QueryParam[];
  /** Crosstab: column values were needed to build the statement. */
  needsValues?: boolean;
}

export interface CompileContext {
  /** SQL of a saved query (for union parts). */
  resolveQuery?: (name: string) => string;
  /** Crosstab: the distinct values of the column field, in the order to show. */
  crosstabValues?: unknown[];
}

/** Collects `[Name]` parameters while SQL is being generated. */
class Params {
  list: QueryParam[] = [];
  add(label: string): string {
    const l = label.trim();
    let p = this.list.find((x) => x.label === l);
    if (!p) {
      p = { key: `p${this.list.length + 1}`, label: l };
      this.list.push(p);
    }
    return `:${p.key}`;
  }
}

const PARAM = /^\[([^\[\]]+)\]$/;

const valueOf = (raw: string, ps: Params): string => {
  const s = raw.trim();
  let m: RegExpExecArray | null;
  if ((m = PARAM.exec(s))) return ps.add(m[1]!);
  if (s.startsWith('=')) return `(${exprSql(s.slice(1), ps)})`;
  if (/^(["']).*\1$/.test(s)) return lit(s.slice(1, -1));
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  if (/^(true|verdadero|sí|si)$/i.test(s)) return '1';
  if (/^(false|falso|no)$/i.test(s)) return '0';
  return lit(s);
};

/** An expression typed by the user: `[Name]` becomes a parameter, everything else is kept (outside string literals). */
function exprSql(expr: string, ps: Params): string {
  let out = '';
  let quote = '';
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]!;
    if (quote) {
      out += ch;
      if (ch === quote) quote = '';
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === '[') {
      const end = expr.indexOf(']', i);
      if (end > i) {
        out += ps.add(expr.slice(i + 1, end));
        i = end;
      } else out += ch;
    } else out += ch;
  }
  return out;
}

/** Translate one grid criteria cell into a SQL condition on `col`. Wildcards `*` and `?` of Access become `%` and `_`. */
export function criteriaToSql(col: string, criteria: string, ps: Params = new Params()): string | null {
  const c = criteria.trim();
  if (!c) return null;
  let m: RegExpExecArray | null;
  if (/^is\s+not\s+null$/i.test(c) || /^no\s+es\s+nulo$/i.test(c)) return `${col} IS NOT NULL`;
  if (/^is\s+null$/i.test(c) || /^es\s+nulo$/i.test(c)) return `${col} IS NULL`;
  if ((m = /^not\s+like\s+(.+)$/i.exec(c))) return `${col} NOT LIKE ${likeValue(m[1]!, ps)}`;
  if ((m = /^(?:like|como)\s+(.+)$/i.exec(c))) return `${col} LIKE ${likeValue(m[1]!, ps)}`;
  if ((m = /^(?:between|entre)\s+(.+?)\s+(?:and|y)\s+(.+)$/i.exec(c))) return `${col} BETWEEN ${valueOf(m[1]!, ps)} AND ${valueOf(m[2]!, ps)}`;
  if ((m = /^(not\s+)?in\s*\((.*)\)$/i.exec(c))) return `${col} ${m[1] ? 'NOT ' : ''}IN (${splitList(m[2]!).map((v) => valueOf(v, ps)).join(', ')})`;
  if ((m = /^(<=|>=|<>|!=|=|<|>)\s*(.+)$/.exec(c))) return `${col} ${m[1] === '!=' ? '<>' : m[1]} ${valueOf(m[2]!, ps)}`;
  if (PARAM.test(c)) return `${col} = ${valueOf(c, ps)}`;
  if (/[*?]/.test(c)) return `${col} LIKE ${likeValue(c, ps)}`;
  return `${col} = ${valueOf(c, ps)}`;
}

function likeValue(raw: string, ps: Params): string {
  const s = raw.trim();
  const m = PARAM.exec(s);
  if (m) return `REPLACE(REPLACE(${ps.add(m[1]!)}, '*', '%'), '?', '_')`;
  const v = s.replace(/^(["'])(.*)\1$/, '$2');
  return lit(v.replace(/\*/g, '%').replace(/\?/g, '_'));
}

function splitList(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote = '';
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ------------------------------------------------------------------------------------------------ compile

const AGG_LABEL: Record<string, string> = { sum: 'Suma', avg: 'Promedio', count: 'Cuenta', min: 'Mín', max: 'Máx' };
const AGG_SQL: Record<string, string> = { sum: 'SUM', avg: 'AVG', count: 'COUNT', min: 'MIN', max: 'MAX' };

/** Rows of criteria of a field: row 0 is `criteria`, row 1 is `or`, then `more`. */
const criteriaRows = (f: DesignField): string[] => [f.criteria ?? '', f.or ?? '', ...(f.more ?? [])];

/** Access grid semantics: the conditions of one row are ANDed, the rows are ORed. */
function criteriaWhere(fields: DesignField[], target: (f: DesignField) => string, ps: Params): string | null {
  const nrows = Math.max(0, ...fields.map((f) => criteriaRows(f).length));
  const rows: string[] = [];
  for (let r = 0; r < nrows; r++) {
    const parts: string[] = [];
    for (const f of fields) {
      const c = criteriaToSql(target(f), criteriaRows(f)[r] ?? '', ps);
      if (c) parts.push(c);
    }
    if (parts.length) rows.push(parts.length > 1 ? `(${parts.join(' AND ')})` : parts[0]!);
  }
  if (!rows.length) return null;
  return rows.join(' OR ');
}

const isCalc = (f: DesignField) => !f.table;
const multiTable = (d: QueryDesign) => d.tables.length > 1;
const colRef = (d: QueryDesign, f: DesignField, ps: Params): string => (isCalc(f) ? `(${exprSql(f.expr ?? 'NULL', ps)})` : multiTable(d) ? `${q(f.table)}.${q(f.name)}` : q(f.name));

function fromClause(d: QueryDesign): string {
  return `FROM ${d.tables.map(q).join(', ')}`;
}
function joinConds(d: QueryDesign): string[] {
  return (d.joins ?? []).filter((j) => j.left && j.right).map((j) => `${j.left} = ${j.right}`);
}

/** The name a field has in the result. */
export function outputName(f: DesignField): string {
  if (f.alias?.trim()) return f.alias.trim();
  if (f.total && AGG_LABEL[f.total]) return `${AGG_LABEL[f.total]} de ${f.name}`;
  return f.name;
}

function selectBody(d: QueryDesign, ps: Params): string {
  const fields = d.fields;
  const conds = joinConds(d);
  const totals = fields.some((f) => f.total && f.total !== 'expr');
  const shown = fields.filter((f) => f.show && f.total !== 'where');
  const exprOf = (f: DesignField): string => {
    const base = colRef(d, f, ps);
    return f.total && AGG_SQL[f.total] ? `${AGG_SQL[f.total]}(${base})` : base;
  };
  const sel = (f: DesignField): string => {
    const e = exprOf(f);
    const out = outputName(f);
    const needAlias = out !== f.name || isCalc(f) || multiTable(d) || !!(f.total && AGG_SQL[f.total]);
    return needAlias ? `${e} AS ${q(out)}` : e;
  };
  const select = shown.length ? shown.map(sel).join(', ') : '*';

  // WHERE: plain fields. HAVING: criteria on aggregated fields.
  const plain = totals ? fields.filter((f) => !(f.total && AGG_SQL[f.total])) : fields;
  const agg = totals ? fields.filter((f) => f.total && AGG_SQL[f.total]) : [];
  const where = criteriaWhere(plain, (f) => colRef(d, f, ps), ps);
  const having = agg.length ? criteriaWhere(agg, exprOf, ps) : null;
  const whereAll = [...conds, ...(where ? [`(${where})`] : [])];

  let sql = `SELECT ${d.distinct ? 'DISTINCT ' : ''}${select}\n${fromClause(d)}`;
  if (whereAll.length) sql += `\nWHERE ${whereAll.join('\n  AND ')}`;
  if (totals) {
    const groups = fields.filter((f) => f.total === 'group').map((f) => colRef(d, f, ps));
    if (groups.length) sql += `\nGROUP BY ${groups.join(', ')}`;
    if (having) sql += `\nHAVING ${having}`;
  }
  const allOrder = fields.filter((f) => f.sort).map((f) => `${f.show && f.total !== 'where' ? q(outputName(f)) : exprOf(f)} ${f.sort === 'desc' ? 'DESC' : 'ASC'}`);
  if (allOrder.length) sql += `\nORDER BY ${allOrder.join(', ')}`;
  if (d.limit) sql += `\nLIMIT ${Math.floor(d.limit)}`;
  return sql;
}

/** The select of the fields as a subquery with plain output names (base of a crosstab). */
function crosstabBase(d: QueryDesign, ps: Params): string {
  const conds = joinConds(d);
  const used = d.fields.filter((f) => f.role);
  const where = criteriaWhere(d.fields, (f) => colRef(d, f, ps), ps);
  const whereAll = [...conds, ...(where ? [`(${where})`] : [])];
  let sql = `SELECT ${used.map((f) => `${colRef(d, f, ps)} AS ${q(outputName(f))}`).join(', ')}\n${fromClause(d)}`;
  if (whereAll.length) sql += `\nWHERE ${whereAll.join('\n  AND ')}`;
  return sql;
}

function crosstabSql(d: QueryDesign, ctx: CompileContext, ps: Params): Compiled {
  const rows = d.fields.filter((f) => f.role === 'row');
  const col = d.fields.find((f) => f.role === 'column');
  const val = d.fields.find((f) => f.role === 'value');
  if (!rows.length || !col || !val) throw new Error('Una consulta de referencias cruzadas necesita al menos un campo de fila, uno de columna y uno de valor.');
  const base = crosstabBase(d, ps);
  const fn = AGG_SQL[d.crosstabFn ?? 'sum']!;
  const cn = q(outputName(col));
  const vn = q(outputName(val));
  if (!ctx.crosstabValues) return { sql: `SELECT DISTINCT ${cn} FROM (${base}) ORDER BY 1`, params: ps.list, needsValues: true };
  const names = new Set<string>(rows.map((f) => outputName(f)));
  const cells = ctx.crosstabValues.map((v, i) => {
    let label = v === null || v === undefined || v === '' ? '(vacío)' : String(v);
    while (names.has(label)) label += ' ';
    names.add(label);
    void i;
    const cond = v === null || v === undefined ? `${cn} IS NULL` : `${cn} = ${lit(v)}`;
    return `${fn}(CASE WHEN ${cond} THEN ${vn} END) AS ${q(label)}`;
  });
  const total = `${fn}(${vn}) AS ${q('Total')}`;
  const rowCols = rows.map((f) => q(outputName(f)));
  const sql = `SELECT ${[...rowCols, ...cells, total].join(', ')}\nFROM (${base})\nGROUP BY ${rowCols.join(', ')}\nORDER BY ${rowCols.join(', ')}`;
  return { sql, params: ps.list };
}

function unionSql(d: QueryDesign, ctx: CompileContext): Compiled {
  const u = d.union;
  if (!u || u.sources.length < 2) throw new Error('Una consulta de unión necesita al menos dos orígenes.');
  const parts = u.sources.map((s) => {
    if (s.kind === 'table') return `SELECT * FROM ${q(s.name)}`;
    if (!ctx.resolveQuery) throw new Error('No se pueden resolver las consultas guardadas.');
    return `SELECT * FROM (${ctx.resolveQuery(s.name).replace(/[;\s]+$/, '')})`;
  });
  return { sql: parts.join(u.all ? '\nUNION ALL\n' : '\nUNION\n'), params: [] };
}

function targetColumns(d: QueryDesign): { f: DesignField; col: string }[] {
  return d.fields.filter((f) => f.show).map((f) => ({ f, col: (f.set ?? '').trim() || outputName(f) }));
}

function actionSql(d: QueryDesign, ps: Params): Compiled {
  const kind = d.kind!;
  if (!d.tables.length) throw new Error('Elija al menos una tabla.');
  const conds = joinConds(d);
  const where = criteriaWhere(d.fields, (f) => colRef(d, f, ps), ps);
  const whereAll = [...conds, ...(where ? [`(${where})`] : [])];
  const first = d.tables[0]!;
  const rowids = () => `SELECT ${q(first)}.rowid\n${fromClause(d)}${whereAll.length ? `\nWHERE ${whereAll.join('\n  AND ')}` : ''}`;
  if (kind === 'delete') return { sql: `DELETE FROM ${q(first)}\nWHERE rowid IN (${rowids()})`, params: ps.list };
  if (kind === 'update') {
    const sets = d.fields.filter((f) => !isCalc(f) && f.table === first && (f.set ?? '').trim());
    if (!sets.length) throw new Error('Indique en la fila "Actualizar a" qué valor recibe cada campo.');
    const list = sets.map((f) => `${q(f.name)} = ${valueOf(f.set!, ps)}`).join(', ');
    return { sql: `UPDATE ${q(first)}\nSET ${list}\nWHERE rowid IN (${rowids()})`, params: ps.list };
  }
  const cols = targetColumns(d);
  if (!cols.length) throw new Error('Marque al menos un campo para mostrar.');
  const target = d.target?.trim();
  if (!target) throw new Error(kind === 'append' ? 'Indique la tabla de destino.' : 'Indique el nombre de la tabla nueva.');
  const select = cols.map(({ f }) => `${colRef(d, f, ps)} AS ${q(outputName(f))}`).join(', ');
  const body = `SELECT ${d.distinct ? 'DISTINCT ' : ''}${select}\n${fromClause(d)}${whereAll.length ? `\nWHERE ${whereAll.join('\n  AND ')}` : ''}`;
  if (kind === 'append') return { sql: `INSERT INTO ${q(target)} (${cols.map(({ col }) => q(col)).join(', ')})\n${body}`, params: ps.list };
  return { sql: `CREATE TABLE ${q(target)} AS\n${body}`, params: ps.list };
}

/** Is this design a query that changes data (it must be confirmed before it runs). */
export const isActionDesign = (d: QueryDesign): boolean => d.kind === 'append' || d.kind === 'update' || d.kind === 'delete' || d.kind === 'maketable';

export function compileDesign(d: QueryDesign, ctx: CompileContext = {}): Compiled {
  const ps = new Params();
  const kind = d.kind ?? 'select';
  if (kind === 'union') return unionSql(d, ctx);
  if (!d.tables.length) return { sql: '', params: [] };
  if (kind === 'crosstab') return crosstabSql(d, ctx, ps);
  if (kind !== 'select') return actionSql(d, ps);
  const sql = selectBody(d, ps);
  return { sql, params: ps.list };
}

/** The SQL of a design (a crosstab needs `ctx.crosstabValues`; without them the SQL that lists its columns is returned). */
export function designToSql(d: QueryDesign, ctx: CompileContext = {}): string {
  try {
    return compileDesign(d, ctx).sql;
  } catch {
    return '';
  }
}

/** Parameters of raw SQL: `:name`, `@name` and `$name` outside string literals, comments and quoted identifiers. */
export function sqlParams(sql: string): QueryParam[] {
  const out: QueryParam[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = sql.indexOf(ch, i + 1);
      i = end < 0 ? sql.length : end + 1; // a doubled quote simply opens the next literal
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl < 0 ? sql.length : nl + 1;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
      continue;
    }
    if ((ch === ':' || ch === '@' || ch === '$') && /[\p{L}_]/u.test(sql[i + 1] ?? '')) {
      let j = i + 1;
      while (j < sql.length && /[\p{L}\p{N}_]/u.test(sql[j]!)) j++;
      const key = sql.slice(i + 1, j);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ key, label: key.replace(/_/g, ' ') });
      }
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

/** Bind values for `execute`: SQLite wants the prefix in the key. */
export function bindParams(sql: string, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of sqlParams(sql)) {
    const prefix = new RegExp(`([:@$])${p.key}(?![\\p{L}\\p{N}_])`, 'u').exec(sql)?.[1] ?? ':';
    const v = values[p.key];
    out[`${prefix}${p.key}`] = v === undefined ? null : v;
  }
  return out;
}
