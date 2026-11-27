import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import { useImageSources } from '../images/useSources';
import { t } from '@suitenova/core-ui';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { ComposeState, MailCtl } from './ctl';
import { FindPanel } from '../find';
import { textareaFindHost } from './find-hosts';
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
import { RecipientInput } from './RecipientInput';

/** The most a message can carry and still be accepted when sending. */
const MAX_SEND_BYTES = 40 * 1024 * 1024;
const fileDrag = (e: DragEvent) => [...e.dataTransfer.types].includes('Files');

/**
 * The message being written: in the reading pane, as Outlook does, or in a large window of its own (`variant`). What is
 * typed is kept by the controller, which saves it as a draft.
 */
export function ComposeBody({ ctl, c, variant, canPop, onExport }: { ctl: MailCtl; c: ComposeState; variant: 'pane' | 'dialog'; canPop: boolean; onExport: (raw: string, name: string) => void }) {
  const [s, setS] = useState<ComposeState>(c);
  const [dropping, setDropping] = useState(false);
  const dragDepth = useRef(0);
  // what is typed goes to the controller at once; it decides when to save it
  useEffect(() => ctl.updateCompose(s), [ctl, s]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // the account of the message; the first one while there is none (the accounts may arrive after the message is opened)
  const from = s.from && ctl.accounts.some((a) => a.id === s.from) ? s.from : (ctl.accounts[0]?.id ?? '');
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
  const addFiles = async (files: File[], inBody: boolean) => {
    for (const f of files) {
      if (inBody && /^image\/(png|jpe?g|gif|webp|bmp)$/.test(f.type)) await addPicture(f);
      else {
        const added = { filename: f.name || 'adjunto', contentType: f.type || 'application/octet-stream', data: new Uint8Array(await f.arrayBuffer()) };
        setS((x) => ({ ...x, attachments: [...x.attachments, added] }));
        setMsg(null);
        setErr(null);
      }
    }
  };
  const tooBig = s.attachments.reduce((n, a) => n + a.data.length, 0) + pics.reduce((n, p) => n + p.sent.data.length, 0) > MAX_SEND_BYTES;
  const set = (p: Partial<ComposeState>) => {
    setS((x) => ({ ...x, ...p }));
    setMsg(null);
    setErr(null);
  };
  const send = async () => {
    setSending(true);
    setErr(null);
    try {
      await ctl.send({ ...s, from }, from);
    } catch (e) {
      // el mensaje sigue aquí: no se pierde nada
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };
  const noOwner = !ctl.data.owner.email;
  const close = () => {
    ctl.updateCompose(sRef.current);
    ctl.requestCloseCompose();
  };
  // an answer starts with the cursor above the quoted text; anything else, in «Para»
  const answering = useRef(!!c.to && !!c.body);
  useEffect(() => {
    if (!answering.current) return;
    const id = requestAnimationFrame(() => {
      const box = composeRef.current?.querySelector<HTMLTextAreaElement>('textarea[aria-label]');
      box?.focus();
      box?.setSelectionRange(0, 0);
      if (box) box.scrollTop = 0;
    });
    return () => cancelAnimationFrame(id);
  }, []);

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

  const keys = (e: React.KeyboardEvent) => {
    // keys of the windows opened over the message belong to them
    if (!e.currentTarget.contains(e.target as Node)) return;
    if (e.key === 'F4') (e.preventDefault(), setFinding({ replace: false }));
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'h' || e.key === 'H')) (e.preventDefault(), setFinding({ replace: true }));
    else if (e.key === 'F3' && finding) (e.preventDefault(), findHost.step(e.shiftKey ? -1 : 1));
    else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canSend && !sending && (s.to.trim() || s.cc.trim() || s.bcc.trim())) (e.preventDefault(), void send());
  };

  const content = (
            <div
              className="ml-compose"
              ref={composeRef}
              onKeyDown={keys}
              onPaste={(e) => {
                // a copied file or picture is added; a copy that also has text is pasted as text
                const files = [...e.clipboardData.files];
                if (!files.length || e.clipboardData.types.includes('text/plain') || !e.currentTarget.contains(e.target as Node)) return;
                e.preventDefault();
                void addFiles(files, true);
              }}
            >
              {canSend && ctl.accounts.length > 1 && (
                <label>
                  <span>{t('Desde')}</span>
                  <select className="nv-select" aria-label={t('Desde')} value={from} onChange={(e) => set({ from: e.target.value })}>
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
                <RecipientInput key={k} label={k === 'to' ? t('Para') : k === 'cc' ? 'Cc' : 'Cco'} name={k === 'to' ? t('Para') : k === 'cc' ? 'Cc' : 'Cco'} value={s[k]} onChange={(v) => set({ [k]: v })} entries={() => ctl.addressEntries()} autoFocus={k === 'to' && !answering.current} />
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
              {tooBig && (
                <div className="ml-remote" role="status">
                  {t('Los adjuntos suman más de 40 MB: el servidor rechazará el mensaje.')}
                </div>
              )}
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
  );

  const actions = (
    <>
            {canSend && (
              <Button appearance="primary" disabled={sending || !(s.to.trim() || s.cc.trim() || s.bcc.trim())} onClick={() => void send()} title="Ctrl+Intro">
                {sending ? t('Enviando…') : t('Enviar')}
              </Button>
            )}
            <Button onClick={close}>{t('Cerrar')}</Button>
            <Button
              onClick={() => {
                ctl.updateCompose(sRef.current);
                ctl.keepDraft();
                setMsg(t('Borrador guardado en la carpeta Borradores.'));
              }}
            >
              {t('Guardar borrador')}
            </Button>
            <Button
              onClick={() => {
                const { raw } = ctl.buildRaw({ ...s, from });
                onExport(raw, (s.subject || 'mensaje').replace(/[\\/:*?"<>|]+/g, '_'));
              }}
            >
              {t('Exportar .eml')}
            </Button>
            <Button appearance={canSend ? 'secondary' : 'primary'} disabled={!s.to.trim()} onClick={mailto} title={s.attachments.length ? t('Los adjuntos no viajan con mailto: exporta el .eml') : undefined}>
              {t('Abrir en mi aplicación de correo')}
            </Button>
    </>
  );

  const drop = {
    onDragEnter: (e: DragEvent) => {
      if (!fileDrag(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDropping(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!fileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e: DragEvent) => {
      if (fileDrag(e) && --dragDepth.current <= 0) setDropping(false);
    },
    onDrop: (e: DragEvent) => {
      if (!fileDrag(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDropping(false);
      // a picture dropped on the text goes into it; anything else, and anywhere else, is attached
      void addFiles([...e.dataTransfer.files], !!(e.target as HTMLElement).closest?.('textarea'));
    },
  };
  const hint = dropping && <div className="ml-drop" aria-hidden="true">{t('Suelta los archivos para adjuntarlos (una imagen sobre el texto se inserta en él)')}</div>;

  const question = ctl.askClose && (
    <Dialog open modalType="alert">
      <DialogSurface className="ml-ask" style={{ maxWidth: 560 }}>
        <DialogBody>
          <DialogTitle>{t('¿Guardar el mensaje?')}</DialogTitle>
          <DialogContent>{t('Si no lo guardas, se pierde lo escrito.')}</DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => (ctl.updateCompose(sRef.current), ctl.closeSaving())}>
              {t('Guardar en Borradores')}
            </Button>
            <Button onClick={() => ctl.discardCompose()}>{t('Descartar')}</Button>
            <Button
              onClick={() => {
                ctl.askClose = false;
                ctl.touch();
              }}
            >
              {t('Seguir escribiendo')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );

  if (variant === 'dialog')
    return (
      <div className="ml-composer-dialog" {...drop}>
        <DialogTitle
          action={
            canPop ? (
              <button type="button" className="ml-btn" onClick={() => ((ctl.composePopped = false), ctl.updateCompose(sRef.current), ctl.touch())}>
                {t('Volver al panel de lectura')}
              </button>
            ) : null
          }
        >
          {t('Mensaje nuevo')}
        </DialogTitle>
        <DialogContent>{content}</DialogContent>
        <DialogActions>{actions}</DialogActions>
        {hint}
        {question}
      </div>
    );

  return (
    <section
      className="ml-composer"
      aria-label={t('Mensaje que escribes')}
      {...drop}
      onKeyDown={(e) => {
        // Escape closes the message, unless something inside it has used the key
        if (e.key !== 'Escape' || e.defaultPrevented || finding || !e.currentTarget.contains(e.target as Node)) return;
        e.preventDefault();
        close();
      }}
    >
      <header className="ml-composer__head">
        <h2>{t('Mensaje nuevo')}</h2>
        <button
          type="button"
          className="ml-btn"
          onClick={() => {
            ctl.updateCompose(sRef.current);
            ctl.composePopped = true;
            ctl.touch();
          }}
        >
          {t('Abrir en grande')}
        </button>
      </header>
      <div className="ml-composer__actions" role="toolbar" aria-label={t('Acciones del mensaje')}>
        {actions}
      </div>
      <div className="ml-composer__body">{content}</div>
      {hint}
      {question}
    </section>
  );
}
