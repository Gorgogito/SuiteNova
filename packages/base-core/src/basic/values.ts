/** Values of Nova Basic: Null, Empty, Boolean, Double (numbers), String, Date, arrays and objects. */

export class BasicError extends Error {
  constructor(
    readonly number: number,
    readonly description: string,
    public line?: number,
    public module?: string,
    public proc?: string,
  ) {
    super(description);
    this.name = 'BasicError';
  }
  /** "Error 13 en Módulo1, línea 4 (Principal): Tipo no coincide" */
  get where(): string {
    return `${this.module ? `${this.module}` : ''}${this.line ? `${this.module ? ', ' : ''}línea ${this.line}` : ''}${this.proc ? ` (${this.proc})` : ''}`.trim();
  }
  get full(): string {
    const w = this.where;
    return `Error ${this.number}${w ? ` en ${w}` : ''}: ${this.description}`;
  }
}

// error numbers and texts of VBA that scripts see in Err
export const ERR = {
  overflow: (): BasicError => new BasicError(6, 'Desbordamiento'),
  divZero: (): BasicError => new BasicError(11, 'División por cero'),
  invalidCall: (m = 'Llamada a procedimiento no válida'): BasicError => new BasicError(5, m),
  typeMismatch: (m = 'Tipo no coincide'): BasicError => new BasicError(13, m),
  subscript: (): BasicError => new BasicError(9, 'El subíndice está fuera del intervalo'),
  noObject: (): BasicError => new BasicError(91, 'Variable de objeto o bloque With no establecida'),
  objectRequired: (): BasicError => new BasicError(424, 'Se requiere un objeto'),
  notSupported: (what: string): BasicError => new BasicError(438, `El objeto no admite esta propiedad o método: ${what}`),
  undefinedName: (n: string): BasicError => new BasicError(35, `Sub o Function no definido: ${n}`),
  nullUse: (): BasicError => new BasicError(94, 'Uso no válido de Null'),
};

/** A host object (database, form, recordset…) that scripts can call methods on. */
export interface BObject {
  readonly typeName: string;
  /** `obj.Name`, `obj.Name(args)`: read a property or call a method. */
  get(member: string, args: BVal[]): BVal;
  /** `obj.Name = value`. */
  set(member: string, args: BVal[], value: BVal): void;
  /** `obj(args)` and `obj!name`: the default member. */
  index?(args: BVal[]): BVal;
  setIndex?(args: BVal[], value: BVal): void;
  /** `For Each x In obj` */
  items?(): BVal[];
}

export const NOTHING = Object.freeze({ nothing: true }) as { readonly nothing: true };
export type Nothing = typeof NOTHING;
/** `null` is Null, `undefined` is Empty. */
export type BVal = null | undefined | boolean | number | string | Date | VArray | BObject | Nothing;

export class VArray {
  readonly dims: { lo: number; hi: number }[];
  data: BVal[];
  constructor(dims: { lo: number; hi: number }[], fill: BVal = undefined) {
    this.dims = dims;
    let n = 1;
    for (const d of dims) n *= Math.max(0, d.hi - d.lo + 1);
    if (n > 5_000_000) throw new BasicError(7, 'Memoria insuficiente');
    this.data = new Array<BVal>(n).fill(fill);
  }
  static of(values: BVal[], lo = 0): VArray {
    const a = new VArray([{ lo, hi: lo + values.length - 1 }]);
    a.data = [...values];
    return a;
  }
  flat(idx: number[]): number {
    if (idx.length !== this.dims.length) throw ERR.subscript();
    let f = 0;
    for (let i = 0; i < idx.length; i++) {
      const d = this.dims[i]!;
      const k = idx[i]!;
      if (k < d.lo || k > d.hi) throw ERR.subscript();
      f = f * (d.hi - d.lo + 1) + (k - d.lo);
    }
    return f;
  }
  get(idx: number[]): BVal {
    return this.data[this.flat(idx)];
  }
  set(idx: number[], v: BVal): void {
    this.data[this.flat(idx)] = v;
  }
  get length(): number {
    return this.data.length;
  }
}

export const isObject = (v: BVal): v is BObject => typeof v === 'object' && v !== null && !(v instanceof Date) && !(v instanceof VArray) && v !== NOTHING;
export const isNothing = (v: BVal): v is Nothing => v === NOTHING;

// ------------------------------------------------------------------------------------------------ dates

const DAY = 86_400_000;
/** Excel/VBA serial date: days since 1899-12-30. */
const BASE_UTC = Date.UTC(1899, 11, 30);
/** Computed on the calendar fields (not on timestamps), so that daylight saving never moves a day. */
export const toSerial = (d: Date): number => (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()) - BASE_UTC) / DAY;
export const fromSerial = (n: number): Date => {
  const u = new Date(BASE_UTC + Math.round(n * DAY));
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds(), u.getUTCMilliseconds());
};

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function parseDateText(s: string): Date | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  let d: Date | null = null;
  if (m) d = new Date(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t))) d = new Date(+m[3]!, +m[2]! - 1, +m[1]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  else if ((m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t))) d = new Date(1899, 11, 30, +m[1]!, +m[2]!, +(m[3] ?? 0));
  if (!d || Number.isNaN(d.getTime())) return null;
  // reject 31/02 and similar: the parts must survive the round trip
  if (m && /^\d{4}-/.test(t) && (d.getMonth() + 1 !== +m[2]! || d.getDate() !== +m[3]!)) return null;
  if (m && /^\d{1,2}[/.-]/.test(t) && (d.getMonth() + 1 !== +m[2]! || d.getDate() !== +m[1]!)) return null;
  return d;
}

export function dateToText(d: Date): string {
  const hasTime = d.getHours() || d.getMinutes() || d.getSeconds();
  const isTimeOnly = d.getFullYear() === 1899 && d.getMonth() === 11 && d.getDate() === 30;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  if (isTimeOnly) return time;
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return hasTime ? `${date} ${time}` : date;
}

// ------------------------------------------------------------------------------------------------ conversions

export function numberText(n: number): string {
  if (!Number.isFinite(n)) return Number.isNaN(n) ? 'NaN' : n > 0 ? '1E+308' : '-1E+308';
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  let s = String(Number(n.toPrecision(15)));
  if (/e/i.test(s)) s = s.replace(/e\+?(-?)(\d+)/i, (_m, sign, d) => `E${sign || '+'}${String(d).padStart(2, '0')}`);
  return s;
}

export function toStr(v: BVal): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return numberText(v);
  if (typeof v === 'boolean') return v ? 'Verdadero' : 'Falso';
  if (v instanceof Date) return dateToText(v);
  if (v instanceof VArray) throw ERR.typeMismatch();
  if (v === NOTHING) throw ERR.noObject();
  const o = v as BObject;
  try {
    const d = o.index ? o.index([]) : o.get('value', []);
    return toStr(d);
  } catch {
    throw ERR.typeMismatch();
  }
}

/** A number from a number, a numeric text, a boolean (True is -1) or a date. Empty is 0; anything else is a type mismatch. */
export function toNum(v: BVal): number {
  if (v === undefined) return 0;
  if (v === null) throw ERR.nullUse();
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? -1 : 0;
  if (v instanceof Date) return toSerial(v);
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^&h[0-9a-f]+$/i.test(s)) return parseInt(s.slice(2), 16);
    const n = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(s) ? Number(s) : /^[-+]?\d+,\d+$/.test(s) ? Number(s.replace(',', '.')) : NaN;
    if (Number.isNaN(n)) throw ERR.typeMismatch();
    return n;
  }
  if (isObject(v)) {
    try {
      return toNum((v.index ? v.index([]) : v.get('value', [])) as BVal);
    } catch {
      throw ERR.typeMismatch();
    }
  }
  throw ERR.typeMismatch();
}

export const isNumericText = (s: string): boolean => /^\s*[-+]?(\d+([.,]\d*)?|[.,]\d+)([eE][-+]?\d+)?\s*$/.test(s);

export function toBool(v: BVal): boolean {
  if (v === undefined) return false;
  if (v === null) throw ERR.nullUse();
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === 'verdadero' || s === 'sí' || s === 'si') return true;
    if (s === 'false' || s === 'falso' || s === 'no') return false;
    return toNum(v) !== 0;
  }
  throw ERR.typeMismatch();
}

export function toDate(v: BVal): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const d = parseDateText(v);
    if (d) return d;
    if (isNumericText(v)) return fromSerial(toNum(v));
    throw ERR.typeMismatch();
  }
  if (typeof v === 'number') return fromSerial(v);
  if (v === null) throw ERR.nullUse();
  throw ERR.typeMismatch();
}

/** Banker's rounding, as VBA's Round and CInt do. */
export function roundHalfEven(x: number, digits = 0): number {
  const f = 10 ** digits;
  const y = x * f;
  const r = Math.round(y);
  const diff = Math.abs(y - Math.trunc(y));
  const out = Math.abs(diff - 0.5) < 1e-9 ? (Math.floor(y) % 2 === 0 ? Math.floor(y) : Math.ceil(y)) : r;
  return out / f;
}

/** Make a value fit a declared type (`Dim x As Integer`). Variant and unknown types keep the value as it is. */
export function coerceTo(type: string | undefined, v: BVal): BVal {
  if (!type) return v;
  switch (type.toLowerCase()) {
    case 'integer': {
      if (v === undefined) return 0;
      const n = roundHalfEven(toNum(v));
      if (n < -32768 || n > 32767) throw ERR.overflow();
      return n;
    }
    case 'long':
    case 'longlong':
    case 'longptr': {
      if (v === undefined) return 0;
      const n = roundHalfEven(toNum(v));
      if (n < -2147483648 || n > 2147483647) throw ERR.overflow();
      return n;
    }
    case 'byte': {
      if (v === undefined) return 0;
      const n = roundHalfEven(toNum(v));
      if (n < 0 || n > 255) throw ERR.overflow();
      return n;
    }
    case 'single':
    case 'double':
    case 'currency':
    case 'decimal':
      return v === undefined ? 0 : toNum(v);
    case 'string':
      return v === undefined ? '' : toStr(v);
    case 'boolean':
      return v === undefined ? false : toBool(v);
    case 'date':
      return v === undefined ? new Date(1899, 11, 30) : v === null ? v : toDate(v);
    default:
      return v;
  }
}

export function defaultFor(type: string | undefined): BVal {
  if (!type) return undefined;
  switch (type.toLowerCase()) {
    case 'integer':
    case 'long':
    case 'byte':
    case 'single':
    case 'double':
    case 'currency':
    case 'decimal':
      return 0;
    case 'string':
      return '';
    case 'boolean':
      return false;
    case 'date':
      return new Date(1899, 11, 30);
    case 'object':
      return NOTHING;
    default:
      return undefined;
  }
}

// ------------------------------------------------------------------------------------------------ operators

const isNum = (v: BVal): v is number => typeof v === 'number';

/** Compare two values the way VBA does with Option Compare Text: numbers numerically, texts ignoring case. Null if either is Null. */
export function compareValues(a: BVal, b: BVal): number | null {
  if (a === null || b === null) return null;
  if (a === undefined && b === undefined) return 0;
  if (a instanceof Date && b instanceof Date) return Math.sign(a.getTime() - b.getTime());
  const bothText = typeof a === 'string' && typeof b === 'string';
  if (bothText) {
    const x = (a as string).toLowerCase();
    const y = (b as string).toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const aText = typeof a === 'string' && !isNumericText(a);
  const bText = typeof b === 'string' && !isNumericText(b);
  // a text that is not a number is always greater than a number
  if (aText && !bText && b !== undefined) return 1;
  if (bText && !aText && a !== undefined) return -1;
  if (aText && bText) {
    const x = (a as string).toLowerCase();
    const y = (b as string).toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const x = toNum(a);
  const y = toNum(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** The `Like` operator: ? any character, * any text, # a digit, [abc] / [!abc] a set. Case-insensitive. */
export function likeMatch(text: string, pattern: string): boolean {
  let re = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '?') re += '.';
    else if (c === '*') re += '.*';
    else if (c === '#') re += '[0-9]';
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end < 0) re += '\\[';
      else {
        let set = pattern.slice(i + 1, end);
        const neg = set.startsWith('!');
        if (neg) set = set.slice(1);
        re += `[${neg ? '^' : ''}${set.replace(/[\\\]^]/g, '\\$&')}]`;
        i = end;
      }
    } else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re + '$', 'is').test(text);
}

const toInt32 = (n: number): number => {
  const r = roundHalfEven(n);
  if (r < -2147483648 || r > 2147483647) throw ERR.overflow();
  return r;
};

export function binaryOp(op: string, a: BVal, b: BVal): BVal {
  switch (op) {
    case '&':
      return toStr(a) + toStr(b);
    case '+': {
      if (typeof a === 'string' && typeof b === 'string') return a + b;
      if (a === null || b === null) return null;
      if (a instanceof Date && !(b instanceof Date)) return fromSerial(toSerial(a) + toNum(b));
      if (b instanceof Date && !(a instanceof Date)) return fromSerial(toSerial(b) + toNum(a));
      return toNum(a) + toNum(b);
    }
    case '-': {
      if (a === null || b === null) return null;
      if (a instanceof Date && b instanceof Date) return toSerial(a) - toSerial(b);
      if (a instanceof Date) return fromSerial(toSerial(a) - toNum(b));
      return toNum(a) - toNum(b);
    }
    case '*':
      return a === null || b === null ? null : toNum(a) * toNum(b);
    case '/': {
      if (a === null || b === null) return null;
      const d = toNum(b);
      if (d === 0) throw ERR.divZero();
      return toNum(a) / d;
    }
    case '\\': {
      if (a === null || b === null) return null;
      const d = toInt32(toNum(b));
      if (d === 0) throw ERR.divZero();
      return Math.trunc(toInt32(toNum(a)) / d);
    }
    case 'mod': {
      if (a === null || b === null) return null;
      const d = toInt32(toNum(b));
      if (d === 0) throw ERR.divZero();
      return toInt32(toNum(a)) % d;
    }
    case '^':
      return a === null || b === null ? null : toNum(a) ** toNum(b);
    case '=':
    case '<>':
    case '<':
    case '>':
    case '<=':
    case '>=': {
      const c = compareValues(a, b);
      if (c === null) return null;
      return op === '=' ? c === 0 : op === '<>' ? c !== 0 : op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
    }
    case 'like':
      return a === null || b === null ? null : likeMatch(toStr(a), toStr(b));
    case 'is':
      return a === b || (a === undefined && b === undefined);
    case 'and':
    case 'or':
    case 'xor':
    case 'eqv':
    case 'imp': {
      // logical on Booleans, bitwise on numbers; Null follows the three-valued rules
      if (a === null || b === null) {
        if (op === 'and') return (a !== null && !truthy(a)) || (b !== null && !truthy(b)) ? false : null;
        if (op === 'or') return (a !== null && truthy(a)) || (b !== null && truthy(b)) ? true : null;
        return null;
      }
      if (typeof a === 'boolean' && typeof b === 'boolean') {
        return op === 'and' ? a && b : op === 'or' ? a || b : op === 'xor' ? a !== b : op === 'eqv' ? a === b : !a || b;
      }
      const x = toInt32(toNum(a));
      const y = toInt32(toNum(b));
      return op === 'and' ? x & y : op === 'or' ? x | y : op === 'xor' ? x ^ y : op === 'eqv' ? ~(x ^ y) : ~x | y;
    }
  }
  throw ERR.invalidCall(`Operador desconocido: ${op}`);
}

export const truthy = (v: BVal): boolean => (v === null || v === undefined ? false : toBool(v));

export function negate(v: BVal): BVal {
  if (v === null) return null;
  return -toNum(v);
}

export function not(v: BVal): BVal {
  if (v === null) return null;
  if (typeof v === 'boolean') return !v;
  return ~toInt32(toNum(v));
}

export { isNum };

// ------------------------------------------------------------------------------------------------ Format

const nfSep = (n: number, decimals: number, group: boolean): string => new Intl.NumberFormat('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: group }).format(n);
/** es-ES leaves four-digit numbers ungrouped; VBA's "#,##0" groups them. */
function groupDigits(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function formatNumberPattern(n: number, fmt: string): string {
  const sections = fmt.split(';');
  let section = sections[0]!;
  let value = n;
  if (n < 0 && sections.length > 1) {
    section = sections[1]!;
    value = -n;
  } else if (n === 0 && sections.length > 2) section = sections[2]!;
  // literal text in quotes and escaped characters are kept as they are
  const lits: string[] = [];
  let pat = section.replace(/"([^"]*)"|\\(.)/g, (_m, a, b) => {
    lits.push(a ?? b);
    return String.fromCharCode(0xe000 + lits.length - 1);
  });
  const percent = pat.includes('%');
  if (percent) value *= 100;
  const dot = pat.indexOf('.');
  const intPat = dot < 0 ? pat : pat.slice(0, dot);
  const fracPat = dot < 0 ? '' : pat.slice(dot + 1);
  // what is written before the first digit placeholder and after the last one stays where it is
  const first = pat.search(/[0#]/);
  let last = -1;
  for (let k = pat.length - 1; k >= 0; k--) {
    if (/[0#]/.test(pat[k]!)) {
      last = k;
      break;
    }
  }
  const before = first < 0 ? pat : pat.slice(0, first);
  const after = first < 0 ? '' : pat.slice(last + 1);
  const zerosInt = (intPat.match(/0/g) ?? []).length;
  const fracMin = (fracPat.match(/0/g) ?? []).length;
  const fracMax = (fracPat.match(/[0#]/g) ?? []).length;
  const group = /[0#],[0#]/.test(intPat) || /[0#],(?=[^0#]|$)/.test(intPat);
  const abs = Math.abs(value);
  let text = abs.toFixed(Math.min(20, fracMax));
  let [ip, fp = ''] = text.split('.');
  while (fp.length > fracMin && fp.endsWith('0')) fp = fp.slice(0, -1);
  ip = ip!.padStart(zerosInt, '0');
  if (ip === '0' && zerosInt === 0 && fp !== '') ip = '';
  if (group) ip = groupDigits(ip);
  text = fp ? `${ip},${fp}` : ip;
  // put the digits where the placeholders were; everything that is not a placeholder stays
  const lead = (value < 0 || (n < 0 && sections.length === 1)) && Math.abs(Number(abs.toFixed(fracMax))) > 0 ? '-' : '';
  const out = `${lead}${before.replace(/%/g, '')}${text}${after.replace(/%/g, '')}${percent ? '%' : ''}`;
  return out.replace(/[\ue000-\uefff]/g, (c) => lits[c.charCodeAt(0) - 0xe000]!);
}

function formatDatePattern(d: Date, fmt: string): string {
  const tokens = /yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|nn|n|ss|s|am\/pm|a\/p|"[^"]*"|\\.|./gi;
  const parts = fmt.match(tokens) ?? [];
  const ampm = parts.some((p) => /^(am\/pm|a\/p)$/i.test(p));
  const hours = d.getHours();
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  let out = '';
  parts.forEach((p, i) => {
    const low = p.toLowerCase();
    // "m" next to hours or seconds is minutes
    const prevH = parts.slice(0, i).reverse().find((x) => /^[a-z]/i.test(x) && !/^(am\/pm|a\/p)$/i.test(x));
    const nextS = parts.slice(i + 1).find((x) => /^[a-z]/i.test(x));
    const minute = (low === 'm' || low === 'mm') && ((prevH && /^h/i.test(prevH)) || (nextS && /^s/i.test(nextS)));
    switch (low) {
      case 'yyyy': return void (out += d.getFullYear());
      case 'yy': return void (out += pad(d.getFullYear() % 100));
      case 'mmmm': return void (out += MONTHS[d.getMonth()]);
      case 'mmm': return void (out += MONTHS[d.getMonth()]!.slice(0, 3));
      case 'mm': return void (out += minute ? pad(d.getMinutes()) : pad(d.getMonth() + 1));
      case 'm': return void (out += minute ? d.getMinutes() : d.getMonth() + 1);
      case 'dddd': return void (out += DAYS[d.getDay()]);
      case 'ddd': return void (out += DAYS[d.getDay()]!.slice(0, 3));
      case 'dd': return void (out += pad(d.getDate()));
      case 'd': return void (out += d.getDate());
      case 'hh': return void (out += pad(ampm ? h12 : hours));
      case 'h': return void (out += ampm ? h12 : hours);
      case 'nn': return void (out += pad(d.getMinutes()));
      case 'n': return void (out += d.getMinutes());
      case 'ss': return void (out += pad(d.getSeconds()));
      case 's': return void (out += d.getSeconds());
      case 'am/pm': return void (out += hours < 12 ? 'AM' : 'PM');
      case 'a/p': return void (out += hours < 12 ? 'A' : 'P');
      default:
        out += p.startsWith('"') ? p.slice(1, -1) : p.startsWith('\\') ? p.slice(1) : p;
    }
  });
  return out;
}

export function basicFormat(v: BVal, fmt?: string): string {
  if (v === null || v === undefined) return '';
  const f = (fmt ?? '').trim();
  if (f === '') return toStr(v);
  const low = f.toLowerCase();
  const named: Record<string, () => string> = {
    'general number': () => toStr(typeof v === 'string' && isNumericText(v) ? toNum(v) : v),
    fixed: () => nfSep(toNum(v), 2, false),
    standard: () => formatNumberPattern(toNum(v), '#,##0.00'),
    currency: () => formatNumberPattern(toNum(v), '#,##0.00'),
    percent: () => formatNumberPattern(toNum(v), '0.00%'),
    'yes/no': () => (toBool(v) ? 'Sí' : 'No'),
    'true/false': () => (toBool(v) ? 'Verdadero' : 'Falso'),
    'on/off': () => (toBool(v) ? 'Activado' : 'Desactivado'),
    'short date': () => formatDatePattern(toDate(v), 'dd/mm/yyyy'),
    'medium date': () => formatDatePattern(toDate(v), 'dd-mmm-yy'),
    'long date': () => formatDatePattern(toDate(v), 'dddd, d "de" mmmm "de" yyyy'),
    'short time': () => formatDatePattern(toDate(v), 'hh:nn'),
    'long time': () => formatDatePattern(toDate(v), 'hh:nn:ss'),
    'general date': () => dateToText(toDate(v)),
  };
  if (named[low]) return named[low]!();
  const dateLike = /(yyyy|yy|mmm|dd|d|hh|h|nn|ss|am\/pm)/i.test(f.replace(/"[^"]*"/g, ''));
  if (v instanceof Date || (dateLike && !/[0#]/.test(f.replace(/"[^"]*"/g, '')))) return formatDatePattern(toDate(v), f);
  if (typeof v === 'string' && !isNumericText(v)) return f.includes('>') ? v.toUpperCase() : f.includes('<') ? v.toLowerCase() : v;
  return formatNumberPattern(toNum(v), f);
}
