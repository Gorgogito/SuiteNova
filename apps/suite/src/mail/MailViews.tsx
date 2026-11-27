import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { childrenOf, encodeBase64, folderRows, formatAddress, parseMessage, rawOf, unreadCount, type MailRecord, type ParsedMessage } from '@suitenova/mail-core';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { saveBytes } from '../fileio';
import type { MailCtl } from './ctl';
import { FindPanel } from '../find';
import { frameFindHost } from './find-hosts';

// ---------------------------------------------------------------------------------------------- folders
export function FolderTree({ ctl }: { ctl: MailCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [where, setWhere] = useState('local');
  const [inside, setInside] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = folderRows(ctl.data);
  const hidden = new Set<string>();
  for (const { folder } of rows) if (collapsed.has(folder.id) || (folder.parent && hidden.has(folder.parent))) hidden.add(folder.id);
  const current = ctl.data.folders.find((f) => f.id === ctl.folder);

  const close = () => {
    setAdding(false);
    setName('');
    setErr(null);
    setInside(false);
  };
  const commit = async () => {
    if (!name.trim()) return close();
    setBusy(true);
    try {
      const parent = inside ? ctl.folder : null;
      if (where === 'local') ctl.addFolder(name, parent);
      else await ctl.addServerFolder(where, name, parent);
      close();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <nav className="ml-folders nv-panel" aria-label={t('Carpetas')}>
      <ul role="tree" aria-label={t('Carpetas')}>
        {rows
          .filter(({ folder }) => !(folder.parent && hidden.has(folder.parent)))
          .map(({ folder: f, depth }) => {
            const n = unreadCount(ctl.data, f.id);
            const kids = childrenOf(ctl.data, f.id).length > 0;
            const open = !collapsed.has(f.id);
            return (
              <li key={f.id} role="treeitem" aria-level={depth + 1} aria-expanded={kids ? open : undefined} aria-selected={f.id === ctl.folder}>
                <div className="ml-folder-row" style={{ paddingInlineStart: depth * 14 }}>
                  {kids ? (
                    <button type="button" className="ml-folder-caret" aria-label={open ? `${t('Contraer')} ${t(f.name)}` : `${t('Expandir')} ${t(f.name)}`} onClick={() => toggle(f.id)}>
                      {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
                    </button>
                  ) : (
                    <span className="ml-folder-caret" aria-hidden="true" />
                  )}
                  <button type="button" className={`ml-folder-name${f.id === ctl.folder ? ' is-current' : ''}${f.id.startsWith('c:') ? ' is-container' : ''}`} aria-current={f.id === ctl.folder} onClick={() => ctl.setFolder(f.id)} title={f.remote ? f.remote.path : undefined}>
                    <span>{t(f.name)}</span>
                    {n > 0 && f.id !== 'trash' && f.id !== 'sent' && f.id !== 'drafts' ? <b aria-label={t('{n} sin leer', { n })}>{n}</b> : null}
                  </button>
                </div>
              </li>
            );
          })}
      </ul>
      {adding ? (
        <div className="ml-newfolder">
          <input
            autoFocus
            aria-label={t('Nombre de la carpeta')}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') void commit();
              else if (e.key === 'Escape') close();
            }}
          />
          {current && (
            <label>
              <input type="checkbox" checked={inside} onChange={(e) => setInside(e.target.checked)} /> {t('Dentro de «{name}»', { name: t(current.name) })}
            </label>
          )}
          {ctl.accounts.length > 0 && (
            <select className="nv-select" aria-label={t('Dónde crearla')} value={where} onChange={(e) => setWhere(e.target.value)}>
              <option value="local">{t('Solo en este equipo')}</option>
              {ctl.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {t('En el servidor: {name}', { name: a.name })}
                </option>
              ))}
            </select>
          )}
          <div className="ml-newfolder__buttons">
            <button type="button" disabled={busy || !name.trim()} onClick={() => void commit()}>
              {busy ? t('Creando…') : t('Crear')}
            </button>
            <button type="button" disabled={busy} onClick={close}>
              {t('Cancelar')}
            </button>
          </div>
          {err && <span role="alert">{t(err)}</span>}
        </div>
      ) : (
        <button
          type="button"
          className="ml-addfolder"
          onClick={() => {
            // por defecto la carpeta se crea donde está la que se está viendo: en su cuenta si es del servidor, o solo aquí
            setWhere(current?.remote?.account && ctl.accounts.some((a) => a.id === current.remote!.account) ? current.remote.account : 'local');
            setInside(false);
            setAdding(true);
          }}
        >
          + {t('Carpeta nueva')}
        </button>
      )}
    </nav>
  );
}

// ---------------------------------------------------------------------------------------------- list
const ROW = 66;

const when = (d: number): string => {
  const x = new Date(d);
  const now = new Date();
  return x.toDateString() === now.toDateString() ? x.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : x.getFullYear() === now.getFullYear() ? x.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : x.toLocaleDateString();
};

export function MessageList({ ctl }: { ctl: MailCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const list = ctl.list();
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [h, setH] = useState(500);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  const first = Math.max(0, Math.floor(top / ROW) - 5);
  const last = Math.min(list.length - 1, Math.ceil((top + h) / ROW) + 5);
  const folderName = ctl.data.folders.find((f) => f.id === ctl.folder)?.name ?? '';
  const outgoing = ctl.folder === 'sent' || ctl.folder === 'drafts';
  const move = (d: number) => {
    const i = list.findIndex((m) => m.id === ctl.selectedId);
    const n = list[Math.max(0, Math.min(list.length - 1, i + d))];
    if (n) {
      ctl.select(n.id);
      const el = ref.current;
      const idx = list.indexOf(n);
      if (el) {
        if (idx * ROW < el.scrollTop) el.scrollTop = idx * ROW;
        else if ((idx + 1) * ROW > el.scrollTop + el.clientHeight) el.scrollTop = (idx + 1) * ROW - el.clientHeight;
      }
    }
  };
  return (
    <div className="ml-list">
      <div className="ml-list__head">
        <strong>{ctl.query.trim() ? t('Resultados de la búsqueda') : t(folderName)}</strong>
        <span>{t('{n} mensajes', { n: list.length })}</span>
      </div>
      <div
        ref={ref}
        className="ml-list__scroll"
        role="listbox"
        aria-label={t('Mensajes')}
        tabIndex={0}
        onScroll={(e) => setTop(e.currentTarget.scrollTop)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') move(1);
          else if (e.key === 'ArrowUp') move(-1);
          else if (e.key === 'Delete' && ctl.selectedId) ctl.delete(ctl.selectedId);
          else if (e.key === 'Enter' && ctl.selected && ctl.folder === 'drafts') ctl.editDraft(ctl.selected.id);
          else return;
          e.preventDefault();
        }}
      >
        <div style={{ height: list.length * ROW, position: 'relative' }}>
          {list.length === 0 && <div className="ml-empty">{ctl.query.trim() ? t('Sin resultados') : t('Esta carpeta está vacía.')}</div>}
          {list.slice(first, last + 1).map((m, i) => (
            <div
              key={m.id}
              role="option"
              aria-selected={m.id === ctl.selectedId}
              className={`ml-item${m.id === ctl.selectedId ? ' is-selected' : ''}${m.read ? '' : ' is-unread'}`}
              style={{ top: (first + i) * ROW, height: ROW }}
              onClick={() => ctl.select(m.id)}
              onDoubleClick={() => ctl.folder === 'drafts' && ctl.editDraft(m.id)}
            >
              <div className="ml-item__top">
                <span className="ml-item__from">{outgoing ? `${t('Para')}: ${m.to || t('(sin destinatario)')}` : m.from || m.fromEmail || t('(sin remitente)')}</span>
                <span className="ml-item__date">{when(m.date)}</span>
              </div>
              <div className="ml-item__subject">
                {m.subject || t('(sin asunto)')}
                {m.hasAttachments && <span title={t('Con adjuntos')} aria-label={t('Con adjuntos')}> 📎</span>}
                <button type="button" className={`ml-flag${m.flagged ? ' is-on' : ''}`} aria-label={m.flagged ? t('Quitar bandera') : t('Marcar con bandera')} aria-pressed={m.flagged} onClick={(e) => { e.stopPropagation(); ctl.toggleFlag(m.id); }}>
                  {m.flagged ? '⚑' : '⚐'}
                </button>
              </div>
              <div className="ml-item__preview">{m.preview}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

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
    const doc = new DOMParser().parseFromString(m.html, 'text/html');
    doc.querySelectorAll('script,iframe,frame,object,embed,meta,link,base,form,applet,portal,noscript').forEach((n) => n.remove());
    doc.querySelectorAll('*').forEach((el) => {
      for (const a of [...el.attributes]) {
        if (/^on/i.test(a.name)) el.removeAttribute(a.name);
        else if (['href', 'src', 'action', 'formaction', 'xlink:href'].includes(a.name.toLowerCase()) && /^\s*(javascript|vbscript):/i.test(a.value)) el.removeAttribute(a.name);
      }
      if (el.tagName === 'A') {
        el.setAttribute('rel', 'noopener noreferrer');
        el.removeAttribute('target');
      }
    });
    doc.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') ?? '';
      if (src.startsWith('cid:')) {
        const part = m.inlineParts.find((p) => p.cid === src.slice(4));
        if (part) img.setAttribute('src', `data:${part.contentType};base64,${encodeBase64(part.data)}`);
      }
    });
    hasRemote = REMOTE.test(doc.documentElement.outerHTML);
    body = doc.body.innerHTML;
    const styles = [...doc.head.querySelectorAll('style')].map((s) => s.outerHTML).join('');
    body = styles + body;
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

export function ReadingPane({ rec, onLink }: { rec: MailRecord; onLink: (href: string) => void }) {
  const parsed = useMemo(() => parseMessage(rawOf(rec)), [rec.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [allow, setAllow] = useState<string | null>(null);
  const allowRemote = allow === rec.id;
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
