import { deleteAll as deleteAllThreads, deleteMessage, deleteThread, editMessage, neighbor, reopen, resolve, type Thread } from '@suitenova/comment-core';
import { t } from '@suitenova/core-ui';
import { useState } from 'react';
import { CommentsPane as SharedPane, type CommentsHandlers } from '../comments/CommentsPane';
import { getUser } from '../comments/identity';
import '../comments/messages';
import type { SlidesCtl } from './ctl';
import type { SlidesUI } from './commands';
import { addComment, changeThreads, draftComment, slideOf, slideThreads, type SlideAnchor } from './comments-ops';
import { useUi } from './ribbonParts';

export * from './comments-ops';

const first = (th: Thread<SlideAnchor>) => th.messages[0]!.id;

/** The comments of the current slide (or of all of them) as threads, with the shared pane. */
export function CommentsPane({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  const [all, setAll] = useState(false);
  const threads = slideThreads(c, all);
  const msgThread = (id: string) => threads.find((x) => x.messages.some((m) => m.id === id));
  const onSlide = (id: string, label: string, f: Parameters<typeof changeThreads>[3]) => {
    const sid = slideOf(c, id);
    if (sid) changeThreads(c, sid, label, f);
  };

  const handlers: CommentsHandlers = {
    select: (id) => {
      const th = threads.find((x) => x.id === id);
      c.selComment = id;
      if (th && th.anchor.index !== c.index) c.goTo(th.anchor.index);
      else c.touch();
    },
    reply: (id, text) => void addComment(c, text, getUser(), id),
    startEdit: (id) => {
      c.editingComment = id;
      c.touch();
    },
    edit: (id, text) => {
      const was = msgThread(id)?.messages.find((m) => m.id === id)?.text ?? '';
      c.editingComment = null;
      if (!text) {
        if (!was) onSlide(id, 'Eliminar el comentario', (l) => deleteThread(l, id));
        else c.touch();
        return;
      }
      onSlide(id, 'Editar el comentario', (l) => editMessage(l, id, text));
      // writing the text of a new comment is part of creating it: one step of undo
      if (!was) c.mergeLastUndo();
      c.touch();
    },
    cancelEdit: (id) => {
      c.editingComment = null;
      if (!msgThread(id)?.messages.find((m) => m.id === id)?.text) onSlide(id, 'Eliminar el comentario', (l) => (l.some((x) => x.id === id) ? deleteThread(l, id) : deleteMessage(l, id)));
      else c.touch();
    },
    resolve: (id) => {
      onSlide(id, 'Resolver el comentario', (l) => resolve(l, id, getUser()));
      c.touch();
    },
    reopen: (id) => {
      onSlide(id, 'Reabrir el comentario', (l) => reopen(l, id));
      c.touch();
    },
    deleteMessage: (id) => onSlide(id, 'Eliminar la respuesta', (l) => deleteMessage(l, id)),
    deleteThread: (id) => {
      onSlide(id, 'Eliminar el comentario', (l) => deleteThread(l, id));
      if (c.selComment === id) c.selComment = null;
      c.touch();
    },
    deleteAll: (onlyResolved) => {
      for (const s of all ? c.deck.slides : [c.slide]) if (s.comments?.length) changeThreads(c, s.id, onlyResolved ? 'Eliminar los comentarios resueltos' : 'Eliminar todos los comentarios', (l) => deleteAllThreads(l, onlyResolved));
      c.selComment = null;
      c.touch();
    },
    step: (dir) => {
      const next = neighbor(threads, c.selComment, dir);
      if (next) handlers.select(next.id);
    },
  };

  return (
    <aside className="sl-pane sl-comments" aria-label={t('Comentarios')}>
      <header>
        <b>{t('Comentarios')}</b>
        <button type="button" aria-label={t('Cerrar el panel')} onClick={() => ((c.pane = 'none'), c.touch())}>×</button>
      </header>
      <div className="sl-comments__bar">
        <button type="button" onClick={() => draftComment(c)}>{t('Nuevo')}</button>
        <label className="sl-check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          {t('Todas las diapositivas')}
        </label>
      </div>
      <SharedPane
        threads={threads}
        me={getUser()}
        activeId={c.selComment}
        editingId={c.editingComment}
        empty={all ? t('La presentación no tiene comentarios.') : t('Esta diapositiva no tiene comentarios.')}
        anchorOf={all ? (th) => t('Diapositiva {n}', { n: th.anchor.index + 1 }) : undefined}
        handlers={handlers}
      />
    </aside>
  );
}

/** The marks of the comments on the slide (on the stage). */
export function CommentMarks({ ctl, zoom }: { ctl: SlidesCtl; zoom: number }) {
  const threads = slideThreads(ctl, false);
  return (
    <>
      {threads.map((th, i) => {
        const cm = th.messages[0]!;
        return (
          <button
            key={th.id}
            type="button"
            className={`sl-cmark${ctl.selComment === th.id ? ' is-sel' : ''}${th.resolved ? ' is-done' : ''}`}
            style={{ left: th.anchor.x, top: th.anchor.y, width: 22 / zoom, height: 22 / zoom, fontSize: 11 / zoom }}
            aria-label={t('Comentario {n} de {a}', { n: i + 1, a: cm.author.name })}
            title={`${cm.author.name}: ${cm.text}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              ctl.selComment = th.id;
              ctl.pane = 'comments';
              ctl.touch();
            }}
          >
            {i + 1}
          </button>
        );
      })}
    </>
  );
}

void first;
