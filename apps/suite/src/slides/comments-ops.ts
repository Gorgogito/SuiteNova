// The comments of Slides on the shared comment code. The deck keeps them as PowerPoint does (a flat list per slide, answers pointing at their comment);
// here they become threads, and every operation is the shared one.
import { addThread, reply, flatFromThreads, makeAuthor, threadsFromFlat, type Author, type FlatComment, type Thread } from '@suitenova/comment-core';
import { newId, updateSlide, type Comment } from '@suitenova/slides-core';
import { getUser, savedUser, setUser } from '../comments/identity';
import type { SlidesCtl } from './ctl';

/** Where a comment is: the slide and the place on it (points). */
export interface SlideAnchor {
  slideId: string;
  /** 0-based position of the slide. */
  index: number;
  x: number;
  y: number;
}

export function savedAuthor(ctl: SlidesCtl): string {
  return savedUser()?.name || ctl.deck.commentAuthors[0]?.name || '';
}
export function rememberAuthor(name: string): void {
  if (name.trim()) setUser({ name });
}

const toFlat = (cs: readonly Comment[], anchor: SlideAnchor): FlatComment<SlideAnchor>[] =>
  cs.map((c) => ({ id: c.id, author: makeAuthor(c.author, c.initials), date: new Date(c.at || 0).toISOString(), text: c.text, parent: c.replyTo ?? null, ...(c.resolved ? { resolved: true } : {}), anchor: { ...anchor, x: c.x, y: c.y } }));

/** The comments of the slide(s) as threads, in slide order and then in the order they were written. */
export function slideThreads(c: SlidesCtl, all: boolean): Thread<SlideAnchor>[] {
  const slides = all ? c.deck.slides.map((s, index) => ({ s, index })) : [{ s: c.slide, index: c.index }];
  return slides.flatMap(({ s, index }) => threadsFromFlat(toFlat(s.comments ?? [], { slideId: s.id, index, x: 0, y: 0 })));
}

const fromFlat = (flat: readonly FlatComment<SlideAnchor>[], old: readonly Comment[]): Comment[] =>
  flat.map((f) => {
    const was = old.find((o) => o.id === f.id);
    return {
      id: f.id,
      author: f.author.name,
      initials: f.author.initials,
      text: f.text,
      at: Date.parse(f.date) || was?.at || Date.now(),
      x: f.anchor.x,
      y: f.anchor.y,
      ...(f.resolved ? { resolved: true } : {}),
      ...(f.parent ? { replyTo: f.parent } : {}),
    };
  });

/** Change the threads of one slide with a shared operation (one step of undo). */
export function changeThreads(c: SlidesCtl, slideId: string, label: string, f: (l: Thread<SlideAnchor>[]) => Thread<SlideAnchor>[]): void {
  const idx = c.deck.slides.findIndex((s) => s.id === slideId);
  if (idx < 0) return;
  const old = c.deck.slides[idx]!.comments ?? [];
  const anchor: SlideAnchor = { slideId, index: idx, x: 0, y: 0 };
  const next = f(threadsFromFlat(toFlat(old, anchor)));
  c.apply(label, (d) => updateSlide(d, slideId, (s) => ({ ...s, comments: fromFlat(flatFromThreads(next), old) })));
}

/** The slide a thread or message is on. */
export const slideOf = (c: SlidesCtl, id: string): string | undefined => c.deck.slides.find((s) => (s.comments ?? []).some((x) => x.id === id))?.id;

/** Add a comment, or a reply to one (`replyTo`). Returns its id. */
export function addComment(c: SlidesCtl, text: string, author: string | Author, replyTo?: string): string {
  const who = typeof author === 'string' ? makeAuthor(author) : author;
  const slideId = replyTo ? (slideOf(c, replyTo) ?? c.slide.id) : c.slide.id;
  const slide = c.deck.slides.find((s) => s.id === slideId)!;
  const roots = (slide.comments ?? []).filter((x) => !x.replyTo);
  const parent = replyTo ? (slide.comments ?? []).find((x) => x.id === replyTo) : undefined;
  const id = newId('c');
  // an answer to an answer belongs to the comment the thread started with
  let rootId = replyTo ?? '';
  for (let n = 0; n < 50; n++) {
    const up = (slide.comments ?? []).find((x) => x.id === rootId)?.replyTo;
    if (!up) break;
    rootId = up;
  }
  rememberAuthor(who.name);
  changeThreads(c, slideId, replyTo ? 'Responder al comentario' : 'Nuevo comentario', (l) => {
    if (replyTo) return reply(l, rootId, who, text, undefined, id);
    return addThread(l, { id, anchor: { slideId, index: c.deck.slides.indexOf(slide), x: parent?.x ?? 24 + roots.length * 28, y: parent?.y ?? 24 }, author: who, text }).list;
  });
  if (!c.deck.commentAuthors.some((a) => a.name === who.name)) c.apply('Autor de comentarios', (d) => ({ ...d, commentAuthors: [...d.commentAuthors, { name: who.name, initials: who.initials }] }));
  c.selComment = replyTo ? rootId : id;
  c.touch();
  return id;
}

/** «Comentario nuevo»: an empty comment that is written in the pane; sent empty, it is dropped. */
export function draftComment(c: SlidesCtl): void {
  const id = addComment(c, '', getUser());
  c.editingComment = id;
  c.pane = 'comments';
  c.touch();
}

export const moveComment = (c: SlidesCtl, id: string, x: number, y: number): void => {
  const sid = slideOf(c, id);
  if (sid) c.apply('Mover el comentario', (d) => updateSlide(d, sid, (s) => ({ ...s, comments: (s.comments ?? []).map((q) => (q.id === id ? { ...q, x, y } : q)) })));
};
