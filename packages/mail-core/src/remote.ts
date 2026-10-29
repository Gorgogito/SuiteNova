import { decodeBase64, parseMessage } from './mime';
import { addRaw, newMailId, type Folder, type MailData, type MailRecord, type PendingOp, type ServerInfo, type SpecialFolder } from './store';

/*
 * Lógica de la sincronización con un servidor, sin red: qué carpetas del servidor corresponden a las de Nova Mail (todas,
 * con sus subcarpetas), cómo se ponen al día los mensajes (lo nuevo se baja, lo que cambió o desapareció en el servidor
 * se refleja) y la cola de cambios hechos aquí que faltan en el servidor. La red la hace la parte de escritorio (Rust).
 *
 * El servidor manda: un mensaje borrado o movido allí desaparece (o cambia de carpeta) aquí en la siguiente
 * sincronización. Salvo con POP3, donde lo que ya no está en el servidor se conserva.
 */

export interface RemoteFolder {
  /** Lo que se pasa al servidor en las órdenes (en IMAP el nombre; en JMAP y Exchange un identificador). */
  name: string;
  /** Ruta legible con "/" entre niveles. */
  path: string;
  delimiter?: string | null;
  attrs: string[];
}

export interface StateItem {
  key: string;
  flags: string[];
  size: number;
}

export interface FolderState {
  validity: string;
  /** De más nuevo a más antiguo. */
  items: StateItem[];
  mirror_deletions: boolean;
}

export interface RemoteMessage {
  key: string;
  flags: string[];
  /** Base64 del mensaje tal como llegó. */
  raw: string;
}

export interface Fetched {
  messages: RemoteMessage[];
  skipped: { key: string; size: number }[];
}

export const RFC_FLAGS = { seen: '\\Seen', flagged: '\\Flagged', answered: '\\Answered' } as const;

// ------------------------------------------------------------------ carpetas

const NAMES: Record<SpecialFolder, string[]> = {
  inbox: ['inbox', 'bandeja de entrada'],
  sent: ['sent', 'sent items', 'sent mail', 'sent messages', 'enviados', 'elementos enviados', 'mensajes enviados'],
  drafts: ['drafts', 'draft', 'borradores'],
  trash: ['trash', 'deleted', 'deleted items', 'deleted messages', 'papelera', 'elementos eliminados', 'eliminados'],
  junk: ['junk', 'spam', 'junk e-mail', 'junk email', 'correo no deseado', 'no deseado'],
  archive: ['archive', 'archives', 'archivo', 'archivos'],
};
const SPECIAL_ATTR: Record<string, SpecialFolder> = { '\\inbox': 'inbox', '\\sent': 'sent', '\\drafts': 'drafts', '\\trash': 'trash', '\\junk': 'junk', '\\archive': 'archive' };
/** Vistas del servidor que repiten mensajes de otras carpetas (Gmail): no se descargan. */
const VIRTUAL = new Set(['\\all', '\\flagged', '\\important']);

interface Kind {
  id: SpecialFolder | null;
  /** Lo dice el servidor (atributo de uso especial) o es la bandeja de entrada por su nombre. */
  strong: boolean;
  virtual: boolean;
  container: boolean;
}

function classify(f: RemoteFolder): Kind {
  const attrs = f.attrs.map((a) => a.toLowerCase());
  const container = attrs.includes('\\noselect') || attrs.includes('\\nonexistent');
  const virtual = attrs.some((a) => VIRTUAL.has(a));
  for (const a of attrs) if (SPECIAL_ATTR[a]) return { id: SPECIAL_ATTR[a]!, strong: true, virtual, container };
  const path = f.path.replace(/^INBOX\//i, '');
  if (f.path.toUpperCase() === 'INBOX' || f.name.toUpperCase() === 'INBOX') return { id: 'inbox', strong: true, virtual, container };
  // por el nombre, solo en el nivel superior (una carpeta «Papelera» dentro de otra es una carpeta normal)
  if (!path.includes('/')) {
    const n = path.trim().toLowerCase();
    for (const [id, names] of Object.entries(NAMES)) if (names.includes(n)) return { id: id as SpecialFolder, strong: false, virtual, container };
  }
  return { id: null, strong: false, virtual, container };
}

export interface FolderPlan {
  /** Carpeta de Nova Mail: una del sistema o `s:cuenta:nombre`. */
  local: string;
  remote: string;
  path: string;
  /** ¿Es una de las carpetas del sistema (Entrada, Enviados…)? */
  special: boolean;
}

export interface ServerPlan {
  folders: FolderPlan[];
  /** Rutas de carpetas que no contienen mensajes pero tienen subcarpetas. */
  containers: string[];
  targets: ServerInfo['targets'];
  paths: NonNullable<ServerInfo['paths']>;
}

/** Qué carpetas se sincronizan: todas las que se pueden abrir. Si dos corresponden a la misma del sistema, gana la que el servidor marca. */
export function planFolders(account: string, folders: RemoteFolder[]): ServerPlan {
  const kinds = folders.map((f) => ({ f, k: classify(f) }));
  const winners = new Map<SpecialFolder, { f: RemoteFolder; strong: boolean }>();
  for (const { f, k } of kinds) {
    if (!k.id || k.container || k.virtual) continue;
    const cur = winners.get(k.id);
    if (!cur || (k.strong && !cur.strong)) winners.set(k.id, { f, strong: k.strong });
  }
  const targets: ServerInfo['targets'] = {};
  const paths: NonNullable<ServerInfo['paths']> = {};
  for (const [id, w] of winners) {
    targets[id] = w.f.name;
    paths[id] = w.f.path;
  }
  // Gmail: «Todos» repite todo el correo; no se baja, pero es adonde se archiva
  if (!targets.archive) {
    const all = kinds.find(({ f }) => f.attrs.some((a) => a.toLowerCase() === '\\all'));
    if (all) {
      targets.archive = all.f.name;
      paths.archive = all.f.path;
    }
  }
  const out: FolderPlan[] = [];
  const containers: string[] = [];
  for (const { f, k } of kinds) {
    if (k.container) {
      containers.push(f.path);
      continue;
    }
    if (k.virtual) continue;
    const w = k.id ? winners.get(k.id) : undefined;
    if (k.id && w?.f === f) out.push({ local: k.id, remote: f.name, path: f.path, special: true });
    else out.push({ local: `s:${account}:${f.name}`, remote: f.name, path: f.path, special: false });
  }
  return { folders: out, containers, targets, paths };
}

const lastSegment = (path: string): string => path.split('/').filter(Boolean).pop() ?? path;
const parentPath = (path: string): string => path.split('/').filter(Boolean).slice(0, -1).join('/');

/**
 * Pone las carpetas de Nova Mail al día con las del servidor: crea las que faltan (con sus subcarpetas) y quita las que ya
 * no existen allí, con los mensajes que venían de ellas.
 */
export function applyPlan(d: MailData, account: string, plan: ServerPlan): { added: number; removed: number } {
  d.servers ??= {};
  d.servers[account] = { targets: plan.targets, paths: plan.paths };
  const idOfPath = new Map<string, string>();
  for (const f of plan.folders) idOfPath.set(f.path, f.local);
  // los contenedores solo existen si cuelga algo de ellos que no sea del sistema
  const custom = plan.folders.filter((f) => !f.special);
  const wanted = new Map<string, Folder>();
  const needed = new Set<string>();
  for (const f of custom) for (let p = parentPath(f.path); p; p = parentPath(p)) if (plan.containers.includes(p)) needed.add(p);
  for (const p of needed) idOfPath.set(p, `c:${account}:${p}`);
  const parentOf = (path: string): string | undefined => {
    for (let p = parentPath(path); p; p = parentPath(p)) {
      const id = idOfPath.get(p);
      if (id) return id;
    }
    return undefined;
  };
  for (const p of needed) {
    const id = `c:${account}:${p}`;
    wanted.set(id, { id, name: lastSegment(p), system: false, parent: parentOf(p) });
  }
  for (const f of custom) wanted.set(f.local, { id: f.local, name: lastSegment(f.path), system: false, parent: parentOf(f.path), remote: { account, name: f.remote, path: f.path } });
  let added = 0;
  let removed = 0;
  const mine = (id: string) => id.startsWith(`s:${account}:`) || id.startsWith(`c:${account}:`);
  // quitar lo que ya no existe
  const gone = d.folders.filter((f) => mine(f.id) && !wanted.has(f.id));
  if (gone.length) {
    const goneIds = new Set(gone.map((f) => f.id));
    d.messages = d.messages.filter((m) => {
      if (!goneIds.has(m.folder)) return true;
      if (m.remote?.account === account) return false;
      m.folder = 'archive';
      return true;
    });
    d.folders = d.folders.filter((f) => !goneIds.has(f.id));
    removed = gone.length;
  }
  for (const w of wanted.values()) {
    const cur = d.folders.find((f) => f.id === w.id);
    if (cur) {
      cur.name = w.name;
      cur.parent = w.parent;
      if (!w.parent) delete cur.parent;
      if (w.remote) cur.remote = w.remote;
    } else {
      const f: Folder = { id: w.id, name: w.name, system: false };
      if (w.parent) f.parent = w.parent;
      if (w.remote) f.remote = w.remote;
      d.folders.push(f);
      added++;
    }
  }
  // las carpetas del servidor van después de las del sistema, ordenadas por ruta
  const sys = d.folders.filter((f) => f.system);
  const rest = d.folders.filter((f) => !f.system);
  rest.sort((a, b) => (a.remote?.path ?? a.name).localeCompare(b.remote?.path ?? b.name, undefined, { sensitivity: 'base' }));
  d.folders = [...sys, ...rest.filter((f) => !f.remote && !f.id.startsWith('c:')), ...rest.filter((f) => f.remote || f.id.startsWith('c:'))];
  return { added, removed };
}

/** El nombre que usa el servidor para una carpeta de Nova Mail, en una cuenta; undefined si esa cuenta no tiene equivalente. */
export function folderTarget(d: MailData, account: string, local: string): string | undefined {
  const sys = (d.servers?.[account]?.targets ?? {})[local as SpecialFolder];
  if (sys) return sys;
  const f = d.folders.find((x) => x.id === local);
  return f?.remote?.account === account ? f.remote.name : undefined;
}

// ------------------------------------------------------------------ cola de cambios

type OpInput = PendingOp extends infer O ? (O extends { id: string } ? Omit<O, 'id'> : never) : never;

/** Anota un cambio que falta enviar. Una marca nueva sustituye a la anterior del mismo mensaje; los cambios iguales y seguidos se juntan. */
export function enqueueOp(d: MailData, op: OpInput): void {
  const q = (d.pending ??= []);
  if (op.kind === 'flag') {
    const keys = new Set(op.keys);
    for (const o of q) if (o.kind === 'flag' && o.account === op.account && o.folder === op.folder && o.flag === op.flag) o.keys = o.keys.filter((k) => !keys.has(k));
  }
  if (op.kind === 'move' || op.kind === 'remove') {
    // un mensaje que se mueve o se borra ya no necesita sus marcas pendientes
    const keys = new Set(op.keys);
    for (const o of q) if (o.kind === 'flag' && o.account === op.account && o.folder === op.folder) o.keys = o.keys.filter((k) => !keys.has(k));
  }
  d.pending = q.filter((o) => !('keys' in o) || o.keys.length > 0);
  const last = d.pending[d.pending.length - 1];
  if (last && last.kind === op.kind && last.account === op.account) {
    if (op.kind === 'flag' && last.kind === 'flag' && last.folder === op.folder && last.flag === op.flag && last.on === op.on) return void (last.keys = [...new Set([...last.keys, ...op.keys])]);
    if (op.kind === 'move' && last.kind === 'move' && last.folder === op.folder && last.to === op.to) return void (last.keys = [...new Set([...last.keys, ...op.keys])]);
    if (op.kind === 'remove' && last.kind === 'remove' && last.folder === op.folder) return void (last.keys = [...new Set([...last.keys, ...op.keys])]);
  }
  d.pending.push({ ...op, id: newMailId() } as PendingOp);
}

export function completeOp(d: MailData, id: string): void {
  d.pending = (d.pending ?? []).filter((o) => o.id !== id);
  if (!d.pending.length) delete d.pending;
}

/** Los mensajes de una carpeta del servidor que tienen un cambio pendiente: mientras tanto no se tocan al sincronizar. */
export function pendingKeys(d: MailData, account: string, folder: string): { moved: Set<string>; flagged: Set<string> } {
  const moved = new Set<string>();
  const flagged = new Set<string>();
  for (const o of d.pending ?? []) {
    if (o.account !== account || !('folder' in o) || o.folder !== folder || !('keys' in o)) continue;
    for (const k of o.keys) (o.kind === 'flag' ? flagged : moved).add(k);
  }
  return { moved, flagged };
}

// ------------------------------------------------------------------ poner al día una carpeta

export const syncKey = (account: string, folder: string): string => `${account}|${folder}`;

export interface Reconciled {
  /** Mensajes del servidor que faltan aquí, de más nuevo a más antiguo, hasta el límite pedido. */
  missing: string[];
  removed: number;
  updated: number;
  /** Mensajes que faltan pero superan el tamaño máximo: no se bajan. */
  tooBig: number;
  /** El servidor renumeró la carpeta: se quitó lo descargado antes. */
  reset: boolean;
}

const flagsOf = (flags: string[]) => {
  const f = flags.map((x) => x.toLowerCase());
  return { read: f.includes('\\seen'), flagged: f.includes('\\flagged'), answered: f.includes('\\answered') };
};

/**
 * Compara lo que hay aquí de una carpeta con lo que dice el servidor: quita lo que ya no está, actualiza las marcas y dice
 * qué mensajes faltan. `limit` es cuántos de los más nuevos del servidor se conservan aquí.
 */
export function reconcileFolder(d: MailData, account: string, plan: FolderPlan, state: FolderState, opts: { limit: number; maxBytes: number }): Reconciled {
  d.sync ??= {};
  const key = syncKey(account, plan.remote);
  const res: Reconciled = { missing: [], removed: 0, updated: 0, tooBig: 0, reset: false };
  const prev = d.sync[key];
  if (prev && prev.validity !== state.validity) {
    // los identificadores anteriores ya no significan lo mismo: se descarta lo que vino de esa carpeta
    d.messages = d.messages.filter((m) => !(m.remote && m.remote.account === account && m.remote.folder === plan.remote));
    res.reset = true;
  }
  d.sync[key] = { validity: state.validity };
  const server = new Map(state.items.map((i) => [i.key, i]));
  const { moved, flagged } = pendingKeys(d, account, plan.remote);
  const have = new Set<string>();
  const keep: MailRecord[] = [];
  for (const m of d.messages) {
    if (!(m.remote && m.remote.account === account && m.remote.folder === plan.remote)) {
      keep.push(m);
      continue;
    }
    const it = server.get(m.remote.key);
    if (!it) {
      if (state.mirror_deletions && !moved.has(m.remote.key)) {
        res.removed++;
        continue; // ya no está en el servidor
      }
      keep.push(m);
      continue;
    }
    have.add(m.remote.key);
    if (state.mirror_deletions && !flagged.has(m.remote.key)) {
      const f = flagsOf(it.flags);
      if (m.read !== f.read || m.flagged !== f.flagged || m.answered !== f.answered) {
        m.read = f.read;
        m.flagged = f.flagged;
        m.answered = f.answered;
        res.updated++;
      }
    }
    keep.push(m);
  }
  d.messages = keep;
  for (const it of state.items.slice(0, Math.max(0, opts.limit))) {
    if (have.has(it.key) || moved.has(it.key)) continue;
    if (it.size > opts.maxBytes) {
      res.tooBig++;
      continue;
    }
    res.missing.push(it.key);
  }
  return res;
}

/**
 * Incorpora lo descargado. Nova Mail guarda una copia local de lo que envía o mueve; al bajar la del servidor se reconoce por
 * su Message-ID y la copia local pasa a ser la del servidor, en vez de quedar repetida.
 */
export function applyFetched(d: MailData, account: string, plan: FolderPlan, f: Fetched): number {
  const unattached = new Map<string, MailRecord>();
  for (const m of d.messages) {
    if (m.remote || m.folder !== plan.local) continue;
    if (m.mid === undefined) {
      try {
        m.mid = parseMessage(decodeBase64(m.raw)).messageId || '';
      } catch {
        m.mid = '';
      }
    }
    if (m.mid && !unattached.has(m.mid)) unattached.set(m.mid, m);
  }
  let added = 0;
  for (const m of f.messages) {
    let parsedId = '';
    try {
      parsedId = parseMessage(decodeBase64(m.raw)).messageId;
    } catch {
      // se trata como un mensaje nuevo
    }
    const mine = parsedId ? unattached.get(parsedId) : undefined;
    if (mine) {
      mine.remote = { account, folder: plan.remote, key: m.key };
      const fl = flagsOf(m.flags);
      mine.read = mine.read || fl.read;
      unattached.delete(parsedId);
      continue;
    }
    try {
      const fl = flagsOf(m.flags);
      const rec = addRaw(d, plan.local, decodeBase64(m.raw), { read: fl.read, flagged: fl.flagged, answered: fl.answered });
      rec.remote = { account, folder: plan.remote, key: m.key };
      added++;
    } catch {
      // un mensaje que no se puede leer no detiene la sincronización
    }
  }
  return added;
}
