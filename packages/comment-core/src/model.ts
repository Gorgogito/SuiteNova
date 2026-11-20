/*
 * Shared model of comments. A product keeps its own anchor (a text range in Writer, a slide position in Slides, a cell in Calc, a shape in
 * Diagram); everything else (who wrote it, when, the replies, resolved) is the same everywhere, as in Office.
 */

/** Who writes a comment. The `id` is stable for the same person (Office keeps people apart from their names). */
export interface Author {
  id: string;
  name: string;
  initials: string;
}

/** One message of a thread: the comment itself or a reply. */
export interface Message {
  id: string;
  author: Author;
  /** ISO date. */
  date: string;
  /** Plain text; paragraphs are separated by newlines. People are mentioned as `@Name`. */
  text: string;
  /** ISO date of the last edit, when it was edited. */
  edited?: string;
}

/** A comment with its replies. The first message is the comment; the others are answers, oldest first. */
export interface Thread<A = unknown> {
  id: string;
  anchor: A;
  messages: Message[];
  /** Marked as done (Word's «Resolver», Excel's and PowerPoint's too). */
  resolved: boolean;
  resolvedBy?: Author;
  /** ISO date it was resolved. */
  resolvedAt?: string;
}

export type ThreadFilter = {
  state?: 'all' | 'open' | 'resolved';
  /** Only threads where this person wrote something. */
  authorId?: string;
  /** Text contained in any message (without regard to case or accents). */
  text?: string;
};
