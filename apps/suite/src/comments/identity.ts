// Who the person is, for the whole suite: the author of comments, of tracked changes and of notes. Writer, Slides and Calc each used to keep their
// own name; now there is one (as in Office, where the user name is the same in every program).
import { makeAuthor, type Author } from '@suitenova/comment-core';

export const USER_KEY = 'nova.user';
/** Where each product kept the name before there was one for all: read once so nobody has to type it again. */
const LEGACY = [
  { key: 'nova.writer.user', json: true },
  { key: 'nova.author', json: false },
  { key: 'nova.slides.commentAuthor', json: false },
] as const;

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const store = (): Store | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

const read = (s: Store, key: string): string | null => {
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
};

/** The person if the name was ever given (here or in an older version of a product), else null. */
export function savedUser(s: Store | null = store()): Author | null {
  if (s) {
    const own = read(s, USER_KEY);
    if (own) {
      try {
        const u = JSON.parse(own) as { name?: string; initials?: string; id?: string };
        if (u.name?.trim()) return makeAuthor(u.name, u.initials, u.id);
      } catch {
        /* damaged: look further */
      }
    }
    for (const l of LEGACY) {
      const raw = read(s, l.key);
      if (!raw) continue;
      try {
        const name = l.json ? ((JSON.parse(raw) as { name?: string }).name ?? '') : raw;
        const initials = l.json ? (JSON.parse(raw) as { initials?: string }).initials : undefined;
        if (name.trim()) return makeAuthor(name, initials);
      } catch {
        /* damaged: look further */
      }
    }
  }
  return null;
}

/** The person, or a generic «Autor» when the name was never given. */
export const getUser = (s: Store | null = store()): Author => savedUser(s) ?? makeAuthor('Autor');

export function setUser(u: { name: string; initials?: string }, s: Store | null = store()): Author {
  const a = makeAuthor(u.name, u.initials);
  try {
    s?.setItem(USER_KEY, JSON.stringify({ name: a.name, initials: a.initials, id: a.id }));
  } catch {
    /* no storage: the name only lasts until the page is closed */
  }
  return a;
}
