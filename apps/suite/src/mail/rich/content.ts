/** The parts of the message being written: its text and, when it has any formatting, its HTML with its pictures. */
import type { OutgoingAttachment } from '@suitenova/mail-core';
import { writerSchema } from '@suitenova/writer-core';
import type { Node as PMNode } from 'prosemirror-model';
import { docFromText } from './parse';
import { renderMail } from './html';
import { quoteHtml, type Quote } from './quote';

export interface Written {
  /** Plain text of what is written (without the original). */
  body: string;
  /** The editor's document; without it, `body` is the message. */
  doc?: unknown;
  /** The original of a reply or a forward. */
  quote?: Quote;
}

/** The document of what is written. A stored one that cannot be read gives its text. */
export function docOf(w: Written): PMNode {
  if (w.doc) {
    try {
      const doc = writerSchema.nodeFromJSON(w.doc);
      doc.check();
      return doc;
    } catch {
      /* from a damaged file: the text is not lost */
    }
  }
  return docFromText(w.body);
}

export function messageContent(w: Written): { text: string; html: string | null; inline: OutgoingAttachment[] } {
  const r = w.doc ? renderMail(docOf(w)) : null;
  const text = (r ? r.text : w.body) + (w.quote?.text ?? '');
  // plain text stays plain; an original in HTML takes the answer with it into HTML
  if (!r?.rich && !w.quote?.html) return { text, html: null, inline: [] };
  const own = r ?? renderMail(docOf(w));
  const html = `<html><body style="font-family:Calibri,'Segoe UI',sans-serif;font-size:11pt">${own.html}${w.quote ? quoteHtml(w.quote) : ''}</body></html>`;
  return { text, html, inline: [...own.inline, ...(w.quote?.inline ?? [])] };
}
