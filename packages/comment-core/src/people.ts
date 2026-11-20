import type { Author, Thread } from './model';

/** «Ana María Pérez» gives «AMP» (at most three letters). */
export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => [...w][0]!.toUpperCase())
    .join('');

const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** A stable id from the name, for people nobody gave an id: the same name is the same person. */
export const authorIdOf = (name: string): string => `local::${fold(name.trim()).replace(/\s+/g, ' ')}`;

/** An author from a name (and, if known, initials and id). */
export function makeAuthor(name: string, initials?: string, id?: string): Author {
  const n = name.trim() || 'Autor';
  return { id: id || authorIdOf(n), name: n, initials: (initials ?? '').trim() || initialsOf(n) };
}

export const sameAuthor = (a: Author, b: Author): boolean => a.id === b.id;

/** Everyone who wrote in the threads, in the order they first appear, with the most recent spelling of their name. */
export function authorsOf(threads: readonly Thread[]): Author[] {
  const seen = new Map<string, Author>();
  for (const t of threads) for (const m of t.messages) seen.set(m.author.id, m.author);
  return [...seen.values()];
}

export { fold };
