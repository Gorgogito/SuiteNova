import { t } from '@suitenova/core-ui';
import { LIST_FILTERS, SORT_KEYS, isDone, isOverdue, type GroupName, type ListRow, type MailRecord } from '@suitenova/mail-core';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { moveTargets, removeSelected } from './actions';
import { CategoryChips } from './CategoryViews';
import type { OpenDialog } from './commands';
import { ContextMenu, type MenuAt, type MenuItem } from './ContextMenu';
import type { MailCtl } from './ctl';
import { MAIL_DRAG } from './drag';
import { categoryItems, followItems, junkItems, ruleItems, stepItems } from './organize-menus';
import { contactItems } from './people-menus';

const ROW = 66;
const GROUP = 28;

const when = (d: number): string => {
  const x = new Date(d);
  const now = new Date();
  return x.toDateString() === now.toDateString() ? x.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : x.getFullYear() === now.getFullYear() ? x.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : x.toLocaleDateString();
};

export function groupLabel(g: GroupName): string {
  if (g.day !== undefined) {
    const name = new Date(g.day).toLocaleDateString(undefined, { weekday: 'long' });
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return g.plain ? g.label : t(g.label);
}

/** The order and what is shown, as a menu. */
export function viewItems(ctl: MailCtl): MenuItem[] {
  const v = ctl.view;
  return [
    { label: t('Ordenar por'), sub: SORT_KEYS.map((k) => ({ label: t(k.label), checked: v.sort === k.id, run: () => ctl.setView({ sort: k.id }) })) },
    { label: t('Orden inverso'), checked: v.reverse, run: () => ctl.setView({ reverse: !v.reverse }) },
    { label: t('Mostrar en grupos'), checked: v.groups, run: () => ctl.setView({ groups: !v.groups }) },
    { label: t('Mostrar como conversaciones'), checked: v.conversations, run: () => ctl.setView({ conversations: !v.conversations }) },
    'separator',
    ...LIST_FILTERS.map((f) => ({ label: t(f.label), checked: v.filter === f.id, run: () => ctl.setView({ filter: f.id }) })),
  ];
}

export interface ListActions {
  print: (rec: MailRecord) => void;
  headers: () => void;
  saveAttachments: (rec: MailRecord) => void;
  openDialog: OpenDialog;
}

/** What the flag of a row says when the pointer is over it. */
function flagTitle(m: MailRecord): string {
  if (isDone(m)) return t('Completado el {date}', { date: new Date(m.follow!.done!).toLocaleDateString() });
  if (!m.flagged) return t('Marcar con bandera');
  return m.follow?.due != null ? t('Vence el {date}', { date: new Date(m.follow.due).toLocaleDateString() }) : t('Con bandera, sin fecha');
}

function messageItems(ctl: MailCtl, actions: ListActions): MenuItem[] {
  const records = ctl.selectedRecords;
  const one = ctl.single;
  const ids = ctl.selectedIds();
  const items: MenuItem[] = [];
  if (one) {
    if (one.outgoing)
      items.push(
        { label: t('Enviar ahora'), disabled: ctl.outbox.isSending(one.id), run: () => void ctl.outbox.sendNow(one.id) },
        { label: t('Cambiar la hora…'), disabled: ctl.outbox.isSending(one.id), run: () => actions.openDialog('retime', { ids: [one.id] }) },
        { label: t('Editar (cancela el envío)'), disabled: ctl.outbox.isSending(one.id), run: () => void ctl.outbox.takeBack(one.id) },
        'separator',
      );
    else if (one.folder === 'drafts') items.push({ label: t('Editar borrador'), run: () => ctl.editDraft(one.id) });
    else
      items.push(
        { label: t('Responder'), hint: 'Ctrl+R', run: () => ctl.reply(one.id, false) },
        { label: t('Responder a todos'), run: () => ctl.reply(one.id, true) },
      );
    if (!one.outgoing) items.push({ label: t('Reenviar'), hint: 'Ctrl+F', run: () => ctl.forward(one.id) }, 'separator');
  }
  items.push(
    { label: t('Marcar como leído'), hint: 'Ctrl+Q', disabled: !records.some((m) => !m.read), run: () => ctl.setReadMany(ids, true) },
    { label: t('Marcar como no leído'), hint: 'Ctrl+U', disabled: !records.some((m) => m.read), run: () => ctl.setReadMany(ids, false) },
    records.every((m) => m.flagged) ? { label: t('Quitar la bandera'), run: () => ctl.setFlagMany(ids, false) } : { label: t('Marcar con bandera'), run: () => ctl.setFlagMany(ids, true) },
    'separator',
    { label: t('Mover a'), sub: moveTargets(ctl, records.every((m) => m.folder === records[0]?.folder) ? records[0]?.folder : undefined).map((f) => ({ label: f.label, run: () => void ctl.moveMany(ids, f.id) })) },
    { label: t('Archivar'), disabled: records.every((m) => m.folder === 'archive'), run: () => void ctl.moveMany(ids, 'archive') },
    { label: t('Correo no deseado'), disabled: records.every((m) => m.folder === 'junk'), run: () => void ctl.moveMany(ids, 'junk') },
    { label: t('Eliminar'), hint: t('Supr'), run: () => removeSelected(ctl) },
    'separator',
    { label: t('Categorizar'), sub: categoryItems(ctl, actions.openDialog) },
    { label: t('Seguimiento'), sub: followItems(ctl, actions.openDialog) },
    { label: t('Pasos rápidos'), sub: stepItems(ctl, actions.openDialog) },
    { label: t('Reglas'), sub: ruleItems(ctl, actions.openDialog) },
    { label: t('Remitente'), sub: junkItems(ctl, actions.openDialog) },
    ...(one?.fromEmail ? contactItems(ctl, { name: one.from === one.fromEmail ? '' : one.from, email: one.fromEmail }) : []),
  );
  if (one) {
    items.push('separator', { label: t('Imprimir…'), hint: 'Ctrl+P', run: () => actions.print(one) });
    if (one.hasAttachments) items.push({ label: t('Guardar todos los adjuntos…'), run: () => actions.saveAttachments(one) });
    items.push({ label: t('Encabezados del mensaje…'), run: actions.headers });
  }
  items.push('separator', { label: ctl.undoLabel ? t('Deshacer: {action}', { action: t(ctl.undoLabel) }) : t('Deshacer'), hint: 'Ctrl+Z', disabled: !ctl.undoLabel, run: () => ctl.undo() });
  return items;
}

type MessageRow = Extract<ListRow, { type: 'message' }>;

export function MessageList({ ctl, actions }: { ctl: MailCtl; actions: ListActions }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const rows = ctl.rows();
  const count = ctl.list().length;
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [h, setH] = useState(500);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // where each row starts: headings of groups are lower than messages
  const starts = new Array<number>(rows.length + 1);
  starts[0] = 0;
  for (let i = 0; i < rows.length; i++) starts[i + 1] = starts[i]! + (rows[i]!.type === 'group' ? GROUP : ROW);
  const total = starts[rows.length]!;
  const rowAt = (y: number): number => {
    let lo = 0;
    let hi = rows.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const first = Math.max(0, rowAt(top) - 5);
  const last = Math.min(rows.length - 1, rowAt(top + h) + 5);

  const folderName = ctl.searchFolder?.name ?? ctl.data.folders.find((f) => f.id === ctl.folder)?.name ?? '';
  // in a search that is not of one folder, each row says where the message is
  const mixed = !!ctl.searchFolder || ctl.query.startsWith('*');
  const outgoing = ctl.outgoing;
  const messages = rows.filter((r): r is MessageRow => r.type === 'message');
  /** The row the keyboard is on. */
  const cursor = (): number => {
    const at = messages.findIndex((r) => r.key === ctl.cursorRow && (ctl.isSelected(r.rec.id) || r.thread));
    return at >= 0 ? at : messages.findIndex((r) => r.rec.id === ctl.selectedId);
  };

  const reveal = (key: string) => {
    const i = rows.findIndex((r) => r.key === key);
    const el = ref.current;
    if (i < 0 || !el) return;
    // with the heading of its group, if it is the first of it
    const from = rows[i - 1]?.type === 'group' ? starts[i - 1]! : starts[i]!;
    if (from < el.scrollTop) el.scrollTop = from;
    else if (starts[i + 1]! > el.scrollTop + el.clientHeight) el.scrollTop = starts[i + 1]! - el.clientHeight;
  };
  const go = (i: number, range = false) => {
    const n = messages[Math.max(0, Math.min(messages.length - 1, i))];
    if (!n) return;
    ctl.selectRow(n.key, { range });
    reveal(n.key);
  };

  const openMenu = (x: number, y: number) => setMenu({ x, y, label: t('Acciones del mensaje'), items: messageItems(ctl, actions) });

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const i = cursor();
    const row = messages[i];
    const page = Math.max(1, Math.floor(h / ROW) - 1);
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'ArrowDown') go(i + 1, e.shiftKey);
    else if (e.key === 'ArrowUp') go(i < 0 ? 0 : i - 1, e.shiftKey);
    else if (e.key === 'PageDown') go(i + page, e.shiftKey);
    else if (e.key === 'PageUp') go(i - page, e.shiftKey);
    else if (e.key === 'Home') go(0, e.shiftKey);
    else if (e.key === 'End') go(messages.length - 1, e.shiftKey);
    else if (e.key === 'ArrowRight' && row?.thread && !row.thread.open) ctl.toggleThread(row.thread.key);
    else if (e.key === 'ArrowLeft' && row?.thread?.open) ctl.toggleThread(row.thread.key);
    else if (e.key === 'ArrowLeft' && row?.child) go(messages.findIndex((r) => r.thread?.key === row.child));
    else if (e.key === 'Delete') removeSelected(ctl, e.shiftKey);
    else if (ctrl && e.key.toLowerCase() === 'a') ctl.selectAll();
    else if (e.key === 'Insert' && ctl.selectedId) {
      // like the flag: it marks for follow-up, and what is all marked is completed
      if (ctl.selectedRecords.every((m) => m.flagged)) ctl.completeMany(ctl.selectedIds());
      else ctl.setFlagMany(ctl.selectedIds(), true);
    }
    else if (e.key === 'Enter' && ctl.selected?.folder === 'drafts') ctl.editDraft(ctl.selected.id);
    else if (e.key === 'Enter' && ctl.selected?.outgoing) ctl.outbox.takeBack(ctl.selected.id);
    else if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && ctl.selectedId) {
      const el = ref.current!.querySelector('.ml-item.is-selected') ?? ref.current!;
      const r = el.getBoundingClientRect();
      openMenu(r.left + 40, r.top + 24);
    } else return;
    e.preventDefault();
  };

  const people = (r: MessageRow): string => {
    if (r.thread) {
      const names = r.thread.members.map((m) => (m.folder === 'sent' ? t('Yo') : m.from || m.fromEmail || t('(sin remitente)')));
      return [...new Set(names.reverse())].join(', ');
    }
    const m = r.rec;
    if (outgoing || (r.child && m.folder === 'sent')) return `${t('Para')}: ${m.to || t('(sin destinatario)')}`;
    return m.from || m.fromEmail || t('(sin remitente)');
  };

  const message = (r: MessageRow, y: number) => {
    const m = r.rec;
    const th = r.thread;
    const selected = th ? ctl.selectedThread === th.key || (!th.open && th.ids.every((id) => ctl.isSelected(id))) : ctl.isSelected(m.id);
    const unread = th ? th.unread > 0 : !m.read;
    const flagged = th ? th.members.some((x) => x.flagged) : m.flagged;
    const folder = (r.child && m.folder !== ctl.folder) || mixed ? ctl.data.folders.find((f) => f.id === m.folder)?.name : undefined;
    const done = th ? !flagged && th.members.some(isDone) : isDone(m);
    const late = (th ? th.members : [m]).some((x) => isOverdue(x, Date.now()));
    const names = th ? [...new Set(th.members.flatMap((x) => x.categories ?? []))] : m.categories;
    const has = (test: (x: MailRecord) => boolean) => (th ? th.members.some(test) : test(m));
    return (
      <div
        key={r.key}
        role="option"
        aria-selected={selected}
        className={`ml-item${selected ? ' is-selected' : ''}${unread ? ' is-unread' : ''}${th ? ' is-thread' : ''}${r.child ? ' is-child' : ''}`}
        style={{ top: y, height: ROW }}
        draggable
        onClick={(e) => {
          ctl.selectRow(r.key, { add: e.ctrlKey || e.metaKey, range: e.shiftKey });
          ref.current?.focus({ preventScroll: true });
        }}
        onDoubleClick={() => (m.folder === 'drafts' ? ctl.editDraft(m.id) : m.outgoing ? void ctl.outbox.takeBack(m.id) : th && ctl.toggleThread(th.key))}
        // Shift+click selects a range, not the text of the rows
        onMouseDown={(e) => e.shiftKey && e.preventDefault()}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!selected) ctl.selectRow(r.key);
          ref.current?.focus({ preventScroll: true });
          openMenu(e.clientX, e.clientY);
        }}
        onDragStart={(e) => {
          const ids = selected ? ctl.selectedIds() : (th?.ids ?? [m.id]);
          e.dataTransfer.setData(MAIL_DRAG, JSON.stringify(ids));
          e.dataTransfer.setData('text/plain', ids.length === 1 ? m.subject : t('{n} mensajes', { n: ids.length }));
          e.dataTransfer.effectAllowed = 'move';
        }}
      >
        <div className="ml-item__top">
          {th && (
            <button
              type="button"
              tabIndex={-1}
              className="ml-item__caret"
              aria-expanded={th.open}
              aria-label={th.open ? t('Contraer la conversación') : t('Expandir la conversación')}
              onClick={(e) => {
                e.stopPropagation();
                ctl.toggleThread(th.key);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              {th.open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
            </button>
          )}
          <span className="ml-item__from">{people(r)}</span>
          {th && (
            <span className="ml-item__count" title={t('{n} mensajes', { n: th.members.length })} aria-label={t('{n} mensajes', { n: th.members.length })}>
              {th.members.length}
            </span>
          )}
          {folder && <span className="ml-item__folder">{t(folder)}</span>}
          <span className="ml-item__date">{when(m.date)}</span>
        </div>
        <div className="ml-item__subject">
          <span>
            {m.subject || t('(sin asunto)')}
            {has((x) => x.hasAttachments) && <span title={t('Con adjuntos')} aria-label={t('Con adjuntos')}> 📎</span>}
            {has((x) => !!x.meeting) && <span title={t('Reunión')} aria-label={t('Reunión')}> 📅</span>}
            {has((x) => x.importance === 'high') && <span title={t('Importancia alta')} aria-label={t('Importancia alta')}> ❗</span>}
          </span>
          <button
            type="button"
            className={`ml-flag${flagged ? ' is-on' : ''}${late ? ' is-late' : ''}${done ? ' is-done' : ''}`}
            aria-label={flagged ? t('Marcar como completado') : t('Marcar con bandera')}
            aria-pressed={flagged}
            title={th ? undefined : flagTitle(m)}
            onClick={(e) => {
              e.stopPropagation();
              if (!th) ctl.toggleFlag(m.id);
              else if (flagged) ctl.completeMany(th.members.filter((x) => x.flagged && th.ids.includes(x.id)).map((x) => x.id));
              else ctl.setFlagMany(th.ids, true);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {flagged ? '⚑' : done ? '✓' : '⚐'}
          </button>
        </div>
        <div className="ml-item__preview">
          <CategoryChips data={ctl.data} names={names} max={2} />
          {m.outgoing ? <span className={`ml-item__out${m.outgoing.held ? ' is-held' : ''}`}>{ctl.outbox.status(m)}</span> : <span>{m.preview}</span>}
        </div>
      </div>
    );
  };

  const sort = SORT_KEYS.find((k) => k.id === ctl.view.sort)!;
  return (
    <div className="ml-list">
      <div className="ml-list__head">
        <strong>{ctl.query.trim() ? t('Resultados de la búsqueda') : t(folderName)}</strong>
        <span>{t('{n} mensajes', { n: count })}</span>
      </div>
      <div className="ml-list__view">
        <div role="group" aria-label={t('Filtro de la lista')}>
          {LIST_FILTERS.slice(0, 2).map((f) => (
            <button key={f.id} type="button" aria-pressed={ctl.view.filter === f.id} onClick={() => ctl.setView({ filter: f.id })}>
              {t(f.label)}
            </button>
          ))}
          {ctl.view.filter !== 'all' && ctl.view.filter !== 'unread' && (
            <button type="button" aria-pressed onClick={() => ctl.setView({ filter: 'all' })}>
              {t(LIST_FILTERS.find((f) => f.id === ctl.view.filter)!.label)}
            </button>
          )}
        </div>
        <button
          type="button"
          className="ml-list__sort"
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.right - 200, y: r.bottom + 2, label: t('Organizar la lista'), items: viewItems(ctl) });
          }}
        >
          {t('Por {column}', { column: t(sort.label) })} {ctl.view.reverse ? '↑' : '↓'}
        </button>
      </div>
      <div ref={ref} className="ml-list__scroll" role="listbox" aria-multiselectable="true" aria-label={t('Mensajes')} tabIndex={0} onScroll={(e) => setTop(e.currentTarget.scrollTop)} onKeyDown={onKeyDown}>
        <div role="presentation" style={{ height: total, position: 'relative' }}>
          {rows.length === 0 && <div className="ml-empty">{ctl.query.trim() ? t('Sin resultados') : ctl.view.filter !== 'all' ? t('No hay mensajes con ese filtro.') : ctl.searchFolder ? t('No hay mensajes que cumplan esta búsqueda.') : t('Esta carpeta está vacía.')}</div>}
          {rows.slice(first, last + 1).map((r, i) =>
            r.type === 'group' ? (
              <div key={r.key} role="presentation" className="ml-group" style={{ top: starts[first + i], height: GROUP }}>
                <button type="button" tabIndex={-1} aria-expanded={!r.collapsed} onClick={() => ctl.toggleGroup(r.group.key)}>
                  {r.collapsed ? <ChevronRight size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
                  <span>{groupLabel(r.group)}</span>
                  {r.collapsed && <em>{r.count}</em>}
                </button>
              </div>
            ) : (
              message(r, starts[first + i]!)
            ),
          )}
        </div>
      </div>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
