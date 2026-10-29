/**
 * Expressions of forms, reports and macros: `[Price] * [Qty]`, `IIf([Stock] < 5, "Reorder", "OK")`, `Sum([Amount])`.
 * A small hand-written parser and interpreter: nothing is ever passed to eval().
 */

export type Value = string | number | boolean | null;
export type Row = Record<string, Value>;

export type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'lit'; v: boolean | null }
  | { t: 'field'; name: string }
  | { t: 'un'; op: '-' | 'not'; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[] };

export class ExprError extends Error {
  constructor(
    message: string,
    readonly pos = 0,
  ) {
    super(message);
    this.name = 'ExprError';
  }
}

interface Tok {
  k: 'num' | 'str' | 'field' | 'id' | 'op' | 'end';
  v: string;
  pos: number;
}

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      if (/[eE]/.test(src[j] ?? '') && /[0-9+-]/.test(src[j + 1] ?? '')) {
        j += 2;
        while (j < src.length && /[0-9]/.test(src[j]!)) j++;
      }
      out.push({ k: 'num', v: src.slice(i, j), pos: i });
      i = j;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      let s = '';
      for (;;) {
        if (j >= src.length) throw new ExprError('Falta cerrar el texto entre comillas.', i);
        if (src[j] === ch) {
          if (src[j + 1] === ch) {
            s += ch;
            j += 2;
            continue;
          }
          break;
        }
        s += src[j++];
      }
      out.push({ k: 'str', v: s, pos: i });
      i = j + 1;
    } else if (ch === '[') {
      const end = src.indexOf(']', i);
      if (end < 0) throw new ExprError('Falta cerrar el corchete del campo.', i);
      out.push({ k: 'field', v: src.slice(i + 1, end).trim(), pos: i });
      i = end + 1;
    } else if (/[\p{L}_]/u.test(ch)) {
      let j = i;
      while (j < src.length && /[\p{L}\p{N}_.]/u.test(src[j]!)) j++;
      out.push({ k: 'id', v: src.slice(i, j), pos: i });
      i = j;
    } else {
      const two = src.slice(i, i + 2);
      if (two === '<>' || two === '<=' || two === '>=' || two === '!=') {
        out.push({ k: 'op', v: two === '!=' ? '<>' : two, pos: i });
        i += 2;
      } else if ('+-*/%\\&=<>(),^'.includes(ch)) {
        out.push({ k: 'op', v: ch, pos: i });
        i++;
      } else throw new ExprError(`Carácter no válido: "${ch}".`, i);
    }
  }
  out.push({ k: 'end', v: '', pos: src.length });
  return out;
}

const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false', 'null', 'y', 'o', 'no', 'verdadero', 'falso', 'nulo']);

/** Parse an expression (a leading `=` is allowed, as in Access). */
export function parseExpr(source: string): Node {
  const src = source.trim().replace(/^=/, '');
  if (!src.trim()) throw new ExprError('La expresión está vacía.');
  const toks = lex(src);
  let p = 0;
  const peek = () => toks[p]!;
  const isOp = (v: string) => peek().k === 'op' && peek().v === v;
  const isKw = (...v: string[]) => peek().k === 'id' && v.includes(peek().v.toLowerCase());
  const expect = (v: string) => {
    if (!isOp(v)) throw new ExprError(`Se esperaba "${v}".`, peek().pos);
    p++;
  };

  const or = (): Node => {
    let a = and();
    while (isKw('or', 'o')) {
      p++;
      a = { t: 'bin', op: 'or', a, b: and() };
    }
    return a;
  };
  const and = (): Node => {
    let a = not();
    while (isKw('and', 'y')) {
      p++;
      a = { t: 'bin', op: 'and', a, b: not() };
    }
    return a;
  };
  const not = (): Node => {
    if (isKw('not', 'no')) {
      p++;
      return { t: 'un', op: 'not', a: not() };
    }
    return cmp();
  };
  const cmp = (): Node => {
    const a = concat();
    const t = peek();
    if (t.k === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) {
      p++;
      return { t: 'bin', op: t.v, a, b: concat() };
    }
    return a;
  };
  const concat = (): Node => {
    let a = add();
    while (isOp('&')) {
      p++;
      a = { t: 'bin', op: '&', a, b: add() };
    }
    return a;
  };
  const add = (): Node => {
    let a = mul();
    while (isOp('+') || isOp('-')) {
      const op = peek().v;
      p++;
      a = { t: 'bin', op, a, b: mul() };
    }
    return a;
  };
  const mul = (): Node => {
    let a = pow();
    while (isOp('*') || isOp('/') || isOp('%') || isOp('\\')) {
      const op = peek().v;
      p++;
      a = { t: 'bin', op, a, b: pow() };
    }
    return a;
  };
  const pow = (): Node => {
    const a = unary();
    if (isOp('^')) {
      p++;
      return { t: 'bin', op: '^', a, b: pow() };
    }
    return a;
  };
  const unary = (): Node => {
    if (isOp('-')) {
      p++;
      return { t: 'un', op: '-', a: unary() };
    }
    if (isOp('+')) {
      p++;
      return unary();
    }
    return primary();
  };
  const primary = (): Node => {
    const t = peek();
    if (t.k === 'num') {
      p++;
      const v = Number(t.v);
      if (!Number.isFinite(v)) throw new ExprError(`Número no válido: ${t.v}`, t.pos);
      return { t: 'num', v };
    }
    if (t.k === 'str') {
      p++;
      return { t: 'str', v: t.v };
    }
    if (t.k === 'field') {
      p++;
      if (!t.v) throw new ExprError('Nombre de campo vacío.', t.pos);
      return { t: 'field', name: t.v };
    }
    if (t.k === 'op' && t.v === '(') {
      p++;
      const e = or();
      expect(')');
      return e;
    }
    if (t.k === 'id') {
      const low = t.v.toLowerCase();
      if (low === 'true' || low === 'verdadero') return p++, { t: 'lit', v: true };
      if (low === 'false' || low === 'falso') return p++, { t: 'lit', v: false };
      if (low === 'null' || low === 'nulo') return p++, { t: 'lit', v: null };
      p++;
      if (isOp('(')) {
        p++;
        const args: Node[] = [];
        if (!isOp(')')) {
          args.push(or());
          while (isOp(',')) {
            p++;
            args.push(or());
          }
        }
        expect(')');
        if (!hasOwn(FUNCTIONS, canon(t.v))) throw new ExprError(`Función desconocida: ${t.v}.`, t.pos);
        return { t: 'call', name: canon(t.v), args };
      }
      if (KEYWORDS.has(low)) throw new ExprError(`Uso incorrecto de "${t.v}".`, t.pos);
      throw new ExprError(`"${t.v}" no es un campo ni una función (los campos van entre corchetes: [${t.v}]).`, t.pos);
    }
    throw new ExprError(t.k === 'end' ? 'La expresión está incompleta.' : `No se esperaba "${t.v}".`, t.pos);
  };

  const node = or();
  if (peek().k !== 'end') throw new ExprError(`No se esperaba "${peek().v}".`, peek().pos);
  return node;
}

// ------------------------------------------------------------------------------------------------ evaluation

export interface EvalContext {
  /** The current record. */
  row: Row | null;
  /** The records that aggregate functions (Sum, Count…) run over. */
  scope?: Row[];
  /** Replaces Date() and Now() (for tests and reproducible reports). */
  now?: Date;
}

const ALIASES: Record<string, string> = { si: 'iif', redondear: 'round', largo: 'len', suma: 'sum', cuenta: 'count', promedio: 'avg', ucase: 'upper', lcase: 'lower', may: 'upper', año: 'year', mes: 'month', dia: 'day', día: 'day', esnulo: 'isnull', nz: 'nz', fecha: 'date', ahora: 'now', entero: 'int', abs: 'abs', izq: 'left', der: 'right', ext: 'mid', recortar: 'trim' };
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const canon = (n: string): string => {
  const l = n.toLowerCase();
  return hasOwn(ALIASES, l) ? ALIASES[l]! : l;
};

const AGGREGATES = new Set(['sum', 'count', 'avg', 'min', 'max']);

const num = (v: Value): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? -1 : 0;
  const s = v.trim().replace(',', '.');
  if (s === '' || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  return Number(s);
};
const str = (v: Value): string => (v === null ? '' : typeof v === 'boolean' ? (v ? 'Verdadero' : 'Falso') : String(v));
const truthy = (v: Value): boolean => (typeof v === 'string' ? v !== '' && v !== '0' : !!v);
const dateOf = (v: Value): Date | null => {
  if (v === null) return null;
  // ISO dates are read as local dates (new Date('2024-03-15') would be UTC and shift the day in some time zones)
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(v) : null;
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)) : new Date(typeof v === 'number' ? v : String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};
const two = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

type Fn = (args: Value[], ctx: EvalContext) => Value;
const FUNCTIONS: Record<string, Fn> = {
  iif: (a) => (truthy(a[0] ?? null) ? (a[1] ?? null) : (a[2] ?? null)),
  round: (a) => {
    const n = num(a[0] ?? null);
    if (n === null) return null;
    const d = Math.trunc(num(a[1] ?? 0) ?? 0);
    const f = 10 ** d;
    return Math.round((n + Number.EPSILON * Math.sign(n)) * f) / f;
  },
  abs: (a) => {
    const n = num(a[0] ?? null);
    return n === null ? null : Math.abs(n);
  },
  int: (a) => {
    const n = num(a[0] ?? null);
    return n === null ? null : Math.floor(n);
  },
  sqrt: (a) => {
    const n = num(a[0] ?? null);
    return n === null || n < 0 ? null : Math.sqrt(n);
  },
  len: (a) => (a[0] === null || a[0] === undefined ? null : str(a[0]).length),
  upper: (a) => (a[0] === null || a[0] === undefined ? null : str(a[0]).toUpperCase()),
  lower: (a) => (a[0] === null || a[0] === undefined ? null : str(a[0]).toLowerCase()),
  trim: (a) => (a[0] === null || a[0] === undefined ? null : str(a[0]).trim()),
  left: (a) => (a[0] === null || a[0] === undefined ? null : str(a[0]).slice(0, Math.max(0, num(a[1] ?? 0) ?? 0))),
  right: (a) => {
    if (a[0] === null || a[0] === undefined) return null;
    const n = Math.max(0, num(a[1] ?? 0) ?? 0);
    return n === 0 ? '' : str(a[0]).slice(-n);
  },
  mid: (a) => (a[0] === null || a[0] === undefined ? null : str(a[0]).substr(Math.max(0, (num(a[1] ?? 1) ?? 1) - 1), a[2] === undefined ? undefined : Math.max(0, num(a[2]) ?? 0))),
  year: (a) => dateOf(a[0] ?? null)?.getFullYear() ?? null,
  month: (a) => {
    const d = dateOf(a[0] ?? null);
    return d ? d.getMonth() + 1 : null;
  },
  day: (a) => dateOf(a[0] ?? null)?.getDate() ?? null,
  date: (_a, c) => isoDate(c.now ?? new Date()),
  now: (_a, c) => {
    const d = c.now ?? new Date();
    return `${isoDate(d)} ${two(d.getHours())}:${two(d.getMinutes())}`;
  },
  isnull: (a) => a[0] === null || a[0] === undefined,
  nz: (a) => (a[0] === null || a[0] === undefined ? (a[1] ?? 0) : a[0]),
  // aggregates are handled in evalNode (they need the scope), these are placeholders for the table of valid names
  sum: () => null,
  count: () => null,
  avg: () => null,
  min: () => null,
  max: () => null,
};

/** Names of the fields an expression reads. */
export function fieldsOf(node: Node): string[] {
  const out = new Set<string>();
  const walk = (n: Node) => {
    if (n.t === 'field') out.add(n.name);
    else if (n.t === 'un') walk(n.a);
    else if (n.t === 'bin') (walk(n.a), walk(n.b));
    else if (n.t === 'call') n.args.forEach(walk);
  };
  walk(node);
  return [...out];
}

/** Does the expression aggregate (Sum, Count, Avg, Min, Max)? */
export function hasAggregate(node: Node): boolean {
  if (node.t === 'call') return AGGREGATES.has(node.name) || node.args.some(hasAggregate);
  if (node.t === 'un') return hasAggregate(node.a);
  if (node.t === 'bin') return hasAggregate(node.a) || hasAggregate(node.b);
  return false;
}

function getField(row: Row | null, name: string): Value {
  if (!row) return null;
  if (name in row) return row[name]!;
  const k = Object.keys(row).find((x) => x.toLowerCase() === name.toLowerCase());
  if (k === undefined) throw new ExprError(`No existe el campo [${name}].`);
  return row[k]!;
}

function compare(op: string, a: Value, b: Value): boolean | null {
  if (a === null || b === null) return null;
  const x = num(a);
  const y = num(b);
  let c: number;
  if (x !== null && y !== null && (typeof a === 'number' || typeof b === 'number')) c = x < y ? -1 : x > y ? 1 : 0;
  else {
    const s = str(a).toLowerCase();
    const t = str(b).toLowerCase();
    c = s < t ? -1 : s > t ? 1 : 0;
  }
  switch (op) {
    case '=': return c === 0;
    case '<>': return c !== 0;
    case '<': return c < 0;
    case '>': return c > 0;
    case '<=': return c <= 0;
    default: return c >= 0;
  }
}

function evalNode(n: Node, ctx: EvalContext): Value {
  switch (n.t) {
    case 'num': return n.v;
    case 'str': return n.v;
    case 'lit': return n.v;
    case 'field': return getField(ctx.row, n.name);
    case 'un': {
      const v = evalNode(n.a, ctx);
      if (n.op === 'not') return v === null ? null : !truthy(v);
      const x = num(v);
      return x === null ? null : -x;
    }
    case 'bin': {
      if (n.op === 'and') {
        const a = evalNode(n.a, ctx);
        if (a !== null && !truthy(a)) return false;
        const b = evalNode(n.b, ctx);
        if (b !== null && !truthy(b)) return false;
        return a === null || b === null ? null : true;
      }
      if (n.op === 'or') {
        const a = evalNode(n.a, ctx);
        if (a !== null && truthy(a)) return true;
        const b = evalNode(n.b, ctx);
        if (b !== null && truthy(b)) return true;
        return a === null || b === null ? null : false;
      }
      const a = evalNode(n.a, ctx);
      const b = evalNode(n.b, ctx);
      if (n.op === '&') return str(a) + str(b);
      if (['=', '<>', '<', '>', '<=', '>='].includes(n.op)) return compare(n.op, a, b);
      if (n.op === '+' && (typeof a === 'string' && num(a) === null) ) return str(a) + str(b);
      const x = num(a);
      const y = num(b);
      if (x === null || y === null) return null;
      switch (n.op) {
        case '+': return x + y;
        case '-': return x - y;
        case '*': return x * y;
        case '/': return y === 0 ? null : x / y;
        case '\\': return y === 0 ? null : Math.trunc(x / y);
        case '%': return y === 0 ? null : x % y;
        default: return x ** y;
      }
    }
    case 'call': {
      if (AGGREGATES.has(n.name)) {
        const scope = ctx.scope ?? (ctx.row ? [ctx.row] : []);
        if (n.name === 'count' && n.args.length === 0) return scope.length;
        const arg = n.args[0];
        if (!arg) throw new ExprError(`${n.name} necesita un argumento.`);
        const vals = scope.map((r) => evalNode(arg, { ...ctx, row: r, scope: [r] }));
        if (n.name === 'count') return vals.filter((v) => v !== null).length;
        const nums = vals.map(num).filter((x): x is number => x !== null);
        if (!nums.length) return null;
        if (n.name === 'sum') return nums.reduce((s, x) => s + x, 0);
        if (n.name === 'avg') return nums.reduce((s, x) => s + x, 0) / nums.length;
        if (n.name === 'min') return Math.min(...nums);
        return Math.max(...nums);
      }
      return FUNCTIONS[n.name]!(n.args.map((a) => evalNode(a, ctx)), ctx);
    }
  }
}

export function evalExpr(expr: string | Node, ctx: EvalContext): Value {
  return evalNode(typeof expr === 'string' ? parseExpr(expr) : expr, ctx);
}

/** Like evalExpr, but an error becomes the text `#Error` (what a printed report or a form shows instead of failing). */
export function evalSafe(expr: string | Node, ctx: EvalContext): Value {
  try {
    return evalExpr(expr, ctx);
  } catch {
    return '#Error';
  }
}
