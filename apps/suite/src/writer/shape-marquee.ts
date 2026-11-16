import { NodeSelection, Selection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { isShapeLike, selectedShapePositions, shapeSelKey } from './shape-selection';

/**
 * Modo «Seleccionar objetos» (como el de Word): arrastrar sobre el documento dibuja un recuadro y elige las formas y grupos que
 * quedan **por completo** dentro; Ctrl o Mayús suman a lo elegido y un clic en vacío deselecciona. Un clic sobre una forma sigue
 * eligiéndola como siempre. Devuelve si tomó el evento.
 */
export function startShapeMarquee(view: EditorView, e: MouseEvent): boolean {
  if (e.button !== 0) return false;
  const target = e.target as HTMLElement | null;
  if (!target || target.closest('.nw-shape')) return false;
  e.preventDefault();
  const add = e.ctrlKey || e.shiftKey || e.metaKey;
  const sx = e.clientX;
  const sy = e.clientY;
  const box = document.createElement('div');
  box.className = 'nw-marquee';
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:50;border:1px dashed #2b6cb0;background:rgba(43,108,176,0.1);display:none';
  document.body.appendChild(box);
  let rect = { x1: sx, y1: sy, x2: sx, y2: sy };
  const move = (ev: MouseEvent) => {
    rect = { x1: Math.min(sx, ev.clientX), y1: Math.min(sy, ev.clientY), x2: Math.max(sx, ev.clientX), y2: Math.max(sy, ev.clientY) };
    box.style.display = 'block';
    box.style.left = `${rect.x1}px`;
    box.style.top = `${rect.y1}px`;
    box.style.width = `${rect.x2 - rect.x1}px`;
    box.style.height = `${rect.y2 - rect.y1}px`;
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    box.remove();
    const small = rect.x2 - rect.x1 < 3 && rect.y2 - rect.y1 < 3;
    const found = small ? [] : shapesInside(view, rect);
    const next = add ? [...new Set([...selectedShapePositions(view.state), ...found])].sort((a, b) => a - b) : found;
    let tr = view.state.tr.setMeta(shapeSelKey, next.length > 1 ? next : []).setMeta('addToHistory', false);
    if (next.length) tr = tr.setSelection(NodeSelection.create(view.state.doc, next[next.length - 1]!));
    else if (!add && view.state.selection instanceof NodeSelection) tr = tr.setSelection(Selection.near(view.state.doc.resolve(view.state.selection.to), 1));
    view.dispatch(tr);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  return true;
}

/** Posiciones de las formas y grupos más externos cuyo rectángulo en pantalla cabe por completo en `r`. */
function shapesInside(view: EditorView, r: { x1: number; y1: number; x2: number; y2: number }): number[] {
  const out: number[] = [];
  // formas y grupos, e imágenes libres (la caja de recorte o el propio `img`)
  const sel = ".nw-shape, .nw-imgbox:has(> img[data-wrap='front']), .nw-imgbox:has(> img[data-wrap='behind']), img.nw-image[data-wrap='front'], img.nw-image[data-wrap='behind']";
  view.dom.querySelectorAll<HTMLElement>(sel).forEach((el) => {
    if (el.parentElement?.closest('.nw-shape')) return; // una forma o imagen dentro de un grupo o de un cuadro de texto no se elige sola
    if (el.tagName === 'IMG' && el.parentElement?.classList.contains('nw-imgbox')) return; // la caja de recorte ya cuenta
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) return;
    if (b.left < r.x1 || b.top < r.y1 || b.right > r.x2 || b.bottom > r.y2) return;
    const parent = el.parentNode;
    if (!parent) return;
    const pos = view.posAtDOM(parent, Array.prototype.indexOf.call(parent.childNodes, el));
    if (isShapeLike(view.state.doc.nodeAt(pos))) out.push(pos);
  });
  return [...new Set(out)].sort((a, b) => a - b);
}
