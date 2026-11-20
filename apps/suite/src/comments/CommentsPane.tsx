import { authorsOf, count, filterThreads, findMentions, fullWhen, whenText, type Author, type Message, type Thread, type ThreadFilter } from '@suitenova/comment-core';
import { t, useLocale } from '@suitenova/core-ui';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { MentionInput } from './MentionInput';
import './comments.css';

export interface CommentsHandlers {
  select(threadId: string): void;
  reply(threadId: string, text: string): void;
  startEdit(messageId: string): void;
  /** Send the edited text of a message. */
  edit(messageId: string, text: string): void;
  /** Leave the box without sending (the product drops a comment that never had text). */
  cancelEdit(messageId: string): void;
  resolve(threadId: string): void;
  reopen(threadId: string): void;
  deleteMessage(messageId: string, threadId: string): void;
  deleteThread(threadId: string): void;
  /** Delete every comment, or only the resolved ones. */
  deleteAll(onlyResolved: boolean): void;
  step(dir: 1 | -1): void;
}

const hue = (id: string): number => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export const Avatar = ({ a }: { a: Author }) => (
  <span className="nv-cm-avatar" aria-hidden="true" style={{ background: `hsl(${hue(a.id)} 45% 38%)` }}>
    {a.initials}
  </span>
);

/** The text of a message with the people it mentions marked. */
export function MessageText({ text, people }: { text: string; people: readonly Author[] }): ReactNode {
  const found = findMentions(text, people);
  if (!found.length) return text;
  const out: ReactNode[] = [];
  let at = 0;
  found.forEach((m, i) => {
    out.push(<Fragment key={`t${i}`}>{text.slice(at, m.start)}</Fragment>);
    out.push(<mark key={`m${i}`} className="nv-cm-mention-mark">{text.slice(m.start, m.end)}</mark>);
    at = m.end;
  });
  out.push(<Fragment key="end">{text.slice(at)}</Fragment>);
  return out;
}

/**
 * The comments pane every product uses: the threads (already in the order of their anchors), with filters, replies, resolve, edit, mentions and
 * previous/next. The product decides what an anchor is and what happens when a thread is chosen.
 */
export function CommentsPane<A>({
  threads, me, people: extraPeople = [], activeId, editingId, readOnly, canReply = true, empty, anchorOf, isLost, handlers, filterable = true,
}: {
  threads: Thread<A>[];
  me: Author;
  /** People who can be mentioned besides those who already wrote. */
  people?: Author[];
  activeId: string | null;
  /** The message being typed or edited. */
  editingId: string | null;
  readOnly?: boolean;
  /** Replying is allowed (a document that only allows comments is read-only but accepts replies). */
  canReply?: boolean;
  empty: string;
  /** What the thread is about: the text it is on, «Diapositiva 3», «B4»… */
  anchorOf?: (t: Thread<A>) => ReactNode;
  /** The anchor is gone (the text was deleted): shown apart. */
  isLost?: (t: Thread<A>) => boolean;
  handlers: CommentsHandlers;
  filterable?: boolean;
}) {
  useLocale();
  const [filter, setFilter] = useState<ThreadFilter>({ state: 'all' });
  const people = useMemo(() => {
    const m = new Map<string, Author>();
    for (const a of [me, ...extraPeople, ...authorsOf(threads)]) m.set(a.id, a);
    return [...m.values()];
  }, [me, extraPeople, threads]);
  const shown = filterThreads(threads, filter);
  const n = count(threads);
  const filtering = !!(filter.text || filter.authorId || (filter.state && filter.state !== 'all'));

  return (
    <div className="nv-cm">
      <div className="nv-cm-bar">
        <span className="nv-cm-count" aria-live="polite">
          {n.open === 1 ? t('1 abierto') : t('{n} abiertos', { n: n.open })}
          {n.resolved > 0 && ` · ${t('{n} resueltos', { n: n.resolved })}`}
        </span>
        <button type="button" className="nv-btn nv-btn--small" aria-label={t('Comentario anterior')} title={t('Comentario anterior')} disabled={!shown.length} onClick={() => handlers.step(-1)}>
          ‹
        </button>
        <button type="button" className="nv-btn nv-btn--small" aria-label={t('Siguiente comentario')} title={t('Siguiente comentario')} disabled={!shown.length} onClick={() => handlers.step(1)}>
          ›
        </button>
      </div>
      {filterable && threads.length > 0 && (
        <div className="nv-cm-filters">
          <input type="search" aria-label={t('Buscar en los comentarios')} placeholder={t('Buscar…')} value={filter.text ?? ''} onChange={(e) => setFilter({ ...filter, text: e.target.value })} />
          <select aria-label={t('Estado')} value={filter.state ?? 'all'} onChange={(e) => setFilter({ ...filter, state: e.target.value as ThreadFilter['state'] })}>
            <option value="all">{t('Todos')}</option>
            <option value="open">{t('Abiertos')}</option>
            <option value="resolved">{t('Resueltos')}</option>
          </select>
          <select aria-label={t('Persona')} value={filter.authorId ?? ''} onChange={(e) => setFilter({ ...filter, authorId: e.target.value || undefined })}>
            <option value="">{t('Todas las personas')}</option>
            {authorsOf(threads).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {!threads.length ? (
        <p className="nv-cm-empty">{empty}</p>
      ) : !shown.length ? (
        <p className="nv-cm-empty">
          {t('Ningún comentario coincide.')}{' '}
          {filtering && (
            <button type="button" className="nv-cm-link" onClick={() => setFilter({ state: 'all' })}>
              {t('Quitar los filtros')}
            </button>
          )}
        </p>
      ) : (
        <ul className="nv-cm-threads">
          {shown.map((th) => (
            <ThreadView
              key={th.id}
              th={th}
              me={me}
              people={people}
              active={activeId === th.id}
              editingId={editingId}
              readOnly={!!readOnly}
              canReply={canReply}
              anchor={anchorOf?.(th)}
              lost={!!isLost?.(th)}
              handlers={handlers}
            />
          ))}
        </ul>
      )}
      {!readOnly && n.threads > 0 && (
        <div className="nv-cm-foot">
          {n.resolved > 0 && (
            <button type="button" className="nv-btn nv-btn--small" onClick={() => handlers.deleteAll(true)}>
              {t('Eliminar los resueltos')}
            </button>
          )}
          <button type="button" className="nv-btn nv-btn--small" onClick={() => handlers.deleteAll(false)}>
            {t('Eliminar todos')}
          </button>
        </div>
      )}
    </div>
  );
}

function ThreadView<A>({
  th, me, people, active, editingId, readOnly, canReply, anchor, lost, handlers,
}: {
  th: Thread<A>;
  me: Author;
  people: Author[];
  active: boolean;
  editingId: string | null;
  readOnly: boolean;
  canReply: boolean;
  anchor?: ReactNode;
  lost: boolean;
  handlers: CommentsHandlers;
}) {
  const [reply, setReply] = useState('');
  const first = th.messages[0]!;
  const send = () => {
    if (!reply.trim()) return;
    handlers.reply(th.id, reply.trim());
    setReply('');
  };
  return (
    <li className={`nv-cm-thread${active ? ' is-active' : ''}${th.resolved ? ' is-done' : ''}${lost ? ' is-lost' : ''}`} onClick={() => handlers.select(th.id)} aria-label={t('Comentario de {name}', { name: first.author.name })}>
      {anchor && <div className="nv-cm-anchor">{anchor}</div>}
      {th.messages.map((m, i) => (
        <MessageView key={m.id} m={m} root={i === 0} th={th} me={me} people={people} editing={editingId === m.id} readOnly={readOnly} handlers={handlers} />
      ))}
      {th.resolved && (
        <div className="nv-cm-resolved">
          ✓ {t('Resuelto')}
          {th.resolvedBy ? ` ${t('por {name}', { name: th.resolvedBy.name })}` : ''}
        </div>
      )}
      {active && !readOnly && editingId === null && (
        <div className="nv-cm-actions" onClick={(e) => e.stopPropagation()}>
          {canReply && (
            <MentionInput value={reply} onChange={setReply} people={people} onSubmit={send} label={t('Responder')} placeholder={t('Responder')} singleLine />
          )}
          <button type="button" className="nv-btn nv-btn--small" onClick={() => (th.resolved ? handlers.reopen(th.id) : handlers.resolve(th.id))}>
            {th.resolved ? t('Reabrir') : t('Resolver')}
          </button>
          <button type="button" className="nv-btn nv-btn--small" onClick={() => handlers.deleteThread(th.id)}>
            {t('Eliminar')}
          </button>
        </div>
      )}
    </li>
  );
}

function MessageView<A>({
  m, root, th, me, people, editing, readOnly, handlers,
}: {
  m: Message;
  root: boolean;
  th: Thread<A>;
  me: Author;
  people: Author[];
  editing: boolean;
  readOnly: boolean;
  handlers: CommentsHandlers;
}) {
  const [text, setText] = useState(m.text);
  const mine = m.author.id === me.id;
  const done = () => handlers.edit(m.id, text.trim());
  return (
    <div className={`nv-cm-msg${root ? '' : ' is-reply'}`} onClick={(e) => editing && e.stopPropagation()}>
      <div className="nv-cm-head">
        <Avatar a={m.author} />
        <span className="nv-cm-who">
          <strong>{m.author.name}</strong>
          <small title={fullWhen(m.date)}>
            {whenText(m.date)}
            {m.edited ? ` · ${t('editado')}` : ''}
          </small>
        </span>
        {mine && !readOnly && !editing && (
          <span className="nv-cm-msgtools" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="nv-btn nv-btn--small" aria-label={t('Editar')} title={t('Editar')} onClick={() => handlers.startEdit(m.id)}>
              ✎
            </button>
            {!root && (
              <button type="button" className="nv-btn nv-btn--small" aria-label={t('Eliminar la respuesta')} title={t('Eliminar la respuesta')} onClick={() => handlers.deleteMessage(m.id, th.id)}>
                ✕
              </button>
            )}
          </span>
        )}
      </div>
      {editing ? (
        <div onClick={(e) => e.stopPropagation()}>
          <MentionInput value={text} onChange={setText} people={people} onSubmit={done} onCancel={() => { setText(m.text); handlers.cancelEdit(m.id); }} label={t('Texto del comentario')} autoFocus />
          <div className="nv-cm-edit-actions">
            <button type="button" className="nv-btn nv-btn--small" disabled={!text.trim()} onClick={done}>
              {t('Publicar')}
            </button>
            <button type="button" className="nv-btn nv-btn--small" onClick={() => { setText(m.text); handlers.cancelEdit(m.id); }}>
              {t('Cancelar')}
            </button>
          </div>
        </div>
      ) : (
        <p className="nv-cm-text" onDoubleClick={(e) => { if (mine && !readOnly) { e.stopPropagation(); handlers.startEdit(m.id); } }}>
          <MessageText text={m.text} people={people} />
        </p>
      )}
    </div>
  );
}
