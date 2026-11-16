import { framesFromGroup, framesToGroup, type Frame } from '@suitenova/shapes-core';
import { nodeTypes } from '@suitenova/writer-core';
import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { selectedShapePositions, shapeSelKey } from './shape-selection';

/** El elemento respecto del que se colocan las formas flotantes de un párrafo: el primer antecesor con posición. */
function containingBlock(el: HTMLElement): HTMLElement {
  let e: HTMLElement | null = el;
  while (e && e !== document.body) {
    if (getComputedStyle(e).position !== 'static') return e;
    e = e.parentElement;
  }
  return document.body;
}

interface Origin {
  left: number;
  top: number;
  scale: number;
}

/** Origen (esquina del relleno del bloque contenedor) y zoom con que se miden las formas del párrafo de `pos`. */
export function originOf(view: EditorView, pos: number): Origin {
  const $p = view.state.doc.resolve(pos);
  const para = view.nodeDOM($p.before($p.depth)) as HTMLElement | null;
  const cb = containingBlock(para ?? (view.dom as HTMLElement));
  const r = cb.getBoundingClientRect();
  return { left: r.left + cb.clientLeft, top: r.top + cb.clientTop, scale: cb.offsetWidth ? r.width / cb.offsetWidth : 1 };
}

/** Marco de una forma o grupo en las coordenadas del origen: sin girar, que es como se guarda (el giro va aparte). */
export function measure(view: EditorView, pos: number, node: PMNode, o: Origin): Frame {
  const el = view.nodeDOM(pos) as HTMLElement | null;
  // una imagen en línea puede no tener tamaño guardado: entonces vale el que tiene en pantalla
  const w = (node.attrs.width as number | null) ?? Math.round((el?.offsetWidth ?? 0) || 1);
  const h = (node.attrs.height as number | null) ?? Math.round((el?.offsetHeight ?? 0) || 1);
  // las imágenes guardan el giro en `rotate` y las formas en `rotation`
  const rotation = node.attrs.rotation || node.attrs.rotate || 0;
  if (!el) return { id: String(pos), x: node.attrs.x ?? 0, y: node.attrs.y ?? 0, width: w, height: h, rotation };
  const r = el.getBoundingClientRect();
  const cx = (r.left + r.width / 2 - o.left) / o.scale;
  const cy = (r.top + r.height / 2 - o.top) / o.scale;
  return { id: String(pos), x: cx - w / 2, y: cy - h / 2, width: w, height: h, rotation };
}

/**
 * Agrupa las formas seleccionadas (dos o más, del mismo documento): el grupo se crea en el párrafo de la primera, flotando delante del
 * texto, con las hijas en coordenadas del grupo. Todo en una transacción (un paso de deshacer). Devuelve si agrupó.
 */
export function groupSelectedShapes(view: EditorView): boolean {
  const sel = selectedShapePositions(view.state);
  if (sel.length < 2) return false;
  const doc = view.state.doc;
  const nodes = sel.map((p) => doc.nodeAt(p)!);
  const o = originOf(view, sel[0]!);
  // se mide antes de tocar el documento, porque al cambiarlo el DOM se mueve
  const frames = sel.map((p, i) => measure(view, p, nodes[i]!, o));
  const g = framesToGroup(frames);
  const kids = nodes.map((n, i) => {
    const f = g.children[i]!;
    const size = n.type.name === 'image' ? { width: Math.round(f.width), height: Math.round(f.height) } : {};
    return n.type.create({ ...n.attrs, ...size, x: Math.round(f.x), y: Math.round(f.y), wrap: 'front' }, n.content, n.marks);
  });
  const group = nodeTypes.shape_group!.create({ width: Math.max(1, g.box.width), height: Math.max(1, g.box.height), wrap: 'front', x: g.box.x, y: g.box.y, id: `group-${Date.now().toString(36)}` }, kids);
  const tr = view.state.tr;
  for (const p of [...sel].reverse()) tr.delete(p, p + doc.nodeAt(p)!.nodeSize);
  tr.insert(sel[0]!, group);
  tr.setSelection(NodeSelection.create(tr.doc, sel[0]!)).setMeta(shapeSelKey, [sel[0]!]).setMeta('nw-no-track', true);
  view.dispatch(tr);
  view.focus();
  return true;
}

/**
 * Deshace los grupos seleccionados (un nivel): cada hija vuelve a ser una forma flotante con coordenadas del párrafo, y el giro del
 * grupo se reparte entre ellas. Devuelve si deshizo alguno.
 */
export function ungroupSelectedShapes(view: EditorView): boolean {
  const doc = view.state.doc;
  const groups = selectedShapePositions(view.state).filter((p) => doc.nodeAt(p)?.type.name === 'shape_group');
  if (!groups.length) return false;
  // se mide todo antes de cambiar nada
  const plans = groups.map((pos) => {
    const node = doc.nodeAt(pos)!;
    const gf = measure(view, pos, node, originOf(view, pos));
    const frames: Frame[] = [];
    node.forEach((c, _o, i) => frames.push({ id: String(i), x: c.attrs.x ?? 0, y: c.attrs.y ?? 0, width: c.attrs.width, height: c.attrs.height, rotation: c.attrs.rotation || c.attrs.rotate || 0 }));
    const patches = framesFromGroup(gf, frames);
    const kids: PMNode[] = [];
    node.forEach((c, _o, i) => {
      const p = patches[i]!;
      const turn = c.type.name === 'image' ? { rotate: Math.round(p.rotation ?? c.attrs.rotate ?? 0) } : { rotation: p.rotation ?? c.attrs.rotation ?? 0 };
      kids.push(c.type.create({ ...c.attrs, x: Math.round(p.x ?? 0), y: Math.round(p.y ?? 0), ...turn, wrap: 'front' }, c.content, c.marks));
    });
    return { pos, node, kids };
  });
  const tr = view.state.tr;
  for (const pl of [...plans].reverse()) tr.replaceWith(pl.pos, pl.pos + pl.node.nodeSize, pl.kids);
  // las hijas del primer grupo (el de menor posición no se ve movido por los demás) quedan seleccionadas
  const first = plans[0]!;
  const childPos: number[] = [];
  let at = first.pos;
  for (const k of first.kids) {
    childPos.push(at);
    at += k.nodeSize;
  }
  tr.setSelection(NodeSelection.create(tr.doc, childPos[0]!)).setMeta(shapeSelKey, childPos).setMeta('nw-no-track', true);
  view.dispatch(tr);
  view.focus();
  return true;
}
