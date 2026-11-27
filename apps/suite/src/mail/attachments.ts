import type { Attachment } from '@suitenova/mail-core';
import { saveBytes } from '../fileio';
import { isTauri } from '../platform';

/**
 * A name for a file that comes in a message: never a path, nothing Windows refuses or treats as a device, and not one
 * already taken (compared as Windows does, without case).
 */
export function safeFileName(name: string, taken: Set<string> = new Set()): string {
  let n = name
    .replace(/^.*[\\/]/, '')
    // control characters and the ones that turn text around (they can hide the real extension)
    .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  if (!n || /^\.+$/.test(n)) n = 'adjunto';
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(n)) n = `_${n}`;
  const dot = n.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [n.slice(0, dot), n.slice(dot)] : [n, ''];
  const base = stem.slice(0, 150);
  let out = base + ext;
  for (let i = 2; taken.has(out.toLowerCase()); i++) out = `${base} (${i})${ext}`;
  taken.add(out.toLowerCase());
  return out;
}

/**
 * All the attachments of a message at once: in the desktop application into a folder that is chosen (what is already
 * there is not overwritten); in the browser, in a .zip. Null when it is cancelled.
 */
export async function saveAllAttachments(files: Attachment[], zipName: string, title: string): Promise<{ count: number; where: string } | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { writeFile, exists } = await import('@tauri-apps/plugin-fs');
    const { join } = await import('@tauri-apps/api/path');
    const dir = await open({ directory: true, multiple: false, title });
    if (!dir || Array.isArray(dir)) return null;
    const taken = new Set<string>();
    for (const f of files) {
      let name = safeFileName(f.filename, taken);
      while (await exists(await join(dir, name))) name = safeFileName(f.filename, taken);
      await writeFile(await join(dir, name), f.data);
    }
    return { count: files.length, where: dir };
  }
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const taken = new Set<string>();
  for (const f of files) zip.file(safeFileName(f.filename, taken), f.data);
  const saved = await saveBytes(`${safeFileName(zipName)}.zip`, await zip.generateAsync({ type: 'uint8array' }), [{ name: 'ZIP', extensions: ['zip'] }]);
  return saved ? { count: files.length, where: saved.name } : null;
}
