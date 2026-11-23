import { formatNumber, parseNumber } from './number';

/*
 * Formulas of a table, as Word and Outlook have them: «=SUM(ABOVE)», «=A1+B2», «=AVERAGE(B2:B6)», «=ROUND(C2*1.21, 2)», with an optional number
 * picture «\# "0.00"». The functions have English and Spanish names. A product gives the text of its cells and the position of the formula.
 */

export interface FormulaContext {
  /** Position of the cell that holds the formula (0-based). */
  row: number;
  col: number;
  rows: number;
  cols: number;
  /** The text of a cell (0-based). */
  text: (r: number, c: number) => string;
  /** Decimal mark of the numbers in the cells and of the result. */
  decimal?: '.' | ',';
}

export interface FormulaResult {
  value: number | null;
  /** The result as it is written in the cell (with the picture applied), or the error. */
  text: string;
  error?: string;
}

class FormulaError extends Error {}

type Value = number | number[];

// ------------------------------------------------------------------------------------------------ tokens

type Tok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string } | { k: 'end' };

/** `decimal` is the decimal mark of the numbers written in the formula: with a comma, the arguments are separated by «;» only. */
function tokenize(src: string, decimal: '.' | ','): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = (decimal === ',' ? /^\d+(?:[.,]\d+)?(?![\d])/ : /^\d+(?:\.\d+)?(?![\d])/).exec(src.slice(i));
    if (num && /\d/.test(ch)) {
      out.push({ k: 'num', v: Number(num[0].replace(',', '.')) });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ_][A-Za-zÁÉÍÓÚÜÑáéíóúüñ_0-9]*/.exec(src.slice(i));
    if (id) {
      out.push({ k: 'id', v: id[0].toUpperCase() });
      i += id[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<>' || two === '<=' || two === '>=') {
      out.push({ k: 'op', v: two });
      i += 2;
      continue;
    }
    if ('+-*/^()<>=,;:%'.includes(ch)) {
      out.push({ k: 'op', v: ch });
      i++;
      continue;
    }
    throw new FormulaError('!Error de sintaxis');
  }
  out.push({ k: 'end' });
  return out;
}

// ------------------------------------------------------------------------------------------------ names

const FN: Record<string, string> = {
  SUM: 'SUM', SUMA: 'SUM', AVERAGE: 'AVERAGE', PROMEDIO: 'AVERAGE', COUNT: 'COUNT', CONTAR: 'COUNT', MIN: 'MIN', MAX: 'MAX',
  PRODUCT: 'PRODUCT', PRODUCTO: 'PRODUCT', ABS: 'ABS', ROUND: 'ROUND', REDONDEAR: 'ROUND', INT: 'INT', ENTERO: 'INT', MOD: 'MOD', RESIDUO: 'MOD',
  SIGN: 'SIGN', SIGNO: 'SIGN', IF: 'IF', SI: 'IF', AND: 'AND', Y: 'AND', OR: 'OR', O: 'OR', NOT: 'NOT', NO: 'NOT',
};
const DIRECTION: Record<string, 'above' | 'below' | 'left' | 'right'> = { ABOVE: 'above', ARRIBA: 'above', BELOW: 'below', ABAJO: 'below', LEFT: 'left', IZQUIERDA: 'left', RIGHT: 'right', DERECHA: 'right' };

/** The functions the formulas know, with their Spanish name (for the list the interface shows). */
export const FORMULA_FUNCTIONS: { en: string; es: string; args: string }[] = [
  { en: 'SUM', es: 'SUMA', args: 'ABOVE' },
  { en: 'AVERAGE', es: 'PROMEDIO', args: 'ABOVE' },
  { en: 'COUNT', es: 'CONTAR', args: 'ABOVE' },
  { en: 'MIN', es: 'MIN', args: 'ABOVE' },
  { en: 'MAX', es: 'MAX', args: 'ABOVE' },
  { en: 'PRODUCT', es: 'PRODUCTO', args: 'ABOVE' },
  { en: 'ABS', es: 'ABS', args: 'x' },
  { en: 'ROUND', es: 'REDONDEAR', args: 'x, n' },
  { en: 'INT', es: 'ENTERO', args: 'x' },
  { en: 'MOD', es: 'RESIDUO', args: 'x, y' },
  { en: 'SIGN', es: 'SIGNO', args: 'x' },
  { en: 'IF', es: 'SI', args: 'prueba, si, no' },
  { en: 'AND', es: 'Y', args: 'a, b' },
  { en: 'OR', es: 'O', args: 'a, b' },
  { en: 'NOT', es: 'NO', args: 'a' },
];

const colIndex = (letters: string): number => [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
/** «A», «B»… «AA» for a 0-based column. */
export const colName = (c: number): string => {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
/** The name of a cell: «A1». */
export const cellName = (r: number, c: number): string => `${colName(c)}${r + 1}`;

// ------------------------------------------------------------------------------------------------ parser and evaluator

class Evaluator {
  private i = 0;
  constructor(
    private toks: Tok[],
    private ctx: FormulaContext,
  ) {}

  private peek = (): Tok => this.toks[this.i]!;
  private next = (): Tok => this.toks[this.i++]!;
  private isOp = (v: string): boolean => this.peek().k === 'op' && (this.peek() as { v: string }).v === v;
  private eat(v: string): boolean {
    if (this.isOp(v)) {
      this.i++;
      return true;
    }
    return false;
  }

  run(): number {
    const v = this.scalar(this.compare());
    if (this.peek().k !== 'end') throw new FormulaError('!Error de sintaxis');
    return v;
  }

  private scalar(v: Value): number {
    if (typeof v === 'number') return v;
    if (v.length === 1) return v[0]!;
    throw new FormulaError('!Error de sintaxis');
  }

  private compare(): Value {
    let left = this.add();
    for (;;) {
      const t = this.peek();
      if (t.k !== 'op' || !['=', '<>', '<', '>', '<=', '>='].includes(t.v)) return left;
      this.i++;
      const a = this.scalar(left);
      const b = this.scalar(this.add());
      left = Number(t.v === '=' ? a === b : t.v === '<>' ? a !== b : t.v === '<' ? a < b : t.v === '>' ? a > b : t.v === '<=' ? a <= b : a >= b);
    }
  }

  private add(): Value {
    let left = this.mul();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.next() as { v: string }).v;
      const a = this.scalar(left);
      const b = this.scalar(this.mul());
      left = op === '+' ? a + b : a - b;
    }
    return left;
  }

  private mul(): Value {
    let left = this.unary();
    while (this.isOp('*') || this.isOp('/')) {
      const op = (this.next() as { v: string }).v;
      const a = this.scalar(left);
      const b = this.scalar(this.unary());
      if (op === '/' && b === 0) throw new FormulaError('!División por cero');
      left = op === '*' ? a * b : a / b;
    }
    return left;
  }

  private unary(): Value {
    if (this.eat('-')) return -this.scalar(this.unary());
    if (this.eat('+')) return this.scalar(this.unary());
    return this.power();
  }

  private power(): Value {
    const base = this.postfix();
    if (this.eat('^')) {
      const exp = this.scalar(this.unary());
      const r = this.scalar(base) ** exp;
      if (!Number.isFinite(r)) throw new FormulaError('!Resultado no válido');
      return r;
    }
    return base;
  }

  private postfix(): Value {
    let v = this.primary();
    while (this.eat('%')) v = this.scalar(v) / 100;
    return v;
  }

  private cellValue(r: number, c: number): number | null {
    if (r < 0 || c < 0 || r >= this.ctx.rows || c >= this.ctx.cols) throw new FormulaError('!Referencia no válida');
    return parseNumber(this.ctx.text(r, c), this.ctx.decimal);
  }

  /** The numbers ABOVE / BELOW / LEFT / RIGHT of the cell: they stop at the first empty cell and skip the text. */
  private direction(d: 'above' | 'below' | 'left' | 'right'): number[] {
    const { row, col } = this.ctx;
    const [dr, dc] = d === 'above' ? [-1, 0] : d === 'below' ? [1, 0] : d === 'left' ? [0, -1] : [0, 1];
    const out: number[] = [];
    for (let r = row + dr, c = col + dc; r >= 0 && c >= 0 && r < this.ctx.rows && c < this.ctx.cols; r += dr, c += dc) {
      const t = this.ctx.text(r, c);
      if (!t.trim()) break;
      const n = parseNumber(t, this.ctx.decimal);
      if (n !== null) out.push(n);
    }
    return out;
  }

  private ref(name: string): { r: number; c: number } {
    const m = /^([A-Z]+)(\d+)$/.exec(name)!;
    return { r: Number(m[2]) - 1, c: colIndex(m[1]!) };
  }

  private args(): Value[] {
    const out: Value[] = [];
    if (this.eat(')')) return out;
    for (;;) {
      out.push(this.compare());
      if (this.eat(',') || this.eat(';')) continue;
      if (this.eat(')')) return out;
      throw new FormulaError('!Error de sintaxis');
    }
  }

  private primary(): Value {
    const t = this.next();
    if (t.k === 'num') return t.v;
    if (t.k === 'op' && t.v === '(') {
      const v = this.compare();
      if (!this.eat(')')) throw new FormulaError('!Error de sintaxis');
      return v;
    }
    if (t.k !== 'id') throw new FormulaError('!Error de sintaxis');
    const id = t.v;
    if (id === 'TRUE' || id === 'VERDADERO') return 1;
    if (id === 'FALSE' || id === 'FALSO') return 0;
    if (DIRECTION[id]) return this.direction(DIRECTION[id]!);
    if (/^[A-Z]+\d+$/.test(id) && !this.isOp('(')) {
      const a = this.ref(id);
      if (this.eat(':')) {
        const bt = this.next();
        if (bt.k !== 'id' || !/^[A-Z]+\d+$/.test(bt.v)) throw new FormulaError('!Error de sintaxis');
        const b = this.ref(bt.v);
        const out: number[] = [];
        for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++) {
          for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) {
            const n = this.cellValue(r, c);
            if (n !== null) out.push(n);
          }
        }
        return out;
      }
      return this.cellValue(a.r, a.c) ?? 0;
    }
    const fn = FN[id];
    if (!fn || !this.eat('(')) throw new FormulaError('!Error de sintaxis');
    return this.call(fn, this.args());
  }

  private call(fn: string, args: Value[]): Value {
    const flat = args.flatMap((a) => (typeof a === 'number' ? [a] : a));
    const one = (i = 0): number => {
      if (args[i] === undefined) throw new FormulaError('!Faltan argumentos');
      return this.scalar(args[i]!);
    };
    switch (fn) {
      case 'SUM':
        return flat.reduce((x, y) => x + y, 0);
      case 'PRODUCT':
        return flat.length ? flat.reduce((x, y) => x * y, 1) : 0;
      case 'COUNT':
        return flat.length;
      case 'MIN':
        return flat.length ? Math.min(...flat) : 0;
      case 'MAX':
        return flat.length ? Math.max(...flat) : 0;
      case 'AVERAGE':
        if (!flat.length) throw new FormulaError('!División por cero');
        return flat.reduce((x, y) => x + y, 0) / flat.length;
      case 'ABS':
        return Math.abs(one());
      case 'INT':
        return Math.floor(one());
      case 'SIGN':
        return Math.sign(one());
      case 'ROUND': {
        const k = 10 ** (args.length > 1 ? one(1) : 0);
        const x = one() * k;
        return (Math.sign(x) * Math.round(Math.abs(x) + 1e-9)) / k;
      }
      case 'MOD': {
        const d = one(1);
        if (d === 0) throw new FormulaError('!División por cero');
        return one() - d * Math.floor(one() / d);
      }
      case 'IF':
        return one() !== 0 ? one(1) : args.length > 2 ? one(2) : 0;
      case 'AND':
        return Number(flat.length > 0 && flat.every((x) => x !== 0));
      case 'OR':
        return Number(flat.some((x) => x !== 0));
      case 'NOT':
        return Number(one() === 0);
    }
    throw new FormulaError('!Error de sintaxis');
  }
}

/** The formula split into its expression and its number picture: «=SUM(ABOVE) \# "0.00"». */
export function splitFormula(formula: string): { expr: string; picture?: string } {
  const f = formula.trim().replace(/^=/, '');
  const m = /^(.*?)\s*\\#\s*(?:"([^"]*)"|(\S+))\s*$/.exec(f);
  return m ? { expr: m[1]!, picture: m[2] ?? m[3] } : { expr: f };
}

/** A number as written when there is no picture: up to ten significant digits, no trailing zeros. */
export function formatGeneral(n: number, decimal = '.'): string {
  const s = Number(n.toPrecision(10)).toString();
  return decimal === '.' ? s : s.replace('.', decimal);
}

/** Evaluates the formula of the cell at (ctx.row, ctx.col). Errors come as text starting with «!», like in Word. */
export function evalFormula(formula: string, ctx: FormulaContext): FormulaResult {
  try {
    const { expr, picture } = splitFormula(formula);
    if (!expr.trim()) throw new FormulaError('!Error de sintaxis');
    const value = new Evaluator(tokenize(expr, ctx.decimal ?? '.'), ctx).run();
    if (!Number.isFinite(value)) throw new FormulaError('!Resultado no válido');
    const dec = ctx.decimal ?? '.';
    const text = picture ? formatNumber(value, picture, dec, dec === '.' ? ',' : '.') : formatGeneral(value, dec);
    return { value, text };
  } catch (e) {
    if (e instanceof FormulaError) return { value: null, text: e.message, error: e.message };
    throw e;
  }
}
