import { childrenOf, descendants, type Folder, type MailData } from './store';

/* Renaming and moving folders, favourites, and what to do here when the server renames one. */

/** Folders of the program (the system ones and the containers of a server) stay as they are. */
export const canChangeFolder = (f: Folder | undefined): boolean => !!f && !f.system && !f.id.startsWith('c:');

/** Where a folder can be moved (null: the top level). A server folder stays in its account; a local one stays local. */
export function folderParents(d: MailData, id: string): (string | null)[] {
  const f = d.folders.find((x) => x.id === id);
  if (!canChangeFolder(f)) return [];
  const inside = new Set(descendants(d, id));
  const account = f!.remote?.account;
  const fits = (p: Folder): boolean => {
    if (inside.has(p.id)) return false;
    if (account) return p.system ? !!d.servers?.[account]?.paths?.[p.id as 'inbox'] : p.remote?.account === account || p.id.startsWith(`c:${account}:`);
    return p.system || (!p.remote && !p.id.startsWith('c:'));
  };
  return [null, ...d.folders.filter(fits).map((p) => p.id)];
}

/** The name as it will be kept; says why when it cannot be used. */
export function folderName(d: MailData, name: string, parent: string | null, self?: string): string {
  const n = name.trim();
  if (!n) throw new Error('Escribe un nombre para la carpeta.');
  if (/[/\\]/.test(n)) throw new Error('El nombre de la carpeta no puede llevar barras.');
  if (childrenOf(d, parent).some((f) => f.id !== self && f.name.toLowerCase() === n.toLowerCase())) throw new Error('Ya existe una carpeta con ese nombre.');
  return n;
}

/** A folder that the server now knows by another name keeps its messages, its state and its pending changes. */
export function remapFolder(d: MailData, account: string, from: { id: string; name: string }, to: { id: string; name: string }): void {
  for (const m of d.messages) {
    if (m.folder === from.id) m.folder = to.id;
    if (m.remote?.account === account && m.remote.folder === from.name) m.remote = { ...m.remote, folder: to.name };
  }
  for (const f of d.folders) if (f.parent === from.id) f.parent = to.id;
  const f = d.folders.find((x) => x.id === from.id);
  if (f) {
    f.id = to.id;
    if (f.remote) f.remote = { ...f.remote, name: to.name };
  }
  const old = `${account}|${from.name}`;
  if (d.sync?.[old] && from.name !== to.name) {
    d.sync[`${account}|${to.name}`] = d.sync[old]!;
    delete d.sync[old];
  }
  for (const op of d.pending ?? []) {
    if (op.account !== account) continue;
    if ('folder' in op && op.folder === from.name) op.folder = to.name;
    if (op.kind === 'move' && op.to === from.name) op.to = to.name;
  }
  if (d.favorites) d.favorites = d.favorites.map((x) => (x === from.id ? to.id : x));
  for (const r of [...(d.rules ?? []), ...(d.quickSteps ?? [])]) for (const a of r.actions) if ((a.kind === 'move' || a.kind === 'copy') && a.folder === from.id) a.folder = to.id;
}

export function toggleFavorite(d: MailData, id: string): void {
  const list = d.favorites ?? [];
  d.favorites = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  if (!d.favorites.length) delete d.favorites;
}

/** Favourites that still exist. */
export const favoriteFolders = (d: MailData): Folder[] => (d.favorites ?? []).map((id) => d.folders.find((f) => f.id === id)).filter((f): f is Folder => !!f);

/**
 * Takes back a change that has not been sent yet: the message leaves the queued operation. False when it is not queued
 * (it was already sent, or never asked).
 */
export function cancelPending(d: MailData, kind: 'move' | 'remove', account: string, folder: string, key: string, except?: string | null): boolean {
  for (let i = (d.pending?.length ?? 0) - 1; i >= 0; i--) {
    const op = d.pending![i]!;
    if (op.kind !== kind || op.account !== account || op.folder !== folder || op.id === except || !op.keys.includes(key)) continue;
    op.keys = op.keys.filter((k) => k !== key);
    if (!op.keys.length) d.pending!.splice(i, 1);
    if (!d.pending!.length) delete d.pending;
    return true;
  }
  return false;
}
