import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import { useImageSources } from '../images/useSources';
import { t } from '@suitenova/core-ui';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { childrenOf, encodeBase64, folderRows, formatAddress, parseMessage, rawOf, unreadCount, type MailRecord, type ParsedMessage } from '@suitenova/mail-core';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { saveBytes } from '../fileio';
import type { ComposeState, MailCtl } from './ctl';
import { FindPanel } from '../find';
import { frameFindHost, textareaFindHost } from './find-hosts';
import { ProofTextarea } from '../spell';
import { FormatPictureDialog } from '../images/FormatPictureDialog';
import { RemoveBackgroundDialog } from '../images/RemoveBackgroundDialog';
import { AspectItems } from '../images/galleries';
import { PicPopover } from '../images/PicPopover';
import { imageSize } from '../calc/imagePick';
import { mailPictureHost, tokenOf, uniqueName, type ComposePicture } from './pictures';
import { PictureTextForm } from './dlg-ocr';
import { GridPicker } from '../tables';
import { TableEditor } from './TableEditor';
import { newTable, tableToken, uniqueTableName, type ComposeTable } from './tables';
import { dataUriOf } from './ocr-images';
import { packResult } from '@suitenova/ocr-core';

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
    <nav className="ml-folders" aria-label={t('Carpetas')}>
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

// ---------------------------------------------------------------------------------------------- compose
/** The content of the compose dialog (shown inside a StickyDialog). */
export function ComposeBody({ ctl, c, onExport }: { ctl: MailCtl; c: ComposeState; onExport: (raw: string, name: string) => void }) {
  const [s, setS] = useState<ComposeState>(c);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [from, setFrom] = useState(ctl.accounts[0]?.id ?? '');
  const fileRef = useRef<HTMLInputElement>(null);
  const picRef = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const composeRef = useRef<HTMLDivElement>(null);
  const [finding, setFinding] = useState<{ replace: boolean } | null>(null);
  const findHost = useMemo(() => textareaFindHost(() => composeRef.current?.querySelector<HTMLTextAreaElement>('textarea[aria-label]') ?? null), []);
  const [selPic, setSelPic] = useState<string | null>(null);
  const [picTool, setPicTool] = useState<null | 'corrections' | 'color' | 'artistic' | 'removeBg'>(null);
  const [textPic, setTextPic] = useState(false);
  // the picture tools read the picture as it is now (a dialog stays open while the message changes)
  const sRef = useRef(s);
  sRef.current = s;
  const pics = s.pictures ?? [];
  const pic = pics.find((p) => p.id === selPic);
  const picHost = useMemo(() => mailPictureHost(() => sRef.current.pictures?.find((p) => p.id === selPic), (np) => setS((x) => ({ ...x, pictures: (x.pictures ?? []).map((p) => (p.id === np.id ? np : p)) }))), [selPic]);
  const setPic = (patch: Partial<ComposePicture>) => pic && setS((x) => ({ ...x, pictures: (x.pictures ?? []).map((p) => (p.id === pic.id ? { ...p, ...patch } : p)) }));
  const [selTable, setSelTable] = useState<string | null>(null);
  const tbls = s.tables ?? [];
  const tbl = tbls.find((x) => x.id === selTable);
  const addTable = (rows: number, cols: number) => {
    const name = uniqueTableName(sRef.current.tables?.map((x) => x.name) ?? []);
    const tb = newTable(name, rows, cols);
    setS((x) => {
      const at = Math.min(caret.current ?? x.body.length, x.body.length);
      const body = `${x.body.slice(0, at)}${at > 0 && x.body[at - 1] !== '\n' ? '\n' : ''}${tableToken(name)}\n${x.body.slice(at)}`;
      return { ...x, body, tables: [...(x.tables ?? []), tb] };
    });
    setSelTable(tb.id);
  };
  const removeTable = (tb: ComposeTable) => {
    setS((x) => ({ ...x, body: x.body.split(`\n${tableToken(tb.name)}`).join('').split(tableToken(tb.name)).join(''), tables: (x.tables ?? []).filter((q) => q.id !== tb.id) }));
    if (selTable === tb.id) setSelTable(null);
  };
  const sources = useImageSources((f) => addPicture(f));
  const addPicture = async (f: File) => {
    try {
      const data = new Uint8Array(await f.arrayBuffer());
      const mime = f.type || 'image/png';
      const size = await imageSize(data, mime);
      const name = uniqueName(f.name || 'imagen.png', sRef.current.pictures?.map((p) => p.name) ?? []);
      const p: ComposePicture = { id: `nova-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}@suitenova`, name, orig: { mime, data }, sent: { mime, data }, width: Math.min(size.width, 480), alt: '' };
      setS((x) => {
        const at = Math.min(caret.current ?? x.body.length, x.body.length);
        const tok = tokenOf(name);
        const body = `${x.body.slice(0, at)}${at > 0 && x.body[at - 1] !== '\n' ? '\n' : ''}${tok}\n${x.body.slice(at)}`;
        return { ...x, body, pictures: [...(x.pictures ?? []), p] };
      });
      setSelPic(p.id);
      setMsg(null);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const removePicture = (p: ComposePicture) => {
    setS((x) => ({ ...x, body: x.body.split(`\n${tokenOf(p.name)}`).join('').split(tokenOf(p.name)).join(''), pictures: (x.pictures ?? []).filter((q) => q.id !== p.id) }));
    if (selPic === p.id) setSelPic(null);
  };
  const canSend = ctl.canConnect && ctl.accounts.length > 0;
  const set = (p: Partial<ComposeState>) => {
    setS((x) => ({ ...x, ...p }));
    setMsg(null);
    setErr(null);
  };
  const send = async () => {
    setSending(true);
    setErr(null);
    try {
      await ctl.send(s, from);
    } catch (e) {
      // el mensaje sigue aquí: no se pierde nada
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };
  const noOwner = !ctl.data.owner.email;
  const close = () => ctl.closeCompose();

  const mailto = () => {
    const q = new URLSearchParams();
    if (s.cc.trim()) q.set('cc', s.cc);
    if (s.bcc.trim()) q.set('bcc', s.bcc);
    if (s.subject) q.set('subject', s.subject);
    if (s.body) q.set('body', s.body);
    const a = document.createElement('a');
    a.href = `mailto:${encodeURIComponent(s.to.replace(/\s/g, '')).replace(/%2C/g, ',').replace(/%40/g, '@')}?${q.toString().replace(/\+/g, '%20')}`;
    a.click();
    setMsg(t('Se abrió tu aplicación de correo con el mensaje.'));
  };

  return (
    <>
          <DialogTitle>{t('Mensaje nuevo')}</DialogTitle>
          <DialogContent>
            <div
              className="ml-compose"
              ref={composeRef}
              onKeyDown={(e) => {
                if (e.key === 'F4') (e.preventDefault(), setFinding({ replace: false }));
                else if ((e.ctrlKey || e.metaKey) && (e.key === 'h' || e.key === 'H')) (e.preventDefault(), setFinding({ replace: true }));
                else if (e.key === 'F3' && finding) (e.preventDefault(), findHost.step(e.shiftKey ? -1 : 1));
              }}
            >
              {canSend && ctl.accounts.length > 1 && (
                <label>
                  <span>{t('Desde')}</span>
                  <select className="nv-select" aria-label={t('Desde')} value={from} onChange={(e) => setFrom(e.target.value)}>
                    {ctl.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} &lt;{a.email}&gt;
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {canSend && ctl.accounts.length === 1 && <div className="ml-from">{t('Desde')}: {ctl.accounts[0]!.name} &lt;{ctl.accounts[0]!.email}&gt;</div>}
              {!canSend && noOwner && <div className="ml-remote" role="status">{t('Aún no has indicado tu dirección (Inicio → Mi dirección); el remitente quedará como yo@nova.local.')}</div>}
              {(['to', 'cc', 'bcc'] as const).map((k) => (
                <label key={k}>
                  <span>{k === 'to' ? t('Para') : k === 'cc' ? 'Cc' : 'Cco'}</span>
                  <input aria-label={k === 'to' ? t('Para') : k === 'cc' ? 'Cc' : 'Cco'} value={s[k]} onChange={(e) => set({ [k]: e.target.value })} autoFocus={k === 'to'} />
                </label>
              ))}
              <label>
                <span>{t('Asunto')}</span>
                <input aria-label={t('Asunto')} value={s.subject} onChange={(e) => set({ subject: e.target.value })} />
              </label>
              {finding && <FindPanel host={findHost} replace={finding.replace} escape={false} key={String(finding.replace)} onClose={() => (findHost.clear(), setFinding(null))} />}
              <ProofTextarea aria-label={t('Cuerpo del mensaje')} value={s.body} onChange={(e) => set({ body: e.target.value })} onSelect={(e) => (caret.current = (e.target as HTMLTextAreaElement).selectionStart)} onBlur={(e) => (caret.current = e.target.selectionStart)} rows={12} />
              <div className="ml-compose__att">
                <button type="button" className="ml-btn" onClick={() => fileRef.current?.click()}>
                  📎 {t('Adjuntar archivo')}
                </button>
                <button type="button" className="ml-btn" onClick={() => picRef.current?.click()}>
                  🖼 {t('Insertar imagen')}
                </button>
                <button type="button" className="ml-btn" onClick={() => void sources.fromClipboard()}>
                  {t('Imagen del portapapeles')}
                </button>
                <button type="button" className="ml-btn" onClick={() => void sources.fromScreen()}>
                  {t('Recorte de pantalla…')}
                </button>
                <button type="button" className="ml-btn" onClick={() => sources.openIcons()}>
                  {t('Iconos…')}
                </button>
                <GridPicker size="small" host={{ insert: addTable }} />
                {sources.dialog}
                <input
                  ref={picRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
                  hidden
                  aria-hidden="true"
                  tabIndex={-1}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) await addPicture(f);
                  }}
                />
                {s.attachments.map((a, i) => (
                  <span key={i} className="ml-chip">
                    {a.filename} ({Math.max(1, Math.round(a.data.length / 1024))} KB)
                    <button type="button" aria-label={t('Quitar {name}', { name: a.filename })} onClick={() => set({ attachments: s.attachments.filter((_, j) => j !== i) })}>
                      ×
                    </button>
                  </span>
                ))}
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  hidden
                  aria-hidden="true"
                  tabIndex={-1}
                  onChange={async (e) => {
                    const files = [...(e.target.files ?? [])];
                    e.target.value = '';
                    const add = await Promise.all(files.map(async (f) => ({ filename: f.name, contentType: f.type || 'application/octet-stream', data: new Uint8Array(await f.arrayBuffer()) })));
                    set({ attachments: [...s.attachments, ...add] });
                  }}
                />
              </div>
              {tbls.length > 0 && (
                <div className="ml-pics" role="group" aria-label={t('Tablas del mensaje')}>
                  <div className="ml-compose__att">
                    {tbls.map((x) => (
                      <span key={x.id} className={`ml-chip${x.id === selTable ? ' is-on' : ''}`}>
                        <button type="button" aria-pressed={x.id === selTable} onClick={() => setSelTable(x.id === selTable ? null : x.id)}>
                          ▦ {x.name}
                        </button>
                        <button type="button" aria-label={t('Quitar {name}', { name: x.name })} onClick={() => removeTable(x)}>
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  {tbl && <TableEditor table={tbl} onChange={(nt) => setS((x) => ({ ...x, tables: (x.tables ?? []).map((q) => (q.id === nt.id ? nt : q)) }))} />}
                </div>
              )}
              {pics.length > 0 && (
                <div className="ml-pics" role="group" aria-label={t('Imágenes del mensaje')}>
                  <div className="ml-compose__att">
                    {pics.map((p) => (
                      <span key={p.id} className={`ml-chip${p.id === selPic ? ' is-on' : ''}`}>
                        <button type="button" aria-pressed={p.id === selPic} onClick={() => setSelPic(p.id === selPic ? null : p.id)}>
                          🖼 {p.name}
                        </button>
                        <button type="button" aria-label={t('Quitar {name}', { name: p.name })} onClick={() => removePicture(p)}>
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  {pic && (
                    <div className="ml-pics__tools">
                      <label>
                        <span>{t('Texto alternativo')}</span>
                        <input aria-label={t('Texto alternativo de la imagen')} value={pic.alt} onChange={(e) => setPic({ alt: e.target.value })} />
                      </label>
                      <label>
                        <span>{t('Ancho (px)')}</span>
                        <input aria-label={t('Ancho de la imagen (px)')} type="number" min={16} max={2000} value={Math.round(pic.width)} onChange={(e) => setPic({ width: Math.max(16, Number(e.target.value) || 16) })} />
                      </label>
                      <div className="ml-pics__btns">
                        <button type="button" className="ml-btn" onClick={() => setTextPic(true)}>{t('Texto de la imagen…')}</button>
                        <button type="button" className="ml-btn" onClick={() => setPicTool('removeBg')}>{t('Quitar fondo…')}</button>
                        <button type="button" className="ml-btn" onClick={() => setPicTool('corrections')}>{t('Correcciones…')}</button>
                        <button type="button" className="ml-btn" onClick={() => setPicTool('color')}>{t('Color…')}</button>
                        <button type="button" className="ml-btn" onClick={() => setPicTool('artistic')}>{t('Efectos artísticos…')}</button>
                        <PicPopover label="Relación de aspecto" icon="crop">{(close) => <AspectItems host={picHost} close={close} />}</PicPopover>
                        <button type="button" className="ml-btn" disabled={!pic.edits && !pic.crop} onClick={() => setPic({ edits: undefined, crop: undefined, sent: pic.orig })}>{t('Restablecer imagen')}</button>
                      </div>
                      <p className="ml-pics__note">{t('Se envía la imagen con los cambios hechos; el original se conserva mientras escribes el mensaje.')}</p>
                    </div>
                  )}
                </div>
              )}
              {textPic && pic && (
                <Dialog open modalType="modal" onOpenChange={(_e, d) => !d.open && setTextPic(false)}>
                  <DialogSurface style={{ maxWidth: 640, width: '92vw' }}>
                    <DialogBody>
                      <PictureTextForm
                        src={dataUriOf(pic.orig)}
                        reading={pic.ocr}
                        lang={ctl.imageOcr.lang}
                        onLang={(l) => (ctl.imageOcr.lang = l)}
                        onReading={(r) => setPic({ ocr: packResult({ ...r, text: r.text.trim() }) })}
                        onClose={() => setTextPic(false)}
                      />
                    </DialogBody>
                  </DialogSurface>
                </Dialog>
              )}
              {picTool === 'removeBg' && <RemoveBackgroundDialog host={picHost} onClose={() => setPicTool(null)} />}
              {picTool && picTool !== 'removeBg' && <FormatPictureDialog host={picHost} tab={picTool} onClose={() => setPicTool(null)} />}
              {msg && (
                <div className="ml-ok" role="status">
                  {msg}
                </div>
              )}
              {err && (
                <div className="ml-acc__err" role="alert">
                  {t('No se pudo enviar: {error}', { error: t(err) })}
                </div>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button onClick={close}>{t('Cerrar')}</Button>
            <Button
              onClick={() => {
                ctl.saveDraft(s);
                setMsg(t('Borrador guardado en la carpeta Borradores.'));
              }}
            >
              {t('Guardar borrador')}
            </Button>
            <Button
              onClick={() => {
                const { raw } = ctl.buildRaw(s);
                onExport(raw, (s.subject || 'mensaje').replace(/[\\/:*?"<>|]+/g, '_'));
              }}
            >
              {t('Exportar .eml')}
            </Button>
            <Button appearance={canSend ? 'secondary' : 'primary'} disabled={!s.to.trim()} onClick={mailto} title={s.attachments.length ? t('Los adjuntos no viajan con mailto: exporta el .eml') : undefined}>
              {t('Abrir en mi aplicación de correo')}
            </Button>
            {canSend && (
              <Button appearance="primary" disabled={sending || !(s.to.trim() || s.cc.trim() || s.bcc.trim())} onClick={() => void send()}>
                {sending ? t('Enviando…') : t('Enviar')}
              </Button>
            )}
          </DialogActions>
    </>
  );
}
