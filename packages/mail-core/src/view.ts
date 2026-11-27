import type { MailRecord } from './store';
import { topicOf } from './threads';

/* How the list of messages is shown: filter, order, groups and conversations. */

export type SortKey = 'date' | 'from' | 'subject' | 'size' | 'importance' | 'flag' | 'attachments';
export type ListFilter = 'all' | 'unread' | 'flagged' | 'attachments';
export interface ListView {
  sort: SortKey;
  /** The other way round: oldest first, Z to A, smallest first… */
  reverse: boolean;
  filter: ListFilter;
  groups: boolean;
  conversations: boolean;
}

export const SORT_KEYS: { id: SortKey; label: string }[] = [
  { id: 'date', label: 'Fecha' },
  { id: 'from', label: 'De / Para' },
  { id: 'subject', label: 'Asunto' },
  { id: 'size', label: 'Tamaño' },
  { id: 'importance', label: 'Importancia' },
  { id: 'flag', label: 'Bandera' },
  { id: 'attachments', label: 'Adjuntos' },
];
export const LIST_FILTERS: { id: ListFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'unread', label: 'No leídos' },
  { id: 'flagged', label: 'Con bandera' },
  { id: 'attachments', label: 'Con adjuntos' },
];
export const DEFAULT_VIEW: ListView = { sort: 'date', reverse: false, filter: 'all', groups: true, conversations: false };

/** A saved view, with anything that is not understood back to its usual value. */
export function readView(v: unknown): ListView {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<ListView>;
  return {
    sort: SORT_KEYS.some((k) => k.id === o.sort) ? o.sort! : DEFAULT_VIEW.sort,
    reverse: o.reverse === true,
    filter: LIST_FILTERS.some((k) => k.id === o.filter) ? o.filter! : DEFAULT_VIEW.filter,
    groups: typeof o.groups === 'boolean' ? o.groups : DEFAULT_VIEW.groups,
    conversations: o.conversations === true,
  };
}

export const matchesFilter = (m: MailRecord, f: ListFilter): boolean => (f === 'unread' ? !m.read : f === 'flagged' ? m.flagged : f === 'attachments' ? m.hasAttachments : true);

const text = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
const rank = (m: MailRecord): number => (m.importance === 'high' ? 2 : m.importance === 'low' ? 0 : 1);
/** Who a message is listed under: its sender, or in Sent and Drafts the people it goes to. */
export const personOf = (m: MailRecord, outgoing: boolean): string => (outgoing ? m.to : m.from || m.fromEmail);

/** Newest first, A to Z, largest first, the marked ones first; ties by date, newest first. */
export function compareMessages(view: Pick<ListView, 'sort' | 'reverse'>, outgoing = false): (a: MailRecord, b: MailRecord) => number {
  const by: Record<SortKey, (a: MailRecord, b: MailRecord) => number> = {
    date: (a, b) => b.date - a.date,
    from: (a, b) => text(personOf(a, outgoing), personOf(b, outgoing)),
    subject: (a, b) => text(topicOf(a.subject), topicOf(b.subject)),
    size: (a, b) => b.size - a.size,
    importance: (a, b) => rank(b) - rank(a),
    flag: (a, b) => Number(b.flagged) - Number(a.flagged),
    attachments: (a, b) => Number(b.hasAttachments) - Number(a.hasAttachments),
  };
  const main = by[view.sort];
  const sign = view.reverse ? -1 : 1;
  return (a, b) => sign * main(a, b) || (view.sort === 'date' ? 0 : b.date - a.date);
}

export interface GroupName {
  key: string;
  /** In Spanish, to be translated; `plain` ones (a person, a subject) are shown as they are; empty for a day of the week. */
  label: string;
  plain?: boolean;
  /** A day of this week: the name of that day. */
  day?: number;
}

const MB = 1024 * 1024;
const SIZES: [number, string, string][] = [
  [25 * MB, 's6', 'Enorme (más de 25 MB)'],
  [5 * MB, 's5', 'Muy grande (5 a 25 MB)'],
  [MB, 's4', 'Grande (1 a 5 MB)'],
  [100 * 1024, 's3', 'Mediano (100 KB a 1 MB)'],
  [10 * 1024, 's2', 'Pequeño (10 a 100 KB)'],
  [0, 's1', 'Muy pequeño (menos de 10 KB)'],
];

/** The date groups of Outlook. Weeks start on Monday. */
export function dateGroup(date: number, now: number): GroupName {
  const n = new Date(now);
  const day = (offset: number) => new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset).getTime();
  const monday = -((n.getDay() + 6) % 7);
  if (date >= day(1)) return { key: 'd:later', label: 'Más adelante' };
  if (date >= day(0)) return { key: 'd:today', label: 'Hoy' };
  if (date >= day(-1)) return { key: 'd:yesterday', label: 'Ayer' };
  if (date >= day(monday)) {
    const d = new Date(date);
    return { key: `d:day${d.getDay()}`, label: '', day: d.getTime() };
  }
  if (date >= day(monday - 7)) return { key: 'd:week1', label: 'La semana pasada' };
  if (date >= day(monday - 14)) return { key: 'd:week2', label: 'Hace dos semanas' };
  if (date >= day(monday - 21)) return { key: 'd:week3', label: 'Hace tres semanas' };
  if (date >= new Date(n.getFullYear(), n.getMonth(), 1).getTime()) return { key: 'd:month', label: 'Este mes' };
  if (date >= new Date(n.getFullYear(), n.getMonth() - 1, 1).getTime()) return { key: 'd:lastmonth', label: 'El mes pasado' };
  return { key: 'd:older', label: 'Anteriores' };
}

export function groupOf(m: MailRecord, sort: SortKey, now: number, outgoing = false): GroupName {
  switch (sort) {
    case 'date':
      return dateGroup(m.date, now);
    case 'from': {
      const who = personOf(m, outgoing);
      return who ? { key: `f:${who.toLowerCase()}`, label: who, plain: true } : { key: 'f:', label: '(sin remitente)' };
    }
    case 'subject': {
      const topic = topicOf(m.subject);
      return topic ? { key: `t:${topic.toLowerCase()}`, label: topic, plain: true } : { key: 't:', label: '(sin asunto)' };
    }
    case 'size': {
      const [, key, label] = SIZES.find(([min]) => m.size >= min)!;
      return { key, label };
    }
    case 'importance':
      return m.importance === 'high' ? { key: 'i:high', label: 'Importancia alta' } : m.importance === 'low' ? { key: 'i:low', label: 'Importancia baja' } : { key: 'i:normal', label: 'Importancia normal' };
    case 'flag':
      return m.flagged ? { key: 'g:on', label: 'Con bandera' } : { key: 'g:off', label: 'Sin bandera' };
    case 'attachments':
      return m.hasAttachments ? { key: 'a:on', label: 'Con adjuntos' } : { key: 'a:off', label: 'Sin adjuntos' };
  }
}

export interface Thread {
  key: string;
  /** All the messages of the conversation, newest first (also the ones kept in other folders). */
  members: MailRecord[];
  /** The ones that are in the list: what an action on the whole conversation affects. */
  ids: string[];
  unread: number;
  open: boolean;
}

export type ListRow =
  | { type: 'group'; key: string; group: GroupName; count: number; collapsed: boolean }
  /** A message; with `thread`, the heading of a conversation; with `child`, one message of an open conversation. */
  | { type: 'message'; key: string; rec: MailRecord; thread?: Thread; child?: string };

export interface RowsInput {
  /** The messages of the list, already filtered, in any order. */
  messages: MailRecord[];
  view: ListView;
  now: number;
  outgoing?: boolean;
  /** Groups the person closed. */
  closed?: ReadonlySet<string>;
  /** Conversations the person opened. */
  open?: ReadonlySet<string>;
  /** With conversations: the conversation of each message and the messages of each conversation. */
  threads?: { of: Map<string, string>; members: Map<string, MailRecord[]> };
}

export function listRows({ messages, view, now, outgoing = false, closed, open, threads }: RowsInput): ListRow[] {
  const cmp = compareMessages(view, outgoing);
  type Entry = { head: MailRecord; ids: string[]; key?: string };
  let entries: Entry[];
  if (view.conversations && threads) {
    const byThread = new Map<string, MailRecord[]>();
    for (const m of messages) {
      const k = threads.of.get(m.id) ?? `#${m.id}`;
      const list = byThread.get(k);
      if (list) list.push(m);
      else byThread.set(k, [m]);
    }
    entries = [...byThread].map(([key, list]) => {
      const newest = list.reduce((a, b) => (b.date > a.date ? b : a));
      return { key, head: newest, ids: [...list].sort((a, b) => b.date - a.date).map((m) => m.id) };
    });
  } else entries = messages.map((head) => ({ head, ids: [head.id] }));
  entries.sort((a, b) => cmp(a.head, b.head));

  const rows: ListRow[] = [];
  const push = (e: Entry) => {
    const members = e.key === undefined ? [] : [...(threads!.members.get(e.key) ?? [])].sort((a, b) => b.date - a.date);
    if (e.key === undefined || members.length < 2) {
      rows.push({ type: 'message', key: `m:${e.head.id}`, rec: e.head });
      return;
    }
    const isOpen = !!open?.has(e.key);
    rows.push({ type: 'message', key: `c:${e.key}`, rec: e.head, thread: { key: e.key, members, ids: e.ids, unread: members.filter((m) => !m.read).length, open: isOpen } });
    if (isOpen) for (const m of members) rows.push({ type: 'message', key: `m:${m.id}`, rec: m, child: e.key });
  };
  if (!view.groups) {
    entries.forEach(push);
    return rows;
  }
  // the order already keeps each group together, except for people and subjects that only differ in how they are written
  const groups = new Map<string, { group: GroupName; list: Entry[] }>();
  for (const e of entries) {
    const g = groupOf(e.head, view.sort, now, outgoing);
    const at = groups.get(g.key);
    if (at) at.list.push(e);
    else groups.set(g.key, { group: g, list: [e] });
  }
  for (const { group, list } of groups.values()) {
    const collapsed = !!closed?.has(group.key);
    rows.push({ type: 'group', key: `g:${group.key}`, group, count: list.length, collapsed });
    if (!collapsed) list.forEach(push);
  }
  return rows;
}
