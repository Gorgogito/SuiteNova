import { BasicError, ERR, NOTHING, VArray, binaryOp, coerceTo, compareValues, basicFormat, fromSerial, isNumericText, isObject, parseDateText, roundHalfEven, toBool, toDate, toNum, toSerial, toStr, truthy, type BObject, type BVal } from './values';

export interface BuiltinCtx {
  now(): Date;
  random(): number;
  reseed(seed: number): void;
  /** Host hooks for MsgBox and InputBox. */
  msgBox(prompt: string, buttons: number, title: string): number;
  inputBox(prompt: string, title: string, def: string): string | null;
}

type Fn = (a: BVal[], c: BuiltinCtx) => BVal;

const str = (a: BVal[], i: number): string => toStr(a[i]);
const num = (a: BVal[], i: number): number => toNum(a[i]);
const has = (a: BVal[], i: number): boolean => a[i] !== undefined;
const nullIn = (...v: BVal[]): boolean => v.some((x) => x === null);
const need = (a: BVal[], n: number, name: string): void => {
  if (a.length < n) throw new BasicError(449, `Falta un argumento en ${name}`);
};

// ---------------------------------------------------------------------------------------------- collections and dictionaries

class Collection implements BObject {
  readonly typeName = 'Collection';
  private items_: { key?: string; v: BVal }[] = [];
  get(member: string, args: BVal[]): BVal {
    switch (member.toLowerCase()) {
      case 'add': {
        const key = args[1] === undefined || args[1] === null ? undefined : toStr(args[1]);
        if (key !== undefined && this.items_.some((x) => x.key?.toLowerCase() === key.toLowerCase())) throw new BasicError(457, 'Esta clave ya está asociada a un elemento de la colección');
        this.items_.push({ key, v: args[0] });
        return undefined;
      }
      case 'count':
        return this.items_.length;
      case 'item':
        return this.index(args);
      case 'remove': {
        this.items_.splice(this.find(args[0]), 1);
        return undefined;
      }
    }
    throw ERR.notSupported(member);
  }
  set(member: string): void {
    throw ERR.notSupported(member);
  }
  private find(k: BVal): number {
    if (typeof k === 'string') {
      const i = this.items_.findIndex((x) => x.key?.toLowerCase() === k.toLowerCase());
      if (i < 0) throw new BasicError(5, 'Llamada a procedimiento no válida: no existe esa clave');
      return i;
    }
    const n = toNum(k);
    if (n < 1 || n > this.items_.length) throw ERR.subscript();
    return n - 1;
  }
  index(args: BVal[]): BVal {
    return this.items_[this.find(args[0])]!.v;
  }
  items(): BVal[] {
    return this.items_.map((x) => x.v);
  }
}

class Dictionary implements BObject {
  readonly typeName = 'Dictionary';
  private map = new Map<string, { key: BVal; v: BVal }>();
  private k(v: BVal): string {
    return typeof v === 'number' ? `n:${v}` : `s:${toStr(v)}`;
  }
  get(member: string, args: BVal[]): BVal {
    switch (member.toLowerCase()) {
      case 'add': {
        const k = this.k(args[0]);
        if (this.map.has(k)) throw new BasicError(457, 'Esta clave ya está asociada a un elemento de la colección');
        this.map.set(k, { key: args[0], v: args[1] });
        return undefined;
      }
      case 'exists':
        return this.map.has(this.k(args[0]));
      case 'item':
        return this.index(args);
      case 'count':
        return this.map.size;
      case 'keys':
        return VArray.of([...this.map.values()].map((x) => x.key));
      case 'items':
        return VArray.of([...this.map.values()].map((x) => x.v));
      case 'remove':
        if (!this.map.delete(this.k(args[0]))) throw new BasicError(32811, 'El elemento solicitado no existe en la colección');
        return undefined;
      case 'removeall':
        this.map.clear();
        return undefined;
      case 'comparemode':
        return 0;
    }
    throw ERR.notSupported(member);
  }
  set(member: string, args: BVal[], value: BVal): void {
    if (member.toLowerCase() === 'item') return this.setIndex(args, value);
    if (member.toLowerCase() === 'comparemode') return;
    throw ERR.notSupported(member);
  }
  index(args: BVal[]): BVal {
    return this.map.get(this.k(args[0]))?.v;
  }
  setIndex(args: BVal[], v: BVal): void {
    const k = this.k(args[0]);
    const cur = this.map.get(k);
    if (cur) cur.v = v;
    else this.map.set(k, { key: args[0], v });
  }
  items(): BVal[] {
    return [...this.map.values()].map((x) => x.key);
  }
}

/** `New Collection`, `CreateObject("Scripting.Dictionary")`. */
export function createObject(cls: string): BObject | null {
  switch (cls.toLowerCase()) {
    case 'collection':
      return new Collection();
    case 'scripting.dictionary':
    case 'dictionary':
      return new Dictionary();
  }
  return null;
}

// ---------------------------------------------------------------------------------------------- dates

const DAY_MS = 86_400_000;
const addMonths = (d: Date, n: number): Date => {
  const r = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes(), d.getSeconds());
  const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(d.getDate(), last));
  return r;
};
function dateAdd(interval: string, n: number, d: Date): Date {
  const k = Math.trunc(n);
  switch (interval.toLowerCase()) {
    case 'yyyy':
      return addMonths(d, k * 12);
    case 'q':
      return addMonths(d, k * 3);
    case 'm':
      return addMonths(d, k);
    case 'y':
    case 'd':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + k, d.getHours(), d.getMinutes(), d.getSeconds());
    case 'w':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + k, d.getHours(), d.getMinutes(), d.getSeconds());
    case 'ww':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + k * 7, d.getHours(), d.getMinutes(), d.getSeconds());
    case 'h':
      return new Date(d.getTime() + k * 3_600_000);
    case 'n':
      return new Date(d.getTime() + k * 60_000);
    case 's':
      return new Date(d.getTime() + k * 1000);
  }
  throw ERR.invalidCall('Intervalo de fecha no válido');
}
function dateDiff(interval: string, a: Date, b: Date): number {
  const months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  switch (interval.toLowerCase()) {
    case 'yyyy':
      return b.getFullYear() - a.getFullYear();
    case 'q':
      return Math.trunc(b.getMonth() / 3) + 4 * b.getFullYear() - (Math.trunc(a.getMonth() / 3) + 4 * a.getFullYear());
    case 'm':
      return months;
    case 'y':
    case 'd':
      return Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / DAY_MS);
    case 'w':
    case 'ww':
      return Math.trunc(Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / DAY_MS) / 7);
    case 'h':
      return Math.trunc((b.getTime() - a.getTime()) / 3_600_000);
    case 'n':
      return Math.trunc((b.getTime() - a.getTime()) / 60_000);
    case 's':
      return Math.trunc((b.getTime() - a.getTime()) / 1000);
  }
  throw ERR.invalidCall('Intervalo de fecha no válido');
}

// ---------------------------------------------------------------------------------------------- strings

const stripAccents = (s: string) => s;
function instr(a: BVal[]): BVal {
  let i = 0;
  let start = 1;
  if (typeof a[0] === 'number' && a.length >= 3) {
    start = a[0];
    i = 1;
  }
  const s1 = a[i];
  const s2 = a[i + 1];
  if (nullIn(s1, s2)) return null;
  const cmp = a[i + 2] === undefined ? 1 : toNum(a[i + 2]);
  const x = toStr(s1);
  const y = toStr(s2);
  if (start < 1) throw ERR.invalidCall();
  if (y === '') return start <= x.length ? start : 0;
  const hay = cmp === 0 ? x : x.toLowerCase();
  const needle = cmp === 0 ? y : y.toLowerCase();
  return hay.indexOf(needle, start - 1) + 1;
}

function replace(a: BVal[]): BVal {
  if (nullIn(a[0])) return null;
  const s = toStr(a[0]);
  const find = toStr(a[1]);
  const rep = toStr(a[2]);
  const start = a[3] === undefined ? 1 : toNum(a[3]);
  const count = a[4] === undefined ? -1 : toNum(a[4]);
  const cmp = a[5] === undefined ? 1 : toNum(a[5]);
  if (find === '') return s.slice(start - 1);
  const head = s.slice(start - 1);
  const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), cmp === 0 ? 'g' : 'gi');
  let n = 0;
  return head.replace(re, (m) => (count >= 0 && n++ >= count ? m : rep));
}

const proper = (s: string) => s.toLowerCase().replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_m, p, c) => p + c.toUpperCase());

// ---------------------------------------------------------------------------------------------- the table

const F: Record<string, Fn> = {
  // text
  len: (a) => (nullIn(a[0]) ? null : toStr(a[0]).length),
  left: (a) => (nullIn(a[0]) ? null : toStr(a[0]).slice(0, Math.max(0, Math.trunc(num(a, 1))))),
  right: (a) => {
    if (nullIn(a[0])) return null;
    const n = Math.max(0, Math.trunc(num(a, 1)));
    return n === 0 ? '' : toStr(a[0]).slice(-n);
  },
  mid: (a) => {
    if (nullIn(a[0])) return null;
    const s = toStr(a[0]);
    const st = Math.trunc(num(a, 1));
    if (st < 1) throw ERR.invalidCall();
    return has(a, 2) ? s.substr(st - 1, Math.max(0, Math.trunc(num(a, 2)))) : s.slice(st - 1);
  },
  ucase: (a) => (nullIn(a[0]) ? null : toStr(a[0]).toUpperCase()),
  lcase: (a) => (nullIn(a[0]) ? null : toStr(a[0]).toLowerCase()),
  trim: (a) => (nullIn(a[0]) ? null : toStr(a[0]).replace(/^ +| +$/g, '')),
  ltrim: (a) => (nullIn(a[0]) ? null : toStr(a[0]).replace(/^ +/, '')),
  rtrim: (a) => (nullIn(a[0]) ? null : toStr(a[0]).replace(/ +$/, '')),
  instr: instr,
  instrrev: (a) => {
    if (nullIn(a[0], a[1])) return null;
    const hay = toStr(a[0]).toLowerCase();
    const needle = toStr(a[1]).toLowerCase();
    const from = has(a, 2) && toNum(a[2]) > 0 ? toNum(a[2]) - 1 : undefined;
    return hay.lastIndexOf(needle, from) + 1;
  },
  replace: replace,
  strreverse: (a) => [...toStr(a[0])].reverse().join(''),
  space: (a) => ' '.repeat(Math.max(0, Math.trunc(num(a, 0)))),
  string: (a) => (typeof a[1] === 'number' ? String.fromCharCode(a[1]) : toStr(a[1]).charAt(0)).repeat(Math.max(0, Math.trunc(num(a, 0)))),
  chr: (a) => String.fromCharCode(Math.trunc(num(a, 0))),
  chrw: (a) => String.fromCodePoint(Math.trunc(num(a, 0))),
  asc: (a) => {
    const s = toStr(a[0]);
    if (!s) throw ERR.invalidCall();
    return s.codePointAt(0)!;
  },
  strcomp: (a) => {
    if (nullIn(a[0], a[1])) return null;
    const cmp = a[2] === undefined ? 1 : toNum(a[2]);
    const x = cmp === 0 ? toStr(a[0]) : toStr(a[0]).toLowerCase();
    const y = cmp === 0 ? toStr(a[1]) : toStr(a[1]).toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  },
  strconv: (a) => {
    const s = toStr(a[0]);
    const m = toNum(a[1]);
    return m === 1 ? s.toUpperCase() : m === 2 ? s.toLowerCase() : m === 3 ? proper(s) : s;
  },
  split: (a) => {
    if (nullIn(a[0])) return null;
    const s = toStr(a[0]);
    const delim = a[1] === undefined ? ' ' : toStr(a[1]);
    const limit = a[2] === undefined ? -1 : toNum(a[2]);
    if (s === '') return VArray.of([]);
    let parts = delim === '' ? [s] : s.split(delim);
    if (limit > 0 && parts.length > limit) parts = [...parts.slice(0, limit - 1), parts.slice(limit - 1).join(delim)];
    return VArray.of(parts);
  },
  join: (a) => {
    if (!(a[0] instanceof VArray)) throw ERR.typeMismatch();
    return a[0].data.map(toStr).join(a[1] === undefined ? ' ' : toStr(a[1]));
  },
  format: (a) => basicFormat(a[0], a[1] === undefined ? undefined : toStr(a[1])),
  str: (a) => {
    const n = num(a, 0);
    return n >= 0 ? ` ${toStr(n)}` : toStr(n);
  },
  val: (a) => {
    const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(toStr(a[0]).replace(/\s+/g, (s, i) => (i === 0 ? s : '')));
    return m ? Number(m[0]) : 0;
  },
  // conversion
  cstr: (a) => (nullIn(a[0]) ? (() => { throw ERR.nullUse(); })() : toStr(a[0])),
  cint: (a) => coerceTo('integer', a[0]),
  clng: (a) => coerceTo('long', a[0]),
  cbyte: (a) => coerceTo('byte', a[0]),
  cdbl: (a) => coerceTo('double', a[0]),
  csng: (a) => coerceTo('double', a[0]),
  ccur: (a) => coerceTo('double', a[0]),
  cdec: (a) => coerceTo('double', a[0]),
  cbool: (a) => coerceTo('boolean', a[0]),
  cdate: (a) => coerceTo('date', a[0]),
  cvar: (a) => a[0],
  // math
  abs: (a) => (nullIn(a[0]) ? null : Math.abs(num(a, 0))),
  sgn: (a) => (nullIn(a[0]) ? null : Math.sign(num(a, 0))),
  int: (a) => (nullIn(a[0]) ? null : Math.floor(num(a, 0))),
  fix: (a) => (nullIn(a[0]) ? null : Math.trunc(num(a, 0))),
  round: (a) => (nullIn(a[0]) ? null : roundHalfEven(num(a, 0), has(a, 1) ? Math.trunc(num(a, 1)) : 0)),
  sqr: (a) => {
    const n = num(a, 0);
    if (n < 0) throw ERR.invalidCall();
    return Math.sqrt(n);
  },
  exp: (a) => Math.exp(num(a, 0)),
  log: (a) => {
    const n = num(a, 0);
    if (n <= 0) throw ERR.invalidCall();
    return Math.log(n);
  },
  sin: (a) => Math.sin(num(a, 0)),
  cos: (a) => Math.cos(num(a, 0)),
  tan: (a) => Math.tan(num(a, 0)),
  atn: (a) => Math.atan(num(a, 0)),
  rnd: (a, c) => {
    if (has(a, 0) && toNum(a[0]) < 0) c.reseed(toNum(a[0]));
    return c.random();
  },
  randomize: (a, c) => {
    c.reseed(has(a, 0) ? toNum(a[0]) : c.now().getTime());
    return undefined;
  },
  // dates
  date: (_a, c) => {
    const d = c.now();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  },
  time: (_a, c) => {
    const d = c.now();
    return new Date(1899, 11, 30, d.getHours(), d.getMinutes(), d.getSeconds());
  },
  now: (_a, c) => c.now(),
  timer: (_a, c) => {
    const d = c.now();
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
  },
  year: (a) => (nullIn(a[0]) ? null : toDate(a[0]).getFullYear()),
  month: (a) => (nullIn(a[0]) ? null : toDate(a[0]).getMonth() + 1),
  day: (a) => (nullIn(a[0]) ? null : toDate(a[0]).getDate()),
  hour: (a) => (nullIn(a[0]) ? null : toDate(a[0]).getHours()),
  minute: (a) => (nullIn(a[0]) ? null : toDate(a[0]).getMinutes()),
  second: (a) => (nullIn(a[0]) ? null : toDate(a[0]).getSeconds()),
  weekday: (a) => {
    if (nullIn(a[0])) return null;
    const first = has(a, 1) ? toNum(a[1]) : 1; // 1 = Sunday
    return ((toDate(a[0]).getDay() - (first - 1) + 7) % 7) + 1;
  },
  dateserial: (a) => new Date(Math.trunc(num(a, 0)), Math.trunc(num(a, 1)) - 1, Math.trunc(num(a, 2))),
  timeserial: (a) => new Date(1899, 11, 30, Math.trunc(num(a, 0)), Math.trunc(num(a, 1)), Math.trunc(num(a, 2))),
  datevalue: (a) => {
    const d = toDate(a[0]);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  },
  timevalue: (a) => {
    const d = toDate(a[0]);
    return new Date(1899, 11, 30, d.getHours(), d.getMinutes(), d.getSeconds());
  },
  dateadd: (a) => (nullIn(a[2]) ? null : dateAdd(str(a, 0), num(a, 1), toDate(a[2]))),
  datediff: (a) => (nullIn(a[1], a[2]) ? null : dateDiff(str(a, 0), toDate(a[1]), toDate(a[2]))),
  datepart: (a) => {
    if (nullIn(a[1])) return null;
    const d = toDate(a[1]);
    switch (str(a, 0).toLowerCase()) {
      case 'yyyy': return d.getFullYear();
      case 'q': return Math.floor(d.getMonth() / 3) + 1;
      case 'm': return d.getMonth() + 1;
      case 'd': return d.getDate();
      case 'w': return d.getDay() + 1;
      case 'h': return d.getHours();
      case 'n': return d.getMinutes();
      case 's': return d.getSeconds();
      case 'y': return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / DAY_MS) + 1;
    }
    throw ERR.invalidCall('Intervalo de fecha no válido');
  },
  monthname: (a) => ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][Math.trunc(num(a, 0)) - 1] ?? (() => { throw ERR.invalidCall(); })(),
  weekdayname: (a) => ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][Math.trunc(num(a, 0)) - 1] ?? (() => { throw ERR.invalidCall(); })(),
  // tests
  isnull: (a) => a[0] === null,
  isempty: (a) => a[0] === undefined,
  isnumeric: (a) => typeof a[0] === 'number' || typeof a[0] === 'boolean' || (typeof a[0] === 'string' && isNumericText(a[0])),
  isdate: (a) => a[0] instanceof Date || (typeof a[0] === 'string' && parseDateText(a[0]) !== null),
  isarray: (a) => a[0] instanceof VArray,
  isobject: (a) => isObject(a[0]) || a[0] === NOTHING,
  iserror: () => false,
  typename: (a) => {
    const v = a[0];
    if (v === null) return 'Null';
    if (v === undefined) return 'Empty';
    if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 32768 ? 'Integer' : Number.isInteger(v) && Math.abs(v) < 2147483648 ? 'Long' : 'Double';
    if (typeof v === 'string') return 'String';
    if (typeof v === 'boolean') return 'Boolean';
    if (v instanceof Date) return 'Date';
    if (v instanceof VArray) return 'Variant()';
    if (v === NOTHING) return 'Nothing';
    return (v as BObject).typeName;
  },
  vartype: (a) => {
    const v = a[0];
    return v === undefined ? 0 : v === null ? 1 : typeof v === 'number' ? (Number.isInteger(v) && Math.abs(v) < 32768 ? 2 : Number.isInteger(v) ? 3 : 5) : typeof v === 'string' ? 8 : typeof v === 'boolean' ? 11 : v instanceof Date ? 7 : v instanceof VArray ? 8204 : 9;
  },
  // control
  iif: (a) => (truthy(a[0]) ? a[1] : a[2]),
  choose: (a) => {
    const n = Math.trunc(num(a, 0));
    return n >= 1 && n < a.length ? a[n] : null;
  },
  switch: (a) => {
    for (let i = 0; i + 1 < a.length; i += 2) if (truthy(a[i])) return a[i + 1];
    return null;
  },
  nz: (a) => (a[0] === null || a[0] === undefined ? (a.length > 1 ? a[1] : typeof a[0] === 'undefined' ? '' : 0) : a[0]),
  // arrays
  array: (a) => VArray.of(a),
  ubound: (a) => {
    if (!(a[0] instanceof VArray)) throw ERR.typeMismatch();
    const d = a[0].dims[has(a, 1) ? Math.trunc(num(a, 1)) - 1 : 0];
    if (!d) throw ERR.subscript();
    return d.hi;
  },
  lbound: (a) => {
    if (!(a[0] instanceof VArray)) throw ERR.typeMismatch();
    const d = a[0].dims[has(a, 1) ? Math.trunc(num(a, 1)) - 1 : 0];
    if (!d) throw ERR.subscript();
    return d.lo;
  },
  // interaction
  msgbox: (a, c) => {
    need(a, 1, 'MsgBox');
    return c.msgBox(toStr(a[0]), has(a, 1) ? Math.trunc(num(a, 1)) : 0, has(a, 2) ? toStr(a[2]) : 'Nova Base');
  },
  inputbox: (a, c) => {
    need(a, 1, 'InputBox');
    const r = c.inputBox(toStr(a[0]), has(a, 1) ? toStr(a[1]) : 'Nova Base', has(a, 2) ? toStr(a[2]) : '');
    return r === null ? '' : r;
  },
  doevents: () => 0,
  beep: () => undefined,
  createobject: (a) => {
    const o = createObject(toStr(a[0]));
    if (!o) throw new BasicError(429, `El componente ActiveX no puede crear el objeto: ${toStr(a[0])}. Solo se admiten Scripting.Dictionary y Collection.`);
    return o;
  },
};

/** Names of the functions that exist (lower case, without a trailing `$`). */
export const BUILTIN_NAMES = new Set(Object.keys(F));

export function builtin(name: string): Fn | undefined {
  const k = name.toLowerCase().replace(/\$$/, '');
  return Object.prototype.hasOwnProperty.call(F, k) ? F[k] : undefined;
}

void stripAccents;
void binaryOp;
void compareValues;
void fromSerial;
void toSerial;
void toBool;
