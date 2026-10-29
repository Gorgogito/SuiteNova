import { Node as PMNode } from 'prosemirror-model';
import { writerSchema } from './schema';
import { formatPageNumber } from './sections';
import type { NotesOptions } from './docx/model';

export type NoteKind = 'footnote' | 'endnote';

export interface NoteRef {
  id: string;
  kind: NoteKind;
  /** Position of the reference in the document. */
  pos: number;
  node: PMNode;
  /** 1-based number among the notes of its kind (restarting per section when asked). */
  number: number;
  /** What is shown: "1", "ii", "*"… */
  label: string;
  /** Index of the section that holds the reference. */
  section: number;
}

const SYMBOLS = ['*', '†', '‡', '§', '‖', '¶'];

export function noteLabel(n: number, fmt: NotesOptions['footnoteFormat']): string {
  if (fmt === 'symbols') {
    const sym = SYMBOLS[(n - 1) % SYMBOLS.length]!;
    return sym.repeat(Math.floor((n - 1) / SYMBOLS.length) + 1);
  }
  return formatPageNumber(n, fmt);
}

/** Every footnote and endnote reference of a document, in order, with its number. */
export function collectNotes(doc: PMNode, opts: NotesOptions): NoteRef[] {
  const out: NoteRef[] = [];
  let fn = 0;
  let en = 0;
  let sectionIndex = -1;
  const visit = (node: PMNode, pos: number, inSection: number) => {
    node.forEach((child, off) => {
      const cp = pos + 1 + off;
      if (child.type.name === 'footnote') {
        const kind = (child.attrs.kind as NoteKind) ?? 'footnote';
        const number = kind === 'footnote' ? ++fn : ++en;
        const custom = child.attrs.custom as string | null;
        out.push({ id: child.attrs.id, kind, pos: cp, node: child, number, label: custom || noteLabel(number, kind === 'footnote' ? opts.footnoteFormat : opts.endnoteFormat), section: inSection });
      } else if (child.type.name === 'shape' || child.type.name === 'content_control') {
        visit(child, cp, inSection);
      } else if (!child.isLeaf && !child.isTextblock) {
        visit(child, cp, inSection);
      } else if (child.isTextblock) {
        visit(child, cp, inSection);
      }
    });
  };
  doc.forEach((child, off) => {
    if (child.type.name === 'section') {
      sectionIndex++;
      if (opts.footnoteRestart === 'section') fn = 0;
      visit(child, off, sectionIndex);
    } else visit(doc.type.create(null, child), off - 1, Math.max(0, sectionIndex));
  });
  return out;
}

/** The text of a note as a document (the paragraphs it was written with). */
export function noteDoc(body: unknown): PMNode | null {
  if (!body || typeof body !== 'object') return null;
  try {
    return PMNode.fromJSON(writerSchema, body as never);
  } catch {
    return null;
  }
}

export function noteBodyOf(paragraphs: PMNode[]): unknown {
  return writerSchema.nodes.doc!.create(null, paragraphs.length ? paragraphs : [writerSchema.nodes.paragraph!.create()]).toJSON();
}

let nextId = 1;
export const newNoteId = (existing: Set<string> | null = null): string => {
  for (;;) {
    const id = `n${Date.now().toString(36)}${(nextId++).toString(36)}`;
    if (!existing || !existing.has(id)) return id;
  }
};
