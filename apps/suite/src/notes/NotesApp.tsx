import { Button } from '@fluentui/react-components';
import { AppFrame, CommandRegistry, clampZoom, coreCommands, t, useLocale, type BackstageEntry } from '@suitenova/core-ui';
import { displayTitle, isLocked, newPage, newTextContainer, pageToMarkdown, parseNotebook, tagCss, type Container } from '@suitenova/notes-core';
import { DEFAULT_DOC_DEFAULTS, defaultStyles, docFromText, flattenSections, readDocx, styleCss, writerSchema } from '@suitenova/writer-core';
import { DOMParser as PMDOMParser } from 'prosemirror-model';
import { isInTable } from 'prosemirror-tables';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { zoomCommands } from '../common';
import { pickAndRead, readPath, saveBytes } from '../fileio';
import { addRecent } from '../recents';
import type { ModuleInfo } from '../modules';
import { backstageEntries, fileCommands } from '../options';
import { closeThisWindow, isTauri, openModuleWindow } from '../platform';
import { Canvas, LockedPanel } from './Canvas';
import { notesCommands, type NotesDialog, type NotesUI } from './commands';
import { NotesCtl } from './ctl';
import { EmailDialog, EquationDialog, ImageDialog, LinkDialog, Modal, PageStyleDialog, ProtectDialog, ShareDialog, TableDialog, TagsDialog, TemplatesDialog, TrashDialog, VersionsDialog } from './Dialogs';
import { pageToDocx, pageToEml, pageToHtml } from './export';
import './icons';
import './messages';
import { recognizeImage } from './ocr';
import { blobToBase64, imageSize, mediaDuration, startRecording, type Recording } from './recorder';
import { notesTabs } from './ribbonDef';
import './notes.css';

const NB_FILTERS = [{ name: 'Libreta de Nova Notes', extensions: ['novanotes'] }];
const AUTOSAVE_MS = 1500;
const SHARE_POLL_MS = 30_000;
const MAX_MEDIA_BYTES = 40 * 1024 * 1024;
const baseName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Página';
const OCR_LANG_KEY = 'nova.notes.ocrLang';
const STYLE_CSS = styleCss(defaultStyles(), { ...DEFAULT_DOC_DEFAULTS });

const SHORTCUTS: [string, string][] = [
  ['Ctrl+N / O / S', 'Nuevo / Abrir / Guardar'],
  ['Ctrl+Z / Y', 'Deshacer / Rehacer'],
  ['Ctrl+B / I / U', 'Negrita / Cursiva / Subrayado'],
  ['Ctrl+1 / 2 / 3', 'Etiquetas: Para hacer / Importante / Pregunta'],
  ['Ctrl+E', 'Buscar en todas las páginas'],
  ['Ctrl+Alt+N', 'Página nueva'],
  ['Ctrl+T', 'Sección nueva'],
  ['Ctrl+K', 'Hipervínculo'],
  ['Alt+Mayús+D / T', 'Insertar fecha / hora'],
  ['Clic en la página', 'Escribir en ese punto (cuadro de texto nuevo)'],
  ['Flechas (cuadro seleccionado)', 'Mover el cuadro (Mayús: más lejos)'],
  ['Supr', 'Eliminar el cuadro o la tinta seleccionados'],
  ['Alt', 'Atajos de la cinta (KeyTips)'],
];

function SectionTab({ ctl, id }: { ctl: NotesCtl; id: string }) {
  const s = ctl.nb.sections.find((x) => x.id === id)!;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.name);
  const active = id === ctl.sectionId;
  const commit = () => {
    ctl.renameSection(id, name);
    setEditing(false);
  };
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      className={`nn-sec${active ? ' is-active' : ''}`}
      style={{ ['--sec' as string]: s.color }}
      onClick={() => ctl.goTo(id)}
      onDoubleClick={() => {
        if (s.vault) return;
        setName(s.name);
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'F2' && !s.vault) {
          setName(s.name);
          setEditing(true);
        }
      }}
    >
      {s.protect && <span aria-label={s.vault ? t('Sección bloqueada') : t('Sección con contraseña')}>{s.vault ? '🔒' : '🔓'}</span>}
      {editing ? (
        <input
          autoFocus
          aria-label={t('Nombre de la sección')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span>{s.name}</span>
      )}
      {active && !editing && !s.vault && (
        <input type="color" className="nn-sec__color" value={s.color} title={t('Color de la sección')} aria-label={t('Color de la sección')} onChange={(e) => ctl.setSectionColor(id, e.target.value)} onClick={(e) => e.stopPropagation()} />
      )}
    </div>
  );
}

function GroupTab({ ctl, id }: { ctl: NotesCtl; id: string }) {
  const g = ctl.nb.groups.find((x) => x.id === id)!;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(g.name);
  const commit = () => {
    ctl.renameGroup(id, name);
    setEditing(false);
  };
  return (
    <div role="tab" aria-selected={false} tabIndex={0} className="nn-sec nn-group" style={{ ['--sec' as string]: g.color }} onClick={() => ctl.setGroup(id)} onDoubleClick={() => (setName(g.name), setEditing(true))} onKeyDown={(e) => e.key === 'Enter' && ctl.setGroup(id)}>
      <span aria-hidden="true">📁</span>
      {editing ? (
        <input
          autoFocus
          aria-label={t('Nombre del grupo')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span>{g.name}</span>
      )}
    </div>
  );
}

export function NotesApp({ module }: { module: ModuleInfo }) {
  const registry = useMemo(() => new CommandRegistry(), []);
  const ctl = useMemo(() => new NotesCtl(), []);
  const [zoom, setZoom] = useState(100);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [dialog, setDialog] = useState<{ kind: NotesDialog; arg?: unknown } | null>(null);
  const [saveState, setSaveState] = useState('');
  const [recording, setRecording] = useState<Recording | null>(null);
  const [clock, setClock] = useState(0);
  const recRef = useRef<Recording | null>(null);
  recRef.current = recording;
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const lastDisk = useRef('');
  useLocale();
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);

  // ------------------------------------------------------------------ guardar y libretas compartidas

  const readDisk = useCallback(async (path: string) => {
    const f = await readPath(path);
    return new TextDecoder('utf-8').decode(f.data);
  }, []);

  const saveNow = useCallback(
    async (saveAs: boolean, silent = false) => {
      try {
        // una libreta compartida se combina con lo que haya en el archivo antes de escribirlo
        if (ctl.nb.shared && ctl.filePath && isTauri() && !saveAs) {
          try {
            const text = await readDisk(ctl.filePath);
            if (text !== lastDisk.current) ctl.mergeFrom(parseNotebook(text));
          } catch {
            /* el archivo todavía no existe o no se puede leer: se guarda la copia local */
          }
        }
        const text = await ctl.serialize();
        const data = new TextEncoder().encode(text);
        const base = (ctl.fileName ?? ctl.nb.title).replace(/\.[^.]+$/, '');
        const keep = !saveAs && ctl.filePath?.toLowerCase().endsWith('.novanotes') ? ctl.filePath : null;
        const saved = await saveBytes(`${baseName(base)}.novanotes`, data, NB_FILTERS, keep);
        if (saved) {
          lastDisk.current = text;
          ctl.markSaved(saved.name, saved.path);
          if (!silent) addRecent({ path: saved.path, name: saved.name, app: 'notes' });
          setSaveState(t('Guardado'));
        }
      } catch (e) {
        if (!silent) window.alert(t('No se pudo guardar: {error}', { error: (e as Error).message }));
        else setSaveState(t('No se pudo guardar automáticamente'));
      }
    },
    [ctl, readDisk],
  );

  // escritorio: guardar solo poco después de cada cambio cuando la libreta ya tiene archivo
  useEffect(() => {
    if (!isTauri() || !ctl.filePath || !ctl.dirty) return;
    const id = setTimeout(() => void saveNow(false, true), AUTOSAVE_MS);
    return () => clearTimeout(id);
  });

  // libreta compartida: mirar cada medio minuto si otro equipo cambió el archivo
  useEffect(() => {
    if (!ctl.nb.shared || !ctl.filePath || !isTauri()) return;
    const id = setInterval(async () => {
      try {
        const text = await readDisk(ctl.filePath!);
        if (text === lastDisk.current) return;
        const r = ctl.mergeFrom(parseNotebook(text));
        lastDisk.current = text;
        const n = r.added + r.updated + r.conflicts;
        if (n) setSaveState(t('Se combinaron {n} cambios de otro equipo', { n }));
        await saveNow(false, true);
      } catch {
        /* se reintenta en el siguiente turno */
      }
    }, SHARE_POLL_MS);
    return () => clearInterval(id);
  }, [ctl, ctl.nb.shared, ctl.filePath, readDisk, saveNow]);

  const loadFile = useCallback(
    async (file: { name: string; path: string | null; data: Uint8Array }) => {
      try {
        const text = new TextDecoder('utf-8').decode(file.data);
        ctl.load(parseNotebook(text), file.name, file.path);
        lastDisk.current = text;
        addRecent({ path: file.path, name: file.name, app: 'notes' });
      } catch (e) {
        window.alert(t('No se pudo abrir "{name}": {error}', { name: file.name, error: (e as Error).message }));
      }
    },
    [ctl],
  );

  // ------------------------------------------------------------------ archivos de imagen, audio y vídeo

  const addFiles = useCallback(
    async (files: File[], at?: { x: number; y: number }) => {
      let offset = 0;
      for (const f of files) {
        try {
          const kind = f.type.startsWith('image/') ? 'image' : f.type.startsWith('audio/') ? 'audio' : f.type.startsWith('video/') ? 'video' : null;
          if (!kind) {
            ctl.say(t('«{name}» no es una imagen, un audio ni un vídeo.', { name: f.name }));
            continue;
          }
          if (f.size > MAX_MEDIA_BYTES) {
            ctl.say(t('«{name}» pesa demasiado ({mb} MB); el límite es {max} MB porque todo se guarda dentro del archivo de la libreta.', { name: f.name, mb: Math.round(f.size / 1048576), max: MAX_MEDIA_BYTES / 1048576 }));
            continue;
          }
          const data = await blobToBase64(f);
          const asset = ctl.addAsset({ mime: f.type, data, name: f.name, size: f.size });
          const where = at ? { x: at.x + offset, y: at.y + offset } : undefined;
          offset += 24;
          if (kind === 'image') {
            const { w, h } = await imageSize(ctl.dataUrl(asset.id));
            ctl.addImage(asset, w, h, where);
          } else ctl.addMedia(asset, kind, f.name.replace(/\.[^.]+$/, ''), await mediaDuration(ctl.assetUrl(asset.id), kind));
        } catch (e) {
          ctl.say(t('No se pudo añadir «{name}»: {error}', { name: f.name, error: (e as Error).message }));
        }
      }
    },
    [ctl],
  );

  useEffect(() => ctl.on('files', (files: File[], at?: { x: number; y: number }) => void addFiles(files, at)), [ctl, addFiles]);

  // ------------------------------------------------------------------ grabación

  const finishRecording = useCallback(
    async (rec: Recording) => {
      setRecording(null);
      try {
        const { blob, seconds } = await rec.stop();
        if (blob.size > MAX_MEDIA_BYTES) {
          ctl.say(t('La grabación pesa demasiado ({mb} MB) y no se añadió.', { mb: Math.round(blob.size / 1048576) }));
          return;
        }
        if (!blob.size) {
          ctl.say(t('La grabación está vacía.'));
          return;
        }
        const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
        const stamp = new Date().toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
        const name = `${rec.kind === 'audio' ? t('Audio') : t('Vídeo')} ${stamp}`;
        const asset = ctl.addAsset({ mime: blob.type, data: await blobToBase64(blob), name: `${name.replace(/[\\/:*?"<>|]+/g, '-')}.${ext}`, size: blob.size });
        ctl.addMedia(asset, rec.kind, name, seconds);
      } catch (e) {
        ctl.say((e as Error).message);
      }
    },
    [ctl],
  );

  const toggleRecording = useCallback(
    (kind: 'audio' | 'video') => {
      const cur = recRef.current;
      if (cur) {
        if (cur.kind === kind) void finishRecording(cur);
        return;
      }
      startRecording(kind).then(setRecording, (e: Error) => window.alert(e.message));
    },
    [finishRecording],
  );

  useEffect(() => {
    if (!recording) return;
    setClock(0);
    const id = setInterval(() => setClock(Math.round((Date.now() - recording.startedAt) / 1000)), 500);
    if (previewRef.current && recording.kind === 'video') previewRef.current.srcObject = recording.stream;
    return () => clearInterval(id);
  }, [recording]);
  useEffect(
    () => () => {
      recRef.current?.cancel();
    },
    [],
  );

  // ------------------------------------------------------------------ OCR

  const [ocrLang, setOcrLangState] = useState(() => {
    try {
      return localStorage.getItem(OCR_LANG_KEY) || 'spa+eng';
    } catch {
      return 'spa+eng';
    }
  });
  const ocrLangRef = useRef(ocrLang);
  ocrLangRef.current = ocrLang;
  const runOcr = useCallback(() => void ctl.runOcr(recognizeImage, ocrLangRef.current), [ctl]);
  // las imágenes nuevas se reconocen solas, en segundo plano
  useEffect(() => {
    if (ctl.ocr.running || ctl.ocrPending === 0 || ctl.locked) return;
    const id = setTimeout(runOcr, 1500);
    return () => clearTimeout(id);
  });

  // ------------------------------------------------------------------ interfaz de órdenes

  const openDialog = useCallback(
    (kind: NotesDialog, arg?: unknown) => {
      // las tablas, vínculos y ecuaciones van dentro de un cuadro de texto: si no hay ninguno activo se crea uno
      if ((kind === 'table' || kind === 'equation' || kind === 'link') && !ctl.view) {
        ctl.addTextBoxFree();
        setTimeout(() => setDialog({ kind, arg }), 80);
        return;
      }
      setDialog({ kind, arg });
    },
    [ctl],
  );

  const ui: NotesUI = useMemo(
    () => ({
      ctl,
      openDialog,
      getZoom: () => zoomRef.current,
      setZoom: (z) => setZoom(clampZoom(z)),
      newWindow: () => void openModuleWindow('notes', module.name),
      open: async () => {
        if (ctl.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Abrir otro archivo y descartarlos?'))) return;
        const f = await pickAndRead(NB_FILTERS).catch((e) => {
          window.alert(String(e));
          return null;
        });
        if (f) await loadFile(f);
      },
      save: (saveAs) => saveNow(saveAs),
      importFile: async () => {
        const f = await pickAndRead([{ name: 'Documentos', extensions: ['docx', 'txt', 'md', 'html', 'htm'] }]).catch(() => null);
        if (!f) return;
        try {
          const lower = f.name.toLowerCase();
          const title = f.name.replace(/\.[^.]+$/, '');
          let body;
          let warnings: string[] = [];
          if (lower.endsWith('.docx')) {
            const r = await readDocx(f.data);
            body = flattenSections(r.doc.body);
            warnings = r.warnings;
          } else if (lower.endsWith('.html') || lower.endsWith('.htm')) {
            const parsed = new window.DOMParser().parseFromString(new TextDecoder().decode(f.data), 'text/html');
            parsed.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((n) => n.remove());
            body = PMDOMParser.fromSchema(writerSchema).parse(parsed.body);
          } else body = docFromText(new TextDecoder().decode(f.data));
          const p = newPage(title);
          p.containers = [newTextContainer(48, 24, 720, body.toJSON())];
          ctl.addPageWith(p);
          if (warnings.length) window.alert(t('La página se importó, pero:') + '\n\n' + [...new Set(warnings)].slice(0, 10).join('\n'));
        } catch (e) {
          window.alert(t('No se pudo abrir "{name}": {error}', { name: f.name, error: (e as Error).message }));
        }
      },
      exportPage: async (kind) => {
        const page = ctl.page;
        if (isLocked(page) || isLocked(ctl.section)) return;
        const name = baseName(displayTitle(page));
        if (kind === 'md') await saveBytes(`${name}.md`, new TextEncoder().encode(pageToMarkdown(page)), [{ name: 'Markdown', extensions: ['md'] }]);
        else if (kind === 'html') await saveBytes(`${name}.html`, new TextEncoder().encode(pageToHtml(ctl.nb, page)), [{ name: 'Página web', extensions: ['html'] }]);
        else {
          const { data, warnings } = await pageToDocx(ctl.nb, page);
          await saveBytes(`${name}.docx`, data, [{ name: 'Documento de Word', extensions: ['docx'] }]);
          if (warnings.length) window.alert(t('Se guardó, pero:') + '\n\n' + [...new Set(warnings)].join('\n'));
        }
      },
      insertImage: () => fileRef.current?.click(),
      insertMediaFile: () => mediaRef.current?.click(),
      toggleRecording,
      recording: () => recRef.current?.kind ?? null,
      runOcr,
      ocrLang: () => ocrLangRef.current,
      setOcrLang: (l) => {
        setOcrLangState(l);
        try {
          localStorage.setItem(OCR_LANG_KEY, l);
        } catch {
          /* sin almacenamiento */
        }
      },
      mergeFile: async () => {
        const f = await pickAndRead(NB_FILTERS).catch(() => null);
        if (!f) return;
        try {
          const r = ctl.mergeFrom(parseNotebook(new TextDecoder('utf-8').decode(f.data)));
          window.alert(t('Combinado: {a} páginas nuevas, {u} actualizadas, {c} en conflicto (se conservaron las dos versiones), {r} eliminadas en el otro lado.', { a: r.added, u: r.updated, c: r.conflicts, r: r.removed }));
        } catch (e) {
          window.alert(t('No se pudo abrir "{name}": {error}', { name: f.name, error: (e as Error).message }));
        }
      },
      focusSearch: () => {
        searchRef.current?.focus();
        searchRef.current?.select();
      },
      close: () => {
        if (ctl.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Cerrar y descartarlos?'))) return;
        void closeThisWindow();
      },
    }),
    [ctl, loadFile, saveNow, module.name, openDialog, toggleRecording, runOcr],
  );

  useEffect(() => {
    const offs = [
      registry.registerAll(coreCommands),
      registry.registerAll(zoomCommands(() => zoomRef.current, (z) => setZoom(clampZoom(z)), clampZoom).map((c) => ({ ...c, shortcut: c.id === 'zoom.reset' ? undefined : c.shortcut }))),
      registry.registerAll(notesCommands(ui)),
    ];
    fileCommands(registry);
    const unsub = ctl.subscribe(() => registry.invalidate());
    return () => {
      offs.forEach((o) => o());
      unsub();
    };
  }, [registry, ui, ctl]);
  useEffect(() => registry.invalidate(), [registry, zoom, recording, ocrLang]);

  useEffect(() => {
    const path = new URLSearchParams(location.search).get('open');
    if (!path || !isTauri()) return;
    readPath(path).then(loadFile, (e) => window.alert(t('No se pudo abrir "{name}": {error}', { name: path, error: String(e) })));
  }, [loadFile]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __novaNotes: unknown }).__novaNotes = {
      ctl,
      load: (json: string, name: string) => loadFile({ name, path: null, data: new TextEncoder().encode(json) }),
    };
  }, [ctl, loadFile]);

  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (ctl.dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', before);
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
        unlisten = await getCurrentWindow().onCloseRequested((e) => {
          if (ctl.dirty && !ctl.filePath && !window.confirm(t('Hay cambios sin guardar. ¿Cerrar y descartarlos?'))) e.preventDefault();
        });
      });
    }
    return () => {
      window.removeEventListener('beforeunload', before);
      unlisten?.();
    };
  }, [ctl]);

  const inTable = !!ctl.view && isInTable(ctl.view.state);
  const tabs = useMemo(() => notesTabs(ui), [ui, inTable]); // eslint-disable-line react-hooks/exhaustive-deps
  const backstage: BackstageEntry[] = useMemo(() => {
    const pages = backstageEntries(module.name).filter((e) => e.kind === 'page');
    return [
      { kind: 'command', command: 'notes.new' },
      { kind: 'command', command: 'notes.open' },
      { kind: 'separator' },
      { kind: 'command', command: 'notes.save' },
      { kind: 'command', command: 'notes.saveAs' },
      { kind: 'command', command: 'notes.import' },
      { kind: 'command', command: 'notes.export.md' },
      { kind: 'command', command: 'notes.export.html' },
      { kind: 'command', command: 'notes.export.docx' },
      { kind: 'command', command: 'notes.email' },
      { kind: 'separator' },
      ...pages,
      { kind: 'command', command: 'notes.about' },
      { kind: 'command', command: 'file.close' },
    ] as BackstageEntry[];
  }, [module.name]);

  const page = ctl.page;
  const closeDialog = () => setDialog(null);
  const dlg = dialog?.kind;
  const visibleSections = ctl.nb.sections.filter((s) => (s.group ?? null) === ctl.groupId);
  const visibleGroups = ctl.nb.groups.filter((g) => (g.parent ?? null) === ctl.groupId);
  const parentGroup = ctl.groupId ? (ctl.nb.groups.find((g) => g.id === ctl.groupId)?.parent ?? null) : null;
  const rows = ctl.pageRows();
  const lockedWhat: 'page' | 'section' | null = isLocked(ctl.section) ? 'section' : isLocked(page) ? 'page' : null;

  return (
    <AppFrame
      appId={module.id}
      appName={module.name}
      registry={registry}
      tabs={tabs}
      qat={['notes.save', 'notes.undo', 'notes.redo']}
      docTitle={ctl.docTitle}
      backstage={backstage}
      zoom={{ value: zoom, onChange: (v) => setZoom(clampZoom(v)), min: 50, max: 300 }}
      statusLeft={
        <>
          <span>{ctl.section.pages.length === 1 ? t('1 página en la sección') : t('{n} páginas en la sección', { n: ctl.section.pages.length })}</span>
          {ctl.nb.shared && <span>{t('Libreta compartida')}</span>}
          {ctl.ocr.running && (
            <span aria-live="polite">
              {t('Reconociendo texto de imágenes {a}/{b}…', { a: ctl.ocr.done, b: ctl.ocr.total })}
            </span>
          )}
          {ctl.message && (
            <span aria-live="polite" role="status">
              {t(ctl.message)}
            </span>
          )}
          {saveState && <span aria-live="polite">{saveState}</span>}
        </>
      }
      contentFill
    >
      <div className="nn-app">
        <style>{STYLE_CSS + tagCss(ctl.nb.tagDefs)}</style>
        <div className="nn-top">
          <div className="nn-secs" role="tablist" aria-label={t('Secciones')}>
            {ctl.groupId && (
              <button type="button" className="nn-addsec" aria-label={t('Subir un nivel')} title={t('Subir un nivel')} onClick={() => ctl.setGroup(parentGroup)}>
                ◂ {ctl.nb.groups.find((g) => g.id === ctl.groupId)?.name}
              </button>
            )}
            {visibleGroups.map((g) => (
              <GroupTab key={g.id} ctl={ctl} id={g.id} />
            ))}
            {visibleSections.map((s) => (
              <SectionTab key={s.id} ctl={ctl} id={s.id} />
            ))}
            <button type="button" className="nn-addsec" aria-label={t('Sección nueva')} title={t('Sección nueva')} onClick={() => ctl.addSection()}>
              +
            </button>
          </div>
          <div className="nn-search">
            <input
              ref={searchRef}
              type="search"
              aria-label={t('Buscar en todas las páginas')}
              placeholder={t('Buscar en todas las páginas (Ctrl+E)')}
              value={ctl.query}
              onChange={(e) => ctl.search(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  ctl.search('');
                  ctl.focusEditor();
                } else if (e.key === 'Enter' && ctl.results[0]) {
                  ctl.goTo(ctl.results[0].sectionId, ctl.results[0].pageId);
                  ctl.closeSearch();
                }
              }}
            />
            {ctl.showResults && (
              <ul className="nn-results" role="listbox" aria-label={t('Resultados')}>
                {ctl.results.length === 0 && <li className="nn-results__none">{t('Sin resultados')}</li>}
                {ctl.results.map((r, i) => (
                  <li key={`${r.pageId}:${r.where}:${i}`} role="option" aria-selected={false}>
                    <button
                      type="button"
                      onClick={() => {
                        ctl.goTo(r.sectionId, r.pageId);
                        ctl.closeSearch();
                      }}
                    >
                      <strong>{r.title}</strong>
                      <span>
                        {r.sectionName} · {r.where === 'image' ? t('texto dentro de una imagen') : r.where === 'tag' ? t('etiqueta') : r.where === 'media' ? t('grabación') : r.where === 'title' ? t('título') : t('texto')}
                      </span>
                      <em>{r.snippet}</em>
                    </button>
                  </li>
                ))}
                {ctl.ocrPending > 0 && <li className="nn-results__none">{t('Hay {n} imágenes que aún no se han leído; sus resultados pueden faltar.', { n: ctl.ocrPending })}</li>}
              </ul>
            )}
          </div>
        </div>
        {recording && (
          <div className="nn-recbar" role="status" aria-live="polite">
            <span className="nn-recdot" aria-hidden="true" />
            <strong>{recording.kind === 'audio' ? t('Grabando audio') : t('Grabando vídeo')}</strong>
            <span>
              {String(Math.floor(clock / 60)).padStart(2, '0')}:{String(clock % 60).padStart(2, '0')}
            </span>
            {recording.kind === 'video' && <video ref={previewRef} className="nn-recprev" muted autoPlay playsInline aria-label={t('Vista previa de la cámara')} />}
            <Button appearance="primary" onClick={() => void finishRecording(recording)}>
              {t('Detener y añadir')}
            </Button>
            <Button
              onClick={() => {
                recording.cancel();
                setRecording(null);
              }}
            >
              {t('Descartar')}
            </Button>
          </div>
        )}
        <div className="nn-body">
          <div className="nn-pagearea" style={{ borderTop: `3px solid ${ctl.section.color}` }}>
            {lockedWhat ? (
              <LockedPanel ctl={ctl} what={lockedWhat} />
            ) : (
              <>
                <div className="nn-pagehead">
                  <input
                    className="nn-title"
                    aria-label={t('Título de la página')}
                    placeholder={t('Título de la página')}
                    value={page.title}
                    onChange={(e) => ctl.setTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const first = page.containers.find((c) => c.kind === 'text');
                        if (first) ctl.focusView(first.id);
                        else ctl.addTextBoxFree();
                      }
                    }}
                  />
                  <div className="nn-date">{new Date(page.created).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}</div>
                </div>
                <div className="nn-scroll">
                  <Canvas ctl={ctl} zoom={zoom} openDialog={(k, arg) => openDialog(k as NotesDialog, arg)} />
                </div>
              </>
            )}
          </div>
          <nav className="nn-pages" aria-label={t('Páginas')}>
            <button type="button" className="nn-newpage" onClick={() => ctl.addPage()}>
              + {t('Página nueva')}
            </button>
            {rows.map(({ page: p, depth, hasChildren }) => (
              <div key={p.id} className="nn-pagerow" style={{ paddingLeft: depth * 14 }}>
                {hasChildren ? (
                  <button type="button" className="nn-twisty" aria-label={ctl.collapsed.has(p.id) ? t('Expandir subpáginas') : t('Contraer subpáginas')} aria-expanded={!ctl.collapsed.has(p.id)} onClick={() => ctl.toggleCollapsed(p.id)}>
                    {ctl.collapsed.has(p.id) ? '▸' : '▾'}
                  </button>
                ) : (
                  <span className="nn-twisty" aria-hidden="true" />
                )}
                <button type="button" className={`nn-pageitem${p.id === ctl.pageId ? ' is-current' : ''}${depth ? ' is-sub' : ''}`} aria-current={p.id === ctl.pageId} onClick={() => ctl.goToPage(p.id)}>
                  <strong>
                    {p.protect ? (p.vault ? '🔒 ' : '🔓 ') : ''}
                    {t(displayTitle(p))}
                  </strong>
                  <span>{new Date(p.modified).toLocaleDateString()}</span>
                </button>
              </div>
            ))}
          </nav>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/bmp,image/webp"
          multiple
          hidden
          aria-hidden="true"
          tabIndex={-1}
          data-testid="nn-image-input"
          onChange={(e) => {
            const fs = [...(e.target.files ?? [])];
            e.target.value = '';
            if (fs.length) void addFiles(fs);
          }}
        />
        <input
          ref={mediaRef}
          type="file"
          accept="audio/*,video/*"
          hidden
          aria-hidden="true"
          tabIndex={-1}
          data-testid="nn-media-input"
          onChange={(e) => {
            const fs = [...(e.target.files ?? [])];
            e.target.value = '';
            if (fs.length) void addFiles(fs);
          }}
        />
        {dlg === 'link' && <LinkDialog ctl={ctl} onClose={closeDialog} />}
        {dlg === 'table' && <TableDialog ctl={ctl} onClose={closeDialog} />}
        {dlg === 'tags' && <TagsDialog ctl={ctl} onClose={closeDialog} />}
        {dlg === 'templates' && <TemplatesDialog ctl={ctl} onClose={closeDialog} />}
        {dlg === 'style' && <PageStyleDialog ctl={ctl} onClose={closeDialog} />}
        {dlg === 'versions' && <VersionsDialog ctl={ctl} onClose={closeDialog} />}
        {dlg === 'trash' && <TrashDialog ctl={ctl} onClose={closeDialog} />}
        {dlg === 'protectPage' && <ProtectDialog ctl={ctl} what="page" onClose={closeDialog} />}
        {dlg === 'protectSection' && <ProtectDialog ctl={ctl} what="section" onClose={closeDialog} />}
        {dlg === 'share' && (
          <ShareDialog
            ctl={ctl}
            onClose={closeDialog}
            onMerge={() => {
              closeDialog();
              void ui.mergeFile();
            }}
          />
        )}
        {dlg === 'equation' && <EquationDialog ctl={ctl} pos={(dialog?.arg as { pos?: number } | undefined)?.pos} onClose={closeDialog} />}
        {dlg === 'image' && typeof dialog?.arg === 'string' && (
          <ImageDialog
            ctl={ctl}
            id={dialog.arg}
            onClose={closeDialog}
            onOcr={() => {
              closeDialog();
              runOcr();
            }}
          />
        )}
        {dlg === 'email' && (
          <EmailDialog
            defaultSubject={displayTitle(page)}
            onClose={closeDialog}
            onSend={async (to, subject) => {
              try {
                const eml = await pageToEml(ctl.nb, page, { to, subject });
                const saved = await saveBytes(`${baseName(subject || displayTitle(page))}.eml`, new TextEncoder().encode(eml), [{ name: 'Mensaje de correo', extensions: ['eml'] }]);
                if (saved) ctl.say('Se guardó el mensaje (.eml). Ábrelo con tu programa de correo para revisarlo y enviarlo.');
              } catch (e) {
                window.alert((e as Error).message);
              }
            }}
          />
        )}
        {dlg === 'about' && (
          <Modal title={t('Acerca de Nova Notes')} onClose={closeDialog} actions={<Button appearance="primary" onClick={closeDialog}>{t('Cerrar')}</Button>}>
            <p>Nova Notes 0.0.8</p>
            <p>{t('Libretas libres (MPL-2.0) de SuiteNova. Guarda en .novanotes; consulta docs/LIMITACIONES.md para saber qué se conserva al importar y exportar.')}</p>
            <p className="nn-note">{t('El reconocimiento de texto usa Tesseract (Apache-2.0) y sus datos de idioma, incluidos en el programa: no se envía nada a Internet.')}</p>
          </Modal>
        )}
        {dlg === 'shortcuts' && (
          <Modal title={t('Atajos de teclado')} onClose={closeDialog} actions={<Button appearance="primary" onClick={closeDialog}>{t('Cerrar')}</Button>}>
            <table className="nw-shortcuts">
              <tbody>
                {SHORTCUTS.map(([k, d]) => (
                  <tr key={k}>
                    <th scope="row">
                      <kbd>{k}</kbd>
                    </th>
                    <td>{t(d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Modal>
        )}
      </div>
    </AppFrame>
  );
}

void (null as Container | null);
