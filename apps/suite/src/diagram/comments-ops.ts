// The comments of Diagram on the shared comment code. The page keeps them as plain data (`CommentThread`); here they become threads of the shared model.
import { makeAuthor, type Thread } from '@suitenova/comment-core';
import type { CommentThread } from '@suitenova/diagram-core';

/** What a comment is about: a shape, or the page when there is none. */
export interface ShapeAnchor {
  shape?: string;
}

export const toCore = (threads: readonly CommentThread[] = []): Thread<ShapeAnchor>[] =>
  threads.map((t) => ({
    id: t.id,
    anchor: t.shape ? { shape: t.shape } : {},
    messages: t.messages.map((m) => ({ id: m.id, author: makeAuthor(m.author, m.initials), date: m.date, text: m.text, ...(m.edited ? { edited: m.edited } : {}) })),
    resolved: !!t.resolved,
    ...(t.resolvedBy ? { resolvedBy: makeAuthor(t.resolvedBy) } : {}),
  }));

export const fromCore = (threads: readonly Thread<ShapeAnchor>[]): CommentThread[] =>
  threads.map((t) => ({
    id: t.id,
    ...(t.anchor.shape ? { shape: t.anchor.shape } : {}),
    messages: t.messages.map((m) => ({ id: m.id, author: m.author.name, initials: m.author.initials, date: m.date, text: m.text, ...(m.edited ? { edited: m.edited } : {}) })),
    ...(t.resolved ? { resolved: true } : {}),
    ...(t.resolvedBy ? { resolvedBy: t.resolvedBy.name } : {}),
  }));
