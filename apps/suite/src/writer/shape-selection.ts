import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

/**
 * Selección de varias formas a la vez (ProseMirror solo selecciona un nodo): el plugin guarda las posiciones de las formas y grupos
 * elegidos con Ctrl/Mayús+clic. Una sola forma sigue siendo una `NodeSelection` normal; la lista se vacía en cuanto la selección
 * se va a otra parte.
 */
export const shapeSelKey = new PluginKey<number[]>('shapeSelection');

/** Imagen libre (delante o detrás del texto): se elige, se mueve y se agrupa como una forma. */
export const isFloatingImage = (n: PMNode | null | undefined): boolean => !!n && n.type.name === 'image' && (n.attrs.wrap === 'front' || n.attrs.wrap === 'behind');

export const isShapeLike = (n: PMNode | null | undefined): boolean => !!n && (n.type.name === 'shape' || n.type.name === 'shape_group' || isFloatingImage(n));

export function shapeSelectionPlugin(): Plugin<number[]> {
  return new Plugin<number[]>({
    key: shapeSelKey,
    state: {
      init: () => [],
      apply(tr, value, _old, state) {
        const meta = tr.getMeta(shapeSelKey) as number[] | undefined;
        if (meta) return meta;
        if (!value.length) return value;
        let v = value;
        if (tr.docChanged) {
          v = v
            .map((p) => tr.mapping.map(p, 1))
            .filter((p) => {
              const n = state.doc.nodeAt(p);
              return isShapeLike(n);
            });
        }
        if (tr.selectionSet) {
          const s = state.selection;
          if (!(s instanceof NodeSelection) || !v.includes(s.from)) return [];
        }
        return v;
      },
    },
    props: {
      decorations(state) {
        const v = shapeSelKey.getState(state) ?? [];
        if (v.length < 2) return null;
        const decos: Decoration[] = [];
        for (const p of v) {
          const n = state.doc.nodeAt(p);
          if (n) decos.push(Decoration.node(p, p + n.nodeSize, { class: 'nw-multisel' }));
        }
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}

/** Posiciones (de menor a mayor) de las formas y grupos seleccionados: la selección múltiple, o el único nodo seleccionado. */
export function selectedShapePositions(state: EditorState | null | undefined): number[] {
  if (!state) return [];
  const multi = shapeSelKey.getState(state) ?? [];
  if (multi.length) return [...multi].sort((a, b) => a - b);
  const s = state.selection;
  return s instanceof NodeSelection && isShapeLike(s.node) ? [s.from] : [];
}

/** Posición del grupo más externo que contiene a `pos` (o `null` si la forma no está en un grupo). */
export function outerGroupPos(state: EditorState, pos: number): number | null {
  const $p = state.doc.resolve(pos);
  for (let d = 1; d <= $p.depth; d++) if ($p.node(d).type.name === 'shape_group') return $p.before(d);
  return null;
}

/** Ctrl/Mayús+clic: añade o quita una forma de la selección. */
export function toggleShapeSelection(view: EditorView, pos: number): void {
  const cur = selectedShapePositions(view.state);
  const next = cur.includes(pos) ? cur.filter((p) => p !== pos) : [...cur, pos].sort((a, b) => a - b);
  const focus = next.includes(pos) ? pos : next[next.length - 1];
  let tr = view.state.tr.setMeta(shapeSelKey, next).setMeta('addToHistory', false);
  if (focus !== undefined) tr = tr.setSelection(NodeSelection.create(view.state.doc, focus));
  view.dispatch(tr);
  view.focus();
}

/** Clic normal: elige solo esa forma y deja la selección múltiple. */
export function selectShapeOnly(view: EditorView, pos: number): void {
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)).setMeta(shapeSelKey, []).setMeta('addToHistory', false));
  view.focus();
}

/**
 * Clic en el texto de un cuadro de texto mientras hay un objeto seleccionado como nodo: ProseMirror deja el cursor fuera y lo que se
 * escribe va al párrafo. Aquí se coloca el cursor donde se hizo clic, dentro del cuadro. Devuelve si lo colocó.
 */
export function placeCaretFromClick(view: EditorView, e: MouseEvent, shapePos: number, shape: PMNode): boolean {
  if (!shape.childCount || !shape.lastChild?.isTextblock) return false;
  const hit = view.posAtCoords({ left: e.clientX, top: e.clientY });
  const inside = !!hit && hit.pos > shapePos && hit.pos < shapePos + shape.nodeSize - 1 && view.state.doc.resolve(hit.pos).parent.inlineContent;
  // en la zona vacía del cuadro, ProseMirror da una posición de fuera: el cursor va al final de su último párrafo
  const pos = inside ? hit!.pos : shapePos + shape.nodeSize - 2;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)).setMeta(shapeSelKey, []).setMeta('addToHistory', false));
  view.focus();
  return true;
}
