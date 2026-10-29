import type { Node as PMNode } from 'prosemirror-model';

/**
 * The text of a document the way Word's object model sees it: one long string where every paragraph ends with a
 * paragraph mark (`\r`), every inline object (image, field, note reference, shape, equation) counts as one character, and
 * positions are character offsets. Macros work with these offsets; the story maps them to ProseMirror positions.
 */
interface Seg {
  off: number;
  pos: number;
  len: number;
  /** Size of the node in the ProseMirror document (atoms); text and paragraph marks use `len`. */
  size: number;
  kind: 'text' | 'atom' | 'para';
}

export interface Story {
  text: string;
  segs: Seg[];
  /** The textblocks in order: start position of their content and the offset where they begin. */
  blocks: { pos: number; off: number; node: PMNode }[];
}

export function buildStory(doc: PMNode): Story {
  const segs: Seg[] = [];
  const blocks: Story['blocks'] = [];
  let text = '';
  const inline = (node: PMNode, base: number) => {
    node.forEach((child, offset) => {
      const pos = base + offset;
      if (child.isText) {
        segs.push({ off: text.length, pos, len: child.text!.length, size: child.text!.length, kind: 'text' });
        text += child.text;
      } else if (child.type.name === 'content_control') {
        inline(child, pos + 1);
      } else {
        segs.push({ off: text.length, pos, len: 1, size: child.nodeSize, kind: 'atom' });
        text += child.type.name === 'hard_break' ? '\v' : '￼';
      }
    });
  };
  doc.descendants((node, pos) => {
    if (node.type.name === 'shape') return false;
    if (node.isTextblock) {
      blocks.push({ pos: pos + 1, off: text.length, node });
      inline(node, pos + 1);
      segs.push({ off: text.length, pos: pos + 1 + node.content.size, len: 1, size: 0, kind: 'para' });
      text += '\r';
      return false;
    }
    return true;
  });
  return { text, segs, blocks };
}

/** The ProseMirror position for a caret placed before the character at `off`. */
export function offsetToPos(story: Story, off: number): number {
  const o = Math.max(0, Math.min(off, story.text.length));
  for (let i = story.segs.length - 1; i >= 0; i--) {
    const s = story.segs[i]!;
    if (o >= s.off) return s.kind === 'text' ? s.pos + Math.min(o - s.off, s.len) : s.pos;
  }
  return 1;
}

/** The character offset of a ProseMirror position. */
export function posToOffset(story: Story, pos: number): number {
  let best = 0;
  for (const s of story.segs) {
    if (s.kind === 'text') {
      if (pos >= s.pos && pos <= s.pos + s.len) best = s.off + (pos - s.pos);
      else if (pos > s.pos + s.len) best = s.off + s.len;
    } else if (s.kind === 'atom') {
      if (pos > s.pos) best = Math.max(best, s.off + (pos >= s.pos + s.size ? 1 : 0));
    } else if (pos > s.pos) best = Math.max(best, s.off + 1);
    if (s.pos > pos && s.kind !== 'text') break;
  }
  return Math.max(0, Math.min(best, story.text.length));
}

/** The textblocks that overlap the offsets `start..end` (a collapsed range belongs to the block that holds it). */
export function blocksIn(story: Story, start: number, end: number): Story['blocks'] {
  const out: Story['blocks'] = [];
  story.blocks.forEach((b, i) => {
    const bEnd = (story.blocks[i + 1]?.off ?? story.text.length + 1) - 1; // offset of the paragraph mark
    if (start <= bEnd && (end > b.off || start === end) && end >= b.off) out.push(b);
  });
  return out;
}
