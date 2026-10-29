import { AppFrame, CommandRegistry, clampZoom, coreCommands, t, useLocale, type BackstageEntry } from '@suitenova/core-ui';
import { newMedia, newPicture, readOdp, readPpt, readPptx, writePptx, type Deck } from '@suitenova/slides-core';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { zoomCommands } from '../common';
import { pickAndRead, readPath, saveBytes } from '../fileio';
import { addRecent } from '../recents';
import type { ModuleInfo } from '../modules';
import { backstageEntries, fileCommands } from '../options';
import { closeThisWindow, isTauri, openModuleWindow, openWindowQuery } from '../platform';
import { slidesCommands, type SlidesDialog, type SlidesUI } from './commands';
import { SlidesCtl } from './ctl';
import { Dialogs } from './Dialogs';
import { FormatPane } from './FormatPane';
import { AnimPane } from './animUi';
import { CommentsPane } from './comments';
import { NotesPane } from './NotesPane';
import { slidesTabs } from './ribbonDef';
import { chainFor, newId } from '@suitenova/slides-core';
import { colorContext } from '@suitenova/slides-core';
import type { CanvasCtx } from './render/SlideCanvas';
import { Stage } from './Stage';
import { MasterPanel } from './MasterPanel';
import { Thumbs } from './Thumbs';
import { currentParaProps, currentRunProps } from './textcmds';
import type { TextEnv } from './render/TextView';
import { NotesPageView, OutlineView, ReadingView, SorterView } from './Views';
import { Present, type PresentRequest } from './present/Present';
import { PresenterWindow } from './present/Presenter';
import './icons';
import './messages';
import './slides.css';

const FILTERS = [{ name: 'Presentación de PowerPoint', extensions: ['pptx', 'ppsx', 'potx'] }];
const SAVE_FILTERS = [{ name: 'Presentación de PowerPoint', extensions: ['pptx'] }];
const AUTOSAVE_MS = 2000;
const baseName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Presentación';

const imageSize = (url: string): Promise<{ w: number; h: number }> =>
  new Promise((res) => {
    const i = new Image();
    i.onload = () => res({ w: i.naturalWidth || 400, h: i.naturalHeight || 300 });
    i.onerror = () => res({ w: 400, h: 300 });
    i.src = url;
  });

export function SlidesApp({ module }: { module: ModuleInfo }) {
  const q = new URLSearchParams(location.search);
  if (q.get('role') === 'presenter' && q.get('session')) return <PresenterWindow session={q.get('session')!} />;
  return <SlidesEditor module={module} />;
}

function SlidesEditor({ module }: { module: ModuleInfo }) {
  const registry = useMemo(() => new CommandRegistry(), []);
  const ctl = useMemo(() => new SlidesCtl(), []);
  const [dialog, setDialog] = useState<{ kind: SlidesDialog; arg?: unknown } | null>(null);
  const [saveState, setSaveState] = useState('');
  const [present, setPresent] = useState<PresentRequest | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<{ el: HTMLInputElement | null; kind: 'video' | 'audio' }>({ el: null, kind: 'video' });
  useLocale();
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);

  // the drawing context of the current slide, for the ribbon (theme colours and fonts)
  const canvasCtx = useCallback((): CanvasCtx | null => {
    const slide = ctl.slide;
    const chain = chainFor(ctl.deck, slide);
    const env: TextEnv = { cc: colorContext(chain), assetUrl: (id) => ctl.urls.url(id), deck: ctl.deck, chain, slideNumber: ctl.index + 1, prompts: true };
    return { deck: ctl.deck, chain, env, onSlide: true, media: 'edit' };
  }, [ctl]);

  const saveNow = useCallback(
    async (saveAs: boolean, silent = false) => {
      try {
        ctl.endEdit();
        const { data, warnings } = await writePptx(ctl.realDeck);
        const base = (ctl.fileName ?? ctl.deck.props.title ?? 'Presentación').replace(/\.[^.]+$/, '');
        const keep = !saveAs && ctl.filePath && /\.pptx$/i.test(ctl.filePath) ? ctl.filePath : null;
        const saved = await saveBytes(`${baseName(base)}.pptx`, data, SAVE_FILTERS, keep);
        if (saved) {
          ctl.markSaved(saved.name, saved.path);
          if (!silent) addRecent({ path: saved.path, name: saved.name, app: 'slides' });
          setSaveState(t('Guardado'));
          if (warnings.length && !silent) window.alert(t('Se guardó, pero:') + '\n\n' + warnings.join('\n'));
        }
      } catch (e) {
        if (!silent) window.alert(t('No se pudo guardar: {error}', { error: (e as Error).message }));
        else setSaveState(t('No se pudo guardar automáticamente'));
      }
    },
    [ctl],
  );

  useEffect(() => {
    if (!isTauri() || !ctl.filePath || !ctl.dirty || ctl.editing) return;
    const id = setTimeout(() => void saveNow(false, true), AUTOSAVE_MS);
    return () => clearTimeout(id);
  });

  const loadFile = useCallback(
    async (file: { name: string; path: string | null; data: Uint8Array }) => {
      try {
        let deck: Deck;
        let warnings: string[];
        {
          const ext = /.([^.]+)$/.exec(file.name)?.[1]?.toLowerCase();
          const r = ext === 'odp' ? await readOdp(file.data) : ext === 'ppt' || ext === 'pps' ? readPpt(file.data) : await readPptx(file.data);
          deck = r.deck;
          warnings = r.warnings;
        }
        ctl.load(deck, file.name, /\.(pptx)$/i.test(file.name) ? file.path : null, warnings);
        addRecent({ path: file.path, name: file.name, app: 'slides' });
        if (warnings.length) setDialog({ kind: 'about', arg: { warnings, name: file.name } });
      } catch (e) {
        window.alert(t('No se pudo abrir "{name}": {error}', { name: file.name, error: (e as Error).message }));
      }
    },
    [ctl],
  );

  const addAsset = useCallback(
    (data: Uint8Array, mime: string, name: string): string => {
      const id = newId('a');
      ctl.apply('Insertar archivo', (d) => ({ ...d, assets: { ...d.assets, [id]: { id, mime, data, name } } }));
      return id;
    },
    [ctl],
  );

  const ui: SlidesUI = useMemo(
    () => ({
      ctl,
      openDialog: (kind, arg) => setDialog({ kind, arg }),
      newWindow: () => void openModuleWindow('slides', module.name),
      open: async () => {
        if (ctl.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Abrir otro archivo y descartarlos?'))) return;
        const f = await pickAndRead([...FILTERS, { name: 'OpenDocument (.odp) y PowerPoint 97-2003 (.ppt)', extensions: ['odp', 'ppt', 'pps'] }]).catch((e) => {
          window.alert(String(e));
          return null;
        });
        if (f) await loadFile(f);
      },
      save: (as) => saveNow(as),
      exportAs: async (kind) => {
        if (kind === 'png' || kind === 'video') return setDialog({ kind: 'exportMedia', arg: kind });
        const { exportDeck } = await import('./export/exporters');
        await exportDeck(ctl, kind);
      },
      print: () => void import('./export/exporters').then((m) => m.printDeck(ctl)),
      present: (from, opts) => {
        if (!opts?.presenter) return setPresent({ from, ...opts });
        const session = newId('s');
        void openWindowQuery(`app=slides&role=presenter&session=${session}`, t('Vista de moderador'), `presenter-${session}`).then(() => setPresent({ from, ...opts, session }));
      },
      insertPicture: () => fileRef.current?.click(),
      addAsset,
      pickAsset: () =>
        new Promise<string | null>((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = async () => {
            const f = input.files?.[0];
            if (!f) return resolve(null);
            resolve(addAsset(new Uint8Array(await f.arrayBuffer()), f.type, f.name));
          };
          input.oncancel = () => resolve(null);
          input.click();
        }),
      insertMedia: (kind) => {
        mediaRef.current.kind = kind;
        mediaRef.current.el?.click();
      },
      close: () => {
        if (ctl.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Cerrar y descartarlos?'))) return;
        void closeThisWindow();
      },
      canvasCtx,
      runProps: () => currentRunProps(ctl, canvasCtx()),
      paraProps: () => currentParaProps(ctl, canvasCtx()),
    }),
    [ctl, loadFile, saveNow, module.name, canvasCtx],
  );

  useEffect(() => {
    const offs = [registry.registerAll(coreCommands), registry.registerAll(zoomCommands(() => (ctl.zoom || 100), (z) => ((ctl.zoom = clampZoom(z)), ctl.touch()), clampZoom).map((c) => ({ ...c, shortcut: undefined }))), registry.registerAll(slidesCommands(ui))];
    fileCommands(registry);
    const unsub = ctl.subscribe(() => registry.invalidate());
    return () => {
      offs.forEach((o) => o());
      unsub();
    };
  }, [registry, ui, ctl]);

  // pictures and media
  const onPicture = async (files: File[]) => {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      const bytes = new Uint8Array(await f.arrayBuffer());
      const id = addAsset(bytes, f.type, f.name);
      const url = URL.createObjectURL(f);
      const { w, h } = await imageSize(url);
      URL.revokeObjectURL(url);
      const k = Math.min(1, (ctl.deck.size.w * 0.6) / w, (ctl.deck.size.h * 0.7) / (h * 0.75));
      const pw = w * 0.75 * k;
      const ph = h * 0.75 * k;
      ctl.addElement(newPicture(id, (ctl.deck.size.w - pw) / 2, (ctl.deck.size.h - ph) / 2, pw, ph, f.name.replace(/\.[^.]+$/, '')));
    }
  };
  const onMedia = async (files: File[]) => {
    for (const f of files) {
      const kind = f.type.startsWith('audio/') ? 'audio' : 'video';
      const bytes = new Uint8Array(await f.arrayBuffer());
      const id = addAsset(bytes, f.type || (kind === 'audio' ? 'audio/mpeg' : 'video/mp4'), f.name);
      const w = kind === 'audio' ? 60 : 480;
      const h = kind === 'audio' ? 60 : 270;
      ctl.addElement(newMedia(kind, id, f.type, (ctl.deck.size.w - w) / 2, (ctl.deck.size.h - h) / 2, w, h));
    }
  };
  useEffect(
    () =>
      ctl.on('files', (files: File[]) => {
        void onPicture(files.filter((f) => f.type.startsWith('image/')));
        void onMedia(files.filter((f) => /^(video|audio)\//.test(f.type)));
      }),
    [ctl], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => ctl.on('equation', () => setDialog({ kind: 'equation' })), [ctl]);
  useEffect(() => ctl.on('chart', (id: string) => setDialog({ kind: 'chart', arg: id })), [ctl]);

  // Fluent leaves `aria-hidden` on the page when a menu is unmounted while open (a ribbon group that disappears as the selection
  // changes): give the page back to assistive technology once nothing modal is open.
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;
    let timer: ReturnType<typeof setTimeout>;
    const look = () => {
      if (root.getAttribute('aria-hidden') !== 'true') return;
      if (document.querySelector('[role=dialog],[role=menu],.fui-MenuPopover,.fui-PopoverSurface')) timer = setTimeout(look, 300);
      else root.removeAttribute('aria-hidden');
    };
    const mo = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(look, 250);
    });
    mo.observe(root, { attributes: true, attributeFilter: ['aria-hidden'] });
    return () => {
      mo.disconnect();
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const path = new URLSearchParams(location.search).get('open');
    if (!path || !isTauri()) return;
    readPath(path).then(loadFile, (e) => window.alert(t('No se pudo abrir "{name}": {error}', { name: path, error: String(e) })));
  }, [loadFile]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __novaSlides: unknown }).__novaSlides = {
      ctl,
      load: async (bytes: number[], name = 'prueba.pptx') => {
        await loadFile({ name, path: null, data: new Uint8Array(bytes) });
        return { slides: ctl.deck.slides.length, warnings: ctl.warnings };
      },
      show: (i: number) => ctl.goTo(i),
      write: async () => [...(await writePptx(ctl.realDeck)).data],
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

  const tabs = useMemo(() => slidesTabs(ui), [ui, ctl.selection.join(','), ctl.slide.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const backstage: BackstageEntry[] = useMemo(() => {
    const pages = backstageEntries(module.name).filter((e) => e.kind === 'page');
    return [
      { kind: 'command', command: 'slides.new' },
      { kind: 'command', command: 'slides.open' },
      { kind: 'separator' },
      { kind: 'command', command: 'slides.save' },
      { kind: 'command', command: 'slides.saveAs' },
      { kind: 'command', command: 'slides.export.pdf' },
      { kind: 'command', command: 'slides.export.pptx' },
      { kind: 'command', command: 'slides.export.ppsx' },
      { kind: 'command', command: 'slides.export.potx' },
      { kind: 'command', command: 'slides.export.odp' },
      { kind: 'command', command: 'slides.export.png' },
      { kind: 'command', command: 'slides.export.video' },
      { kind: 'command', command: 'slides.print' },
      { kind: 'separator' },
      ...pages,
      { kind: 'command', command: 'slides.about' },
      { kind: 'command', command: 'file.close' },
    ] as BackstageEntry[];
  }, [module.name]);

  const closeDialog = () => setDialog(null);
  const view = ctl.view;

  return (
    <AppFrame
      appId={module.id}
      appName={module.name}
      registry={registry}
      tabs={tabs}
      qat={['slides.save', 'slides.undo', 'slides.redo', 'slides.show.start']}
      docTitle={ctl.title}
      backstage={backstage}
      zoom={{ value: ctl.zoom || ctl.fitPercent || 100, onChange: (v) => ((ctl.zoom = clampZoom(v)), ctl.touch()), min: 10, max: 400 }}
      statusLeft={
        <>
          <span>{ctl.inMaster ? t('Vista Patrón') : t('Diapositiva {n} de {m}', { n: ctl.index + 1, m: ctl.deck.slides.length })}</span>
          {ctl.message && <span role="status">{t(ctl.message)}</span>}
          {saveState && <span aria-live="polite">{saveState}</span>}
        </>
      }
      contentFill
    >
      <div className="sl-app">
        {(view === 'normal' || view === 'master') && (
          <div className="sl-panel">
            {view === 'master' ? <MasterPanel ctl={ctl} /> : <Thumbs ctl={ctl} />}
          </div>
        )}
        <div className="sl-main">
          {view === 'outline' ? (
            <OutlineView ui={ui} />
          ) : view === 'sorter' ? (
            <SorterView ui={ui} />
          ) : view === 'reading' ? (
            <ReadingView ui={ui} />
          ) : view === 'notes' ? (
            <NotesPageView ui={ui} />
          ) : (
            <>
              <Stage ctl={ctl} />
              {ctl.showNotes && view !== 'master' && <NotesPane ctl={ctl} />}
            </>
          )}
        </div>
        {ctl.pane === 'format' && <FormatPane ui={ui} />}
        {ctl.pane === 'animations' && <AnimPane ui={ui} />}
        {ctl.pane === 'comments' && <CommentsPane ui={ui} />}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/bmp,image/webp,image/svg+xml"
          multiple
          hidden
          aria-hidden="true"
          tabIndex={-1}
          data-testid="sl-image-input"
          onChange={(e) => {
            const fs = [...(e.target.files ?? [])];
            e.target.value = '';
            void onPicture(fs);
          }}
        />
        <input
          ref={(el) => { mediaRef.current.el = el; }}
          type="file"
          accept="video/*,audio/*"
          hidden
          aria-hidden="true"
          tabIndex={-1}
          data-testid="sl-media-input"
          onChange={(e) => {
            const fs = [...(e.target.files ?? [])];
            e.target.value = '';
            void onMedia(fs);
          }}
        />
        <Dialogs ui={ui} dialog={dialog} onClose={closeDialog} />
        {present && <Present ctl={ctl} request={present} onClose={() => setPresent(null)} />}
      </div>
    </AppFrame>
  );
}
