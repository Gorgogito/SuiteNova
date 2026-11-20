import type { Author, Message, Thread, ThreadFilter } from './model';
import { fold } from './people';

/** Everything here returns new lists and threads; nothing is changed in place. */

let counter = 0;
/** A new id that does not repeat within the session or between people. */
export const newId = (prefix = 'c'): string => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export interface NewComment<A> {
  anchor: A;
  author: Author;
  text: string;
  /** ISO date; now if missing. */
  date?: string;
  id?: string;
}

const now = (d?: string): string => d ?? new Date().toISOString();

export function addThread<A>(list: readonly Thread<A>[], c: NewComment<A>): { list: Thread<A>[]; thread: Thread<A> } {
  const id = c.id ?? newId();
  const thread: Thread<A> = { id, anchor: c.anchor, messages: [{ id, author: c.author, date: now(c.date), text: c.text }], resolved: false };
  return { list: [...list, thread], thread };
}

/** Answer a thread. Answering a resolved thread opens it again (as Office does). */
export function reply<A>(list: readonly Thread<A>[], threadId: string, author: Author, text: string, date?: string, id?: string): Thread<A>[] {
  return list.map((t) => {
    if (t.id !== threadId) return t;
    const { resolvedBy: _b, resolvedAt: _a, ...rest } = t;
    return { ...rest, resolved: false, messages: [...t.messages, { id: id ?? newId('r'), author, date: now(date), text }] };
  });
}

/** Change the text of one message (the comment or a reply). Nothing changes if the text is the same. */
export function editMessage<A>(list: readonly Thread<A>[], messageId: string, text: string, date?: string): Thread<A>[] {
  return list.map((t) => ({
    ...t,
    messages: t.messages.map((m): Message => (m.id === messageId && m.text !== text ? { ...m, text, edited: now(date) } : m)),
  }));
}

/** Delete a reply; deleting the comment itself deletes the whole thread. */
export function deleteMessage<A>(list: readonly Thread<A>[], messageId: string): Thread<A>[] {
  return list.flatMap((t) => {
    if (t.messages[0]?.id === messageId) return [];
    return [{ ...t, messages: t.messages.filter((m) => m.id !== messageId) }];
  });
}

export const deleteThread = <A>(list: readonly Thread<A>[], threadId: string): Thread<A>[] => list.filter((t) => t.id !== threadId);

export function resolve<A>(list: readonly Thread<A>[], threadId: string, by?: Author, date?: string): Thread<A>[] {
  return list.map((t) => (t.id === threadId && !t.resolved ? { ...t, resolved: true, ...(by ? { resolvedBy: by } : {}), resolvedAt: now(date) } : t));
}

export function reopen<A>(list: readonly Thread<A>[], threadId: string): Thread<A>[] {
  return list.map((t) => {
    if (t.id !== threadId || !t.resolved) return t;
    const { resolvedBy: _b, resolvedAt: _a, ...rest } = t;
    return { ...rest, resolved: false };
  });
}

/** Move or change the anchors (the text moved, the cell was inserted, the shape was resized). Returning `null` deletes the thread. */
export function mapAnchors<A, B>(list: readonly Thread<A>[], f: (anchor: A, thread: Thread<A>) => B | null): Thread<B>[] {
  return list.flatMap((t) => {
    const anchor = f(t.anchor, t);
    return anchor === null ? [] : [{ ...t, anchor }];
  });
}

/** Delete every thread, or only the resolved ones. */
export const deleteAll = <A>(list: readonly Thread<A>[], onlyResolved = false): Thread<A>[] => (onlyResolved ? list.filter((t) => !t.resolved) : []);

export function filterThreads<A>(list: readonly Thread<A>[], f: ThreadFilter): Thread<A>[] {
  const q = f.text ? fold(f.text) : '';
  return list.filter((t) => {
    if (f.state === 'open' && t.resolved) return false;
    if (f.state === 'resolved' && !t.resolved) return false;
    if (f.authorId && !t.messages.some((m) => m.author.id === f.authorId)) return false;
    if (q && !t.messages.some((m) => fold(m.text).includes(q) || fold(m.author.name).includes(q))) return false;
    return true;
  });
}

/** In the order the product puts its anchors (position in the text, slide and place, row and column…); ties keep the order of the list. */
export function sortThreads<A>(list: readonly Thread<A>[], compare: (a: A, b: A) => number): Thread<A>[] {
  return list.map((t, i) => ({ t, i })).sort((x, y) => compare(x.t.anchor, y.t.anchor) || x.i - y.i).map((x) => x.t);
}

/** The thread after or before the current one, going round at the ends; the first (or last) when there is no current one. */
export function neighbor<A>(list: readonly Thread<A>[], currentId: string | null | undefined, dir: 1 | -1): Thread<A> | undefined {
  if (!list.length) return undefined;
  const i = list.findIndex((t) => t.id === currentId);
  if (i < 0) return dir === 1 ? list[0] : list[list.length - 1];
  return list[(i + dir + list.length) % list.length];
}

export interface Counts {
  threads: number;
  open: number;
  resolved: number;
  /** Comments and replies. */
  messages: number;
}

export function count(list: readonly Thread[]): Counts {
  const resolved = list.filter((t) => t.resolved).length;
  return { threads: list.length, open: list.length - resolved, resolved, messages: list.reduce((n, t) => n + t.messages.length, 0) };
}

export const findThread = <A>(list: readonly Thread<A>[], id: string): Thread<A> | undefined => list.find((t) => t.id === id || t.messages.some((m) => m.id === id));
