import type { Author, Thread } from './model';

/**
 * The flat shape every Office file uses: a list of comments where an answer points at the comment it answers. Each product turns its own
 * records into this (and back), so the threads are built in one place.
 */
export interface FlatComment<A = unknown> {
  id: string;
  author: Author;
  date: string;
  text: string;
  /** The comment this one answers; null for the comment itself. */
  parent: string | null;
  /** Resolved. Only the first comment of a thread counts; a reply carrying it is read as the same. */
  resolved?: boolean;
  /** The anchor of a comment. Replies take the anchor of their thread. */
  anchor: A;
}

/**
 * Group a flat list into threads, in the order the comments come. An answer to an answer joins the thread of the first comment; an answer
 * whose comment is missing (a damaged file) becomes a comment of its own, so nothing is lost.
 */
export function threadsFromFlat<A>(flat: readonly FlatComment<A>[]): Thread<A>[] {
  const byId = new Map(flat.map((c) => [c.id, c]));
  const rootOf = (c: FlatComment<A>): string => {
    let cur = c;
    const seen = new Set([c.id]);
    while (cur.parent && byId.has(cur.parent)) {
      const next = byId.get(cur.parent)!;
      if (seen.has(next.id)) break; // a loop in a damaged file: stop anywhere in it
      seen.add(next.id);
      cur = next;
    }
    return cur.id;
  };
  const threads = new Map<string, Thread<A>>();
  for (const c of flat) {
    const root = rootOf(c);
    let t = threads.get(root);
    if (!t) {
      const r = byId.get(root)!;
      t = { id: root, anchor: r.anchor, messages: [], resolved: false };
      threads.set(root, t);
    }
    t.messages.push({ id: c.id, author: c.author, date: c.date, text: c.text });
    if (c.resolved && (c.id === root || !t.resolved)) t.resolved = true;
  }
  for (const t of threads.values()) {
    // the comment first, then the answers by date (the list order breaks ties)
    const [first, ...rest] = t.messages.sort((a, b) => (a.id === t.id ? -1 : b.id === t.id ? 1 : 0));
    t.messages = [first!, ...rest.map((m, i) => ({ m, i })).sort((a, b) => a.m.date.localeCompare(b.m.date) || a.i - b.i).map((x) => x.m)];
  }
  return [...threads.values()];
}

/** Flatten threads into the list Office files use: each comment, then its answers pointing at it. */
export function flatFromThreads<A>(threads: readonly Thread<A>[]): FlatComment<A>[] {
  return threads.flatMap((t) =>
    t.messages.map((m, i): FlatComment<A> => ({
      id: m.id,
      author: m.author,
      date: m.date,
      text: m.text,
      parent: i === 0 ? null : t.messages[0]!.id,
      ...(t.resolved ? { resolved: true } : {}),
      anchor: t.anchor,
    })),
  );
}
