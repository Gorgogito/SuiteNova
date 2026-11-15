import { lit, q } from './design';

/*
 * Field and table properties that SQLite has no place for (Access keeps them in the table design): description, caption, display
 * format, input mask, validation rule and text, and lookup. They are saved with the table in the file. Validation rules are enforced
 * by triggers, so they hold for the datasheet, forms, imports and code alike.
 */

export type FieldKind = 'memo' | 'currency' | 'hyperlink' | 'attachment';

export type Lookup = { kind: 'list'; items: string[]; limit?: boolean } | { kind: 'table'; table: string; valueCol: string; displayCol: string; limit?: boolean };

export interface FieldMeta {
  /** what the field is for (shown in the design view) */
  description?: string;
  /** the name that shows in the datasheet header */
  caption?: string;
  /** a special kind over the stored type */
  kind?: FieldKind;
  /** The Access expression of a calculated field (`[Precio] * [Cantidad]`). The table itself keeps the SQL of it (a generated column). */
  calc?: string;
  /** display format: number (general, fixed, standard, percent, scientific, currency), date (short, medium, long, time), yes/no (yesno, truefalse, onoff), text (upper, lower) */
  format?: string;
  decimals?: number;
  /** currency code for the currency format (USD, EUR, PEN…) */
  currency?: string;
  inputMask?: string;
  /** an Access-style condition on the value: `>=0 And <=100`, `Like "A*"`, `Is Not Null`, or an expression with [fields] */
  rule?: string;
  ruleText?: string;
  lookup?: Lookup;
}

/** The events of a table that can run a macro (data macros). `beforeChange` runs right after the write inside the same statement and can change the row or refuse it. */
export const DATA_EVENTS = ['beforeChange', 'beforeDelete', 'afterInsert', 'afterUpdate', 'afterDelete'] as const;
export type DataEvent = (typeof DATA_EVENTS)[number];
/** Most fields a table with data macros can have (SQLite allows 127 arguments to a function: new values, old values and three more). */
export const MAX_DATA_MACRO_FIELDS = 60;
type MacroLike = { steps: unknown[]; description?: string };

export interface TableMeta {
  description?: string;
  /** Macros that run when a record is changed, whoever changes it (a form, SQL, an import or code). */
  dataMacros?: Partial<Record<DataEvent, MacroLike>>;
  /** an expression over several fields: `[Fin] >= [Inicio]` */
  rule?: string;
  ruleText?: string;
  fields: Record<string, FieldMeta>;
}

export const emptyMeta = (): TableMeta => ({ fields: {} });

const hasValues = (o: object) => Object.values(o).some((v) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length));
/** The metadata without empty entries; null when nothing is left. */
export function cleanMeta(m: TableMeta): TableMeta | null {
  const fields: Record<string, FieldMeta> = {};
  for (const [k, f] of Object.entries(m.fields)) {
    const c = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as FieldMeta;
    if (hasValues(c)) fields[k] = c;
  }
  const dm = Object.fromEntries(Object.entries(m.dataMacros ?? {}).filter(([, v]) => v && v.steps.length)) as TableMeta['dataMacros'];
  const out: TableMeta = { ...(m.description?.trim() ? { description: m.description.trim() } : {}), ...(m.rule?.trim() ? { rule: m.rule.trim() } : {}), ...(m.ruleText?.trim() ? { ruleText: m.ruleText.trim() } : {}), ...(dm && Object.keys(dm).length ? { dataMacros: dm } : {}), fields };
  return out.description || out.rule || out.ruleText || out.dataMacros || Object.keys(fields).length ? out : null;
}

// ------------------------------------------------------------------------------------------------ attachments

/** A file kept inside a field of kind `attachment`: the field holds a JSON list of these. */
export interface Attachment {
  name: string;
  mime: string;
  size: number;
  /** the bytes, in base64 */
  data: string;
}
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_FIELD = 20;

/** The attachments a stored value holds (an empty or damaged value holds none). */
export function parseAttachments(text: unknown): Attachment[] {
  if (typeof text !== 'string' || !text.trim().startsWith('[')) return [];
  try {
    const list = JSON.parse(text) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter((a): a is Attachment => !!a && typeof a === 'object' && typeof (a as Attachment).name === 'string' && typeof (a as Attachment).data === 'string').map((a) => ({ name: a.name, mime: typeof a.mime === 'string' ? a.mime : 'application/octet-stream', size: Number(a.size) || 0, data: a.data }));
  } catch {
    return [];
  }
}
/** The value to store for a list of attachments (null when there are none). */
export function serializeAttachments(list: Attachment[]): string | null {
  return list.length ? JSON.stringify(list) : null;
}
/** Add a file (its bytes in base64) to a stored value. Throws a readable error when it does not fit. */
export function addAttachment(text: unknown, file: { name: string; mime?: string; bytes: Uint8Array }): string {
  const list = parseAttachments(text);
  if (file.bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`«${file.name}» pesa más de ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`);
  if (list.length >= MAX_ATTACHMENTS_PER_FIELD) throw new Error(`Un campo admite hasta ${MAX_ATTACHMENTS_PER_FIELD} archivos adjuntos.`);
  let name = file.name.trim() || 'archivo';
  const base = name.replace(/(\.[^.]*)?$/, '');
  const ext = name.slice(base.length);
  for (let i = 2; list.some((a) => a.name.toLowerCase() === name.toLowerCase()); i++) name = `${base} (${i})${ext}`;
  let bin = '';
  for (let i = 0; i < file.bytes.length; i += 0x8000) bin += String.fromCharCode(...file.bytes.subarray(i, i + 0x8000));
  list.push({ name, mime: file.mime || 'application/octet-stream', size: file.bytes.length, data: btoa(bin) });
  return JSON.stringify(list);
}
export function attachmentBytes(a: Attachment): Uint8Array {
  const bin = atob(a.data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/** What a cell shows for an attachment field: `📎 2`. */
export const attachmentLabel = (text: unknown): string => {
  const n = parseAttachments(text).length;
  return n ? `📎 ${n}` : '';
};

// ------------------------------------------------------------------------------------------------ calculated fields

/**
 * The SQL of the Access expression of a calculated field (`[Precio] * [Cantidad]`, `IIf([a] > 0, [a], 0)`). The fields it names must exist
 * in `fields`. SQLite only accepts expressions whose result depends only on the record: functions such as `Date()` are refused by it.
 */
export function calcToSql(expr: string, fields: string[], self?: string): string {
  const have = new Map(fields.map((f) => [f.toLowerCase(), f]));
  const sql = ruleToSql(expr, null, (n) => {
    const real = have.get(n.toLowerCase());
    if (!real) throw new Error(`El campo [${n}] no existe en la tabla.`);
    if (self && real.toLowerCase() === self.toLowerCase()) throw new Error('Un campo calculado no puede usarse a sí mismo.');
    return q(real);
  });
  if (!sql) throw new Error(`No se entiende la expresión «${expr}».`);
  return sql;
}

// ------------------------------------------------------------------------------------------------ display format

export const NUMBER_FORMATS = ['general', 'fixed', 'standard', 'percent', 'scientific', 'currency'] as const;
export const DATE_FORMATS = ['iso', 'short', 'medium', 'long', 'time'] as const;
export const BOOL_FORMATS = ['checkbox', 'yesno', 'truefalse', 'onoff'] as const;
export const TEXT_FORMATS = ['none', 'upper', 'lower'] as const;

const BOOL_WORDS: Record<string, [string, string]> = { yesno: ['Sí', 'No'], truefalse: ['Verdadero', 'Falso'], onoff: ['Activado', 'Desactivado'] };

/** The value as the datasheet shows it, or null to show it as it is stored. */
export function formatField(v: unknown, type: string, m: FieldMeta | undefined, locale?: string): string | null {
  if (v === null || v === undefined || v === '' || !m) return null;
  if (m.kind === 'attachment') return attachmentLabel(v);
  const T = type.toUpperCase();
  const fmt = m.format;
  const kind = m.kind;
  if (T === 'BOOLEAN') {
    const w = fmt ? BOOL_WORDS[fmt] : undefined;
    return w ? w[Number(v) ? 0 : 1] : null;
  }
  if (T === 'INTEGER' || T === 'REAL') {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    const dec = m.decimals;
    const f = fmt ?? (kind === 'currency' ? 'currency' : 'general');
    const fixed = (d: number) => ({ minimumFractionDigits: d, maximumFractionDigits: d });
    switch (f) {
      case 'fixed':
        return n.toLocaleString(locale, { useGrouping: false, ...fixed(dec ?? 2) });
      case 'standard':
        return n.toLocaleString(locale, fixed(dec ?? 2));
      case 'percent':
        return n.toLocaleString(locale, { style: 'percent', ...fixed(dec ?? 0) });
      case 'scientific':
        return n.toExponential(dec ?? 2).toUpperCase().replace('E+', 'E+').replace(/E([+-])(\d)$/, 'E$10$2');
      case 'currency':
        return n.toLocaleString(locale, { style: 'currency', currency: m.currency || 'USD', ...(dec !== undefined ? fixed(dec) : {}) });
      default:
        return dec !== undefined ? n.toLocaleString(locale, { useGrouping: false, ...fixed(dec) }) : null;
    }
  }
  if (T === 'DATE' || T === 'DATETIME') {
    const s = String(v);
    const mm = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
    if (!mm || !fmt || fmt === 'iso') return null;
    const d = new Date(Number(mm[1]), Number(mm[2]) - 1, Number(mm[3]), Number(mm[4] ?? 0), Number(mm[5] ?? 0));
    if (fmt === 'short') return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }) + (mm[4] ? ' ' + d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '');
    if (fmt === 'medium') return d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
    if (fmt === 'long') return d.toLocaleDateString(locale, { dateStyle: 'full' });
    if (fmt === 'time') return mm[4] ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : null;
    return null;
  }
  const s = String(v);
  if (fmt === 'upper') return s.toUpperCase();
  if (fmt === 'lower') return s.toLowerCase();
  return null;
}

// ------------------------------------------------------------------------------------------------ input masks

export interface MaskPart {
  /** `0 9 # L ? A a & C` for a place that takes a character; `lit` for a fixed one */
  kind: string;
  lit?: string;
}
export interface Mask {
  parts: MaskPart[];
  /** `<` lower case, `>` upper case, per place from the marker on */
  caseAt: ('upper' | 'lower' | null)[];
}

/** Reads an Access input mask (the first section only). */
export function parseMask(mask: string): Mask {
  const first = mask.split(/(?<!\\);/)[0] ?? '';
  const parts: MaskPart[] = [];
  const caseAt: ('upper' | 'lower' | null)[] = [];
  let mode: 'upper' | 'lower' | null = null;
  for (let i = 0; i < first.length; i++) {
    const ch = first[i]!;
    if (ch === '\\') {
      parts.push({ kind: 'lit', lit: first[++i] ?? '' });
      caseAt.push(null);
    } else if (ch === '>') mode = 'upper';
    else if (ch === '<') mode = 'lower';
    else if (ch === '!') continue;
    else if ('09#L?AaCc&'.includes(ch)) {
      parts.push({ kind: ch === 'c' ? 'C' : ch });
      caseAt.push(mode);
    } else if (ch === '"') {
      const end = first.indexOf('"', i + 1);
      for (const l of first.slice(i + 1, end < 0 ? undefined : end)) (parts.push({ kind: 'lit', lit: l }), caseAt.push(null));
      i = end < 0 ? first.length : end;
    } else {
      parts.push({ kind: 'lit', lit: ch });
      caseAt.push(null);
    }
  }
  return { parts, caseAt };
}

const TAKES: Record<string, RegExp> = { '0': /\d/, '9': /\d/, '#': /[\d +-]/, L: /\p{L}/u, '?': /\p{L}/u, A: /[\p{L}\d]/u, a: /[\p{L}\d]/u, '&': /./u, C: /./u };
const REQUIRED = new Set(['0', 'L', 'A', '&']);

/** The text formatted with the mask (the user may type the fixed symbols or leave them out), or null when it does not fit. */
export function applyMask(maskText: string, input: string): string | null {
  const { parts, caseAt } = parseMask(maskText);
  const lits = new Set(parts.filter((p) => p.kind === 'lit').map((p) => p.lit!));
  // first try the text as typed (with its symbols), then without them
  for (const source of [[...input], [...input].filter((c) => !lits.has(c))]) {
    let si = 0;
    let out = '';
    let keep = 0; // length of `out` up to the last place that was filled
    let ok = true;
    for (let pi = 0; pi < parts.length && ok; pi++) {
      const p = parts[pi]!;
      if (p.kind === 'lit') {
        if (source[si] === p.lit) si++;
        out += p.lit;
        continue;
      }
      const c = source[si];
      if (c !== undefined && TAKES[p.kind]!.test(c)) {
        out += caseAt[pi] === 'upper' ? c.toUpperCase() : caseAt[pi] === 'lower' ? c.toLowerCase() : c;
        keep = out.length;
        si++;
      } else if (REQUIRED.has(p.kind) || c !== undefined) ok = false;
    }
    if (ok && si >= source.length) return out.slice(0, Math.max(keep, 0));
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ validation rules → SQL

const WORD: Record<string, string> = { y: 'AND', and: 'AND', o: 'OR', or: 'OR', no: 'NOT', not: 'NOT', es: 'IS', is: 'IS', nulo: 'NULL', null: 'NULL', como: 'LIKE', like: 'LIKE', entre: 'BETWEEN', between: 'BETWEEN', en: 'IN', in: 'IN', verdadero: '1', true: '1', falso: '0', false: '0', sí: '1', si: '1', date: "date('now')", fecha: "date('now')", now: "datetime('now')", ahora: "datetime('now')" };
const FUNC: Record<string, string> = { len: 'length', largo: 'length', nz: 'IFNULL', iif: 'iif', ucase: 'upper', lcase: 'lower', trim: 'trim', ltrim: 'ltrim', rtrim: 'rtrim', mid: 'substr', abs: 'abs', round: 'round' };

/**
 * Translates an Access condition to SQL. `subject` is the SQL text of the value the rule is about (the new value of the field): a rule that
 * starts with an operator (`>0`, `Like "A*"`, `Between 1 And 5`, `Is Not Null`, `In ("a","b")`) refers to it implicitly. `[Field]` becomes
 * `field(name)`. Returns null when the text cannot be translated.
 */
export function ruleToSql(rule: string, subject: string | null, field: (name: string) => string): string | null {
  const tokens: string[] = [];
  const re = /\s*("(?:[^"]|"")*"|'(?:[^']|'')*'|\[[^\]]+\]|<=|>=|<>|!=|[<>=(),+\-*/&]|[\p{L}_][\p{L}\p{N}_]*|\d+(?:[.,]\d+)?|\S)/uy;
  let m: RegExpExecArray | null;
  while (re.lastIndex < rule.length && (m = re.exec(rule))) tokens.push(m[1]!);
  if (re.lastIndex < rule.trim().length) return null;
  const out: string[] = [];
  let atStart = true;
  let inBetween = false;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const word = /^[\p{L}_]/u.test(tok);
    const low = tok.toLowerCase();
    const mapped = word ? WORD[low] : undefined;
    const next = tokens[i + 1];
    if (/^[^\p{L}\p{N}_\[\]"'<>=(),+\-*/&!.]$/u.test(tok)) return null;
    let piece: string;
    if (tok.startsWith('[')) piece = field(tok.slice(1, -1));
    else if (tok.startsWith('"')) {
      const text = tok.slice(1, -1).replace(/""/g, '"');
      piece = lit(out[out.length - 1] === 'LIKE' ? text.replace(/\*/g, '%').replace(/\?/g, '_') : text);
    }
    else if (tok.startsWith("'")) piece = tok;
    else if (mapped === 'NOT' && ['=', '<>', '<', '>', '<=', '>='].includes(out[out.length - 1] ?? '')) piece = '0';
    else if (mapped !== undefined) piece = mapped;
    else if (word && next === '(' && FUNC[low]) piece = FUNC[low]!;
    else if (/^\d+,\d+$/.test(tok)) piece = tok.replace(',', '.');
    else if (tok === '&') piece = '||';
    else if (tok === '!=') piece = '<>';
    else piece = tok;
    if (piece === 'BETWEEN') inBetween = true;
    if (piece === 'AND' && inBetween) {
      inBetween = false;
      out.push('AND');
      continue;
    }
    const operatorStart = ['<', '>', '=', '<=', '>=', '<>'].includes(tok) || ['LIKE', 'BETWEEN', 'IN', 'IS'].includes(piece);
    const notStart = piece === 'NOT' && ['LIKE', 'BETWEEN', 'IN'].includes(WORD[(next ?? '').toLowerCase()] ?? '');
    let usedSubject = false;
    if (atStart && subject && (operatorStart || notStart)) {
      out.push(subject);
      usedSubject = true;
    }
    out.push(piece);
    atStart = !usedSubject && (piece === 'AND' || piece === 'OR' || piece === 'NOT' || piece === '(');
  }
  // `Fecha()` / `Ahora()` map to date('now') / datetime('now'): the empty parentheses of the Access call are not repeated
  const sql = out.join(' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s+,/g, ',').replace(/(\('now'\))\s*\(\)/g, '$1').trim();
  return sql || null;
}

const NAME_PREFIX = '__nova_val_';
/** The SQL function the data macro triggers call; the program registers it on every connection. */
export const DATA_MACRO_FUNCTION = '__nova_dm';

/**
 * The triggers that make the data macros of a table run. Each calls `__nova_dm(table, event, rowid, …new values, …old values)`.
 * They carry the prefix of the validation triggers, so they are dropped and recreated together with them.
 */
export function dataMacroTriggers(table: string, columns: string[], m: TableMeta): string[] {
  const events = Object.keys(m.dataMacros ?? {}) as DataEvent[];
  if (!events.length) return [];
  if (columns.length > MAX_DATA_MACRO_FIELDS) throw new Error(`Una tabla con macros de datos admite hasta ${MAX_DATA_MACRO_FIELDS} campos (esta tiene ${columns.length}).`);
  const pre = `${validationTriggerPrefix(table)}dm_`;
  const n = (c: string) => `NEW.${q(c)}`;
  const o = (c: string) => `OLD.${q(c)}`;
  const nulls = columns.map(() => 'NULL').join(', ');
  const call = (ev: string, rowid: string, news: string, olds: string) => `SELECT ${DATA_MACRO_FUNCTION}(${lit(table)}, ${lit(ev)}, ${rowid}${columns.length ? `, ${news}, ${olds}` : ''});`;
  const out: string[] = [];
  const mk = (name: string, when: string, body: string) => out.push(`CREATE TRIGGER ${q(`${pre}${name}`)} ${when} ON ${q(table)} BEGIN ${body} END`);
  const nw = columns.map(n).join(', ');
  const od = columns.map(o).join(', ');
  // SQLite fires the triggers of an event from the last created to the first: the ones that must run first are made last
  const ORDER: DataEvent[] = ['afterInsert', 'afterUpdate', 'afterDelete', 'beforeDelete', 'beforeChange'];
  for (const ev of ORDER.filter((e) => events.includes(e))) {
    if (ev === 'afterInsert') mk(ev, 'AFTER INSERT', call(ev, 'NEW.rowid', nw, nulls));
    else if (ev === 'afterUpdate') mk(ev, 'AFTER UPDATE', call(ev, 'NEW.rowid', nw, od));
    else if (ev === 'afterDelete') mk(ev, 'AFTER DELETE', call(ev, 'OLD.rowid', od, od));
    else if (ev === 'beforeDelete') mk(ev, 'BEFORE DELETE', call(ev, 'OLD.rowid', od, od));
    else if (ev === 'beforeChange') {
      mk('beforeChange_ins', 'AFTER INSERT', call('beforeChange:insert', 'NEW.rowid', nw, nulls));
      mk('beforeChange_upd', 'AFTER UPDATE', call('beforeChange:update', 'NEW.rowid', nw, od));
    }
  }
  return out;
}
export const validationTriggerPrefix = (table: string): string => `${NAME_PREFIX}${table}__`;

/** The statements that create the triggers enforcing the rules of a table. Throws a readable error for a rule that cannot be read. */
export function validationTriggers(table: string, m: TableMeta): string[] {
  const out: string[] = [];
  const pre = validationTriggerPrefix(table);
  const newRef = (name: string) => `NEW.${q(name)}`;
  for (const [col, f] of Object.entries(m.fields)) {
    if (!f.rule?.trim()) continue;
    const cond = ruleToSql(f.rule, newRef(col), newRef);
    if (!cond) throw new Error(`La regla de validación del campo «${col}» no se entiende.`);
    const msg = lit(f.ruleText?.trim() || `El valor de «${col}» no cumple la regla: ${f.rule.trim()}`);
    const when = `WHEN NEW.${q(col)} IS NOT NULL AND NOT (${cond})`;
    out.push(`CREATE TRIGGER ${q(`${pre}${col}__ins`)} BEFORE INSERT ON ${q(table)} ${when} BEGIN SELECT RAISE(ABORT, ${msg}); END`);
    out.push(`CREATE TRIGGER ${q(`${pre}${col}__upd`)} BEFORE UPDATE OF ${q(col)} ON ${q(table)} ${when} BEGIN SELECT RAISE(ABORT, ${msg}); END`);
  }
  if (m.rule?.trim()) {
    const cond = ruleToSql(m.rule, null, newRef);
    if (!cond) throw new Error('La regla de validación de la tabla no se entiende.');
    const msg = lit(m.ruleText?.trim() || `El registro no cumple la regla: ${m.rule.trim()}`);
    const when = `WHEN NOT (${cond})`;
    out.push(`CREATE TRIGGER ${q(`${pre}_table__ins`)} BEFORE INSERT ON ${q(table)} ${when} BEGIN SELECT RAISE(ABORT, ${msg}); END`);
    out.push(`CREATE TRIGGER ${q(`${pre}_table__upd`)} BEFORE UPDATE ON ${q(table)} ${when} BEGIN SELECT RAISE(ABORT, ${msg}); END`);
  }
  return out;
}
