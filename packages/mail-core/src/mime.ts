/** RFC 5322 / MIME reader. Everything works on bytes so that 8-bit and binary parts survive. */

export interface Address {
  name: string;
  email: string;
}

export interface Attachment {
  filename: string;
  contentType: string;
  data: Uint8Array;
  /** Content-ID without the angle brackets (inline images). */
  cid?: string;
  inline: boolean;
}

export interface ParsedMessage {
  headers: [string, string][];
  subject: string;
  from: Address[];
  to: Address[];
  cc: Address[];
  replyTo: Address[];
  date: Date | null;
  messageId: string;
  inReplyTo: string;
  references: string[];
  text: string | null;
  html: string | null;
  /** Parts shown to the user as attachments (not inline images referenced by the HTML). */
  attachments: Attachment[];
  /** Images referenced by `cid:` from the HTML. */
  inlineParts: Attachment[];
  /** Problems found while reading (unknown charset, broken encoding…). */
  warnings: string[];
}

const enc = new TextEncoder();

export function bytesOf(raw: string | Uint8Array): Uint8Array {
  return typeof raw === 'string' ? enc.encode(raw) : raw;
}

const latin1 = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
};

export function decodeCharset(bytes: Uint8Array, charset: string | undefined, warnings?: string[]): string {
  const label = (charset ?? 'utf-8').trim().toLowerCase().replace(/^"|"$/g, '');
  const map: Record<string, string> = { 'us-ascii': 'utf-8', ascii: 'utf-8', 'iso-8859-1': 'windows-1252', latin1: 'windows-1252', 'ks_c_5601-1987': 'euc-kr', unicode: 'utf-16le', 'utf-7': 'utf-8' };
  try {
    return new TextDecoder(map[label] ?? label).decode(bytes);
  } catch {
    warnings?.push(`Juego de caracteres desconocido: ${label}`);
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export function decodeBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const bin = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(s);
}

/** Quoted-printable to bytes. `header` mode is the "Q" encoding of RFC 2047 (underscore is a space). */
export function decodeQuotedPrintable(s: string, header = false): Uint8Array {
  const text = header ? s.replace(/_/g, ' ') : s.replace(/=\r?\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const code = text.charCodeAt(i);
      if (code < 128) out.push(code);
      else out.push(...enc.encode(c));
    }
  }
  return Uint8Array.from(out);
}

/** Decode RFC 2047 encoded words in a header value. */
export function decodeWords(value: string): string {
  const joined = value.replace(/(\?=)\s+(=\?)/g, '$1$2'); // whitespace between encoded words is dropped
  return joined.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, charset: string, e: string, text: string) => {
    try {
      const cs = charset.split('*')[0]!;
      const bytes = e.toLowerCase() === 'b' ? decodeBase64(text) : decodeQuotedPrintable(text, true);
      return decodeCharset(bytes, cs);
    } catch {
      return text;
    }
  });
}

// ---------- headers ----------

function splitHeadBody(b: Uint8Array): { head: string; body: Uint8Array } {
  let i = 0;
  const n = b.length;
  // find an empty line: LF LF, CRLF CRLF, or a leading empty line
  if (n && (b[0] === 10 || (b[0] === 13 && b[1] === 10))) return { head: '', body: b.subarray(b[0] === 13 ? 2 : 1) };
  while (i < n - 1) {
    if (b[i] === 10 && b[i + 1] === 10) return { head: latin1(b.subarray(0, i)), body: b.subarray(i + 2) };
    if (b[i] === 10 && b[i + 1] === 13 && b[i + 2] === 10) return { head: latin1(b.subarray(0, i)), body: b.subarray(i + 3) };
    i++;
  }
  return { head: latin1(b), body: new Uint8Array(0) };
}

/** Header lines with continuation lines unfolded. Names keep their case; values are raw (not yet decoded). */
export function parseHeaders(head: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1]![1] += ' ' + line.trim();
    else {
      const i = line.indexOf(':');
      if (i > 0) out.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
    }
  }
  return out;
}

const header = (h: [string, string][], name: string): string => h.find(([k]) => k.toLowerCase() === name)?.[1] ?? '';

/** The headers values are bytes read as Latin-1; convert to real text assuming UTF-8 when valid (8-bit headers). */
function headerText(v: string): string {
  if (/[\u0080-\u00ff]/.test(v)) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(v, (c) => c.charCodeAt(0)));
    } catch {
      return v;
    }
  }
  return v;
}

interface Params {
  value: string;
  params: Record<string, string>;
}

function percentBytes(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '%' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      out.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(...enc.encode(s[i]!));
  }
  return Uint8Array.from(out);
}

/** `text/plain; charset="utf-8"; name*=utf-8''a%20b` → value and parameters (RFC 2231 continuations and encodings handled). */
export function parseParams(v: string): Params {
  const parts: string[] = [];
  let cur = '';
  let q = false;
  for (const ch of v) {
    if (ch === '"') q = !q;
    if (ch === ';' && !q) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  const value = (parts.shift() ?? '').trim().toLowerCase();
  const raw: Record<string, string> = {};
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i < 0) continue;
    raw[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim().replace(/^"(.*)"$/s, '$1').replace(/\\(.)/g, '$1');
  }
  const params: Record<string, string> = {};
  const done = new Set<string>();
  for (const k of Object.keys(raw)) {
    const m = /^([^*]+)(?:\*(\d+))?(\*)?$/.exec(k);
    if (!m) {
      params[k] = raw[k]!;
      continue;
    }
    const base = m[1]!;
    if (done.has(base)) continue;
    if (!m[2] && !m[3]) {
      params[base] = raw[k]!;
      continue;
    }
    // continuation and/or extended value
    done.add(base);
    let text = '';
    let charset = 'utf-8';
    for (let i = 0; ; i++) {
      const key = raw[`${base}*${i}*`] !== undefined ? `${base}*${i}*` : raw[`${base}*${i}`] !== undefined ? `${base}*${i}` : i === 0 && raw[`${base}*`] !== undefined ? `${base}*` : '';
      if (!key) break;
      let piece = raw[key]!;
      if (key.endsWith('*')) {
        if (i === 0) {
          const mm = /^([^']*)'[^']*'(.*)$/s.exec(piece);
          if (mm) {
            charset = mm[1] || 'utf-8';
            piece = mm[2]!;
          }
        }
        piece = decodeCharset(percentBytes(piece), charset);
      }
      text += piece;
      if (key === `${base}*`) break;
    }
    params[base] = text;
  }
  return { value, params };
}

// ---------- addresses ----------

/** Split a list of addresses at commas that are not inside quotes, angle brackets or comments. */
export function parseAddresses(value: string): Address[] {
  const text = decodeWords(headerText(value));
  const items: string[] = [];
  let cur = '';
  let q = false, angle = 0, paren = 0;
  for (const ch of text) {
    if (ch === '"' && !paren) q = !q;
    else if (!q && ch === '(') paren++;
    else if (!q && ch === ')' && paren) paren--;
    else if (!q && !paren && ch === '<') angle++;
    else if (!q && !paren && ch === '>') angle = Math.max(0, angle - 1);
    if ((ch === ',' || ch === ';') && !q && !angle && !paren) {
      items.push(cur);
      cur = '';
    } else cur += ch;
  }
  items.push(cur);
  const out: Address[] = [];
  for (let it of items) {
    it = it.replace(/\([^)]*\)/g, ' ').trim().replace(/^[^<>"@,;:]+:\s*(?=\S)/, ''); // drop a group name
    if (!it) continue;
    const m = /^(.*?)<\s*([^<>\s]+)\s*>\s*$/s.exec(it);
    if (m) out.push({ name: m[1]!.trim().replace(/^"(.*)"$/s, '$1').replace(/\\(.)/g, '$1').trim(), email: m[2]!.trim() });
    else if (/^[^\s@]+@[^\s@]+$/.test(it)) out.push({ name: '', email: it });
    else if (/^[^:]+:\s*$/.test(it)) continue; // group name
    else if (it.includes('@')) out.push({ name: '', email: it.replace(/[<>"\s]/g, '') });
  }
  return out;
}

export const formatAddress = (a: Address): string => (a.name ? `${/[",;<>@()]/.test(a.name) ? `"${a.name.replace(/(["\\])/g, '\\$1')}"` : a.name} <${a.email}>` : a.email);

// ---------- body parts ----------

interface RawPart {
  headers: [string, string][];
  body: Uint8Array;
}

function splitMultipart(body: Uint8Array, boundary: string): RawPart[] {
  const text = latin1(body);
  const delim = '--' + boundary;
  const parts: RawPart[] = [];
  let pos = text.indexOf(delim);
  while (pos >= 0) {
    let after = pos + delim.length;
    if (text.slice(after, after + 2) === '--') break;
    // skip the rest of the boundary line
    const eol = text.indexOf('\n', after);
    if (eol < 0) break;
    after = eol + 1;
    const next = text.indexOf('\n' + delim, after - 1);
    const end = next < 0 ? text.length : next;
    let chunkEnd = end;
    if (text[chunkEnd - 1] === '\r') chunkEnd--;
    const chunk = body.subarray(after, Math.max(after, chunkEnd));
    const { head, body: b } = splitHeadBody(chunk);
    parts.push({ headers: parseHeaders(head), body: b });
    pos = next < 0 ? -1 : next + 1;
  }
  return parts;
}

function decodeTransfer(body: Uint8Array, cte: string): Uint8Array {
  switch (cte.trim().toLowerCase()) {
    case 'base64':
      return decodeBase64(latin1(body));
    case 'quoted-printable':
      return decodeQuotedPrintable(latin1(body));
    default:
      return body;
  }
}

interface Collected {
  text: string[];
  html: string[];
  attachments: Attachment[];
  inline: Attachment[];
  warnings: string[];
}

function walk(part: RawPart, out: Collected, depth = 0): void {
  if (depth > 20) return;
  const ct = parseParams(header(part.headers, 'content-type') || 'text/plain');
  const type = ct.value || 'text/plain';
  const disp = parseParams(header(part.headers, 'content-disposition'));
  if (type.startsWith('multipart/')) {
    const boundary = ct.params.boundary;
    if (!boundary) return;
    const children = splitMultipart(part.body, boundary);
    if (type === 'multipart/alternative') {
      // every alternative is collected: plain text and html both end up available
      for (const c of children) walk(c, out, depth + 1);
    } else for (const c of children) walk(c, out, depth + 1);
    return;
  }
  const bytes = decodeTransfer(part.body, header(part.headers, 'content-transfer-encoding'));
  const filename = disp.params.filename || ct.params.name || '';
  const cid = header(part.headers, 'content-id').replace(/^<|>$/g, '');
  const isAttachment = disp.value === 'attachment' || (!!filename && !type.startsWith('text/')) || (!!filename && disp.value === 'attachment');
  if ((type === 'text/plain' || type === 'text/html') && !isAttachment && !(disp.value === 'attachment')) {
    const text = decodeCharset(bytes, ct.params.charset, out.warnings);
    (type === 'text/html' ? out.html : out.text).push(text);
    return;
  }
  const a: Attachment = { filename: decodeWords(headerText(filename)) || (type === 'message/rfc822' ? 'mensaje.eml' : type.startsWith('image/') ? `imagen.${type.split('/')[1]}` : 'adjunto'), contentType: type, data: bytes, cid: cid || undefined, inline: disp.value === 'inline' || (!!cid && !isAttachment) };
  if (cid && type.startsWith('image/') && disp.value !== 'attachment') out.inline.push(a);
  else out.attachments.push(a);
}

export function parseMessage(raw: string | Uint8Array): ParsedMessage {
  const bytes = bytesOf(raw);
  const { head, body } = splitHeadBody(bytes);
  const headers = parseHeaders(head).map(([k, v]) => [k, headerText(v)] as [string, string]);
  const out: Collected = { text: [], html: [], attachments: [], inline: [], warnings: [] };
  walk({ headers, body }, out);
  const dateRaw = header(headers, 'date');
  const t = dateRaw ? Date.parse(dateRaw.replace(/\s*\([^)]*\)\s*$/, '')) : NaN;
  const html = out.html.length ? out.html.join('\n') : null;
  const refs = header(headers, 'references').match(/<[^>]+>/g) ?? [];
  // inline images that the HTML never references are ordinary attachments
  const used = (a: Attachment) => !!html && !!a.cid && html.includes(`cid:${a.cid}`);
  const inlineParts = out.inline.filter(used);
  const attachments = [...out.attachments, ...out.inline.filter((a) => !used(a))];
  return {
    headers,
    subject: decodeWords(header(headers, 'subject')),
    from: parseAddresses(header(headers, 'from')),
    to: parseAddresses(header(headers, 'to')),
    cc: parseAddresses(header(headers, 'cc')),
    replyTo: parseAddresses(header(headers, 'reply-to')),
    date: Number.isFinite(t) ? new Date(t) : null,
    messageId: header(headers, 'message-id'),
    inReplyTo: header(headers, 'in-reply-to'),
    references: refs,
    text: out.text.length ? out.text.join('\n') : null,
    html,
    attachments,
    inlineParts,
    warnings: out.warnings,
  };
}

/** Plain text of a message for previews and search: the text part, else the HTML stripped of tags. */
export function bodyText(m: ParsedMessage): string {
  if (m.text !== null) return m.text;
  if (m.html === null) return '';
  return m.html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}
