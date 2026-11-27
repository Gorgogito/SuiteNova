import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Menu, MenuDivider, MenuItem, MenuList, MenuPopover, MenuTrigger } from '@fluentui/react-components';
import { useImageSources } from '../images/useSources';
import { t } from '@suitenova/core-ui';
import { DEFAULT_OPTIONS } from '@suitenova/table-core';
import { TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { ComposeState, MailCtl } from './ctl';
import { FindPanel } from '../find';
import { FormatPictureDialog } from '../images/FormatPictureDialog';
import { RemoveBackgroundDialog } from '../images/RemoveBackgroundDialog';
import { AspectItems } from '../images/galleries';
import { PicPopover } from '../images/PicPopover';
import { mailPictureHost, type ComposePicture } from './pictures';
import { PictureTextForm } from './dlg-ocr';
import { GridPicker } from '../tables';
import { createTable } from '../writer/editing';
import { dataUriOf } from './ocr-images';
import { packResult } from '@suitenova/ocr-core';
import { RecipientInput } from './RecipientInput';
import { docOf, messageContent } from './rich/content';
import { FormatBar, TableBar } from './rich/FormatBar';
import { richFindHost } from './rich/find';
import { textOf } from './rich/html';
import { SignaturesDialog, TemplatesDialog } from './rich/Libraries';
import { loadSignatures, withSignature, type Signature, type Template } from './rich/library';
import { docFromText } from './rich/parse';
import { insertPictureFile, readPicture, removePicture, selectedPicture, writePicture } from './rich/picture';
import { quotePreview } from './rich/quote';
import { RichEditor } from './rich/RichEditor';
import { LaterDialog } from './dlg-send';
import { expandGroups, isRetryable, splitRecipients } from '@suitenova/mail-core';

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
  const [later, setLater] = useState(false);
  // the account of the message; the first one while there is none (the accounts may arrive after the message is opened)
  const from = s.from && ctl.accounts.some((a) => a.id === s.from) ? s.from : (ctl.accounts[0]?.id ?? '');
  const fileRef = useRef<HTMLInputElement>(null);
  const picRef = useRef<HTMLInputElement>(null);
  const composeRef = useRef<HTMLDivElement>(null);
  // the editor, and a count that redraws the buttons when its cursor moves
  const [view, setView] = useState<EditorView | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  viewRef.current = view;
  const [, setTick] = useState(0);
  const initial = useRef<PMNode | null>(null);
  initial.current ??= docOf(c);
  const [finding, setFinding] = useState<{ replace: boolean } | null>(null);
  const findHost = useMemo(() => richFindHost(() => viewRef.current), []);
  const [selPic, setSelPic] = useState<string | null>(null);
  const selRef = useRef(selPic);
  selRef.current = selPic;
  const [picTool, setPicTool] = useState<null | 'corrections' | 'color' | 'artistic' | 'removeBg'>(null);
  const [textPic, setTextPic] = useState(false);
  const [library, setLibrary] = useState<null | 'signatures' | 'templates'>(null);
  const [signatures, setSignatures] = useState(() => loadSignatures().list);
  const sRef = useRef(s);
  sRef.current = s;
  // the picture tools read the picture as it is now (a dialog stays open while the message changes)
  const pic = readPicture(view, selPic);
  const picHost = useMemo(() => mailPictureHost(() => readPicture(viewRef.current, selRef.current), (np) => writePicture(viewRef.current, np)), []);
  const setPic = (patch: Partial<ComposePicture>) => pic && writePicture(view, { ...pic, ...patch });
  const quotePage = useMemo(() => (s.quote ? quotePreview(s.quote) : ''), [s.quote]);

  const onDoc = (doc: PMNode) => {
    setS((x) => ({ ...x, doc: doc.toJSON(), body: textOf(doc) }));
    setMsg(null);
    setErr(null);
  };
  const onSelect = () => {
    setTick((n) => n + 1);
    const v = viewRef.current;
    if (v) setSelPic(selectedPicture(v));
  };
  /** Another content for the whole editor (a signature, the original turned into text), as one step that can be undone. */
  const replaceDoc = (next: PMNode) => {
    const v = viewRef.current;
    if (!v) return;
    const tr = v.state.tr.replaceWith(0, v.state.doc.content.size, next.content);
    v.dispatch(tr.setSelection(TextSelection.atStart(tr.doc)));
  };
  const addPicture = async (f: File, at?: number) => {
    const v = viewRef.current;
    if (!v) return;
    try {
      await insertPictureFile(v, f, 480, at);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const sources = useImageSources((f) => addPicture(f));
  const addTable = (rows: number, cols: number) => {
    const v = viewRef.current;
    if (!v) return;
    const plain = createTable(rows, cols, Math.max(200, v.dom.clientWidth - 24));
    const table = plain.type.create({ ...plain.attrs, tstyle: 'grid-1', topts: { ...DEFAULT_OPTIONS } }, plain.content);
    // in the place of an empty line, or after the block the cursor is in; the cursor goes into the first cell
    const tr = v.state.tr;
    const { $from } = tr.selection;
    const depth = Math.min(1, $from.depth);
    const empty = depth === 1 && $from.parent.type.name === 'paragraph' && !$from.parent.content.size && $from.depth === 1;
    const at = empty ? $from.before(1) : depth ? $from.after(1) : $from.pos;
    if (empty) tr.replaceWith(at, $from.after(1), table);
    else tr.insert(at, table);
    v.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1))).scrollIntoView());
    v.focus();
  };
  const editOriginal = () => {
    const v = viewRef.current;
    const q = sRef.current.quote;
    if (!v || !q) return;
    const text = docFromText(q.text.replace(/^\n+/, '\n').replace(/\n+$/, ''));
    v.dispatch(v.state.tr.insert(v.state.doc.content.size, text.content).scrollIntoView());
    setS((x) => ({ ...x, quote: undefined }));
    v.focus();
  };
  const putSignature = (sig: Signature | null) => viewRef.current && replaceDoc(withSignature(viewRef.current.state.doc, sig));
  const putTemplate = (template: Template, doc: PMNode) => {
    const v = viewRef.current;
    if (!v) return;
    setLibrary(null);
    // on a line of its own where the cursor is
    const tr = v.state.tr;
    const { $from } = tr.selection;
    const empty = $from.parent.type.name === 'paragraph' && !$from.parent.content.size && $from.depth === 1;
    if (empty) tr.replaceWith($from.before(1), $from.after(1), doc.content);
    else tr.insert($from.depth >= 1 ? $from.after(1) : $from.pos, doc.content);
    v.dispatch(tr.scrollIntoView());
    if (template.subject && !sRef.current.subject.trim()) setS((x) => ({ ...x, subject: template.subject }));
  };

  const canSend = ctl.canConnect && ctl.accounts.length > 0;
  const addFiles = async (files: File[], inBody: boolean, at?: number) => {
    for (const f of files) {
      if (inBody && /^image\/(png|jpe?g|gif|webp|bmp)$/.test(f.type)) await addPicture(f, at);
      else {
        const added = { filename: f.name || 'adjunto', contentType: f.type || 'application/octet-stream', data: new Uint8Array(await f.arrayBuffer()) };
        setS((x) => ({ ...x, attachments: [...x.attachments, added] }));
        setMsg(null);
        setErr(null);
      }
    }
  };
  // pictures travel inside the document, written in base64
  const pictureBytes = () => [...JSON.stringify(s.doc ?? null).matchAll(/"src":"data:image[^"]*"/g)].reduce((n, m) => n + m[0].length * 0.75, 0);
  const tooBig = s.attachments.reduce((n, a) => n + a.data.length, 0) + (s.quote?.inline.reduce((n, a) => n + a.data.length, 0) ?? 0) + pictureBytes() > MAX_SEND_BYTES;
  const set = (p: Partial<ComposeState>) => {
    setS((x) => ({ ...x, ...p }));
    setMsg(null);
    setErr(null);
  };
  const send = async (how: { at?: number; keep?: string } = {}) => {
    setSending(true);
    setErr(null);
    try {
      await ctl.send({ ...s, from }, from, how);
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
  // an answer starts in the text, above the signature and the original; anything else, in «Para»
  const answering = useRef(!!c.quote && !!c.to);
  const started = useRef(false);
  useEffect(() => {
    if (!view || started.current) return;
    started.current = true;
    if (!answering.current) return;
    view.dispatch(view.state.tr.setSelection(TextSelection.atStart(view.state.doc)));
    view.focus();
  }, [view]);

  const mailto = () => {
    // a link only carries addresses: the name of a group stands for its people
    const list = (typed: string) => expandGroups(splitRecipients(typed), ctl.data.contacts).map((a) => a.email).join(',');
    const q = new URLSearchParams();
    if (s.cc.trim()) q.set('cc', list(s.cc));
    if (s.bcc.trim()) q.set('bcc', list(s.bcc));
    if (s.subject) q.set('subject', s.subject);
    const text = messageContent(s).text;
    if (text) q.set('body', text);
    const a = document.createElement('a');
    a.href = `mailto:${encodeURIComponent(list(s.to).replace(/\s/g, '')).replace(/%2C/g, ',').replace(/%40/g, '@')}?${q.toString().replace(/\+/g, '%20')}`;
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

  /** Pasted and dropped files are taken before the editor sees them. */
  const content = (
            <div
              className="ml-compose"
              ref={composeRef}
              onKeyDown={keys}
              onPasteCapture={(e) => {
                // a copied file or picture is added; a copy that also has text is pasted as text
                const files = [...e.clipboardData.files];
                if (!files.length || e.clipboardData.types.includes('text/plain') || !e.currentTarget.contains(e.target as Node)) return;
                e.preventDefault();
                e.stopPropagation();
                void addFiles(files, true);
              }}
            >
              {canSend && ctl.accounts.length > 1 && (
                <label>
                  <span>{t('Desde')}</span>
                  <select
                    className="nv-select"
                    aria-label={t('Desde')}
                    value={from}
                    onChange={(e) => {
                      // the signature goes with the account
                      const now = { ...sRef.current, from };
                      const next = ctl.withAccount(now, e.target.value);
                      set({ from: e.target.value });
                      if (next.doc !== now.doc) replaceDoc(docOf(next));
                    }}
                  >
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
              <FormatBar view={view}>
                <span className="nv-sep" aria-hidden="true" />
                {(
                  [
                    ['high', '❗', 'Importancia alta'],
                    ['low', '↓', 'Importancia baja'],
                  ] as const
                ).map(([level, mark, label]) => (
                  <button key={level} type="button" className="nv-btn nv-btn--small ml-tool" aria-label={t(label)} title={t(label)} aria-pressed={s.importance === level} onClick={() => set({ importance: s.importance === level ? undefined : level })}>
                    <span aria-hidden="true">{mark}</span>
                  </button>
                ))}
                <Menu onOpenChange={(_e, d) => d.open && setSignatures(loadSignatures().list)}>
                  <MenuTrigger disableButtonEnhancement>
                    <button type="button" className="ml-btn">
                      {t('Firma')}
                    </button>
                  </MenuTrigger>
                  <MenuPopover>
                    <MenuList>
                      {signatures.map((sig) => (
                        <MenuItem key={sig.id} onClick={() => putSignature(sig)}>
                          {sig.name}
                        </MenuItem>
                      ))}
                      {signatures.length > 0 && <MenuItem onClick={() => putSignature(null)}>{t('(Sin firma)')}</MenuItem>}
                      <MenuDivider />
                      <MenuItem onClick={() => setLibrary('signatures')}>{t('Firmas…')}</MenuItem>
                    </MenuList>
                  </MenuPopover>
                </Menu>
                <button type="button" className="ml-btn" onClick={() => setLibrary('templates')}>
                  {t('Plantillas…')}
                </button>
              </FormatBar>
              <TableBar view={view} insert={addTable} />
              <RichEditor initial={initial.current!} label={t('Cuerpo del mensaje')} onChange={onDoc} onSelect={onSelect} onView={setView} onEscape={() => !finding && close()} />
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
              {pic && (
                <div className="ml-pics" role="group" aria-label={t('Imagen seleccionada')}>
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
                      <button type="button" className="ml-btn" onClick={() => removePicture(view, pic.id)}>{t('Quitar imagen')}</button>
                    </div>
                    <p className="ml-pics__note">{t('Se envía la imagen con los cambios hechos; el original se conserva en el borrador.')}</p>
                  </div>
                </div>
              )}
              {s.quote && (
                <section className="ml-quote" aria-label={t('Mensaje original')}>
                  <header>
                    <strong>{t('Mensaje original')}</strong>
                    <span>{t('Va debajo de lo que escribes, como llegó.')}</span>
                    <button type="button" className="ml-btn" onClick={editOriginal}>
                      {t('Editar el original')}
                    </button>
                    <button type="button" className="ml-btn" onClick={() => set({ quote: undefined })}>
                      {t('Quitar el original')}
                    </button>
                  </header>
                  <iframe title={t('Vista del mensaje original')} sandbox="" srcDoc={quotePage} />
                </section>
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
                  {isRetryable(err) && (
                    <button type="button" className="ml-btn" disabled={sending} onClick={() => void send({ keep: err })}>
                      {t('Dejar en la Bandeja de salida')}
                    </button>
                  )}
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
            {canSend && (
              <Button disabled={sending || !(s.to.trim() || s.cc.trim() || s.bcc.trim())} onClick={() => setLater(true)}>
                {t('Enviar más tarde…')}
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

  /** Where in the text a drop falls; undefined outside the editor. */
  const dropPlace = (e: DragEvent): { inBody: boolean; at?: number } => {
    const v = viewRef.current;
    if (!v || !v.dom.parentElement?.contains(e.target as Node)) return { inBody: false };
    return { inBody: true, at: v.posAtCoords({ left: e.clientX, top: e.clientY })?.pos };
  };
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
    onDropCapture: (e: DragEvent) => {
      if (!fileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      dragDepth.current = 0;
      setDropping(false);
      // a picture dropped on the text goes into it; anything else, and anywhere else, is attached
      const place = dropPlace(e);
      void addFiles([...e.dataTransfer.files], place.inBody, place.at);
    },
  };
  const hint = dropping && <div className="ml-drop" aria-hidden="true">{t('Suelta los archivos para adjuntarlos (una imagen sobre el texto se inserta en él)')}</div>;

  const libraries = (
    <>
      {later && (
        <LaterDialog
          onClose={() => setLater(false)}
          onPick={(at) => {
            setLater(false);
            void send({ at });
          }}
        />
      )}
      {library === 'signatures' && <SignaturesDialog accounts={ctl.accounts} onClose={() => (setLibrary(null), setSignatures(loadSignatures().list))} />}
      {library === 'templates' && <TemplatesDialog subject={s.subject} doc={() => viewRef.current?.state.doc ?? docOf(s)} onInsert={putTemplate} onClose={() => setLibrary(null)} />}
    </>
  );

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
        {libraries}
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
      {libraries}
    </section>
  );
}
