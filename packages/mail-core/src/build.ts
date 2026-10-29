import { encodeBase64, formatAddress, type Address } from './mime';

export interface OutgoingAttachment {
  filename: string;
  contentType: string;
  data: Uint8Array;
  /** Content-ID without the angle brackets: the attachment is an inline image referenced from the HTML as `cid:…`. */
  contentId?: string;
}

export interface Draft {
  from: Address;
  to: Address[];
  cc?: Address[];
  bcc?: Address[];
  subject: string;
  text: string;
  html?: string | null;
  attachments?: OutgoingAttachment[];
  date?: Date;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
}

const enc = new TextEncoder();
const CRLF = '\r\n';

/** RFC 2047 encoded word(s) for a header value that is not plain ASCII. */
export function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const words: string[] = [];
  let cur = '';
  // an encoded word is limited to 75 characters; split on code point boundaries at ~30 characters of text
  for (const ch of value) {
    if (enc.encode(cur + ch).length > 36) {
      words.push(cur);
      cur = '';
    }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words.map((w) => `=?UTF-8?B?${encodeBase64(enc.encode(w))}?=`).join(' ');
}

function encodeAddress(a: Address): string {
  const name = a.name ? (/^[\x20-\x7e]*$/.test(a.name) ? formatAddress({ name: a.name, email: a.email }).replace(/ <.*>$/, '') : encodeHeader(a.name)) : '';
  return name ? `${name} <${a.email}>` : a.email;
}

/** Fold a header line at 76 columns on whitespace. */
export function fold(name: string, value: string): string {
  const line = `${name}: ${value}`;
  if (line.length <= 76) return line;
  const out: string[] = [];
  let cur = '';
  for (const word of line.split(' ')) {
    if (cur && (cur + ' ' + word).length > 76) {
      out.push(cur);
      cur = ' ' + word;
    } else cur = cur ? cur + ' ' + word : word;
  }
  out.push(cur);
  return out.join(CRLF);
}

function qp(text: string): string {
  const bytes = enc.encode(text.replace(/\r?\n/g, '\r\n'));
  let out = '';
  let line = '';
  const push = (s: string) => {
    if (line.length + s.length > 75) {
      out += line + '=' + CRLF;
      line = '';
    }
    line += s;
  };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 13 && bytes[i + 1] === 10) {
      // trailing whitespace before a line break must be encoded
      if (line.endsWith(' ') || line.endsWith('\t')) line = line.slice(0, -1) + '=' + (line.endsWith(' ') ? '20' : '09');
      out += line + CRLF;
      line = '';
      i++;
    } else if ((b >= 33 && b <= 126 && b !== 61) || b === 32 || b === 9) push(String.fromCharCode(b));
    else push('=' + b.toString(16).toUpperCase().padStart(2, '0'));
  }
  return out + line;
}

function base64Lines(b: Uint8Array): string {
  const s = encodeBase64(b);
  return (s.match(/.{1,76}/g) ?? []).join(CRLF);
}

let seq = 0;
const boundary = (): string => `----=_Nova_${Date.now().toString(36)}_${(seq++).toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

export function newMessageId(domain = 'nova.local'): string {
  return `<${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}@${domain}>`;
}

const dateHeader = (d: Date) => d.toUTCString().replace('GMT', '+0000');

/** The message as RFC 5322 text with CRLF line endings. Bcc recipients are not written to the headers. */
export function buildMessage(d: Draft): string {
  const h: string[] = [];
  h.push(fold('Date', dateHeader(d.date ?? new Date())));
  h.push(fold('From', encodeAddress(d.from)));
  if (d.to.length) h.push(fold('To', d.to.map(encodeAddress).join(', ')));
  if (d.cc?.length) h.push(fold('Cc', d.cc.map(encodeAddress).join(', ')));
  h.push(fold('Subject', encodeHeader(d.subject)));
  h.push(fold('Message-ID', d.messageId ?? newMessageId(d.from.email.split('@')[1])));
  if (d.inReplyTo) h.push(fold('In-Reply-To', d.inReplyTo));
  if (d.references?.length) h.push(fold('References', d.references.join(' ')));
  h.push('MIME-Version: 1.0');

  const textPart = (type: string, body: string) => `Content-Type: ${type}; charset=UTF-8${CRLF}Content-Transfer-Encoding: quoted-printable${CRLF}${CRLF}${qp(body)}`;
  let body: string;
  let ctype: string;
  const alt = d.html ? (() => {
    const b = boundary();
    return { b, text: `--${b}${CRLF}${textPart('text/plain', d.text)}${CRLF}--${b}${CRLF}${textPart('text/html', d.html!)}${CRLF}--${b}--` };
  })() : null;
  // inline images (referenced from the HTML) go with it in a multipart/related; the rest are attachments of a multipart/mixed
  const inline = d.html ? (d.attachments ?? []).filter((a) => a.contentId) : [];
  const regular = (d.attachments ?? []).filter((a) => !inline.includes(a));
  const attachmentPart = (b: string, a: OutgoingAttachment, disposition: 'attachment' | 'inline') => {
    const name = encodeHeader(a.filename);
    const star = /^[\x20-\x7e]*$/.test(a.filename) ? `filename="${a.filename.replace(/(["\\])/g, '\\$1')}"` : `filename*=UTF-8''${encodeURIComponent(a.filename)}`;
    const cid = a.contentId ? `Content-ID: <${a.contentId}>${CRLF}` : '';
    return `--${b}${CRLF}Content-Type: ${a.contentType || 'application/octet-stream'}; name="${name}"${CRLF}Content-Disposition: ${disposition}; ${star}${CRLF}${cid}Content-Transfer-Encoding: base64${CRLF}${CRLF}${base64Lines(a.data)}`;
  };
  // the body: text, or text and HTML, or those with their inline images
  let main: { type: string; text: string };
  if (alt) {
    main = { type: `multipart/alternative; boundary="${alt.b}"`, text: alt.text };
    if (inline.length) {
      const rb = boundary();
      main = { type: `multipart/related; boundary="${rb}"`, text: `--${rb}${CRLF}Content-Type: ${main.type}${CRLF}${CRLF}${main.text}${CRLF}${inline.map((a) => attachmentPart(rb, a, 'inline')).join(CRLF)}${CRLF}--${rb}--` };
    }
  } else main = { type: 'text/plain; charset=UTF-8', text: qp(d.text) };
  if (!regular.length) {
    ctype = main.type;
    if (!alt) h.push(`Content-Transfer-Encoding: quoted-printable`);
    body = main.text;
  } else {
    const b = boundary();
    ctype = `multipart/mixed; boundary="${b}"`;
    const first = alt ? `Content-Type: ${main.type}${CRLF}${CRLF}${main.text}` : textPart('text/plain', d.text);
    body = `--${b}${CRLF}${first}${CRLF}${regular.map((a) => attachmentPart(b, a, 'attachment')).join(CRLF)}${CRLF}--${b}--`;
  }
  h.push(`Content-Type: ${ctype}`);
  return h.join(CRLF) + CRLF + CRLF + body + (body.endsWith(CRLF) ? '' : CRLF);
}
