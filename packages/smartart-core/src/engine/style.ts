import type { ColorList, ColorsDef, StyleDef } from '../styles';
import { colorLabel, styleLabel } from '../styles';
import { el, kid, local, type El } from '../xml';
import type { PNode } from './present';

/*
 * Estilos y colores (fase 3). Cada forma de un diseño tiene una «etiqueta de estilo» (`node1`, `sibTrans2D1`, `parChTrans1D2`…):
 * el estilo rápido (`styleDef`) dice qué referencias al tema usa (línea, relleno, efecto, fuente) y los colores (`colorsDef`) dicen
 * qué color le toca según su posición entre las formas de la misma etiqueta. Aquí se resuelve a lo que escribe Office en
 * `dsp:spPr` y `dsp:style` del dibujo en caché.
 */

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

/** La profundidad (1 = primer nivel) del nodo de datos al que pertenece un punto, trasladando las transiciones a su dueño. */
function depthOf(p: PNode): number {
  const d = p.ctx;
  const n = d.kind === 'parTrans' || d.kind === 'sibTrans' ? d.owner! : d;
  return clamp(n.depth || 1, 1, 4);
}

/**
 * La etiqueta de estilo de un nodo de presentación: la que declara el diseño o, si no, la que Office asigna: `node` + nivel para las
 * formas, `parChTrans`/`sibTrans` + `1D` (línea) o `2D` (flecha) + nivel para los conectores. Sin forma, sin etiqueta.
 */
export function styleLabelOf(p: PNode): string | undefined {
  if (p.styleLbl) return p.styleLbl;
  if (!p.shape?.type) return undefined;
  const lvl = depthOf(p);
  if (p.shape.type === 'conn') {
    const oneD = p.alg?.params.find((x) => x.type === 'dim')?.val === '1D';
    const kind = p.ctx.kind === 'parTrans' ? 'parChTrans' : 'sibTrans';
    return `${kind}${oneD ? '1D' : '2D'}${lvl}`;
  }
  return `node${lvl}`;
}

/** Clave del dato que presenta un nodo: los nodos que presentan lo mismo (una forma y su texto) cuentan como uno al numerar. */
const dataKey = (p: PNode): string => (p.present.length ? p.present.map((d) => d.id).join('+') : p.ctx.id);

export interface StyleIndex {
  label: string;
  /** Posición entre las formas de esta etiqueta (`presStyleIdx`) y cuántas hay (`presStyleCnt`). */
  idx: number;
  cnt: number;
}

/** La etiqueta y la posición de cada nodo con forma, en orden de recorrido (como `presStyleIdx` y `presStyleCnt` de Office). */
export function indexStyles(nodes: PNode[]): Map<PNode, StyleIndex> {
  const keys = new Map<string, string[]>();
  const labelOf = new Map<PNode, string>();
  for (const p of nodes) {
    const l = styleLabelOf(p);
    if (!l) continue;
    labelOf.set(p, l);
    const list = keys.get(l) ?? [];
    const k = dataKey(p);
    if (!list.includes(k)) list.push(k);
    keys.set(l, list);
  }
  const out = new Map<PNode, StyleIndex>();
  for (const [p, label] of labelOf) {
    const list = keys.get(label)!;
    out.set(p, { label, idx: list.indexOf(dataKey(p)), cnt: list.length });
  }
  return out;
}

/** Un color de la lista para la posición `idx` de `cnt` (`repeat` y `cycle` recorren la lista; `span` reparte la lista a lo largo de las formas). */
function pickColor(list: ColorList, idx: number, cnt: number): El | undefined {
  const n = list.colors.length;
  if (!n) return undefined;
  if (list.meth === 'span' && n > 1) return list.colors[Math.round((idx * (n - 1)) / Math.max(1, cnt - 1))];
  return list.colors[idx % n];
}

/** El color con los desplazamientos a cero que escribe Office al final (`hueOff`, `satOff`, `lumOff`, `alphaOff`). */
function withOffsets(c: El): El {
  const have = new Set(c.kids.map((k) => local(k.name)));
  const extra = ['hueOff', 'satOff', 'lumOff', 'alphaOff'].filter((n) => !have.has(n)).map((n) => el(`a:${n}`, { val: '0' }));
  return { ...c, attrs: { ...c.attrs }, kids: [...c.kids, ...extra] };
}

// anchos de línea de las referencias del estilo (`a:lnRef idx`) del tema de Office
const LINE_W = [0, 12700, 12700, 19050];

export interface Styled {
  /** `dsp:spPr` sin geometría: relleno, línea y efectos, tal como los escribe Office. */
  spPr: El[];
  /** `dsp:style` del estilo rápido. */
  style?: El;
}

/** Resuelve el aspecto de una forma con su etiqueta de estilo y su posición. Sin etiqueta en los estilos, no hay aspecto. */
export function styleShape(st: StyleDef, cs: ColorsDef, s: StyleIndex): Styled | undefined {
  const sl = styleLabel(st, s.label);
  const cl = colorLabel(cs, s.label);
  if (!sl || !cl) return undefined;
  const ref = (name: string): number => Number(kid(sl.style, name)?.attrs.idx ?? 0);
  const fillIdx = ref('fillRef');
  const lineIdx = ref('lnRef');
  const spPr: El[] = [];
  const fc = pickColor(cl.fill, s.idx, s.cnt);
  spPr.push(fillIdx === 0 || !fc ? el('a:noFill') : el('a:solidFill', {}, [withOffsets(fc)]));
  const lc = pickColor(cl.lin, s.idx, s.cnt);
  if (lineIdx === 0 || !lc) spPr.push(el('a:ln', {}, [el('a:noFill')]));
  else spPr.push(el('a:ln', { w: String(LINE_W[clamp(lineIdx, 0, 3)]), cap: 'flat', cmpd: 'sng', algn: 'ctr' }, [el('a:solidFill', {}, [withOffsets(lc)]), el('a:prstDash', { val: 'solid' }), el('a:miter', { lim: '800000' })]));
  spPr.push(el('a:effectLst'));
  const style = sl.style ? { ...sl.style, name: 'dsp:style' } : undefined;
  return { spPr, ...(style ? { style } : {}) };
}
