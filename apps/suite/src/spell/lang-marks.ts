import type { Mark, MarkType } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

/*
 * Idioma de revisión por texto y «no revisar» en documentos de ProseMirror con el esquema de Writer (Writer y Notes): las marcas `lang`
 * (etiqueta BCP 47, `w:lang` en .docx) y `noproof` (`w:noProof`).
 */

const markOf = (state: EditorState, name: 'lang' | 'noproof'): MarkType | undefined => state.schema.marks[name];

/** Marcas que lleva el texto de la selección (o las guardadas para lo que se escriba, si no hay selección). */
function marksIn(state: EditorState, type: MarkType): (Mark | null)[] {
  const { from, to, empty, $from } = state.selection;
  if (empty) return [(state.storedMarks ?? $from.marks()).find((m) => m.type === type) ?? null];
  const out: (Mark | null)[] = [];
  state.doc.nodesBetween(from, to, (n) => {
    if (n.isText) out.push(n.marks.find((m) => m.type === type) ?? null);
  });
  return out;
}

/** El idioma del texto seleccionado: la etiqueta, `null` si usa el del documento, `'mixed'` si hay varios. */
export function langOfSelection(state: EditorState): string | null | 'mixed' {
  const t = markOf(state, 'lang');
  if (!t) return null;
  const vals = new Set(marksIn(state, t).map((m) => (m ? (m.attrs.value as string) : null)));
  return vals.size > 1 ? 'mixed' : ([...vals][0] ?? null);
}

/** Pone el idioma (o lo quita, con `null`, para que valga el del documento) en la selección; sin selección vale para lo que se escriba. */
export function setSelectionLang(view: EditorView, tag: string | null): boolean {
  const { state } = view;
  const t = markOf(state, 'lang');
  if (!t) return false;
  const { from, to, empty } = state.selection;
  let tr = state.tr;
  if (empty) tr = tag ? tr.addStoredMark(t.create({ value: tag })) : tr.removeStoredMark(t);
  else tr = tag ? tr.addMark(from, to, t.create({ value: tag })) : tr.removeMark(from, to, t);
  view.dispatch(tr);
  return true;
}

/** Si todo el texto seleccionado está marcado como «no revisar». */
export function noProofOfSelection(state: EditorState): boolean {
  const t = markOf(state, 'noproof');
  if (!t) return false;
  const m = marksIn(state, t);
  return m.length > 0 && m.every(Boolean);
}

/** Marca o desmarca la selección como «no revisar la ortografía ni la gramática». */
export function toggleNoProof(view: EditorView): boolean {
  const { state } = view;
  const t = markOf(state, 'noproof');
  if (!t) return false;
  const { from, to, empty } = state.selection;
  const on = !noProofOfSelection(state);
  let tr = state.tr;
  if (empty) tr = on ? tr.addStoredMark(t.create()) : tr.removeStoredMark(t);
  else tr = on ? tr.addMark(from, to, t.create()) : tr.removeMark(from, to, t);
  view.dispatch(tr);
  return true;
}
