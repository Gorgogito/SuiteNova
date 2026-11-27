import { t } from '@suitenova/core-ui';
import { folderRows, folderParents, parseMessage, rawOf, type MailRecord } from '@suitenova/mail-core';
import { saveAllAttachments } from './attachments';
import type { MenuItem } from './ContextMenu';
import type { MailCtl } from './ctl';

/* What the list, the folder tree, the ribbon and the keyboard do in the same way, with their questions. */

/** Delete what is selected, asking first when it cannot be taken back (or, with Shift, always). */
export function removeSelected(ctl: MailCtl, permanent = false): void {
  const ids = ctl.selectedIds();
  if (!ids.length) return;
  const q = ctl.deleteQuestion(ids, permanent);
  if (q) {
    const n = ids.length;
    const text =
      q === 'server'
        ? n === 1
          ? t('¿Eliminar para siempre este mensaje, también del servidor?')
          : t('¿Eliminar para siempre {n} mensajes, también del servidor?', { n })
        : n === 1
          ? t('¿Eliminar para siempre este mensaje?')
          : t('¿Eliminar para siempre {n} mensajes?', { n });
    if (!window.confirm(text)) return;
  }
  ctl.deleteMany(ids, permanent);
}

export function emptyFolder(ctl: MailCtl, id: string): void {
  if (window.confirm(t('¿Eliminar para siempre todos los mensajes de esta carpeta? Esta acción no se puede deshacer.'))) ctl.emptyFolder(id);
}

const report = (ctl: MailCtl, e: unknown): void => {
  ctl.syncMessage = (e as Error).message;
  ctl.touch();
};

export function removeFolder(ctl: MailCtl, id: string): void {
  const f = ctl.data.folders.find((x) => x.id === id);
  if (!f) return;
  const text = f.remote ? t('¿Eliminar la carpeta? También se eliminará en el servidor, con todos sus mensajes. Esta acción no se puede deshacer.') : t('¿Eliminar la carpeta? Sus mensajes pasarán a Archivo.');
  if (!window.confirm(text)) return;
  try {
    ctl.deleteFolder(id);
  } catch (e) {
    report(ctl, e);
  }
}

export function moveFolder(ctl: MailCtl, id: string, parent: string | null): void {
  void ctl.moveFolder(id, parent).catch((e) => report(ctl, e));
}

/** The folders a message can be moved to, indented as in the tree. */
export function moveTargets(ctl: MailCtl, from?: string): { id: string; label: string }[] {
  return folderRows(ctl.data)
    .filter(({ folder: f }) => f.id !== from && !f.id.startsWith('c:'))
    .map(({ folder: f, depth }) => ({ id: f.id, label: `${'  '.repeat(depth)}${t(f.name)}` }));
}

/** Where a folder can be moved, as entries of a menu. */
export function folderMoveItems(ctl: MailCtl, id: string): MenuItem[] {
  const parents = new Set(folderParents(ctl.data, id));
  const now = ctl.data.folders.find((f) => f.id === id)?.parent ?? null;
  const rows = folderRows(ctl.data).filter(({ folder: f }) => parents.has(f.id));
  const items: MenuItem[] = parents.has(null) ? [{ label: t('Nivel superior'), disabled: now === null, run: () => moveFolder(ctl, id, null) }] : [];
  return [...items, ...rows.map(({ folder: f, depth }) => ({ label: `${'  '.repeat(depth)}${t(f.name)}`, disabled: now === f.id, run: () => moveFolder(ctl, id, f.id) }))];
}

export async function saveAttachmentsOf(rec: MailRecord, say: (text: string) => void): Promise<void> {
  const m = parseMessage(rawOf(rec));
  if (!m.attachments.length) return;
  try {
    const done = await saveAllAttachments(m.attachments, m.subject || 'adjuntos', t('Guardar los adjuntos en la carpeta'));
    if (done) say(done.count === 1 ? t('Se guardó 1 adjunto en «{where}».', { where: done.where }) : t('Se guardaron {n} adjuntos en «{where}».', { n: done.count, where: done.where }));
  } catch (e) {
    window.alert(t('No se pudo guardar: {error}', { error: (e as Error).message }));
  }
}
