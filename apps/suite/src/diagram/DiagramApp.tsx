import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, DialogTrigger, Input } from '@fluentui/react-components';
import { AppFrame, CommandRegistry, clampZoom, coreCommands, t, useLocale, type BackstageEntry } from '@suitenova/core-ui';
import { PAGE_SIZES, dataToCsv, exportArea, exportVsdx, importVsdx, pageToSvg, parseDiagram, serializeDiagram, type Page } from '@suitenova/diagram-core';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { zoomCommands } from '../common';
import { pickAndRead, readPath, saveBytes } from '../fileio';
import { StickyDialog } from '../mail/StickyDialog';
import type { ModuleInfo } from '../modules';
import { backstageEntries, fileCommands } from '../options';
import { closeThisWindow, isTauri, openModuleWindow } from '../platform';
import { addRecent } from '../recents';
import { diagramCommands, type DiagramDialog, type DiagramUI } from './commands';
import { DiagramCtl } from './ctl';
import './icons';
import './messages';
import './messages-more';
import './messages-more2';
import { diagramTabs } from './ribbonDef';
import { DataPane, LayersPane, LayoutForm, LinkForm } from './Panes';
import { Stage } from './Stage';
import { StencilPanel } from './StencilPanel';
import './diagram.css';

const DG_FILTERS = [{ name: 'Diagrama de Nova Diagram', extensions: ['novadiagram'] }];
const OPEN_FILTERS = [{ name: 'Diagramas', extensions: ['novadiagram', 'vsdx'] }];
const AUTOSAVE_MS = 1500;
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Diagrama';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const SHORTCUTS: [string, string][] = [
  ['Ctrl+N / O / S', 'Nuevo / Abrir / Guardar'],
  ['Ctrl+Z / Y', 'Deshacer / Rehacer'],
  ['Ctrl+C / X / V / D', 'Copiar / Cortar / Pegar / Duplicar'],
  ['Ctrl+A', 'Seleccionar todo'],
  ['Supr', 'Eliminar la selección'],
  ['Flechas (Mayús = 1 px)', 'Mover la selección'],
  ['Doble clic, Intro o F2', 'Editar el texto de una forma o de un conector'],
  ['Ctrl+Intro', 'Terminar la edición del texto'],
  ['Mayús al cambiar tamaño o girar', 'Mantener proporción / girar de 15 en 15°'],
  ['Alt al arrastrar', 'Ignorar la cuadrícula'],
  ['Ctrl+rueda', 'Acercar o alejar'],
  ['Ctrl+G / Ctrl+Mayús+G', 'Agrupar / Desagrupar'],
  ['Ctrl+K', 'Poner un vínculo a la forma'],
  ['Ctrl+clic en una forma con vínculo', 'Abrir el vínculo'],
  ['Clic en un miembro de un grupo ya seleccionado', 'Seleccionar solo esa forma'],
  ['Doble clic en el título de un carril', 'Cambiar el nombre del carril'],
  ['Esc', 'Cancelar el gesto, volver al puntero o deseleccionar'],
];

/** Draw the SVG of a page onto a canvas and return the PNG bytes. */
async function svgToPng(svg: string, w: number, h: number, scale: number): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok();
      img.onerror = () => fail(new Error('No se pudo dibujar la imagen.'));
      img.src = url;
    });
    const cw = Math.round(w * scale);
    const ch = Math.round(h * scale);
    if (cw * ch > 80_000_000) throw new Error('La imagen sería demasiado grande; elige una escala menor.');
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    canvas.getContext('2d')!.drawImage(img, 0, 0, cw, ch);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
    if (!blob) throw new Error('No se pudo crear el PNG.');
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

function printHtml(ctl: DiagramCtl): string {
  const first = ctl.diagram.pages[0]!;
  const a = exportArea(first);
  const pages = ctl.diagram.pages
    .map((p) => {
      const area = exportArea(p);
      return `<section style="width:${area.w}px;height:${area.h}px">${pageToSvg(p).replace(/<svg /, '<svg style="width:100%;height:100%" ')}</section>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(ctl.diagram.name)}</title><style>@page{size:${Math.round(a.w)}px ${Math.round(a.h)}px;margin:0}html,body{margin:0}section{page-break-after:always;overflow:hidden}section:last-child{page-break-after:auto}</style></head><body>${pages}</body></html>`;
}

function PageSetup({ ctl, onClose }: { ctl: DiagramCtl; onClose: () => void }) {
  const p = ctl.basePage;
  const [w, setW] = useState(String(p.width));
  const [h, setH] = useState(String(p.height));
  const [grid, setGrid] = useState(String(p.grid));
  const [spread, setSpread] = useState(String(p.spread ?? 10));
  const [bg, setBg] = useState(p.background);
  const [err, setErr] = useState('');
  const preset = Object.entries(PAGE_SIZES).find(([, [a, b]]) => (a === p.width && b === p.height) || (b === p.width && a === p.height))?.[0] ?? '';
  const ok = () => {
    const W = Number(w);
    const H = Number(h);
    const G = Number(grid);
    if (!(W >= 100 && W <= 20000 && H >= 100 && H <= 20000)) return setErr('El ancho y el alto deben estar entre 100 y 20000 px.');
    if (!(G >= 0 && G <= 200)) return setErr('La cuadrícula debe estar entre 0 y 200 px.');
    const S = Number(spread);
    if (!(S >= 0 && S <= 60)) return setErr('La separación de conectores debe estar entre 0 y 60 px.');
    ctl.setPageProps({ width: W, height: H, grid: G, background: bg, spread: S });
    onClose();
  };
  return (
    <>
      <DialogTitle>{t('Configurar página')}</DialogTitle>
      <DialogContent>
        <div className="dg-form">
          <label htmlFor="dg-pg-preset">{t('Tamaño predefinido')}</label>
          <select
            id="dg-pg-preset"
            className="nv-select"
            value={preset}
            onChange={(e) => {
              const [a, b] = PAGE_SIZES[e.target.value] ?? [Number(w), Number(h)];
              // keep the current orientation
              const land = p.width >= p.height;
              setW(String(land ? Math.max(a, b) : Math.min(a, b)));
              setH(String(land ? Math.min(a, b) : Math.max(a, b)));
            }}
          >
            <option value="">{t('Personalizado')}</option>
            {Object.keys(PAGE_SIZES).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <label htmlFor="dg-pg-w">{t('Ancho (px)')}</label>
          <Input id="dg-pg-w" value={w} onChange={(_e, d) => setW(d.value)} />
          <label htmlFor="dg-pg-h">{t('Alto (px)')}</label>
          <Input id="dg-pg-h" value={h} onChange={(_e, d) => setH(d.value)} />
          <label htmlFor="dg-pg-grid">{t('Cuadrícula (px, 0 = ninguna)')}</label>
          <Input id="dg-pg-grid" value={grid} onChange={(_e, d) => setGrid(d.value)} />
          <label htmlFor="dg-pg-spread">{t('Separación de conectores en un mismo punto (px, 0 = juntos)')}</label>
          <Input id="dg-pg-spread" value={spread} onChange={(_e, d) => setSpread(d.value)} />
          <label htmlFor="dg-pg-bg">{t('Color de fondo')}</label>
          <input id="dg-pg-bg" type="color" value={/^#[0-9a-f]{6}$/i.test(bg) ? bg : '#ffffff'} onChange={(e) => setBg(e.target.value)} />
        </div>
        {err && <p role="alert" className="dg-error">{t(err)}</p>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Cancelar')}</Button>
        <Button appearance="primary" onClick={ok}>
          {t('Aceptar')}
        </Button>
      </DialogActions>
    </>
  );
}

function RenameForm({ ctl, onClose }: { ctl: DiagramCtl; onClose: () => void }) {
  const [name, setName] = useState(ctl.basePage.name);
  const ok = () => {
    ctl.renamePage(ctl.pageId, name);
    onClose();
  };
  return (
    <>
      <DialogTitle>{t('Cambiar nombre de la página')}</DialogTitle>
      <DialogContent>
        <div className="dg-form">
          <label htmlFor="dg-rename">{t('Nombre')}</label>
          <Input id="dg-rename" value={name} autoFocus onChange={(_e, d) => setName(d.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} />
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Cancelar')}</Button>
        <Button appearance="primary" disabled={!name.trim()} onClick={ok}>
          {t('Aceptar')}
        </Button>
      </DialogActions>
    </>
  );
}

function PngForm({ ctl, onClose }: { ctl: DiagramCtl; onClose: () => void }) {
  const [scale, setScale] = useState('2');
  const [area, setArea] = useState<'page' | 'content'>('content');
  const [transparent, setTransparent] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const page: Page = ctl.basePage;
      const a = exportArea(page, { area });
      const png = await svgToPng(pageToSvg(page, { area, transparent }), a.w, a.h, Number(scale));
      await saveBytes(`${safeName(page.name)}.png`, png, [{ name: 'PNG', extensions: ['png'] }]);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <DialogTitle>{t('Exportar como imagen PNG')}</DialogTitle>
      <DialogContent>
        <div className="dg-form">
          <label htmlFor="dg-png-area">{t('Zona')}</label>
          <select id="dg-png-area" className="nv-select" value={area} onChange={(e) => setArea(e.target.value as 'page' | 'content')}>
            <option value="content">{t('Solo el dibujo')}</option>
            <option value="page">{t('Toda la página')}</option>
          </select>
          <label htmlFor="dg-png-scale">{t('Escala')}</label>
          <select id="dg-png-scale" className="nv-select" value={scale} onChange={(e) => setScale(e.target.value)}>
            <option value="1">1× (96 ppp)</option>
            <option value="2">2×</option>
            <option value="3">3×</option>
            <option value="4">4×</option>
          </select>
          <span />
          <label>
            <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> {t('Fondo transparente')}
          </label>
        </div>
        {err && <p role="alert" className="dg-error">{t(err)}</p>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Cancelar')}</Button>
        <Button appearance="primary" disabled={busy} onClick={() => void go()}>
          {t('Exportar')}
        </Button>
      </DialogActions>
    </>
  );
}

export function DiagramApp({ module }: { module: ModuleInfo }) {
  const registry = useMemo(() => new CommandRegistry(), []);
  const ctl = useMemo(() => new DiagramCtl(), []);
  const [dialog, setDialog] = useState<DiagramDialog | null>(null);
  const [saveState, setSaveState] = useState('');
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const zoomRef = useRef(ctl.zoom);
  useLocale();
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  zoomRef.current = ctl.zoom;

  const saveNow = useCallback(
    async (saveAs: boolean, silent = false) => {
      try {
        const data = new TextEncoder().encode(serializeDiagram(ctl.diagram));
        const base = (ctl.fileName ?? ctl.diagram.name).replace(/\.[^.]+$/, '');
        const keep = !saveAs && ctl.filePath?.toLowerCase().endsWith('.novadiagram') ? ctl.filePath : null;
        const saved = await saveBytes(`${safeName(base)}.novadiagram`, data, DG_FILTERS, keep);
        if (saved) {
          ctl.markSaved(saved.name, saved.path);
          if (!silent) addRecent({ path: saved.path, name: saved.name, app: 'diagram' });
          setSaveState(t('Guardado'));
        }
      } catch (e) {
        if (!silent) window.alert(t('No se pudo guardar: {error}', { error: (e as Error).message }));
        else setSaveState(t('No se pudo guardar automáticamente'));
      }
    },
    [ctl],
  );

  useEffect(() => {
    if (!isTauri() || !ctl.filePath || !ctl.dirty) return;
    const id = setTimeout(() => void saveNow(false, true), AUTOSAVE_MS);
    return () => clearTimeout(id);
  });

  const loadFile = useCallback(
    async (file: { name: string; path: string | null; data: Uint8Array }) => {
      try {
        const lower = file.name.toLowerCase();
        if (lower.endsWith('.vsd')) throw new Error(t('Los .vsd antiguos de Visio no se pueden abrir. En Visio usa Archivo > Guardar como > .vsdx.'));
        if (lower.endsWith('.vsdx')) {
          const r = await importVsdx(file.data);
          r.diagram.name = file.name.replace(/\.[^.]+$/, '');
          ctl.load(r.diagram, null, null);
          ctl.dirty = true;
          ctl.touch();
          if (r.warnings.length) window.alert(t('El dibujo se importó, pero:') + '\n\n' + r.warnings.join('\n'));
        } else {
          const r = parseDiagram(new TextDecoder('utf-8').decode(file.data));
          ctl.load(r.diagram, file.name, file.path);
          addRecent({ path: file.path, name: file.name, app: 'diagram' });
          if (r.warnings.length) window.alert(t('El diagrama se abrió, pero:') + '\n\n' + [...new Set(r.warnings)].slice(0, 10).join('\n'));
        }
      } catch (e) {
        window.alert(t('No se pudo abrir "{name}": {error}', { name: file.name, error: (e as Error).message }));
      }
    },
    [ctl],
  );

  const ui: DiagramUI = useMemo(
    () => ({
      ctl,
      openDialog: (k) => setDialog(k),
      newWindow: () => void openModuleWindow('diagram', module.name),
      open: async () => {
        if (ctl.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Abrir otro archivo y descartarlos?'))) return;
        const f = await pickAndRead(OPEN_FILTERS).catch((e) => {
          window.alert(String(e));
          return null;
        });
        if (f) await loadFile(f);
      },
      save: (saveAs) => saveNow(saveAs),
      importVsdx: async () => {
        if (ctl.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Abrir otro archivo y descartarlos?'))) return;
        const f = await pickAndRead([{ name: 'Visio', extensions: ['vsdx'] }]).catch(() => null);
        if (f) await loadFile(f);
      },
      exportSvg: async () => {
        const page = ctl.basePage;
        await saveBytes(`${safeName(page.name)}.svg`, new TextEncoder().encode(pageToSvg(page)), [{ name: 'SVG', extensions: ['svg'] }]);
      },
      exportVsdx: async () => {
        try {
          const data = await exportVsdx(ctl.diagram);
          await saveBytes(`${safeName(ctl.diagram.name)}.vsdx`, data, [{ name: 'Visio', extensions: ['vsdx'] }]);
        } catch (e) {
          window.alert(t('No se pudo guardar: {error}', { error: (e as Error).message }));
        }
      },
      print: () => {
        frameRef.current?.remove();
        const frame = document.createElement('iframe');
        frame.setAttribute('aria-hidden', 'true');
        frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
        frame.srcdoc = printHtml(ctl);
        frame.onload = () => {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        };
        document.body.appendChild(frame);
        frameRef.current = frame;
      },
      insertImage: () => imageInput.current?.click(),
      openLink: (shape) => {
        const l = shape.link;
        if (!l) return;
        if (l.page) ctl.goToPage(l.page);
        else if (l.url) window.open(l.url, '_blank', 'noopener,noreferrer');
      },
      exportData: async () => {
        const page = ctl.basePage;
        if (!page.shapes.some((x) => x.data?.length)) return ctl.say('Ninguna forma tiene datos todavía.');
        await saveBytes(`${safeName(page.name)}-datos.csv`, new TextEncoder().encode('\ufeff' + dataToCsv(page)), [{ name: 'CSV', extensions: ['csv'] }]);
      },
      fitPage: () => {
        const el = document.querySelector<HTMLElement>('.dg-scroller');
        if (!el) return;
        const p = ctl.basePage;
        ctl.setZoom(Math.min((el.clientWidth - 40) / p.width, (el.clientHeight - 40) / p.height) * 100);
      },
      close: () => {
        if (ctl.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Cerrar y descartarlos?'))) return;
        void closeThisWindow();
      },
    }),
    [ctl, loadFile, saveNow, module.name],
  );

  useEffect(() => {
    const offs = [
      registry.registerAll(coreCommands),
      registry.registerAll(zoomCommands(() => zoomRef.current, (z) => ctl.setZoom(clampZoom(z)), clampZoom).map((c) => ({ ...c, shortcut: c.id === 'zoom.reset' ? undefined : c.shortcut }))),
      registry.registerAll(diagramCommands(ui)),
    ];
    fileCommands(registry);
    const unsub = ctl.subscribe(() => registry.invalidate());
    return () => {
      offs.forEach((o) => o());
      unsub();
    };
  }, [registry, ui, ctl]);

  useEffect(() => {
    const path = new URLSearchParams(location.search).get('open');
    if (!path || !isTauri()) return;
    readPath(path).then(loadFile, (e) => window.alert(t('No se pudo abrir "{name}": {error}', { name: path, error: String(e) })));
  }, [loadFile]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __novaDiagram: unknown }).__novaDiagram = { ctl, load: (text: string, name: string) => loadFile({ name, path: null, data: new TextEncoder().encode(text) }) };
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

  // Ctrl+click on a shape with a link follows it
  useEffect(() => {
    ctl.openLinkHandler = (sh) => ui.openLink(sh);
    return () => {
      ctl.openLinkHandler = undefined;
    };
  }, [ctl, ui]);

  const onImageFiles = async (files: File[]) => {
    for (const f of files) {
      if (!/^image\/(png|jpeg|gif|webp|svg\+xml|bmp)$/.test(f.type)) {
        ctl.say('Solo se pueden insertar imágenes PNG, JPEG, GIF, WebP, SVG o BMP.');
        continue;
      }
      if (f.size > 8_000_000) {
        ctl.say('La imagen pesa más de 8 MB; usa una más pequeña.');
        continue;
      }
      const src: string = await new Promise((ok, bad) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result));
        r.onerror = () => bad(r.error);
        r.readAsDataURL(f);
      });
      const dim = await new Promise<{ w: number; h: number }>((ok) => {
        const im = new Image();
        im.onload = () => ok({ w: im.naturalWidth || 160, h: im.naturalHeight || 120 });
        im.onerror = () => ok({ w: 160, h: 120 });
        im.src = src;
      });
      ctl.insertImage(src, dim.w, dim.h);
    }
  };
  useEffect(() => {
    ctl.onImageFiles = (files, at) => {
      void (async () => {
        for (const f of files) {
          if (!/^image\//.test(f.type)) continue;
          const src: string = await new Promise((ok, bad) => {
            const r = new FileReader();
            r.onload = () => ok(String(r.result));
            r.onerror = () => bad(r.error);
            r.readAsDataURL(f);
          });
          const dim = await new Promise<{ w: number; h: number }>((ok) => {
            const im = new Image();
            im.onload = () => ok({ w: im.naturalWidth || 160, h: im.naturalHeight || 120 });
            im.onerror = () => ok({ w: 160, h: 120 });
            im.src = src;
          });
          ctl.insertImage(src, dim.w, dim.h, at);
        }
      })();
    };
    return () => {
      ctl.onImageFiles = undefined;
    };
  }, [ctl]);

  const tabs = useMemo(() => diagramTabs(ui), [ui]);
  const backstage: BackstageEntry[] = useMemo(() => {
    const pages = backstageEntries(module.name).filter((e) => e.kind === 'page');
    return [
      { kind: 'command', command: 'diagram.new' },
      { kind: 'command', command: 'diagram.open' },
      { kind: 'separator' },
      { kind: 'command', command: 'diagram.save' },
      { kind: 'command', command: 'diagram.saveAs' },
      { kind: 'command', command: 'diagram.import.vsdx' },
      { kind: 'command', command: 'diagram.export.vsdx' },
      { kind: 'command', command: 'diagram.export.svg' },
      { kind: 'command', command: 'diagram.export.png' },
      { kind: 'command', command: 'diagram.print' },
      { kind: 'separator' },
      ...pages,
      { kind: 'command', command: 'diagram.about' },
      { kind: 'command', command: 'file.close' },
    ] as BackstageEntry[];
  }, [module.name]);

  const close = () => setDialog(null);
  const p = ctl.basePage;
  const selCount = ctl.selShapes.length + ctl.selConnectors.length;

  return (
    <AppFrame
      appId={module.id}
      appName={module.name}
      registry={registry}
      tabs={tabs}
      qat={['diagram.save', 'diagram.undo', 'diagram.redo']}
      docTitle={ctl.docTitle}
      backstage={backstage}
      zoom={{ value: ctl.zoom, onChange: (v) => ctl.setZoom(clampZoom(v)), min: 10, max: 400 }}
      statusLeft={
        <>
          <span>
            {p.shapes.length === 1 ? t('1 forma') : t('{n} formas', { n: p.shapes.length })} · {p.connectors.length === 1 ? t('1 conector') : t('{n} conectores', { n: p.connectors.length })}
          </span>
          {selCount > 0 && <span>{t('{n} seleccionados', { n: selCount })}</span>}
          {ctl.tool === 'connector' && <span role="status">{t('Herramienta Conector: arrastra de una forma a otra')}</span>}
          {ctl.message && <span role="alert">{t(ctl.message)}</span>}
          {saveState && <span aria-live="polite">{saveState}</span>}
        </>
      }
      contentFill
    >
      <div className="dg-app">
        <StencilPanel ctl={ctl} onImage={() => ui.insertImage()} />
        <div className="dg-main">
          <Stage ctl={ctl} />
          <div className="dg-pagebar" role="tablist" aria-label={t('Páginas')}>
            {ctl.diagram.pages.map((pg) => (
              <button
                key={pg.id}
                type="button"
                role="tab"
                aria-selected={pg.id === ctl.pageId}
                className={`dg-pagetab${pg.id === ctl.pageId ? ' is-active' : ''}`}
                onClick={() => ctl.goToPage(pg.id)}
                onDoubleClick={() => setDialog('rename')}
              >
                {pg.name}
              </button>
            ))}
            <button type="button" className="dg-pageadd" aria-label={t('Página nueva')} title={t('Página nueva')} onClick={() => ctl.newPage()}>
              +
            </button>
          </div>
        </div>
        {ctl.pane === 'data' && <DataPane ctl={ctl} />}
        {ctl.pane === 'layers' && <LayersPane ctl={ctl} />}
        <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/bmp" multiple hidden aria-hidden="true" tabIndex={-1} data-testid="dg-image-input" onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; void onImageFiles(fs); }} />
      </div>
      <StickyDialog open={dialog === 'layout'} onClose={close}>
        {dialog === 'layout' && <LayoutForm ctl={ctl} onClose={close} />}
      </StickyDialog>
      <StickyDialog open={dialog === 'link'} onClose={close}>
        {dialog === 'link' && <LinkForm ctl={ctl} onClose={close} />}
      </StickyDialog>
      <StickyDialog open={dialog === 'page'} onClose={close}>
        {dialog === 'page' && <PageSetup ctl={ctl} onClose={close} />}
      </StickyDialog>
      <StickyDialog open={dialog === 'rename'} onClose={close}>
        {dialog === 'rename' && <RenameForm ctl={ctl} onClose={close} />}
      </StickyDialog>
      <StickyDialog open={dialog === 'png'} onClose={close}>
        {dialog === 'png' && <PngForm ctl={ctl} onClose={close} />}
      </StickyDialog>
      <Dialog open={dialog === 'about'} modalType="modal" onOpenChange={(_e, d) => !d.open && close()}>
        <DialogSurface style={{ maxWidth: 520, width: '92vw' }}>
          <DialogBody>
            <DialogTitle>{t('Acerca de Nova Diagram')}</DialogTitle>
            <DialogContent>
              <p>Nova Diagram 0.0.10</p>
              <p>{t('Diagramas libres (MPL-2.0) de SuiteNova. Grupos, capas, contenedores y carriles, diseño automático, imágenes, vínculos y datos de forma. Guarda en .novadiagram y exporta SVG, PNG, PDF y Visio (.vsdx); consulta docs/LIMITACIONES.md para saber qué se conserva.')}</p>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="primary">{t('Cerrar')}</Button>
              </DialogTrigger>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <Dialog open={dialog === 'shortcuts'} modalType="modal" onOpenChange={(_e, d) => !d.open && close()}>
        <DialogSurface style={{ maxWidth: 600, width: '92vw' }}>
          <DialogBody>
            <DialogTitle>{t('Atajos de teclado')}</DialogTitle>
            <DialogContent>
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
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="primary">{t('Cerrar')}</Button>
              </DialogTrigger>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </AppFrame>
  );
}
