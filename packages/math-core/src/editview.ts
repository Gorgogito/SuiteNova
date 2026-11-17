/**
 * El dibujo de una ecuación que se está editando: MathML (lo dibuja el navegador) con el cursor, la selección, los huecos
 * de las casillas vacías y, en cada nodo, `data-r` (la ruta de su fila) y `data-i` (su lugar en ella) para saber dónde se hace clic.
 */
import { asList, getSlot, type EditState, type Step } from './edit';
import { variant, type MNode } from './math';

export const pathKey = (path: Step[]): string => path.map((s) => `${s.i}.${s.k}`).join('/');
export function parsePathKey(key: string): Step[] {
  if (!key) return [];
  return key.split('/').map((p) => {
    const d = p.indexOf('.');
    return { i: +p.slice(0, d), k: p.slice(d + 1) };
  });
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const same = (a: Step[], b: Step[]) => a.length === b.length && a.every((s, i) => s.i === b[i]!.i && s.k === b[i]!.k);

class View {
  constructor(private st: EditState, private readonly caret: boolean) {}

  row(list: MNode[], path: Step[]): string {
    const here = this.caret && same(path, this.st.path);
    const [sa, sb] = this.st.anchor !== undefined && here ? [Math.min(this.st.anchor, this.st.at), Math.max(this.st.anchor, this.st.at)] : [0, 0];
    const key = esc(pathKey(path));
    let out = '';
    const caret = () => `<mspace class="nm-caret" width="0" height="1em" depth="0.3em"></mspace>${this.st.esc !== undefined ? `<mtext class="nm-esc">\\${esc(this.st.esc)}</mtext>` : ''}`;
    for (let i = 0; i <= list.length; i++) {
      if (here && sa === sb && i === this.st.at) out += caret();
      if (i === list.length) break;
      const open = sa !== sb && i === sa;
      const close = sa !== sb && i === sb - 1;
      out += `${open ? '<mrow class="nm-sel">' : ''}${this.node(list[i]!, path, i)}${close ? '</mrow>' : ''}`;
    }
    if (!list.length && path.length) out += `<mi class="nm-ph" data-r="${key}" data-i="0">&#x25A1;</mi>`;
    return `<mrow data-row="${key}">${out}</mrow>`;
  }

  private slot(n: MNode, path: Step[], idx: number, k: string): string {
    return this.row(asList(getSlot(n, k)), [...path, { i: idx, k }]);
  }

  node(n: MNode, path: Step[], idx: number): string {
    const a = ` data-r="${esc(pathKey(path))}" data-i="${idx}"`;
    const s = (k: string) => this.slot(n, path, idx, k);
    switch (n.t) {
      case 'num': return `<mn${a}${variant(n)}>${esc(n.v)}</mn>`;
      case 'id': return `<mi${a}${variant(n)}>${esc(n.v)}</mi>`;
      case 'op': return `<mo${a}${variant(n)}>${esc(n.v)}</mo>`;
      case 'text': return `<mtext${a}${variant(n)}>${esc(n.v)}</mtext>`;
      case 'space': return `<mspace${a} width="${(n.v / 18).toFixed(3)}em"></mspace>`;
      case 'row': return `<mrow${a}>${n.c.map((c, i) => this.node(c, path, i)).join('')}</mrow>`;
      case 'frac':
        if (n.kind === 'lin' || n.kind === 'skw') return `<mrow${a}>${s('n')}<mo>${n.kind === 'skw' ? '⁄' : '/'}</mo>${s('d')}</mrow>`;
        return `<mfrac${a}${n.bar ? '' : ' linethickness="0"'}>${s('n')}${s('d')}</mfrac>`;
      case 'sup': return `<msup${a}>${s('b')}${s('s')}</msup>`;
      case 'sub': return `<msub${a}>${s('b')}${s('s')}</msub>`;
      case 'subsup': return `<msubsup${a}>${s('b')}${s('sub')}${s('sup')}</msubsup>`;
      case 'pre': return `<mmultiscripts${a}>${s('b')}<mprescripts></mprescripts>${s('sub')}${s('sup')}</mmultiscripts>`;
      case 'sqrt': return n.deg ? `<mroot${a}>${s('c')}${s('deg')}</mroot>` : `<msqrt${a}>${s('c')}</msqrt>`;
      case 'nary': {
        const op = `<mo largeop="true" stretchy="false" movablelimits="false">${esc(n.op)}</mo>`;
        const sub = n.sub ? s('sub') : '';
        const sup = n.sup ? s('sup') : '';
        let head = op;
        if (n.sub && n.sup) head = n.limits ? `<munderover>${op}${sub}${sup}</munderover>` : `<msubsup>${op}${sub}${sup}</msubsup>`;
        else if (n.sub) head = n.limits ? `<munder>${op}${sub}</munder>` : `<msub>${op}${sub}</msub>`;
        else if (n.sup) head = n.limits ? `<mover>${op}${sup}</mover>` : `<msup>${op}${sup}</msup>`;
        return `<mrow${a}>${head}${s('c')}</mrow>`;
      }
      case 'fenced': {
        const parts = n.c.map((_, i) => s(`c${i}`));
        const sep = n.sep ? `<mo>${esc(n.sep)}</mo>` : '';
        return `<mrow${a}>${n.open ? `<mo stretchy="true">${esc(n.open)}</mo>` : ''}${parts.join(sep)}${n.close ? `<mo stretchy="true">${esc(n.close)}</mo>` : ''}</mrow>`;
      }
      case 'func': {
        const name = `<mi mathvariant="normal">${esc(n.name)}</mi>`;
        return `<mrow${a}>${n.sub ? `<munder>${name}${s('sub')}</munder>` : name}<mo>&#x2061;</mo>${s('c')}</mrow>`;
      }
      case 'acc': return `<mover${a} accent="true">${s('c')}<mo>${esc(n.ch)}</mo></mover>`;
      case 'bar': return n.top ? `<mover${a}>${s('c')}<mo>‾</mo></mover>` : `<munder${a}>${s('c')}<mo>_</mo></munder>`;
      case 'limit': return n.top ? `<mover${a}>${s('b')}${s('lim')}</mover>` : `<munder${a}>${s('b')}${s('lim')}</munder>`;
      case 'matrix': {
        const rows = n.rows.map((r, ri) => `<mtr>${r.map((_, ci) => `<mtd>${s(`${ri}:${ci}`)}</mtd>`).join('')}</mtr>`).join('');
        return `<mrow${a}>${n.open ? `<mo stretchy="true">${esc(n.open)}</mo>` : ''}<mtable>${rows}</mtable>${n.close ? `<mo stretchy="true">${esc(n.close)}</mo>` : ''}</mrow>`;
      }
      case 'eqarr': return `<mtable${a} columnalign="left">${n.rows.map((_, i) => `<mtr><mtd>${s(`r${i}`)}</mtd></mtr>`).join('')}</mtable>`;
      case 'box': return `<mrow${a}${n.border ? ' class="nm-box"' : ''}>${s('c')}</mrow>`;
    }
  }
}

/** El MathML editable de la ecuación (con cursor si `caret`). */
export function renderEdit(st: EditState, caret = true): string {
  const v = new View(st, caret);
  const body = v.row(asList(st.root), []);
  return `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="nm-root">${body}</math>`;
}
