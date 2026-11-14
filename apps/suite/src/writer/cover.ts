import { nodeTypes, writerSchema } from '@suitenova/writer-core';
import type { Node as PMNode } from 'prosemirror-model';
import type { Command, EditorState } from 'prosemirror-state';

export interface CoverText {
  title: string;
  subtitle: string;
  author: string;
  date: string;
}

export interface CoverDef {
  id: string;
  name: string;
}
export const COVERS: CoverDef[] = [
  { id: 'classic', name: 'Clásica' },
  { id: 'band', name: 'Banda' },
  { id: 'modern', name: 'Moderna' },
  { id: 'minimal', name: 'Mínima' },
];

const COVER_STYLES = ['CoverTitle', 'CoverSubtitle', 'CoverMeta'];
const mark = (name: string, attrs?: Record<string, unknown>) => writerSchema.marks[name]!.create(attrs);
const para = (style: string, text: string, attrs: Record<string, unknown>, marks: ReturnType<typeof mark>[] = []): PMNode =>
  nodeTypes.paragraph!.create({ style, ...attrs }, text ? writerSchema.text(text, marks) : undefined);

/** The blocks of a cover page (ending with the page break that separates it from the document). */
export function buildCover(id: string, t: CoverText): PMNode[] {
  const out: PMNode[] = [];
  switch (id) {
    case 'band':
      out.push(
        para('CoverTitle', t.title, { align: 'left', shade: '#1f3864', spaceBefore: 160, spaceAfter: 0, indentLeft: 12, indentRight: 12 }, [mark('color', { value: '#ffffff' })]),
        para('CoverSubtitle', t.subtitle, { align: 'left', shade: '#2f5597', spaceBefore: 0, spaceAfter: 0, indentLeft: 12, indentRight: 12 }, [mark('color', { value: '#dce6f4' })]),
        para('CoverMeta', t.author, { align: 'left', spaceBefore: 200 }),
        para('CoverMeta', t.date, { align: 'left', spaceBefore: 0 }),
      );
      break;
    case 'modern':
      out.push(
        para('CoverTitle', t.title, { align: 'left', spaceBefore: 180, spaceAfter: 6 }, [mark('color', { value: '#2f5597' }), mark('fontSize', { value: 44 })]),
        para('CoverSubtitle', t.subtitle, { align: 'left', spaceAfter: 24 }, [mark('color', { value: '#7f7f7f' })]),
        para('CoverMeta', t.author, { align: 'left', spaceBefore: 160 }, [mark('strong')]),
        para('CoverMeta', t.date, { align: 'left', spaceBefore: 0 }),
      );
      break;
    case 'minimal':
      out.push(
        para('CoverTitle', t.title, { align: 'left', spaceBefore: 120, spaceAfter: 4 }, [mark('fontSize', { value: 30 })]),
        para('CoverSubtitle', t.subtitle, { align: 'left' }, [mark('fontSize', { value: 14 })]),
        para('CoverMeta', t.author, { align: 'left', spaceBefore: 24 }),
        para('CoverMeta', t.date, { align: 'left', spaceBefore: 0 }),
      );
      break;
    default:
      out.push(
        para('CoverTitle', t.title, { align: 'center', spaceBefore: 150, spaceAfter: 12 }),
        para('CoverSubtitle', t.subtitle, { align: 'center', spaceAfter: 24 }),
        para('CoverMeta', t.author, { align: 'center', spaceBefore: 180 }),
        para('CoverMeta', t.date, { align: 'center', spaceBefore: 0 }),
      );
  }
  out.push(nodeTypes.page_break!.create());
  return out;
}

/** Offset after the cover at the start of the document, or null when the document has no cover. */
export function coverEnd(state: EditorState): number | null {
  const sec = state.doc.firstChild;
  const first = sec?.firstChild;
  if (!sec || !first || first.type.name !== 'paragraph' || !COVER_STYLES.includes(first.attrs.style)) return null;
  let pos = 1; // inside the first section
  for (let i = 0; i < sec.childCount; i++) {
    const n = sec.child(i);
    pos += n.nodeSize;
    if (n.type.name === 'page_break') return pos;
    if (n.type.name !== 'paragraph' || !COVER_STYLES.includes(n.attrs.style)) return null;
  }
  return null;
}

/** Put a cover page at the start of the document, replacing the one it already has. */
export const insertCover = (id: string, text: CoverText): Command => (state, dispatch) => {
  if (!state.doc.firstChild) return false;
  if (dispatch) {
    const end = coverEnd(state);
    const tr = state.tr;
    if (end !== null) tr.delete(1, end);
    tr.insert(1, buildCover(id, text));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

export const removeCover: Command = (state, dispatch) => {
  const end = coverEnd(state);
  if (end === null) return false;
  if (dispatch) dispatch(state.tr.delete(1, end));
  return true;
};
