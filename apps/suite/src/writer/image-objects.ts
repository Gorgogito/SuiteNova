import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection, Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { measure, originOf } from './shape-group-ops';
import { isFloatingImage, outerGroupPos, selectShapeOnly, toggleShapeSelection } from './shape-selection';

/*
 * Imágenes libres (delante o detrás del texto) y dentro de grupos. Una imagen es un nodo normal de ProseMirror sin vista propia, así
 * que su ratón se trata aquí: una imagen libre se elige, se arrastra y entra en la selección múltiple como una forma; una imagen que
 * está dentro de un grupo elige el grupo (como las formas de un grupo).
 */

/** La imagen cuyo elemento es `el` (el `img` o la caja de recorte que lo envuelve), con su posición. */
function imageAt(view: EditorView, el: HTMLElement): { pos: number; node: PMNode } | null {
  const parent = el.parentNode;
  if (!parent) return null;
  const pos = view.posAtDOM(parent, Array.prototype.indexOf.call(parent.childNodes, el));
  const node = view.state.doc.nodeAt(pos);
  return node && node.type.name === 'image' ? { pos, node } : null;
}

/**
 * Ajuste de una imagen: de en línea o con texto alrededor a libre (`front`/`behind`) conserva el sitio donde está en pantalla; de libre
 * a otro ajuste quita la posición. Devuelve los atributos que cambian.
 */
export function wrapPatch(view: EditorView, pos: number, wrap: 'left' | 'right' | 'top' | 'front' | 'behind' | null): Record<string, unknown> {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'image') return { wrap };
  if ((wrap === 'front' || wrap === 'behind') && !isFloatingImage(node)) {
    const f = measure(view, pos, node, originOf(view, pos));
    return { wrap, x: Math.round(f.x), y: Math.round(f.y), width: Math.round(f.width), height: Math.round(f.height) };
  }
  if (wrap === 'front' || wrap === 'behind') return { wrap };
  return { wrap, x: 0, y: 0 };
}

/** Mueve una imagen libre arrastrándola; con Ctrl o Mayús, en cambio, la suma a la selección múltiple. */
function startDrag(view: EditorView, pos: number, e: MouseEvent): void {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;
  const o = originOf(view, pos);
  const x0 = node.attrs.x ?? 0;
  const y0 = node.attrs.y ?? 0;
  const sx = e.clientX;
  const sy = e.clientY;
  let moved = false;
  const move = (ev: MouseEvent) => {
    const dx = (ev.clientX - sx) / o.scale;
    const dy = (ev.clientY - sy) / o.scale;
    if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
    moved = true;
    const cur = view.state.doc.nodeAt(pos);
    if (!cur || cur.type.name !== 'image') return;
    const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, x: Math.round(x0 + dx), y: Math.round(y0 + dy) });
    view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)).setMeta('nw-no-track', true));
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

export function imageObjectsPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown: (view, ev) => {
          const e = ev as MouseEvent;
          if (e.button !== 0) return false;
          const t = e.target as HTMLElement | null;
          const el = (t?.closest('.nw-imgbox') as HTMLElement | null) ?? (t?.tagName === 'IMG' ? t : null);
          if (!el) return false;
          const hit = imageAt(view, el);
          if (!hit) return false;
          const multi = e.ctrlKey || e.shiftKey || e.metaKey;
          const top = outerGroupPos(view.state, hit.pos);
          if (top !== null) {
            // dentro de un grupo: el grupo es el objeto
            e.preventDefault();
            if (multi) toggleShapeSelection(view, top);
            else selectShapeOnly(view, top);
            return true;
          }
          if (!isFloatingImage(hit.node)) return false;
          e.preventDefault();
          if (multi) {
            toggleShapeSelection(view, hit.pos);
            return true;
          }
          selectShapeOnly(view, hit.pos);
          startDrag(view, hit.pos, e);
          return true;
        },
      },
    },
  });
}
