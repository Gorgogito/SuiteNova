import { bodyText, bytesOf, decodeBase64, encodeBase64, formatAddress, parseMessage, type Address } from './mime';
import type { CalEvent, TaskItem } from './ics';
import type { Contact } from './vcard';

export interface Folder {
  id: string;
  name: string;
  system: boolean;
  /** Carpeta que la contiene (subcarpetas). Las carpetas del sistema van en el nivel superior. */
  parent?: string;
  /** Si es la carpeta de una cuenta del servidor: cuenta, nombre que usa el servidor y ruta legible. */
  remote?: { account: string; name: string; path: string };
}

export const SYSTEM_FOLDERS: Folder[] = [
  { id: 'inbox', name: 'Bandeja de entrada', system: true },
  { id: 'drafts', name: 'Borradores', system: true },
  { id: 'sent', name: 'Elementos enviados', system: true },
  { id: 'archive', name: 'Archivo', system: true },
  { id: 'junk', name: 'Correo no deseado', system: true },
  { id: 'trash', name: 'Elementos eliminados', system: true },
];

export interface MailRecord {
  id: string;
  folder: string;
  /** The message exactly as received, base64 encoded. */
  raw: string;
  subject: string;
  from: string;
  fromEmail: string;
  to: string;
  date: number;
  preview: string;
  /** Lower-case text for searching (limited in length). */
  search: string;
  hasAttachments: boolean;
  size: number;
  read: boolean;
  flagged: boolean;
  answered: boolean;
  /** Hidden recipients of a message that was composed here (never part of the raw headers). */
  bcc?: string[];
  /** De dónde vino en un servidor (cuenta, carpeta del servidor e identificador del mensaje en ella: el UID en IMAP). */
  remote?: { account: string; folder: string; key: string };
  /** Message-ID, para reconocer la copia local de un mensaje cuando el servidor lo devuelve. */
  mid?: string;
}

/** Un cambio hecho aquí que falta enviar al servidor. Se reintenta en cada sincronización hasta que se logra. */
export type PendingOp =
  | { id: string; account: string; kind: 'flag'; folder: string; keys: string[]; flag: string; on: boolean }
  | { id: string; account: string; kind: 'move'; folder: string; keys: string[]; to: string }
  | { id: string; account: string; kind: 'remove'; folder: string; keys: string[] }
  | { id: string; account: string; kind: 'append'; folder: string; raw: string; seen: boolean }
  | { id: string; account: string; kind: 'createFolder'; path: string }
  | { id: string; account: string; kind: 'deleteFolder'; folder: string };

export type SpecialFolder = 'inbox' | 'drafts' | 'sent' | 'archive' | 'junk' | 'trash';

/** Lo que se sabe de la estructura de una cuenta en el servidor. */
export interface ServerInfo {
  /** Qué carpeta del servidor (su nombre para las órdenes) corresponde a cada carpeta del sistema. */
  targets: Partial<Record<SpecialFolder, string>>;
  /** La ruta legible de esas mismas carpetas (para crear subcarpetas dentro de ellas). */
  paths?: Partial<Record<SpecialFolder, string>>;
}

export interface MailData {
  version: 1;
  owner: Address;
  folders: Folder[];
  messages: MailRecord[];
  events: CalEvent[];
  tasks: TaskItem[];
  contacts: Contact[];
  /** Por carpeta del servidor (clave: cuenta|carpeta): la validez de los identificadores (si el servidor renumera, se empieza de cero). */
  sync?: Record<string, { validity: string }>;
  /** Cambios locales que aún no están en el servidor. */
  pending?: PendingOp[];
  /** Estructura de cada cuenta en el servidor (clave: cuenta). */
  servers?: Record<string, ServerInfo>;
}

let counter = 0;
export const newMailId = (): string => `m${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function newMailData(): MailData {
  return { version: 1, owner: { name: '', email: '' }, folders: SYSTEM_FOLDERS.map((f) => ({ ...f })), messages: [], events: [], tasks: [], contacts: [] };
}

const fold = (s: string): string => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Build the list record of a raw message (parsed once; the raw text stays the source of truth). */
export function recordFromRaw(raw: string | Uint8Array, folder: string, opts: Partial<Pick<MailRecord, 'read' | 'flagged' | 'answered' | 'bcc'>> = {}): MailRecord {
  const bytes = bytesOf(raw);
  const m = parseMessage(bytes);
  const text = bodyText(m).replace(/\s+/g, ' ').trim();
  const from = m.from[0];
  return {
    id: newMailId(),
    folder,
    raw: encodeBase64(bytes),
    subject: m.subject,
    from: from ? from.name || from.email : '',
    fromEmail: from?.email ?? '',
    to: m.to.map((a) => a.name || a.email).join(', '),
    date: m.date?.getTime() ?? Date.now(),
    preview: text.slice(0, 200),
    search: fold(`${m.subject}\n${m.from.map(formatAddress).join(' ')}\n${m.to.map(formatAddress).join(' ')}\n${m.cc.map(formatAddress).join(' ')}\n${text.slice(0, 4000)}`),
    hasAttachments: m.attachments.length > 0,
    size: bytes.length,
    read: opts.read ?? false,
    flagged: opts.flagged ?? false,
    answered: opts.answered ?? false,
    bcc: opts.bcc,
    mid: m.messageId || undefined,
  };
}

export const rawOf = (r: MailRecord): Uint8Array => decodeBase64(r.raw);

export function addRaw(d: MailData, folder: string, raw: string | Uint8Array, opts: Parameters<typeof recordFromRaw>[2] = {}): MailRecord {
  const rec = recordFromRaw(raw, folder, opts);
  d.messages.push(rec);
  return rec;
}

/** Ruta de una carpeta de Nova Mail con "/" entre niveles. */
export function folderPath(d: MailData, id: string): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (let cur = d.folders.find((f) => f.id === id); cur && !seen.has(cur.id); cur = cur.parent ? d.folders.find((f) => f.id === cur!.parent) : undefined) {
    seen.add(cur.id);
    parts.unshift(cur.name);
  }
  return parts.join('/');
}

export const childrenOf = (d: MailData, id: string | null): Folder[] => d.folders.filter((f) => (f.parent ?? null) === id && f.id !== id);

/** Esta carpeta y todas las que cuelgan de ella. */
export function descendants(d: MailData, id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const c of childrenOf(d, out[i]!)) if (!out.includes(c.id)) out.push(c.id);
  return out;
}

/** Las carpetas en el orden en que se muestran: las del sistema, y después las demás, cada una seguida de sus subcarpetas. */
export function folderRows(d: MailData): { folder: Folder; depth: number }[] {
  const out: { folder: Folder; depth: number }[] = [];
  const seen = new Set<string>();
  const byName = (a: Folder, b: Folder) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const visit = (f: Folder, depth: number): void => {
    if (seen.has(f.id)) return;
    seen.add(f.id);
    out.push({ folder: f, depth });
    for (const c of childrenOf(d, f.id).sort(byName)) visit(c, depth + 1);
  };
  for (const f of d.folders.filter((x) => x.system)) visit(f, 0);
  for (const f of childrenOf(d, null).filter((x) => !x.system).sort(byName)) visit(f, 0);
  return out;
}

export const inFolder = (d: MailData, folder: string): MailRecord[] => d.messages.filter((m) => m.folder === folder).sort((a, b) => b.date - a.date);

export const unreadCount = (d: MailData, folder: string): number => d.messages.filter((m) => m.folder === folder && !m.read).length;

/** Messages in a folder (or everywhere) whose subject, people or text contain every word typed. */
export function searchMessages(d: MailData, query: string, folder: string | null): MailRecord[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return d.messages
    .filter((m) => (folder === null || m.folder === folder) && words.every((w) => m.search.includes(w)))
    .sort((a, b) => b.date - a.date);
}

/** Move a message; from the deleted-items folder it is removed for good. */
export function deleteMessage(d: MailData, id: string): void {
  const m = d.messages.find((x) => x.id === id);
  if (!m) return;
  if (m.folder === 'trash') d.messages = d.messages.filter((x) => x.id !== id);
  else m.folder = 'trash';
}

export function emptyFolder(d: MailData, folder: string): number {
  const n = d.messages.filter((m) => m.folder === folder).length;
  d.messages = d.messages.filter((m) => m.folder !== folder);
  return n;
}

/** Quoted original for a reply or forward, in plain text. */
export function quoteText(raw: string | Uint8Array, kind: 'reply' | 'forward'): string {
  const m = parseMessage(raw);
  const who = m.from[0] ? formatAddress(m.from[0]) : '';
  const when = m.date ? m.date.toLocaleString() : '';
  const body = bodyText(m);
  if (kind === 'reply') return `\n\nEl ${when}, ${who} escribió:\n${body.split('\n').map((l) => `> ${l}`).join('\n')}\n`;
  return `\n\n---------- Mensaje reenviado ----------\nDe: ${who}\nFecha: ${when}\nAsunto: ${m.subject}\nPara: ${m.to.map(formatAddress).join(', ')}\n\n${body}\n`;
}

export const reSubject = (s: string, prefix: 'Re' | 'Fwd'): string => (new RegExp(`^\\s*(${prefix}|${prefix === 'Re' ? 'RE' : 'FW|Fw|RV'})\\s*:`, 'i').test(s) ? s : `${prefix}: ${s}`);

export function serializeMail(d: MailData): string {
  return JSON.stringify(d);
}

const str = (v: unknown, max = 500): string | undefined => (typeof v === 'string' && v.length <= max ? v : undefined);

function readFolder(f: Folder): Folder {
  const r = f.remote as Partial<NonNullable<Folder['remote']>> | undefined;
  const remote = r && typeof r.account === 'string' && typeof r.name === 'string' ? { account: r.account, name: r.name, path: typeof r.path === 'string' ? r.path : r.name } : undefined;
  const out: Folder = { id: f.id, name: f.name, system: false };
  if (typeof f.parent === 'string') out.parent = f.parent;
  if (remote) out.remote = remote;
  return out;
}

/** Lee un mensaje guardado; los de la versión anterior (UID numérico) se convierten. */
function readRecord(m: MailRecord, ids: Set<string>): MailRecord {
  const rec: MailRecord = { ...m, folder: ids.has(m.folder) ? m.folder : 'inbox' };
  const r = m.remote as { account?: unknown; folder?: unknown; key?: unknown; uid?: unknown } | undefined;
  if (r && typeof r.account === 'string' && typeof r.folder === 'string') {
    const key = typeof r.key === 'string' ? r.key : Number.isInteger(r.uid) ? String(r.uid) : undefined;
    if (key) rec.remote = { account: r.account, folder: r.folder, key };
    else delete rec.remote;
  } else delete rec.remote;
  if (typeof rec.mid !== 'string') delete rec.mid;
  return rec;
}

function readSync(v: unknown): MailData['sync'] {
  if (!v || typeof v !== 'object') return undefined;
  const out: NonNullable<MailData['sync']> = {};
  for (const [k, s] of Object.entries(v as Record<string, { validity?: unknown }>)) {
    if (s && (typeof s.validity === 'string' || Number.isInteger(s.validity))) out[k] = { validity: String(s.validity) };
  }
  return Object.keys(out).length ? out : undefined;
}

const OPS = new Set(['flag', 'move', 'remove', 'append', 'createFolder', 'deleteFolder']);

function readPending(v: unknown): PendingOp[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: PendingOp[] = [];
  for (const o of v as Record<string, unknown>[]) {
    if (!o || typeof o !== 'object' || !OPS.has(o.kind as string) || !str(o.id, 100) || !str(o.account, 100)) continue;
    const keys = Array.isArray(o.keys) ? o.keys.filter((k): k is string => typeof k === 'string').slice(0, 5000) : [];
    const base = { id: o.id as string, account: o.account as string };
    switch (o.kind) {
      case 'flag':
        if (str(o.folder) && keys.length && str(o.flag, 20) && typeof o.on === 'boolean') out.push({ ...base, kind: 'flag', folder: o.folder as string, keys, flag: o.flag as string, on: o.on });
        break;
      case 'move':
        if (str(o.folder) && str(o.to) && keys.length) out.push({ ...base, kind: 'move', folder: o.folder as string, keys, to: o.to as string });
        break;
      case 'remove':
        if (str(o.folder) && keys.length) out.push({ ...base, kind: 'remove', folder: o.folder as string, keys });
        break;
      case 'append':
        if (str(o.folder) && typeof o.raw === 'string') out.push({ ...base, kind: 'append', folder: o.folder as string, raw: o.raw, seen: o.seen === true });
        break;
      case 'createFolder':
        if (str(o.path)) out.push({ ...base, kind: 'createFolder', path: o.path as string });
        break;
      case 'deleteFolder':
        if (str(o.folder)) out.push({ ...base, kind: 'deleteFolder', folder: o.folder as string });
        break;
    }
  }
  return out.length ? out : undefined;
}

const SPECIAL_IDS = new Set<string>(['inbox', 'drafts', 'sent', 'archive', 'junk', 'trash']);

function readServers(v: unknown): MailData['servers'] {
  if (!v || typeof v !== 'object') return undefined;
  const out: NonNullable<MailData['servers']> = {};
  for (const [acc, info] of Object.entries(v as Record<string, { targets?: Record<string, unknown>; paths?: Record<string, unknown> }>)) {
    const targets: ServerInfo['targets'] = {};
    for (const [k, name] of Object.entries(info?.targets ?? {})) if (SPECIAL_IDS.has(k) && typeof name === 'string' && name.length <= 1024) targets[k as SpecialFolder] = name;
    const paths: NonNullable<ServerInfo['paths']> = {};
    for (const [k, p] of Object.entries((info as { paths?: Record<string, unknown> })?.paths ?? {})) if (SPECIAL_IDS.has(k) && typeof p === 'string' && p.length <= 1024) paths[k as SpecialFolder] = p;
    out[acc] = Object.keys(paths).length ? { targets, paths } : { targets };
  }
  return Object.keys(out).length ? out : undefined;
}

export function parseMailData(text: string): MailData {
  let o: Partial<MailData>;
  try {
    o = JSON.parse(text) as Partial<MailData>;
  } catch {
    throw new Error('El archivo no es de Nova Mail (no es JSON válido).');
  }
  if (!o || o.version !== 1 || !Array.isArray(o.messages)) throw new Error('El archivo no es de Nova Mail (formato desconocido).');
  const folders: Folder[] = [...SYSTEM_FOLDERS.map((f) => ({ ...f })), ...(Array.isArray(o.folders) ? o.folders.filter((f) => f && !f.system && typeof f.id === 'string' && typeof f.name === 'string').map((f) => readFolder(f)) : [])];
  const ids = new Set(folders.map((f) => f.id));
  // una carpeta superior que no existe (o un ciclo) deja la carpeta en el nivel superior
  for (const f of folders) {
    if (f.parent && (!ids.has(f.parent) || f.parent === f.id)) delete f.parent;
  }
  for (const f of folders) {
    const seen = new Set<string>([f.id]);
    for (let p = f.parent; p; p = folders.find((x) => x.id === p)?.parent) {
      if (seen.has(p)) {
        delete f.parent;
        break;
      }
      seen.add(p);
    }
  }
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    version: 1,
    owner: o.owner && typeof o.owner.email === 'string' ? { name: String(o.owner.name ?? ''), email: o.owner.email } : { name: '', email: '' },
    folders,
    messages: arr<MailRecord>(o.messages)
      .filter((m) => m && typeof m.raw === 'string' && typeof m.id === 'string')
      .map((m) => readRecord(m, ids)),
    events: arr<CalEvent>(o.events).filter((e) => e && typeof e.start === 'number' && typeof e.end === 'number'),
    tasks: arr<TaskItem>(o.tasks).filter((t) => t && typeof t.id === 'string'),
    contacts: arr<Contact>(o.contacts).filter((c) => c && typeof c.id === 'string'),
    sync: readSync(o.sync),
    pending: readPending(o.pending),
    servers: readServers(o.servers),
  };
}
