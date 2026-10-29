import { newSectionId, sectionAttrs, sectionPropsOf, type Columns, type SectionStart } from '@suitenova/writer-core';
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { blockDepth } from './editing';

/** Depth of the section that holds a position, or -1. */
export function sectionDepth($p: ResolvedPos): number {
  for (let d = $p.depth; d >= 0; d--) if ($p.node(d).type.name === 'section') return d;
  return -1;
}

const sectionType = (state: EditorState) => state.schema.nodes.section!;

/** Split the section at `pos`, the text after it going to a new section that starts as `start`. */
export function splitSectionAt(tr: Transaction, pos: number, start: SectionStart): Transaction {
  const $p = tr.doc.resolve(pos);
  const sd = sectionDepth($p);
  if (sd < 0) return tr;
  const cur = $p.node(sd);
  const attrs = { ...sectionAttrs(sectionPropsOf(cur)), id: newSectionId(), start };
  const type = tr.doc.type.schema.nodes.section!;
  if ($p.depth === sd + 1 && $p.parent.type.name === 'paragraph') {
    // inside a paragraph directly under the section: split the paragraph and the section together
    tr.split(pos, 2, [{ type, attrs }, { type: $p.parent.type, attrs: { ...$p.parent.attrs, pageBreakBefore: false } }]);
  } else {
    // inside a list, table…: break after that block
    const after = $p.after(blockDepth($p));
    tr.split(after, 1, [{ type, attrs }]);
  }
  return tr;
}

/** Insert a section break at the cursor: next page, continuous, even page or odd page. */
export function insertSectionBreak(start: SectionStart): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    if (sectionDepth($from) < 0) return false;
    if (dispatch) {
      const tr = state.tr;
      if (!state.selection.empty) tr.deleteSelection();
      splitSectionAt(tr, tr.selection.from, start);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Index (among the children of the document) of the section that holds a position. */
export function sectionIndexAt(doc: PMNode, pos: number): number {
  return Math.max(0, doc.resolve(Math.min(pos, doc.content.size)).index(0));
}

/**
 * Backspace at the very start of a section joins it with the previous one; the text takes the formatting of the section
 * that follows the break (as in Word).
 */
export const joinSectionBackward: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty) return false;
  const sd = sectionDepth($from);
  if (sd < 0 || $from.index(0) === 0) return false;
  // the cursor must be at the start of the first text block of the section
  if ($from.parentOffset !== 0) return false;
  for (let d = sd + 1; d <= $from.depth; d++) if ($from.index(d - 1) !== 0) return false;
  if (dispatch) {
    const next = $from.node(sd);
    const prev = state.doc.child($from.index(0) - 1);
    const boundary = $from.before(sd);
    const prevStart = boundary - prev.nodeSize;
    const tr = state.tr.join(boundary);
    tr.setNodeMarkup(prevStart, undefined, { ...next.attrs, id: prev.attrs.id, start: prev.attrs.start });
    dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(boundary - 1), 1)).scrollIntoView());
  }
  return true;
};

/** Delete at the end of the last text block of a section joins it with the next one. */
export const joinSectionForward: Command = (state, dispatch) => {
  const { $to, empty } = state.selection;
  if (!empty) return false;
  const sd = sectionDepth($to);
  if (sd < 0 || $to.index(0) >= state.doc.childCount - 1) return false;
  if ($to.parentOffset !== $to.parent.content.size) return false;
  for (let d = sd + 1; d <= $to.depth; d++) if ($to.index(d - 1) !== $to.node(d - 1).childCount - 1) return false;
  if (dispatch) {
    const cur = $to.node(sd);
    const next = state.doc.child($to.index(0) + 1);
    const boundary = $to.after(sd);
    const curStart = $to.before(sd);
    const tr = state.tr.join(boundary);
    tr.setNodeMarkup(curStart, undefined, { ...next.attrs, id: cur.attrs.id, start: cur.attrs.start });
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Set the columns of the section with the caret, or of the text range selected (cut out as continuous sections). */
export function setColumns(cols: Columns, forSelection = false): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    const sd = sectionDepth(state.selection.$from);
    if (sd < 0) return false;
    if (!dispatch) return true;
    let tr = state.tr;
    if (forSelection && !empty) {
      // cut the selection out into its own continuous section: end first so that the start position stays valid
      const sdTo = sectionDepth(tr.doc.resolve(to));
      const atEnd = to >= tr.doc.resolve(to).end(sdTo) - 1;
      if (!atEnd) tr = splitSectionAt(tr, to, 'continuous');
      const mapped = tr.mapping.map(from);
      const sdFrom = sectionDepth(tr.doc.resolve(mapped));
      const atStart = mapped <= tr.doc.resolve(mapped).start(sdFrom) + 1;
      if (!atStart) tr = splitSectionAt(tr, mapped, 'continuous');
      const target = tr.doc.resolve(tr.mapping.map(from) + 1);
      const tsd = sectionDepth(target);
      tr = tr.setNodeMarkup(target.before(tsd), undefined, { ...target.node(tsd).attrs, cols });
    } else {
      const $f = state.selection.$from;
      tr = tr.setNodeMarkup($f.before(sd), undefined, { ...$f.node(sd).attrs, cols });
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

void sectionType;
