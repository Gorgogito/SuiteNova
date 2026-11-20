// Writer keeps its comments as the `.docx` holds them (a flat list: `CommentData`). The shared comment code works on threads: these two
// functions go from one to the other, so every operation is the shared one and the file format does not change.
import { flatFromThreads, makeAuthor, sortThreads, threadsFromFlat, type Thread } from '@suitenova/comment-core';
import type { CommentData } from '@suitenova/writer-core';

/** Where a comment is on the page: the start of its text, or null when its text is gone. */
export interface TextAnchor {
  from: number | null;
}

export function toThreads(comments: readonly CommentData[], ranges?: ReadonlyMap<string, { from: number; to: number }>): Thread<TextAnchor>[] {
  const threads = threadsFromFlat(
    comments.map((c) => ({
      id: c.id,
      author: makeAuthor(c.author, c.initials),
      date: c.date,
      text: c.text,
      parent: c.parent,
      resolved: c.done,
      ...(c.edited ? { edited: c.edited } : {}),
      anchor: { from: ranges?.get(c.id)?.from ?? null },
    })),
  );
  return sortThreads(threads, (a, b) => (a.from ?? 1e12) - (b.from ?? 1e12));
}

export function fromThreads(threads: readonly Thread<TextAnchor>[]): CommentData[] {
  return flatFromThreads(threads).map((f) => ({ id: f.id, author: f.author.name, initials: f.author.initials, date: f.date, text: f.text, parent: f.parent, done: !!f.resolved, ...(f.edited ? { edited: f.edited } : {}) }));
}
