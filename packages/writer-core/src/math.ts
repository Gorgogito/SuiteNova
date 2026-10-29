/**
 * Equations. The source of an equation is a LaTeX-like linear form; it is parsed to a small tree that can be drawn as
 * MathML and converted to and from Word's OMML.
 */

export type MNode =
  | { t: 'row'; c: MNode[] }
  | { t: 'num'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'text'; v: string }
  | { t: 'space'; v: number }
  | { t: 'frac'; n: MNode; d: MNode; bar: boolean }
  | { t: 'sup'; b: MNode; s: MNode }
  | { t: 'sub'; b: MNode; s: MNode }
  | { t: 'subsup'; b: MNode; sub: MNode; sup: MNode }
  | { t: 'sqrt'; c: MNode; deg: MNode | null }
  | { t: 'nary'; op: string; sub: MNode | null; sup: MNode | null; c: MNode; limits: boolean }
  | { t: 'fenced'; open: string; close: string; sep: string; c: MNode[] }
  | { t: 'func'; name: string; c: MNode }
  | { t: 'acc'; ch: string; c: MNode }
  | { t: 'bar'; c: MNode; top: boolean }
  | { t: 'limit'; b: MNode; lim: MNode; top: boolean }
  | { t: 'matrix'; rows: MNode[][]; open: string; close: string };

export const row = (c: MNode[]): MNode => (c.length === 1 ? c[0]! : { t: 'row', c });

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};
const SYMBOLS: Record<string, string> = {
  pm: '±', mp: '∓', times: '×', div: '÷', cdot: '⋅', ast: '∗', star: '⋆', circ: '∘', bullet: '∙', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝', ll: '≪', gg: '≫',
  infty: '∞', partial: '∂', nabla: '∇', forall: '∀', exists: '∃', nexists: '∄', emptyset: '∅', varnothing: '∅', in: '∈', notin: '∉', ni: '∋', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', cup: '∪', cap: '∩', setminus: '∖',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', mapsto: '↦', uparrow: '↑', downarrow: '↓', implies: '⟹', iff: '⟺',
  ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', dots: '…', angle: '∠', perp: '⊥', parallel: '∥', neg: '¬', land: '∧', lor: '∨', wedge: '∧', vee: '∨', oplus: '⊕', otimes: '⊗', prime: '′', degree: '°', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', therefore: '∴', because: '∵',
  lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', langle: '⟨', rangle: '⟩', '|': '‖',
};
const NARY: Record<string, string> = { sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮', bigcup: '⋃', bigcap: '⋂', bigoplus: '⨁', bigotimes: '⨂', bigvee: '⋁', bigwedge: '⋀' };
const FUNCS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'coth', 'log', 'ln', 'lg', 'exp', 'lim', 'liminf', 'limsup', 'max', 'min', 'sup', 'inf', 'det', 'dim', 'ker', 'gcd', 'deg', 'arg', 'mod', 'Pr', 'hom']);
const ACCENTS: Record<string, string> = { hat: '̂', bar: '̅', vec: '⃗', dot: '̇', ddot: '̈', tilde: '̃', widehat: '̂', widetilde: '̃', acute: '́', grave: '̀', breve: '̆', check: '̌' };

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
      case 'text':
      case 'mathrm':
      case 'textrm':
      case 'mathbf':
      case 'mathit':
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
    const [open, close] = delims[env] ?? ['', ''];
    return { t: 'matrix', rows, open, close };
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
    case 'num': return n.v;
    case 'id': return ESCAPE_TO_CMD[n.v] ? `\\${ESCAPE_TO_CMD[n.v]} ` : n.v;
    case 'op': return opTex(n.v);
    case 'text': return `\\text{${n.v}}`;
    case 'space': return n.v >= 36 ? '\\qquad ' : n.v >= 18 ? '\\quad ' : n.v === 5 ? '\\; ' : n.v === 4 ? '\\: ' : n.v < 0 ? '\\! ' : '\\, ';
    case 'frac': return n.bar ? `\\frac{${toTex(n.n)}}{${toTex(n.d)}}` : `\\binom{${toTex(n.n)}}{${toTex(n.d)}}`;
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
      const sub = (n as unknown as { sub?: MNode }).sub;
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
const scriptBase = (n: MNode): string => (n.t === 'row' || n.t === 'frac' || n.t === 'fenced' ? `{${toTex(n)}}` : toTex(n));

// ------------------------------------------------------------------------------------------------ MathML

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** MathML (presentation) of an equation. */
export function toMathML(n: MNode, display = false): string {
  return `<math xmlns="http://www.w3.org/1998/Math/MathML"${display ? ' display="block"' : ''}>${mm(n)}</math>`;
}

function mm(n: MNode): string {
  switch (n.t) {
    case 'row': return n.c.length === 1 ? mm(n.c[0]!) : `<mrow>${n.c.map(mm).join('')}</mrow>`;
    case 'num': return `<mn>${esc(n.v)}</mn>`;
    case 'id': return `<mi>${esc(n.v)}</mi>`;
    case 'op': return `<mo>${esc(n.v)}</mo>`;
    case 'text': return `<mtext>${esc(n.v)}</mtext>`;
    case 'space': return `<mspace width="${(n.v / 18).toFixed(3)}em"/>`;
    case 'frac': return `<mfrac${n.bar ? '' : ' linethickness="0"'}>${mm(n.n)}${mm(n.d)}</mfrac>`;
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
      const sub = (n as unknown as { sub?: MNode }).sub;
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

const mr = (text: string, plain = false): string => `<m:r>${plain ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : ''}<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t xml:space="preserve">${esc(text)}</m:t></m:r>`;
const me = (n: MNode): string => `<m:e>${om(n)}</m:e>`;

/** OMML for an equation (the children of `m:oMath`). Needs the `w` and `m` namespaces around it. */
export function toOMML(n: MNode): string {
  return om(n);
}

function om(n: MNode): string {
  switch (n.t) {
    case 'row': return n.c.map(om).join('');
    case 'num': return mr(n.v);
    case 'id': return mr(n.v);
    case 'op': return mr(n.v);
    case 'text': return mr(n.v, true);
    case 'space': return mr(n.v >= 18 ? '  ' : ' ');
    case 'frac': return `<m:f>${n.bar ? '' : '<m:fPr><m:type m:val="noBar"/></m:fPr>'}<m:num>${om(n.n)}</m:num><m:den>${om(n.d)}</m:den></m:f>`;
    case 'sup': return `<m:sSup><m:e>${om(n.b)}</m:e><m:sup>${om(n.s)}</m:sup></m:sSup>`;
    case 'sub': return `<m:sSub><m:e>${om(n.b)}</m:e><m:sub>${om(n.s)}</m:sub></m:sSub>`;
    case 'subsup': return `<m:sSubSup><m:e>${om(n.b)}</m:e><m:sub>${om(n.sub)}</m:sub><m:sup>${om(n.sup)}</m:sup></m:sSubSup>`;
    case 'sqrt': return `<m:rad><m:radPr>${n.deg ? '' : '<m:degHide m:val="1"/>'}</m:radPr><m:deg>${n.deg ? om(n.deg) : ''}</m:deg>${me(n.c)}</m:rad>`;
    case 'nary': return `<m:nary><m:naryPr><m:chr m:val="${esc(n.op)}"/><m:limLoc m:val="${n.limits ? 'undOvr' : 'subSup'}"/>${n.sub ? '' : '<m:subHide m:val="1"/>'}${n.sup ? '' : '<m:supHide m:val="1"/>'}</m:naryPr><m:sub>${n.sub ? om(n.sub) : ''}</m:sub><m:sup>${n.sup ? om(n.sup) : ''}</m:sup>${me(n.c)}</m:nary>`;
    case 'fenced': return `<m:d><m:dPr><m:begChr m:val="${esc(n.open === '.' ? '' : n.open)}"/>${n.sep ? `<m:sepChr m:val="${esc(n.sep)}"/>` : ''}<m:endChr m:val="${esc(n.close === '.' ? '' : n.close)}"/></m:dPr>${n.c.map(me).join('')}</m:d>`;
    case 'func': {
      const sub = (n as unknown as { sub?: MNode }).sub;
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
        const plain = attrOf(find(find(n, 'rPr') ?? {}, 'sty') ?? {}, 'val') === 'p';
        const parts: MNode[] = [];
        for (const ch of txt) {
          if (/[0-9.]/.test(ch)) {
            const last = parts[parts.length - 1];
            if (last && last.t === 'num') last.v += ch;
            else parts.push({ t: 'num', v: ch });
          } else if (/\p{L}/u.test(ch)) parts.push(plain ? { t: 'text', v: ch } : { t: 'id', v: ch });
          else if (/\s/.test(ch)) parts.push({ t: 'space', v: 4 });
          else parts.push({ t: 'op', v: ch });
        }
        if (plain) {
          const merged = parts.every((p) => p.t === 'text') ? [{ t: 'text', v: txt } as MNode] : parts;
          return row(merged);
        }
        return row(parts);
      }
      case 'f': {
        const noBar = attrOf(find(find(n, 'fPr') ?? {}, 'type') ?? {}, 'val') === 'noBar';
        return { t: 'frac', n: body(find(n, 'num')), d: body(find(n, 'den')), bar: !noBar };
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
        if (lim) (out as unknown as { sub: MNode }).sub = body(find(lim, 'lim'));
        return out;
      }
      case 'acc': return { t: 'acc', ch: attrOf(find(find(n, 'accPr') ?? {}, 'chr') ?? {}, 'val') ?? '̂', c: body(find(n, 'e')) };
      case 'bar': return { t: 'bar', c: body(find(n, 'e')), top: (attrOf(find(find(n, 'barPr') ?? {}, 'pos') ?? {}, 'val') ?? 'top') === 'top' };
      case 'limUpp': return { t: 'limit', b: body(find(n, 'e')), lim: body(find(n, 'lim')), top: true };
      case 'limLow': return { t: 'limit', b: body(find(n, 'e')), lim: body(find(n, 'lim')), top: false };
      case 'm': return { t: 'matrix', rows: kidsOf(n).filter((k) => tagOf(k) === 'mr').map((r) => kidsOf(r).filter((k) => tagOf(k) === 'e').map((e) => body(e))), open: '', close: '' };
      case 'groupChr': return body(find(n, 'e'));
      case 'box':
      case 'phant':
      case 'borderBox': return body(find(n, 'e'));
      case 'sPre': return { t: 'subsup', b: { t: 'row', c: [] }, sub: body(find(n, 'sub')), sup: body(find(n, 'sup')) };
      case 'eqArr': return { t: 'matrix', rows: kidsOf(n).filter((k) => tagOf(k) === 'e').map((e) => [body(e)]), open: '', close: '' };
      case 'oMath': return seq(kidsOf(n));
      default: return null;
    }
  };
  return seq(kids);
}
