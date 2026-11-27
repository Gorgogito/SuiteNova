/**
 * The original of a reply or a forward. It is kept as it arrived (its HTML, made harmless, and its pictures) and goes below
 * what is written, as in Outlook; it can also be turned into text to answer inside it.
 */
import { encodeBase64, formatAddress, parseMessage, quoteText, type OutgoingAttachment } from '@suitenova/mail-core';
import { esc } from './html';
import { sanitizeMailHtml } from './sanitize';

export interface Quote {
  kind: 'reply' | 'forward';
  /** The lines over the original: «El … escribió:» or the From, Date, Subject and To of a forward. */
  head: [label: string, value: string][];
  /** The original as safe HTML, or null when it was plain text. */
  html: string | null;
  /** The whole quote as plain text (starts with the blank lines that part it from the answer). */
  text: string;
  /** The pictures the HTML refers to. */
  inline: OutgoingAttachment[];
}

export function makeQuote(raw: Uint8Array, kind: Quote['kind']): Quote {
  const m = parseMessage(raw);
  const who = m.from[0] ? formatAddress(m.from[0]) : '';
  const when = m.date ? m.date.toLocaleString() : '';
  const head: Quote['head'] =
    kind === 'reply'
      ? [['', when ? `El ${when}, ${who} escribió:` : `${who} escribió:`]]
      : [
          ['', '---------- Mensaje reenviado ----------'],
          ['De', who],
          ['Fecha', when],
          ['Asunto', m.subject],
          ['Para', m.to.map(formatAddress).join(', ')],
        ];
  let html: string | null = null;
  let inline: OutgoingAttachment[] = [];
  if (m.html !== null) {
    const safe = sanitizeMailHtml(m.html);
    html = safe.styles + safe.body.innerHTML;
    inline = m.inlineParts.filter((p) => p.cid && html!.includes(`cid:${p.cid}`)).map((p) => ({ filename: p.filename, contentType: p.contentType, data: p.data, contentId: p.cid! }));
  }
  return { kind, head, html, text: quoteText(raw, kind), inline };
}

/** The quote as it goes in the HTML of the message. */
export function quoteHtml(q: Quote): string {
  const head = q.head.map(([label, value]) => `<p style="margin:0">${label ? `<b>${esc(label)}:</b> ` : ''}${esc(value)}</p>`).join('');
  // the text form carries the original with «> » or under its header: without HTML, the original lines are taken from it
  const plain = q.kind === 'reply' ? q.text.split('\n').filter((l) => l.startsWith('> ') || l === '>').map((l) => l.slice(2)).join('\n') : q.text.replace(/^[\s\S]*?\nPara: [^\n]*\n\n/, '');
  const body = q.html ?? `<div style="white-space:pre-wrap">${esc(plain.replace(/\n+$/, ''))}</div>`;
  const original = q.kind === 'reply' ? `<blockquote style="margin:6px 0 0 4px;padding-left:10px;border-left:2px solid #b5c4df">${body}</blockquote>` : `<div style="margin-top:8px">${body}</div>`;
  return `<div style="margin-top:12px;border-top:1px solid #cccccc;padding-top:8px">${head}</div>${original}`;
}

/** The quote as a page to look at while writing: pictures of the message are shown, remote content is not asked for. */
export function quotePreview(q: Quote): string {
  let html = quoteHtml(q);
  for (const a of q.inline) html = html.split(`cid:${a.contentId}`).join(`data:${a.contentType};base64,${encodeBase64(a.data)}`);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"><style>html{color-scheme:light}body{margin:10px;font:14px 'Segoe UI',Calibri,Arial,sans-serif;color:#222;background:#fff;word-wrap:break-word}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;
}
