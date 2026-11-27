import { bodyText, parseMessage } from './mime';
import { isDone, isOverdue } from './followup';
import { folderPath, rawOf, type MailData, type MailRecord } from './store';

/*
 * Searching the mail. Every word typed must be found; `"several words"` are searched together, `-word` excludes, and a
 * field narrows where to look: `de:ana`, `asunto:"plan anual"`, `adjuntos:sí`, `fecha:ayer`, `desde:01/05/2026`.
 * Case and accents do not count.
 */

export const foldText = (s: string): string => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** How many characters of the text each record keeps for searching; beyond them the message itself is read. */
export const SEARCH_TEXT = 4000;

export interface SearchFields {
  subject: string;
  from: string;
  to: string;
  cc: string;
  /** The text of the message, whole. */
  text: () => string;
  attachments: () => string[];
}

const whole = new WeakMap<MailRecord, { raw: string; text?: string; names?: string[] }>();
function deep(m: MailRecord): { text: string; names: string[] } {
  let c = whole.get(m);
  if (!c || c.raw !== m.raw) whole.set(m, (c = { raw: m.raw }));
  if (c.text === undefined) {
    try {
      const p = parseMessage(rawOf(m));
      c.text = foldText(bodyText(p).replace(/\s+/g, ' ').trim());
      c.names = p.attachments.map((a) => foldText(a.filename));
    } catch {
      c.text = '';
      c.names = [];
    }
  }
  return { text: c.text, names: c.names! };
}

/** The parts of a record to search in. Its `search` text holds them by lines: subject, from, to, cc and the text. */
export function fieldsOf(m: MailRecord): SearchFields {
  const lines = m.search.split('\n');
  const tail = lines.slice(-4);
  const [from = '', to = '', cc = '', start = ''] = tail;
  return {
    subject: lines.slice(0, -4).join('\n'),
    from: `${from}\n${foldText(`${m.from} ${m.fromEmail}`)}`,
    to,
    cc,
    // the record keeps only the beginning of a long text
    text: () => (m.search.length >= SEARCH_TEXT ? deep(m).text : start),
    attachments: () => (m.hasAttachments ? deep(m).names : []),
  };
}

export const emailsOf = (line: string): string[] => line.match(/[^\s<>,;"()]+@[^\s<>,;"()]+/g) ?? [];

// ------------------------------------------------------------------ the query

type Test = (m: MailRecord, d: MailData, f: () => SearchFields) => boolean;

export interface Query {
  /** Nothing to look for. */
  empty: boolean;
  /** What was typed that is not understood; with any, nothing is found. */
  errors: string[];
  /** It names a folder. */
  folders: boolean;
  matches: (m: MailRecord, d: MailData) => boolean;
}

const FIELDS: Record<string, string> = {
  de: 'from', from: 'from',
  para: 'to', to: 'to',
  cc: 'cc',
  cco: 'bcc', bcc: 'bcc',
  asunto: 'subject', subject: 'subject',
  cuerpo: 'body', body: 'body', texto: 'body',
  adjunto: 'attachment', attachment: 'attachment',
  adjuntos: 'hasattachments', conadjuntos: 'hasattachments', hasattachments: 'hasattachments',
  categoria: 'category', category: 'category',
  es: 'is', is: 'is',
  importancia: 'importance', importance: 'importance',
  fecha: 'date', date: 'date',
  desde: 'since', since: 'since',
  hasta: 'until', until: 'until',
  antes: 'before', before: 'before',
  despues: 'after', after: 'after',
  tamano: 'size', size: 'size',
  carpeta: 'folder', folder: 'folder',
};

const day = (y: number, m: number, d: number): number => new Date(y, m, d).getTime();

/** The span a date typed covers: [from, to). Dates as day/month/year (or year-month-day), a month, a year or a word. */
export function dateSpan(value: string, now: number): [number, number] | null {
  const n = new Date(now);
  const y = n.getFullYear();
  const mo = n.getMonth();
  const today = (offset: number) => day(y, mo, n.getDate() + offset);
  const monday = -((n.getDay() + 6) % 7);
  const v = foldText(value).replace(/[\s_-]+(?=[a-z])/g, '');
  const words: Record<string, [number, number]> = {
    hoy: [today(0), today(1)], today: [today(0), today(1)],
    ayer: [today(-1), today(0)], yesterday: [today(-1), today(0)],
    semana: [today(monday), today(monday + 7)], estasemana: [today(monday), today(monday + 7)], thisweek: [today(monday), today(monday + 7)],
    semanapasada: [today(monday - 7), today(monday)], lastweek: [today(monday - 7), today(monday)],
    mes: [day(y, mo, 1), day(y, mo + 1, 1)], estemes: [day(y, mo, 1), day(y, mo + 1, 1)], thismonth: [day(y, mo, 1), day(y, mo + 1, 1)],
    mespasado: [day(y, mo - 1, 1), day(y, mo, 1)], lastmonth: [day(y, mo - 1, 1), day(y, mo, 1)],
    ano: [day(y, 0, 1), day(y + 1, 0, 1)], esteano: [day(y, 0, 1), day(y + 1, 0, 1)], thisyear: [day(y, 0, 1), day(y + 1, 0, 1)],
  };
  if (words[v]) return words[v]!;
  const real = (yy: number, mm: number, dd: number): [number, number] | null => {
    const t = new Date(yy, mm - 1, dd);
    return t.getFullYear() === yy && t.getMonth() === mm - 1 && t.getDate() === dd ? [t.getTime(), day(yy, mm - 1, dd + 1)] : null;
  };
  const full = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));
  let x = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (x) return real(Number(x[1]), Number(x[2]), Number(x[3]));
  x = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(value);
  if (x) return real(full(x[3]!), Number(x[2]), Number(x[1]));
  x = /^(\d{1,2})\/(\d{4})$/.exec(value);
  if (x) return Number(x[1]) >= 1 && Number(x[1]) <= 12 ? [day(Number(x[2]), Number(x[1]) - 1, 1), day(Number(x[2]), Number(x[1]), 1)] : null;
  x = /^(\d{1,2})\/(\d{1,2})$/.exec(value);
  if (x) return real(y, Number(x[2]), Number(x[1]));
  x = /^(\d{4})$/.exec(value);
  if (x) return [day(Number(x[1]), 0, 1), day(Number(x[1]) + 1, 0, 1)];
  return null;
}

function dateTest(field: string, value: string, now: number): Test | null {
  const between = field === 'date' ? /^(.+)\.\.(.+)$/.exec(value) : null;
  if (between) {
    const a = dateSpan(between[1]!, now);
    const b = dateSpan(between[2]!, now);
    return a && b ? (m) => m.date >= a[0] && m.date < b[1] : null;
  }
  const sign = field === 'date' ? /^(>=|<=|>|<)?(.*)$/.exec(value)! : null;
  const span = dateSpan(sign ? sign[2]! : value, now);
  if (!span) return null;
  const [from, to] = span;
  const how = sign?.[1] ?? (field === 'date' ? '=' : field);
  switch (how) {
    case '>=':
    case 'since':
      return (m) => m.date >= from;
    case '<=':
    case 'until':
      return (m) => m.date < to;
    case '>':
    case 'after':
      return (m) => m.date >= to;
    case '<':
    case 'before':
      return (m) => m.date < from;
    default:
      return (m) => m.date >= from && m.date < to;
  }
}

function sizeTest(value: string): Test | null {
  const v = foldText(value);
  if (v === 'grande' || v === 'large') return (m) => m.size > 1024 * 1024;
  const x = /^(>=|<=|>|<)?(\d+(?:[.,]\d+)?)(b|kb|k|mb|m|gb)?$/.exec(v);
  if (!x) return null;
  const unit = x[3] ?? 'kb';
  const bytes = Number(x[2]!.replace(',', '.')) * (unit === 'b' ? 1 : unit.startsWith('g') ? 1024 ** 3 : unit.startsWith('m') ? 1024 ** 2 : 1024);
  const how = x[1] ?? '>=';
  return (m) => (how === '>' ? m.size > bytes : how === '<' ? m.size < bytes : how === '<=' ? m.size <= bytes : m.size >= bytes);
}

const STATES: Record<string, (m: MailRecord, now: number) => boolean> = {
  noleido: (m) => !m.read, unread: (m) => !m.read,
  leido: (m) => m.read, read: (m) => m.read,
  marcado: (m) => m.flagged, flagged: (m) => m.flagged,
  completado: (m) => isDone(m), completed: (m) => isDone(m),
  vencido: (m, now) => isOverdue(m, now), overdue: (m, now) => isOverdue(m, now),
  respondido: (m) => m.answered, answered: (m) => m.answered,
};

function termTest(field: string, value: string, now: number): Test | null {
  const v = foldText(value);
  switch (field) {
    case 'text':
      return (m, _d, f) => m.search.includes(v) || !!m.imageText?.includes(v) || (m.search.length >= SEARCH_TEXT && f().text().includes(v));
    case 'from':
      return (_m, _d, f) => f().from.includes(v);
    case 'to':
      return (_m, _d, f) => f().to.includes(v);
    case 'cc':
      return (_m, _d, f) => f().cc.includes(v);
    case 'bcc':
      return (m) => foldText((m.bcc ?? []).join(' ')).includes(v);
    case 'subject':
      return (_m, _d, f) => f().subject.includes(v);
    case 'body':
      return (m, _d, f) => f().text().includes(v) || !!m.imageText?.includes(v);
    case 'attachment':
      return (m, _d, f) => (v === '*' ? m.hasAttachments : f().attachments().some((n) => n.includes(v)));
    case 'hasattachments': {
      if (['si', 'yes', 'true', '1'].includes(v)) return (m) => m.hasAttachments;
      if (['no', 'false', '0'].includes(v)) return (m) => !m.hasAttachments;
      return null;
    }
    case 'category':
      if (v === '*') return (m) => !!m.categories?.length;
      if (v === 'ninguna' || v === 'none') return (m) => !m.categories?.length;
      return (m) => !!m.categories?.some((c) => foldText(c).includes(v));
    case 'is': {
      const s = STATES[v.replace(/[\s_-]/g, '')];
      return s ? (m) => s(m, now) : null;
    }
    case 'importance': {
      if (v === 'alta' || v === 'high') return (m) => m.importance === 'high';
      if (v === 'baja' || v === 'low') return (m) => m.importance === 'low';
      if (v === 'normal') return (m) => !m.importance;
      return null;
    }
    case 'size':
      return sizeTest(value);
    case 'folder':
      return (m, d) => foldText(folderPath(d, m.folder)).includes(v);
    default:
      return dateTest(field, value, now);
  }
}

export function parseQuery(text: string, now = Date.now()): Query {
  const tests: { test: Test; negate: boolean }[] = [];
  const errors: string[] = [];
  let folders = false;
  for (const x of text.matchAll(/(-?)(?:(\p{L}+):)?(?:"([^"]*)"?|([^\s"]+))/gu)) {
    const [typed, minus, name, quoted, bare] = x;
    let value = quoted ?? bare ?? '';
    let field = name ? FIELDS[foldText(name)] : 'text';
    if (!field) {
      // not a field: «https://…» is searched as it is
      value = `${name}:${value}`;
      field = 'text';
    }
    // a field whose value is still to be typed
    if (!name && value.endsWith(':') && FIELDS[foldText(value.slice(0, -1))]) continue;
    if (!value) continue;
    const test = termTest(field, value, now);
    if (!test) {
      errors.push(typed);
      continue;
    }
    if (field === 'folder') folders = true;
    tests.push({ test, negate: minus === '-' });
  }
  return {
    empty: !tests.length && !errors.length,
    errors,
    folders,
    matches: (m, d) => {
      if (errors.length) return false;
      let f: SearchFields | null = null;
      const fields = () => (f ??= fieldsOf(m));
      return tests.every(({ test, negate }) => test(m, d, fields) !== negate);
    },
  };
}

/** Messages in a folder (or everywhere) that match what was typed, newest first. */
export function searchMessages(d: MailData, query: string, folder: string | null, now = Date.now()): MailRecord[] {
  const q = parseQuery(query, now);
  return d.messages.filter((m) => (folder === null || m.folder === folder) && q.matches(m, d)).sort((a, b) => b.date - a.date);
}

// ------------------------------------------------------------------ search folders

/** A saved search, shown with the folders. */
export interface SearchFolder {
  id: string;
  name: string;
  query: string;
}

export const DEFAULT_SEARCH_FOLDERS: SearchFolder[] = [
  { id: 'q:unread', name: 'Correo no leído', query: 'es:noleido' },
  { id: 'q:follow', name: 'Para seguimiento', query: 'es:marcado' },
];

export const searchFoldersOf = (d: MailData): SearchFolder[] => d.searchFolders ?? DEFAULT_SEARCH_FOLDERS;

/** Deleted and junk mail stays out of a search folder, unless its search names a folder. */
export function searchFolderMessages(d: MailData, sf: SearchFolder, now = Date.now()): MailRecord[] {
  const q = parseQuery(sf.query, now);
  if (q.empty) return [];
  return d.messages.filter((m) => (q.folders || (m.folder !== 'trash' && m.folder !== 'junk')) && q.matches(m, d));
}

export function readSearchFolders(v: unknown): SearchFolder[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: SearchFolder[] = [];
  for (const x of v as Partial<SearchFolder>[]) {
    if (!x || typeof x.id !== 'string' || !x.id.startsWith('q:') || typeof x.name !== 'string' || typeof x.query !== 'string') continue;
    if (!x.name.trim() || x.name.length > 100 || x.query.length > 500 || out.some((y) => y.id === x.id)) continue;
    out.push({ id: x.id, name: x.name, query: x.query });
  }
  return out.slice(0, 100);
}
