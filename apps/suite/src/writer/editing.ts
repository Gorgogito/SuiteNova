import { chainCommands, createParagraphNear, deleteSelection, joinBackward, liftEmptyBlock, newlineInCode, selectNodeBackward, selectAll, splitBlockKeepMarks, joinForward, selectNodeForward } from 'prosemirror-commands';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import type { Mark, MarkType, Node as PMNode, NodeType } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { goToNextCell, isInTable } from 'prosemirror-tables';
import { nodeTypes, markTypes, type Align, type ListFormat } from '@suitenova/writer-core';

export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

// ---------- marks ----------

export function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

export function markAttr(state: EditorState, type: MarkType, attr: string): unknown {
  const { $from, from, to, empty } = state.selection;
  if (empty) return (type.isInSet(state.storedMarks || $from.marks()) as Mark | undefined)?.attrs[attr];
  let found: unknown;
  state.doc.nodesBetween(from, to, (n) => {
    if (found !== undefined) return false;
    const m = type.isInSet(n.marks);
    if (m) found = m.attrs[attr];
    return true;
  });
  return found;
}

/** Add `attrs` to the selection, or clear the mark when `attrs` is null. */
export function setMark(type: MarkType, attrs: Record<string, unknown> | null): Command {
  return (state, dispatch) => {
    const { empty, $from, ranges } = state.selection;
    if (dispatch) {
      const tr = state.tr;
      if (empty) {
        if (attrs) tr.addStoredMark(type.create(attrs));
        else tr.removeStoredMark(type);
        if (!attrs && !state.storedMarks) tr.setStoredMarks(($from.marks() as Mark[]).filter((m) => m.type !== type));
      } else {
        for (const r of ranges) {
          if (attrs) tr.addMark(r.$from.pos, r.$to.pos, type.create(attrs));
          else tr.removeMark(r.$from.pos, r.$to.pos, type);
        }
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function toggleMarkCmd(type: MarkType): Command {
  return (state, dispatch) => setMark(type, markActive(state, type) ? null : {})(state, dispatch);
}

/** Superscript and subscript exclude each other; toggling one drops the other (schema `excludes`). */
export const toggleMarkByName = (name: string): Command => toggleMarkCmd(markTypes[name]!);

export function clearFormatting(): Command {
  return (state, dispatch) => {
    if (!dispatch) return true;
    const { from, to, empty } = state.selection;
    const tr = state.tr;
    if (empty) tr.setStoredMarks([]);
    else tr.removeMark(from, to);
    updateParagraphsTr(tr, state, { style: null, align: null, spaceBefore: null, spaceAfter: null, lineHeight: null });
    dispatch(tr.scrollIntoView());
    return true;
  };
}

// ---------- paragraphs ----------

function paragraphsInSelection(state: EditorState): { node: PMNode; pos: number }[] {
  const out: { node: PMNode; pos: number }[] = [];
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (n, pos) => {
    if (n.type.name === 'paragraph') out.push({ node: n, pos });
    return n.type.name !== 'paragraph';
  });
  return out;
}

function updateParagraphsTr(tr: Transaction, state: EditorState, patch: Record<string, unknown> | ((n: PMNode) => Record<string, unknown>)) {
  for (const { node, pos } of paragraphsInSelection(state)) {
    const p = typeof patch === 'function' ? patch(node) : patch;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...p });
  }
}

export function updateParagraphs(patch: Record<string, unknown> | ((n: PMNode) => Record<string, unknown>)): Command {
  return (state, dispatch) => {
    if (dispatch) {
      const tr = state.tr;
      updateParagraphsTr(tr, state, patch);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export const setAlign = (a: Align): Command => updateParagraphs({ align: a });

export const setStyle = (id: string): Command =>
  updateParagraphs({ style: id === 'Normal' ? null : id, align: null, spaceBefore: null, spaceAfter: null, lineHeight: null });

export function selectionParagraph(state: EditorState): PMNode | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'paragraph') return $from.node(d);
  return null;
}

export function listAncestor(state: EditorState): { node: PMNode; depth: number } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'bullet_list' || n.type.name === 'ordered_list') return { node: n, depth: d };
  }
  return null;
}

export function changeIndent(delta: number): Command {
  return (state, dispatch) => {
    if (listAncestor(state)) {
      const li = nodeTypes.list_item!;
      return delta > 0 ? sinkListItem(li)(state, dispatch) : liftListItem(li)(state, dispatch);
    }
    return updateParagraphs((n) => ({ indentLeft: Math.max(0, (n.attrs.indentLeft ?? 0) + delta) }))(state, dispatch);
  };
}

/** Bullet or numbered list: toggles, or converts the list the cursor is in. */
export function toggleList(kind: 'bullet' | 'ordered', format: ListFormat = 'decimal'): Command {
  return (state, dispatch) => {
    const anc = listAncestor(state);
    const type: NodeType = kind === 'bullet' ? nodeTypes.bullet_list! : nodeTypes.ordered_list!;
    if (anc) {
      const sameKind = anc.node.type === type && (kind === 'bullet' || anc.node.attrs.format === format);
      if (sameKind) {
        // lift out of every enclosing list, as one transaction
        if (dispatch) {
          const combined = state.tr;
          let cur = state;
          for (let i = 0; i < 12 && listAncestor(cur); i++) {
            let nxt: EditorState | null = null;
            liftListItem(nodeTypes.list_item!)(cur, (t) => {
              nxt = cur.apply(t);
              t.steps.forEach((st) => combined.step(st));
            });
            if (!nxt) break;
            cur = nxt;
          }
          dispatch(combined.scrollIntoView());
        }
        return true;
      }
      if (dispatch) {
        const pos = state.selection.$from.before(anc.depth);
        dispatch(state.tr.setNodeMarkup(pos, type, kind === 'ordered' ? { format, start: anc.node.attrs.start ?? 1 } : null));
      }
      return true;
    }
    return wrapInList(type, kind === 'ordered' ? { format } : undefined)(state, dispatch);
  };
}

// ---------- Enter / Tab ----------

const NEXT_STYLE: Record<string, string> = { Title: 'Subtitle', Subtitle: 'Normal' };

/** Enter: new paragraph that keeps the formatting, but not page-break-before; headings continue as body text. */
const splitParagraph: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  const para = $from.parent;
  if (para.type.name !== 'paragraph') return false;
  if (dispatch) {
    const tr = state.tr;
    if (!empty) tr.deleteSelection();
    const pos = tr.selection.from;
    const $p = tr.doc.resolve(pos);
    const atEnd = $p.parentOffset === $p.parent.content.size;
    const style: string | null = $p.parent.attrs.style;
    const nextStyle = atEnd && style ? (style.startsWith('Heading') ? null : (NEXT_STYLE[style] ?? style)) : style;
    const marks = tr.storedMarks || $p.marks();
    tr.split(pos, 1, [{ type: nodeTypes.paragraph!, attrs: { ...$p.parent.attrs, pageBreakBefore: false, style: nextStyle === 'Normal' ? null : nextStyle } }]);
    if (atEnd) tr.setStoredMarks(marks);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Enter on an empty list item outdents it, and leaves the list when it is already at the top level. */
const exitEmptyListItem: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== 'paragraph' || $from.parent.content.size > 0 || !listAncestor(state)) return false;
  return liftListItem(nodeTypes.list_item!)(state, dispatch);
};

export const enterCommand: Command = chainCommands(splitListItem(nodeTypes.list_item!), exitEmptyListItem, splitParagraph, newlineInCode, createParagraphNear, liftEmptyBlock, splitBlockKeepMarks);

export const tabCommand: Command = (state, dispatch) => {
  if (listAncestor(state)) return sinkListItem(nodeTypes.list_item!)(state, dispatch) || true;
  if (isInTable(state)) return goToNextCell(1)(state, dispatch);
  if (dispatch) dispatch(state.tr.insertText('\t').scrollIntoView());
  return true;
};

export const shiftTabCommand: Command = (state, dispatch) => {
  if (listAncestor(state)) return liftListItem(nodeTypes.list_item!)(state, dispatch) || true;
  if (isInTable(state)) return goToNextCell(-1)(state, dispatch);
  return true;
};

export const backspaceCommand: Command = chainCommands(deleteSelection, joinBackward, selectNodeBackward);
export const deleteCommand: Command = chainCommands(deleteSelection, joinForward, selectNodeForward);
export { selectAll };

// ---------- inserts ----------

export function createTable(rows: number, cols: number, contentWidthPx: number): PMNode {
  const w = Math.max(30, Math.floor(contentWidthPx / cols));
  const cell = () => nodeTypes.table_cell!.create({ colwidth: [w] }, nodeTypes.paragraph!.create({ spaceAfter: 0 }));
  const row = () => nodeTypes.table_row!.create(null, Array.from({ length: cols }, cell));
  return nodeTypes.table!.create({ borders: true }, Array.from({ length: rows }, row));
}

export const insertNode = (node: PMNode): Command => (state, dispatch) => {
  if (dispatch) dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
  return true;
};

/** Depth of the block directly under the section (or the document) that holds a position. */
export function blockDepth($p: import('prosemirror-model').ResolvedPos): number {
  for (let d = 0; d <= $p.depth; d++) if ($p.node(d).type.name === 'section') return Math.min(d + 1, $p.depth);
  return Math.min(1, $p.depth);
}

export function insertBlockAfterCursor(node: PMNode): Command {
  return (state, dispatch) => {
    if (!dispatch) return true;
    const { $from } = state.selection;
    // insert after the top-level block that holds the cursor
    const pos = $from.depth >= 1 ? $from.after(blockDepth($from)) : $from.pos;
    const tr = state.tr.insert(pos, node);
    const after = tr.doc.resolve(Math.min(pos + node.nodeSize + 1, tr.doc.content.size));
    dispatch(tr.setSelection(TextSelection.near(after)).scrollIntoView());
    return true;
  };
}

export function insertPageBreak(): Command {
  return (state, dispatch) => {
    if (!dispatch) return true;
    const { $from } = state.selection;
    const para = $from.parent;
    if (para.type.name !== 'paragraph' || $from.depth < 1) return false;
    const tr = state.tr;
    if (!state.selection.empty) tr.deleteSelection();
    const p = tr.selection.$from;
    const bd = blockDepth(p);
    const topNode = p.node(bd);
    if (topNode.type.name !== 'paragraph') {
      // inside a list or table: put the break after the whole block
      const after = p.after(bd);
      tr.insert(after, [nodeTypes.page_break!.create(), nodeTypes.paragraph!.create()]);
      dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(after + 2))).scrollIntoView());
      return true;
    }
    const splitAt = p.pos;
    tr.split(splitAt, 1);
    // after the split the first paragraph ends at `splitAt`; insert the break between the two halves
    const boundary = tr.doc.resolve(splitAt).after(blockDepth(tr.doc.resolve(splitAt)));
    tr.insert(boundary, nodeTypes.page_break!.create());
    dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(boundary + 1))).scrollIntoView());
    return true;
  };
}

export function setLink(href: string | null, text?: string): Command {
  return (state, dispatch) => {
    const type = markTypes.link!;
    const { from, to, empty } = state.selection;
    if (dispatch) {
      const tr = state.tr;
      if (!href) {
        // remove the link around the cursor/selection
        let a = from, b = to;
        if (empty) {
          const $f = state.selection.$from;
          const start = $f.parent.childAfter($f.parentOffset);
          void start;
          state.doc.nodesBetween($f.start(), $f.end(), (n, pos) => {
            if (n.isText && type.isInSet(n.marks) && pos <= from && pos + n.nodeSize >= from) {
              a = pos;
              b = pos + n.nodeSize;
            }
          });
        }
        tr.removeMark(a, b, type);
      } else if (empty) {
        const label = text || href;
        tr.insertText(label, from);
        tr.addMark(from, from + label.length, type.create({ href }));
      } else tr.addMark(from, to, type.create({ href }));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}
