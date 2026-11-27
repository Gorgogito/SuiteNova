import { docOf, messageContent } from './rich/content';
import { signatureFor, withSignature, type SignatureUse } from './rich/library';
import { htmlToDoc } from './rich/parse';
import { renderMail } from './rich/html';
import { makeQuote, type Quote } from './rich/quote';
import { MailImageOcr } from './ocr-images';
import { MailReader } from './read-aloud';
import { MailOrganizer } from './organizer';
import { MailAlerts } from './alerts';
import { MailOutbox } from './outbox';
import {
  RFC_FLAGS,
  addRaw,
  addressBook,
  splitRecipients,
  applyFetched,
  applyPlan,
  type Fetched,
  type FolderPlan,
  buildMessage,
  cancelPending,
  canChangeFolder,
  childrenOf,
  compareMessages,
  completeOp,
  conversationsOf,
  descendants,
  encodeBase64,
  enqueueOp,
  folderName,
  folderParents,
  folderPath,
  folderTarget,
  listRows,
  matchesFilter,
  planFolders,
  readView,
  remapFolder,
  toggleFavorite,
  reconcileFolder,
  inFolder,
  newContact,
  newEvent,
  newMailData,
  newMailId,
  newTask,
  parseMessage,
  rawOf,
  reSubject,
  clearFollow,
  completeFollow,
  parseQuery,
  searchFolderMessages,
  searchFoldersOf,
  setCategory,
  setFollow,
  syncKey,
  decodeBase64,
  dismissReminder,
  dueReminders,
  pruneReminders,
  retryDelay,
  snoozeReminder,
  type DueReminder,
  type Outgoing,
  type Address,
  type BookEntry,
  type CalEvent,
  type Contact,
  type Draft,
  type Folder,
  type Importance,
  type ListRow,
  type ListView,
  type MailData,
  type MailRecord,
  type OutgoingAttachment,
  type ParsedMessage,
  type PendingOp,
  type SearchFolder,
  type SpecialFolder,
  type TaskItem,
} from '@suitenova/mail-core';
import { canConnect, messageOf, protocolOf, remote, savesSentCopy, type RemoteAccount } from './remote';
import { MailRuntime } from './macros';

/** Mensajes más grandes que esto no se descargan. */
export const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
const EMAIL_OK = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
/** Mensajes que se piden al servidor de una vez. */
const FETCH_BATCH = 50;
export const DEFAULT_SYNC = { autoMinutes: 5, limit: 500 };
export const AUTO_SYNC_CHOICES = [0, 1, 5, 15, 30, 60];
export const SYNC_LIMIT_CHOICES = [100, 200, 500, 1000, 2000, 5000];
/** How long after the last keystroke the message being written is saved as a draft, and the longest it waits. */
export const DRAFT_DELAY = 3000;
const DRAFT_MAX_WAIT = 15000;
const NO_ADDRESS = 'yo@nova.local';
const SETTINGS_KEY = 'novamail.sync';
const MACROS_KEY = 'novamail.macros';
const VIEW_KEY = 'novamail.view';
/** How many actions can be undone. */
const UNDO_DEPTH = 30;

/** The macros of the program (like Outlook's, they belong to the program and not to a mail file). */
function readMacros(): { enabled: boolean; modules: { name: string; code: string }[] } {
  try {
    const v = JSON.parse(localStorage.getItem(MACROS_KEY) ?? '{}') as { enabled?: unknown; modules?: unknown };
    const modules = Array.isArray(v.modules) ? v.modules.filter((m): m is { name: string; code: string } => !!m && typeof (m as { name?: unknown }).name === 'string' && typeof (m as { code?: unknown }).code === 'string').map((m) => ({ name: m.name, code: m.code })) : [];
    return { enabled: v.enabled !== false, modules };
  } catch {
    return { enabled: true, modules: [] };
  }
}

function readSavedView(): ListView {
  try {
    return readView(JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null'));
  } catch {
    return readView(null);
  }
}

/** A message as it was before an action, to undo it. */
export interface Change {
  id: string;
  folder: string;
  remote?: MailRecord['remote'];
  read: boolean;
  flagged: boolean;
  categories?: string[];
  follow?: MailRecord['follow'];
  /** It was removed from the file: the message itself. */
  removed?: MailRecord;
  /** What was asked of the server. */
  sent?: { kind: 'move'; to: string } | { kind: 'remove' };
}
export interface UndoPart {
  changes: Change[];
  /** It changed «read», the flag, the follow-up or the categories; the other actions move messages and leave those as they are by then. */
  marks?: boolean;
  /** Messages it made: copies. */
  created?: string[];
}
/** One thing done by the person: it may be several actions run together (a quick step, the rules). */
interface UndoStep {
  label: string;
  parts: UndoPart[];
}
const snapshot = (m: MailRecord): Change => ({
  id: m.id,
  folder: m.folder,
  remote: m.remote ? { ...m.remote } : undefined,
  read: m.read,
  flagged: m.flagged,
  categories: m.categories ? [...m.categories] : undefined,
  follow: m.follow ? { ...m.follow } : undefined,
});
const sameMarks = (a: Change, m: MailRecord): boolean => a.read === m.read && a.flagged === m.flagged && JSON.stringify([a.categories ?? null, a.follow ?? null]) === JSON.stringify([m.categories ?? null, m.follow ?? null]);

type OpInput = PendingOp extends infer O ? (O extends { id: string } ? Omit<O, 'id'> : never) : never;

function readSettings(): { autoMinutes: number; limit: number } {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as { autoMinutes?: unknown; limit?: unknown };
    return {
      autoMinutes: typeof v.autoMinutes === 'number' && AUTO_SYNC_CHOICES.includes(v.autoMinutes) ? v.autoMinutes : DEFAULT_SYNC.autoMinutes,
      limit: typeof v.limit === 'number' && SYNC_LIMIT_CHOICES.includes(v.limit) ? v.limit : DEFAULT_SYNC.limit,
    };
  } catch {
    return { ...DEFAULT_SYNC };
  }
}

export type Section = 'mail' | 'calendar' | 'contacts' | 'tasks';
export type CalView = 'day' | 'week' | 'month';

export interface ComposeState {
  id: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  /** What is written, as plain text. */
  body: string;
  /** The editor's document, with its formatting, pictures and tables; without it, `body` is the message. */
  doc?: unknown;
  /** The original of a reply or a forward, which goes below what is written. */
  quote?: Quote;
  importance?: Importance;
  attachments: OutgoingAttachment[];
  inReplyTo?: string;
  references?: string[];
  /** The draft record being edited, replaced when saved again. */
  draftId?: string;
  /** The account it is sent from. */
  from?: string;
}

/** What the message being written looked like when it was opened and when it was last saved on purpose. */
interface ComposeSession {
  id: string;
  opened: string;
  /** Saved with «Guardar borrador»: closing keeps that version, and «Descartar» goes back to it. */
  kept: { signature: string; record: MailRecord } | null;
  /** What the draft record holds now. */
  stored: string;
  /** The draft as it was before editing it. */
  before: MailRecord | null;
}

/** Everything the person can change in a message, to know whether anything did. */
const signature = (c: ComposeState): string =>
  JSON.stringify([
    c.to,
    c.cc,
    c.bcc,
    c.subject,
    c.body,
    c.from ?? '',
    c.attachments.map((a) => [a.filename, a.data.length]),
    c.doc ?? null,
    c.quote?.kind ?? null,
    c.importance ?? null,
  ]);
const isBlank = (c: ComposeState): boolean => ![c.to, c.cc, c.bcc, c.subject].some((x) => x.trim()) && !c.attachments.length && !c.quote && !c.body.trim() && !/"type":"(image|table)"/.test(JSON.stringify(c.doc ?? null));

/** What a draft record keeps so that it opens again as it was written. */
interface StoredCompose {
  v: 1;
  body: string;
  doc?: unknown;
  quote?: Omit<Quote, 'inline'>;
}
const stored = (c: ComposeState): Record<string, unknown> | undefined => {
  if (!c.doc && !c.quote) return undefined;
  // the pictures of the original travel in the message itself: they are not kept twice
  const quote = c.quote ? { kind: c.quote.kind, head: c.quote.head, html: c.quote.html, text: c.quote.text } : undefined;
  const out: StoredCompose = { v: 1, body: c.body, doc: c.doc, quote };
  return out as unknown as Record<string, unknown>;
};

/** The written part of a draft opened again: as it was kept, or else read from the message. */
function writtenOf(rec: MailRecord, m: ParsedMessage): Pick<ComposeState, 'body' | 'doc' | 'quote'> {
  const kept = rec.compose as Partial<StoredCompose> | undefined;
  if (kept?.v === 1 && typeof kept.body === 'string') {
    const q = kept.quote;
    const quote: Quote | undefined =
      q && (q.kind === 'reply' || q.kind === 'forward') && Array.isArray(q.head) && typeof q.text === 'string'
        ? { kind: q.kind, head: q.head, html: typeof q.html === 'string' ? q.html : null, text: q.text, inline: m.inlineParts.filter((p) => p.cid && !!q.html?.includes(`cid:${p.cid}`)).map((p) => ({ filename: p.filename, contentType: p.contentType, data: p.data, contentId: p.cid! })) }
        : undefined;
    return { body: kept.body, doc: kept.doc, quote };
  }
  if (m.html !== null) {
    const doc = htmlToDoc(m.html, m.inlineParts);
    return { body: renderMail(doc).text, doc: doc.toJSON() };
  }
  // the message was written with one line break more than the text had
  return { body: (m.text ?? '').replace(/\r\n/g, '\n').replace(/\n$/, '') };
}

export const startOfDay = (t: number): number => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
export const addDays = (t: number, n: number): number => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()).getTime();
};

export class MailCtl {
  data: MailData = newMailData();
  section: Section = 'mail';
  folder = 'inbox';
  selectedId: string | null = null;
  query = '';
  /** How the list is shown: order, filter, groups and conversations. It belongs to the program, not to a mail file. */
  view: ListView = readSavedView();
  /** The messages selected; `selectedId` is the one being read. */
  private selection = new Set<string>();
  /** The conversation selected as a whole, from its heading. */
  selectedThread: string | null = null;
  /** Where a selection with Shift starts, and the row the keyboard is on. */
  private anchorRow: string | null = null;
  cursorRow: string | null = null;
  closedGroups = new Set<string>();
  openThreads = new Set<string>();
  /** Read or marked while a filter or a search was on: they stay in sight until it changes (message → its folder then). */
  private kept = new Map<string, string>();
  private rowCache: { key: string; rows: ListRow[] } | null = null;
  private undoSteps: UndoStep[] = [];
  /** While several actions run as one, their parts are gathered here. */
  private gathering: UndoPart[] | null = null;
  /** Copies that were also asked of a server. */
  private serverCopies = new Set<string>();
  /** Categories, follow-up, rules, quick steps, search folders and blocked senders. */
  readonly organize = new MailOrganizer(this);
  /** What waits to be sent. */
  readonly outbox = new MailOutbox(this);
  /** Notices of new mail, reminders and failures, and receiving at once. */
  readonly alerts = new MailAlerts(this);
  /** The folder being named: a new one, or another name for one there is. */
  folderEdit: { kind: 'new'; inside: boolean } | { kind: 'rename'; id: string } | null = null;
  /** An undo that has to wait for the server. */
  undoing: Promise<void> = Promise.resolve();
  private inflight: string | null = null;
  /** Folders where messages were moved on the server: reading them links the copies here with the ones there. */
  private movedInto = new Map<string, { account: string; folder: string }>();
  private relinking: Promise<void> = Promise.resolve();
  private flushDone: Promise<unknown> = Promise.resolve();
  fileName: string | null = null;
  filePath: string | null = null;
  dirty = false;
  showReadingPane = true;

  // calendar
  calView: CalView = 'week';
  anchor = Date.now();
  selectedEvent: string | null = null;

  // contacts / tasks
  selectedContact: string | null = null;
  contactQuery = '';
  taskFilter: 'open' | 'done' | 'all' = 'open';
  selectedTask: string | null = null;

  compose: ComposeState | null = null;
  /** The message is being written in its large window instead of the reading pane. */
  composePopped = false;
  /** Closing the message needs an answer: save it, discard it or keep writing. */
  askClose = false;
  /** What happened to a message that was left without sending it, for the status bar. */
  composeNotice = '';
  private session: ComposeSession | null = null;
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  private draftDue = 0;
  /** The draft record of each message written in this window. */
  private drafts = new Map<string, string>();
  private book: { version: number; entries: BookEntry[] } | null = null;
  /** Cuentas de correo conectadas (sin contraseña). */
  accounts: RemoteAccount[] = [];
  syncing = false;
  /** Resultado de la última sincronización, para la barra de estado. */
  syncMessage = '';
  /** Cada cuántos minutos se sincroniza sola (0: nunca) y cuántos mensajes de los más nuevos de cada carpeta se conservan aquí. */
  autoMinutes = DEFAULT_SYNC.autoMinutes;
  syncLimit = DEFAULT_SYNC.limit;
  private autoTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private version = 0;
  private listeners = new Set<() => void>();
  /** The macro modules (Nova Basic with the objects of Outlook), kept in the program's settings. */
  macros: { name: string; code: string }[] = readMacros().modules;
  /** Macros may run. */
  macrosEnabled = readMacros().enabled;
  private runtime: MailRuntime | null = null;
  get macroRt(): MailRuntime {
    return (this.runtime ??= new MailRuntime(this));
  }
  saveMacros(): void {
    try {
      localStorage.setItem(MACROS_KEY, JSON.stringify({ enabled: this.macrosEnabled, modules: this.macros }));
    } catch {
      /* sin almacenamiento */
    }
  }
  setMacrosEnabled(on: boolean): void {
    this.macrosEnabled = on;
    this.saveMacros();
    this.touch();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = (): number => this.version;
  private muted = 0;
  /** Run several changes and notify the interface once at the end. */
  batch(fn: () => void): void {
    this.muted++;
    try {
      fn();
    } finally {
      this.muted--;
    }
    this.touch(true);
  }

  touch(changed = false): void {
    if (changed) this.dirty = true;
    if (this.muted) return;
    this.version++;
    this.listeners.forEach((l) => l());
    this.imageOcr.schedule();
  }

  /** The text read from the pictures of messages (OCR): read, copy, and found by the mailbox search. */
  readonly imageOcr = new MailImageOcr(this);

  /** Read Aloud: the open message is read with the shared reader. */
  readonly readAloud = new MailReader(this);

  /** Lee las preferencias de sincronización y arranca la sincronización automática. */
  startSync(): void {
    const st = readSettings();
    this.autoMinutes = st.autoMinutes;
    this.syncLimit = st.limit;
    this.restartAuto();
  }

  setSyncSettings(p: { autoMinutes?: number; limit?: number }): void {
    if (p.autoMinutes !== undefined && AUTO_SYNC_CHOICES.includes(p.autoMinutes)) this.autoMinutes = p.autoMinutes;
    if (p.limit !== undefined && SYNC_LIMIT_CHOICES.includes(p.limit)) this.syncLimit = p.limit;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ autoMinutes: this.autoMinutes, limit: this.syncLimit }));
    } catch {
      // sin almacenamiento: vale solo para esta sesión
    }
    this.restartAuto();
    this.touch();
  }

  private restartAuto(): void {
    if (this.autoTimer) clearInterval(this.autoTimer);
    this.autoTimer = null;
    if (this.autoMinutes > 0) this.autoTimer = setInterval(() => void this.syncAll({ auto: true }), this.autoMinutes * 60_000);
  }

  /** Detiene los temporizadores (al cerrar la ventana). */
  dispose(): void {
    if (this.autoTimer) clearInterval(this.autoTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.autoTimer = this.flushTimer = null;
    this.cancelDraftTimer();
    this.outbox.dispose();
    this.alerts.dispose();
  }

  get docTitle(): string {
    return (this.fileName ?? 'Nova Mail') + (this.dirty ? ' •' : '');
  }

  // ---------- documents ----------

  load(d: MailData, name: string | null, path: string | null): void {
    this.data = d;
    this.fileName = name;
    this.filePath = path;
    this.dirty = false;
    this.folder = 'inbox';
    this.selectedId = null;
    this.query = '';
    this.selectedEvent = this.selectedContact = this.selectedTask = null;
    this.resetList();
    this.openThreads.clear();
    this.closedGroups.clear();
    this.undoSteps = [];
    this.gathering = null;
    this.serverCopies.clear();
    this.organize.reset();
    this.alerts.reset();
    this.alerts.startWatch();
    pruneReminders(d, Date.now());
    this.rowCache = null;
    this.folderEdit = null;
    this.endCompose(false);
    this.composeNotice = '';
    this.drafts.clear();
    this.book = null;
    this.touch();
    this.outbox.schedule();
  }

  newDoc(): void {
    this.load(newMailData(), null, null);
  }

  markSaved(name: string, path: string | null): void {
    this.fileName = name;
    this.filePath = path;
    this.dirty = false;
    this.touch();
  }

  setOwner(owner: Address): void {
    this.data.owner = owner;
    this.touch(true);
  }

  // ---------- mail ----------

  go(section: Section): void {
    if (section !== 'mail') this.leaveCompose();
    this.section = section;
    this.touch();
  }

  private resetList(): void {
    this.selection.clear();
    this.kept.clear();
    this.selectedThread = this.anchorRow = this.cursorRow = null;
  }

  setFolder(id: string): void {
    this.leaveCompose();
    this.folder = id;
    this.selectedId = null;
    this.query = '';
    this.resetList();
    this.touch();
  }

  /** What is typed in the search box. */
  setQuery(query: string): void {
    if (query === this.query) return;
    this.query = query;
    this.kept.clear();
    this.touch();
  }

  /** The search folder being seen, if the current «folder» is one. */
  get searchFolder(): SearchFolder | undefined {
    return this.folder.startsWith('q:') ? searchFoldersOf(this.data).find((f) => f.id === this.folder) : undefined;
  }

  folderExists(id: string): boolean {
    return this.data.folders.some((f) => f.id === id) || searchFoldersOf(this.data).some((f) => f.id === id);
  }

  setView(patch: Partial<ListView>): void {
    if (patch.filter !== undefined && patch.filter !== this.view.filter) this.kept.clear();
    if (patch.sort !== undefined && patch.sort !== this.view.sort) this.closedGroups.clear();
    this.view = readView({ ...this.view, ...patch });
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(this.view));
    } catch {
      // sin almacenamiento: vale solo para esta sesión
    }
    this.touch();
  }

  /** The folder lists who each message goes to, not who sent it. */
  get outgoing(): boolean {
    return this.folder === 'sent' || this.folder === 'drafts' || this.folder === 'outbox';
  }

  /** Messages shown in the list: a search runs over the current folder, or over all when prefixed with `*`. */
  list(): MailRecord[] {
    const search = this.searchFolder;
    const typed = this.query.trim() ? parseQuery(this.query.replace(/^\s*\*\s*/, '')) : null;
    const everywhere = this.query.startsWith('*');
    let base: MailRecord[];
    if (search) {
      base = searchFolderMessages(this.data, search);
      if (typed) base = base.filter((m) => typed.matches(m, this.data));
    } else if (typed) base = this.data.messages.filter((m) => (everywhere || m.folder === this.folder) && typed.matches(m, this.data));
    else base = inFolder(this.data, this.folder);
    if (this.kept.size && (search || typed)) {
      const have = new Set(base.map((m) => m.id));
      base = base.concat(this.data.messages.filter((m) => !have.has(m.id) && this.kept.get(m.id) === m.folder));
    }
    return base.filter((m) => matchesFilter(m, this.view.filter) || this.kept.has(m.id)).sort(compareMessages(this.view, this.outgoing));
  }

  /** What was typed in the search box and is not understood. */
  get searchErrors(): string[] {
    return this.query.trim() ? parseQuery(this.query.replace(/^\s*\*\s*/, '')).errors : [];
  }

  private keep(m: MailRecord): void {
    if (this.view.filter !== 'all' || this.query.trim() || this.folder.startsWith('q:')) this.kept.set(m.id, m.folder);
  }

  /** The rows of the list: messages, headings of groups and conversations. */
  rows(): ListRow[] {
    const key = `${this.version}|${this.folder}|${this.query}|${this.data.messages.length}`;
    if (this.rowCache?.key === key) return this.rowCache.rows;
    let threads: { of: Map<string, string>; members: Map<string, MailRecord[]> } | undefined;
    if (this.view.conversations) {
      // what was thrown away or is not finished does not belong to the conversation seen from another folder
      const apart = new Set(['trash', 'junk', 'drafts', 'outbox']);
      const all = this.data.messages.filter((m) => m.folder === this.folder || !apart.has(m.folder));
      const of = conversationsOf(all);
      const members = new Map<string, MailRecord[]>();
      for (const m of all) {
        const k = of.get(m.id)!;
        const l = members.get(k);
        if (l) l.push(m);
        else members.set(k, [m]);
      }
      threads = { of, members };
    }
    const rows = listRows({ messages: this.list(), view: this.view, now: Date.now(), outgoing: this.outgoing, closed: this.closedGroups, open: this.openThreads, threads });
    this.rowCache = { key, rows };
    return rows;
  }

  toggleGroup(key: string): void {
    if (!this.closedGroups.delete(key)) this.closedGroups.add(key);
    this.touch();
  }

  toggleThread(key: string): void {
    if (!this.openThreads.delete(key)) this.openThreads.add(key);
    this.touch();
  }

  get selected(): MailRecord | null {
    return this.data.messages.find((m) => m.id === this.selectedId) ?? null;
  }

  /** The messages an action affects. */
  selectedIds(): string[] {
    if (!this.selectedId) return [];
    if (!this.selection.has(this.selectedId)) return this.selected ? [this.selectedId] : [];
    const alive = new Set(this.data.messages.map((m) => m.id));
    return [...this.selection].filter((id) => alive.has(id));
  }
  get selectedRecords(): MailRecord[] {
    const ids = new Set(this.selectedIds());
    return this.data.messages.filter((m) => ids.has(m.id));
  }
  /** The message that answering or printing act on: the only one selected, or the last of a conversation selected whole. */
  get single(): MailRecord | null {
    return this.selectedThread || this.selectedIds().length === 1 ? this.selected : null;
  }
  isSelected(id: string): boolean {
    if (!this.selectedId) return false;
    // a selection that does not hold what is being read is an old one
    return this.selection.has(this.selectedId) ? this.selection.has(id) : this.selectedId === id;
  }

  private read(m: MailRecord): void {
    this.keep(m);
    if (!m.read) {
      m.read = true;
      this.pushFlag(m, RFC_FLAGS.seen, true);
      this.touch(true);
    } else this.touch();
  }

  select(id: string | null): void {
    // looking at another message leaves the one being written, kept as a draft
    if (this.compose && id !== this.compose.draftId) this.leaveCompose();
    this.selectedId = id;
    this.selection = new Set(id ? [id] : []);
    this.selectedThread = null;
    this.anchorRow = this.cursorRow = id ? `m:${id}` : null;
    const m = this.selected;
    if (m) this.read(m);
    else this.touch();
  }

  /** A click or a key on a row of the list: alone, with Ctrl (add or take away) or with Shift (everything in between). */
  selectRow(key: string, how: { add?: boolean; range?: boolean } = {}): void {
    const rows = this.rows().filter((r): r is Extract<ListRow, { type: 'message' }> => r.type === 'message');
    const at = rows.findIndex((r) => r.key === key);
    const row = rows[at];
    if (!row) return;
    const idsOf = (r: (typeof rows)[number]) => r.thread?.ids ?? [r.rec.id];
    const anchor = rows.findIndex((r) => r.key === this.anchorRow);
    if (how.range && anchor >= 0) {
      this.leaveCompose();
      const ids = rows.slice(Math.min(anchor, at), Math.max(anchor, at) + 1).flatMap(idsOf);
      this.selection = new Set(how.add ? [...this.selectedIds(), ...ids] : ids);
      this.selectedId = row.rec.id;
      this.selectedThread = null;
    } else if (how.add) {
      this.leaveCompose();
      const now = new Set(this.selectedIds());
      const had = idsOf(row).every((id) => now.has(id));
      for (const id of idsOf(row)) had ? now.delete(id) : now.add(id);
      this.selection = now;
      this.selectedId = had ? ([...now].pop() ?? null) : row.rec.id;
      this.selectedThread = null;
      this.anchorRow = key;
    } else if (row.thread) {
      if (this.compose) this.leaveCompose();
      this.selection = new Set(row.thread.ids);
      this.selectedId = row.rec.id;
      this.selectedThread = row.thread.key;
      this.anchorRow = this.cursorRow = key;
      for (const x of this.records(row.thread.ids)) this.keep(x);
      this.read(row.rec);
      return;
    } else {
      this.select(row.rec.id);
      this.anchorRow = this.cursorRow = key;
      this.touch();
      return;
    }
    for (const x of this.records([...this.selection])) this.keep(x);
    this.cursorRow = key;
    this.touch();
  }

  selectAll(): void {
    this.leaveCompose();
    const list = this.list();
    this.selection = new Set(list.map((m) => m.id));
    this.selectedThread = null;
    if (!this.selectedId || !this.selection.has(this.selectedId)) this.selectedId = list[0]?.id ?? null;
    this.touch();
  }

  importRaw(raw: string | Uint8Array, into = this.folder, opts: { read?: boolean; bcc?: string[] } = {}): MailRecord {
    // a search folder holds nothing of its own
    const folder = this.data.folders.some((f) => f.id === into) ? into : 'inbox';
    const rec = addRaw(this.data, folder, raw, { read: opts.read ?? folder !== 'inbox', bcc: opts.bcc?.length ? opts.bcc : undefined });
    this.touch(true);
    return rec;
  }

  // ---------- actions on messages ----------

  records(ids: string[]): MailRecord[] {
    const want = new Set(ids);
    return this.data.messages.filter((m) => want.has(m.id));
  }

  private remember(label: string, part: UndoPart): void {
    if (!part.changes.length && !part.created?.length) return;
    if (this.gathering) this.gathering.push(part);
    else this.push({ label, parts: [part] });
  }

  private push(step: UndoStep): void {
    this.undoSteps.push(step);
    if (this.undoSteps.length > UNDO_DEPTH) this.undoSteps.shift();
  }

  /** Several actions that one undo takes back together. With `undoable` false nothing is kept (what arrives by itself). */
  together(label: string, run: () => void, undoable = true): void {
    if (this.gathering) return run();
    const parts: UndoPart[] = [];
    this.gathering = parts;
    try {
      run();
    } finally {
      this.gathering = null;
    }
    if (undoable && parts.length) this.push({ label, parts });
  }

  /** What the next undo takes back; empty when there is nothing. */
  get undoLabel(): string {
    return this.undoSteps[this.undoSteps.length - 1]?.label ?? '';
  }

  /** Before messages leave the list: which one is read afterwards. */
  private afterLeaving(): (gone: Set<string>) => void {
    const order = this.rows().flatMap((r) => (r.type === 'message' ? [r.rec.id] : []));
    return (gone) => {
      for (const id of gone) this.selection.delete(id);
      if (!this.selectedId || !gone.has(this.selectedId)) return;
      const from = order.indexOf(this.selectedId);
      const visible = new Set(this.list().map((m) => m.id));
      const stays = (id: string) => !gone.has(id) && visible.has(id);
      const next = from < 0 ? undefined : (order.slice(from + 1).find(stays) ?? order.slice(0, from).reverse().find(stays));
      this.selectedId = next ?? null;
      this.selection = new Set(next ? [next] : []);
      this.selectedThread = null;
      this.anchorRow = this.cursorRow = next ? `m:${next}` : null;
    };
  }

  /** Changes read, flag, follow-up or categories of messages; the server is told what it keeps. */
  mark(ids: string[], label: string, apply: (m: MailRecord) => void): void {
    const changes: Change[] = [];
    this.batch(() => {
      for (const m of this.records(ids)) {
        const was = snapshot(m);
        apply(m);
        if (sameMarks(was, m)) continue;
        changes.push(was);
        this.keep(m);
        if (m.read !== was.read) this.pushFlag(m, RFC_FLAGS.seen, m.read);
        if (m.flagged !== was.flagged) this.pushFlag(m, RFC_FLAGS.flagged, m.flagged);
      }
    });
    this.remember(label, { changes, marks: true });
    this.touch(changes.length > 0);
  }

  setRead(id: string, read: boolean): void {
    this.setReadMany([id], read);
  }

  setReadMany(ids: string[], read: boolean): void {
    this.mark(ids, read ? 'Marcar como leído' : 'Marcar como no leído', (m) => {
      m.read = read;
    });
  }

  /** The flag of the list, like Outlook's: it marks for follow-up, and on a flagged message it marks it completed. */
  toggleFlag(id: string): void {
    const m = this.data.messages.find((x) => x.id === id);
    if (!m) return;
    if (m.flagged) this.completeMany([id]);
    else this.setFlagMany([id], true);
  }

  setFlagMany(ids: string[], on: boolean): void {
    this.mark(ids, on ? 'Marcar con bandera' : 'Quitar la bandera', (m) => {
      if (!on) clearFollow(m);
      else if (!m.flagged) setFollow(m, null);
    });
  }

  followMany(ids: string[], due: number | null, remind?: number): void {
    this.mark(ids, 'Seguimiento', (m) => setFollow(m, due, remind));
  }

  completeMany(ids: string[]): void {
    const now = Date.now();
    this.mark(ids, 'Marcar como completado', (m) => {
      if (m.flagged || m.follow?.done === undefined) completeFollow(m, now);
    });
  }

  categorize(ids: string[], name: string, on: boolean): void {
    this.mark(ids, on ? 'Categorizar' : 'Quitar la categoría', (m) => void setCategory(m, name, on));
  }

  clearCategories(ids: string[]): void {
    this.mark(ids, 'Quitar las categorías', (m) => {
      delete m.categories;
    });
  }

  private accountName(id: string): string {
    return this.accounts.find((a) => a.id === id)?.name ?? id;
  }

  /**
   * Mueve un mensaje. Si vino de un servidor, también se mueve allí (a la carpeta equivalente de esa cuenta). Devuelve false
   * si no se pudo: por ejemplo la carpeta solo existe en este equipo y el mensaje está en el servidor.
   */
  move(id: string, folder: string): boolean {
    return this.moveMany([id], folder);
  }

  /** Mueve varios; los que no se puedan se quedan donde estaban y devuelve false. */
  moveMany(ids: string[], folder: string): boolean {
    const after = this.afterLeaving();
    const changes: Change[] = [];
    const gone = new Set<string>();
    let all = true;
    this.batch(() => {
      for (const m of this.records(ids)) {
        if (m.folder === folder) continue;
        const was = snapshot(m);
        if (!this.relocate(m, folder, was)) {
          all = false;
          continue;
        }
        changes.push(was);
        gone.add(m.id);
      }
    });
    this.remember(folder === 'archive' ? 'Archivar' : folder === 'junk' ? 'Correo no deseado' : folder === 'trash' ? 'Eliminar' : 'Mover', { changes });
    after(gone);
    this.touch(changes.length > 0);
    return all;
  }

  private relocate(m: MailRecord, folder: string, was?: Change): boolean {
    if (folder === 'outbox') return false;
    if (this.outbox.isSending(m.id)) {
      this.syncMessage = 'Se está enviando: espera a que termine.';
      return false;
    }
    // taken out of the Outbox, it is no longer sent
    delete m.outgoing;
    if (this.compose?.draftId === m.id) this.endCompose(false);
    const r = m.remote;
    if (r) {
      const to = folderTarget(this.data, r.account, folder);
      const acc = this.accounts.find((a) => a.id === r.account);
      const pop3 = !!acc && protocolOf(acc) === 'pop3';
      if (to === undefined && !pop3) {
        this.syncMessage = `No se puede mover ahí: ${this.accountName(r.account)} no tiene una carpeta equivalente en el servidor. Crea la carpeta en la cuenta o elige otra.`;
        return false;
      }
      if (to !== undefined && to !== r.folder) {
        this.queue({ account: r.account, kind: 'move', folder: r.folder, keys: [r.key], to });
        if (was) was.sent = { kind: 'move', to };
        // al cambiar de carpeta el servidor le da otro identificador: se reconocerá al sincronizar la carpeta nueva
        delete m.remote;
      }
    }
    m.folder = folder;
    return true;
  }

  /**
   * Puts a copy of each message in a folder. In a folder of an account the copy is also added on the server; it is
   * recognised there by its Message-ID.
   */
  copyMany(ids: string[], folder: string): void {
    const target = this.data.folders.find((f) => f.id === folder);
    if (!target) return;
    const created: string[] = [];
    this.batch(() => {
      for (const m of this.records(ids)) {
        const copy: MailRecord = { ...m, id: newMailId(), folder, categories: m.categories ? [...m.categories] : undefined, follow: m.follow ? { ...m.follow } : undefined, bcc: m.bcc ? [...m.bcc] : undefined };
        delete copy.remote;
        const account = target.remote?.account ?? (m.remote && folderTarget(this.data, m.remote.account, folder) !== undefined ? m.remote.account : undefined);
        const to = account ? folderTarget(this.data, account, folder) : undefined;
        this.data.messages.push(copy);
        created.push(copy.id);
        // a POP3 server keeps no copies: asking for it would fail every time and hold back the changes after it
        const acc = this.accounts.find((a) => a.id === account);
        if (account && to !== undefined && !(acc && protocolOf(acc) === 'pop3')) {
          this.serverCopies.add(copy.id);
          this.queue({ account, kind: 'append', folder: to, raw: copy.raw, seen: copy.read });
        }
      }
    });
    this.remember('Copiar', { changes: [], created });
    this.touch(created.length > 0);
  }

  /** Whether deleting these asks first: what would be removed for good from a server (or any, with Shift+Delete). */
  deleteQuestion(ids: string[], permanent = false): string | null {
    const doomed = this.records(ids).filter((m) => permanent || m.folder === 'trash');
    if (!doomed.length) return null;
    const server = doomed.some((m) => m.remote);
    if (!permanent && !server) return null;
    return server ? 'server' : 'local';
  }

  /** Eliminar: a Elementos eliminados (en el servidor también); desde ahí, o con `permanent`, para siempre. */
  delete(id: string): void {
    this.deleteMany([id]);
  }

  deleteMany(ids: string[], permanent = false): void {
    const after = this.afterLeaving();
    const changes: Change[] = [];
    const gone = new Set<string>();
    this.batch(() => {
      for (const rec of this.records(ids)) {
        if (this.outbox.isSending(rec.id)) {
          this.syncMessage = 'Se está enviando: espera a que termine.';
          continue;
        }
        if (this.compose?.draftId === rec.id) this.endCompose(false);
        const was = snapshot(rec);
        const r = rec.remote;
        gone.add(rec.id);
        if (permanent || rec.folder === 'trash') {
          was.removed = { ...rec };
          if (r) {
            this.queue({ account: r.account, kind: 'remove', folder: r.folder, keys: [r.key] });
            was.sent = { kind: 'remove' };
          }
          this.data.messages = this.data.messages.filter((m) => m.id !== rec.id);
        } else {
          if (r) {
            const trash = folderTarget(this.data, r.account, 'trash');
            if (trash !== undefined && trash !== r.folder) {
              this.queue({ account: r.account, kind: 'move', folder: r.folder, keys: [r.key], to: trash });
              was.sent = { kind: 'move', to: trash };
            } else {
              this.queue({ account: r.account, kind: 'remove', folder: r.folder, keys: [r.key] });
              was.sent = { kind: 'remove' };
            }
            delete rec.remote;
          }
          rec.folder = 'trash';
          delete rec.outgoing;
        }
        changes.push(was);
      }
    });
    this.remember('Eliminar', { changes });
    after(gone);
    this.touch(changes.length > 0);
  }

  emptyFolder(folder: string): number {
    const doomed = this.data.messages.filter((m) => m.folder === folder);
    const groups = new Map<string, { account: string; folder: string; keys: string[] }>();
    for (const m of doomed) {
      if (!m.remote) continue;
      const k = `${m.remote.account}|${m.remote.folder}`;
      const g = groups.get(k) ?? { account: m.remote.account, folder: m.remote.folder, keys: [] };
      g.keys.push(m.remote.key);
      groups.set(k, g);
    }
    for (const g of groups.values()) this.queue({ account: g.account, kind: 'remove', folder: g.folder, keys: g.keys });
    this.data.messages = this.data.messages.filter((m) => m.folder !== folder);
    this.selectedId = null;
    this.resetList();
    this.touch(true);
    return doomed.length;
  }

  /** Takes back the last action on messages. What was already done on the server is taken back there too. */
  undo(): void {
    const step = this.undoSteps.pop();
    if (!step) return;
    const back: Change[] = [];
    /** Marks of messages that first have to come back on the server. */
    const later: Change[] = [];
    const notes = new Set<string>();
    const restored: string[] = [];
    const parts = [...step.parts].reverse();
    const marks = parts.filter((p) => p.marks).flatMap((p) => [...p.changes].reverse());
    const done = new Set<Change>();
    const unmark = (c: Change, m: MailRecord) => {
      this.restoreMarks(m, c);
      done.add(c);
      restored.push(m.id);
    };
    this.batch(() => {
      // what is known on the server where it is now gets its marks back there before it moves again
      for (const c of marks) {
        const m = this.data.messages.find((x) => x.id === c.id);
        if (m?.remote) unmark(c, m);
      }
      for (const part of parts) {
        if (part.created) this.removeCopies(part.created, notes);
        if (!part.marks) for (const c of [...part.changes].reverse()) this.restorePlace(c, back, notes, restored);
      }
      for (const c of marks) {
        const m = this.data.messages.find((x) => x.id === c.id);
        if (!m || done.has(c)) continue;
        if (back.some((x) => x.id === c.id)) later.push(c);
        else unmark(c, m);
      }
    });
    this.reselect(restored);
    this.syncMessage = notes.size ? [...notes].join(' ') : back.length ? 'Deshaciendo en el servidor…' : '';
    this.touch(true);
    if (back.length) this.undoing = this.undoing.then(() => this.undoOnServer(back, later));
  }

  /** Puts a message back where it was; what the server has to do first is left in `back`. */
  private restorePlace(c: Change, back: Change[], notes: Set<string>, restored: string[]): void {
    // what was waiting to be sent comes back as a draft: it is not sent by undoing
    const home = c.folder === 'outbox' ? 'drafts' : this.data.folders.some((f) => f.id === c.folder) ? c.folder : 'inbox';
    let m = this.data.messages.find((x) => x.id === c.id);
    if (!m) {
      if (!c.removed) return;
      m = { ...c.removed, folder: home };
      delete m.outgoing;
      if (c.remote && c.sent && !cancelPending(this.data, 'remove', c.remote.account, c.remote.folder, c.remote.key, this.inflight)) {
        delete m.remote;
        notes.add('Ya se había borrado del servidor: se recupera solo en este equipo.');
      }
      this.data.messages.push(m);
    } else if (m.folder !== home) {
      if (c.remote && !m.remote) {
        const r = c.remote;
        if (c.sent && cancelPending(this.data, c.sent.kind, r.account, r.folder, r.key, this.inflight)) {
          m.remote = { ...r };
          m.folder = home;
        } else if (c.sent?.kind === 'move') {
          back.push(c);
          return;
        } else {
          m.folder = home;
          notes.add('Ya se había borrado del servidor: se recupera solo en este equipo.');
        }
      } else if (!this.relocate(m, home)) return;
    }
    restored.push(m.id);
  }

  private removeCopies(ids: string[], notes: Set<string>): void {
    for (const m of this.records(ids)) {
      if (m.remote) this.queue({ account: m.remote.account, kind: 'remove', folder: m.remote.folder, keys: [m.remote.key] });
      else {
        const queued = this.data.pending?.find((o) => o.kind === 'append' && o.raw === m.raw && o.id !== this.inflight);
        if (queued) completeOp(this.data, queued.id);
        else if (this.serverCopies.has(m.id)) notes.add('La copia ya se había enviado al servidor: volverá al sincronizar.');
      }
    }
    const gone = new Set(ids);
    this.data.messages = this.data.messages.filter((m) => !gone.has(m.id));
  }

  private restoreMarks(m: MailRecord, c: Change): void {
    if (m.read !== c.read) {
      m.read = c.read;
      this.pushFlag(m, RFC_FLAGS.seen, c.read);
    }
    if (m.flagged !== c.flagged) {
      m.flagged = c.flagged;
      this.pushFlag(m, RFC_FLAGS.flagged, c.flagged);
    }
    if (c.categories) m.categories = [...c.categories];
    else delete m.categories;
    if (c.follow) m.follow = { ...c.follow };
    else delete m.follow;
  }

  /** What comes back is selected again, if it can be seen here. */
  private reselect(ids: string[]): void {
    const visible = new Set(this.list().map((m) => m.id));
    const here = [...new Set(ids)].filter((id) => visible.has(id));
    if (!here.length || this.compose) return;
    this.selection = new Set(here);
    this.selectedId = here[here.length - 1]!;
    this.selectedThread = null;
    this.anchorRow = this.cursorRow = `m:${this.selectedId}`;
  }

  /**
   * A move that the server already did: the folder where the message went is read to know its new identifier there, and
   * then it is moved back.
   */
  private async undoOnServer(changes: Change[], marks: Change[] = []): Promise<void> {
    const failed: string[] = [];
    try {
      await this.relinking;
      await this.flushDone;
      await this.flush();
      const places = new Map<string, { account: string; folder: string }>();
      for (const c of changes) if (c.remote && c.sent?.kind === 'move') places.set(`${c.remote.account}|${c.sent.to}`, { account: c.remote.account, folder: c.sent.to });
      for (const p of places.values()) await this.pullFolder(p.account, p.folder);
    } catch (e) {
      failed.push(messageOf(e));
    }
    const restored: string[] = [];
    let lost = 0;
    this.batch(() => {
      for (const c of changes) {
        const m = this.data.messages.find((x) => x.id === c.id);
        const home = this.data.folders.some((f) => f.id === c.folder) ? c.folder : 'inbox';
        if (!m?.remote || !this.relocate(m, home)) {
          lost++;
          continue;
        }
        restored.push(m.id);
      }
    });
    await this.flush();
    await this.relink();
    // the marks go back once the message is known again on the server
    if (marks.length)
      this.batch(() => {
        for (const c of marks) {
          const m = this.data.messages.find((x) => x.id === c.id);
          if (m) this.restoreMarks(m, c);
        }
      });
    this.reselect(restored);
    this.touch(true);
    await this.flush();
    await this.relink();
    this.syncMessage = lost ? `No se pudo deshacer en el servidor${failed.length ? `: ${failed.join(' · ')}` : ': no se encontró el mensaje en la carpeta a la que se movió.'}` : 'Deshecho también en el servidor.';
    this.touch();
  }

  // ---------- folders ----------

  /** Una carpeta solo de este equipo (si es una subcarpeta, dentro de `parent`). */
  addFolder(name: string, parent: string | null = null): void {
    const n = name.trim();
    if (!n) return;
    if (/[/\\]/.test(n)) throw new Error('El nombre de la carpeta no puede llevar barras.');
    if (childrenOf(this.data, parent).some((f) => f.name.toLowerCase() === n.toLowerCase())) throw new Error('Ya existe una carpeta con ese nombre.');
    const f: Folder = { id: `f${newMailId()}`, name: n, system: false };
    if (parent) f.parent = parent;
    this.data.folders.push(f);
    this.touch(true);
  }

  /** La ruta en el servidor de una carpeta de Nova Mail, para crear una subcarpeta dentro de ella. */
  private serverPathOf(account: string, folder: string): string {
    const sys = this.data.servers?.[account]?.paths?.[folder as SpecialFolder];
    if (sys) return sys;
    const f = this.data.folders.find((x) => x.id === folder);
    if (f?.remote?.account === account) return f.remote.path;
    const prefix = `c:${account}:`;
    if (folder.startsWith(prefix)) return folder.slice(prefix.length);
    throw new Error(`Esa carpeta no está en la cuenta ${this.accountName(account)}.`);
  }

  /** Crea una carpeta (o subcarpeta) en el servidor de una cuenta y la trae. */
  async addServerFolder(account: string, name: string, parent: string | null = null): Promise<void> {
    const n = name.trim();
    if (!n) return;
    if (/[/\\]/.test(n)) throw new Error('El nombre de la carpeta no puede llevar barras.');
    const path = parent ? `${this.serverPathOf(account, parent)}/${n}` : n;
    await remote.createFolder(account, path);
    await this.syncAll();
  }

  editFolder(edit: MailCtl['folderEdit']): void {
    if (this.folderEdit === edit) return;
    this.folderEdit = edit;
    this.touch();
  }

  markFolderRead(id: string): void {
    this.setReadMany(
      this.data.messages.filter((m) => m.folder === id && !m.read).map((m) => m.id),
      true,
    );
  }

  toggleFavorite(id: string): void {
    toggleFavorite(this.data, id);
    this.touch(true);
  }

  async renameFolder(id: string, name: string): Promise<void> {
    const f = this.data.folders.find((x) => x.id === id);
    if (!f || !canChangeFolder(f)) throw new Error('Esa carpeta no se puede cambiar.');
    const n = folderName(this.data, name, f.parent ?? null, id);
    if (n === f.name) return;
    if (f.remote) return this.relocateOnServer(f, n, f.parent ?? null);
    f.name = n;
    this.touch(true);
  }

  async moveFolder(id: string, parent: string | null): Promise<void> {
    const f = this.data.folders.find((x) => x.id === id);
    if (!f || (f.parent ?? null) === parent) return;
    if (!folderParents(this.data, id).includes(parent)) throw new Error('Esa carpeta no se puede mover ahí.');
    const n = folderName(this.data, f.name, parent, id);
    if (f.remote) return this.relocateOnServer(f, n, parent);
    if (parent) f.parent = parent;
    else delete f.parent;
    this.touch(true);
  }

  /** Renames or moves a folder of an account: the server first, and what is here follows it. */
  private async relocateOnServer(f: Folder, name: string, parent: string | null): Promise<void> {
    const { account, name: remoteName, path: oldPath } = f.remote!;
    const path = parent ? `${this.serverPathOf(account, parent)}/${name}` : name;
    await this.flushDone;
    await this.flush();
    if (this.data.pending?.some((o) => o.account === account)) throw new Error('Hay cambios sin enviar al servidor: no se puede cambiar la carpeta hasta enviarlos.');
    const inside = descendants(this.data, f.id)
      .map((id) => this.data.folders.find((x) => x.id === id)!)
      .filter((x) => x.remote?.account === account)
      .map((x) => ({ id: x.id, name: x.remote!.name, path: x.remote!.path }));
    await remote.renameFolder(account, remoteName, path);
    const plan = planFolders(account, await remote.folders(account));
    this.batch(() => {
      for (const old of inside) {
        const now = plan.folders.find((p) => p.path === path + old.path.slice(oldPath.length));
        if (!now) continue;
        if (this.folder === old.id) this.folder = now.local;
        if (this.openThreads.size) this.openThreads.clear();
        remapFolder(this.data, account, old, { id: now.local, name: now.remote });
      }
      applyPlan(this.data, account, plan);
    });
    if (!this.folderExists(this.folder)) this.folder = 'inbox';
    this.touch(true);
    await this.syncAll();
  }

  /**
   * Elimina una carpeta. Las subcarpetas hay que quitarlas antes. Una carpeta del servidor se borra allí con sus mensajes; una
   * local manda sus mensajes a Archivo.
   */
  deleteFolder(id: string): void {
    const f = this.data.folders.find((x) => x.id === id);
    if (!f || f.system || id.startsWith('c:')) return;
    if (childrenOf(this.data, id).length) throw new Error('Elimina primero las subcarpetas.');
    if (f.remote) {
      this.queue({ account: f.remote.account, kind: 'deleteFolder', folder: f.remote.name });
      this.data.messages = this.data.messages.filter((m) => m.folder !== id || !m.remote);
    }
    for (const m of this.data.messages) if (m.folder === id) m.folder = 'archive';
    this.data.folders = this.data.folders.filter((x) => x.id !== id);
    if (this.folder === id) this.folder = f.parent && this.data.folders.some((x) => x.id === f.parent) ? f.parent : 'inbox';
    this.touch(true);
  }

  /**
   * Trae carpetas y mensajes de un archivo de Outlook: una carpeta nueva (con el nombre del archivo) con todas las subcarpetas
   * dentro. Son carpetas y mensajes solo de este equipo. Devuelve cuántos mensajes se añadieron.
   */
  async importFolderTree(rootName: string, tree: { name: string; messages: { raw: string | Uint8Array; read: boolean; bcc: string[] }[]; children: unknown[] }[], onProgress?: (n: number) => void): Promise<number> {
    type Node = { name: string; messages: { raw: string | Uint8Array; read: boolean; bcc: string[] }[]; children: Node[] };
    let n = 0;
    const unique = (name: string, parent: string | null): string => {
      const taken = childrenOf(this.data, parent).map((f) => f.name.toLowerCase());
      let out = name.replace(/[/\\]/g, '-').trim() || 'Carpeta';
      for (let i = 2; taken.includes(out.toLowerCase()); i++) out = `${name.replace(/[/\\]/g, '-').trim() || 'Carpeta'} (${i})`;
      return out;
    };
    // cada cierto número de mensajes se cede el control para que la ventana no se quede congelada
    const step = async (): Promise<void> => {
      n++;
      if (n % 25 === 0) {
        onProgress?.(n);
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    };
    const add = async (node: Node, parent: string | null): Promise<void> => {
      const f: Folder = { id: `f${newMailId()}`, name: unique(node.name, parent), system: false };
      if (parent) f.parent = parent;
      this.data.folders.push(f);
      for (const m of node.messages) {
        addRaw(this.data, f.id, m.raw, { read: m.read, bcc: m.bcc.length ? m.bcc : undefined });
        await step();
      }
      for (const c of node.children as Node[]) await add(c, f.id);
    };
    const root: Folder = { id: `f${newMailId()}`, name: unique(rootName, null), system: false };
    this.data.folders.push(root);
    for (const node of tree as Node[]) {
      if (node.name === '') {
        for (const m of node.messages) {
          addRaw(this.data, root.id, m.raw, { read: m.read, bcc: m.bcc.length ? m.bcc : undefined });
          await step();
        }
      } else await add(node, root.id);
    }
    this.touch(true);
    return n;
  }

  // ---------- compose ----------

  // ---------- writing ----------

  /** The addresses of the person: their own, those of the accounts and those they have sent from. */
  ownAddresses(): Set<string> {
    const own = new Set<string>();
    const add = (email: string | undefined) => {
      const e = email?.trim().toLowerCase();
      if (e && e !== NO_ADDRESS) own.add(e);
    };
    add(this.data.owner.email);
    for (const a of this.accounts) add(a.email);
    for (const m of this.data.messages) if (m.folder === 'sent') add(m.fromEmail);
    return own;
  }

  /** The account a message arrived at (or, in Sent, left from); with a new message, the one of the folder being seen. */
  accountFor(rec?: MailRecord | null, parsed?: ParsedMessage): string | undefined {
    const known = (id: string | undefined) => (id && this.accounts.some((a) => a.id === id) ? id : undefined);
    const byAddress = (list: string[]) => {
      const wanted = new Set(list.map((e) => e.toLowerCase()));
      return this.accounts.find((a) => wanted.has(a.email.toLowerCase()))?.id;
    };
    const here = known(this.data.folders.find((f) => f.id === (rec?.folder ?? this.folder))?.remote?.account);
    if (!rec) return here ?? this.accounts[0]?.id;
    const m = parsed ?? parseMessage(rawOf(rec));
    const delivered = m.headers.filter(([k]) => /^(delivered-to|x-original-to)$/i.test(k)).map(([, v]) => v.trim());
    return known(rec.remote?.account) ?? byAddress([...m.to, ...m.cc].map((a) => a.email).concat(rec.bcc ?? [], delivered)) ?? byAddress(m.from.map((a) => a.email)) ?? here ?? this.accounts[0]?.id;
  }

  /** Contacts and people of the mail, for the suggestions of To, Cc and Bcc. */
  addressEntries(): BookEntry[] {
    // not rebuilt for every keystroke of the message being written
    if (this.book?.version !== this.version) this.book = { version: this.version, entries: addressBook(this.data, this.ownAddresses()) };
    return this.book.entries;
  }

  /** Starts writing a message. Whatever was being written is kept as a draft. */
  openCompose(c: ComposeState, before: MailRecord | null = null): void {
    if (this.compose === c) {
      this.touch();
      return;
    }
    this.composeNotice = '';
    this.leaveCompose();
    const now = signature(c);
    this.compose = c;
    this.session = { id: c.id, opened: now, kept: null, stored: now, before: before ? { ...before } : null };
    if (c.draftId) this.drafts.set(c.id, c.draftId);
    this.touch();
  }

  /** The written part of a new message: empty, with the signature of the account. */
  private blank(from: string | undefined, use: SignatureUse): Pick<ComposeState, 'body' | 'doc'> {
    const sig = signatureFor(from, use);
    if (!sig) return { body: '' };
    const doc = withSignature(docOf({ body: '' }), sig);
    return { body: renderMail(doc).text, doc: doc.toJSON() };
  }

  /** Another account to send from: its signature takes the place of the one there was. */
  withAccount(c: ComposeState, from: string): ComposeState {
    const use: SignatureUse = c.quote || c.inReplyTo ? 'reply' : 'new';
    const had = signatureFor(c.from, use);
    const sig = signatureFor(from, use);
    if (had?.id === sig?.id) return { ...c, from };
    const doc = withSignature(docOf(c), sig);
    return { ...c, from, doc: doc.toJSON(), body: renderMail(doc).text };
  }

  newMessage(to = ''): void {
    const from = this.accountFor();
    this.openCompose({ id: newMailId(), to, cc: '', bcc: '', subject: '', attachments: [], from, ...this.blank(from, 'new') });
  }

  reply(id: string, all: boolean): void {
    const rec = this.data.messages.find((m) => m.id === id);
    if (!rec) return;
    const m = parseMessage(rawOf(rec));
    const own = this.ownAddresses();
    for (const [k, v] of m.headers) if (/^(delivered-to|x-original-to)$/i.test(k)) own.add(v.trim().toLowerCase());
    const mine = (a: Address) => own.has(a.email.toLowerCase());
    const unique = (list: Address[], seen = new Set<string>()) =>
      list.map((a) => a.email).filter((e) => e && !seen.has(e.toLowerCase()) && !!seen.add(e.toLowerCase()));
    // answering a message of one's own writes again to the people it was sent to
    const sentByMe = !!m.from[0] && mine(m.from[0]);
    const first = sentByMe ? m.to : m.replyTo.length ? m.replyTo : m.from.slice(0, 1);
    const others = all && !sentByMe ? m.to : [];
    let to = unique([...first, ...others].filter((a) => !mine(a)));
    if (!to.length) to = unique(first);
    const cc = all ? unique(m.cc.filter((a) => !mine(a)), new Set(to.map((e) => e.toLowerCase()))) : [];
    const from = this.accountFor(rec, m);
    this.openCompose({
      id: newMailId(),
      to: to.join(', '),
      cc: cc.join(', '),
      bcc: '',
      subject: reSubject(m.subject, 'Re'),
      ...this.blank(from, 'reply'),
      quote: makeQuote(rawOf(rec), 'reply'),
      attachments: [],
      inReplyTo: m.messageId,
      references: [...m.references, m.messageId].filter(Boolean),
      from,
    });
  }

  forward(id: string): void {
    const rec = this.data.messages.find((m) => m.id === id);
    if (!rec) return;
    const m = parseMessage(rawOf(rec));
    const from = this.accountFor(rec, m);
    this.openCompose({
      id: newMailId(),
      to: '',
      cc: '',
      bcc: '',
      subject: reSubject(m.subject, 'Fwd'),
      ...this.blank(from, 'reply'),
      quote: makeQuote(rawOf(rec), 'forward'),
      attachments: m.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, data: a.data })),
      from,
    });
  }

  editDraft(id: string): void {
    if (this.compose?.draftId === id) return;
    const rec = this.data.messages.find((m) => m.id === id);
    if (!rec) return;
    const m = parseMessage(rawOf(rec));
    const fmt = (l: Address[]) => l.map((a) => a.email).join(', ');
    const sender = m.from[0]?.email.toLowerCase();
    this.openCompose(
      {
        id: newMailId(),
        to: fmt(m.to),
        cc: fmt(m.cc),
        bcc: (rec.bcc ?? []).join(', '),
        subject: m.subject,
        ...writtenOf(rec, m),
        importance: rec.importance,
        attachments: m.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, data: a.data })),
        draftId: id,
        inReplyTo: m.inReplyTo || undefined,
        references: m.references.length ? m.references : undefined,
        from: this.accounts.find((a) => a.email.toLowerCase() === sender)?.id ?? this.accountFor(),
      },
      rec,
    );
    this.selectedId = id;
    this.touch();
  }

  /** The window keeps here what is typed; it is saved as a draft a moment later. */
  updateCompose(next: ComposeState): void {
    const cur = this.compose;
    if (!cur || cur.id !== next.id || cur === next) return;
    this.compose = { ...next, draftId: cur.draftId };
    this.scheduleDraft();
  }

  private scheduleDraft(): void {
    const now = Date.now();
    if (!this.draftTimer) this.draftDue = now + DRAFT_MAX_WAIT;
    else clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => this.autosaveCompose(), Math.max(0, Math.min(DRAFT_DELAY, this.draftDue - now)));
  }

  private cancelDraftTimer(): void {
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = null;
  }

  /** Saves the message being written if it has something that the draft does not hold yet. */
  autosaveCompose(): void {
    this.cancelDraftTimer();
    const c = this.compose;
    const s = this.session;
    if (!c || !s || s.id !== c.id) return;
    if (signature(c) === s.stored || (isBlank(c) && !c.draftId)) return;
    this.saveDraft(c);
  }

  /** «Guardar borrador». */
  keepDraft(): void {
    const c = this.compose;
    if (!c) return;
    const record = this.saveDraft(c);
    if (this.session) this.session.kept = { signature: signature(c), record: { ...record } };
  }

  /** Whether closing would lose something: it changed since it was opened, or since it was last saved on purpose. */
  get composeUnsaved(): boolean {
    const c = this.compose;
    if (!c) return false;
    const s = this.session;
    if (!s || s.id !== c.id) return !isBlank(c);
    if (isBlank(c) && !s.kept && !s.before) return false;
    return signature(c) !== (s.kept?.signature ?? s.opened);
  }

  /** Close, Escape or a click outside: asks only if something would be lost. */
  requestCloseCompose(): void {
    if (!this.compose) return;
    if (this.composeUnsaved) {
      this.askClose = true;
      this.touch();
    } else if (this.session?.kept) {
      this.autosaveCompose();
      this.endCompose();
    } else this.discardCompose();
  }

  /** Leaving the message for something else: nothing is lost and nothing is asked. */
  leaveCompose(): void {
    if (!this.compose) return;
    if (this.composeUnsaved) {
      this.autosaveCompose();
      this.composeNotice = 'El mensaje sin enviar se guardó en Borradores.';
      this.endCompose();
    } else if (this.session?.kept) {
      this.autosaveCompose();
      this.endCompose();
    } else this.discardCompose();
  }

  /** Saves it and closes it. */
  closeSaving(): void {
    if (!this.compose) return;
    this.keepDraft();
    this.endCompose();
  }

  /** Throws away what was written: the draft goes back to its last version saved on purpose, if there was one. */
  discardCompose(): void {
    const c = this.compose;
    if (!c) return;
    const s = this.session;
    const back = s?.kept?.record ?? s?.before ?? null;
    const written = this.drafts.get(c.id) ?? c.draftId;
    let changed = false;
    if (written && written !== back?.id) {
      const n = this.data.messages.length;
      this.data.messages = this.data.messages.filter((m) => m.id !== written);
      changed = n !== this.data.messages.length;
      if (back && !this.data.messages.some((m) => m.id === back.id)) {
        this.data.messages.push({ ...back });
        changed = true;
      }
      if (this.selectedId === written) this.selectedId = back?.id ?? null;
    }
    this.drafts.delete(c.id);
    this.endCompose(false);
    this.touch(changed);
  }

  private endCompose(touch = true): void {
    this.cancelDraftTimer();
    this.compose = null;
    this.session = null;
    this.composePopped = false;
    this.askClose = false;
    if (touch) this.touch();
  }

  /** Closes the window of the message without saving or restoring anything. */
  closeCompose(): void {
    this.endCompose();
  }

  /** Build the RFC 5322 text of the draft being composed. */
  buildRaw(c: ComposeState, sender?: Address): { raw: string; to: Address[]; cc: Address[]; bcc: Address[] } {
    const to = splitRecipients(c.to), cc = splitRecipients(c.cc), bcc = splitRecipients(c.bcc);
    const content = messageContent(c);
    const account = this.accounts.find((a) => a.id === c.from);
    const from = sender ?? (account ? { name: this.data.owner.name || account.name, email: account.email } : this.data.owner.email ? this.data.owner : { name: '', email: NO_ADDRESS });
    const draft: Draft = { from, to, cc, bcc, subject: c.subject, text: content.text, ...(content.html ? { html: content.html } : {}), attachments: [...c.attachments, ...content.inline], inReplyTo: c.inReplyTo, references: c.references, importance: c.importance };
    return { raw: buildMessage(draft), to, cc, bcc };
  }

  saveDraft(c: ComposeState): MailRecord {
    const { raw, bcc } = this.buildRaw(c);
    const old = this.drafts.get(c.id) ?? c.draftId;
    if (old) this.data.messages = this.data.messages.filter((m) => m.id !== old);
    const rec = addRaw(this.data, 'drafts', raw, { read: true, bcc: bcc.map((a) => a.email) });
    const keep = stored(c);
    if (keep) rec.compose = keep;
    c.draftId = rec.id;
    this.drafts.set(c.id, rec.id);
    if (this.compose?.id === c.id) {
      this.compose.draftId = rec.id;
      if (this.session) this.session.stored = signature(this.compose);
    }
    if (old && this.selectedId === old) this.selectedId = rec.id;
    this.touch(true);
    return rec;
  }

  // ---------- servidor de correo (IMAP y SMTP) ----------

  get canConnect(): boolean {
    return canConnect();
  }

  async loadAccounts(): Promise<void> {
    if (!canConnect()) return;
    try {
      this.accounts = await remote.accounts();
    } catch (e) {
      this.syncMessage = messageOf(e);
    }
    this.touch();
    this.alerts.startWatch();
    this.outbox.schedule();
  }

  /** Anota un cambio que falta enviar al servidor y lo intenta enseguida (si falla, se reintenta en cada sincronización). */
  private queue(op: OpInput): void {
    enqueueOp(this.data, op);
    this.touch(true);
    this.flushSoon();
  }

  private pushFlag(rec: MailRecord, flag: string, on: boolean): void {
    const r = rec.remote;
    if (r) this.queue({ account: r.account, kind: 'flag', folder: r.folder, keys: [r.key], flag, on });
  }

  /** Cuántos cambios faltan por enviar al servidor. */
  get pendingCount(): number {
    return this.data.pending?.length ?? 0;
  }

  private flushSoon(): void {
    if (this.flushTimer || !canConnect()) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
      void this.flushDone.then(() => this.relink());
    }, 150);
  }

  private async runOp(op: PendingOp): Promise<void> {
    switch (op.kind) {
      case 'flag':
        return remote.setFlag(op.account, op.folder, op.keys, op.flag, op.on);
      case 'move':
        return remote.move(op.account, op.folder, op.keys, op.to);
      case 'remove':
        return remote.removeMessages(op.account, op.folder, op.keys);
      case 'append':
        return remote.append(op.account, op.folder, op.raw, op.seen);
      case 'createFolder':
        return remote.createFolder(op.account, op.path);
      case 'deleteFolder':
        return remote.deleteFolder(op.account, op.folder);
    }
  }

  /** Envía al servidor los cambios pendientes, en orden. Si una cuenta falla se deja y se sigue con las demás. */
  flush(): Promise<string[]> {
    if (this.flushing || !canConnect()) return Promise.resolve([]);
    const done = this.sendPending();
    this.flushDone = done;
    return done;
  }

  private async sendPending(): Promise<string[]> {
    this.flushing = true;
    const errors: string[] = [];
    const skip = new Set<string>();
    try {
      for (;;) {
        const op = (this.data.pending ?? []).find((o) => !skip.has(o.account) && this.accounts.some((a) => a.id === o.account));
        if (!op) break;
        const snap = JSON.parse(JSON.stringify(op)) as PendingOp;
        this.inflight = snap.id;
        try {
          await this.runOp(snap);
          // lo que se añadió a este cambio mientras se enviaba se queda pendiente
          const live = (this.data.pending ?? []).find((o) => o.id === snap.id);
          if (live && 'keys' in live && 'keys' in snap) {
            const done = new Set(snap.keys);
            live.keys = live.keys.filter((k) => !done.has(k));
            if (!live.keys.length) completeOp(this.data, live.id);
          } else completeOp(this.data, snap.id);
          if (snap.kind === 'move') this.movedInto.set(`${snap.account}|${snap.to}`, { account: snap.account, folder: snap.to });
          this.touch(true);
        } catch (e) {
          skip.add(snap.account);
          errors.push(`${this.accountName(snap.account)}: ${messageOf(e)}`);
        }
      }
    } finally {
      this.flushing = false;
      this.inflight = null;
    }
    if (errors.length) {
      this.syncMessage = `No se pudo actualizar el servidor (se reintentará): ${errors.join(' · ')}`;
      this.touch();
    }
    return errors;
  }

  /** Quita de la cola los cambios que eran para una cuenta que ya no existe. Sus mensajes ya descargados se conservan. */
  forgetAccount(id: string): void {
    this.data.pending = (this.data.pending ?? []).filter((o) => o.account !== id);
    if (!this.data.pending.length) delete this.data.pending;
    this.touch(true);
  }

  /**
   * The server gives a moved message another identifier: without it, what is done here to that message afterwards would
   * not reach the server. It is learnt by reading the folder where it went. If it fails, the next synchronisation does it.
   */
  private relink(): Promise<void> {
    this.relinking = this.relinking.then(async () => {
      while (this.movedInto.size && !this.syncing) {
        const [key, p] = this.movedInto.entries().next().value!;
        this.movedInto.delete(key);
        try {
          await this.pullFolder(p.account, p.folder);
        } catch {
          // la sincronización siguiente lo hará
        }
      }
    });
    return this.relinking;
  }

  /**
   * Puts in what was downloaded of a folder. Returns the messages that are new in the inbox, which the rules look at:
   * not the first time a folder is read (all of it would be new), nor after the server renumbers it.
   */
  private applyNew(account: string, p: FolderPlan, res: Fetched, watch: boolean): { added: number; arrived: string[] } {
    const before = watch && p.local === 'inbox' ? new Set(this.data.messages.map((m) => m.id)) : null;
    const added = applyFetched(this.data, account, p, res);
    return { added, arrived: before ? this.data.messages.filter((m) => !before.has(m.id)).map((m) => m.id) : [] };
  }

  /** Brings one folder of an account up to date. */
  private async pullFolder(account: string, folder: string): Promise<void> {
    const p = planFolders(account, await remote.folders(account)).folders.find((x) => x.remote === folder);
    if (!p) return;
    const state = await remote.state(account, p.remote);
    let missing: string[] = [];
    let watch = !!this.data.sync?.[syncKey(account, p.remote)];
    this.batch(() => {
      const r = reconcileFolder(this.data, account, p, state, { limit: this.syncLimit, maxBytes: MAX_MESSAGE_BYTES });
      watch &&= !r.reset;
      missing = r.missing;
    });
    const arrived: string[] = [];
    for (let i = 0; i < missing.length; i += FETCH_BATCH) {
      const res = await remote.fetch(account, p.remote, missing.slice(i, i + FETCH_BATCH), MAX_MESSAGE_BYTES);
      this.batch(() => {
        arrived.push(...this.applyNew(account, p, res, watch).arrived);
      });
    }
    this.organize.arrive(arrived);
    this.alerts.newMail(arrived);
  }

  /** The inbox of one account, at once: the server said that it changed. */
  async pullInbox(account: string): Promise<void> {
    while (this.syncing) await new Promise((done) => setTimeout(done, 250));
    const inbox = this.data.servers?.[account]?.targets.inbox;
    if (!inbox) return this.syncAll({ auto: true });
    this.relinking = this.relinking.then(async () => {
      if (this.syncing) return;
      try {
        await this.pullFolder(account, inbox);
      } catch {
        // the next synchronisation brings it
      }
    });
    await this.relinking;
  }

  /**
   * Sincroniza todas las cuentas: primero envía los cambios pendientes y después, de cada cuenta, trae la lista de carpetas
   * (con sus subcarpetas) y pone al día cada una: lo nuevo se baja, lo borrado o movido en el servidor se quita y las marcas
   * cambiadas se reflejan. Los mensajes que superan 25 MB no se descargan.
   */
  async syncAll(opts: { auto?: boolean } = {}): Promise<void> {
    if (this.syncing || !canConnect()) return;
    if (!this.accounts.length) {
      if (!opts.auto) {
        this.syncMessage = 'Todavía no hay ninguna cuenta. Añádela en Inicio → Cuentas.';
        this.touch();
      }
      return;
    }
    this.syncing = true;
    this.syncMessage = 'Sincronizando…';
    this.touch();
    await this.relinking;
    // everything is going to be read
    this.movedInto.clear();
    let added = 0;
    let removed = 0;
    let updated = 0;
    let big = 0;
    const errors: string[] = await this.flush();
    const arrived: string[] = [];
    for (const acc of this.accounts) {
      try {
        const plan = planFolders(acc.id, await remote.folders(acc.id));
        if (!plan.folders.some((p) => p.local === 'inbox')) errors.push(`${acc.name}: no se encontró la bandeja de entrada`);
        this.batch(() => {
          applyPlan(this.data, acc.id, plan);
        });
        for (const p of plan.folders) {
          try {
            const state = await remote.state(acc.id, p.remote);
            let missing: string[] = [];
            let watch = !!this.data.sync?.[syncKey(acc.id, p.remote)];
            this.batch(() => {
              const r = reconcileFolder(this.data, acc.id, p, state, { limit: this.syncLimit, maxBytes: MAX_MESSAGE_BYTES });
              watch &&= !r.reset;
              removed += r.removed;
              updated += r.updated;
              big += r.tooBig;
              missing = r.missing;
            });
            for (let i = 0; i < missing.length; i += FETCH_BATCH) {
              const res = await remote.fetch(acc.id, p.remote, missing.slice(i, i + FETCH_BATCH), MAX_MESSAGE_BYTES);
              this.batch(() => {
                const n = this.applyNew(acc.id, p, res, watch);
                added += n.added;
                arrived.push(...n.arrived);
              });
              big += res.skipped.length;
            }
          } catch (e) {
            errors.push(`${acc.name} (${folderPath(this.data, p.local) || p.path}): ${messageOf(e)}`);
          }
        }
      } catch (e) {
        errors.push(`${acc.name}: ${messageOf(e)}`);
      }
    }
    this.syncing = false;
    const organized = this.organize.arrive(arrived);
    this.alerts.newMail(arrived);
    if (!this.folderExists(this.folder)) this.folder = 'inbox';
    const parts = [added === 1 ? '1 mensaje nuevo' : `${added} mensajes nuevos`];
    if (removed) parts.push(removed === 1 ? '1 quitado (ya no está en el servidor)' : `${removed} quitados (ya no están en el servidor)`);
    if (updated) parts.push(updated === 1 ? '1 con marcas cambiadas' : `${updated} con marcas cambiadas`);
    if (big) parts.push(`${big} demasiado grandes (más de 25 MB) no se descargaron`);
    parts.push(...organized);
    const at = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    this.syncMessage = errors.length ? `Error al sincronizar: ${errors.join(' · ')}${added ? ` (${parts[0]})` : ''}` : `Sincronizado a las ${at}: ${parts.join(', ')}`;
    this.touch(added + removed + updated > 0);
  }

  /**
   * Envía el mensaje con una cuenta. El remitente es siempre la dirección de la cuenta. Con `at` (enviar más tarde), con
   * `keep` (dejarlo para cuando se pueda) o si hay un retraso para deshacer, espera en la Bandeja de salida; si no,
   * sale ahora y, si falla, no se pierde nada: sigue en la ventana de redacción.
   */
  async send(c: ComposeState, accountId: string, opts: { at?: number; keep?: string } = {}): Promise<void> {
    const acc = this.accounts.find((a) => a.id === accountId);
    if (!acc) throw new Error('Elige la cuenta desde la que enviar.');
    const sender: Address = { name: this.data.owner.name || acc.name, email: acc.email };
    const { raw, to, cc, bcc } = this.buildRaw(c, sender);
    const recipients = [...to, ...cc, ...bcc].map((a) => a.email.trim());
    if (!recipients.length) throw new Error('Falta algún destinatario.');
    const bad = recipients.find((r) => !EMAIL_OK.test(r));
    if (bad) throw new Error(`La dirección «${bad}» no es válida.`);
    const bytes = new TextEncoder().encode(raw);
    const hidden = bcc.map((a) => a.email);
    const out = { account: acc.id, recipients };
    if (opts.at !== undefined) return this.wait(c, bytes, hidden, { ...out, at: opts.at, kind: 'later' });
    if (opts.keep !== undefined) return this.wait(c, bytes, hidden, { ...out, at: Date.now() + retryDelay(1), kind: 'queued', tries: 1, error: opts.keep });
    const delay = this.alerts.settings.delay;
    if (delay > 0) return this.wait(c, bytes, hidden, { ...out, at: Date.now() + delay * 1000, kind: 'delay' });
    await remote.send(acc.id, recipients, encodeBase64(bytes));
    let note = '';
    this.batch(() => {
      this.dropDraft(c);
      note = this.afterSent(acc, bytes, hidden, c.inReplyTo);
      if (this.compose?.id === c.id) this.endCompose(false);
    });
    this.sayAsSent(recipients, note);
  }

  /** The draft saved while it was being written (even during the sending) goes away. */
  private dropDraft(c: ComposeState): void {
    const draft = this.drafts.get(c.id) ?? c.draftId;
    if (draft) this.data.messages = this.data.messages.filter((m) => m.id !== draft);
    this.drafts.delete(c.id);
  }

  /** Leaves a written message in the Outbox, as it was written, so that it can be taken back. */
  private wait(c: ComposeState, bytes: Uint8Array, bcc: string[], outgoing: Outgoing): void {
    this.batch(() => {
      this.dropDraft(c);
      const rec = addRaw(this.data, 'outbox', bytes, { read: true, bcc });
      const keep = stored(c);
      if (keep) rec.compose = keep;
      rec.outgoing = outgoing;
      if (this.compose?.id === c.id) this.endCompose(false);
    });
    this.syncMessage =
      outgoing.kind === 'later'
        ? 'Programado en la Bandeja de salida: se envía a su hora, con Nova Mail abierto.'
        : outgoing.kind === 'queued'
          ? 'El mensaje quedó en la Bandeja de salida: se enviará cuando se pueda.'
          : '';
    this.touch(true);
    this.outbox.schedule();
  }

  /** Saves the copy in Sent, marks the original as answered and asks the server for its copy. Returns a remark, if any. */
  private afterSent(acc: RemoteAccount, bytes: Uint8Array, bcc: string[], inReplyTo: string | undefined, copied = false): string {
    // JMAP y Exchange guardan por sí mismos la copia en Enviados; con IMAP se guarda aquí si la cuenta lo pide (Gmail y Outlook ya la guardan)
    const sentTarget = this.data.servers?.[acc.id]?.targets.sent;
    const wantCopy = !copied && protocolOf(acc) === 'imap' && savesSentCopy(acc);
    addRaw(this.data, 'sent', bytes, { read: true, bcc });
    // only now has the original been answered
    if (inReplyTo)
      for (const m of this.data.messages)
        if (m.mid === inReplyTo && !m.answered) {
          m.answered = true;
          this.pushFlag(m, RFC_FLAGS.answered, true);
        }
    if (wantCopy && sentTarget) this.queue({ account: acc.id, kind: 'append', folder: sentTarget, raw: encodeBase64(bytes), seen: true });
    else if (wantCopy) return ' (la copia en Enviados del servidor no se guardó: sincroniza la cuenta para que se conozca esa carpeta)';
    return '';
  }

  private sayAsSent(recipients: string[], note: string): void {
    this.syncMessage = `Mensaje enviado a ${recipients.length === 1 ? recipients[0] : `${recipients.length} destinatarios`}${note}`;
    this.touch();
  }

  /** A message of the Outbox has left. */
  delivered(m: MailRecord, acc: RemoteAccount, raw: string, before = false): void {
    const recipients = m.outgoing?.recipients ?? [];
    const inReplyTo = parseMessage(rawOf(m)).inReplyTo || undefined;
    const after = this.afterLeaving();
    let note = '';
    this.batch(() => {
      this.data.messages = this.data.messages.filter((x) => x.id !== m.id);
      note = this.afterSent(acc, decodeBase64(raw), m.bcc ?? [], inReplyTo, before);
    });
    after(new Set([m.id]));
    this.sayAsSent(recipients, note);
  }

  // ---------- opening and reminders ----------

  /** Goes to a message and reads it (from a notice, from the tasks). */
  openMessage(id: string): void {
    const m = this.data.messages.find((x) => x.id === id);
    if (!m) return;
    this.go('mail');
    this.setFolder(m.folder);
    this.select(m.id);
  }

  openReminder(key: string): void {
    if (key.startsWith('f:')) return this.openMessage(key.slice(2));
    const at = key.lastIndexOf('@');
    const start = Number(key.slice(at + 1));
    this.go('calendar');
    this.selectedEvent = key.slice(0, at);
    if (Number.isFinite(start)) this.setAnchor(start);
  }

  dueReminders(now = Date.now()): DueReminder[] {
    return dueReminders(this.data, now);
  }

  dismissReminder(key: string): void {
    dismissReminder(this.data, key);
    this.touch(true);
  }

  snoozeReminder(key: string, minutes: number): void {
    snoozeReminder(this.data, key, Date.now() + minutes * 60_000);
    this.touch(true);
  }

  // ---------- calendar ----------

  setAnchor(t: number): void {
    this.anchor = t;
    this.touch();
  }

  addEvent(ev: CalEvent): void {
    this.data.events = [...this.data.events, ev];
    this.selectedEvent = ev.id;
    this.touch(true);
  }

  updateEvent(ev: CalEvent): void {
    this.data.events = this.data.events.map((e) => (e.id === ev.id ? ev : e));
    this.touch(true);
  }

  deleteEvent(id: string): void {
    this.data.events = this.data.events.filter((e) => e.id !== id);
    if (this.selectedEvent === id) this.selectedEvent = null;
    this.touch(true);
  }

  newEventAt(start: number, allDay = false): CalEvent {
    return { ...newEvent(start, allDay ? addDays(start, 1) : start + 3600000, ''), allDay };
  }

  // ---------- contacts ----------

  addContact(c: Contact = newContact()): Contact {
    this.data.contacts = [...this.data.contacts, c];
    this.selectedContact = c.id;
    this.touch(true);
    return c;
  }

  updateContact(c: Contact): void {
    this.data.contacts = this.data.contacts.map((x) => (x.id === c.id ? c : x));
    this.touch(true);
  }

  deleteContact(id: string): void {
    this.data.contacts = this.data.contacts.filter((c) => c.id !== id);
    if (this.selectedContact === id) this.selectedContact = null;
    this.touch(true);
  }

  // ---------- tasks ----------

  addTask(title: string): TaskItem {
    const t = newTask(title.trim());
    this.data.tasks = [...this.data.tasks, t];
    this.selectedTask = t.id;
    this.touch(true);
    return t;
  }

  updateTask(t: TaskItem): void {
    this.data.tasks = this.data.tasks.map((x) => (x.id === t.id ? t : x));
    this.touch(true);
  }

  toggleTask(id: string): void {
    const t = this.data.tasks.find((x) => x.id === id);
    if (!t) return;
    this.updateTask({ ...t, done: !t.done, completedAt: t.done ? null : Date.now() });
  }

  deleteTask(id: string): void {
    this.data.tasks = this.data.tasks.filter((t) => t.id !== id);
    if (this.selectedTask === id) this.selectedTask = null;
    this.touch(true);
  }
}
