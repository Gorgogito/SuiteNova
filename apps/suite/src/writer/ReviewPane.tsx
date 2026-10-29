import { t } from '@suitenova/core-ui';
import { useState, useSyncExternalStore } from 'react';
import type { WriterCtl } from './doc';
import { applyChanges, listChanges, selectChange, type Change } from './review';

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
  const threads = ctl.threads();
  const [reply, setReply] = useState<Record<string, string>>({});
  const canEdit = !ctl.readOnly;
  if (!threads.length) return <p className="nw-review-empty">{t('No hay comentarios. Seleccione texto y use "Nuevo comentario".')}</p>;
  return (
    <ul className="nw-threads">
      {threads.map(({ root, replies, from }) => {
        const active = ctl.activeComment === root.id;
        const editing = ctl.editingComment === root.id;
        return (
          <li key={root.id} className={`nw-thread${active ? ' is-active' : ''}${root.done ? ' is-done' : ''}${from === null ? ' is-orphan' : ''}`} onClick={() => ctl.goToComment(root.id)}>
            <Card ctl={ctl} c={root} editing={editing} />
            {replies.map((r) => (
              <div key={r.id} className="nw-reply">
                <Card ctl={ctl} c={r} editing={ctl.editingComment === r.id} />
              </div>
            ))}
            {active && canEdit && !editing && (
              <div className="nw-thread-actions" onClick={(e) => e.stopPropagation()}>
                <input
                  className="nw-reply-input"
                  placeholder={t('Responder')}
                  aria-label={t('Responder')}
                  value={reply[root.id] ?? ''}
                  onChange={(e) => setReply({ ...reply, [root.id]: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (reply[root.id] ?? '').trim()) {
                      ctl.replyTo(root.id, reply[root.id]!.trim());
                      setReply({ ...reply, [root.id]: '' });
                    }
                  }}
                />
                <button type="button" className="nv-btn nv-btn--small" onClick={() => ctl.resolveComment(root.id, !root.done)}>
                  {root.done ? t('Reabrir') : t('Resolver')}
                </button>
                <button type="button" className="nv-btn nv-btn--small" onClick={() => ctl.deleteComment(root.id)}>
                  {t('Eliminar')}
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Card({ ctl, c, editing }: { ctl: WriterCtl; c: WriterCtl['comments'][number]; editing: boolean }) {
  const [text, setText] = useState(c.text);
  const done = () => {
    ctl.editComment(c.id, text.trim());
    ctl.editingComment = null;
    // an empty new comment is dropped
    if (!text.trim() && !c.text) ctl.deleteComment(c.id);
    else ctl.touch();
  };
  return (
    <div className="nw-card" onClick={(e) => editing && e.stopPropagation()}>
      <div className="nw-card-head">
        <span className="nw-avatar" aria-hidden="true">
          {c.initials || c.author.slice(0, 1)}
        </span>
        <span>
          <strong>{c.author}</strong>
          <small>{fmtDate(c.date)}</small>
        </span>
        {c.done && <span className="nw-done">{t('Resuelto')}</span>}
      </div>
      {editing ? (
        <div>
          <textarea
            autoFocus
            className="nw-card-edit"
            aria-label={t('Texto del comentario')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) done();
              if (e.key === 'Escape') {
                setText(c.text);
                ctl.editingComment = null;
                if (!c.text) ctl.deleteComment(c.id);
                else ctl.touch();
              }
            }}
          />
          <button type="button" className="nv-btn nv-btn--small" onClick={done}>
            {t('Publicar')}
          </button>
        </div>
      ) : (
        <p
          className="nw-card-text"
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (!ctl.readOnly) {
              ctl.editingComment = c.id;
              ctl.touch();
            }
          }}
        >
          {c.text}
        </p>
      )}
    </div>
  );
}

function Changes({ ctl }: { ctl: WriterCtl }) {
  const changes = ctl.mainView ? listChanges(ctl.body) : [];
  if (!changes.length) return <p className="nw-review-empty">{t('No hay cambios controlados.')}</p>;
  const label = (c: Change) => (c.kind === 'ins' ? t('Insertado') : c.kind === 'del' ? t('Eliminado') : c.kind === 'pins' ? t('Párrafo insertado') : t('Párrafo eliminado'));
  return (
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
  );
}
