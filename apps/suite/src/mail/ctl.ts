import {
  RFC_FLAGS,
  addRaw,
  applyFetched,
  applyPlan,
  buildMessage,
  childrenOf,
  completeOp,
  encodeBase64,
  enqueueOp,
  folderPath,
  folderTarget,
  planFolders,
  reconcileFolder,
  inFolder,
  newContact,
  newEvent,
  newMailData,
  newMailId,
  newTask,
  parseMessage,
  quoteText,
  rawOf,
  reSubject,
  searchMessages,
  type Address,
  type CalEvent,
  type Contact,
  type Draft,
  type Folder,
  type MailData,
  type MailRecord,
  type OutgoingAttachment,
  type PendingOp,
  type SpecialFolder,
  type TaskItem,
} from '@suitenova/mail-core';
import { canConnect, messageOf, protocolOf, remote, savesSentCopy, type RemoteAccount } from './remote';

/** Mensajes más grandes que esto no se descargan. */
export const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
const EMAIL_OK = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
/** Mensajes que se piden al servidor de una vez. */
const FETCH_BATCH = 50;
export const DEFAULT_SYNC = { autoMinutes: 5, limit: 500 };
export const AUTO_SYNC_CHOICES = [0, 1, 5, 15, 30, 60];
export const SYNC_LIMIT_CHOICES = [100, 200, 500, 1000, 2000, 5000];
const SETTINGS_KEY = 'novamail.sync';

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
  /** Plain text body. */
  body: string;
  attachments: OutgoingAttachment[];
  inReplyTo?: string;
  references?: string[];
  /** The draft record being edited, replaced when saved again. */
  draftId?: string;
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
  /** Reminders already shown (event id + start). */
  dismissed = new Set<string>();

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
  }

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
    this.compose = null;
    this.touch();
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
    this.section = section;
    this.touch();
  }

  setFolder(id: string): void {
    this.folder = id;
    this.selectedId = null;
    this.query = '';
    this.touch();
  }

  /** Messages shown in the list: a search runs over the current folder, or over all when prefixed with `*`. */
  list(): MailRecord[] {
    if (this.query.trim()) return searchMessages(this.data, this.query.replace(/^\*\s*/, ''), this.query.startsWith('*') ? null : this.folder);
    return inFolder(this.data, this.folder);
  }

  get selected(): MailRecord | null {
    return this.data.messages.find((m) => m.id === this.selectedId) ?? null;
  }

  select(id: string | null): void {
    this.selectedId = id;
    const m = this.selected;
    if (m && !m.read) {
      m.read = true;
      this.pushFlag(m, RFC_FLAGS.seen, true);
      this.touch(true);
    } else this.touch();
  }

  importRaw(raw: string | Uint8Array, folder = this.folder, opts: { read?: boolean; bcc?: string[] } = {}): MailRecord {
    const rec = addRaw(this.data, folder, raw, { read: opts.read ?? folder !== 'inbox', bcc: opts.bcc?.length ? opts.bcc : undefined });
    this.touch(true);
    return rec;
  }

  setRead(id: string, read: boolean): void {
    const m = this.data.messages.find((x) => x.id === id);
    if (!m) return;
    m.read = read;
    this.pushFlag(m, RFC_FLAGS.seen, read);
    this.touch(true);
  }

  toggleFlag(id: string): void {
    const m = this.data.messages.find((x) => x.id === id);
    if (!m) return;
    m.flagged = !m.flagged;
    this.pushFlag(m, RFC_FLAGS.flagged, m.flagged);
    this.touch(true);
  }

  private accountName(id: string): string {
    return this.accounts.find((a) => a.id === id)?.name ?? id;
  }

  /**
   * Mueve un mensaje. Si vino de un servidor, también se mueve allí (a la carpeta equivalente de esa cuenta). Devuelve false
   * si no se pudo: por ejemplo la carpeta solo existe en este equipo y el mensaje está en el servidor.
   */
  move(id: string, folder: string): boolean {
    const m = this.data.messages.find((x) => x.id === id);
    if (!m || m.folder === folder) return true;
    const r = m.remote;
    if (r) {
      const to = folderTarget(this.data, r.account, folder);
      const acc = this.accounts.find((a) => a.id === r.account);
      const pop3 = !!acc && protocolOf(acc) === 'pop3';
      if (to === undefined && !pop3) {
        this.syncMessage = `No se puede mover ahí: ${this.accountName(r.account)} no tiene una carpeta equivalente en el servidor. Crea la carpeta en la cuenta o elige otra.`;
        this.touch();
        return false;
      }
      if (to !== undefined && to !== r.folder) {
        this.queue({ account: r.account, kind: 'move', folder: r.folder, keys: [r.key], to });
        // al cambiar de carpeta el servidor le da otro identificador: se reconocerá al sincronizar la carpeta nueva
        delete m.remote;
      }
    }
    m.folder = folder;
    if (this.selectedId === id) this.selectedId = null;
    this.touch(true);
    return true;
  }

  /** Eliminar: a Elementos eliminados (en el servidor también); desde ahí, para siempre. */
  delete(id: string): void {
    const list = this.list();
    const i = list.findIndex((m) => m.id === id);
    const rec = this.data.messages.find((m) => m.id === id);
    if (rec) {
      const r = rec.remote;
      if (rec.folder === 'trash') {
        if (r) this.queue({ account: r.account, kind: 'remove', folder: r.folder, keys: [r.key] });
        this.data.messages = this.data.messages.filter((m) => m.id !== id);
      } else {
        if (r) {
          const trash = folderTarget(this.data, r.account, 'trash');
          if (trash !== undefined && trash !== r.folder) this.queue({ account: r.account, kind: 'move', folder: r.folder, keys: [r.key], to: trash });
          else this.queue({ account: r.account, kind: 'remove', folder: r.folder, keys: [r.key] });
          delete rec.remote;
        }
        rec.folder = 'trash';
      }
    }
    if (this.selectedId === id) this.selectedId = list[i + 1]?.id ?? list[i - 1]?.id ?? null;
    this.touch(true);
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
    this.touch(true);
    return doomed.length;
  }

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

  newMessage(to = ''): void {
    this.compose = { id: newMailId(), to, cc: '', bcc: '', subject: '', body: '', attachments: [] };
    this.touch();
  }

  reply(id: string, all: boolean): void {
    const rec = this.data.messages.find((m) => m.id === id);
    if (!rec) return;
    const m = parseMessage(rawOf(rec));
    const me = this.data.owner.email.toLowerCase();
    const target = (m.replyTo[0] ?? m.from[0])?.email ?? '';
    const others = all ? [...m.to, ...m.cc].filter((a) => a.email.toLowerCase() !== me && a.email.toLowerCase() !== target.toLowerCase()) : [];
    this.compose = {
      id: newMailId(),
      to: [target, ...(all ? others.filter((a) => m.to.includes(a)).map((a) => a.email) : [])].filter(Boolean).join(', '),
      cc: all ? others.filter((a) => m.cc.includes(a)).map((a) => a.email).join(', ') : '',
      bcc: '',
      subject: reSubject(m.subject, 'Re'),
      body: quoteText(rawOf(rec), 'reply'),
      attachments: [],
      inReplyTo: m.messageId,
      references: [...m.references, m.messageId].filter(Boolean),
    };
    rec.answered = true;
    this.pushFlag(rec, RFC_FLAGS.answered, true);
    this.touch(true);
  }

  forward(id: string): void {
    const rec = this.data.messages.find((m) => m.id === id);
    if (!rec) return;
    const m = parseMessage(rawOf(rec));
    this.compose = {
      id: newMailId(),
      to: '',
      cc: '',
      bcc: '',
      subject: reSubject(m.subject, 'Fwd'),
      body: quoteText(rawOf(rec), 'forward'),
      attachments: m.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, data: a.data })),
    };
    this.touch();
  }

  editDraft(id: string): void {
    const rec = this.data.messages.find((m) => m.id === id);
    if (!rec) return;
    const m = parseMessage(rawOf(rec));
    const fmt = (l: Address[]) => l.map((a) => a.email).join(', ');
    this.compose = { id: newMailId(), to: fmt(m.to), cc: fmt(m.cc), bcc: (rec.bcc ?? []).join(', '), subject: m.subject, body: m.text ?? '', attachments: m.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, data: a.data })), draftId: id };
    this.touch();
  }

  closeCompose(): void {
    this.compose = null;
    this.touch();
  }

  /** Build the RFC 5322 text of the draft being composed. */
  buildRaw(c: ComposeState, sender?: Address): { raw: string; to: Address[]; cc: Address[]; bcc: Address[] } {
    const split = (s: string): Address[] =>
      s
        .split(/[,;]/)
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => {
          const m = /^(.*)<([^<>]+)>$/.exec(x);
          return m ? { name: m[1]!.trim().replace(/^"|"$/g, ''), email: m[2]!.trim() } : { name: '', email: x };
        });
    const to = split(c.to), cc = split(c.cc), bcc = split(c.bcc);
    const draft: Draft = { from: sender ?? (this.data.owner.email ? this.data.owner : { name: '', email: 'yo@nova.local' }), to, cc, bcc, subject: c.subject, text: c.body, attachments: c.attachments, inReplyTo: c.inReplyTo, references: c.references };
    return { raw: buildMessage(draft), to, cc, bcc };
  }

  saveDraft(c: ComposeState): MailRecord {
    const { raw, bcc } = this.buildRaw(c);
    if (c.draftId) this.data.messages = this.data.messages.filter((m) => m.id !== c.draftId);
    const rec = addRaw(this.data, 'drafts', raw, { read: true, bcc: bcc.map((a) => a.email) });
    c.draftId = rec.id;
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
  async flush(): Promise<string[]> {
    if (this.flushing || !canConnect()) return [];
    this.flushing = true;
    const errors: string[] = [];
    const skip = new Set<string>();
    try {
      for (;;) {
        const op = (this.data.pending ?? []).find((o) => !skip.has(o.account) && this.accounts.some((a) => a.id === o.account));
        if (!op) break;
        const snap = JSON.parse(JSON.stringify(op)) as PendingOp;
        try {
          await this.runOp(snap);
          // lo que se añadió a este cambio mientras se enviaba se queda pendiente
          const live = (this.data.pending ?? []).find((o) => o.id === snap.id);
          if (live && 'keys' in live && 'keys' in snap) {
            const done = new Set(snap.keys);
            live.keys = live.keys.filter((k) => !done.has(k));
            if (!live.keys.length) completeOp(this.data, live.id);
          } else completeOp(this.data, snap.id);
          this.touch(true);
        } catch (e) {
          skip.add(snap.account);
          errors.push(`${this.accountName(snap.account)}: ${messageOf(e)}`);
        }
      }
    } finally {
      this.flushing = false;
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
    let added = 0;
    let removed = 0;
    let updated = 0;
    let big = 0;
    const errors: string[] = await this.flush();
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
            this.batch(() => {
              const r = reconcileFolder(this.data, acc.id, p, state, { limit: this.syncLimit, maxBytes: MAX_MESSAGE_BYTES });
              removed += r.removed;
              updated += r.updated;
              big += r.tooBig;
              missing = r.missing;
            });
            for (let i = 0; i < missing.length; i += FETCH_BATCH) {
              const res = await remote.fetch(acc.id, p.remote, missing.slice(i, i + FETCH_BATCH), MAX_MESSAGE_BYTES);
              this.batch(() => {
                added += applyFetched(this.data, acc.id, p, res);
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
    if (!this.data.folders.some((f) => f.id === this.folder)) this.folder = 'inbox';
    const parts = [added === 1 ? '1 mensaje nuevo' : `${added} mensajes nuevos`];
    if (removed) parts.push(removed === 1 ? '1 quitado (ya no está en el servidor)' : `${removed} quitados (ya no están en el servidor)`);
    if (updated) parts.push(updated === 1 ? '1 con marcas cambiadas' : `${updated} con marcas cambiadas`);
    if (big) parts.push(`${big} demasiado grandes (más de 25 MB) no se descargaron`);
    const at = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    this.syncMessage = errors.length ? `Error al sincronizar: ${errors.join(' · ')}${added ? ` (${parts[0]})` : ''}` : `Sincronizado a las ${at}: ${parts.join(', ')}`;
    this.touch(added + removed + updated > 0);
  }

  /**
   * Envía el mensaje con una cuenta. El remitente es siempre la dirección de la cuenta. Si el envío falla no se pierde
   * nada: el mensaje sigue en la ventana de redacción. Tras enviarlo se guarda una copia en Enviados.
   */
  async send(c: ComposeState, accountId: string): Promise<void> {
    const acc = this.accounts.find((a) => a.id === accountId);
    if (!acc) throw new Error('Elige la cuenta desde la que enviar.');
    const sender: Address = { name: this.data.owner.name || acc.name, email: acc.email };
    const { raw, to, cc, bcc } = this.buildRaw(c, sender);
    const recipients = [...to, ...cc, ...bcc].map((a) => a.email.trim());
    if (!recipients.length) throw new Error('Falta algún destinatario.');
    const bad = recipients.find((r) => !EMAIL_OK.test(r));
    if (bad) throw new Error(`La dirección «${bad}» no es válida.`);
    const bytes = new TextEncoder().encode(raw);
    await remote.send(acc.id, recipients, encodeBase64(bytes));
    // JMAP y Exchange guardan por sí mismos la copia en Enviados; con IMAP se guarda aquí si la cuenta lo pide (Gmail y Outlook ya la guardan)
    const sentTarget = this.data.servers?.[acc.id]?.targets.sent;
    const wantCopy = protocolOf(acc) === 'imap' && savesSentCopy(acc);
    let note = '';
    this.batch(() => {
      if (c.draftId) this.data.messages = this.data.messages.filter((m) => m.id !== c.draftId);
      addRaw(this.data, 'sent', raw, { read: true, bcc: bcc.map((a) => a.email) });
      if (wantCopy && sentTarget) this.queue({ account: acc.id, kind: 'append', folder: sentTarget, raw: encodeBase64(bytes), seen: true });
      else if (wantCopy) note = ' (la copia en Enviados del servidor no se guardó: sincroniza la cuenta para que se conozca esa carpeta)';
      this.compose = null;
    });
    this.syncMessage = `Mensaje enviado a ${recipients.length === 1 ? recipients[0] : `${recipients.length} destinatarios`}${note}`;
    this.touch();
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
