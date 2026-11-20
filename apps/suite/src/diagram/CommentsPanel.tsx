import { deleteAll as deleteAllThreads, deleteMessage, deleteThread, editMessage, neighbor, reopen, reply, resolve } from '@suitenova/comment-core';
import { t } from '@suitenova/core-ui';
import { CommentsPane, type CommentsHandlers } from '../comments/CommentsPane';
import { getUser } from '../comments/identity';
import '../comments/messages';
import type { DiagramCtl } from './ctl';

/** The comments of the page with the shared pane; each says which shape it is about. */
export function CommentsPanel({ ctl }: { ctl: DiagramCtl }) {
  const threads = ctl.threadList();
  const me = getUser();
  const msgThread = (id: string) => threads.find((th) => th.messages.some((m) => m.id === id));
  const shapeName = (id?: string) => {
    if (!id) return t('La página');
    const s = ctl.basePage.shapes.find((x) => x.id === id);
    return s ? s.text.trim().split('\n')[0]!.slice(0, 40) || t('Forma sin texto') : t('Forma eliminada');
  };
  const handlers: CommentsHandlers = {
    select: (id) => {
      const th = threads.find((q) => q.id === id);
      ctl.selComment = id;
      if (th?.anchor.shape) ctl.setSelection([th.anchor.shape]);
      ctl.touch();
    },
    reply: (id, text) => ctl.changeThreads((l) => reply(l, id, me, text)),
    startEdit: (id) => {
      ctl.editingComment = id;
      ctl.touch();
    },
    edit: (id, text) => {
      const was = msgThread(id)?.messages.find((m) => m.id === id)?.text ?? '';
      ctl.editingComment = null;
      if (!text) {
        if (!was) ctl.changeThreads((l) => deleteThread(l, id));
        else ctl.touch();
        return;
      }
      ctl.changeThreads((l) => editMessage(l, id, text));
      // writing the text of a new comment is part of creating it: one step of undo
      if (!was) ctl.mergeLastUndo();
    },
    cancelEdit: (id) => {
      ctl.editingComment = null;
      if (!msgThread(id)?.messages.find((m) => m.id === id)?.text) ctl.changeThreads((l) => (l.some((q) => q.id === id) ? deleteThread(l, id) : deleteMessage(l, id)));
      else ctl.touch();
    },
    resolve: (id) => ctl.changeThreads((l) => resolve(l, id, me)),
    reopen: (id) => ctl.changeThreads((l) => reopen(l, id)),
    deleteMessage: (id) => ctl.changeThreads((l) => deleteMessage(l, id)),
    deleteThread: (id) => ctl.changeThreads((l) => deleteThread(l, id)),
    deleteAll: (onlyResolved) => ctl.changeThreads((l) => deleteAllThreads(l, onlyResolved)),
    step: (dir) => {
      const next = neighbor(threads, ctl.selComment, dir);
      if (next) handlers.select(next.id);
    },
  };
  return (
    <aside className="dg-side dg-comments" aria-label={t('Comentarios')}>
      <div className="dg-side__head">
        <b>{t('Comentarios')}</b>
        <button type="button" className="nv-btn nv-btn--small" aria-label={t('Cerrar')} onClick={() => ctl.togglePane('comments')}>
          ×
        </button>
      </div>
      <CommentsPane
        threads={threads}
        me={me}
        activeId={ctl.selComment}
        editingId={ctl.editingComment}
        empty={t('Esta página no tiene comentarios. Elija una forma y use «Nuevo comentario».')}
        anchorOf={(th) => shapeName(th.anchor.shape)}
        isLost={(th) => !!th.anchor.shape && !ctl.basePage.shapes.some((s) => s.id === th.anchor.shape)}
        handlers={handlers}
      />
    </aside>
  );
}
