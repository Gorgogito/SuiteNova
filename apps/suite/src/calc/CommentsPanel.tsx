import { deleteAll as deleteAllThreads, deleteMessage, deleteThread, editMessage, neighbor, reopen, reply, resolve } from '@suitenova/comment-core';
import { formatA1 } from '@suitenova/calc-engine';
import { t } from '@suitenova/core-ui';
import { CommentsPane, type CommentsHandlers } from '../comments/CommentsPane';
import { getUser } from '../comments/identity';
import '../comments/messages';
import type { CalcUI } from './commands';

/** The conversations of the sheet (Excel's «comentarios») with the shared pane. */
export function CommentsPanel({ ui }: { ui: CalcUI }) {
  const d = ui.doc;
  const x = d.x;
  const threads = x.threadList();
  const msgThread = (id: string) => threads.find((th) => th.messages.some((m) => m.id === id));
  const me = getUser();
  const active = x.threadAtActive()?.id ?? null;
  const handlers: CommentsHandlers = {
    select: (id) => {
      const th = threads.find((q) => q.id === id);
      if (th) d.selectCell(th.anchor.row, th.anchor.col);
    },
    reply: (id, text) => x.changeThreads('Responder al comentario', (l) => reply(l, id, me, text)),
    startEdit: (id) => {
      x.editingComment = id;
      d.touch();
    },
    edit: (id, text) => {
      const was = msgThread(id)?.messages.find((m) => m.id === id)?.text ?? '';
      x.editingComment = null;
      if (!text) {
        if (!was) x.changeThreads('Eliminar el comentario', (l) => deleteThread(l, id));
        else d.touch();
        return;
      }
      x.changeThreads('Editar el comentario', (l) => editMessage(l, id, text));
      // writing the text of a new comment is part of creating it: one step of undo
      if (!was) d.mergeLastUndo();
    },
    cancelEdit: (id) => {
      x.editingComment = null;
      if (!msgThread(id)?.messages.find((m) => m.id === id)?.text) x.changeThreads('Eliminar el comentario', (l) => (l.some((q) => q.id === id) ? deleteThread(l, id) : deleteMessage(l, id)));
      else d.touch();
    },
    resolve: (id) => x.changeThreads('Resolver el comentario', (l) => resolve(l, id, me)),
    reopen: (id) => x.changeThreads('Reabrir el comentario', (l) => reopen(l, id)),
    deleteMessage: (id) => x.changeThreads('Eliminar la respuesta', (l) => deleteMessage(l, id)),
    deleteThread: (id) => x.changeThreads('Eliminar el comentario', (l) => deleteThread(l, id)),
    deleteAll: (onlyResolved) => x.changeThreads(onlyResolved ? 'Eliminar los comentarios resueltos' : 'Eliminar todos los comentarios', (l) => deleteAllThreads(l, onlyResolved)),
    step: (dir) => {
      const next = neighbor(threads, active, dir);
      if (next) handlers.select(next.id);
    },
  };
  return (
    <aside className="calc-comments" aria-label={t('Comentarios')}>
      <header>
        <b>{t('Comentarios')}</b>
        <button type="button" aria-label={t('Cerrar el panel')} onClick={() => ((x.commentsPane = false), d.touch())}>
          ×
        </button>
      </header>
      <CommentsPane
        threads={threads}
        me={me}
        activeId={active}
        editingId={x.editingComment}
        empty={t('Esta hoja no tiene comentarios. Elija una celda y use «Nuevo comentario».')}
        anchorOf={(th) => formatA1(th.anchor.row, th.anchor.col)}
        handlers={handlers}
      />
    </aside>
  );
}
