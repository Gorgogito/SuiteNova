import { t } from '@suitenova/core-ui';
import { useState, useSyncExternalStore } from 'react';
import type { WriterCtl } from './doc';
import { CommentsPane, type CommentsHandlers } from '../comments/CommentsPane';
import '../comments/messages';
import { applyChanges, getUser, listChanges, selectChange, type Change } from './review';

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/** Right-hand pane with the comments (threads) and the tracked changes of the document. */
export function ReviewPane({ ctl }: { ctl: WriterCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  return (
    <aside className="nw-review" aria-label={t('Revisión')}>
      <header>
        <div className="nw-review-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={ctl.reviewTab === 'comments'} onClick={() => { ctl.reviewTab = 'comments'; ctl.touch(); }}>
            {t('Comentarios')} ({ctl.comments.filter((c) => !c.parent).length})
          </button>
          <button type="button" role="tab" aria-selected={ctl.reviewTab === 'changes'} onClick={() => { ctl.reviewTab = 'changes'; ctl.touch(); }}>
            {t('Revisiones')} ({ctl.mainView ? listChanges(ctl.body).length : 0})
          </button>
        </div>
        <button type="button" className="nv-btn nv-btn--small" onClick={() => { ctl.showReview = false; ctl.touch(); }} aria-label={t('Cerrar')} title={t('Cerrar')}>
          ✕
        </button>
      </header>
      {ctl.reviewTab === 'comments' ? <Comments ctl={ctl} /> : <Changes ctl={ctl} />}
    </aside>
  );
}

function Comments({ ctl }: { ctl: WriterCtl }) {
  const threads = ctl.threadList();
  const find = (messageId: string) => ctl.comments.find((c) => c.id === messageId);
  const handlers: CommentsHandlers = {
    select: (id) => ctl.goToComment(id),
    reply: (id, text) => ctl.replyTo(id, text),
    startEdit: (id) => {
      ctl.editingComment = id;
      ctl.touch();
    },
    edit: (id, text) => {
      const was = find(id)?.text ?? '';
      ctl.editingComment = null;
      // sending nothing: a comment that never had text is dropped, one that had keeps it
      if (!text) {
        if (!was) ctl.deleteComment(id);
        else ctl.touch();
        return;
      }
      ctl.editComment(id, text);
    },
    cancelEdit: (id) => {
      ctl.editingComment = null;
      if (!find(id)?.text) ctl.deleteComment(id);
      else ctl.touch();
    },
    resolve: (id) => ctl.resolveComment(id, true),
    reopen: (id) => ctl.resolveComment(id, false),
    deleteMessage: (id) => ctl.deleteComment(id),
    deleteThread: (id) => ctl.deleteComment(id),
    deleteAll: (onlyResolved) => ctl.deleteAllComments(onlyResolved),
    step: (dir) => ctl.stepComment(dir),
  };
  return (
    <CommentsPane
      threads={threads}
      me={getUser()}
      activeId={ctl.activeComment}
      editingId={ctl.editingComment}
      readOnly={ctl.readOnly}
      empty={t('No hay comentarios. Seleccione texto y use "Nuevo comentario".')}
      anchorOf={(th) => ctl.commentQuote(th.id) || null}
      isLost={(th) => th.anchor.from === null}
      handlers={handlers}
    />
  );
}

function Changes({ ctl }: { ctl: WriterCtl }) {
  const all = ctl.mainView ? listChanges(ctl.body) : [];
  const [who, setWho] = useState('');
  if (!all.length) return <p className="nw-review-empty">{t('No hay cambios controlados.')}</p>;
  const reviewers = [...new Set(all.map((c) => c.author))];
  // a reviewer who has no changes left is no longer a filter
  const sel = reviewers.includes(who) ? who : '';
  const changes = sel ? all.filter((c) => c.author === sel) : all;
  const label = (c: Change) => (c.kind === 'ins' ? t('Insertado') : c.kind === 'del' ? t('Eliminado') : c.kind === 'fmt' ? t('Formato') : c.kind === 'pins' ? t('Párrafo insertado') : t('Párrafo eliminado'));
  return (
    <>
    {reviewers.length > 0 && (
      <div className="nw-review-filter">
        <select aria-label={t('Revisor')} value={sel} onChange={(e) => setWho(e.target.value)}>
          <option value="">{t('Todos los revisores')}</option>
          {reviewers.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {!ctl.readOnly && sel && (
          <>
            <button type="button" className="nv-btn nv-btn--small" onClick={() => ctl.mainView && applyChanges(ctl.mainView, changes, true)}>
              {t('Aceptar los de {name}', { name: sel })}
            </button>
            <button type="button" className="nv-btn nv-btn--small" onClick={() => ctl.mainView && applyChanges(ctl.mainView, changes, false)}>
              {t('Rechazar los de {name}', { name: sel })}
            </button>
          </>
        )}
      </div>
    )}
    <ul className="nw-threads">
      {changes.map((c, i) => (
        <li key={`${c.kind}${c.id}${i}`} className="nw-thread" onClick={() => ctl.mainView && selectChange(ctl.mainView, c)}>
          <div className="nw-card">
            <div className="nw-card-head">
              <span className={`nw-chg nw-chg-${c.kind}`}>{label(c)}</span>
              <span>
                <strong>{c.author}</strong>
                <small>{fmtDate(c.date)}</small>
              </span>
            </div>
            <p className="nw-card-text nw-chg-text">{c.text.length > 120 ? c.text.slice(0, 117) + '…' : c.text}</p>
            {!ctl.readOnly && (
              <div className="nw-thread-actions" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="nv-btn nv-btn--small" onClick={() => ctl.mainView && applyChanges(ctl.mainView, [c], true)}>
                  {t('Aceptar')}
                </button>
                <button type="button" className="nv-btn nv-btn--small" onClick={() => ctl.mainView && applyChanges(ctl.mainView, [c], false)}>
                  {t('Rechazar')}
                </button>
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
    </>
  );
}
