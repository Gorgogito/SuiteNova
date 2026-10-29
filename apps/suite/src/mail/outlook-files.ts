import { cleanAddress, outlookToMime, type Address, type OutlookAttachment, type OutlookMessage } from '@suitenova/mail-core';

/*
 * Lectura de archivos de Outlook: .msg (un mensaje) y .pst / .ost (un archivo de datos con carpetas). Los formatos los leen
 * las bibliotecas libres `@kenjiuno/msgreader` (Apache-2.0) y `pst-extractor` (MIT); aquí se pasan a mensajes de correo
 * normales. Se cargan solo al abrir uno de estos archivos.
 */

export const OUTLOOK_EXT = /\.(msg|pst|ost)$/i;
/** El archivo entero se lee en memoria. */
export const MAX_OUTLOOK_FILE = 1024 * 1024 * 1024;
export const MAX_PST_MESSAGES = 20000;
const MAX_ATTACHMENT = 50 * 1024 * 1024;

export interface ImportedMessage {
  raw: string;
  read: boolean;
  bcc: string[];
}

export interface ImportedFolder {
  name: string;
  messages: ImportedMessage[];
  children: ImportedFolder[];
}

export interface OutlookImport {
  /** Para un .msg: el mensaje. Para un .pst/.ost: las carpetas. */
  tree: ImportedFolder[];
  messages: number;
  /** Elementos que no son correo (calendario, contactos, tareas, notas) y no se importaron. */
  skipped: number;
  truncated: boolean;
  warnings: string[];
}

const enc = new TextEncoder();
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Las bibliotecas de Outlook usan `Buffer` de Node: en el navegador se lo da el paquete `buffer`. */
async function withBuffer(): Promise<typeof import('buffer').Buffer> {
  const { Buffer } = await import('buffer');
  const g = globalThis as unknown as { Buffer?: unknown };
  g.Buffer ??= Buffer;
  return Buffer;
}

function decodeBytes(bytes: Uint8Array, codepage?: number): string {
  const label = codepage === 65001 || !codepage ? 'utf-8' : codepage >= 1250 && codepage <= 1258 ? `windows-${codepage}` : codepage === 28591 ? 'iso-8859-1' : codepage === 20127 ? 'us-ascii' : 'utf-8';
  try {
    return new TextDecoder(label, { fatal: label === 'utf-8' }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

const brackets = (id: string | undefined): string | undefined => {
  const s = id?.trim();
  if (!s) return undefined;
  return s.startsWith('<') ? s : `<${s}>`;
};

const when = (v: string | Date | null | undefined): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ------------------------------------------------------------------ .msg

interface MsgFields {
  subject?: string;
  senderName?: string;
  senderEmail?: string;
  senderSmtpAddress?: string;
  body?: string;
  bodyHtml?: string;
  html?: Uint8Array;
  internetCodepage?: number;
  messageId?: string;
  messageFlags?: number;
  clientSubmitTime?: string;
  messageDeliveryTime?: string;
  creationTime?: string;
  recipients?: { name?: string; email?: string; smtpAddress?: string; recipType?: 'to' | 'cc' | 'bcc' }[];
  attachments?: (MsgFields & { fileName?: string; fileNameShort?: string; name?: string; attachMimeTag?: string; pidContentId?: string; innerMsgContentFields?: MsgFields })[];
}

interface MsgReaderLike {
  getFileData(): MsgFields & { error?: string };
  getAttachment(a: unknown): { fileName: string; content: Uint8Array };
}

function fromMsg(reader: MsgReaderLike, d: MsgFields, depth: number, warnings: string[]): OutlookMessage {
  const who = (r: { name?: string; email?: string; smtpAddress?: string }): Address => ({ name: r.name ?? '', email: cleanAddress(r.email, r.smtpAddress) });
  const rec = d.recipients ?? [];
  const attachments: OutlookAttachment[] = [];
  for (const a of d.attachments ?? []) {
    try {
      if (a.innerMsgContentFields) {
        if (depth >= 3) {
          warnings.push('Un mensaje adjunto dentro de otro mensaje adjunto demasiado profundo se omitió.');
          continue;
        }
        const inner = fromMsg(reader, a.innerMsgContentFields, depth + 1, warnings);
        attachments.push({ filename: `${inner.subject || 'mensaje'}.eml`, contentType: 'message/rfc822', data: enc.encode(outlookToMime(inner).raw) });
        continue;
      }
      const got = reader.getAttachment(a);
      if (got.content.length > MAX_ATTACHMENT) {
        warnings.push(`El adjunto «${got.fileName}» supera 50 MB y se omitió.`);
        continue;
      }
      attachments.push({ filename: a.fileName || a.fileNameShort || a.name || got.fileName || 'adjunto', contentType: a.attachMimeTag ?? '', data: got.content, contentId: a.pidContentId });
    } catch {
      warnings.push('Un adjunto no se pudo leer y se omitió.');
    }
  }
  return {
    subject: d.subject ?? '',
    from: d.senderName || d.senderEmail || d.senderSmtpAddress ? { name: d.senderName ?? '', email: cleanAddress(d.senderEmail, d.senderSmtpAddress) } : null,
    to: rec.filter((r) => (r.recipType ?? 'to') === 'to').map(who),
    cc: rec.filter((r) => r.recipType === 'cc').map(who),
    bcc: rec.filter((r) => r.recipType === 'bcc').map(who),
    date: when(d.clientSubmitTime) ?? when(d.messageDeliveryTime) ?? when(d.creationTime),
    messageId: brackets(d.messageId),
    text: d.body ?? '',
    html: d.bodyHtml || (d.html?.length ? decodeBytes(d.html, d.internetCodepage) : null),
    read: ((d.messageFlags ?? 0) & 1) === 1,
    attachments,
  };
}

/** Un archivo .msg: devuelve el mensaje ya como correo normal. */
export async function readMsg(data: Uint8Array): Promise<OutlookImport> {
  if (data.length > MAX_OUTLOOK_FILE) throw new Error('El archivo es demasiado grande.');
  await withBuffer();
  const mod = (await import('@kenjiuno/msgreader')) as unknown as { default: unknown; MsgReader?: unknown };
  // según cómo se empaquete la biblioteca, la clase viene en `default` o dentro de `default.default`
  const MsgReader = (typeof mod.default === 'function' ? mod.default : ((mod.default as { default?: unknown })?.default ?? mod.MsgReader)) as new (b: ArrayBuffer) => unknown;
  const copy = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const reader = new MsgReader(copy) as unknown as MsgReaderLike;
  const d = reader.getFileData();
  if (d.error) throw new Error(`No es un archivo .msg válido: ${d.error}`);
  const cls = (d as { messageClass?: string }).messageClass ?? 'IPM.Note';
  if (!/^IPM\.(Note|Post|Report)/i.test(cls) && cls !== '') throw new Error('Este archivo .msg no es un mensaje de correo (es un evento, un contacto u otro elemento de Outlook).');
  const warnings: string[] = [];
  const m = fromMsg(reader, d, 0, warnings);
  const { raw, bcc } = outlookToMime(m);
  return { tree: [{ name: '', messages: [{ raw, read: m.read, bcc }], children: [] }], messages: 1, skipped: 0, truncated: false, warnings: [...new Set(warnings)] };
}

// ------------------------------------------------------------------ .pst / .ost

/** Elementos de Outlook que no son carpetas de correo del usuario. */
const SYSTEM_FOLDERS = /^(search root|ipm_views|ipm_common_views|finder|reminders|to-do search|itemprocsearch|freebusy data|tracked mail processing|shortcuts|common views|views|deferred action|conversation action settings|quick step settings|spam search folder.*|schedule|sync issues.*|conflicts|local failures|server failures|working set|system|calendar logging|audits|recoverable items.*|apptsnapshots|yammer.*|externalcontacts|files|peopleconnect|conversation history)$/i;

/** Carpetas de avisos de sincronización de Outlook: no son correo del usuario. */
const SYNC_FOLDERS = /^(sync issues.*|conflicts|local failures|server failures)$/i;
/** Niveles que solo envuelven las carpetas reales. */
const WRAPPERS = /^(ipm_subtree|top of .*|root.*|raíz.*)$/i;

interface PstMessageLike {
  messageClass: string;
  subject: string;
  senderName: string;
  senderEmailAddress: string;
  senderEmailType?: string;
  body: string;
  bodyHTML: string;
  clientSubmitTime: Date | null;
  messageDeliveryTime: Date | null;
  internetMessageId: string;
  isRead: boolean;
  numberOfRecipients: number;
  numberOfAttachments: number;
  getRecipient(i: number): { recipientType: number; displayName: string; emailAddress: string; smtpAddress: string } | null;
  getAttachment(i: number): {
    filename: string;
    longFilename: string;
    displayName?: string;
    mimeTag: string;
    contentId: string;
    filesize: number;
    attachMethod: number;
    embeddedPSTMessage: PstMessageLike | null;
    fileInputStream: { read(b: Uint8Array): number } | null;
  };
}

interface PstFolderLike {
  displayName: string;
  contentCount: number;
  hasSubfolders: boolean;
  folderType?: number;
  getSubFolders(): PstFolderLike[];
  getNextChild(): unknown;
}

function pstAttachmentBytes(stream: { read(b: Uint8Array): number }, size: number, B: typeof import('buffer').Buffer): Uint8Array {
  const chunks: Uint8Array[] = [];
  const buf = B.alloc(8176);
  let n: number;
  let total = 0;
  do {
    n = stream.read(buf);
    if (n > 0) {
      chunks.push(Uint8Array.from(buf.subarray(0, n)));
      total += n;
    }
  } while (n === buf.length && total <= Math.max(size, 0) + 8176 * 4);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function fromPst(m: PstMessageLike, B: typeof import('buffer').Buffer, depth: number, warnings: string[]): OutlookMessage {
  const to: Address[] = [];
  const cc: Address[] = [];
  const bcc: Address[] = [];
  for (let i = 0; i < m.numberOfRecipients; i++) {
    const r = m.getRecipient(i);
    if (!r) continue;
    const a: Address = { name: r.displayName ?? '', email: cleanAddress(r.emailAddress, r.smtpAddress) };
    (r.recipientType === 2 ? cc : r.recipientType === 3 ? bcc : to).push(a);
  }
  const attachments: OutlookAttachment[] = [];
  for (let i = 0; i < m.numberOfAttachments; i++) {
    try {
      const a = m.getAttachment(i);
      if (a.embeddedPSTMessage) {
        if (depth >= 3) continue;
        const inner = fromPst(a.embeddedPSTMessage, B, depth + 1, warnings);
        attachments.push({ filename: `${inner.subject || 'mensaje'}.eml`, contentType: 'message/rfc822', data: enc.encode(outlookToMime(inner).raw) });
        continue;
      }
      if (!a.fileInputStream) continue;
      if (a.filesize > MAX_ATTACHMENT) {
        warnings.push(`El adjunto «${a.longFilename || a.filename}» supera 50 MB y se omitió.`);
        continue;
      }
      attachments.push({ filename: a.longFilename || a.filename || a.displayName || 'adjunto', contentType: a.mimeTag, data: pstAttachmentBytes(a.fileInputStream, a.filesize, B), contentId: a.contentId || undefined });
    } catch {
      warnings.push('Un adjunto no se pudo leer y se omitió.');
    }
  }
  return {
    subject: m.subject ?? '',
    from: m.senderName || m.senderEmailAddress ? { name: m.senderName ?? '', email: cleanAddress(m.senderEmailAddress) } : null,
    to,
    cc,
    bcc,
    date: when(m.clientSubmitTime) ?? when(m.messageDeliveryTime),
    messageId: brackets(m.internetMessageId),
    text: m.body ?? '',
    html: m.bodyHTML && m.bodyHTML.trim() ? m.bodyHTML : null,
    read: !!m.isRead,
    attachments,
  };
}

const isMail = (cls: string) => /^IPM\.(Note|Post|Report)/i.test(cls);

/** Un archivo .pst u .ost: lee todas las carpetas de correo (con sus subcarpetas) y los mensajes. */
export async function readPst(data: Uint8Array, opts: { maxMessages?: number; onProgress?: (n: number) => void } = {}): Promise<OutlookImport> {
  if (data.length > MAX_OUTLOOK_FILE) throw new Error('El archivo es demasiado grande (más de 1 GB): Nova Mail lo carga entero en memoria.');
  const B = await withBuffer();
  const { PSTFile, PSTMessage } = await import('pst-extractor');
  let pst: InstanceType<typeof PSTFile>;
  try {
    pst = new PSTFile(B.from(data.buffer, data.byteOffset, data.byteLength));
  } catch (e) {
    throw new Error(`No es un archivo de datos de Outlook válido (.pst u .ost): ${(e as Error).message}`);
  }
  const max = opts.maxMessages ?? MAX_PST_MESSAGES;
  const warnings: string[] = [];
  let count = 0;
  let skipped = 0;
  let truncated = false;

  const walk = async (f: PstFolderLike, depth: number): Promise<ImportedFolder | null> => {
    if (f.folderType === 2) return null; // carpetas de búsqueda: repiten mensajes de otras
    if (depth === 0 && SYSTEM_FOLDERS.test(f.displayName.trim())) return null;
    if (depth <= 2 && SYNC_FOLDERS.test(f.displayName.trim())) return null;
    const out: ImportedFolder = { name: f.displayName || 'Carpeta', messages: [], children: [] };
    if (f.contentCount > 0) {
      let item = f.getNextChild();
      while (item) {
        if (item instanceof PSTMessage && isMail((item as unknown as PstMessageLike).messageClass)) {
          if (count >= max) {
            truncated = true;
            break;
          }
          try {
            const m = fromPst(item as unknown as PstMessageLike, B, 0, warnings);
            const { raw, bcc } = outlookToMime(m);
            out.messages.push({ raw, read: m.read, bcc });
            count++;
            if (count % 100 === 0) {
              opts.onProgress?.(count);
              await tick();
            }
          } catch {
            warnings.push('Un mensaje no se pudo leer y se omitió.');
          }
        } else skipped++;
        item = f.getNextChild();
      }
    }
    if (f.hasSubfolders) {
      for (const s of f.getSubFolders()) {
        if (truncated) break;
        const c = await walk(s, depth + 1);
        if (c) out.children.push(c);
      }
    }
    return out.messages.length || out.children.length ? out : null;
  };

  const root = pst.getRootFolder() as unknown as PstFolderLike;
  const tree: ImportedFolder[] = [];
  const top = root.hasSubfolders ? root.getSubFolders() : [];
  for (const f of top) {
    if (truncated) break;
    const t = await walk(f, 0);
    if (t) tree.push(t);
  }
  // «Top of Personal Folders» y similares: un único nivel vacío que solo envuelve las carpetas reales
  let flat = tree;
  for (let i = 0; i < 3 && flat.length === 1 && flat[0]!.messages.length === 0 && (i === 0 || WRAPPERS.test(flat[0]!.name.trim())); i++) flat = flat[0]!.children;
  opts.onProgress?.(count);
  if (truncated) warnings.push(`Solo se importaron los primeros ${max} mensajes: el archivo tiene más.`);
  return { tree: flat, messages: count, skipped, truncated, warnings: [...new Set(warnings)] };
}

/** Lee un archivo de Outlook según su extensión. */
export async function readOutlookFile(name: string, data: Uint8Array, onProgress?: (n: number) => void): Promise<OutlookImport> {
  if (/\.msg$/i.test(name)) return readMsg(data);
  if (/\.(pst|ost)$/i.test(name)) return readPst(data, { onProgress });
  throw new Error('Este tipo de archivo no es de Outlook.');
}
