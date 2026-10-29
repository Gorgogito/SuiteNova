import { CommandRegistry, coreCommands, getLocale, setLocale, t, type RibbonItem } from '@suitenova/core-ui';
import { dayOf, newResource, timeOf, type Resource } from '@suitenova/plan-core';
import { describe, expect, it } from 'vitest';
import { zoomCommands } from '../common';
import { cellText } from './columns';
import { planCommands, type PlanUI } from './commands';
import { PlanCtl } from './ctl';
import './messages';
import { planTabs } from './ribbonDef';

function setup() {
  const ctl = new PlanCtl();
  const ui: PlanUI = {
    ctl,
    openDialog: () => undefined,
    newWindow: () => undefined,
    open: async () => undefined,
    save: async () => undefined,
    importMspdi: async () => undefined,
    exportMspdi: async () => undefined,
    exportCsv: async () => undefined,
    exportMspdiExtended: async () => undefined,
    exportReport: async () => undefined,
    printReport: () => undefined,
    insertSubproject: async () => undefined,
    refreshSubproject: async () => undefined,
    print: () => undefined,
    scrollToToday: () => undefined,
    scrollToSelection: () => undefined,
    close: () => undefined,
  };
  const registry = new CommandRegistry();
  registry.registerAll(coreCommands);
  registry.registerAll(zoomCommands(() => 100, () => undefined, (v) => v));
  registry.registerAll(planCommands(ui));
  registry.register({ id: 'file.close', label: 'Cerrar', run: () => undefined });
  return { ctl, ui, registry };
}

function commandsIn(items: RibbonItem[]): string[] {
  return items.flatMap((i) => {
    if (i.kind === 'button') return [i.command];
    if (i.kind === 'dropdown') return [...(i.primaryCommand ? [i.primaryCommand] : []), ...i.entries.flatMap((e) => (e.kind === 'command' ? [e.command] : []))];
    return [];
  });
}

const T = (y: number, m: number, d: number, minute = 480) => timeOf(dayOf(y, m, d), minute);
const DAY = 480; // a working day of the standard calendar, in minutes

/** A project starting on Monday 2025-03-03 at 08:00 with three tasks in a row (2, 3 and 1 days). */
function sample(): PlanCtl {
  const { ctl } = setup();
  ctl.project = { ...ctl.project, start: T(2025, 3, 3) };
  ctl.add({ name: 'A', duration: 2 * DAY });
  ctl.add({ name: 'B', duration: 3 * DAY });
  ctl.add({ name: 'C', duration: 1 * DAY });
  return ctl;
}
const cell = (ctl: PlanCtl, i: number, id: string) => cellText(ctl.ctx!, i, id);
const person = (id: string, name: string, patch: Partial<Resource> = {}): Resource => ({ ...newResource(name), id, ...patch });

describe('Nova Plan ribbon', () => {
  it('only references commands that exist (no decorative controls)', () => {
    const { registry } = setup();
    const missing: string[] = [];
    for (const tab of planTabs()) for (const g of tab.groups) for (const id of commandsIn(g.items)) if (!registry.get(id)) missing.push(`${tab.id}/${g.id}: ${id}`);
    expect(missing).toEqual([]);
  });
  it('gives every command a label and no two commands share a shortcut', () => {
    const { registry } = setup();
    const seen = new Map<string, string>();
    for (const c of registry.all()) {
      expect(c.label, c.id).toBeTruthy();
      for (const sc of Array.isArray(c.shortcut) ? c.shortcut : c.shortcut ? [c.shortcut] : []) {
        expect(seen.get(sc), `${sc} used by ${c.id} and ${seen.get(sc)}`).toBeUndefined();
        seen.set(sc, c.id);
      }
    }
  });
  it('keeps ribbon key tips unique within each tab', () => {
    for (const tab of planTabs()) {
      const tips = tab.groups.flatMap((g) => g.items.flatMap((i) => ('keytip' in i && i.keytip ? [i.keytip] : [])));
      for (const a of tips) for (const b of tips) if (a !== b) expect(b.startsWith(a), `${tab.id}: ${a} vs ${b}`).toBe(false);
      expect(new Set(tips).size).toBe(tips.length);
    }
  });
  it('has an English translation for every command label', () => {
    const { registry } = setup();
    const prev = getLocale();
    setLocale('en');
    try {
      const missing = registry
        .all()
        .filter((c) => c.id.startsWith('plan.'))
        .filter((c) => t(c.label) === c.label && /[áéíóúñ¿¡]|^(Insertar|Abrir|Guardar|Nueva|Nuevo|Eliminar|Pegar|Tarea|Hito|Escala|Ir a|Programar|Dividir|Quitar|Actualizar|Recurso|Líneas|Campos|Filtros|Columnas|Sin agrupar|Horas|Informes|Costos|Trabajo|Valor|Resaltar|Expandir|Contraer|Tablas)/.test(c.label))
        .map((c) => `${c.id}: ${c.label}`);
      expect(missing).toEqual([]);
    } finally {
      setLocale(prev);
    }
  });
  it('offers every view, scale, report and the requested project tools from the ribbon', () => {
    const ids = planTabs().flatMap((tab) => tab.groups.flatMap((g) => commandsIn(g.items)));
    for (const id of ['plan.view.network', 'plan.view.resourceGraph', 'plan.view.resourceUsage', 'plan.view.taskUsage', 'plan.scale.hour', 'plan.baselines', 'plan.customFields', 'plan.filters', 'plan.groups', 'plan.task.split', 'plan.task.manual', 'plan.calendar', 'plan.subproject.insert', 'plan.report.earned', 'plan.report.burndown']) expect(ids, id).toContain(id);
  });
});

describe('PlanCtl editing', () => {
  it('adds tasks after the selection and keeps undo history', () => {
    const ctl = sample();
    expect(ctl.project.tasks.map((x) => x.name)).toEqual(['A', 'B', 'C']);
    ctl.select(0);
    ctl.add({ name: 'A2' });
    expect(ctl.project.tasks.map((x) => x.name)).toEqual(['A', 'A2', 'B', 'C']);
    expect(ctl.active).toBe(1);
    ctl.undo();
    expect(ctl.project.tasks.map((x) => x.name)).toEqual(['A', 'B', 'C']);
    ctl.redo();
    expect(ctl.project.tasks).toHaveLength(4);
    expect(ctl.dirty).toBe(true);
  });

  it('shows dates and hours in the table and recomputes them when a cell changes', () => {
    const ctl = sample();
    ctl.select(1);
    expect(cell(ctl, 1, 'start')).toBe('03/03/2025 08:00');
    expect(ctl.commitCell(0, 'duration', '2')).toBeNull();
    expect(ctl.commitCell(1, 'predecessors', '1')).toBeNull();
    expect(cell(ctl, 1, 'start')).toBe('05/03/2025 08:00');
    expect(cell(ctl, 1, 'finish')).toBe('07/03/2025 17:00');
    expect(cell(ctl, 1, 'predecessors')).toBe('1');
    expect(ctl.commitCell(0, 'duration', '4d')).toBeNull();
    expect(cell(ctl, 1, 'start')).toBe('07/03/2025 08:00');
    expect(ctl.commitCell(0, 'duration', 'mucho')).toMatch(/duración/);
    expect(ctl.commitCell(1, 'percent', '150')).toMatch(/entre 0 y 100/);
    expect(ctl.commitCell(1, 'start', '31/02/2025')).toMatch(/fecha/);
    expect(ctl.commitCell(1, 'start', '12/03/2025 10:00')).toBeNull();
    expect(cell(ctl, 1, 'start')).toBe('12/03/2025 10:00');
    expect(ctl.cellEditable(1, 'finish')).toBe(true);
    expect(ctl.cellEditable(1, 'slack')).toBe(false);
  });

  it('understands hours, minutes and elapsed durations', () => {
    const ctl = sample();
    expect(ctl.commitCell(0, 'duration', '4h')).toBeNull();
    expect(cell(ctl, 0, 'duration')).toBe('4h');
    expect(cell(ctl, 0, 'finish')).toBe('03/03/2025 12:00');
    expect(ctl.commitCell(0, 'duration', '2ed')).toBeNull();
    expect(ctl.project.tasks[0]!.elapsed).toBe(true);
    expect(cell(ctl, 0, 'duration')).toBe('2ed');
    // elapsed time runs through the weekend: 3 Mar 08:00 + 5 elapsed days = 8 Mar 08:00
    expect(ctl.commitCell(0, 'duration', '5ed')).toBeNull();
    expect(cell(ctl, 0, 'finish')).toBe('08/03/2025 08:00');
  });

  it('rejects circular and self predecessors from the cell', () => {
    const ctl = sample();
    expect(ctl.commitCell(1, 'predecessors', '1')).toBeNull();
    expect(ctl.commitCell(0, 'predecessors', '2')).toMatch(/circular/);
    expect(ctl.commitCell(0, 'predecessors', '1')).toMatch(/sí misma/);
    expect(ctl.commitCell(0, 'predecessors', '9')).toMatch(/no existe/);
    expect(cell(ctl, 0, 'predecessors')).toBe('');
  });

  it('indents into summaries, collapses and hides rows', () => {
    const ctl = sample();
    ctl.select(1);
    ctl.shift(1);
    ctl.select(2);
    ctl.shift(1);
    expect(ctl.sched!.tasks[0]!.summary).toBe(true);
    expect(ctl.sched!.tasks[0]!.duration).toBe(3 * DAY);
    expect(ctl.cellEditable(0, 'duration')).toBe(false);
    ctl.toggleCollapse(0);
    expect(ctl.visibleRows()).toEqual([0]);
    ctl.setAllCollapsed(false);
    expect(ctl.visibleRows()).toEqual([0, 1, 2]);
    expect(ctl.canShift(-1)).toBe(false); // the selected row was hidden by the collapse
    ctl.select(2);
    expect(ctl.canShift(-1)).toBe(true);
  });

  it('links the selection in order and unlinks it', () => {
    const ctl = sample();
    ctl.select(0);
    ctl.select(1, 'toggle');
    ctl.select(2, 'toggle');
    expect(ctl.linkSelected()).toBeNull();
    expect(cell(ctl, 2, 'predecessors')).toBe('2');
    expect(cell(ctl, 2, 'start')).toBe('10/03/2025 08:00');
    ctl.select(1);
    expect(ctl.canUnlink()).toBe(true);
    ctl.unlinkSelected();
    expect(cell(ctl, 1, 'predecessors')).toBe('');
    expect(cell(ctl, 2, 'predecessors')).toBe('');
    ctl.select(0);
    expect(ctl.linkSelected()).toMatch(/al menos dos/);
  });

  it('deletes with the branch and keeps the selection valid', () => {
    const ctl = sample();
    ctl.select(2);
    ctl.deleteSelected();
    expect(ctl.project.tasks).toHaveLength(2);
    expect(ctl.selected).toEqual([1]);
    ctl.select(0);
    ctl.deleteSelected();
    ctl.deleteSelected();
    expect(ctl.project.tasks).toHaveLength(0);
    expect(ctl.selected).toEqual([]);
  });

  it('drag gestures preview without touching history and commit once', () => {
    const ctl = sample();
    const before = ctl.project;
    ctl.previewMove(0, T(2025, 3, 10));
    expect(ctl.project).toBe(before);
    expect(ctl.sched!.tasks[0]!.start).toBe(T(2025, 3, 10));
    ctl.endGesture(false);
    expect(ctl.sched!.tasks[0]!.start).toBe(T(2025, 3, 3));
    ctl.previewDuration(0, 5 * DAY);
    ctl.previewDuration(0, 6 * DAY);
    ctl.endGesture(true);
    expect(ctl.project.tasks[0]!.duration).toBe(6 * DAY);
    ctl.undo();
    expect(ctl.project.tasks[0]!.duration).toBe(2 * DAY);
    ctl.previewPercent(0, 130);
    ctl.endGesture(true);
    expect(ctl.project.tasks[0]!.percent).toBe(100);
  });

  it('moves a manually scheduled task by its own dates and ignores its links', () => {
    const ctl = sample();
    expect(ctl.commitCell(1, 'predecessors', '1')).toBeNull();
    ctl.select(1);
    ctl.setManual(true);
    expect(ctl.project.tasks[1]!.manual).toBe(true);
    ctl.previewMove(1, T(2025, 3, 20));
    ctl.endGesture(true);
    expect(cell(ctl, 1, 'start')).toBe('20/03/2025 08:00');
    expect(cell(ctl, 1, 'finish')).toBe('22/03/2025 17:00'); // the bar keeps its length when it is dragged
    ctl.setManual(false);
    expect(cell(ctl, 1, 'start')).toBe('05/03/2025 08:00');
  });
});

describe('PlanCtl work, resources and costs', () => {
  it('assigns resources from the cell and rejects unknown ones', () => {
    const ctl = sample();
    ctl.project = { ...ctl.project, resources: [person('r1', 'Ana'), person('r2', 'Cemento', { type: 'material', rate: 5 })] };
    expect(ctl.commitCell(0, 'resources', 'ana[50%]; Cemento[3]')).toBeNull();
    expect(ctl.project.tasks[0]!.assignments).toMatchObject([{ resource: 'r1', units: 0.5 }, { resource: 'r2', units: 3 }]);
    expect(cell(ctl, 0, 'resources')).toBe('Ana[50%];Cemento[3]');
    expect(ctl.commitCell(0, 'resources', 'Pepe')).toMatch(/No existe/);
  });

  it('follows the task type rules: fixed duration, fixed work and effort-driven', () => {
    const ctl = sample();
    ctl.project = { ...ctl.project, resources: [person('r1', 'Ana', { rate: 10 }), person('r2', 'Beto', { rate: 20 })] };
    expect(ctl.commitCell(0, 'resources', 'Ana')).toBeNull();
    // 2 days at 100 % = 16 h of work
    expect(cell(ctl, 0, 'work')).toBe('16 h');
    expect(ctl.commitCell(0, 'type', 'Trabajo fijo')).toBeNull();
    expect(ctl.project.tasks[0]!.type).toBe('work');
    // fixed work: a second person halves the duration and keeps the 16 hours
    expect(ctl.commitCell(0, 'resources', 'Ana; Beto')).toBeNull();
    expect(ctl.sched!.tasks[0]!.duration).toBe(DAY);
    expect(ctl.sched!.tasks[0]!.work).toBe(16 * 60);
    expect(ctl.commitCell(0, 'type', 'Duración fija')).toBeNull();
    expect(ctl.commitCell(0, 'duration', '4')).toBeNull();
    // fixed duration: the work follows the duration
    expect(ctl.sched!.tasks[0]!.work).toBe(2 * 4 * DAY);
    expect(ctl.commitCell(0, 'type', 'xyz')).toMatch(/Unidades fijas/);
  });

  it('keeps actual work and actual costs apart from the plan', () => {
    const ctl = sample();
    ctl.project = { ...ctl.project, resources: [person('r1', 'Ana', { rate: 10 })] };
    expect(ctl.commitCell(0, 'resources', 'Ana')).toBeNull();
    expect(ctl.commitCell(0, 'percent', '50')).toBeNull();
    const s = ctl.sched!.tasks[0]!;
    expect(s.cost).toBe(16 * 10);
    expect(s.actualWork).toBe(8 * 60);
    expect(s.actualCost).toBe(8 * 10);
    expect(ctl.commitCell(0, 'actualWork', '10')).toBeNull();
    expect(ctl.sched!.tasks[0]!.actualWork).toBe(10 * 60);
    expect(ctl.sched!.tasks[0]!.remainingWork).toBe(6 * 60);
    expect(ctl.commitCell(0, 'actualWork', 'mucho')).toMatch(/trabajo/);
  });

  it('shows overallocated resources', () => {
    const ctl = sample();
    ctl.project = { ...ctl.project, resources: [person('r1', 'Ana')] };
    ctl.select(0);
    expect(ctl.commitCell(0, 'resources', 'Ana')).toBeNull();
    expect(ctl.commitCell(1, 'resources', 'Ana')).toBeNull();
    // no links: both tasks start on the 3rd and Ana is asked to do two things at once
    expect(ctl.sched!.tasks[0]!.start).toBe(ctl.sched!.tasks[1]!.start);
    expect(ctl.sched!.overallocations.map((o) => o.resource)).toEqual(['r1']);
  });
});

describe('PlanCtl baselines, filters and groups', () => {
  it('saves several baselines, compares against the one on show and deletes them', () => {
    const ctl = sample();
    ctl.saveBaseline(0);
    ctl.saveBaseline(3);
    expect(Object.keys(ctl.project.baselines[0]!.tasks)).toHaveLength(3);
    expect(ctl.project.baselines[3]).not.toBeNull();
    expect(ctl.commitCell(0, 'duration', '5')).toBeNull();
    expect(cell(ctl, 0, 'finishVariance')).not.toBe('');
    ctl.setBaselineShown(3);
    expect(ctl.baselineShown).toBe(3);
    ctl.select(1);
    ctl.saveBaseline(3, true); // only the selected task is overwritten
    expect(Object.keys(ctl.project.baselines[3]!.tasks)).toHaveLength(3);
    ctl.deleteBaseline(3);
    expect(ctl.project.baselines[3]).toBeNull();
  });

  it('filters and groups the table', () => {
    const ctl = sample();
    expect(ctl.commitCell(0, 'percent', '100')).toBeNull();
    ctl.setFilter('complete');
    expect(ctl.visibleRows()).toEqual([0]);
    ctl.setFilter(null);
    expect(ctl.visibleRows()).toEqual([0, 1, 2]);
    ctl.commit({ ...ctl.project, groups: [{ id: 'g1', name: 'Por avance', levels: [{ field: 'percent' }] }] });
    ctl.setGroup('g1');
    const rows = ctl.display();
    expect(rows.filter((r) => r.kind === 'group')).toHaveLength(2);
    expect(rows.filter((r) => r.kind === 'task')).toHaveLength(3);
    // adding tasks is refused while grouped
    ctl.add({ name: 'X' });
    expect(ctl.project.tasks).toHaveLength(3);
    ctl.setGroup(null);
    ctl.add({ name: 'X' });
    expect(ctl.project.tasks).toHaveLength(4);
  });

  it('splits a task and removes the split again', () => {
    const ctl = sample();
    ctl.select(1);
    const before = ctl.sched!.tasks[1]!.finish;
    expect(ctl.splitActive(T(2025, 3, 4, 720), T(2025, 3, 10))).toBeNull();
    expect(ctl.project.tasks[1]!.splits).toHaveLength(1);
    expect(ctl.sched!.tasks[1]!.finish).toBeGreaterThan(before);
    expect(ctl.sched!.tasks[1]!.segments.length).toBe(2);
    ctl.removeSplitsActive();
    expect(ctl.sched!.tasks[1]!.finish).toBe(before);
  });

  it('reports an unworkable calendar without crashing', () => {
    const ctl = sample();
    ctl.commit({ ...ctl.project, calendars: ctl.project.calendars.map((c) => ({ ...c, week: new Array(7).fill([]) })) });
    expect(ctl.sched).toBeNull();
    expect('error' in ctl.result).toBe(true);
  });
});

describe('Nova Plan: leveling, priority and live subprojects', () => {
  const overloaded = (): PlanCtl => {
    const ctl = sample();
    const ana = person('r1', 'Ana');
    ctl.commit({ ...ctl.project, resources: [ana] });
    // A and B in parallel, both with Ana
    const idA = ctl.project.tasks[0]!.id;
    const idB = ctl.project.tasks[1]!.id;
    ctl.commit({ ...ctl.project, tasks: ctl.project.tasks.map((t) => (t.id === idB ? { ...t, links: [] } : t)) });
    ctl.assign(idA, 'r1');
    ctl.assign(idB, 'r1');
    return ctl;
  };
  it('levels from the command and clears it again', () => {
    const ctl = overloaded();
    expect(ctl.sched!.overallocations.length).toBeGreaterThan(0);
    const msg = ctl.levelResources({});
    expect(msg).toMatch(/Nivelación|Leveling/);
    expect(ctl.sched!.overallocations).toEqual([]);
    expect(ctl.project.tasks.some((t) => (t.levelDelay ?? 0) > 0)).toBe(true);
    ctl.clearLevel();
    expect(ctl.project.tasks.every((t) => !t.levelDelay)).toBe(true);
    expect(ctl.sched!.overallocations.length).toBeGreaterThan(0);
  });
  it('edits the priority from the table and shows the delay', () => {
    const ctl = overloaded();
    expect(ctl.cellEditable(0, 'priority')).toBe(true);
    ctl.commitCell(0, 'priority', '200');
    expect(ctl.project.tasks[0]!.priority).toBe(200);
    ctl.commitCell(0, 'priority', '500');
    expect(ctl.project.tasks[0]!.priority).toBeUndefined();
    expect(cell(ctl, 0, 'levelDelay')).toBe('0d');
  });
  it('takes the "as late as possible" constraint from the task form patch', () => {
    const ctl = sample();
    const id = ctl.project.tasks[2]!.id;
    ctl.commit({ ...ctl.project, tasks: ctl.project.tasks.map((t) => (t.id === id ? { ...t, links: [], constraint: { type: 'alap' as const, date: null } } : t)) });
    expect(cell(ctl, 2, 'constraint')).toBe('Lo más tarde posible');
    expect(ctl.sched!.tasks[2]!.finish).toBe(ctl.sched!.finish);
  });
  it('follows the project time zone for "today"', () => {
    const ctl = sample();
    ctl.commit({ ...ctl.project, timeZone: 'Asia/Tokyo' });
    ctl.setStatusToday();
    const tokyo = ctl.project.statusDate!;
    ctl.commit({ ...ctl.project, timeZone: 'Pacific/Pago_Pago' });
    ctl.setStatusToday();
    // Pago Pago is 20 h behind Tokyo
    expect(tokyo - ctl.project.statusDate!).toBe(20 * 60);
  });
  it('switches the live link of a subproject on and off, and inserts one as live', () => {
    const ctl = sample();
    const other = sample().project;
    ctl.insertSubproject(other, 'C:/x/obra.novaplan', 'abc');
    const i = ctl.project.tasks.findIndex((t) => t.subproject);
    expect(ctl.project.tasks[i]!.subproject).toMatchObject({ live: true, stamp: 'abc' });
    ctl.select(i);
    ctl.toggleSubprojectLive();
    expect(ctl.project.tasks[i]!.subproject?.live).toBeUndefined();
    ctl.toggleSubprojectLive();
    expect(ctl.project.tasks[i]!.subproject?.live).toBe(true);
    // a copy inserted without a path cannot be live
    const ctl2 = sample();
    ctl2.insertSubproject(other, null);
    expect(ctl2.project.tasks.find((t) => t.subproject)!.subproject?.live).toBeUndefined();
  });
});
