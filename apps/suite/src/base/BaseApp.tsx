import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import { AppFrame, CommandRegistry, coreCommands, t, useLocale, type BackstageEntry } from '@suitenova/core-ui';
import { Workbook, formatValue, isDateFormat, type Scalar } from '@suitenova/calc-engine';
import { parseCsv, toCsv } from '@suitenova/base-core';
import { readXlsx } from '@suitenova/xlsx-io';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { pickAndRead, readPath, saveBytes } from '../fileio';
import { addRecent } from '../recents';
import type { ModuleInfo } from '../modules';
import { backstageEntries, fileCommands } from '../options';
import { closeThisWindow, isTauri, openModuleWindow } from '../platform';
import { baseCommands, type BaseDialog, type BaseUI } from './commands';
import { BaseCtl, type ObjKind } from './ctl';
import { MacroEditor } from './MacroEditor';
import { ModuleEditor } from './ModuleEditor';
import { TableDatasheet } from './Datasheet';
import { baseTabs } from './ribbonDef';
import { TableDesign } from './TableDesign';
import { QueryView } from './QueryView';
import { RelationsView } from './RelationsView';
import { FormView, ReportView, reportHtml } from './Views';
import './messages';
import './base.css';

const DB_FILTERS = [{ name: 'Base de datos SQLite', extensions: ['sqlite', 'sqlite3', 'db'] }];
const AUTOSAVE_MS = 1500;
const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Datos';

type NavKind = ObjKind;

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Dialog open modalType="modal" onOpenChange={(_e, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 520, width: '92vw' }}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>{children}</DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={onClose}>
              {t('Cerrar')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl+N / O / S', 'Nuevo / Abrir / Guardar'],
  ['Ctrl+Intro / F5', 'Ejecutar la consulta'],
  ['Ctrl+W', 'Cerrar pestaña'],
  ['Esc, luego Tab', 'Salir del editor de código'],
  ['Ctrl+Z / Ctrl+Y', 'Deshacer / Rehacer los cambios de datos'],
  ['Flechas / Tab', 'Moverse por la hoja de datos'],
  ['F2 / Intro / escribir', 'Editar la celda'],
  ['Esc', 'Cancelar la edición'],
  ['Mayús+clic en el encabezado de fila', 'Seleccionar varios registros'],
  ['F2 en el panel', 'Cambiar nombre del objeto'],
  ['Alt', 'Atajos de la cinta (KeyTips)'],
];

function NavPane({ ctl, selected, setSelected, renaming, setRenaming }: { ctl: BaseCtl; selected: { kind: NavKind; name: string } | null; setSelected: (s: { kind: NavKind; name: string } | null) => void; renaming: boolean; setRenaming: (b: boolean) => void }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const db = ctl.db;
  const [text, setText] = useState('');
  const groups: { kind: NavKind; label: string; names: string[] }[] = db
    ? [
        { kind: 'table', label: 'Tablas', names: db.tableNames() },
        { kind: 'query', label: 'Consultas', names: db.objects('query') },
        { kind: 'form', label: 'Formularios', names: db.objects('form') },
        { kind: 'report', label: 'Informes', names: db.objects('report') },
        { kind: 'macro', label: 'Macros', names: db.objects('macro') },
        { kind: 'module', label: 'Módulos', names: db.objects('module') },
      ]
    : [];
  const f = ctl.navFilter.trim().toLowerCase();
  const open = (k: NavKind, n: string) => (k === 'table' ? ctl.openTable(n) : k === 'query' ? ctl.openQuery(n) : k === 'form' ? ctl.openForm(n) : k === 'macro' ? ctl.openMacro(n) : k === 'module' ? ctl.openModule(n) : ctl.openReport(n));
  const commit = () => {
    if (selected && text.trim() && text.trim() !== selected.name) {
      try {
        ctl.rename(selected.kind, selected.name, text.trim());
        setSelected({ kind: selected.kind, name: text.trim() });
      } catch (e) {
        window.alert((e as Error).message);
      }
    }
    setRenaming(false);
  };
  return (
    <nav className="bs-nav-pane" aria-label={t('Todos los objetos')}>
      <input type="search" aria-label={t('Buscar objetos')} placeholder={t('Buscar…')} value={ctl.navFilter} onChange={(e) => { ctl.navFilter = e.target.value; ctl.touch(); }} />
      {groups.map((g) => (
        <section key={g.kind} aria-label={t(g.label)}>
          <h3>
            {t(g.label)} <span>{g.names.length}</span>
          </h3>
          <ul>
            {g.names
              .filter((n) => !f || n.toLowerCase().includes(f))
              .map((n) => {
                const sel = selected?.kind === g.kind && selected.name === n;
                return (
                  <li key={n}>
                    {sel && renaming ? (
                      <input
                        autoFocus
                        aria-label={t('Nombre nuevo')}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onBlur={commit}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') commit();
                          else if (e.key === 'Escape') setRenaming(false);
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className={sel ? 'is-selected' : ''}
                        aria-pressed={sel}
                        onClick={() => setSelected({ kind: g.kind, name: n })}
                        onDoubleClick={() => open(g.kind, n)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') open(g.kind, n);
                          else if (e.key === 'F2') {
                            setSelected({ kind: g.kind, name: n });
                            setText(n);
                            setRenaming(true);
                          }
                        }}
                      >
                        {n}
                      </button>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

function workbookTables(wb: Workbook): { name: string; rows: string[][] }[] {
  const out: { name: string; rows: string[][] }[] = [];
  for (const s of wb.sheets) {
    if (s.maxRow < 0) continue;
    const rows: string[][] = [];
    for (let r = 0; r <= s.maxRow; r++) {
      const line: string[] = [];
      for (let c = 0; c <= s.maxCol; c++) {
        const cell = s.cells.get(r * 16384 + c);
        const v: Scalar = cell?.value ?? null;
        const fmt = cell ? wb.styles.get(cell.style ?? 0).numFmt : undefined;
        if (v === null || v === undefined) line.push('');
        else if (typeof v === 'number' && isDateFormat(fmt)) line.push(formatValue(v, Number.isInteger(v) ? 'yyyy-mm-dd' : 'yyyy-mm-dd hh:mm:ss', 'en').text);
        else if (typeof v === 'object') line.push(String((v as { code?: string }).code ?? ''));
        else if (typeof v === 'boolean') line.push(v ? 'true' : 'false');
        else line.push(String(v));
      }
      rows.push(line);
    }
    out.push({ name: s.name, rows });
  }
  return out;
}

export function BaseApp({ module }: { module: ModuleInfo }) {
  const registry = useMemo(() => new CommandRegistry(), []);
  const ctl = useMemo(() => new BaseCtl(), []);
  const [dialog, setDialog] = useState<BaseDialog | null>(null);
  const [selected, setSelected] = useState<{ kind: NavKind; name: string } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [saveState, setSaveState] = useState('');
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useLocale();
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);

  useEffect(() => {
    void ctl.init(() => wasmUrl);
  }, [ctl]);

  const saveNow = useCallback(
    async (saveAs: boolean, silent = false) => {
      if (!ctl.db) return;
      try {
        const base = (ctl.fileName ?? 'Base de datos1').replace(/\.[^.]+$/, '');
        const keep = !saveAs && ctl.filePath && /\.(sqlite3?|db)$/i.test(ctl.filePath) ? ctl.filePath : null;
        const saved = await saveBytes(`${clean(base)}.sqlite`, ctl.db.export(), DB_FILTERS, keep);
        if (saved) {
          ctl.markSaved(saved.name, saved.path);
          if (!silent) addRecent({ path: saved.path, name: saved.name, app: 'base' });
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
        ctl.openBytes(file.data, file.name, file.path);
        addRecent({ path: file.path, name: file.name, app: 'base' });
      } catch (e) {
        window.alert(t('No se pudo abrir "{name}": {error}', { name: file.name, error: (e as Error).message }));
      }
    },
    [ctl],
  );

  const ui: BaseUI = useMemo(
    () => ({
      ctl,
      openDialog: (k) => setDialog(k),
      newWindow: () => void openModuleWindow('base', module.name),
      open: async () => {
        if (ctl.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Abrir otro archivo y descartarlos?'))) return;
        const f = await pickAndRead(DB_FILTERS).catch((e) => {
          window.alert(String(e));
          return null;
        });
        if (f) await loadFile(f);
      },
      save: (as) => saveNow(as),
      importCsv: async () => {
        const f = await pickAndRead([{ name: 'Texto delimitado', extensions: ['csv', 'tsv', 'txt'] }]).catch(() => null);
        if (!f || !ctl.db) return;
        try {
          const rows = parseCsv(new TextDecoder('utf-8').decode(f.data));
          const r = ctl.db.importRows(f.name.replace(/\.[^.]+$/, ''), rows);
          ctl.touch();
          ctl.openTable(r.table);
          setSaveState(t('Se importaron {n} registros en "{table}".', { n: r.rows, table: r.table }));
        } catch (e) {
          window.alert(t('No se pudo importar: {error}', { error: (e as Error).message }));
        }
      },
      importXlsx: async () => {
        const f = await pickAndRead([{ name: 'Libro de Excel', extensions: ['xlsx'] }]).catch(() => null);
        if (!f || !ctl.db) return;
        try {
          const { workbook } = await readXlsx(f.data);
          const sheets = workbookTables(workbook);
          if (!sheets.length) throw new Error(t('El libro no tiene datos.'));
          let first = '';
          let total = 0;
          for (const s of sheets) {
            const r = ctl.db.importRows(s.name, s.rows);
            first ||= r.table;
            total += r.rows;
          }
          ctl.touch();
          ctl.openTable(first);
          setSaveState(t('Se importaron {n} registros de {s} hojas.', { n: total, s: sheets.length }));
        } catch (e) {
          window.alert(t('No se pudo importar: {error}', { error: (e as Error).message }));
        }
      },
      exportCsv: async () => {
        const tab = ctl.tab;
        if (!tab || !ctl.db) return;
        let columns: string[];
        let rows: unknown[][];
        if (tab.kind === 'table') {
          const r = ctl.db.execute(`SELECT * FROM "${tab.name.replace(/"/g, '""')}"`);
          columns = r.columns;
          rows = r.rows;
        } else {
          const r = ctl.results.get(tab.id);
          if (!r) return;
          columns = r.columns;
          rows = r.rows;
        }
        await saveBytes(`${clean(tab.name)}.csv`, new TextEncoder().encode('﻿' + toCsv(columns, rows)), [{ name: 'CSV', extensions: ['csv'] }]);
      },
      startRename: () => setRenaming(true),
      selected: () => selectedRef.current,
      printReport: () => {
        const tab = ctl.tab;
        const def = tab && ctl.reports.get(tab.id);
        if (!def) return;
        const frame = document.createElement('iframe');
        frame.setAttribute('aria-hidden', 'true');
        frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
        document.body.appendChild(frame);
        frame.contentDocument!.open();
        frame.contentDocument!.write(reportHtml(ctl, def));
        frame.contentDocument!.close();
        setTimeout(() => {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
          setTimeout(() => frame.remove(), 60_000);
        }, 300);
      },
      close: () => {
        if (ctl.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Cerrar y descartarlos?'))) return;
        void closeThisWindow();
      },
    }),
    [ctl, loadFile, saveNow, module.name],
  );

  useEffect(() => {
    const offs = [registry.registerAll(coreCommands), registry.registerAll(baseCommands(ui))];
    fileCommands(registry);
    const unsub = ctl.subscribe(() => registry.invalidate());
    return () => {
      offs.forEach((o) => o());
      unsub();
    };
  }, [registry, ui, ctl]);
  useEffect(() => registry.invalidate(), [registry, selected]);

  useEffect(() => {
    const path = new URLSearchParams(location.search).get('open');
    if (!path || !isTauri() || ctl.loading) return;
    readPath(path).then(loadFile, (e) => window.alert(t('No se pudo abrir "{name}": {error}', { name: path, error: String(e) })));
  }, [loadFile, ctl.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __novaBase: unknown }).__novaBase = {
      ctl,
      load: (b64: string, name: string) => {
        const bin = atob(b64);
        const data = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
        return loadFile({ name, path: null, data });
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
          if (ctl.dirty && !ctl.filePath && !window.confirm(t('Hay cambios sin guardar. ¿Cerrar y descartarlos?'))) e.preventDefault();
        });
      });
    }
    return () => {
      window.removeEventListener('beforeunload', before);
      unlisten?.();
    };
  }, [ctl]);

  const tabs = useMemo(() => baseTabs(), []);
  const backstage: BackstageEntry[] = useMemo(() => {
    const pages = backstageEntries(module.name).filter((e) => e.kind === 'page');
    return [
      { kind: 'command', command: 'base.new' },
      { kind: 'command', command: 'base.open' },
      { kind: 'separator' },
      { kind: 'command', command: 'base.save' },
      { kind: 'command', command: 'base.saveAs' },
      { kind: 'command', command: 'base.print' },
      { kind: 'separator' },
      ...pages,
      { kind: 'command', command: 'base.about' },
      { kind: 'command', command: 'file.close' },
    ] as BackstageEntry[];
  }, [module.name]);

  const tab = ctl.tab;
  const content = () => {
    if (ctl.loading) return <div className="bs-empty">{t('Cargando el motor de bases de datos…')}</div>;
    if (ctl.error) return <div className="bs-error" role="alert">{ctl.error}</div>;
    if (!tab) return <div className="bs-empty">{t('Abra una tabla, consulta, formulario o informe del panel izquierdo, o cree uno nuevo desde la pestaña Crear.')}</div>;
    switch (tab.kind) {
      case 'table':
        return <TableDatasheet key={tab.id} ctl={ctl} table={tab.name} />;
      case 'design':
        return <TableDesign key={`${tab.id}:${ctl.epoch}`} ctl={ctl} tab={tab} />;
      case 'query':
        return <QueryView key={tab.id} ctl={ctl} tab={tab} />;
      case 'form':
        return <FormView key={tab.id} ctl={ctl} tab={tab} />;
      case 'report':
        return <ReportView key={tab.id} ctl={ctl} tab={tab} />;
      case 'relations':
        return <RelationsView key={tab.id} ctl={ctl} />;
      case 'macro':
        return <MacroEditor key={tab.id} ctl={ctl} tab={tab} />;
      case 'module':
        return <ModuleEditor key={tab.id} ctl={ctl} tab={tab} />;
    }
  };

  const kindIcon: Record<string, string> = { table: '▦', design: '✎', query: '⌕', form: '▤', report: '▥', relations: '⇄', macro: '⚙', module: '‹›' };

  return (
    <AppFrame
      appId={module.id}
      appName={module.name}
      registry={registry}
      tabs={tabs}
      qat={['base.save', 'base.undo', 'base.redo']}
      docTitle={ctl.docTitle}
      backstage={backstage}
      statusLeft={
        <>
          <span>{ctl.db ? t('{n} tablas', { n: ctl.db.tableNames().length }) : t('Cargando…')}</span>
          {(ctl.notice || saveState) && <span aria-live="polite">{ctl.notice || saveState}</span>}
          {ctl.db?.undoUnavailable && <span>{t('Deshacer no disponible: la base de datos es demasiado grande.')}</span>}
        </>
      }
      contentFill
    >
      <div className="bs-app">
        <NavPane ctl={ctl} selected={selected} setSelected={setSelected} renaming={renaming} setRenaming={setRenaming} />
        <div className="bs-main">
          <div className="bs-tabs" role="tablist" aria-label={t('Objetos abiertos')}>
            {ctl.tabs.map((x) => (
              <div key={x.id} role="tab" aria-selected={x.id === ctl.active} className={`bs-tab${x.id === ctl.active ? ' is-active' : ''}`} onClick={() => ctl.activate(x.id)}>
                <span aria-hidden="true">{kindIcon[x.kind]}</span> {x.kind === 'relations' ? t(x.name) : x.name}
                <button type="button" aria-label={t('Cerrar {name}', { name: x.name })} onClick={(e) => { e.stopPropagation(); ctl.close(x.id); }}>
                  ×
                </button>
              </div>
            ))}
          </div>
          {!ctl.contentEnabled && (
            <div className="bs-secbar" role="alert">
              <span>{t('ADVERTENCIA DE SEGURIDAD: se deshabilitó el contenido activo (macros, código y eventos de formularios) de este archivo.')}</span>
              <button type="button" className="bs-btn" onClick={() => ctl.enableContent()}>
                {t('Habilitar contenido')}
              </button>
            </div>
          )}
          <div className="bs-content">{content()}</div>
        </div>
        {dialog === 'about' && (
          <Modal title={t('Acerca de Nova Base')} onClose={() => setDialog(null)}>
            <p>Nova Base 0.0.2</p>
            <p>{t('Bases de datos libres (MPL-2.0) de SuiteNova sobre SQLite. Guarda en archivos .sqlite; no abre archivos de Access (.accdb, .mdb). Consulta docs/LIMITACIONES.md.')}</p>
          </Modal>
        )}
        {dialog === 'shortcuts' && (
          <Modal title={t('Atajos de teclado')} onClose={() => setDialog(null)}>
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
