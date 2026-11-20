// The conversations of Calc (comments with replies) on the shared comment code. The sheet keeps them as plain data (`CellThread`); here they become
// threads of the shared model and every operation is the shared one.
import { makeAuthor, type Thread } from '@suitenova/comment-core';
import type { CellThread, ThreadMessage } from '@suitenova/calc-engine';

/** Where a conversation is: its cell. */
export interface CellAnchor {
  row: number;
  col: number;
}

const toMessage = (m: ThreadMessage) => ({ id: m.id, author: makeAuthor(m.author, m.initials), date: m.date, text: m.text, ...(m.edited ? { edited: m.edited } : {}) });

export const toCore = (threads: readonly CellThread[]): Thread<CellAnchor>[] =>
  threads.map((t) => ({
    id: t.id,
    anchor: { row: t.row, col: t.col },
    messages: t.messages.map(toMessage),
    resolved: !!t.resolved,
    ...(t.resolvedBy ? { resolvedBy: makeAuthor(t.resolvedBy) } : {}),
  }));

export const fromCore = (threads: readonly Thread<CellAnchor>[]): CellThread[] =>
  threads.map((t) => ({
    id: t.id,
    row: t.anchor.row,
    col: t.anchor.col,
    messages: t.messages.map((m) => ({ id: m.id, author: m.author.name, initials: m.author.initials, date: m.date, text: m.text, ...(m.edited ? { edited: m.edited } : {}) })),
    ...(t.resolved ? { resolved: true } : {}),
    ...(t.resolvedBy ? { resolvedBy: t.resolvedBy.name } : {}),
  }));

/** Reading order of the cells: by row, then by column. */
export const byCell = (a: CellAnchor, b: CellAnchor): number => a.row - b.row || a.col - b.col;
