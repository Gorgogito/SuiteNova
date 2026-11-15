import { lit, q } from './design';

/*
 * What the datasheet of a table asks the database for: filters per column, several sort keys, totals and find/replace. Everything is
 * built as SQL text with the values written as literals (`lit`), exactly like the rest of the engine.
 */

export type FilterOp = 'eq' | 'ne' | 'contains' | 'notcontains' | 'begins' | 'ends' | 'lt' | 'gt' | 'le' | 'ge' | 'between' | 'null' | 'notnull' | 'in';
export interface ColumnFilter {
  col: string;
  op: FilterOp;
  value?: string;
  value2?: string;
  /** for `in`: the values chosen in the list */
  values?: (string | null)[];
}
export interface SortKey {
  col: string;
  desc: boolean;
}
export type AggFn = 'sum' | 'avg' | 'count' | 'min' | 'max' | 'countnn' | 'countdistinct';
export const AGG_FNS: AggFn[] = ['sum', 'avg', 'count', 'min', 'max', 'countnn', 'countdistinct'];

const NUMERIC = /^(INTEGER|REAL|BOOLEAN)$/i;
/** A LIKE pattern: the value is escaped, the wildcards around it are not. */
const like = (before: string, v: string, after: string) => lit(before + v.replace(/[\\%_]/g, (m) => '\\' + m) + after);

/** The value as the column stores it: numbers as numbers (so 10 > 9), the rest as text. */
const typed = (v: string | undefined, type: string): string => {
  const s = (v ?? '').trim();
  if (NUMERIC.test(type)) {
    const n = Number(s.replace(',', '.'));
    if (s !== '' && Number.isFinite(n)) return String(n);
  }
  return lit(v ?? '');
};

/** SQL condition of one column filter, or null when it has no value to compare. */
export function filterCondition(f: ColumnFilter, type: string): string | null {
  const c = q(f.col);
  const has = f.value !== undefined && f.value !== '';
  switch (f.op) {
    case 'null':
      return `(${c} IS NULL OR ${c} = '')`;
    case 'notnull':
      return `(${c} IS NOT NULL AND ${c} <> '')`;
    case 'eq':
      return has ? `${c} = ${typed(f.value, type)}` : `(${c} IS NULL OR ${c} = '')`;
    case 'ne':
      return has ? `(${c} IS NULL OR ${c} <> ${typed(f.value, type)})` : `(${c} IS NOT NULL AND ${c} <> '')`;
    case 'contains':
      return has ? `CAST(${c} AS TEXT) LIKE ${like('%', f.value!, '%')} ESCAPE '\\'` : null;
    case 'notcontains':
      return has ? `(${c} IS NULL OR CAST(${c} AS TEXT) NOT LIKE ${like('%', f.value!, '%')} ESCAPE '\\')` : null;
    case 'begins':
      return has ? `CAST(${c} AS TEXT) LIKE ${like('', f.value!, '%')} ESCAPE '\\'` : null;
    case 'ends':
      return has ? `CAST(${c} AS TEXT) LIKE ${like('%', f.value!, '')} ESCAPE '\\'` : null;
    case 'lt':
      return has ? `${c} < ${typed(f.value, type)}` : null;
    case 'gt':
      return has ? `${c} > ${typed(f.value, type)}` : null;
    case 'le':
      return has ? `${c} <= ${typed(f.value, type)}` : null;
    case 'ge':
      return has ? `${c} >= ${typed(f.value, type)}` : null;
    case 'between':
      return has && f.value2 !== undefined && f.value2 !== '' ? `${c} BETWEEN ${typed(f.value, type)} AND ${typed(f.value2, type)}` : null;
    case 'in': {
      const vals = f.values ?? [];
      if (!vals.length) return '0';
      const nulls = vals.includes(null);
      const rest = vals.filter((v): v is string => v !== null);
      const parts: string[] = [];
      if (rest.length) parts.push(`${c} IN (${rest.map((v) => typed(v, type)).join(', ')})`);
      if (nulls) parts.push(`${c} IS NULL OR ${c} = ''`);
      return `(${parts.join(' OR ')})`;
    }
  }
}

/** ` AND `-joined conditions of all the filters (those of columns that do not exist are ignored). */
export function filtersClause(filters: ColumnFilter[] | undefined, types: Map<string, string>): string[] {
  const out: string[] = [];
  for (const f of filters ?? []) {
    const type = types.get(f.col);
    if (type === undefined) continue;
    const c = filterCondition(f, type);
    if (c) out.push(c);
  }
  return out;
}

/** ` ORDER BY …` for several keys (columns that do not exist are ignored). */
export function orderClause(sorts: SortKey[] | undefined, names: Set<string>): string {
  const keys = (sorts ?? []).filter((s) => names.has(s.col));
  return keys.length ? ` ORDER BY ${keys.map((s) => `${q(s.col)} ${s.desc ? 'DESC' : 'ASC'}`).join(', ')}` : '';
}

export function aggregateSql(fn: AggFn, col: string): string {
  const c = q(col);
  switch (fn) {
    case 'sum':
      return `SUM(${c})`;
    case 'avg':
      return `AVG(${c})`;
    case 'count':
      return 'COUNT(*)';
    case 'countnn':
      return `COUNT(${c})`;
    case 'countdistinct':
      return `COUNT(DISTINCT ${c})`;
    case 'min':
      return `MIN(${c})`;
    case 'max':
      return `MAX(${c})`;
  }
}

/** Which totals make sense for a column type (Access offers sum and average for numbers only). */
export const aggregatesFor = (type: string): AggFn[] => (/^(INTEGER|REAL)$/i.test(type) ? AGG_FNS : ['count', 'countnn', 'countdistinct', 'min', 'max']);

/** SQL condition: some of the columns matches. */
export function findCondition(cols: string[], o: FindOptions): string {
  const parts = cols.map((name) => {
    const c = `CAST(${q(name)} AS TEXT)`;
    const a = o.matchCase ? c : `lower(${c})`;
    const f = lit(o.matchCase ? o.find : o.find.toLowerCase());
    if (o.match === 'whole') return `${a} = ${f}`;
    if (o.match === 'start') return `substr(${a}, 1, ${[...o.find].length}) = ${f}`;
    return `instr(${a}, ${f}) > 0`;
  });
  return parts.length ? `(${parts.join(' OR ')})` : '0';
}

export interface FindOptions {
  find: string;
  /** all columns when empty */
  cols?: string[];
  matchCase?: boolean;
  /** 'any' = anywhere in the value, 'whole' = the whole value, 'start' = the start of the value */
  match?: 'any' | 'whole' | 'start';
}

/** Does the text match? Same rules as the find box. */
export function matches(text: string, o: FindOptions): boolean {
  const a = o.matchCase ? text : text.toLowerCase();
  const f = o.matchCase ? o.find : o.find.toLowerCase();
  if (o.match === 'whole') return a === f;
  if (o.match === 'start') return a.startsWith(f);
  return a.includes(f);
}

/** The text with what matched replaced (every occurrence, or the whole value for 'whole'). */
export function replaceIn(text: string, o: FindOptions, to: string): string {
  if (o.match === 'whole') return matches(text, o) ? to : text;
  const esc = o.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(o.match === 'start' ? '^' + esc : esc, o.matchCase ? 'g' : 'gi'), () => to);
}
