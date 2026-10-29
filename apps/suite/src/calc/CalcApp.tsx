import { AppFrame, CommandRegistry, clampZoom, coreCommands, t, useCommandState, useCore, useLocale, useThemeMode, useSetting, SETTING_LOCALE, type BackstageEntry, type Locale } from '@suitenova/core-ui';
import { Workbook, filterCounts, formatRect, parseA1, type Scalar } from '@suitenova/calc-engine';
import { readXlsx, writeXlsx } from '@suitenova/xlsx-io';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { helpTab, zoomCommands } from '../common';
import { pickAndRead, readPath, saveBytes } from '../fileio';
import { addRecent } from '../recents';
import type { ModuleInfo } from '../modules';
import { backstageEntries, fileCommands } from '../options';
import { closeThisWindow, isTauri, openModuleWindow } from '../platform';
import { calcCommands, type CalcUI, type DialogKind } from './commands';
import { parseCsv, toCsv } from './csv';
import { DialogHost } from './dialogs';
import { CalcDoc } from './doc';
import { FilterMenu } from './FilterMenu';
import { FormulaBar } from './FormulaBar';
import { GridView } from './GridView';
import './icons';
import './messages';
import './messages-cf';
import './messages-objects';
import { calcTabs } from './ribbonDef';
import { SheetTabs } from './SheetTabs';
import { ListMenu } from './ObjectLayer';
import { PivotPane } from './dlg-pivot';
import { imageSize, pickImage } from './imagePick';
import './calc.css';
import './calc-objects.css';

const XLSX_FILTERS = [{ name: 'Libro de Excel', extensions: ['xlsx'] }];
const OPEN_FILTERS = [
  { name: 'Hojas de cálculo', extensions: ['xlsx', 'csv', 'tsv', 'txt'] },
  { name: 'Libro de Excel', extensions: ['xlsx'] },
  { name: 'Texto separado por comas', extensions: ['csv', 'tsv', 'txt'] },
];
const CSV_FILTERS = [{ name: 'CSV (delimitado por comas)', extensions: ['csv'] }];

type MenuTarget = 'cell' | 'col' | 'row';
const MENUS: Record<MenuTarget, (string | '-')[]> = {
  cell: ['calc.cut', 'calc.copy', 'calc.paste', 'calc.pasteValues', '-', 'calc.insertRows', 'calc.insertCols', 'calc.deleteRows', 'calc.deleteCols', 'calc.clearContents', '-', 'calc.sortAsc', 'calc.sortDesc', '-', 'calc.formatCells'],
  col: ['calc.cut', 'calc.copy', 'calc.paste', '-', 'calc.insertCols', 'calc.deleteCols', 'calc.clearContents', '-', 'calc.hideCols', 'calc.showCols', 'calc.colWidth', 'calc.autoFitCols'],
  row: ['calc.cut', 'calc.copy', 'calc.paste', '-', 'calc.insertRows', 'calc.deleteRows', 'calc.clearContents', '-', 'calc.hideRows', 'calc.showRows', 'calc.rowHeight', 'calc.autoFitRows'],
};

function MenuEntry({ id, onDone }: { id: string; onDone: () => void }) {
  const { registry } = useCore();
  const { def, enabled, shortcut } = useCommandState(id);
  if (!def) return null;
  return (
    <li
      role="menuitem"
      aria-disabled={!enabled}
      className={enabled ? '' : 'is-disabled'}
      onClick={() => {
        if (!enabled) return;
        onDone();
        registry.run(id);
      }}
    >
      <span>{t(def.label)}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </li>
  );
}

function Status({ doc }: { doc: CalcDoc }) {
  useSyncExternalStore(doc.subscribe, doc.getVersion);
  const stats = doc.selectionStats();
  const counts = doc.hasColumnFilters ? filterCounts(doc.sheet) : null;
  const fmt = (n: number) => new Intl.NumberFormat(doc.locale === 'es' ? 'es-ES' : 'en-US', { maximumFractionDigits: 6 }).format(n);
  return (
    <>
      <span>{doc.notice ?? (doc.edit ? (doc.edit.mode === 'edit' ? t('Modificar') : t('Introducir')) : counts ? t('{shown} de {total} registros encontrados', counts) : t('Listo'))}</span>
      {stats && (
        <>
          {stats.numeric > 0 && <span>{t('Promedio')}: {fmt(stats.avg)}</span>}
          <span>{t('Recuento')}: {stats.count}</span>
          {stats.numeric > 0 && <span>{t('Suma')}: {fmt(stats.sum)}</span>}
        </>
      )}
    </>
  );
}

export function CalcApp({ module }: { module: ModuleInfo }) {
  const registry = useMemo(() => new CommandRegistry(), []);
  const doc = useMemo(() => new CalcDoc(), []);
  const [zoom, setZoom] = useState(100);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [dialogArg, setDialogArg] = useState<unknown>(undefined);
  const [filterMenu, setFilterMenu] = useState<{ col: number; x: number; y: number } | null>(null);
  const [listMenu, setListMenu] = useState<{ row: number; col: number; x: number; y: number; width: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; target: MenuTarget } | null>(null);
  const [localeSetting] = useSetting<Locale>(SETTING_LOCALE, 'es');
  useLocale();
  const mode = useThemeMode();
  const dark = mode === 'dark';
  useSyncExternalStore(doc.subscribe, doc.getVersion);

  // the formula language follows the interface language
  useEffect(() => {
    doc.locale = localeSetting === 'en' ? 'en' : 'es';
    doc.touch();
  }, [doc, localeSetting]);

  const loadFile = useCallback(
    async (file: { name: string; path: string | null; data: Uint8Array }) => {
      const lower = file.name.toLowerCase();
      try {
        if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) {
          const text = new TextDecoder('utf-8').decode(file.data);
          const rows = parseCsv(text, lower.endsWith('.tsv') ? '\t' : undefined);
          const wb = new Workbook();
          const sheetId = wb.sheets[0]!.id;
          wb.renameSheet(sheetId, file.name.replace(/\.[^.]+$/, '').slice(0, 31) || 'Hoja1');
          wb.transact(() => {
            rows.forEach((row, r) => {
              row.forEach((v, c) => {
                if (v === '') return;
                wb.setInput(sheetId, r, c, v.startsWith('=') ? `'${v}` : v);
              });
            });
          });
          doc.load(wb, file.name.replace(/\.[^.]+$/, '') + '.xlsx', null);
          return;
        }
        const { workbook, warnings } = await readXlsx(file.data);
        doc.load(workbook, file.name, file.path);
        addRecent({ path: file.path, name: file.name, app: 'calc' });
        if (warnings.length) window.alert(t('El archivo se abrió, pero:') + '\n\n' + [...new Set(warnings)].slice(0, 12).join('\n'));
      } catch (e) {
        window.alert(t('No se pudo abrir "{name}": {error}', { name: file.name, error: (e as Error).message }));
      }
    },
    [doc],
  );

  const ui: CalcUI = useMemo(
    () => ({
      doc,
      openDialog: (k, arg) => {
        setDialogArg(arg);
        setDialog(k);
      },
      getZoom: () => zoomRef.current,
      setZoom: (z) => setZoom(clampZoom(z)),
      newWindow: () => void openModuleWindow('calc', module.name),
      open: async () => {
        if (doc.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Abrir otro archivo y descartarlos?'))) return;
        const f = await pickAndRead(OPEN_FILTERS).catch((e) => {
          window.alert(String(e));
          return null;
        });
        if (f) await loadFile(f);
      },
      save: async (saveAs) => {
        doc.commitIfEditing();
        try {
          const bytes = await writeXlsx(doc.wb);
          const base = (doc.fileName ?? 'Libro1').replace(/\.[^.]+$/, '');
          const keepPath = !saveAs && doc.filePath?.toLowerCase().endsWith('.xlsx') ? doc.filePath : null;
          const saved = await saveBytes(`${base}.xlsx`, bytes, XLSX_FILTERS, keepPath);
          if (saved) {
            doc.markSaved(saved.name, saved.path);
            addRecent({ path: saved.path, name: saved.name, app: 'calc' });
          }
        } catch (e) {
          window.alert(t('No se pudo guardar: {error}', { error: (e as Error).message }));
        }
      },
      exportCsv: async () => {
        doc.commitIfEditing();
        const text = toCsv(doc.wb, doc.activeSheetId, { locale: doc.locale, rawValues: false });
        const bytes = new TextEncoder().encode('﻿' + text);
        await saveBytes(`${doc.sheet.name}.csv`, bytes, CSV_FILTERS);
      },
      close: () => {
        if (doc.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Cerrar y descartarlos?'))) return;
        void closeThisWindow();
      },
      openUrl: (url) => {
        window.open(url, '_blank', 'noopener,noreferrer');
      },
      insertPicture: async () => {
        try {
          const img = await pickImage();
          if (img) doc.x.insertImage(img.mime, img.data, img.width, img.height, img.name);
        } catch (e) {
          window.alert((e as Error).message);
        }
      },
      restorePictureSize: async () => {
        const im = doc.sheet.images.find((i) => i.id === doc.x.selectedImage);
        const media = im ? doc.wb.media.get(im.media) : undefined;
        if (!im || !media) return;
        try {
          const size = await imageSize(media.data, media.mime);
          doc.x.updateImage(im.id, { width: size.width, height: size.height }, 'Tamaño original de la imagen');
        } catch (e) {
          window.alert((e as Error).message);
        }
      },
    }),
    [doc, loadFile, module.name],
  );

  // commands
  useEffect(() => {
    const offs = [
      registry.registerAll(coreCommands),
      registry.registerAll(zoomCommands(() => zoomRef.current, (z) => setZoom(clampZoom(z)), clampZoom).map((c) => ({ ...c, shortcut: undefined, hint: c.id === 'zoom.in' ? 'Ctrl+rueda' : undefined }))),
      registry.registerAll(calcCommands(ui)),
    ];
    fileCommands(registry);
    const unsub = doc.subscribe(() => registry.invalidate());
    return () => {
      offs.forEach((o) => o());
      unsub();
    };
  }, [registry, ui, doc]);
  useEffect(() => registry.invalidate(), [registry, zoom]);

  // opened from the hub's recent list
  useEffect(() => {
    const path = new URLSearchParams(location.search).get('open');
    if (!path || !isTauri()) return;
    readPath(path).then(loadFile, (e) => window.alert(t('No se pudo abrir "{name}": {error}', { name: path, error: String(e) })));
  }, [loadFile]);

  // test hook used by scripts/e2e-calc.mjs (development only)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __novaCalc: unknown }).__novaCalc = {
      text: (addr: string) => {
        const p = parseA1(addr)!;
        return doc.display(doc.activeSheetId, p.row, p.col).text;
      },
      colWidth: (c: number) => doc.wb.colWidth(doc.activeSheetId, c),
      doc,
    };
  }, [doc]);

  // global events from child widgets
  useEffect(() => {
    const openFn = () => setDialog('function');
    window.addEventListener('nova:insert-function', openFn);
    return () => window.removeEventListener('nova:insert-function', openFn);
  }, []);

  // warn about unsaved changes when the window is closed
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (doc.dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', before);
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
        unlisten = await getCurrentWindow().onCloseRequested((e) => {
          if (doc.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Cerrar y descartarlos?'))) e.preventDefault();
        });
      });
    }
    return () => {
      window.removeEventListener('beforeunload', before);
      unlisten?.();
    };
  }, [doc]);

  // close menus on outside click
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  const chartSelected = !!doc.selectedChart && !!doc.chartById(doc.selectedChart);
  const active = doc.sel.active;
  const flags = {
    chart: chartSelected,
    table: !!doc.sheet.tables.some((tb) => active.row >= tb.ref.r1 && active.row <= tb.ref.r2 && active.col >= tb.ref.c1 && active.col <= tb.ref.c2) && !doc.x.selectedImage && !doc.x.selectedSlicer && !chartSelected,
    pivot: !!doc.wb.pivotAt(doc.activeSheetId, active.row, active.col) && !chartSelected,
    sparkline: doc.sheet.sparklines.some((g) => g.items.some((i) => i.row === active.row && i.col === active.col)),
    picture: !!doc.x.selectedImage,
    slicer: !!doc.x.selectedSlicer,
  };
  const flagKey = Object.values(flags).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tabs = useMemo(() => calcTabs(ui, flags), [ui, flagKey]);
  const backstage: BackstageEntry[] = useMemo(() => {
    const base = backstageEntries(module.name);
    const pages = base.filter((e) => e.kind === 'page');
    return [
      { kind: 'command', command: 'calc.new' },
      { kind: 'command', command: 'calc.open' },
      { kind: 'separator' },
      { kind: 'command', command: 'calc.save' },
      { kind: 'command', command: 'calc.saveAs' },
      { kind: 'command', command: 'calc.exportCsv' },
      { kind: 'separator' },
      ...pages,
      { kind: 'command', command: 'calc.about' },
      { kind: 'command', command: 'file.close' },
    ] as BackstageEntry[];
  }, [module.name]);

  return (
    <AppFrame
      appId={module.id}
      appName={module.name}
      registry={registry}
      tabs={tabs}
      qat={['calc.save', 'calc.undo', 'calc.redo']}
      docTitle={doc.title}
      backstage={backstage}
      zoom={{ value: zoom, onChange: (z) => setZoom(clampZoom(z)), min: 10, max: 400 }}
      statusLeft={<Status doc={doc} />}
      contentFill
    >
      <div className="calc">
        {!doc.contentEnabled && doc.wb.macros.length > 0 && (
          <div className="calc-secbar" role="alert">
            <span>
              <strong>{t('ADVERTENCIA DE SEGURIDAD:')}</strong> {t('se deshabilitó el contenido activo (macros y funciones de código) de este archivo.')}
            </span>
            <button type="button" onClick={() => doc.enableContent()}>
              {t('Habilitar contenido')}
            </button>
          </div>
        )}
        <FormulaBar doc={doc} />
        <div className="calc-body">
          <div className="calc-main">
            <GridView
              doc={doc}
              zoom={zoom / 100}
              dark={dark}
              onZoomChange={(z) => setZoom(clampZoom(z))}
              onContextMenu={(x, y, target) => setMenu({ x, y, target })}
              onFilterButton={(col, x, y) => setFilterMenu({ col, x, y })}
              onListButton={(row, col, x, y, width) => setListMenu({ row, col, x, y, width })}
              onFollowLink={(link) => {
                const err = doc.x.followHyperlink(link, ui.openUrl);
                if (err) window.alert(err);
              }}
            />
          </div>
          {doc.x.pivotPane && <PivotPane ui={ui} onDialog={(kind, arg) => ui.openDialog(kind, arg)} />}
        </div>
        <SheetTabs doc={doc} />
      </div>
      {menu && (
        <ul className="calc-menu" style={{ left: Math.min(menu.x, window.innerWidth - 260), top: Math.min(menu.y, window.innerHeight - 380) }} role="menu" onPointerDown={(e) => e.stopPropagation()}>
          {MENUS[menu.target].map((id, i) => (id === '-' ? <li key={i} role="separator" /> : <MenuEntry key={id} id={id} onDone={() => setMenu(null)} />))}
        </ul>
      )}
      {listMenu && <ListMenu doc={doc} row={listMenu.row} col={listMenu.col} x={listMenu.x} y={listMenu.y} width={listMenu.width} onClose={() => setListMenu(null)} />}
      {filterMenu && (
        <FilterMenu doc={doc} col={filterMenu.col} x={filterMenu.x} y={filterMenu.y} onClose={() => setFilterMenu(null)} onCustom={() => ui.openDialog('customFilter', filterMenu.col)} />
      )}
      <DialogHost ui={ui} registry={registry} kind={dialog} arg={dialogArg} onClose={() => setDialog(null)} />
    </AppFrame>
  );
}

void formatRect;
void helpTab;
export type { Scalar };
