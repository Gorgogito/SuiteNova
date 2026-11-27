import { t } from '@suitenova/core-ui';
import { formatAddress, parseMessage, rawOf, type Address, type MailRecord } from '@suitenova/mail-core';
import { safeHtml } from './MailViews';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The page that is printed: the headings of the message and its body, made safe as when it is read. */
export function printableHtml(rec: MailRecord): string {
  const m = parseMessage(rawOf(rec));
  const list = (l: Address[]) => l.map(formatAddress).join(', ');
  const rows: [string, string][] = [
    [t('De'), list(m.from)],
    [t('Para'), list(m.to)],
    ['Cc', list(m.cc)],
    ['Cco', (rec.bcc ?? []).join(', ')],
    [t('Fecha'), m.date ? m.date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }) : ''],
    [t('Adjuntos'), m.attachments.map((a) => a.filename).join(', ')],
  ];
  const head = `<div style="font:12px 'Segoe UI',Calibri,Arial,sans-serif;color:#000;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:12px"><div style="font-size:17px;font-weight:600;margin-bottom:6px">${esc(m.subject || t('(sin asunto)'))}</div>${rows
    .filter(([, v]) => v)
    .map(([k, v]) => `<div><b style="display:inline-block;min-width:72px">${esc(k)}:</b> ${esc(v)}</div>`)
    .join('')}</div>`;
  return safeHtml(m, false).html.replace('<body>', () => `<body>${head}`);
}

export function printMessage(rec: MailRecord): void {
  document.querySelector('iframe.ml-print')?.remove();
  const frame = document.createElement('iframe');
  frame.className = 'ml-print';
  frame.title = t('Impresión');
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0';
  frame.addEventListener('load', () => {
    // a moment for the pictures to be laid out
    setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    }, 60);
  });
  frame.srcdoc = printableHtml(rec);
  document.body.appendChild(frame);
}
