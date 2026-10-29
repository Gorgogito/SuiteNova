import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import { AppFrame, CommandRegistry, clampZoom, coreCommands, t, useLocale, type BackstageEntry } from '@suitenova/core-ui';
import { buildReport, exportCsv, exportMspdi, fingerprint, formatDuration, importMspdi, liveSubprojects, parseProject, refreshSubproject, reportToCsv, reportToHtml, serializeProject, dayOfTime, nowIn, type Project } from '@suitenova/plan-core';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { zoomCommands } from '../common';
import { pickAndRead, readPath, saveBytes } from '../fileio';
import type { ModuleInfo } from '../modules';
import { backstageEntries, fileCommands } from '../options';
import { closeThisWindow, isTauri, openModuleWindow } from '../platform';
import { addRecent } from '../recents';
import { planCommands, type PlanDialog, type PlanUI } from './commands';
import { PlanCtl, fmtDate } from './ctl';
import { cellText, columnDef } from './columns';
import { BaselinesDialog, CalendarDialog, ColumnsDialog, CustomFieldsDialog, FiltersDialog, GroupsDialog, LevelDialog, ProjectDialog, SplitDialog, TaskDialog } from './Dialogs';
import { NetworkView, ReportsView, ResourceGraph, ResourceSheet, UsageView } from './Views';
import { Gantt, type GanttHandle } from './Gantt';
import './icons';
import './messages';
import { planTabs } from './ribbonDef';
import './plan.css';

const PLAN_FILTERS = [{ name: 'Proyecto de Nova Plan', extensions: ['novaplan'] }];
// .mpp is listed so that choosing one explains why it cannot be read instead of hiding the file
const OPEN_FILTERS = [{ name: 'Proyectos', extensions: ['novaplan', 'xml', 'mpp'] }];
const AUTOSAVE_MS = 1500;
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Proyecto';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const SHORTCUTS: [string, string][] = [
  ['Ctrl+N / O / S', 'Nuevo / Abrir / Guardar'],
  ['Ctrl+Z / Y', 'Deshacer / Rehacer'],
  ['Ctrl+Alt+N', 'Tarea nueva'],
  ['Flechas / Mayús+flechas', 'Moverse por la tabla / seleccionar varias filas'],
  ['Enter o F2', 'Editar la celda activa (Esc cancela)'],
  ['Mayús+F2', 'Información de la tarea'],
  ['Ctrl+F2 / Ctrl+Mayús+F2', 'Vincular / desvincular tareas seleccionadas'],
  ['Alt+Mayús+flechas', 'Sangrar, anular sangría y mover la tarea'],
  ['Ctrl+Supr', 'Eliminar tarea'],
  ['Alt', 'Atajos de la cinta (KeyTips)'],
];

/** A standalone page with the task table and the Gantt chart, for printing or saving as PDF. */
function buildPrintHtml(ctl: PlanCtl, svg: SVGSVGElement | null): string {
  const ctx = ctl.ctx;
  const cols = ctl.columns.map((id) => columnDef(ctl.project, id)).filter((c): c is NonNullable<typeof c> => !!c);
  const rows = ctx
    ? ctl
        .visibleRows()
        .map((i) => {
          const task = ctl.project.tasks[i]!;
          const st = ctx.s.tasks[i];
          return `<tr${st?.summary ? ' class="s"' : ''}><td>${i + 1}</td>${cols.map((c) => `<td${c.id === 'name' ? ` style="padding-left:${4 + (task.outline - 1) * 12}px"` : ''}>${esc(cellText(ctx, i, c.id))}</td>`).join('')}</tr>`;
        })
        .join('')
    : '';
  const head = ['#', ...cols.map((c) => c.label)].map((h) => `<th>${esc(t(h))}</th>`).join('');
  const chart = svg ? svg.outerHTML.replace(/style="[^"]*"/g, '') : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(ctl.project.name)}</title><style>
@page{size:A4 landscape;margin:12mm}body{font:11px 'Segoe UI',Calibri,sans-serif;color:#111}h1{font-size:16px;margin:0 0 6px}
table{border-collapse:collapse;width:100%;margin-bottom:14px}th,td{border:1px solid #999;padding:2px 5px;text-align:left}th{background:#eee}tr.s td{font-weight:700}
svg{max-width:100%;height:auto}.pl-head-bg{fill:#eee}.pl-line,.pl-grid{stroke:#bbb;fill:none}.pl-htext{font:10px sans-serif;fill:#333}.pl-weekend{fill:#f3f3f3}.pl-rowbg{fill:none}
.pl-body{fill:#4a7bd0}.pl-bar.is-critical .pl-body{fill:#c0392b}.pl-progress{fill:#1b3d82}.pl-summary,.pl-milestone{fill:#222}.pl-arrow{stroke:#444;stroke-width:1}.pl-label{font:10px sans-serif}.pl-linkhandle,.pl-resize,.pl-progress-handle{display:none}.pl-today{stroke:#e00}.pl-baseline{fill:#999}.pl-splitline{stroke:#555;stroke-dasharray:3 2}
</style></head><body><h1>${esc(ctl.project.name)}</h1><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>${chart}</body></html>`;
}

const MPP_MESSAGE = 'Los archivos .mpp de Microsoft Project (formato binario propio) no se pueden abrir. En Project usa Archivo > Guardar como > "XML de Project (*.xml)" y abre ese archivo aquí.';

/** Read a project file: Nova Plan JSON or Microsoft Project XML. */
function parseAny(file: { name: string; data: Uint8Array }): { project: Project; warnings: string[]; xml: boolean } {
  // the .mpp container starts with the OLE signature D0 CF 11 E0
  const d = file.data;
  if (file.name.toLowerCase().endsWith('.mpp') || (d[0] === 0xd0 && d[1] === 0xcf && d[2] === 0x11 && d[3] === 0xe0)) throw new Error(t(MPP_MESSAGE));
  const text = new TextDecoder('utf-8').decode(d);
  if (/^\s*</.test(text)) {
    const r = importMspdi(text);
    return { project: r.project, warnings: r.warnings, xml: true };
  }
  return { project: parseProject(text), warnings: [], xml: false };
}

export function PlanApp({ module }: { module: ModuleInfo }) {
  const registry = useMemo(() => new CommandRegistry(), []);
  const ctl = useMemo(() => new PlanCtl(), []);
  const [zoom, setZoom] = useState(100);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [dialog, setDialog] = useState<PlanDialog | null>(null);
  const [saveState, setSaveState] = useState('');
  const gantt = useRef<GanttHandle>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  useLocale();
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);

  const saveNow = useCallback(
    async (saveAs: boolean, silent = false) => {
      try {
        const data = new TextEncoder().encode(serializeProject(ctl.project));
        const base = (ctl.fileName ?? ctl.project.name).replace(/\.[^.]+$/, '');
        const keep = !saveAs && ctl.filePath?.toLowerCase().endsWith('.novaplan') ? ctl.filePath : null;
        const saved = await saveBytes(`${safeName(base)}.novaplan`, data, PLAN_FILTERS, keep);
        if (saved) {
          ctl.markSaved(saved.name, saved.path);
          if (!silent) addRecent({ path: saved.path, name: saved.name, app: 'plan' });
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

  // subprojects with a live link are read again when their file has changed
  const syncing = useRef(false);
  const syncLive = useCallback(async () => {
    if (syncing.current || !isTauri()) return;
    const live = liveSubprojects(ctl.project);
    if (!live.length) return;
    syncing.current = true;
    try {
      const found: { id: string; name: string; project: Project; stamp: string }[] = [];
      for (const task of live) {
        try {
          const file = await readPath(task.subproject!.path!);
          const stamp = fingerprint(file.data);
          if (stamp !== task.subproject!.stamp) found.push({ id: task.id, name: task.subproject!.name, project: parseAny(file).project, stamp });
        } catch {
          // the file is not there (or not readable) right now: the copy stays as it is
        }
      }
      if (!found.length) return;
      let project = ctl.project;
      for (const f of found) if (project.tasks.some((x) => x.id === f.id)) project = refreshSubproject(project, f.id, f.project, f.stamp).project;
      if (project !== ctl.project) {
        ctl.commit(project);
        ctl.say(t('Subproyecto actualizado desde su archivo: {name}', { name: found.map((f) => f.name).join(', ') }));
      }
    } finally {
      syncing.current = false;
    }
  }, [ctl]);
  const syncRef = useRef(syncLive);
  syncRef.current = syncLive;

  const loadFile = useCallback(
    async (file: { name: string; path: string | null; data: Uint8Array }) => {
      try {
        const parsed = parseAny(file);
        if (parsed.xml) {
          ctl.load(parsed.project, null, null);
          ctl.dirty = true;
          ctl.touch();
          if (parsed.warnings.length) window.alert(t('El proyecto se importó, pero:') + '\n\n' + [...new Set(parsed.warnings)].slice(0, 12).join('\n'));
        } else {
          ctl.load(parsed.project, file.name, file.path);
          addRecent({ path: file.path, name: file.name, app: 'plan' });
          void syncRef.current();
        }
      } catch (e) {
        window.alert(t('No se pudo abrir "{name}": {error}', { name: file.name, error: (e as Error).message }));
      }
    },
    [ctl],
  );

  /** The report on screen as a page (and the data behind it). */
  const reportHtml = () => {
    const sched = ctl.sched;
    if (!sched || !sched.tasks.length) {
      ctl.say(t('No hay tareas que mostrar en el informe.'));
      return null;
    }
    const report = buildReport(ctl.reportId, ctl.project, sched, { baseline: ctl.baselineShown, now: nowIn(ctl.project.timeZone) });
    const page = reportToHtml(report, { project: ctl.project.name, lang: document.documentElement.lang || 'es', date: new Date().toLocaleDateString(), autoPrint: false }, t);
    return { report, page, title: report.title };
  };

  const ui: PlanUI = useMemo(
    () => ({
      ctl,
      openDialog: (k) => setDialog(k),
      newWindow: () => void openModuleWindow('plan', module.name),
      open: async () => {
        if (ctl.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Abrir otro archivo y descartarlos?'))) return;
        const f = await pickAndRead(OPEN_FILTERS).catch((e) => {
          window.alert(String(e));
          return null;
        });
        if (f) await loadFile(f);
      },
      save: (saveAs) => saveNow(saveAs),
      importMspdi: async () => {
        if (ctl.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Abrir otro archivo y descartarlos?'))) return;
        const f = await pickAndRead([{ name: 'Project XML', extensions: ['xml'] }]).catch(() => null);
        if (f) await loadFile(f);
      },
      exportMspdi: async () => {
        await saveBytes(`${safeName(ctl.project.name)}.xml`, new TextEncoder().encode(exportMspdi(ctl.project)), [{ name: 'Project XML', extensions: ['xml'] }]);
      },
      exportMspdiExtended: async () => {
        await saveBytes(`${safeName(ctl.project.name)}.xml`, new TextEncoder().encode(exportMspdi(ctl.project, { extendedFields: true })), [{ name: 'Project XML', extensions: ['xml'] }]);
      },
      exportReport: async (kind) => {
        const html = reportHtml();
        if (!html) return;
        const base = `${safeName(ctl.project.name)} - ${t(html.title)}`;
        if (kind === 'html') await saveBytes(`${base}.html`, new TextEncoder().encode(html.page), [{ name: 'HTML', extensions: ['html'] }]);
        else await saveBytes(`${base}.csv`, new TextEncoder().encode('\uFEFF' + reportToCsv(html.report, t)), [{ name: 'CSV', extensions: ['csv'] }]);
      },
      printReport: () => {
        const html = reportHtml();
        if (!html) return;
        frameRef.current?.remove();
        const frame = document.createElement('iframe');
        frame.setAttribute('aria-hidden', 'true');
        frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
        frame.srcdoc = html.page;
        frame.onload = () => {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        };
        document.body.appendChild(frame);
        frameRef.current = frame;
      },
      exportCsv: async () => {
        await saveBytes(`${safeName(ctl.project.name)}.csv`, new TextEncoder().encode(exportCsv(ctl.project)), [{ name: 'CSV', extensions: ['csv'] }]);
      },
      print: () => {
        // draw the whole chart (not just what is on screen), copy it, then go back to the windowed view
        ctl.fullRender = true;
        ctl.touch();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const html = buildPrintHtml(ctl, document.querySelector<SVGSVGElement>('svg.pl-svg'));
            ctl.fullRender = false;
            ctl.touch();
            frameRef.current?.remove();
            const frame = document.createElement('iframe');
            frame.setAttribute('aria-hidden', 'true');
            frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
            frame.srcdoc = html;
            frame.onload = () => {
              frame.contentWindow?.focus();
              frame.contentWindow?.print();
            };
            document.body.appendChild(frame);
            frameRef.current = frame;
          }),
        );
      },
      insertSubproject: async () => {
        const f = await pickAndRead([{ name: 'Proyectos', extensions: ['novaplan', 'xml'] }]).catch(() => null);
        if (!f) return;
        try {
          const parsed = parseAny(f);
          const warnings = [...parsed.warnings, ...ctl.insertSubproject(parsed.project, f.path, f.path ? fingerprint(f.data) : undefined)];
          ctl.say(warnings.length ? [...new Set(warnings)].slice(0, 3).join(' · ') : '');
        } catch (e) {
          ctl.say(t('No se pudo insertar "{name}": {error}', { name: f.name, error: (e as Error).message }));
        }
      },
      refreshSubproject: async () => {
        const task = ctl.activeTask;
        if (!task?.subproject?.path) return;
        try {
          const file = await readPath(task.subproject.path);
          const parsed = parseAny(file);
          const r = refreshSubproject(ctl.project, task.id, parsed.project, fingerprint(file.data));
          ctl.commit(r.project);
          ctl.say(r.warnings.length ? [...new Set(r.warnings)].slice(0, 3).join(' · ') : t('Subproyecto actualizado.'));
        } catch (e) {
          ctl.say(t('No se pudo actualizar el subproyecto: {error}', { error: (e as Error).message }));
        }
      },
      scrollToToday: () => gantt.current?.scrollToDay(dayOfTime(nowIn(ctl.project.timeZone))),
      scrollToSelection: () => gantt.current?.scrollToSelection(),
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
      registry.registerAll(zoomCommands(() => zoomRef.current, (z) => setZoom(clampZoom(z)), clampZoom).map((c) => ({ ...c, shortcut: c.id === 'zoom.reset' ? undefined : c.shortcut }))),
      registry.registerAll(planCommands(ui)),
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
    const again = () => {
      if (document.visibilityState !== 'hidden') void syncRef.current();
    };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, []);

  useEffect(() => {
    const path = new URLSearchParams(location.search).get('open');
    if (!path || !isTauri()) return;
    readPath(path).then(loadFile, (e) => window.alert(t('No se pudo abrir "{name}": {error}', { name: path, error: String(e) })));
  }, [loadFile]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __novaPlan: unknown }).__novaPlan = {
      text: (i: number, col: string) => (ctl.ctx ? cellText(ctl.ctx, i, col) : ''),
      ctl,
      load: (text: string, name: string) => loadFile({ name, path: null, data: new TextEncoder().encode(text) }),
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

  const tabs = useMemo(() => planTabs(), []);
  const backstage: BackstageEntry[] = useMemo(() => {
    const pages = backstageEntries(module.name).filter((e) => e.kind === 'page');
    return [
      { kind: 'command', command: 'plan.new' },
      { kind: 'command', command: 'plan.open' },
      { kind: 'separator' },
      { kind: 'command', command: 'plan.save' },
      { kind: 'command', command: 'plan.saveAs' },
      { kind: 'command', command: 'plan.import.mspdi' },
      { kind: 'command', command: 'plan.export.mspdi' },
      { kind: 'command', command: 'plan.export.csv' },
      { kind: 'command', command: 'plan.print' },
      { kind: 'separator' },
      ...pages,
      { kind: 'command', command: 'plan.about' },
      { kind: 'command', command: 'file.close' },
    ] as BackstageEntry[];
  }, [module.name]);

  const s = ctl.sched;
  const closeDialog = () => setDialog(null);
  const nTasks = ctl.project.tasks.length;

  return (
    <AppFrame
      appId={module.id}
      appName={module.name}
      registry={registry}
      tabs={tabs}
      qat={['plan.save', 'plan.undo', 'plan.redo']}
      docTitle={ctl.docTitle}
      backstage={backstage}
      zoom={{ value: zoom, onChange: (v) => setZoom(clampZoom(v)), min: 50, max: 300 }}
      statusLeft={
        <>
          <span>{nTasks === 1 ? t('1 tarea') : t('{n} tareas', { n: nTasks })}</span>
          {s && nTasks > 0 && (
            <span>
              {fmtDate(Math.floor(s.start / 1440))} – {fmtDate(Math.floor(s.finish / 1440))} · {formatDuration(s.duration, false, ctl.project)}
            </span>
          )}
          {s && s.overallocations.length > 0 && <span role="status">⚠ {t('Recursos sobreasignados')}: {new Set(s.overallocations.map((o) => o.resource)).size}</span>}
          {ctl.message && <span role="alert" className="pl-msg">{t(ctl.message)}</span>}
          {saveState && <span aria-live="polite">{saveState}</span>}
        </>
      }
      contentFill
    >
      <div className="pl-app">
        {nTasks === 0 && ctl.view === 'gantt' && (
          <div className="pl-hint">
            <p>{t('El proyecto está vacío.')}</p>
            <Button appearance="primary" onClick={() => ctl.add()}>
              {t('Añadir la primera tarea')}
            </Button>
          </div>
        )}
        {ctl.view === 'gantt' && nTasks > 0 && <Gantt ref={gantt} ctl={ctl} zoom={zoom} />}
        {ctl.view === 'network' && <NetworkView ctl={ctl} />}
        {ctl.view === 'taskUsage' && <UsageView ctl={ctl} mode="task" />}
        {ctl.view === 'resourceUsage' && <UsageView ctl={ctl} mode="resource" />}
        {ctl.view === 'resourceSheet' && <ResourceSheet ctl={ctl} />}
        {ctl.view === 'resourceGraph' && <ResourceGraph ctl={ctl} />}
        {ctl.view === 'reports' && <ReportsView ctl={ctl} />}
        <TaskDialog ctl={ctl} open={dialog === 'task'} onClose={closeDialog} />
        <ProjectDialog ctl={ctl} open={dialog === 'project'} onClose={closeDialog} />
        <LevelDialog ctl={ctl} open={dialog === 'level'} onClose={closeDialog} />
        <CalendarDialog ctl={ctl} open={dialog === 'calendars'} onClose={closeDialog} />
        <BaselinesDialog ctl={ctl} open={dialog === 'baselines'} onClose={closeDialog} />
        <SplitDialog ctl={ctl} open={dialog === 'split'} onClose={closeDialog} />
        <CustomFieldsDialog ctl={ctl} open={dialog === 'customFields'} onClose={closeDialog} />
        <FiltersDialog ctl={ctl} open={dialog === 'filters'} onClose={closeDialog} />
        <GroupsDialog ctl={ctl} open={dialog === 'groups'} onClose={closeDialog} />
        <ColumnsDialog ctl={ctl} open={dialog === 'columns'} onClose={closeDialog} />
        <Dialog open={dialog === 'about'} modalType="modal" onOpenChange={(_e, d) => !d.open && closeDialog()}>
          <DialogSurface style={{ maxWidth: 520, width: '92vw' }}>
            <DialogBody>
              <DialogTitle>{t('Acerca de Nova Plan')}</DialogTitle>
              <DialogContent>
                <p>Nova Plan 0.0.5</p>
                <p>{t('Planificador de proyectos libre (MPL-2.0) de SuiteNova. Guarda en .novaplan e importa y exporta el XML de Microsoft Project (no abre .mpp); consulta docs/LIMITACIONES.md para saber qué se conserva.')}</p>
              </DialogContent>
              <DialogActions>
                <Button appearance="primary" onClick={closeDialog}>
                  {t('Cerrar')}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
        <Dialog open={dialog === 'shortcuts'} modalType="modal" onOpenChange={(_e, d) => !d.open && closeDialog()}>
          <DialogSurface style={{ maxWidth: 560, width: '92vw' }}>
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
                <Button appearance="primary" onClick={closeDialog}>
                  {t('Cerrar')}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      </div>
    </AppFrame>
  );
}

