import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { encodeBase64, formatAddress, isDone, isOverdue, isSafeSender, parseMessage, rawOf, type MailRecord, type ParsedMessage } from '@suitenova/mail-core';
import { useMemo, useRef, useState } from 'react';
import { saveBytes } from '../fileio';
import { FindPanel } from '../find';
import { frameFindHost } from './find-hosts';
import { CategoryChips } from './CategoryViews';
import type { MailCtl } from './ctl';
import { sanitizeMailHtml } from './rich/sanitize';

// ---------------------------------------------------------------------------------------------- reading pane
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function linkify(text: string): string {
  return esc(text).replace(/\bhttps?:\/\/[^\s<>"')]+/g, (u) => `<a href="${u}">${u}</a>`);
}

const REMOTE = /(?:src|background|srcset)\s*=\s*["']?\s*https?:|url\(\s*["']?\s*https?:/i;

/** HTML of a message made safe to show: no scripts, frames or forms; `cid:` images inlined; remote content only when allowed. */
export function safeHtml(m: ParsedMessage, allowRemote: boolean): { html: string; hasRemote: boolean } {
  let body: string;
  let hasRemote = false;
  if (m.html !== null) {
    const safe = sanitizeMailHtml(m.html);
    safe.body.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') ?? '';
      if (src.startsWith('cid:')) {
        const part = m.inlineParts.find((p) => p.cid === src.slice(4));
        if (part) img.setAttribute('src', `data:${part.contentType};base64,${encodeBase64(part.data)}`);
      }
    });
    hasRemote = REMOTE.test(safe.styles + safe.body.outerHTML);
    body = safe.styles + safe.body.innerHTML;
  } else body = `<pre style="white-space:pre-wrap;font:inherit;margin:0">${linkify(m.text ?? '')}</pre>`;
  const img = allowRemote ? 'img-src data: https: http:' : 'img-src data:';
  return {
    hasRemote,
    html: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${img}; style-src 'unsafe-inline'; font-src data:"><style>html{color-scheme:light}body{margin:12px;font:14px 'Segoe UI',Calibri,Arial,sans-serif;color:#222;background:#fff;word-wrap:break-word}img{max-width:100%;height:auto}a{color:#0b5cad}blockquote{margin:8px 0 8px 4px;padding-left:10px;border-left:3px solid #ccc;color:#555}</style></head><body>${body}</body></html>`,
  };
}

/** Asks before a link in a message is opened. Always mounted, so closing it can never be cut short. */
export function LinkConfirm({ link, onClose }: { link: string | null; onClose: () => void }) {
  return (
    <Dialog open={link !== null} modalType="modal" onOpenChange={(_e, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 520, width: '92vw' }}>
        <DialogBody>
          <DialogTitle>{t('¿Abrir este vínculo?')}</DialogTitle>
          <DialogContent>
            <p style={{ wordBreak: 'break-all' }}>{link ?? ''}</p>
            <p>{t('Comprueba que la dirección es la que esperas antes de continuar.')}</p>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{t('Cancelar')}</Button>
            <Button
              appearance="primary"
              onClick={() => {
                if (link) window.open(link, '_blank', 'noopener,noreferrer');
                onClose();
              }}
            >
              {t('Abrir')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export function ReadingPane({ ctl, rec, onLink }: { ctl: MailCtl; rec: MailRecord; onLink: (href: string) => void }) {
  const parsed = useMemo(() => parseMessage(rawOf(rec)), [rec.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [allow, setAllow] = useState<string | null>(null);
  // the pictures of a safe sender are shown without asking, except in junk mail
  const allowRemote = allow === rec.id || (rec.folder !== 'junk' && isSafeSender(ctl.data, rec.fromEmail));
  const day = (t: number) => new Date(t).toLocaleDateString(undefined, { dateStyle: 'long' });
  const { html, hasRemote } = useMemo(() => safeHtml(parsed, allowRemote), [parsed, allowRemote]);
  const frame = useRef<HTMLIFrameElement>(null);
  const [finding, setFinding] = useState(false);
  const findHost = useMemo(() => frameFindHost(() => frame.current?.contentDocument ?? null), []);
  const addr = (l: { name: string; email: string }[]) => l.map(formatAddress).join(', ');

  const onLoad = () => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    doc.addEventListener('keydown', (e) => {
      if (e.key === 'F4') (e.preventDefault(), setFinding(true));
    });
    // the frame has no scripts: clicks on links are caught from outside and confirmed before leaving the app
    doc.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute('href') ?? '';
      if (/^(https?:|mailto:)/i.test(href)) onLink(href);
    });
    const h = doc.documentElement.scrollHeight;
    if (frame.current && h > 0) frame.current.style.height = Math.max(120, h + 8) + 'px';
  };

  return (
    <article className="ml-read" aria-label={t('Mensaje')} onKeyDown={(e) => e.key === 'F4' && (e.preventDefault(), setFinding(true))}>
      <header>
        <h2>{parsed.subject || t('(sin asunto)')}</h2>
        <button type="button" className="ml-btn" onClick={() => setFinding(true)} title="F4">
          {t('Buscar en el mensaje')}
        </button>
        <dl>
          <dt>{t('De')}</dt>
          <dd>{addr(parsed.from) || '—'}</dd>
          <dt>{t('Para')}</dt>
          <dd>{addr(parsed.to) || '—'}</dd>
          {parsed.cc.length > 0 && (
            <>
              <dt>Cc</dt>
              <dd>{addr(parsed.cc)}</dd>
            </>
          )}
          {rec.bcc && rec.bcc.length > 0 && (
            <>
              <dt>Cco</dt>
              <dd>{rec.bcc.join(', ')}</dd>
            </>
          )}
          <dt>{t('Fecha')}</dt>
          <dd>{parsed.date ? parsed.date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }) : '—'}</dd>
        </dl>
        {parsed.attachments.length > 0 && (
          <ul className="ml-attach" aria-label={t('Adjuntos')}>
            {parsed.attachments.map((a, i) => (
              <li key={i}>
                <button type="button" onClick={() => void saveBytes(a.filename, a.data, [])}>
                  📎 {a.filename} <span>({Math.max(1, Math.round(a.data.length / 1024))} KB)</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {hasRemote && !allowRemote && (
          <div className="ml-remote" role="status">
            {t('Se bloqueó el contenido externo (imágenes remotas) para proteger tu privacidad.')}{' '}
            <button type="button" onClick={() => setAllow(rec.id)}>
              {t('Mostrar contenido externo')}
            </button>
          </div>
        )}
        {rec.importance && (
          <div className="ml-importance" role="note">
            {rec.importance === 'high' ? `❗ ${t('Este mensaje se envió con importancia alta.')}` : `↓ ${t('Este mensaje se envió con importancia baja.')}`}
          </div>
        )}
        <CategoryChips data={ctl.data} names={rec.categories} />
        {rec.flagged && (
          <div className={`ml-follow${isOverdue(rec, Date.now()) ? ' is-late' : ''}`} role="note">
            <span>⚑ {rec.follow?.due != null ? t('Seguimiento: vence el {date}.', { date: day(rec.follow.due) }) : t('Marcado para seguimiento.')}</span>
            <button type="button" onClick={() => ctl.completeMany([rec.id])}>
              {t('Marcar como completado')}
            </button>
          </div>
        )}
        {isDone(rec) && (
          <div className="ml-follow is-done" role="note">
            <span>✓ {t('Seguimiento completado el {date}.', { date: day(rec.follow!.done!) })}</span>
          </div>
        )}
        {rec.folder === 'junk' && (
          <div className="ml-remote" role="note">
            {t('Este mensaje está en Correo no deseado.')}{' '}
            <button type="button" onClick={() => void ctl.organize.trust([rec.id])}>
              {t('No es correo no deseado')}
            </button>
          </div>
        )}
        {parsed.warnings.length > 0 && <div className="ml-remote">{parsed.warnings.join(' ')}</div>}
      </header>
      {finding && (
        <FindPanel
          host={findHost}
          onClose={() => {
            findHost.clear();
            setFinding(false);
          }}
        />
      )}
      <iframe ref={frame} title={t('Contenido del mensaje')} className="ml-frame" sandbox="allow-same-origin" srcDoc={html} onLoad={onLoad} />
    </article>
  );
}
