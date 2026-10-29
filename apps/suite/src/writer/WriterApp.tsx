import { AppFrame, CommandRegistry, clampZoom, coreCommands, t, useLocale, type BackstageEntry } from '@suitenova/core-ui';
import { readDoc, readOdt, readRtf, writeOdt, writeRtf, WrongPasswordError, decryptPackage, defaultStyles, encryptPackage, isEncryptedPackage, nodeTypes, ptToPx, readDocx, styleCss, writeDocx } from '@suitenova/writer-core';
import { isInTable } from 'prosemirror-tables';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { helpTab, zoomCommands } from '../common';
import { pickAndRead, readPath, saveBytes } from '../fileio';
import { addRecent } from '../recents';
import type { ModuleInfo } from '../modules';
import { backstageEntries, fileCommands } from '../options';
import { closeThisWindow, isTauri, openModuleWindow } from '../platform';
import { writerCommands, type WriterDialog, type WriterUI } from './commands';
import { DialogHost } from './dialogs';
import { ControlPopup } from './ControlPopup';
import { SpellMenu } from './SpellUI';
import { OpenPasswordDialog } from './dlg-security';
import { PAGE_GAP, WriterCtl, findKey } from './doc';
import './icons';
import './icons-more';
import './messages';
import './messages-more';
import './messages-objects';
import { PageOverlay } from './PageOverlay';
import { ZonesLayer } from './ZonesLayer';
import { NavPane } from './NavPane';
import { ReviewPane } from './ReviewPane';
import { NotePopup } from './NotePopup';
import { HRuler, TabKindButton, VRuler } from './Ruler';
import { writerTabs } from './ribbonDef';
import './writer.css';

const DOCX_FILTERS = [{ name: 'Documento de Word', extensions: ['docx'] }];
const DOTX_FILTERS = [{ name: 'Plantilla de Word', extensions: ['dotx'] }];
const OPEN_FILTERS = [
  { name: 'Documentos', extensions: ['docx', 'dotx', 'doc', 'rtf', 'odt', 'txt', 'html', 'htm'] },
  { name: 'Word 97-2003', extensions: ['doc'] },
  { name: 'Formato de texto enriquecido', extensions: ['rtf'] },
  { name: 'Texto de OpenDocument', extensions: ['odt'] },
  { name: 'Documento de Word', extensions: ['docx'] },
  { name: 'Plantilla de Word', extensions: ['dotx'] },
  { name: 'Texto', extensions: ['txt'] },
  { name: 'Página web', extensions: ['html', 'htm'] },
];

/** The full HTML of the paginated document, ready to be printed from a clean page (no scaling, no gaps between pages). */
export function buildPrintHtml(ctl: WriterCtl, sheet: HTMLElement): string {
  const clone = sheet.cloneNode(true) as HTMLElement;
  const first = ctl.sections()[0]?.props.page ?? ctl.page;
  const total = ctl.pageRects().reduce((a, r) => a + r.height, 0);
  clone.style.transform = 'none';
  clone.style.setProperty('--nw-gap', '0px');
  clone.style.height = `${total - 1}px`;
  clone.classList.add('nw-printing');
  const heads = [...document.head.querySelectorAll('style, link[rel="stylesheet"]')].map((n) => n.outerHTML).join('\n');
  const w = (first.width / 72).toFixed(4);
  const h = (first.height / 72).toFixed(4);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${(ctl.fileName ?? 'Documento').replace(/</g, '&lt;')}</title>${heads}<style>${styleCss(defaultStyles(), ctl.defaults)}
@page{size:${w}in ${h}in;margin:0}
html,body{margin:0;padding:0;background:#fff!important;height:auto!important;overflow:visible!important}
.nw-sheet{box-shadow:none!important;margin:0!important}
.nw-page{box-shadow:none!important}
</style></head><body>${clone.outerHTML}</body></html>`;
}

function FindBar({ ui, replace, onClose }: { ui: WriterUI; replace: boolean; onClose: () => void }) {
  const ctl = ui.ctl;
  const [q, setQ] = useState(() => {
    const s = ctl.state;
    return s && !s.selection.empty && s.selection.to - s.selection.from < 80 ? s.doc.textBetween(s.selection.from, s.selection.to) : '';
  });
  const [rep, setRep] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [whole, setWhole] = useState(false);
  const [info, setInfo] = useState('');
  const run = (query: string, from?: number) => {
    if (!query) {
      ctl.clearFind();
      setInfo('');
      return;
    }
    const r = ctl.find(query, { matchCase, wholeWord: whole }, from);
    setInfo(r.matches.length ? t('{n} de {total}', { n: r.current + 1, total: r.matches.length }) : t('Sin resultados'));
  };
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (q) run(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchCase, whole]);
  const step = (d: 1 | -1) => {
    const r = ctl.findStep(d) ?? null;
    if (!r || !r.matches.length) run(q);
    else setInfo(t('{n} de {total}', { n: r.current + 1, total: r.matches.length }));
  };
  return (
    <div className="nw-find-bar" role="search" aria-label={t('Buscar y reemplazar')}>
      <div className="nw-find-row">
        <input
          autoFocus
          aria-label={t('Buscar')}
          placeholder={t('Buscar')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            run(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (findCount(ctl) === 0) run(q);
              else step(e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape') {
              onClose();
            }
          }}
        />
        <span className="nw-find-info" aria-live="polite">
          {info}
        </span>
        <button type="button" className="nv-btn nv-btn--small" onClick={() => step(-1)} aria-label={t('Anterior')} title={t('Anterior')}>
          ↑
        </button>
        <button type="button" className="nv-btn nv-btn--small" onClick={() => step(1)} aria-label={t('Siguiente')} title={t('Siguiente')}>
          ↓
        </button>
        <label>
          <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> {t('Coincidir mayúsculas')}
        </label>
        <label>
          <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> {t('Palabras completas')}
        </label>
        <button type="button" className="nv-btn nv-btn--small" onClick={onClose} aria-label={t('Cerrar')} title={t('Cerrar')}>
          ✕
        </button>
      </div>
      {replace && (
        <div className="nw-find-row">
          <input
            aria-label={t('Reemplazar con')}
            placeholder={t('Reemplazar con')}
            value={rep}
            onChange={(e) => setRep(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
            }}
          />
          <button
            type="button"
            className="nv-btn nv-btn--small"
            onClick={() => {
              if (!q) return;
              if (findCount(ctl) === 0) run(q);
              const r = ctl.replaceCurrent(rep);
              setInfo(r && r.matches.length ? t('{n} de {total}', { n: r.current + 1, total: r.matches.length }) : t('Sin resultados'));
            }}
          >
            {t('Reemplazar')}
          </button>
          <button
            type="button"
            className="nv-btn nv-btn--small"
            onClick={() => {
              const n = q ? ctl.replaceAll(q, rep, { matchCase, wholeWord: whole }) : 0;
              ctl.clearFind();
              setInfo(n ? t('Se reemplazaron {n} coincidencias.', { n }) : t('Sin resultados'));
            }}
          >
            {t('Reemplazar todo')}
          </button>
        </div>
      )}
    </div>
  );
}

function findCount(ctl: WriterCtl): number {
  return ctl.view ? (findKey.getState(ctl.view.state)?.matches.length ?? 0) : 0;
}

function Status({ ctl }: { ctl: WriterCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const w = ctl.words();
  return (
    <>
      <span>{t('Página {n} de {total}', { n: ctl.currentPage(), total: ctl.pages })}</span>
      {ctl.signature && (
        <span role="status" style={{ color: ctl.signatureStatus === 'valid' ? '#9be7b0' : ctl.signatureStatus ? '#ffb4b4' : undefined }}>
          {ctl.signatureStatus === 'valid' ? t('Firmado por {s}', { s: ctl.signature.signer }) : ctl.signatureStatus === 'modified' ? t('Firma no válida: el documento cambió') : ctl.signatureStatus === 'invalid' ? t('Firma alterada') : t('Firmado por {s}', { s: ctl.signature.signer })}
        </span>
      )}
      {ctl.password && <span>{t('Cifrado con contraseña')}</span>}
      <span>{w.selection !== null ? t('{n} de {total} palabras', { n: w.selection, total: w.total }) : t('{n} palabras', { n: w.total })}</span>
    </>
  );
}

export function WriterApp({ module }: { module: ModuleInfo }) {
  const registry = useMemo(() => new CommandRegistry(), []);
  const ctl = useMemo(() => new WriterCtl(), []);
  const [zoom, setZoom] = useState(100);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [dialog, setDialog] = useState<WriterDialog | null>(null);
  const [dialogArg, setDialogArg] = useState<unknown>(undefined);
  const [spellTarget, setSpellTarget] = useState<{ from: number; to: number; word: string; x: number; y: number } | null>(null);
  const [pwPrompt, setPwPrompt] = useState<{ name: string; path: string | null; data: Uint8Array } | null>(null);
  const [controlPos, setControlPos] = useState<number | null>(null);
  const [find, setFind] = useState<{ replace: boolean } | null>(null);
  useLocale();
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ctl.onDialog = (k, arg) => {
      setDialogArg(arg);
      setDialog(k as WriterDialog);
    };
    ctl.onControl = (pos) => setControlPos(pos);
    ctl.onSpellMenu = (m) => setSpellTarget(m);
    ctl.attach(mountRef.current!, sheetRef.current!);
    return () => ctl.detach();
  }, [ctl]);

  const loadFile = useCallback(
    async (file: { name: string; path: string | null; data: Uint8Array }, password: string | null = null) => {
      const lower = file.name.toLowerCase();
      try {
        if (isEncryptedPackage(file.data)) {
          setPwPrompt(file);
          return;
        }
        if (lower.endsWith('.docx') || lower.endsWith('.dotx')) {
          const { doc, warnings } = await readDocx(file.data);
          ctl.load(doc, file.name, file.path);
          ctl.password = password;
          addRecent({ path: file.path, name: file.name, app: 'writer' });
          if (warnings.length) window.alert(t('El archivo se abrió, pero:') + '\n\n' + [...new Set(warnings)].slice(0, 12).join('\n'));
        } else if (lower.endsWith('.rtf') || lower.endsWith('.odt') || lower.endsWith('.doc')) {
          const r = lower.endsWith('.rtf') ? readRtf(file.data) : lower.endsWith('.odt') ? await readOdt(file.data) : readDoc(file.data);
          const base = file.name.replace(/\.[^.]+$/, '');
          ctl.load(r.doc, base + '.docx', null);
          ctl.dirty = true;
          ctl.touch();
          if (r.warnings.length) window.alert(t('El archivo se abrió, pero:') + '\n\n' + r.warnings.slice(0, 12).join('\n'));
        } else if (lower.endsWith('.html') || lower.endsWith('.htm')) {
          ctl.loadHtml(new TextDecoder('utf-8').decode(file.data), file.name);
        } else {
          ctl.loadText(new TextDecoder('utf-8').decode(file.data), file.name);
        }
      } catch (e) {
        window.alert(t('No se pudo abrir "{name}": {error}', { name: file.name, error: (e as Error).message }));
      }
    },
    [ctl],
  );

  const ui: WriterUI = useMemo(
    () => ({
      ctl,
      openDialog: (k, arg) => {
        setDialogArg(arg);
        setDialog(k);
      },
      openFind: (replace) => setFind({ replace }),
      getZoom: () => zoomRef.current,
      setZoom: (z) => setZoom(clampZoom(z)),
      fitWidth: () => {
        const w = scrollRef.current?.clientWidth ?? 0;
        if (w) setZoom(clampZoom(Math.floor(((w - 48) / ctl.sheetWidth()) * 100)));
      },
      newWindow: () => void openModuleWindow('writer', module.name),
      open: async () => {
        if (ctl.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Abrir otro archivo y descartarlos?'))) return;
        const f = await pickAndRead(OPEN_FILTERS).catch((e) => {
          window.alert(String(e));
          return null;
        });
        if (f) await loadFile(f);
      },
      save: async (saveAs) => {
        try {
          const written = await writeDocx(ctl.toWriterDoc());
          const warnings = written.warnings;
          const data = ctl.password ? await encryptPackage(written.data, ctl.password) : written.data;
          const base = (ctl.fileName ?? 'Documento1').replace(/\.[^.]+$/, '');
          const keepPath = !saveAs && ctl.filePath?.toLowerCase().endsWith('.docx') ? ctl.filePath : null;
          const saved = await saveBytes(`${base}.docx`, data, DOCX_FILTERS, keepPath);
          if (saved) {
            ctl.markSaved(saved.name, saved.path);
            addRecent({ path: saved.path, name: saved.name, app: 'writer' });
            if (warnings.length) window.alert(t('Se guardó, pero:') + '\n\n' + warnings.join('\n'));
          }
        } catch (e) {
          window.alert(t('No se pudo guardar: {error}', { error: (e as Error).message }));
        }
      },
      saveTemplate: async () => {
        try {
          const { data } = await writeDocx({ ...ctl.toWriterDoc(), isTemplate: true, signature: null });
          const base = (ctl.fileName ?? 'Documento1').replace(/.[^.]+$/, '');
          await saveBytes(`${base}.dotx`, data, DOTX_FILTERS);
        } catch (e) {
          window.alert(t('No se pudo guardar: {error}', { error: (e as Error).message }));
        }
      },
      applyTemplate: (doc) => {
        if (ctl.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Reemplazar el documento y descartarlos?'))) return;
        ctl.load(doc, null, null);
        ctl.focus();
      },
      openTemplateFile: async () => {
        const f = await pickAndRead(DOTX_FILTERS).catch(() => null);
        if (!f) return;
        try {
          const { doc } = await readDocx(f.data);
          if (ctl.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Reemplazar el documento y descartarlos?'))) return;
          ctl.load({ ...doc, isTemplate: false }, null, null);
        } catch (e) {
          window.alert(t('No se pudo abrir "{name}": {error}', { name: f.name, error: (e as Error).message }));
        }
      },
      exportRtf: async () => {
        try {
          const { data, warnings } = writeRtf(ctl.toWriterDoc());
          await saveBytes(`${(ctl.fileName ?? 'Documento1').replace(/\.[^.]+$/, '')}.rtf`, data, [{ name: 'Formato de texto enriquecido', extensions: ['rtf'] }]);
          if (warnings.length) window.alert(t('Se guardó, pero:') + '\n\n' + warnings.join('\n'));
        } catch (e) {
          window.alert(t('No se pudo guardar: {error}', { error: (e as Error).message }));
        }
      },
      exportOdt: async () => {
        try {
          const { data, warnings } = await writeOdt(ctl.toWriterDoc());
          await saveBytes(`${(ctl.fileName ?? 'Documento1').replace(/\.[^.]+$/, '')}.odt`, data, [{ name: 'Texto de OpenDocument', extensions: ['odt'] }]);
          if (warnings.length) window.alert(t('Se guardó, pero:') + '\n\n' + warnings.join('\n'));
        } catch (e) {
          window.alert(t('No se pudo guardar: {error}', { error: (e as Error).message }));
        }
      },
      exportTxt: async () => {
        await saveBytes(`${(ctl.fileName ?? 'Documento1').replace(/\.[^.]+$/, '')}.txt`, new TextEncoder().encode(ctl.text()), [{ name: 'Texto', extensions: ['txt'] }]);
      },
      exportHtml: async () => {
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>${(ctl.fileName ?? 'Documento').replace(/</g, '&lt;')}</title><style>body{max-width:42em;margin:2em auto;padding:0 1em}${styleCss(defaultStyles(), ctl.defaults)}.nw-table{border-collapse:collapse}.nw-borders td,.nw-borders th{border:1px solid #000}</style></head><body class="nw-doc">${ctl.html()}</body></html>`;
        await saveBytes(`${(ctl.fileName ?? 'Documento1').replace(/\.[^.]+$/, '')}.html`, new TextEncoder().encode(html), [{ name: 'Página web', extensions: ['html'] }]);
      },
      print: () => {
        const sheet = sheetRef.current;
        if (!sheet) return;
        const frame = document.createElement('iframe');
        frame.setAttribute('aria-hidden', 'true');
        frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
        document.body.appendChild(frame);
        const doc = frame.contentDocument!;
        doc.open();
        doc.write(buildPrintHtml(ctl, sheet));
        doc.close();
        setTimeout(() => {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
          setTimeout(() => frame.remove(), 60_000);
        }, 400);
      },
      insertImage: () => fileRef.current?.click(),
      close: () => {
        if (ctl.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Cerrar y descartarlos?'))) return;
        void closeThisWindow();
      },
    }),
    [ctl, loadFile, module.name],
  );

  useEffect(() => {
    const offs = [
      registry.registerAll(coreCommands),
      registry.registerAll(zoomCommands(() => zoomRef.current, (z) => setZoom(clampZoom(z)), clampZoom).map((c) => ({ ...c, shortcut: c.id === 'zoom.reset' ? undefined : c.shortcut }))),
      registry.registerAll(writerCommands(ui)),
    ];
    fileCommands(registry);
    const unsub = ctl.subscribe(() => registry.invalidate());
    return () => {
      offs.forEach((o) => o());
      unsub();
    };
  }, [registry, ui, ctl]);
  useEffect(() => registry.invalidate(), [registry, zoom]);

  useEffect(() => {
    const path = new URLSearchParams(location.search).get('open');
    if (!path || !isTauri()) return;
    readPath(path).then(loadFile, (e) => window.alert(t('No se pudo abrir "{name}": {error}', { name: path, error: String(e) })));
  }, [loadFile]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __novaWriter: unknown }).__novaWriter = {
      ctl,
      docx: { writeDocx, readDocx },
      formats: { readRtf, writeRtf, readOdt, writeOdt, readDoc },
      printHtml: () => buildPrintHtml(ctl, sheetRef.current!),
      load: async (b64: string, name: string) => {
        const bin = atob(b64);
        const data = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
        await loadFile({ name, path: null, data });
      },
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
          if (ctl.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Cerrar y descartarlos?'))) e.preventDefault();
        });
      });
    }
    return () => {
      window.removeEventListener('beforeunload', before);
      unlisten?.();
    };
  }, [ctl]);

  // Ctrl+wheel zoom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z + (e.deltaY < 0 ? 10 : -10)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const inTable = !!ctl.state && isInTable(ctl.state);
  const hfEditing = !!ctl.hfEdit;
  const outlineOn = ctl.viewMode === 'outline';
  const tabs = useMemo(() => writerTabs(ui, { inTable, hf: hfEditing, outline: outlineOn }), [ui, inTable, hfEditing, outlineOn]);
  const backstage: BackstageEntry[] = useMemo(() => {
    const pages = backstageEntries(module.name).filter((e) => e.kind === 'page');
    return [
      { kind: 'command', command: 'writer.new' },
      { kind: 'command', command: 'writer.newFromTemplate' },
      { kind: 'command', command: 'writer.open' },
      { kind: 'separator' },
      { kind: 'command', command: 'writer.save' },
      { kind: 'command', command: 'writer.saveAs' },
      { kind: 'command', command: 'writer.saveTemplate' },
      { kind: 'command', command: 'writer.password.set' },
      { kind: 'command', command: 'writer.password.remove' },
      { kind: 'command', command: 'writer.exportRtf' },
      { kind: 'command', command: 'writer.exportOdt' },
      { kind: 'command', command: 'writer.exportTxt' },
      { kind: 'command', command: 'writer.exportHtml' },
      { kind: 'command', command: 'writer.print' },
      { kind: 'separator' },
      ...pages,
      { kind: 'command', command: 'writer.about' },
      { kind: 'command', command: 'file.close' },
    ] as BackstageEntry[];
  }, [module.name]);

  const sheetW = ctl.sheetWidth();
  const total = ctl.sheetHeight();
  const firstPage = ctl.sections()[0]?.props.page ?? ctl.page;
  const web = ctl.viewMode !== 'print';
  const z = zoom / 100;

  return (
    <AppFrame
      appId={module.id}
      appName={module.name}
      registry={registry}
      tabs={tabs}
      qat={['writer.save', 'writer.undo', 'writer.redo']}
      docTitle={ctl.docTitle}
      backstage={backstage}
      zoom={{ value: zoom, onChange: (v) => setZoom(clampZoom(v)), min: 10, max: 400 }}
      statusLeft={<Status ctl={ctl} />}
      contentFill
    >
      <div className="nw-app">
        <style>{styleCss(ctl.styles, ctl.defaults)}</style>
        {find && <FindBar ui={ui} replace={find.replace} key={String(find.replace)} onClose={() => { setFind(null); ctl.clearFind(); ctl.focus(); }} />}
        <div className="nw-body">
        {ctl.showNav && <NavPane ctl={ctl} onClose={() => { ctl.showNav = false; ctl.touch(); }} />}
        <div className="nw-scroll" ref={scrollRef}>
          {!web && ctl.showRuler && (
            <div className="nw-rulerwrap" style={{ width: sheetW * z }}>
              <TabKindButton ctl={ctl} />
              <HRuler ctl={ctl} zoom={zoom} />
            </div>
          )}
          <div className="nw-zoomwrap" style={web ? { width: '100%', maxWidth: 1000 } : { width: sheetW * z, height: total * z }}>
            {!web && ctl.showRuler && <VRuler ctl={ctl} zoom={zoom} />}
            <div
              ref={sheetRef}
              className={`nw-sheet nw-view-${ctl.viewMode} nw-mk-${ctl.markup}${ctl.showMarks ? ' nw-marks' : ''}${ctl.hfEdit ? ' nw-hf-editing' : ''}`}
              style={{ width: web ? undefined : sheetW, height: web ? undefined : total, ...(web ? { zoom: z } : { transform: `scale(${z})` }), ['--nw-gap' as string]: `${PAGE_GAP}px`, ['--nw-sheet-w' as string]: `${sheetW}px` }}
            >
              {!web && <PageOverlay ctl={ctl} />}
              <div ref={mountRef} className="nw-editor" style={{ left: 0, top: web ? 0 : ptToPx(firstPage.marginTop), width: sheetW }} />
              {!web && <ZonesLayer ctl={ctl} />}
            </div>
          </div>
        </div>
        {ctl.showReview && <ReviewPane ctl={ctl} />}
        </div>
        {ctl.noteEdit && <NotePopup ctl={ctl} />}
        {!ctl.contentEnabled && ctl.macros.length > 0 && (
          <div className="nw-secbar" role="alert">
            <span>{t('ADVERTENCIA DE SEGURIDAD: se ha deshabilitado el contenido activo (macros) de este documento.')}</span>
            <button className="nw-btn" onClick={() => ctl.enableContent()}>
              {t('Habilitar contenido')}
            </button>
          </div>
        )}
        {pwPrompt && (
          <OpenPasswordDialog
            name={pwPrompt.name}
            onCancel={() => setPwPrompt(null)}
            onSubmit={async (pw) => {
              try {
                const plain = await decryptPackage(pwPrompt.data, pw);
                const f = pwPrompt;
                setPwPrompt(null);
                await loadFile({ ...f, data: plain }, pw);
                return null;
              } catch (e) {
                return e instanceof WrongPasswordError ? t('La contraseña no es correcta.') : (e as Error).message;
              }
            }}
          />
        )}
        {spellTarget && <SpellMenu ctl={ctl} target={spellTarget} onClose={() => setSpellTarget(null)} />}
        {controlPos !== null && <ControlPopup ctl={ctl} pos={controlPos} onClose={() => setControlPos(null)} />}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/bmp,image/webp"
          hidden
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            const reader = new FileReader();
            reader.onload = () => {
              const src = String(reader.result);
              const img = new Image();
              img.onload = () => {
                const cur = ctl.page;
                const max = ptToPx(cur.width - cur.marginLeft - cur.marginRight);
                const k = Math.min(1, max / img.naturalWidth);
                const v = ctl.view;
                if (!v) return;
                v.dispatch(v.state.tr.replaceSelectionWith(nodeTypes.image!.create({ src, alt: f.name.replace(/\.[^.]+$/, ''), width: Math.round(img.naturalWidth * k), height: Math.round(img.naturalHeight * k) })).scrollIntoView());
                v.focus();
              };
              img.onerror = () => window.alert(t('No se pudo leer la imagen.'));
              img.src = src;
            };
            reader.readAsDataURL(f);
          }}
        />
        <DialogHost ui={ui} kind={dialog} arg={dialogArg} onClose={() => setDialog(null)} />
      </div>
    </AppFrame>
  );
}

void helpTab;
