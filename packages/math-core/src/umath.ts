/**
 * Formato lineal de Word («UnicodeMath»): `a/b` es una fracción, `x^2` un superíndice, `√(x)` una raíz, `∑_(i=1)^n▒i` una
 * sumatoria, `■(a&b@c&d)` una matriz, `\alpha` una letra griega. Se analiza al mismo árbol (`MNode`) que usa LaTeX y se
 * vuelve a escribir desde él.
 */
import { ACCENTS, FUNCS, GREEK, NARY, SYMBOLS } from './tables';
import { row, type MNode, type RunFmt } from './math';

// ------------------------------------------------------------------------------------------ alfanuméricos matemáticos

interface Alphabet {
  fmt: RunFmt;
  upper: number;
  lower: number;
  /** Letras que viven fuera del bloque (agujeros del bloque de alfanuméricos matemáticos). */
  holes?: Record<string, string>;
}
const ALPHABETS: Alphabet[] = [
  { fmt: { sty: 'b' }, upper: 0x1d400, lower: 0x1d41a },
  { fmt: { sty: 'i' }, upper: 0x1d434, lower: 0x1d44e, holes: { h: 'ℎ' } },
  { fmt: { sty: 'bi' }, upper: 0x1d468, lower: 0x1d482 },
  { fmt: { scr: 'script' }, upper: 0x1d49c, lower: 0x1d4b6, holes: { B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ', e: 'ℯ', g: 'ℊ', o: 'ℴ' } },
  { fmt: { scr: 'fraktur' }, upper: 0x1d504, lower: 0x1d51e, holes: { C: 'ℭ', H: 'ℌ', I: 'ℑ', R: 'ℜ', Z: 'ℨ' } },
  { fmt: { scr: 'double-struck' }, upper: 0x1d538, lower: 0x1d552, holes: { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' } },
  { fmt: { scr: 'sans-serif' }, upper: 0x1d5a0, lower: 0x1d5ba },
  { fmt: { scr: 'monospace' }, upper: 0x1d670, lower: 0x1d68a },
];
const fmtKey = (f: RunFmt) => `${f.sty ?? ''}/${f.scr ?? ''}`;
const PLAIN_OF = new Map<string, { fmt: RunFmt; ch: string }>();
const STYLED_OF = new Map<string, string>();
for (const a of ALPHABETS) {
  for (let i = 0; i < 26; i++) {
    const u = String.fromCharCode(65 + i);
    const l = String.fromCharCode(97 + i);
    const su = a.holes?.[u] ?? String.fromCodePoint(a.upper + i);
    const sl = a.holes?.[l] ?? String.fromCodePoint(a.lower + i);
    PLAIN_OF.set(su, { fmt: a.fmt, ch: u });
    PLAIN_OF.set(sl, { fmt: a.fmt, ch: l });
    STYLED_OF.set(`${fmtKey(a.fmt)}|${u}`, su);
    STYLED_OF.set(`${fmtKey(a.fmt)}|${l}`, sl);
  }
}
/** La letra con su estilo como alfanumérico matemático (𝐱, ℝ, 𝒜...). */
const styledChar = (ch: string, f: RunFmt): string => STYLED_OF.get(`${fmtKey(f)}|${ch}`) ?? ch;

// ------------------------------------------------------------------------------------------------- analizador

const OPEN = new Set(['(', '[', '{', '⟨', '⌊', '⌈', '├', '〔']);
const CLOSE = new Set([')', ']', '}', '⟩', '⌋', '⌉', '┤', '〕']);
const isLetter = (c: string) => /\p{L}/u.test(c);
const isDigit = (c: string) => /[0-9]/.test(c);
const isCombining = (c: string) => /[̀-ͯ⃐-⃿]/.test(c);
const SKEW = '⁄';
const LINEAR = '∕';
const BINOM = '¦';

/** Índice del cierre que corresponde al corchete que se abre en `i` (cualquier apertura se empareja con cualquier cierre, como `[a,b)`). */
function matching(s: string[], i: number): number {
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    if (OPEN.has(s[k]!)) depth++;
    else if (CLOSE.has(s[k]!)) {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/** Parte `chars` en los puntos donde aparece `sep` fuera de cualquier corchete. */
function splitTop(chars: string[], sep: string): string[][] {
  const out: string[][] = [[]];
  let depth = 0;
  for (const c of chars) {
    if (OPEN.has(c)) depth++;
    else if (CLOSE.has(c)) depth--;
    if (c === sep && depth === 0) out.push([]);
    else out[out.length - 1]!.push(c);
  }
  return out;
}

const strip = (n: MNode): MNode => (n.t === 'fenced' && n.open === '(' && n.close === ')' && n.c.length === 1 ? n.c[0]! : n);

class UParser {
  i = 0;
  /** `true` si el elemento no tiene espacios delante (los operandos de `/` y `^` se juntan). */
  constructor(private s: string[]) {}

  private ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++;
  }
  private peek(): string | undefined {
    return this.s[this.i];
  }

  /** Una secuencia hasta el final de la entrada. */
  seq(): MNode[] {
    const out: MNode[] = [];
    for (;;) {
      this.ws();
      if (this.i >= this.s.length) break;
      const c = this.peek()!;
      // subíndices y superíndices antes de la base
      if ((c === '^' || c === '_') && !out.length) {
        const pre = this.prescript();
        if (pre) {
          out.push(pre);
          continue;
        }
      }
      if (c === '/' || c === SKEW || c === LINEAR || c === BINOM) {
        // una fracción: el numerador es lo que precede pegado a la barra
        this.i++;
        const num = this.takeOperandBack(out);
        const den = this.operand();
        const kind = c === SKEW ? 'skw' : c === LINEAR ? 'lin' : undefined;
        out.push({ t: 'frac', n: num, d: den, bar: c !== BINOM, ...(kind ? { kind } : {}) });
        continue;
      }
      if (c === '┬' || c === '┴') {
        this.i++;
        const base = this.takeOperandBack(out);
        const lim = this.operand();
        out.push({ t: 'limit', b: base, lim, top: c === '┴' });
        continue;
      }
      const a = this.term();
      if (!a) {
        this.i++;
        continue;
      }
      out.push(a);
    }
    return out;
  }

  /** Quita del final de `out` el numerador de una fracción: un corchete o una racha de letras y cifras con sus escrituras. */
  private takeOperandBack(out: MNode[]): MNode {
    const last = out[out.length - 1];
    if (!last) return { t: 'row', c: [] };
    if (last.t === 'fenced') {
      out.pop();
      return strip(last);
    }
    const run: MNode[] = [];
    const simple = (n: MNode) => n.t === 'id' || n.t === 'num' || n.t === 'sup' || n.t === 'sub' || n.t === 'subsup';
    // la racha pegada: letras y cifras seguidas (sin operadores)
    while (out.length && simple(out[out.length - 1]!)) {
      run.unshift(out.pop()!);
      if (run[0]!.t !== 'id' && run[0]!.t !== 'num') break;
    }
    if (!run.length) return out.pop()!;
    return row(run);
  }

  /** El siguiente operando: un corchete (sin sus paréntesis), una raíz, o una racha de letras o de cifras con sus escrituras. */
  private operand(inScript = false): MNode {
    this.ws();
    const c = this.peek();
    if (c === undefined) return { t: 'row', c: [] };
    if (OPEN.has(c)) {
      const t = inScript ? this.atom() : this.term();
      return t ? strip(t) : { t: 'row', c: [] };
    }
    const sign: MNode[] = [];
    if ((c === '-' || c === '+' || c === '−') && this.s[this.i + 1] !== undefined && /[\p{L}\p{N}]/u.test(this.s[this.i + 1]!)) {
      sign.push({ t: 'op', v: c });
      this.i++;
    }
    const d = this.peek();
    if (d !== undefined && isDigit(d)) {
      let v = '';
      while (this.i < this.s.length && /[0-9.]/.test(this.s[this.i]!)) v += this.s[this.i++];
      return row([...sign, inScript ? { t: 'num', v } : this.scripts({ t: 'num', v })]);
    }
    if (d !== undefined && (isLetter(d) || PLAIN_OF.has(d))) {
      const items: MNode[] = [];
      while (this.i < this.s.length && (isLetter(this.s[this.i]!) || PLAIN_OF.has(this.s[this.i]!))) {
        const ch = this.s[this.i++]!;
        items.push(inScript ? this.letter(ch) : this.scripts(this.letter(ch)));
        if (this.peek() === '^' || this.peek() === '_') break;
      }
      return row([...sign, ...items]);
    }
    const t = inScript ? this.atom() : this.term();
    return row([...sign, ...(t ? [t] : [])]);
  }

  /** Un operando que puede ser el numerador de una fracción (`sin x/2`, `(a+b)/c`). */
  private withFractions(first: MNode): MNode {
    let n = first;
    for (;;) {
      const c = this.peek();
      if (c !== '/' && c !== SKEW && c !== LINEAR && c !== BINOM) return n;
      this.i++;
      const den = this.operand();
      const kind = c === SKEW ? 'skw' : c === LINEAR ? 'lin' : undefined;
      n = { t: 'frac', n, d: den, bar: c !== BINOM, ...(kind ? { kind } : {}) };
    }
  }

  private letter(ch: string): MNode {
    const p = PLAIN_OF.get(ch);
    return p ? { t: 'id', v: p.ch, ...p.fmt } : { t: 'id', v: ch };
  }

  /** Subíndices y superíndices que siguen a `base`. */
  private scripts(base: MNode): MNode {
    let a = base;
    for (;;) {
      const c = this.peek();
      if (c === '^') {
        this.i++;
        const sup = this.operand(true);
        a = a.t === 'sub' ? { t: 'subsup', b: a.b, sub: a.s, sup } : { t: 'sup', b: a, s: sup };
      } else if (c === '_') {
        this.i++;
        const sub = this.operand(true);
        a = a.t === 'sup' ? { t: 'subsup', b: a.b, sub, sup: a.s } : { t: 'sub', b: a, s: sub };
      } else if (c !== undefined && isCombining(c)) {
        this.i++;
        a = { t: 'acc', ch: c, c: a };
      } else break;
    }
    return a;
  }

  private prescript(): MNode | null {
    let sub: MNode = { t: 'row', c: [] };
    let sup: MNode = { t: 'row', c: [] };
    let got = false;
    for (;;) {
      const c = this.peek();
      if (c === '_') {
        this.i++;
        sub = this.operand(true);
        got = true;
      } else if (c === '^') {
        this.i++;
        sup = this.operand(true);
        got = true;
      } else break;
    }
    if (!got) return null;
    this.ws();
    const b = this.term() ?? { t: 'row', c: [] };
    return { t: 'pre', b, sub, sup };
  }

  /** Un elemento: un átomo con sus escrituras. */
  private term(): MNode | null {
    const atom = this.atom();
    return atom ? this.scripts(atom) : null;
  }

  private atom(): MNode | null {
    this.ws();
    const c = this.peek();
    if (c === undefined) return null;
    if (c === '"') {
      let t = '';
      this.i++;
      while (this.i < this.s.length && this.s[this.i] !== '"') t += this.s[this.i++];
      this.i++;
      return { t: 'text', v: t };
    }
    if (c === '〖') {
      const k = this.s.indexOf('〗', this.i);
      const end = k < 0 ? this.s.length : k;
      const inner = this.s.slice(this.i + 1, end);
      this.i = Math.min(this.s.length, end + 1);
      return row(new UParser(inner).seq());
    }
    if (OPEN.has(c)) {
      const m = matching(this.s, this.i);
      if (m < 0) {
        this.i++;
        return { t: 'op', v: c };
      }
      const inner = this.s.slice(this.i + 1, m);
      const close = this.s[m]!;
      this.i = m + 1;
      // un solo carácter que se abre y se cierra con matrices: ■(...) lo trata el operador
      const parts = splitTop(inner, '|');
      // un corchete que solo contiene una matriz es la matriz con sus delimitadores
      if (parts.length === 1) {
        const only = new UParser(inner).seq();
        if (only.length === 1 && only[0]!.t === 'matrix' && !only[0]!.open && !only[0]!.close) return { ...only[0]!, open: c === '├' ? '' : c, close: close === '┤' ? '' : close };
      }
      return { t: 'fenced', open: c === '├' ? '' : c, close: close === '┤' ? '' : close, sep: parts.length > 1 ? '|' : '', c: parts.map((p) => row(new UParser(p).seq())) };
    }
    if (CLOSE.has(c)) {
      this.i++;
      return { t: 'op', v: c };
    }
    if (c === '√' || c === '∛' || c === '∜') {
      this.i++;
      const deg: MNode | null = c === '∛' ? { t: 'num', v: '3' } : c === '∜' ? { t: 'num', v: '4' } : null;
      this.ws();
      if (this.peek() === '(') {
        const m = matching(this.s, this.i);
        if (m > 0) {
          const inner = this.s.slice(this.i + 1, m);
          this.i = m + 1;
          const parts = splitTop(inner, '&');
          if (parts.length > 1 && !deg) return { t: 'sqrt', deg: row(new UParser(parts[0]!).seq()), c: row(new UParser(parts.slice(1).flat()).seq()) };
          return { t: 'sqrt', deg, c: row(new UParser(inner).seq()) };
        }
      }
      return { t: 'sqrt', deg, c: this.operand() };
    }
    if (c === '■' || c === '█') {
      this.i++;
      this.ws();
      if (this.peek() && OPEN.has(this.peek()!)) {
        const m = matching(this.s, this.i);
        if (m > 0) {
          const inner = this.s.slice(this.i + 1, m);
          this.i = m + 1;
          const rows = splitTop(inner, '@');
          if (c === '■') return { t: 'matrix', rows: rows.map((r) => splitTop(r, '&').map((cell) => row(new UParser(cell).seq()))), open: '', close: '' };
          return { t: 'eqarr', rows: rows.map((r) => row(new UParser(r).seq())) };
        }
      }
      return { t: 'op', v: c };
    }
    if (c === '¯' || c === '▁') {
      this.i++;
      return { t: 'bar', c: this.operand(), top: c === '¯' };
    }
    if (c === '▭' || c === '□') {
      this.i++;
      return { t: 'box', c: this.operand(), border: c === '▭' };
    }
    if (NARY_CHARS.has(c)) return this.nary();
    if (c === '\\') return this.escape();
    if (isDigit(c)) {
      let v = '';
      while (this.i < this.s.length && /[0-9.]/.test(this.s[this.i]!)) v += this.s[this.i++];
      return { t: 'num', v };
    }
    if (isLetter(c) || PLAIN_OF.has(c)) {
      // ¿un nombre de función?
      let w = '';
      let k = this.i;
      while (k < this.s.length && /[A-Za-z]/.test(this.s[k]!)) w += this.s[k++];
      if (w && FUNCS.has(w) && !(this.s[k] !== undefined && isLetter(this.s[k]!))) {
        this.i = k;
        let sub: MNode | undefined;
        if (this.peek() === '_') {
          this.i++;
          sub = this.operand(true);
        }
        this.ws();
        const at = this.peek();
        const stop = at === undefined || CLOSE.has(at) || at === '/';
        const arg = stop ? ({ t: 'row', c: [] } as MNode) : this.withFractions(this.operand());
        return { t: 'func', name: w, c: arg, ...(sub ? { sub } : {}) };
      }
      this.i++;
      return this.letter(c);
    }
    this.i++;
    return { t: 'op', v: c };
  }

  private nary(): MNode {
    const op = this.s[this.i++]!;
    let sub: MNode | null = null;
    let sup: MNode | null = null;
    for (;;) {
      const c = this.peek();
      if (c === '_') {
        this.i++;
        sub = this.operand(true);
      } else if (c === '^') {
        this.i++;
        sup = this.operand(true);
      } else break;
    }
    this.ws();
    if (this.peek() === '▒') this.i++;
    this.ws();
    // el operando: lo que sigue hasta el final (o un corchete que cierra)
    const m = this.peek() !== undefined && OPEN.has(this.peek()!) ? matching(this.s, this.i) : -1;
    const c: MNode = m >= 0 && m === this.s.length - 1 ? strip(this.atom()!) : row(this.seq());
    const limits = !'∫∬∭∮∯∰'.includes(op);
    return { t: 'nary', op, sub, sup, c, limits };
  }

  private escape(): MNode | null {
    this.i++;
    let name = '';
    while (this.i < this.s.length && /[A-Za-z]/.test(this.s[this.i]!)) name += this.s[this.i++];
    if (!name) {
      const c = this.s[this.i++];
      return c === undefined ? null : { t: 'op', v: c };
    }
    // un espacio detrás del nombre cierra la escritura
    if (this.s[this.i] === ' ') this.i++;
    if (GREEK[name]) return { t: 'id', v: GREEK[name]! };
    if (SYMBOLS[name]) return { t: 'op', v: SYMBOLS[name]! };
    if (NARY[name]) return this.naryFrom(NARY[name]!);
    if (name === 'sqrt') {
      this.i--;
      this.s[this.i] = '√';
      return this.atom();
    }
    if (ACCENTS[name]) return { t: 'acc', ch: ACCENTS[name]!, c: this.operand() };
    if (name === 'matrix') return { t: 'op', v: '■' };
    if (name === 'eqarray') return { t: 'op', v: '█' };
    return { t: 'text', v: `\\${name}` };
  }

  private naryFrom(op: string): MNode {
    this.i--;
    this.s[this.i] = op;
    return this.nary();
  }
}

const NARY_CHARS = new Set(Object.values(NARY));

/** Analiza una ecuación en el formato lineal de Word. Lo que no entiende se conserva como carácter. */
export function parseUnicodeMath(src: string): MNode {
  return row(new UParser([...src]).seq());
}

// ------------------------------------------------------------------------------------------------- escritor

const isSimpleRun = (n: MNode): boolean => {
  if (n.t === 'id' || n.t === 'num') return true;
  if (n.t === 'row') return n.c.length > 0 && (n.c.every((x) => x.t === 'id') || n.c.every((x) => x.t === 'num'));
  return false;
};
/** Un operando de `^`, `_` o `/`: sin paréntesis si es una racha simple. */
const operand = (n: MNode): string => (isSimpleRun(n) && !(n.t === 'row' && n.c.length > 1 && n.c.some((x) => x.t === 'id' && 'sty' in x)) ? um(n) : `(${um(n)})`);
const base = (n: MNode): string => (n.t === 'id' || n.t === 'num' || n.t === 'fenced' || n.t === 'func' ? um(n) : n.t === 'row' && n.c.length === 1 ? base(n.c[0]!) : `〖${um(n)}〗`);

function join(parts: string[]): string {
  let out = '';
  for (const p of parts) {
    if (!p) continue;
    const a = out[out.length - 1];
    const b = p[0]!;
    // dos números seguidos o un nombre de función seguido de una letra se confundirían al leerlos
    const needSpace = a !== undefined && ((isDigit(a) && isDigit(b)) || (/[A-Za-z]/.test(a) && /[A-Za-z]/.test(b) && FUNCS.has(tailWord(out + p))));
    out += (needSpace ? ' ' : '') + p;
  }
  return out;
}
const tailWord = (s: string): string => /([A-Za-z]+)$/.exec(s)?.[1] ?? '';

function um(n: MNode): string {
  switch (n.t) {
    case 'row': return join(n.c.map(um));
    case 'num': return n.v;
    case 'id': return n.sty || n.scr ? styledChar(n.v, n) : n.v;
    case 'op': return n.sty || n.scr ? styledChar(n.v, n) : n.v;
    case 'text': return `"${n.v}"`;
    case 'space': return n.v >= 18 ? '  ' : ' ';
    case 'frac': {
      const sep = n.kind === 'skw' ? SKEW : n.kind === 'lin' ? LINEAR : n.bar ? '/' : BINOM;
      return `${operand(n.n)}${sep}${operand(n.d)}`;
    }
    case 'sup': return `${base(n.b)}^${operand(n.s)}`;
    case 'sub': return `${base(n.b)}_${operand(n.s)}`;
    case 'subsup': return `${base(n.b)}_${operand(n.sub)}^${operand(n.sup)}`;
    case 'pre': return `_${operand(n.sub)}^${operand(n.sup)} ${base(n.b)}`;
    case 'sqrt': {
      if (!n.deg) return `√(${um(n.c)})`;
      if (n.deg.t === 'num' && n.deg.v === '3') return `∛(${um(n.c)})`;
      if (n.deg.t === 'num' && n.deg.v === '4') return `∜(${um(n.c)})`;
      return `√(${um(n.deg)}&${um(n.c)})`;
    }
    case 'nary': return `${n.op}${n.sub ? `_${operand(n.sub)}` : ''}${n.sup ? `^${operand(n.sup)}` : ''}▒${isSimpleRun(n.c) || n.c.t === 'fenced' ? um(n.c) : `(${um(n.c)})`}`;
    case 'fenced': return `${n.open || '├'}${n.c.map(um).join(n.c.length > 1 ? n.sep || '|' : '')}${n.close || '┤'}`;
    case 'func': return join([n.name + (n.sub ? `_${operand(n.sub)}` : ''), ' ', um(n.c)]);
    case 'acc': return `${base(n.c)}${n.ch}`;
    case 'bar': return `${n.top ? '¯' : '▁'}(${um(n.c)})`;
    case 'limit': return `${base(n.b)}${n.top ? '┴' : '┬'}${operand(n.lim)}`;
    case 'matrix': {
      const body = `■(${n.rows.map((r) => r.map(um).join('&')).join('@')})`;
      return n.open || n.close ? `${n.open || '├'}${body}${n.close || '┤'}` : body;
    }
    case 'eqarr': return `█(${n.rows.map(um).join('@')})`;
    case 'box': return `${n.border ? '▭' : '□'}(${um(n.c)})`;
  }
}

/** La forma lineal de Word de una ecuación. */
export function toUnicodeMath(n: MNode): string {
  return um(n).trim();
}
