import type { Author } from './model';
import { fold } from './people';

/**
 * Mentions: `@Name` in the text of a comment. The text stays plain (so every file format can hold it); the people are found by looking for
 * the names of the people the document knows.
 */

interface Found {
  author: Author;
  start: number;
  end: number;
}

const isWordChar = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}_]/u.test(c);

/** The mentions in a text, in order. The longest name wins («@Ana María» over «@Ana»); case and accents do not matter. */
export function findMentions(text: string, people: readonly Author[]): Found[] {
  const folded = fold(text);
  // fold() can change the length of a text (decomposed letters); when it does, positions cannot be matched, so compare on the original
  const same = folded.length === text.length;
  const hay = same ? folded : text.toLowerCase();
  const sorted = [...people].sort((a, b) => b.name.length - a.name.length);
  const out: Found[] = [];
  for (let i = 0; i < hay.length; i++) {
    if (hay[i] !== '@' || isWordChar(text[i - 1])) continue;
    for (const p of sorted) {
      const name = same ? fold(p.name) : p.name.toLowerCase();
      if (name && hay.startsWith(name, i + 1) && !isWordChar(text[i + 1 + name.length])) {
        out.push({ author: p, start: i, end: i + 1 + name.length });
        i += name.length;
        break;
      }
    }
  }
  return out;
}

/** The distinct people mentioned. */
export function mentionedAuthors(text: string, people: readonly Author[]): Author[] {
  const seen = new Map<string, Author>();
  for (const m of findMentions(text, people)) seen.set(m.author.id, m.author);
  return [...seen.values()];
}

/** The text being typed after an `@` at the caret, or null when the caret is not in a mention. */
export function mentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0 || isWordChar(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.includes('\n') || query.length > 40) return null;
  return { query, start: at };
}

/** People whose name starts with, or has a word that starts with, what was typed; those who start with it first. */
export function suggestMentions(query: string, people: readonly Author[], max = 8): Author[] {
  const q = fold(query.trim());
  const rank = (a: Author): number => {
    const n = fold(a.name);
    if (!q || n.startsWith(q)) return 0;
    return n.split(/\s+/).some((w) => w.startsWith(q)) ? 1 : 2;
  };
  return people.filter((a) => rank(a) < 2).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, max);
}

/** The text with the mention being typed completed (`@An` becomes `@Ana María `); returns the new text and caret. */
export function completeMention(text: string, caret: number, author: Author): { text: string; caret: number } | null {
  const q = mentionQuery(text, caret);
  if (!q) return null;
  const insert = `@${author.name} `;
  return { text: text.slice(0, q.start) + insert + text.slice(caret), caret: q.start + insert.length };
}
