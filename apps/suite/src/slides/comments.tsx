import { t } from '@suitenova/core-ui';
import { newId, updateSlide, type Comment } from '@suitenova/slides-core';
import { useState } from 'react';
import type { SlidesCtl } from './ctl';
import type { SlidesUI } from './commands';
import { useUi } from './ribbonParts';

const AUTHOR_KEY = 'nova.slides.commentAuthor';

export function savedAuthor(ctl: SlidesCtl): string {
  try {
    return localStorage.getItem(AUTHOR_KEY) || ctl.deck.commentAuthors[0]?.name || '';
  } catch {
    return ctl.deck.commentAuthors[0]?.name ?? '';
  }
}
export function rememberAuthor(name: string): void {
  try {
    localStorage.setItem(AUTHOR_KEY, name);
  } catch {
    /* no storage */
  }
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join('') || '?';

function setComments(c: SlidesCtl, label: string, fn: (l: Comment[]) => Comment[], slideId = c.slide.id): void {
  c.apply(label, (d) => updateSlide(d, slideId, (s) => ({ ...s, comments: fn(s.comments ?? []) })));
}

export function addComment(c: SlidesCtl, text: string, author: string, replyTo?: string): string {
  const roots = (c.slide.comments ?? []).filter((x) => !x.replyTo);
  const parent = replyTo ? (c.slide.comments ?? []).find((x) => x.id === replyTo) : undefined;
  const cm: Comment = { id: newId('c'), author, initials: initials(author), text, at: Date.now(), x: parent?.x ?? 24 + roots.length * 28, y: parent?.y ?? 24, ...(replyTo ? { replyTo } : {}) };
  rememberAuthor(author);
  setComments(c, replyTo ? 'Responder al comentario' : 'Nuevo comentario', (l) => [...l, cm]);
  if (!c.deck.commentAuthors.some((a) => a.name === author)) c.apply('Autor de comentarios', (d) => ({ ...d, commentAuthors: [...d.commentAuthors, { name: author, initials: initials(author) }] }));
  c.selComment = replyTo ?? cm.id;
  c.touch();
  return cm.id;
}

export const toggleResolved = (c: SlidesCtl, id: string): void => setComments(c, 'Resolver el comentario', (l) => l.map((x) => (x.id === id ? { ...x, resolved: !x.resolved } : x)));
export const editComment = (c: SlidesCtl, id: string, text: string): void => setComments(c, 'Editar el comentario', (l) => l.map((x) => (x.id === id ? { ...x, text } : x)));
export function deleteThread(c: SlidesCtl, id: string): void {
  setComments(c, 'Eliminar el comentario', (l) => l.filter((x) => x.id !== id && x.replyTo !== id));
  if (c.selComment === id) c.selComment = null;
  c.touch();
}
export const moveComment = (c: SlidesCtl, id: string, x: number, y: number): void => setComments(c, 'Mover el comentario', (l) => l.map((q) => (q.id === id ? { ...q, x, y } : q)));

const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

/** The comments of the current slide as threads, with reply, resolve and delete. */
export function CommentsPane({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  const [reply, setReply] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [all, setAll] = useState(false);
  const author = savedAuthor(c) || t('Autor');
  const slides = all ? c.deck.slides.map((s, i) => ({ s, i })) : [{ s: c.slide, i: c.index }];
  const total = slides.reduce((n, { s }) => n + (s.comments ?? []).filter((x) => !x.replyTo).length, 0);

  return (
    <aside className="sl-pane sl-comments" aria-label={t('Comentarios')}>
      <header>
        <b>{t('Comentarios')}</b>
        <button type="button" aria-label={t('Cerrar el panel')} onClick={() => ((c.pane = 'none'), c.touch())}>×</button>
      </header>
      <div className="sl-comments__bar">
        <button type="button" onClick={() => ui.openDialog('comment')}>{t('Nuevo')}</button>
        <label className="sl-check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          {t('Todas las diapositivas')}
        </label>
      </div>
      {!total && <p className="sl-pane__empty">{all ? t('La presentación no tiene comentarios.') : t('Esta diapositiva no tiene comentarios.')}</p>}
      {slides.map(({ s, i }) => {
        const roots = (s.comments ?? []).filter((x) => !x.replyTo);
        if (!roots.length) return null;
        return (
          <section key={s.id}>
            {all && (
              <h3>
                <button type="button" className="sl-linklike" onClick={() => c.goTo(i)}>{t('Diapositiva {n}', { n: i + 1 })}</button>
              </h3>
            )}
            {roots.map((r) => {
              const replies = (s.comments ?? []).filter((x) => x.replyTo === r.id);
              const sel = c.selComment === r.id;
              return (
                <div key={r.id} className={`sl-thread${sel ? ' is-sel' : ''}${r.resolved ? ' is-done' : ''}`} onClick={() => ((c.selComment = r.id), c.touch())}>
                  {[r, ...replies].map((m) => (
                    <div key={m.id} className="sl-comment">
                      <div className="sl-comment__head">
                        <span className="sl-comment__av" aria-hidden="true">{m.initials ?? initials(m.author)}</span>
                        <b>{m.author}</b> <small>{when(m.at)}</small>
                      </div>
                      {editing?.id === m.id ? (
                        <>
                          <textarea aria-label={t('Editar el comentario')} value={editing.text} onChange={(e) => setEditing({ id: m.id, text: e.target.value })} />
                          <div className="sl-comment__btns">
                            <button type="button" onClick={() => (editComment(c, m.id, editing.text), setEditing(null))}>{t('Guardar')}</button>
                            <button type="button" onClick={() => setEditing(null)}>{t('Cancelar')}</button>
                          </div>
                        </>
                      ) : (
                        <p>{m.text}</p>
                      )}
                      {editing?.id !== m.id && (
                        <div className="sl-comment__btns">
                          <button type="button" onClick={() => setEditing({ id: m.id, text: m.text })}>{t('Editar')}</button>
                          {m.id !== r.id && <button type="button" onClick={() => setComments(c, 'Eliminar la respuesta', (l) => l.filter((x) => x.id !== m.id), s.id)}>{t('Eliminar')}</button>}
                        </div>
                      )}
                    </div>
                  ))}
                  {sel && (
                    <div className="sl-comment__reply">
                      <input aria-label={t('Responder')} placeholder={t('Responder…')} value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && reply.trim() && (addComment(c, reply.trim(), author, r.id), setReply(''))} />
                      <div className="sl-comment__btns">
                        <button type="button" disabled={!reply.trim()} onClick={() => (addComment(c, reply.trim(), author, r.id), setReply(''))}>{t('Responder')}</button>
                        <button type="button" onClick={() => toggleResolved(c, r.id)}>{r.resolved ? t('Reabrir') : t('Resolver')}</button>
                        <button type="button" onClick={() => deleteThread(c, r.id)}>{t('Eliminar el hilo')}</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </aside>
  );
}

/** The marks of the comments on the slide (on the stage). */
export function CommentMarks({ ctl, zoom }: { ctl: SlidesCtl; zoom: number }) {
  const roots = (ctl.slide.comments ?? []).filter((x) => !x.replyTo);
  return (
    <>
      {roots.map((cm, i) => (
        <button
          key={cm.id}
          type="button"
          className={`sl-cmark${ctl.selComment === cm.id ? ' is-sel' : ''}${cm.resolved ? ' is-done' : ''}`}
          style={{ left: cm.x, top: cm.y, width: 22 / zoom, height: 22 / zoom, fontSize: 11 / zoom }}
          aria-label={t('Comentario {n} de {a}', { n: i + 1, a: cm.author })}
          title={`${cm.author}: ${cm.text}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            ctl.selComment = cm.id;
            ctl.pane = 'comments';
            ctl.touch();
          }}
        >
          {i + 1}
        </button>
      ))}
    </>
  );
}
