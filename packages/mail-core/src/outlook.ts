import { buildMessage, type OutgoingAttachment } from './build';
import type { Address } from './mime';

/*
 * Mensajes de Outlook (.msg, .pst, .ost) ya leídos de su formato propio (MAPI) y pasados a una forma común. Aquí solo se
 * convierten a un mensaje de correo normal (RFC 5322 con MIME) que Nova Mail guarda como cualquier otro. La lectura de los
 * formatos de Outlook la hacen las bibliotecas de la aplicación; esto no depende de ellas.
 */

export interface OutlookAttachment {
  filename: string;
  contentType: string;
  data: Uint8Array;
  /** Para imágenes que el HTML muestra con `cid:`. */
  contentId?: string;
}

export interface OutlookMessage {
  subject: string;
  from: Address | null;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  date: Date | null;
  messageId?: string;
  text: string;
  html: string | null;
  read: boolean;
  flagged?: boolean;
  attachments: OutlookAttachment[];
}

/**
 * Una dirección que sirva en un mensaje: la SMTP si se conoce. Exchange guarda a veces la dirección interna (X.500,
 * `/O=…/CN=Recipients/CN=ana`): se muestra como `ana@exchange.invalid` en lugar de inventar un dominio real.
 */
export function cleanAddress(email: string | undefined, smtp?: string): string {
  const ok = (s: string | undefined): s is string => !!s && /^[^\s@<>,;"]+@[^\s@<>,;"]+$/.test(s.trim()) && !s.trim().startsWith('/');
  if (ok(smtp)) return smtp.trim();
  if (ok(email)) return email.trim();
  const cn = /CN=([^/]+)\s*$/i.exec(email ?? '')?.[1];
  if (cn) return `${cn.toLowerCase().replace(/[^a-z0-9._-]+/g, '.').replace(/^\.+|\.+$/g, '') || 'usuario'}@exchange.invalid`;
  return 'desconocido@invalid';
}

const EXT_TYPES: Record<string, string> = {
  txt: 'text/plain', htm: 'text/html', html: 'text/html', csv: 'text/csv', xml: 'application/xml', json: 'application/json', pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip', eml: 'message/rfc822', msg: 'application/vnd.ms-outlook', ics: 'text/calendar', vcf: 'text/vcard', mp3: 'audio/mpeg', mp4: 'video/mp4',
};

export function guessType(filename: string, declared?: string): string {
  if (declared && /^[\w.+-]+\/[\w.+-]+$/.test(declared.trim())) return declared.trim().toLowerCase();
  return EXT_TYPES[filename.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

/** Nunca un salto de línea ni un carácter de control en una cabecera: nadie puede colar otra cabecera. */
const oneLine = (s: string): string => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

const person = (a: Address): Address => ({ name: oneLine(a.name || ''), email: cleanAddress(a.email) });

/** El mensaje como correo normal. Los destinatarios ocultos (Cco) no van en las cabeceras: se devuelven aparte. */
export function outlookToMime(m: OutlookMessage): { raw: string; bcc: string[] } {
  const from = m.from ? person(m.from) : { name: '(sin remitente)', email: 'desconocido@invalid' };
  const date = m.date && !Number.isNaN(m.date.getTime()) ? m.date : undefined;
  const messageId = m.messageId && /^<[^<>\s]+>$/.test(m.messageId.trim()) ? m.messageId.trim() : `<${hash(`${m.subject}|${date?.getTime() ?? ''}|${from.email}|${m.text.length}`)}@outlook.import>`;
  const attachments: OutgoingAttachment[] = m.attachments.map((a, i) => ({
    filename: oneLine(a.filename) || `adjunto-${i + 1}`,
    contentType: guessType(a.filename, a.contentType),
    data: a.data,
    contentId: a.contentId ? a.contentId.replace(/[<>\s]/g, '') || undefined : undefined,
  }));
  const raw = buildMessage({
    from,
    to: m.to.map(person),
    cc: m.cc.map(person),
    subject: oneLine(m.subject),
    text: m.text.replace(/\r\n|\r|\n/g, '\n'),
    html: m.html && m.html.trim() ? m.html : null,
    attachments,
    date,
    messageId,
  });
  return { raw, bcc: m.bcc.map((a) => cleanAddress(a.email)) };
}
