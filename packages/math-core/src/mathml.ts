/** MathML (presentación) → árbol de la ecuación: para `.odt`/`.odp` de otros programas y para pegar MathML. */
import { parseMath, row, type MNode, type RunFmt } from './math';
import { FUNCS, NARY } from './tables';
import { attrOf, kidsOf, parseXml, rootOf, tagOf, textOfNode, type XNode } from './xml';

/** El texto de un nodo, con las referencias numéricas (`&#x2061;`) ya resueltas. */
const textOf = (n: XNode): string =>
  textOfNode(n)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d: string) => String.fromCodePoint(+d));

const NARY_CHARS = new Set(Object.values(NARY));
const OPEN = new Set(['(', '[', '{', '⟨', '⌊', '⌈']);
const CLOSE = new Set([')', ']', '}', '⟩', '⌋', '⌉']);
const ACCENT_CHARS = new Set(['̂', '̃', '̇', '̈', '́', '̀', '̆', '̌', '⃗', '^', '~', '˙', '¨', '´', '`', '˘', 'ˇ', '→', '¯', '̅']);
const ACCENT_MAP: Record<string, string> = { '^': '̂', '~': '̃', '˙': '̇', '¨': '̈', '´': '́', '`': '̀', '˘': '̆', 'ˇ': '̌', '→': '⃗', '¯': '̅' };

const trim = (s: string) => s.replace(/\s+/g, ' ').trim();

function runFmt(n: XNode): RunFmt {
  switch (attrOf(n, 'mathvariant')) {
    case 'bold': return { sty: 'b' };
    case 'bold-italic': return { sty: 'bi' };
    case 'normal': return { sty: 'p' };
    case 'italic': return { sty: 'i' };
    case 'script':
    case 'fraktur':
    case 'double-struck':
    case 'sans-serif':
    case 'monospace': return { scr: attrOf(n, 'mathvariant') as RunFmt['scr'] };
    default: return {};
  }
}

const isNaryOp = (n: XNode | undefined): string | null => {
  if (!n || tagOf(n) !== 'mo') return null;
  const t = trim(textOf(n));
  return NARY_CHARS.has(t) ? t : null;
};

function conv(n: XNode): MNode {
  const kids = kidsOf(n).filter((k) => tagOf(k) !== '#text' || trim(textOf(k)));
  const c = (i: number): MNode => (kids[i] ? conv(kids[i]!) : { t: 'row', c: [] });
  const seq = (list: XNode[]): MNode => row(list.map(conv));
  switch (tagOf(n)) {
    case 'math':
    case 'mrow':
    case 'mstyle':
    case 'mpadded':
    case 'mphantom': {
      // un grupo con corchetes a los lados es una ecuación con delimitadores
      const first = kids[0] && tagOf(kids[0]) === 'mo' ? trim(textOf(kids[0])) : '';
      const lastK = kids[kids.length - 1];
      const last = lastK && tagOf(lastK) === 'mo' ? trim(textOf(lastK)) : '';
      if (kids.length >= 2 && tagOf(n) === 'mrow' && (OPEN.has(first) || CLOSE.has(last))) {
        const inner = kids.slice(OPEN.has(first) ? 1 : 0, CLOSE.has(last) ? -1 : undefined);
        if (inner.length === 1 && tagOf(inner[0]!) === 'mtable') {
          const m = conv(inner[0]!);
          if (m.t === 'matrix') return { ...m, open: OPEN.has(first) ? first : '', close: CLOSE.has(last) ? last : '' };
        }
        return { t: 'fenced', open: OPEN.has(first) ? first : '', close: CLOSE.has(last) ? last : '', sep: '', c: [seq(inner)] };
      }
      // un operador grande seguido de su operando
      const items: MNode[] = [];
      const invisible = (k: XNode | undefined) => !!k && tagOf(k) === 'mo' && /^[\u2061-\u2064]$/.test(textOf(k).trim());
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i]!;
        if (invisible(k)) continue;
        const head = conv(k);
        // una función con su argumento detrás (con el «aplicar función» invisible entre los dos)
        if (head.t === 'func' && head.c.t === 'row' && !head.c.c.length) {
          let j = i + 1;
          if (invisible(kids[j])) j++;
          if (kids[j]) {
            items.push({ ...head, c: conv(kids[j]!) });
            i = j;
            continue;
          }
        }
        if (head.t === 'nary' && head.c.t === 'row' && !head.c.c.length && i < kids.length - 1) {
          items.push({ ...head, c: seq(kids.slice(i + 1)) });
          break;
        }
        items.push(head);
      }
      return row(items);
    }
    case 'semantics': return kids[0] ? conv(kids[0]) : { t: 'row', c: [] };
    case 'annotation':
    case 'annotation-xml': return { t: 'row', c: [] };
    case 'mn': return { t: 'num', v: trim(textOf(n)), ...runFmt(n) };
    case 'mi': {
      const v = trim(textOf(n));
      if (v.length > 1 && FUNCS.has(v)) return { t: 'func', name: v, c: { t: 'row', c: [] } };
      if (v.length > 1) return row([...v].map((ch) => ({ t: 'id', v: ch, ...runFmt(n) }) as MNode));
      return { t: 'id', v, ...runFmt(n) };
    }
    case 'mo': {
      const v = trim(textOf(n));
      if (NARY_CHARS.has(v)) return { t: 'nary', op: v, sub: null, sup: null, c: { t: 'row', c: [] }, limits: !'∫∬∭∮'.includes(v) };
      return { t: 'op', v, ...runFmt(n) };
    }
    case 'mtext': return { t: 'text', v: textOf(n), ...runFmt(n) };
    case 'mspace': return { t: 'space', v: Math.round((parseFloat(attrOf(n, 'width') ?? '0.2') || 0.2) * 18) };
    case 'mfrac': return { t: 'frac', n: c(0), d: c(1), bar: attrOf(n, 'linethickness') !== '0' };
    case 'msqrt': return { t: 'sqrt', c: seq(kids), deg: null };
    case 'mroot': return { t: 'sqrt', c: c(0), deg: c(1) };
    case 'msup':
    case 'msub':
    case 'msubsup': {
      const op = isNaryOp(kids[0]);
      const sub = tagOf(n) === 'msup' ? null : c(1);
      const sup = tagOf(n) === 'msub' ? null : c(tagOf(n) === 'msup' ? 1 : 2);
      if (op) return { t: 'nary', op, sub, sup, c: { t: 'row', c: [] }, limits: false };
      const b = c(0);
      if (tagOf(n) === 'msup') return { t: 'sup', b, s: sup! };
      if (tagOf(n) === 'msub') return { t: 'sub', b, s: sub! };
      return { t: 'subsup', b, sub: sub!, sup: sup! };
    }
    case 'mmultiscripts': {
      const at = kids.findIndex((k) => tagOf(k) === 'mprescripts');
      if (at >= 0) return { t: 'pre', b: c(0), sub: kids[at + 1] ? conv(kids[at + 1]!) : { t: 'row', c: [] }, sup: kids[at + 2] ? conv(kids[at + 2]!) : { t: 'row', c: [] } };
      return { t: 'subsup', b: c(0), sub: c(1), sup: c(2) };
    }
    case 'munder':
    case 'mover':
    case 'munderover': {
      const op = isNaryOp(kids[0]);
      const tag = tagOf(n);
      if (op) return { t: 'nary', op, sub: tag === 'mover' ? null : c(1), sup: tag === 'munder' ? null : c(tag === 'mover' ? 1 : 2), c: { t: 'row', c: [] }, limits: true };
      if (tag === 'munder' && kids[0] && tagOf(kids[0]) === 'mi' && FUNCS.has(trim(textOf(kids[0])))) return { t: 'func', name: trim(textOf(kids[0])), c: { t: 'row', c: [] }, sub: c(1) };
      if (tag === 'mover' && kids[1] && tagOf(kids[1]) === 'mo') {
        const ch = trim(textOf(kids[1]));
        if (ch === '‾' || ch === '―') return { t: 'bar', c: c(0), top: true };
        if (ACCENT_CHARS.has(ch) && (attrOf(n, 'accent') === 'true' || ch !== '→')) return { t: 'acc', ch: ACCENT_MAP[ch] ?? ch, c: c(0) };
      }
      if (tag === 'munder' && kids[1] && tagOf(kids[1]) === 'mo' && trim(textOf(kids[1])) === '_') return { t: 'bar', c: c(0), top: false };
      if (tag === 'munderover') return { t: 'limit', b: { t: 'limit', b: c(0), lim: c(1), top: false }, lim: c(2), top: true };
      return { t: 'limit', b: c(0), lim: c(1), top: tag === 'mover' };
    }
    case 'mtable': {
      const rows = kids.filter((k) => tagOf(k) === 'mtr' || tagOf(k) === 'mlabeledtr').map((r) => kidsOf(r).filter((k) => tagOf(k) === 'mtd').map((d) => seq(kidsOf(d))));
      return { t: 'matrix', rows, open: '', close: '' };
    }
    case 'mfenced': {
      const open = attrOf(n, 'open') ?? '(';
      const close = attrOf(n, 'close') ?? ')';
      return { t: 'fenced', open, close, sep: '', c: kids.map(conv) };
    }
    case 'menclose': return { t: 'box', c: seq(kids), border: true };
    default: return kids.length ? seq(kids) : { t: 'row', c: [] };
  }
}

/** El código TeX que acompaña a una ecuación (`<annotation encoding="application/x-tex">`), si lo hay. */
export function texOfMathML(xml: string): string | null {
  const m = /<annotation[^>]*encoding="(?:application\/x-tex|TeX|LaTeX)"[^>]*>([\s\S]*?)<\/annotation>/i.exec(xml);
  return m ? m[1]!.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim() : null;
}

/** Lee un `<math>`; si lleva el código TeX original se usa ese (es más fiel). */
export function fromMathML(xml: string): MNode | null {
  const tex = texOfMathML(xml);
  if (tex) return parseMath(tex);
  const doc = parseXml(xml);
  const root = rootOf(doc, 'math');
  if (!root) return null;
  return conv(root);
}
