import { MAX_COLS, MAX_ROWS, nameToCol, parseA1, type CellAddr } from './addr';
import type { BinOp, Node } from './ast';
import { CalcError } from './values';
import { parseTrefBody } from './tables';

export class FormulaSyntaxError extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(message);
  }
}

const SHEET_RE = /^(?:'((?:[^']|'')+)'|([A-Za-z_À-￿][\w.À-￿]*))!/;
const SHEET3D_RE = /^([A-Za-z_À-￿][\w.À-￿]*):([A-Za-z_À-￿][\w.À-￿]*)!/;
const CELL_RE =/^\$?[A-Za-z]{1,3}\$?\d{1,7}(?![\w.(À-￿])/;
const COLRANGE_RE = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})(?![\w.(À-￿])/;
const ROWRANGE_RE = /^\$?(\d{1,7}):\$?(\d{1,7})(?![\w.(])/;
const NUMBER_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT_RE = /^[A-Za-z_À-￿][\w.À-￿]*/;
const ERROR_RE = /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|SPILL!|CALC!|CIRC!)/i;

/** `sp`: whitespace came before the token (a space between two references is the intersection operator). */
type Tok = (
  | { k: 'num'; v: number; pos: number }
  | { k: 'str'; v: string; pos: number }
  | { k: 'err'; v: string; pos: number }
  | { k: 'cell'; sheet?: string; sheetEnd?: string; text: string; pos: number }
  | { k: 'colrange'; sheet?: string; sheetEnd?: string; a: string; b: string; text: string; pos: number }
  | { k: 'rowrange'; sheet?: string; sheetEnd?: string; a: number; b: number; text: string; pos: number }
  | { k: 'tref'; table?: string; body: string; pos: number }
  | { k: 'ident'; v: string; pos: number }
  | { k: 'func'; v: string; pos: number }
  | { k: 'op'; v: string; pos: number }
  | { k: 'eof'; pos: number }
) & { sp?: boolean };

/** Sheet name(s) of a prefix: 'Hoja 1:Hoja 3'! and Hoja1:Hoja3! both give a first and a last sheet. */
function sheetsOf(m: RegExpExecArray, threeD: boolean): { sheet: string; sheetEnd?: string } {
  if (threeD) return { sheet: m[1]!, sheetEnd: m[2]! };
  const name = m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2]!;
  if (m[1] !== undefined && name.includes(':')) {
    const i = name.indexOf(':');
    return { sheet: name.slice(0, i), sheetEnd: name.slice(i + 1) };
  }
  return { sheet: name };
}

/** Index of the ] that closes the [ at `start`; ' escapes the next character, [ nests. */
function scanBracket(src: string, start: number): number {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === "'" && i + 1 < src.length) {
      i++;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) return i;
  }
  throw new FormulaSyntaxError('Referencia de tabla sin cerrar', start);
}

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let space = false;
  const push = toks.push.bind(toks);
  toks.push = (...t: Tok[]) => {
    if (space) for (const x of t) x.sp = true;
    space = false;
    return push(...t);
  };
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      space = true;
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let s = '';
      for (;;) {
        if (j >= src.length) throw new FormulaSyntaxError('Cadena sin cerrar', i);
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            s += '"';
            j += 2;
            continue;
          }
          break;
        }
        s += src[j++];
      }
      toks.push({ k: 'str', v: s, pos: i });
      i = j + 1;
      continue;
    }
    const rest = src.slice(i);
    if (ch === '#') {
      const m = ERROR_RE.exec(rest);
      if (!m) throw new FormulaSyntaxError('Error no válido', i);
      toks.push({ k: 'err', v: m[0].toUpperCase(), pos: i });
      i += m[0].length;
      continue;
    }

    if (ch === '[') {
      const end = scanBracket(src, i);
      toks.push({ k: 'tref', body: src.slice(i + 1, end), pos: i });
      i = end + 1;
      continue;
    }

    // Optional sheet prefix, then a reference.
    let sheet: string | undefined;
    let sheetEnd: string | undefined;
    let body = rest;
    let off = 0;
    const sm = SHEET_RE.exec(rest);
    const s3 = sm ? null : SHEET3D_RE.exec(rest);
    if (sm || s3) {
      const names = sheetsOf((sm ?? s3)!, !sm);
      sheet = names.sheet;
      sheetEnd = names.sheetEnd;
      off = (sm ?? s3)![0].length;
      body = rest.slice(off);
    }
    // a deleted reference keeps its sheet prefix in files: 'Sheet'!#REF!
    if (sheet !== undefined && /^#REF!/i.test(body)) {
      toks.push({ k: 'err', v: '#REF!', pos: i });
      i += off + 5;
      continue;
    }
    const startsRefLike = /^[$A-Za-z0-9]/.test(body);
    if (startsRefLike) {
      let m: RegExpExecArray | null;
      if ((m = ROWRANGE_RE.exec(body))) {
        toks.push({ k: 'rowrange', sheet, sheetEnd, a: Number(m[1]), b: Number(m[2]), text: m[0], pos: i });
        i += off + m[0].length;
        continue;
      }
      if ((m = COLRANGE_RE.exec(body)) && nameToCol(m[1]!) >= 0 && nameToCol(m[2]!) >= 0) {
        toks.push({ k: 'colrange', sheet, sheetEnd, a: m[1]!, b: m[2]!, text: m[0], pos: i });
        i += off + m[0].length;
        continue;
      }
      if ((m = CELL_RE.exec(body)) && parseA1(m[0])) {
        toks.push({ k: 'cell', sheet, sheetEnd, text: m[0], pos: i });
        i += off + m[0].length;
        continue;
      }
    }
    if (sheet !== undefined) throw new FormulaSyntaxError('Referencia no válida', i);

    let m: RegExpExecArray | null;
    if ((m = NUMBER_RE.exec(rest))) {
      toks.push({ k: 'num', v: Number(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if ((m = IDENT_RE.exec(rest))) {
      // Table1[Col]: a table name followed straight away by its bracketed part
      if (rest[m[0].length] === '[') {
        const end = scanBracket(src, i + m[0].length);
        toks.push({ k: 'tref', table: m[0], body: src.slice(i + m[0].length + 1, end), pos: i });
        i = end + 1;
        continue;
      }
      const after = rest[m[0].length];
      toks.push(after === '(' ? { k: 'func', v: m[0], pos: i } : { k: 'ident', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    const two = rest.slice(0, 2);
    if (two === '<>' || two === '<=' || two === '>=') {
      toks.push({ k: 'op', v: two, pos: i });
      i += 2;
      continue;
    }
    if ('+-*/^&=<>%(),;:{}@'.includes(ch)) {
      toks.push({ k: 'op', v: ch, pos: i });
      i++;
      continue;
    }
    throw new FormulaSyntaxError(`Carácter inesperado "${ch}"`, i);
  }
  toks.push({ k: 'eof', pos: src.length });
  return toks;
}

const refish = (e: Node): boolean => e.t === 'ref' || e.t === 'range' || e.t === 'call' || e.t === 'callv' || e.t === 'rangeop' || e.t === 'name' || e.t === 'union' || e.t === 'isect' || e.t === 'tref';

class Parser {
  private p = 0;
  constructor(private toks: Tok[]) {}

  private get cur(): Tok {
    return this.toks[this.p]!;
  }
  private isOp(v: string): boolean {
    const c = this.cur;
    return c.k === 'op' && c.v === v;
  }
  private eat(v: string): void {
    if (!this.isOp(v)) throw new FormulaSyntaxError(`Se esperaba "${v}"`, this.cur.pos);
    this.p++;
  }

  parse(): Node {
    const n = this.comparison();
    if (this.cur.k !== 'eof') throw new FormulaSyntaxError('Texto inesperado al final de la fórmula', this.cur.pos);
    return n;
  }

  private comparison(): Node {
    let l = this.concat();
    for (;;) {
      const c = this.cur;
      if (c.k === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(c.v)) {
        this.p++;
        l = { t: 'bin', op: c.v as BinOp, l, r: this.concat() };
      } else return l;
    }
  }
  private concat(): Node {
    let l = this.add();
    while (this.isOp('&')) {
      this.p++;
      l = { t: 'bin', op: '&', l, r: this.add() };
    }
    return l;
  }
  private add(): Node {
    let l = this.mul();
    for (;;) {
      const c = this.cur;
      if (c.k === 'op' && (c.v === '+' || c.v === '-')) {
        this.p++;
        l = { t: 'bin', op: c.v, l, r: this.mul() };
      } else return l;
    }
  }
  private mul(): Node {
    let l = this.pow();
    for (;;) {
      const c = this.cur;
      if (c.k === 'op' && (c.v === '*' || c.v === '/')) {
        this.p++;
        l = { t: 'bin', op: c.v, l, r: this.pow() };
      } else return l;
    }
  }
  private pow(): Node {
    let l = this.unary();
    while (this.isOp('^')) {
      this.p++;
      l = { t: 'bin', op: '^', l, r: this.unary() };
    }
    return l;
  }
  private unary(): Node {
    const c = this.cur;
    if (c.k === 'op' && (c.v === '-' || c.v === '+')) {
      this.p++;
      return { t: 'un', op: c.v, e: this.unary() };
    }
    return this.percent();
  }
  private percent(): Node {
    let e = this.refTerm();
    while (this.isOp('%')) {
      this.p++;
      e = { t: 'pct', e };
    }
    return e;
  }

  /** An operand with the reference operators: ":" (range), " " (intersection), calls of function values, and a leading "@". */
  private refTerm(): Node {
    if (this.isOp('@')) {
      this.p++;
      return { t: 'implicit', e: this.refTerm() };
    }
    let e = this.primary();
    for (;;) {
      // a reference or function result followed by ':' forms a range (e.g. INDEX(...):INDEX(...))
      if (this.isOp(':') && refish(e)) {
        this.p++;
        e = { t: 'rangeop', l: e, r: this.primary() };
        continue;
      }
      // LAMBDA(x, x + 1)(3): calling the value a call gave back
      if (this.isOp('(') && !this.cur.sp && (e.t === 'call' || e.t === 'callv')) {
        e = { t: 'callv', fn: e, args: this.args() };
        continue;
      }
      // two references with only a space between them: the cells both share
      if (this.cur.sp && refish(e) && this.startsReference()) {
        e = { t: 'isect', l: e, r: this.primary() };
        continue;
      }
      return e;
    }
  }

  private startsReference(): boolean {
    const c = this.cur;
    if (c.k === 'cell' || c.k === 'colrange' || c.k === 'rowrange' || c.k === 'func') return true;
    if (c.k === 'ident') return !['TRUE', 'FALSE'].includes(c.v.toUpperCase());
    return c.k === 'op' && c.v === '(';
  }

  private args(): Node[] {
    this.eat('(');
    const args: Node[] = [];
    if (!this.isOp(')')) {
      for (;;) {
        if (this.isOp(',') || this.isOp(')')) args.push({ t: 'missing' });
        else args.push(this.comparison());
        if (this.isOp(',')) {
          this.p++;
          continue;
        }
        break;
      }
    }
    this.eat(')');
    return args;
  }

  private cellAddr(text: string): CellAddr {
    return parseA1(text)!;
  }

  private primary(): Node {
    const c = this.cur;
    switch (c.k) {
      case 'num':
        this.p++;
        return { t: 'num', v: c.v };
      case 'str':
        this.p++;
        return { t: 'str', v: c.v };
      case 'err':
        this.p++;
        return { t: 'err', v: CalcError.parse(c.v)! };
      case 'cell': {
        this.p++;
        const a = this.cellAddr(c.text);
        if (this.isOp(':')) {
          const nxt = this.toks[this.p + 1];
          if (nxt?.k === 'cell') {
            this.p += 2;
            return { t: 'range', sheet: c.sheet, sheetEnd: c.sheetEnd, a, b: this.cellAddr(nxt.text) };
          }
        }
        return { t: 'ref', sheet: c.sheet, sheetEnd: c.sheetEnd, a };
      }
      case 'colrange': {
        this.p++;
        const abs = (s: string) => /\$/.test(s);
        const [x, y] = c.text.split(':') as [string, string];
        return {
          t: 'range',
          sheet: c.sheet,
          sheetEnd: c.sheetEnd,
          whole: 'col',
          a: { row: 0, col: nameToCol(c.a), absRow: true, absCol: abs(x) },
          b: { row: MAX_ROWS - 1, col: nameToCol(c.b), absRow: true, absCol: abs(y) },
        };
      }
      case 'rowrange': {
        this.p++;
        const [x, y] = c.text.split(':') as [string, string];
        return {
          t: 'range',
          sheet: c.sheet,
          sheetEnd: c.sheetEnd,
          whole: 'row',
          a: { row: c.a - 1, col: 0, absRow: /\$/.test(x), absCol: true },
          b: { row: c.b - 1, col: MAX_COLS - 1, absRow: /\$/.test(y), absCol: true },
        };
      }
      case 'func': {
        this.p++;
        const args = this.args();
        const up = c.v.toUpperCase();
        // Excel stores @ as a call of SINGLE
        if ((up === 'SINGLE' || up === '_XLFN.SINGLE') && args.length === 1) return { t: 'implicit', e: args[0]! };
        return { t: 'call', name: up, args };
      }
      case 'tref': {
        this.p++;
        const spec = parseTrefBody(c.body);
        if (!spec) throw new FormulaSyntaxError('Referencia de tabla no válida', c.pos);
        return { t: 'tref', table: c.table, ...spec };
      }
      case 'ident': {
        this.p++;
        const up = c.v.toUpperCase();
        if (up === 'TRUE') return { t: 'bool', v: true };
        if (up === 'FALSE') return { t: 'bool', v: false };
        return { t: 'name', name: c.v };
      }
      case 'op':
        if (c.v === '(') {
          this.p++;
          const e = this.comparison();
          // (A1:A3,C1:C3): the union of several references
          if (this.isOp(',')) {
            const parts = [e];
            while (this.isOp(',')) {
              this.p++;
              parts.push(this.comparison());
            }
            this.eat(')');
            return { t: 'union', parts };
          }
          this.eat(')');
          return e;
        }
        if (c.v === '{') {
          this.p++;
          const rows: Node[][] = [[]];
          for (;;) {
            rows[rows.length - 1]!.push(this.comparison());
            if (this.isOp(',')) this.p++;
            else if (this.isOp(';')) {
              this.p++;
              rows.push([]);
            } else break;
          }
          this.eat('}');
          const w = rows[0]!.length;
          if (rows.some((r) => r.length !== w)) throw new FormulaSyntaxError('Las filas de la matriz deben tener el mismo ancho', c.pos);
          return { t: 'arr', rows };
        }
        throw new FormulaSyntaxError(`Operador inesperado "${c.v}"`, c.pos);
      case 'eof':
        throw new FormulaSyntaxError('La fórmula está incompleta', c.pos);
    }
  }
}

/** Parse a formula body (without the leading "="), canonical en-US syntax. */
export function parseFormula(src: string): Node {
  return new Parser(tokenize(src)).parse();
}
