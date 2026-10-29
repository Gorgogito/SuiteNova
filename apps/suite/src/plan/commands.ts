import type { CommandDef } from '@suitenova/core-ui';
import { BUILTIN_FILTERS, REPORTS, newResource, type ReportId } from '@suitenova/plan-core';
import type { PlanCtl, PlanView, Scale } from './ctl';

export type PlanDialog = 'task' | 'project' | 'calendars' | 'baselines' | 'split' | 'customFields' | 'filters' | 'groups' | 'columns' | 'about' | 'shortcuts' | 'level';

export interface PlanUI {
  ctl: PlanCtl;
  openDialog(kind: PlanDialog): void;
  newWindow(): void;
  open(): Promise<void>;
  save(saveAs: boolean): Promise<void>;
  importMspdi(): Promise<void>;
  exportMspdi(): Promise<void>;
  exportCsv(): Promise<void>;
  exportMspdiExtended(): Promise<void>;
  exportReport(kind: 'csv' | 'html'): Promise<void>;
  printReport(): void;
  insertSubproject(): Promise<void>;
  refreshSubproject(): Promise<void>;
  print(): void;
  scrollToToday(): void;
  scrollToSelection(): void;
  close(): void;
}

export const PERCENTS = [0, 25, 50, 75, 100];
export const SCALES: [Scale, string][] = [
  ['hour', 'Horas'],
  ['day', 'Días'],
  ['week', 'Semanas'],
  ['month', 'Meses'],
];
export const VIEWS: [PlanView, string, string][] = [
  ['gantt', 'Diagrama de Gantt', 'chart'],
  ['network', 'Diagrama de red (PERT)', 'link'],
  ['taskUsage', 'Uso de tareas', 'table'],
  ['resourceSheet', 'Hoja de recursos', 'table'],
  ['resourceUsage', 'Uso de recursos', 'table'],
  ['resourceGraph', 'Gráfico de recursos', 'chart'],
  ['reports', 'Informes', 'list'],
];
/** Filters offered directly in the ribbon; the dialog lists all of them plus the project's own. */
export const QUICK_FILTERS = ['all', 'critical', 'milestones', 'incomplete', 'late', 'overallocated'];

export function planCommands(ui: PlanUI): CommandDef[] {
  const c = ui.ctl;
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  const has = () => c.active >= 0;
  const sel = () => c.selected.length > 0;
  const gantt = () => c.view === 'gantt';
  const warn = (msg: string | null) => {
    if (msg) c.say(msg);
  };

  // ---- file
  add({ id: 'plan.new', label: 'Proyecto nuevo', icon: 'new', shortcut: 'Ctrl+N', run: () => ui.newWindow() });
  add({ id: 'plan.open', label: 'Abrir…', icon: 'open', shortcut: 'Ctrl+O', run: () => void ui.open() });
  add({ id: 'plan.save', label: 'Guardar', icon: 'save', shortcut: 'Ctrl+S', description: 'Guarda el proyecto como archivo de Nova Plan (.novaplan).', run: () => void ui.save(false) });
  add({ id: 'plan.saveAs', label: 'Guardar como…', icon: 'save', shortcut: 'Ctrl+Shift+S', run: () => void ui.save(true) });
  add({ id: 'plan.import.mspdi', label: 'Importar de Microsoft Project (XML)…', icon: 'open', description: 'Abre un proyecto guardado en Project como "XML de Project". Los archivos .mpp no se pueden abrir.', run: () => void ui.importMspdi() });
  add({ id: 'plan.export.mspdi', label: 'Exportar a Microsoft Project (XML)…', icon: 'exportFile', run: () => void ui.exportMspdi() });
  add({ id: 'plan.export.mspdi.ext', label: 'Exportar a Project XML con campos extendidos (experimental)…', icon: 'exportFile', description: 'Añade los campos personalizados y la lista completa de divisiones. Los números de campo no están comprobados con Project.', run: () => void ui.exportMspdiExtended() });
  add({ id: 'plan.export.report.csv', label: 'Exportar el informe a CSV…', icon: 'exportFile', enabled: () => c.view === 'reports', run: () => void ui.exportReport('csv') });
  add({ id: 'plan.export.report.html', label: 'Exportar el informe a HTML…', icon: 'exportFile', enabled: () => c.view === 'reports', run: () => void ui.exportReport('html') });
  add({ id: 'plan.print.report', label: 'Imprimir el informe / PDF', icon: 'print', enabled: () => c.view === 'reports', run: () => ui.printReport() });
  add({ id: 'plan.export.csv', label: 'Exportar a CSV…', icon: 'exportFile', run: () => void ui.exportCsv() });
  add({ id: 'plan.print', label: 'Imprimir / PDF', icon: 'print', shortcut: 'Ctrl+P', enabled: gantt, run: () => ui.print() });
  add({ id: 'plan.about', label: 'Acerca de Nova Plan', icon: 'info', run: () => ui.openDialog('about') });
  add({ id: 'help.shortcuts', label: 'Atajos de teclado', icon: 'keyboard', run: () => ui.openDialog('shortcuts') });

  // ---- edit
  add({ id: 'plan.undo', label: 'Deshacer', icon: 'undo', shortcut: 'Ctrl+Z', enabled: () => c.canUndo, run: () => c.undo() });
  add({ id: 'plan.redo', label: 'Rehacer', icon: 'redo', shortcut: ['Ctrl+Y', 'Ctrl+Shift+Z'], enabled: () => c.canRedo, run: () => c.redo() });

  // ---- tasks
  add({ id: 'plan.task.add', label: 'Tarea nueva', icon: 'plus', shortcut: 'Ctrl+Alt+N', run: () => c.add() });
  add({ id: 'plan.task.milestone', label: 'Hito nuevo', icon: 'milestone', run: () => c.addMilestone() });
  add({ id: 'plan.task.delete', label: 'Eliminar tarea', icon: 'trash', shortcut: 'Ctrl+Delete', enabled: sel, run: () => c.deleteSelected() });
  add({ id: 'plan.task.info', label: 'Información de la tarea…', icon: 'info', shortcut: 'Shift+F2', enabled: has, run: () => ui.openDialog('task') });
  add({ id: 'plan.task.indent', label: 'Aumentar sangría (subordinar)', icon: 'indentMore', shortcut: 'Alt+Shift+Right', enabled: () => c.canShift(1), run: () => c.shift(1) });
  add({ id: 'plan.task.outdent', label: 'Disminuir sangría (ascender)', icon: 'indentLess', shortcut: 'Alt+Shift+Left', enabled: () => c.canShift(-1), run: () => c.shift(-1) });
  add({ id: 'plan.task.up', label: 'Mover tarea hacia arriba', icon: 'moveUp', shortcut: 'Alt+Shift+Up', enabled: () => c.canMove(-1), run: () => c.move(-1) });
  add({ id: 'plan.task.down', label: 'Mover tarea hacia abajo', icon: 'moveDown', shortcut: 'Alt+Shift+Down', enabled: () => c.canMove(1), run: () => c.move(1) });
  add({ id: 'plan.task.link', label: 'Vincular tareas', icon: 'link', shortcut: 'Ctrl+F2', description: 'Encadena las tareas seleccionadas (fin a inicio). Selecciona varias con Ctrl+clic.', enabled: () => c.selected.length > 1, run: () => warn(c.linkSelected()) });
  add({ id: 'plan.task.unlink', label: 'Desvincular tareas', icon: 'unlink', shortcut: 'Ctrl+Shift+F2', enabled: () => sel() && c.canUnlink(), run: () => c.unlinkSelected() });
  for (const p of PERCENTS) add({ id: `plan.percent.${p}`, label: `${p} % completado`, icon: 'checkSquare', enabled: sel, run: () => c.setPercent(p) });
  add({ id: 'plan.task.goto', label: 'Ir a la tarea seleccionada', icon: 'search', shortcut: 'Ctrl+Shift+F5', enabled: () => has() && gantt(), run: () => ui.scrollToSelection() });
  add({ id: 'plan.task.manual', label: 'Programar manualmente', icon: 'edit', description: 'Las fechas de la tarea las pones tú; los vínculos no la mueven.', enabled: sel, run: () => c.setManual(true) });
  add({ id: 'plan.task.auto', label: 'Programar automáticamente', icon: 'refresh', description: 'La tarea se programa según sus vínculos, restricciones y calendario.', enabled: sel, run: () => c.setManual(false) });
  add({ id: 'plan.task.split', label: 'Dividir tarea…', icon: 'splitH', description: 'Interrumpe la tarea en una fecha y la reanuda más tarde.', enabled: () => has() && !!c.sched && !c.sched.tasks[c.active]?.summary && !c.sched.tasks[c.active]?.milestone, run: () => ui.openDialog('split') });
  add({ id: 'plan.task.unsplit', label: 'Quitar divisiones', icon: 'eraser', enabled: () => !!c.activeTask?.splits.length, run: () => c.removeSplitsActive() });
  add({ id: 'plan.subproject.insert', label: 'Insertar subproyecto…', icon: 'open', description: 'Inserta otro proyecto (.novaplan o XML de Project) como tarea de resumen.', run: () => void ui.insertSubproject() });
  add({ id: 'plan.subproject.refresh', label: 'Actualizar subproyecto', icon: 'refresh', description: 'Vuelve a leer el archivo del subproyecto seleccionado.', enabled: () => !!c.activeTask?.subproject?.path, run: () => void ui.refreshSubproject() });

  add({ id: 'plan.subproject.live', label: 'Vínculo vivo', icon: 'link', description: 'El subproyecto se vuelve a leer cuando el archivo cambia (al abrir el proyecto y al volver a esta ventana).', checked: () => !!c.activeTask?.subproject?.live, enabled: () => !!c.activeTask?.subproject?.path, run: () => c.toggleSubprojectLive() });

  // ---- resources
  add({ id: 'plan.level', label: 'Nivelar recursos…', icon: 'settings', description: 'Resuelve las sobreasignaciones retrasando tareas de menor prioridad.', enabled: () => !!c.sched && c.project.resources.length > 0, run: () => ui.openDialog('level') });
  add({ id: 'plan.level.clear', label: 'Borrar nivelación', icon: 'eraser', description: 'Quita los retrasos que añadió la nivelación.', enabled: () => c.project.tasks.some((t) => !!t.levelDelay), run: () => c.clearLevel() });
  add({
    id: 'plan.resource.add',
    label: 'Recurso nuevo',
    icon: 'plus',
    run: () => {
      const r = newResource(`Recurso ${c.project.resources.length + 1}`);
      c.commit({ ...c.project, resources: [...c.project.resources, r] });
      c.setView('resourceSheet');
    },
  });

  // ---- project
  add({ id: 'plan.project.info', label: 'Información del proyecto…', icon: 'info', run: () => ui.openDialog('project') });
  add({ id: 'plan.calendar', label: 'Calendarios laborales…', icon: 'calendar', run: () => ui.openDialog('calendars') });
  add({ id: 'plan.baselines', label: 'Líneas base…', icon: 'save', description: 'Guarda hasta 11 líneas base y elige con cuál se compara el plan.', enabled: () => !!c.sched, run: () => ui.openDialog('baselines') });
  add({ id: 'plan.status', label: 'Fecha de estado: hoy', icon: 'clock', run: () => c.setStatusToday() });
  add({ id: 'plan.customFields', label: 'Campos personalizados…', icon: 'settings', run: () => ui.openDialog('customFields') });
  add({ id: 'plan.filters', label: 'Filtros…', icon: 'filter', run: () => ui.openDialog('filters') });
  add({ id: 'plan.groups', label: 'Agrupaciones…', icon: 'list', run: () => ui.openDialog('groups') });
  add({ id: 'plan.columns', label: 'Columnas de la tabla…', icon: 'table', run: () => ui.openDialog('columns') });
  for (const id of QUICK_FILTERS) {
    const f = BUILTIN_FILTERS.find((x) => x.id === id);
    if (f) add({ id: `plan.filter.${id}`, label: f.name, icon: 'filter', checked: () => (c.project.view.filter ?? 'all') === id, run: () => c.setFilter(id) });
  }
  add({ id: 'plan.group.none', label: 'Sin agrupar', icon: 'list', checked: () => !c.project.view.group, run: () => c.setGroup(null) });

  // ---- reports
  for (const r of REPORTS) add({ id: `plan.report.${r.id}`, label: r.title, icon: 'list', checked: () => c.view === 'reports' && c.reportId === r.id, run: () => c.setReport(r.id as ReportId) });

  // ---- view
  for (const [v, label, icon] of VIEWS) add({ id: `plan.view.${v}`, label, icon, checked: () => c.view === v, run: () => c.setView(v) });
  for (const [s, label] of SCALES) add({ id: `plan.scale.${s}`, label: `Escala: ${label.toLowerCase()}`, icon: 'calendar', checked: () => c.scale === s, enabled: gantt, run: () => c.setScale(s) });
  add({ id: 'plan.critical', label: 'Resaltar ruta crítica', icon: 'star', checked: () => c.showCritical, run: () => c.setShowCritical(!c.showCritical) });
  add({ id: 'plan.today', label: 'Ir a hoy', icon: 'clock', enabled: gantt, run: () => ui.scrollToToday() });
  add({ id: 'plan.expandAll', label: 'Expandir todo', icon: 'plus', enabled: gantt, run: () => c.setAllCollapsed(false) });
  add({ id: 'plan.collapseAll', label: 'Contraer todo', icon: 'minus', enabled: gantt, run: () => c.setAllCollapsed(true) });
  for (const [s, label] of [['day', 'Días'], ['week', 'Semanas'], ['month', 'Meses']] as const) add({ id: `plan.step.${s}`, label: `Tablas y gráficos por ${label.toLowerCase()}`, icon: 'calendar', checked: () => c.usageStep === s, run: () => c.setUsageStep(s) });
  return defs;
}
