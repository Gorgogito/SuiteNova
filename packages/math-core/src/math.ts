/**
 * Equations. The source of an equation is a LaTeX-like linear form; it is parsed to a small tree that can be drawn as
 * MathML and converted to and from Word's OMML.
 */

/** Estilo de un carácter: normal (recto), negrita, cursiva o ambas. */
export type RunSty = 'p' | 'b' | 'i' | 'bi';
/** Alfabeto de un carácter (lo que Word llama «escritura»). */
export type RunScr = 'script' | 'fraktur' | 'double-struck' | 'sans-serif' | 'monospace';
export interface RunFmt {
  sty?: RunSty;
  scr?: RunScr;
}

export type MNode =
  | { t: 'row'; c: MNode[] }
  | ({ t: 'num'; v: string } & RunFmt)
  | ({ t: 'id'; v: string } & RunFmt)
  | ({ t: 'op'; v: string } & RunFmt)
  | ({ t: 'text'; v: string } & RunFmt)
  | { t: 'space'; v: number }
  /** `kind`: barra horizontal (por omisión), sin barra, lineal (a/b) o sesgada (a⁄b). */
  | { t: 'frac'; n: MNode; d: MNode; bar: boolean; kind?: 'bar' | 'noBar' | 'lin' | 'skw' }
  | { t: 'sup'; b: MNode; s: MNode }
  | { t: 'sub'; b: MNode; s: MNode }
  | { t: 'subsup'; b: MNode; sub: MNode; sup: MNode }
  /** Subíndice y superíndice antes de la base (`m:sPre`). */
  | { t: 'pre'; b: MNode; sub: MNode; sup: MNode }
  | { t: 'sqrt'; c: MNode; deg: MNode | null }
  | { t: 'nary'; op: string; sub: MNode | null; sup: MNode | null; c: MNode; limits: boolean }
  | { t: 'fenced'; open: string; close: string; sep: string; c: MNode[] }
  | { t: 'func'; name: string; c: MNode; sub?: MNode }
  | { t: 'acc'; ch: string; c: MNode }
  | { t: 'bar'; c: MNode; top: boolean }
  | { t: 'limit'; b: MNode; lim: MNode; top: boolean }
  | { t: 'matrix'; rows: MNode[][]; open: string; close: string }
  /** Matriz de ecuaciones alineadas (`m:eqArr`): una fila por línea, con `&` como punto de alineación. */
  | { t: 'eqarr'; rows: MNode[] }
  /** Recuadro (`m:box` o `m:borderBox`). */
  | { t: 'box'; c: MNode; border: boolean };

export const row = (c: MNode[]): MNode => (c.length === 1 ? c[0]! : { t: 'row', c });

import { ACCENTS, FUNCS, GREEK, NARY, SYMBOLS } from './tables';

/** Characters that need a backslash to be written in the source. */
const ESCAPE_TO_CMD: Record<string, string> = Object.fromEntries([...Object.entries(GREEK), ...Object.entries(SYMBOLS)].map(([k, v]) => [v, k]));
const NARY_TO_CMD: Record<string, string> = Object.fromEntries(Object.entries(NARY).map(([k, v]) => [v, k]));

class Parser {
  i = 0;
  constructor(private s: string) {}
  private peek(): string | undefined {
    return this.s[this.i];
  }
  private ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++;
  }
  /** A command name after a backslash. */
  private cmd(): string {
    this.i++; // backslash
    const c = this.s[this.i];
    if (c === undefined) return '';
    if (/[A-Za-z]/.test(c)) {
      let n = '';
      while (this.i < this.s.length && /[A-Za-z]/.test(this.s[this.i]!)) n += this.s[this.i++];
      return n;
    }
    this.i++;
    return c;
  }
  private group(): MNode {
    this.ws();
    if (this.peek() === '{') {
      this.i++;
      const items = this.seq((p) => p.peek() === '}');
      if (this.peek() === '}') this.i++;
      return row(items);
    }
    const a = this.atom();
    return a ?? { t: 'row', c: [] };
  }
  /** Parse until `stop` says so; handles ^ and _ after an atom. */
  seq(stop: (p: Parser) => boolean): MNode[] {
    const out: MNode[] = [];
    for (;;) {
      this.ws();
      if (this.i >= this.s.length || stop(this)) break;
      let a = this.atom();
      if (!a) break;
      // scripts
      for (;;) {
        this.ws();
        const c = this.peek();
        if (c === '^') {
          this.i++;
          const sup = this.group();
          a = a.t === 'sub' ? { t: 'subsup', b: a.b, sub: a.s, sup } : { t: 'sup', b: a, s: sup };
        } else if (c === '_') {
          this.i++;
          const sub = this.group();
          a = a.t === 'sup' ? { t: 'subsup', b: a.b, sub, sup: a.s } : { t: 'sub', b: a, s: sub };
        } else if (c === "'") {
          this.i++;
          a = { t: 'sup', b: a, s: { t: 'op', v: '′' } };
        } else break;
      }
      // n-ary operators take what follows as their operand
      if (a.t === 'nary' && a.c.t === 'row' && !a.c.c.length) {
        const rest = this.seq((p) => stop(p));
        a = { ...a, c: row(rest) };
        out.push(a);
        break;
      }
      if (a.t === 'func' && a.c.t === 'row' && !a.c.c.length) {
        const next = this.operand();
        if (next) a = { ...a, c: next };
      }
      if (a.t === 'sub' && a.b.t === 'func') a = { t: 'sub', b: a.b, s: a.s };
      out.push(a);
    }
    // an n-ary operator with scripts: move the scripts into it
    return out.map((n) => this.fixNary(n));
  }
  private fixNary(n: MNode): MNode {
    return n;
  }
  /** The next factor (for functions like \sin x). */
  private operand(): MNode | null {
    this.ws();
    const c = this.peek();
    if (c === undefined || c === '}' || c === ')' || c === ']' || c === '&' || c === '\\') {
      if (c === '\\') {
        const save = this.i;
        const name = this.cmd();
        this.i = save;
        if (name === 'end' || name === 'right' || name === '\\') return null;
        return this.atom();
      }
      return null;
    }
    if (/[0-9.]/.test(c)) return this.atom();
    return this.atom();
  }
  private atom(): MNode | null {
    this.ws();
    const c = this.peek();
    if (c === undefined) return null;
    if (c === '{') return this.group();
    if (c === '}' || c === '&') return null;
    if (c === '\\') return this.command();
    if (/[0-9]/.test(c)) {
      let n = '';
      while (this.i < this.s.length && /[0-9.]/.test(this.s[this.i]!)) n += this.s[this.i++];
      return { t: 'num', v: n };
    }
    if (/\p{L}/u.test(c)) {
      this.i++;
      return { t: 'id', v: c };
    }
    this.i++;
    return { t: 'op', v: c };
  }
  private delim(): string {
    this.ws();
    const c = this.peek();
    if (c === '\\') {
      const n = this.cmd();
      if (n === '{' || n === '}' || n === '|') return n === '|' ? '‖' : n;
      return SYMBOLS[n] ?? n;
    }
    this.i++;
    return c ?? '.';
  }
  private command(): MNode | null {
    const name = this.cmd();
    switch (name) {
      case 'frac':
      case 'dfrac':
      case 'tfrac': {
        const n = this.group();
        const d = this.group();
        return { t: 'frac', n, d, bar: true };
      }
      case 'binom': {
        const n = this.group();
        const d = this.group();
        return { t: 'fenced', open: '(', close: ')', sep: '', c: [{ t: 'frac', n, d, bar: false }] };
      }
      case 'sqrt': {
        this.ws();
        let deg: MNode | null = null;
        if (this.peek() === '[') {
          this.i++;
          const items = this.seq((p) => p.peek() === ']');
          if (this.peek() === ']') this.i++;
          deg = row(items);
        }
        return { t: 'sqrt', c: this.group(), deg };
      }
      case 'left': {
        const open = this.delim();
        const parts: MNode[][] = [[]];
        // content up to the matching \right, split at \middle
        const items: MNode[] = [];
        let close = '.';
        const seps: string[] = [];
        for (;;) {
          this.ws();
          if (this.i >= this.s.length) break;
          if (this.s.startsWith('\\right', this.i) && !/[A-Za-z]/.test(this.s[this.i + 6] ?? '')) {
            this.i += 6;
            close = this.delim();
            break;
          }
          if (this.s.startsWith('\\middle', this.i)) {
            this.i += 7;
            seps.push(this.delim());
            parts.push([]);
            continue;
          }
          const chunk = this.seq((p) => p.s.startsWith('\\right', p.i) || p.s.startsWith('\\middle', p.i));
          parts[parts.length - 1]!.push(...chunk);
          if (!chunk.length && !this.s.startsWith('\\right', this.i) && !this.s.startsWith('\\middle', this.i)) this.i++;
        }
        void items;
        return { t: 'fenced', open, close, sep: seps[0] ?? '', c: parts.map((p) => row(p)) };
      }
      case 'begin': {
        const env = this.group();
        const envName = env.t === 'row' ? env.c.map((x) => (x.t === 'id' || x.t === 'op' ? x.v : '')).join('') : '';
        return this.matrix(envName);
      }
      case 'mathbf':
      case 'boldsymbol':
      case 'bm':
        return styled(this.group(), { sty: 'b' });
      case 'mathrm':
        return styled(this.group(), { sty: 'p' });
      case 'mathit':
        return styled(this.group(), { sty: 'i' });
      case 'mathbb':
        return styled(this.group(), { scr: 'double-struck' });
      case 'mathcal':
      case 'mathscr':
        return styled(this.group(), { scr: 'script' });
      case 'mathfrak':
        return styled(this.group(), { scr: 'fraktur' });
      case 'mathsf':
        return styled(this.group(), { scr: 'sans-serif' });
      case 'mathtt':
        return styled(this.group(), { scr: 'monospace' });
      case 'boxed':
        return { t: 'box', c: this.group(), border: true };
      case 'text':
      case 'textrm':
      case 'operatorname': {
        this.ws();
        let txt = '';
        if (this.peek() === '{') {
          this.i++;
          let depth = 1;
          while (this.i < this.s.length && depth) {
            const ch = this.s[this.i++]!;
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            if (depth) txt += ch;
          }
        }
        return name === 'text' || name === 'textrm' ? { t: 'text', v: txt } : name === 'operatorname' ? { t: 'func', name: txt, c: { t: 'row', c: [] } } : { t: 'text', v: txt };
      }
      case 'overline':
        return { t: 'bar', c: this.group(), top: true };
      case 'underline':
        return { t: 'bar', c: this.group(), top: false };
      case 'overbrace':
        return { t: 'limit', b: this.group(), lim: { t: 'op', v: '⏞' }, top: true };
      case 'underbrace':
        return { t: 'limit', b: this.group(), lim: { t: 'op', v: '⏟' }, top: false };
      case 'overset':
      case 'stackrel': {
        const over = this.group();
        const base = this.group();
        return { t: 'limit', b: base, lim: over, top: true };
      }
      case 'underset': {
        const under = this.group();
        const base = this.group();
        return { t: 'limit', b: base, lim: under, top: false };
      }
      case ',': return { t: 'space', v: 3 };
      case ':': return { t: 'space', v: 4 };
      case ';': return { t: 'space', v: 5 };
      case '!': return { t: 'space', v: -3 };
      case ' ': return { t: 'space', v: 4 };
      case 'quad': return { t: 'space', v: 18 };
      case 'qquad': return { t: 'space', v: 36 };
      case '{':
      case '}':
      case '%':
      case '$':
      case '#':
      case '&':
      case '_':
        return { t: 'op', v: name };
      case '|':
        return { t: 'op', v: '‖' };
      case 'lim':
        return { t: 'func', name: 'lim', c: { t: 'row', c: [] } };
      default:
    }
    if (ACCENTS[name]) return { t: 'acc', ch: ACCENTS[name]!, c: this.group() };
    if (NARY[name]) return { t: 'nary', op: NARY[name]!, sub: null, sup: null, c: { t: 'row', c: [] }, limits: name === 'sum' || name === 'prod' || name === 'coprod' || name.startsWith('big') };
    if (FUNCS.has(name)) return { t: 'func', name, c: { t: 'row', c: [] } };
    if (GREEK[name]) return { t: 'id', v: GREEK[name]! };
    if (SYMBOLS[name]) return { t: 'op', v: SYMBOLS[name]! };
    return { t: 'text', v: name };
  }
  private matrix(env: string): MNode {
    const rows: MNode[][] = [[]];
    let cur: MNode[] = [];
    const flushCell = () => {
      rows[rows.length - 1]!.push(row(cur));
      cur = [];
    };
    for (;;) {
      this.ws();
      if (this.i >= this.s.length) break;
      if (this.s.startsWith('\\end', this.i)) {
        this.i += 4;
        this.group();
        break;
      }
      if (this.s.startsWith('\\\\', this.i)) {
        this.i += 2;
        flushCell();
        rows.push([]);
        continue;
      }
      if (this.peek() === '&') {
        this.i++;
        flushCell();
        continue;
      }
      const chunk = this.seq((p) => p.peek() === '&' || p.s.startsWith('\\\\', p.i) || p.s.startsWith('\\end', p.i));
      cur.push(...chunk);
      if (!chunk.length && this.peek() !== '&' && !this.s.startsWith('\\\\', this.i) && !this.s.startsWith('\\end', this.i)) this.i++;
    }
    flushCell();
    if (rows.length && rows[rows.length - 1]!.every((c) => c.t === 'row' && !c.c.length)) rows.pop();
    const delims: Record<string, [string, string]> = { matrix: ['', ''], pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'], cases: ['{', ''], array: ['', ''] };
    if (/^(aligned|align|align\*|alignedat|split|gather|gathered|eqnarray)$/.test(env)) {
      return { t: 'eqarr', rows: rows.map((r) => row(r.flatMap((c, i) => (i ? [{ t: 'op', v: '&' } as MNode, c] : [c])))) };
    }
    const [open, close] = delims[env] ?? ['', ''];
    return { t: 'matrix', rows, open, close };
  }
}

/** Aplica un estilo a todos los caracteres de un grupo. */
function styled(n: MNode, f: RunFmt): MNode {
  switch (n.t) {
    case 'id':
    case 'num':
    case 'op':
    case 'text':
      return n.t === 'op' && !/[\p{L}\p{N}]/u.test(n.v) ? n : { ...n, ...f };
    case 'row':
      return { ...n, c: n.c.map((x) => styled(x, f)) };
    case 'sup':
      return { ...n, b: styled(n.b, f), s: styled(n.s, f) };
    case 'sub':
      return { ...n, b: styled(n.b, f), s: styled(n.s, f) };
    case 'subsup':
      return { ...n, b: styled(n.b, f), sub: styled(n.sub, f), sup: styled(n.sup, f) };
    default:
      return n;
  }
}

/** Gather scripts that follow an n-ary operator into the operator (\sum_{i=1}^{n}). */
function attachNary(nodes: MNode[]): MNode[] {
  return nodes.map((n) => {
    if (n.t === 'sub' || n.t === 'sup' || n.t === 'subsup') {
      const base = n.b;
      if (base.t === 'nary') return { ...base, sub: n.t === 'sup' ? null : n.t === 'sub' ? n.s : n.sub, sup: n.t === 'sub' ? null : n.t === 'sup' ? n.s : n.sup };
      if (base.t === 'func' && base.name === 'lim' && n.t === 'sub') return { t: 'func' as const, name: 'lim', c: { t: 'row' as const, c: [] }, sub: n.s } as unknown as MNode;
    }
    return n;
  });
}

function finish(n: MNode): MNode {
  switch (n.t) {
    case 'row': {
      let items = attachNary(n.c.map(finish));
      // an n-ary operator that came out with scripts must still take what follows
      const out: MNode[] = [];
      for (let k = 0; k < items.length; k++) {
        const it = items[k]!;
        if (it.t === 'nary' && it.c.t === 'row' && !it.c.c.length) {
          out.push({ ...it, c: row(items.slice(k + 1)) });
          items = [];
          break;
        }
        out.push(it);
      }
      return { t: 'row', c: out };
    }
    case 'frac': return { ...n, n: finish(n.n), d: finish(n.d) };
    case 'sup': return { ...n, b: finish(n.b), s: finish(n.s) };
    case 'sub': return { ...n, b: finish(n.b), s: finish(n.s) };
    case 'subsup': return { ...n, b: finish(n.b), sub: finish(n.sub), sup: finish(n.sup) };
    case 'sqrt': return { ...n, c: finish(n.c), deg: n.deg ? finish(n.deg) : null };
    case 'nary': return { ...n, sub: n.sub ? finish(n.sub) : null, sup: n.sup ? finish(n.sup) : null, c: finish(n.c) };
    case 'fenced': return { ...n, c: n.c.map(finish) };
    case 'func': return { ...n, c: finish(n.c) };
    case 'acc': return { ...n, c: finish(n.c) };
    case 'bar': return { ...n, c: finish(n.c) };
    case 'limit': return { ...n, b: finish(n.b), lim: finish(n.lim) };
    case 'matrix': return { ...n, rows: n.rows.map((r) => r.map(finish)) };
    case 'pre': return { ...n, b: finish(n.b), sub: finish(n.sub), sup: finish(n.sup) };
    case 'eqarr': return { ...n, rows: n.rows.map(finish) };
    case 'box': return { ...n, c: finish(n.c) };
    default: return n;
  }
}

/** Parse the source of an equation. Anything that is not understood is kept as text, never thrown away. */
export function parseMath(src: string): MNode {
  const p = new Parser(src);
  const items = p.seq(() => false);
  // stray closing braces and the like
  return finish({ t: 'row', c: items });
}

// ------------------------------------------------------------------------------------------------ source printer

const needsGroup = (n: MNode): boolean => !(n.t === 'num' && n.v.length === 1) && !(n.t === 'id') && !(n.t === 'op' && n.v.length === 1);

const grp = (n: MNode): string => {
  const s = toTex(n);
  return needsGroup(n) || s.length !== 1 ? `{${s}}` : s;
};

const opTex = (v: string): string => (ESCAPE_TO_CMD[v] ? `\\${ESCAPE_TO_CMD[v]} ` : v === '{' || v === '}' || v === '_' || v === '%' || v === '$' || v === '#' || v === '&' ? `\\${v}` : v);

/** The linear form of an equation (the canonical source). */
export function toTex(n: MNode): string {
  switch (n.t) {
    case 'row': return n.c.map(toTex).join('').replace(/ +(?=[\s}\]^_)])/g, ' ');
    case 'num': return styTex(n, n.v);
    case 'id': return styTex(n, ESCAPE_TO_CMD[n.v] ? `\\${ESCAPE_TO_CMD[n.v]} ` : n.v);
    case 'op': return opTex(n.v);
    case 'text': return n.sty || n.scr ? styTex(n, n.v) : `\\text{${n.v}}`;
    case 'space': return n.v >= 36 ? '\\qquad ' : n.v >= 18 ? '\\quad ' : n.v === 5 ? '\\; ' : n.v === 4 ? '\\: ' : n.v < 0 ? '\\! ' : '\\, ';
    case 'frac': return n.kind === 'lin' || n.kind === 'skw' ? `{${toTex(n.n)}}/{${toTex(n.d)}}` : n.bar ? `\\frac{${toTex(n.n)}}{${toTex(n.d)}}` : `\\binom{${toTex(n.n)}}{${toTex(n.d)}}`;
    case 'pre': return `{}_${grp(n.sub)}^${grp(n.sup)} ${toTex(n.b)}`;
    case 'eqarr': return `\\begin{aligned} ${n.rows.map((r) => toTex(r).replace(/\\&/g, '&')).join(' \\\\ ')} \\end{aligned}`;
    case 'box': return n.border ? `\\boxed{${toTex(n.c)}}` : toTex(n.c);
    case 'sup': return `${scriptBase(n.b)}^${grp(n.s)}`;
    case 'sub': return `${scriptBase(n.b)}_${grp(n.s)}`;
    case 'subsup': return `${scriptBase(n.b)}_${grp(n.sub)}^${grp(n.sup)}`;
    case 'sqrt': return n.deg ? `\\sqrt[${toTex(n.deg)}]{${toTex(n.c)}}` : `\\sqrt{${toTex(n.c)}}`;
    case 'nary': {
      const cmd = NARY_TO_CMD[n.op] ? `\\${NARY_TO_CMD[n.op]}` : n.op;
      return `${cmd}${n.sub ? `_${grp(n.sub)}` : ''}${n.sup ? `^${grp(n.sup)}` : ''} ${toTex(n.c)}`;
    }
    case 'fenced': {
      const d = (c: string) => (c === '{' || c === '}' ? `\\${c}` : c === '‖' ? '\\|' : ESCAPE_TO_CMD[c] ? `\\${ESCAPE_TO_CMD[c]}` : c || '.');
      const inner = n.c.map(toTex).join(n.sep ? ` \\middle${d(n.sep)} ` : '');
      return `\\left${d(n.open)} ${inner} \\right${d(n.close)}`;
    }
    case 'func': {
      const sub = n.sub;
      return `\\${FUNCS.has(n.name) ? n.name : `operatorname{${n.name}}`}${sub ? `_${grp(sub)}` : ''} ${toTex(n.c)}`;
    }
    case 'acc': {
      const name = Object.entries(ACCENTS).find(([, v]) => v === n.ch)?.[0] ?? 'hat';
      return `\\${name}{${toTex(n.c)}}`;
    }
    case 'bar': return n.top ? `\\overline{${toTex(n.c)}}` : `\\underline{${toTex(n.c)}}`;
    case 'limit': return n.lim.t === 'op' && n.lim.v === '⏞' ? `\\overbrace{${toTex(n.b)}}` : n.lim.t === 'op' && n.lim.v === '⏟' ? `\\underbrace{${toTex(n.b)}}` : n.top ? `\\overset{${toTex(n.lim)}}{${toTex(n.b)}}` : `\\underset{${toTex(n.lim)}}{${toTex(n.b)}}`;
    case 'matrix': {
      const env = n.open === '(' ? 'pmatrix' : n.open === '[' ? 'bmatrix' : n.open === '{' && n.close === '}' ? 'Bmatrix' : n.open === '|' ? 'vmatrix' : n.open === '‖' ? 'Vmatrix' : n.open === '{' ? 'cases' : 'matrix';
      return `\\begin{${env}} ${n.rows.map((r) => r.map(toTex).join(' & ')).join(' \\\\ ')} \\end{${env}}`;
    }
  }
}
const SCR_CMD: Record<string, string> = { script: 'mathcal', fraktur: 'mathfrak', 'double-struck': 'mathbb', 'sans-serif': 'mathsf', monospace: 'mathtt' };
/** Un carácter con su estilo en LaTeX (`\\mathbf{x}`, `\\mathbb{R}`...). */
function styTex(n: RunFmt, body: string): string {
  const b = body.trim();
  if (n.scr) return `\\${SCR_CMD[n.scr]}{${b}}`;
  if (n.sty === 'b' || n.sty === 'bi') return `\\mathbf{${b}}`;
  if (n.sty === 'p') return /^[A-Za-z]$/.test(b) ? `\\mathrm{${b}}` : body;
  return body;
}
const scriptBase = (n: MNode): string => (n.t === 'row' || n.t === 'frac' || n.t === 'fenced' ? `{${toTex(n)}}` : toTex(n));

// ------------------------------------------------------------------------------------------------ MathML

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** MathML (presentation) of an equation. */
export function toMathML(n: MNode, display = false): string {
  return `<math xmlns="http://www.w3.org/1998/Math/MathML"${display ? ' display="block"' : ''}>${mm(n)}</math>`;
}

/** El atributo `mathvariant` de un carácter con estilo. */
export function variant(n: RunFmt): string {
  if (n.scr) return ` mathvariant="${n.scr}"`;
  return n.sty === 'b' ? ' mathvariant="bold"' : n.sty === 'bi' ? ' mathvariant="bold-italic"' : n.sty === 'p' ? ' mathvariant="normal"' : n.sty === 'i' ? ' mathvariant="italic"' : '';
}

function mm(n: MNode): string {
  switch (n.t) {
    case 'row': return n.c.length === 1 ? mm(n.c[0]!) : `<mrow>${n.c.map(mm).join('')}</mrow>`;
    case 'num': return `<mn${variant(n)}>${esc(n.v)}</mn>`;
    case 'id': return `<mi${variant(n)}>${esc(n.v)}</mi>`;
    case 'op': return `<mo${variant(n)}>${esc(n.v)}</mo>`;
    case 'text': return `<mtext${variant(n)}>${esc(n.v)}</mtext>`;
    case 'space': return `<mspace width="${(n.v / 18).toFixed(3)}em"/>`;
    case 'frac':
      if (n.kind === 'lin') return `<mrow>${mm(n.n)}<mo>/</mo>${mm(n.d)}</mrow>`;
      return `<mfrac${n.bar ? '' : ' linethickness="0"'}${n.kind === 'skw' ? ' bevelled="true"' : ''}>${mm(n.n)}${mm(n.d)}</mfrac>`;
    case 'pre': return `<mmultiscripts>${mm(n.b)}<mprescripts/>${mm(n.sub)}${mm(n.sup)}</mmultiscripts>`;
    case 'eqarr': return `<mtable columnalign="left">${n.rows.map((r) => `<mtr><mtd>${mm(r)}</mtd></mtr>`).join('')}</mtable>`;
    case 'box': return n.border ? `<mrow class="nm-box" style="border:1px solid currentColor;padding:0.15em">${mm(n.c)}</mrow>` : mm(n.c);
    case 'sup': return `<msup>${mm(n.b)}${mm(n.s)}</msup>`;
    case 'sub': return `<msub>${mm(n.b)}${mm(n.s)}</msub>`;
    case 'subsup': return `<msubsup>${mm(n.b)}${mm(n.sub)}${mm(n.sup)}</msubsup>`;
    case 'sqrt': return n.deg ? `<mroot>${mm(n.c)}${mm(n.deg)}</mroot>` : `<msqrt>${mm(n.c)}</msqrt>`;
    case 'nary': {
      const op = `<mo largeop="true" stretchy="false">${esc(n.op)}</mo>`;
      let head: string;
      if (n.sub && n.sup) head = n.limits ? `<munderover>${op}${mm(n.sub)}${mm(n.sup)}</munderover>` : `<msubsup>${op}${mm(n.sub)}${mm(n.sup)}</msubsup>`;
      else if (n.sub) head = n.limits ? `<munder>${op}${mm(n.sub)}</munder>` : `<msub>${op}${mm(n.sub)}</msub>`;
      else if (n.sup) head = n.limits ? `<mover>${op}${mm(n.sup)}</mover>` : `<msup>${op}${mm(n.sup)}</msup>`;
      else head = op;
      return `<mrow>${head}${mm(n.c)}</mrow>`;
    }
    case 'fenced': {
      const body = n.c.map(mm).join(n.sep ? `<mo>${esc(n.sep)}</mo>` : '');
      return `<mrow>${n.open && n.open !== '.' ? `<mo>${esc(n.open)}</mo>` : ''}${body}${n.close && n.close !== '.' ? `<mo>${esc(n.close)}</mo>` : ''}</mrow>`;
    }
    case 'func': {
      const sub = n.sub;
      const name = `<mi mathvariant="normal">${esc(n.name)}</mi>`;
      return `<mrow>${sub ? `<munder>${name}${mm(sub)}</munder>` : name}<mo>&#x2061;</mo>${mm(n.c)}</mrow>`;
    }
    case 'acc': return `<mover accent="true">${mm(n.c)}<mo>${esc(n.ch)}</mo></mover>`;
    case 'bar': return n.top ? `<mover>${mm(n.c)}<mo>‾</mo></mover>` : `<munder>${mm(n.c)}<mo>_</mo></munder>`;
    case 'limit': return n.top ? `<mover>${mm(n.b)}${mm(n.lim)}</mover>` : `<munder>${mm(n.b)}${mm(n.lim)}</munder>`;
    case 'matrix': {
      const table = `<mtable>${n.rows.map((r) => `<mtr>${r.map((c) => `<mtd>${mm(c)}</mtd>`).join('')}</mtr>`).join('')}</mtable>`;
      return n.open || n.close ? `<mrow>${n.open ? `<mo>${esc(n.open)}</mo>` : ''}${table}${n.close ? `<mo>${esc(n.close)}</mo>` : ''}</mrow>` : table;
    }
  }
}

// ------------------------------------------------------------------------------------------------ OMML (Word)

const M_NS = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
export const OMML_NS = M_NS;

/** Propiedades del texto de cada carácter: las de Word por omisión; PowerPoint usa `a:rPr`. */
export interface OmmlOptions {
  /** XML de las propiedades de texto (`<w:rPr>`, `<a:rPr>`), o '' para no escribirlas. */
  rPr?: string;
}
const WORD_RPR = '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>';
let RPR = WORD_RPR;
const mr = (text: string, fmt: RunFmt | boolean = false): string => {
  const f: RunFmt = fmt === true ? { sty: 'p' } : fmt === false ? {} : fmt;
  const pr = (f.scr ? `<m:scr m:val="${f.scr}"/>` : '') + (f.sty ? `<m:sty m:val="${f.sty}"/>` : '');
  return `<m:r>${pr ? `<m:rPr>${pr}</m:rPr>` : ''}${RPR}<m:t xml:space="preserve">${esc(text)}</m:t></m:r>`;
};
const me = (n: MNode): string => `<m:e>${om(n)}</m:e>`;

/** OMML for an equation (the children of `m:oMath`). Needs the `w` and `m` namespaces around it. */
export function toOMML(n: MNode, opts: OmmlOptions = {}): string {
  RPR = opts.rPr ?? WORD_RPR;
  try {
    return om(n);
  } finally {
    RPR = WORD_RPR;
  }
}

function om(n: MNode): string {
  switch (n.t) {
    case 'row': return n.c.map(om).join('');
    case 'num': return mr(n.v, n);
    case 'id': return mr(n.v, n);
    case 'op': return mr(n.v, n);
    case 'text': return mr(n.v, n.sty || n.scr ? n : true);
    case 'space': return mr(n.v >= 18 ? '  ' : ' ');
    case 'frac': return `<m:f>${n.kind === 'lin' || n.kind === 'skw' ? `<m:fPr><m:type m:val="${n.kind}"/></m:fPr>` : n.bar ? '' : '<m:fPr><m:type m:val="noBar"/></m:fPr>'}<m:num>${om(n.n)}</m:num><m:den>${om(n.d)}</m:den></m:f>`;
    case 'sup': return `<m:sSup><m:e>${om(n.b)}</m:e><m:sup>${om(n.s)}</m:sup></m:sSup>`;
    case 'sub': return `<m:sSub><m:e>${om(n.b)}</m:e><m:sub>${om(n.s)}</m:sub></m:sSub>`;
    case 'subsup': return `<m:sSubSup><m:e>${om(n.b)}</m:e><m:sub>${om(n.sub)}</m:sub><m:sup>${om(n.sup)}</m:sup></m:sSubSup>`;
    case 'pre': return `<m:sPre><m:sub>${om(n.sub)}</m:sub><m:sup>${om(n.sup)}</m:sup>${me(n.b)}</m:sPre>`;
    case 'eqarr': return `<m:eqArr>${n.rows.map(me).join('')}</m:eqArr>`;
    case 'box': return n.border ? `<m:borderBox>${me(n.c)}</m:borderBox>` : `<m:box>${me(n.c)}</m:box>`;
    case 'sqrt': return `<m:rad><m:radPr>${n.deg ? '' : '<m:degHide m:val="1"/>'}</m:radPr><m:deg>${n.deg ? om(n.deg) : ''}</m:deg>${me(n.c)}</m:rad>`;
    case 'nary': return `<m:nary><m:naryPr><m:chr m:val="${esc(n.op)}"/><m:limLoc m:val="${n.limits ? 'undOvr' : 'subSup'}"/>${n.sub ? '' : '<m:subHide m:val="1"/>'}${n.sup ? '' : '<m:supHide m:val="1"/>'}</m:naryPr><m:sub>${n.sub ? om(n.sub) : ''}</m:sub><m:sup>${n.sup ? om(n.sup) : ''}</m:sup>${me(n.c)}</m:nary>`;
    case 'fenced': return `<m:d><m:dPr><m:begChr m:val="${esc(n.open === '.' ? '' : n.open)}"/>${n.sep ? `<m:sepChr m:val="${esc(n.sep)}"/>` : ''}<m:endChr m:val="${esc(n.close === '.' ? '' : n.close)}"/></m:dPr>${n.c.map(me).join('')}</m:d>`;
    case 'func': {
      const sub = n.sub;
      const name = `<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>${esc(n.name)}</m:t></m:r>`;
      return `<m:func><m:fName>${sub ? `<m:limLow><m:e>${name}</m:e><m:lim>${om(sub)}</m:lim></m:limLow>` : name}</m:fName>${me(n.c)}</m:func>`;
    }
    case 'acc': return `<m:acc><m:accPr><m:chr m:val="${esc(n.ch)}"/></m:accPr>${me(n.c)}</m:acc>`;
    case 'bar': return `<m:bar><m:barPr><m:pos m:val="${n.top ? 'top' : 'bot'}"/></m:barPr>${me(n.c)}</m:bar>`;
    case 'limit': return n.top ? `<m:limUpp><m:e>${om(n.b)}</m:e><m:lim>${om(n.lim)}</m:lim></m:limUpp>` : `<m:limLow><m:e>${om(n.b)}</m:e><m:lim>${om(n.lim)}</m:lim></m:limLow>`;
    case 'matrix': {
      const m = `<m:m>${n.rows.map((r) => `<m:mr>${r.map(me).join('')}</m:mr>`).join('')}</m:m>`;
      return n.open || n.close ? `<m:d><m:dPr><m:begChr m:val="${esc(n.open)}"/><m:endChr m:val="${esc(n.close)}"/></m:dPr><m:e>${m}</m:e></m:d>` : m;
    }
  }
}

interface X {
  [k: string]: any;
}

/** Read OMML (an `m:oMath` node parsed with preserveOrder, namespace prefixes removed) back to the tree. */
export function fromOMML(kids: X[], tagOf: (n: X) => string, kidsOf: (n: X) => X[], attrOf: (n: X, a: string) => string | undefined, textOf: (n: X) => string): MNode {
  const find = (n: X, tag: string): X | undefined => kidsOf(n).find((k) => tagOf(k) === tag);
  const seq = (list: X[]): MNode => row(list.map(one).filter((x): x is MNode => !!x));
  const body = (n: X | undefined): MNode => (n ? seq(kidsOf(n)) : { t: 'row', c: [] });
  const one = (n: X): MNode | null => {
    switch (tagOf(n)) {
      case 'r': {
        const t = find(n, 't');
        const txt = t ? textOf(t) : '';
        if (!txt) return null;
        const rpr = find(n, 'rPr') ?? {};
        const stv = attrOf(find(rpr, 'sty') ?? {}, 'val');
        const scv = attrOf(find(rpr, 'scr') ?? {}, 'val');
        const plain = stv === 'p' && !scv;
        const fmt: RunFmt = {};
        if (stv === 'b' || stv === 'bi' || stv === 'i') fmt.sty = stv;
        if (stv === 'p' && scv) fmt.sty = 'p';
        if (scv === 'script' || scv === 'fraktur' || scv === 'double-struck' || scv === 'sans-serif' || scv === 'monospace') fmt.scr = scv;
        const parts: MNode[] = [];
        for (const ch of txt) {
          if (/[0-9.]/.test(ch)) {
            const last = parts[parts.length - 1];
            if (last && last.t === 'num') last.v += ch;
            else parts.push({ t: 'num', v: ch, ...fmt });
          } else if (/\p{L}/u.test(ch)) parts.push(plain ? { t: 'text', v: ch } : { t: 'id', v: ch, ...fmt });
          else if (/\s/.test(ch)) parts.push({ t: 'space', v: 4 });
          else parts.push({ t: 'op', v: ch, ...fmt });
        }
        if (plain) {
          const merged = parts.every((p) => p.t === 'text') ? [{ t: 'text', v: txt } as MNode] : parts;
          return row(merged);
        }
        return row(parts);
      }
      case 'f': {
        const ty = attrOf(find(find(n, 'fPr') ?? {}, 'type') ?? {}, 'val');
        return { t: 'frac', n: body(find(n, 'num')), d: body(find(n, 'den')), bar: ty !== 'noBar', ...(ty === 'lin' || ty === 'skw' ? { kind: ty } : {}) };
      }
      case 'sSup': return { t: 'sup', b: body(find(n, 'e')), s: body(find(n, 'sup')) };
      case 'sSub': return { t: 'sub', b: body(find(n, 'e')), s: body(find(n, 'sub')) };
      case 'sSubSup': return { t: 'subsup', b: body(find(n, 'e')), sub: body(find(n, 'sub')), sup: body(find(n, 'sup')) };
      case 'rad': {
        const hide = attrOf(find(find(n, 'radPr') ?? {}, 'degHide') ?? {}, 'val');
        const deg = find(n, 'deg');
        return { t: 'sqrt', c: body(find(n, 'e')), deg: hide === '1' || hide === 'true' || !deg || !kidsOf(deg).length ? null : body(deg) };
      }
      case 'nary': {
        const pr = find(n, 'naryPr') ?? {};
        const chr = attrOf(find(pr, 'chr') ?? {}, 'val') ?? '∫';
        const limLoc = attrOf(find(pr, 'limLoc') ?? {}, 'val') ?? (chr === '∫' || chr === '∬' || chr === '∭' || chr === '∮' ? 'subSup' : 'undOvr');
        const subHide = attrOf(find(pr, 'subHide') ?? {}, 'val');
        const supHide = attrOf(find(pr, 'supHide') ?? {}, 'val');
        const sub = find(n, 'sub');
        const sup = find(n, 'sup');
        return {
          t: 'nary',
          op: chr,
          sub: subHide === '1' || !sub || !kidsOf(sub).length ? null : body(sub),
          sup: supHide === '1' || !sup || !kidsOf(sup).length ? null : body(sup),
          c: body(find(n, 'e')),
          limits: limLoc === 'undOvr',
        };
      }
      case 'd': {
        const pr = find(n, 'dPr') ?? {};
        const open = attrOf(find(pr, 'begChr') ?? {}, 'val') ?? '(';
        const close = attrOf(find(pr, 'endChr') ?? {}, 'val') ?? ')';
        const sep = attrOf(find(pr, 'sepChr') ?? {}, 'val') ?? '|';
        const es = kidsOf(n).filter((k) => tagOf(k) === 'e');
        if (es.length === 1) {
          const inner = kidsOf(es[0]!);
          if (inner.length === 1 && tagOf(inner[0]!) === 'm') {
            const mx = one(inner[0]!);
            if (mx && mx.t === 'matrix') return { ...mx, open, close };
          }
        }
        return { t: 'fenced', open: open || '.', close: close || '.', sep: es.length > 1 ? sep : '', c: es.map((e) => body(e)) };
      }
      case 'func': {
        const fname = find(n, 'fName');
        const name = fname ? textOf(fname) : '';
        const lim = fname ? find(fname, 'limLow') : undefined;
        const out: MNode = { t: 'func', name: lim ? textOf(find(lim, 'e') ?? {}) : name, c: body(find(n, 'e')) };
        if (lim) out.sub = body(find(lim, 'lim'));
        return out;
      }
      case 'acc': return { t: 'acc', ch: attrOf(find(find(n, 'accPr') ?? {}, 'chr') ?? {}, 'val') ?? '̂', c: body(find(n, 'e')) };
      case 'bar': return { t: 'bar', c: body(find(n, 'e')), top: (attrOf(find(find(n, 'barPr') ?? {}, 'pos') ?? {}, 'val') ?? 'top') === 'top' };
      case 'limUpp': return { t: 'limit', b: body(find(n, 'e')), lim: body(find(n, 'lim')), top: true };
      case 'limLow': return { t: 'limit', b: body(find(n, 'e')), lim: body(find(n, 'lim')), top: false };
      case 'm': return { t: 'matrix', rows: kidsOf(n).filter((k) => tagOf(k) === 'mr').map((r) => kidsOf(r).filter((k) => tagOf(k) === 'e').map((e) => body(e))), open: '', close: '' };
      case 'groupChr': return body(find(n, 'e'));
      case 'box': return { t: 'box', c: body(find(n, 'e')), border: false };
      case 'borderBox': return { t: 'box', c: body(find(n, 'e')), border: true };
      case 'phant': return body(find(n, 'e'));
      case 'sPre': return { t: 'pre', b: body(find(n, 'e')), sub: body(find(n, 'sub')), sup: body(find(n, 'sup')) };
      case 'eqArr': return { t: 'eqarr', rows: kidsOf(n).filter((k) => tagOf(k) === 'e').map((e) => body(e)) };
      case 'oMath': return seq(kidsOf(n));
      default: return null;
    }
  };
  return seq(kids);
}
