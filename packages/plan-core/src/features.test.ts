import { describe, expect, it } from 'vitest';
import {
  BUILTIN_FILTERS, REPORTS, bucketsOf, buildReport, checkFormula, cumulative, dayOf, earnedValue, evCurves, evalFormula, exportCsv, exportMspdi, fieldContext, filteredRows, formatDuration, formatPredecessors, groupTasks,
  importMspdi, insertProject, linkTasks, networkLayout, newAssignment, newCalendar, newProject, newResource, newTask, parseDateTime, parseDuration, parsePredecessors, parseProject, projectEarnedValue, refreshSubproject,
  resourceUsage, schedule, serializeProject, setBaseline, splitTask, taskUsage, taskValue, timeOf, twentyFourSeven, type Project, type Task,
} from './index';

const MON = dayOf(2025, 3, 3);
const T = (d: number, h = 0, m = 0) => timeOf(MON + d, h * 60 + m);
const H = 60;
const D = 480;

function project(tasks: Partial<Task>[]): Project {
  const p = newProject('Prueba', T(0, 8));
  p.tasks = tasks.map((t, i) => ({ ...newTask(t.name ?? `T${i + 1}`), duration: D, ...t }));
  return p;
}
const lnk = (t: Task, type: 'FS' | 'SS' | 'FF' | 'SF' = 'FS', lag = 0) => ({ task: t.id, type, lag });

describe('text forms', () => {
  const p = newProject();
  it('parses durations with units, elapsed and decimals', () => {
    expect(parseDuration('5', p)).toEqual({ minutes: 5 * D, elapsed: false });
    expect(parseDuration('3d', p)).toEqual({ minutes: 3 * D, elapsed: false });
    expect(parseDuration('4h', p)).toEqual({ minutes: 240, elapsed: false });
    expect(parseDuration('90 min', p)?.minutes).toBe(90);
    expect(parseDuration('1,5 días', p)?.minutes).toBe(720);
    expect(parseDuration('2sem', p)?.minutes).toBe(2 * 2400);
    expect(parseDuration('1 mes', p)?.minutes).toBe(20 * D);
    expect(parseDuration('2ed', p)).toEqual({ minutes: 2 * 1440, elapsed: true });
    expect(parseDuration('abc', p)).toBeNull();
  });
  it('formats durations the way they are typed', () => {
    expect(formatDuration(3 * D, false, p)).toBe('3d');
    expect(formatDuration(240, false, p)).toBe('4h');
    expect(formatDuration(720, false, p)).toBe('1,5d');
    expect(formatDuration(2880, true, p)).toBe('2ed');
    expect(formatDuration(0, false, p)).toBe('0d');
  });
  it('parses dates with and without hours', () => {
    expect(parseDateTime('14/03/2025', 480)).toBe(timeOf(dayOf(2025, 3, 14), 480));
    expect(parseDateTime('2025-03-14 10:30')).toBe(timeOf(dayOf(2025, 3, 14), 630));
    expect(parseDateTime('14/03/25 9:05')).toBe(timeOf(dayOf(2025, 3, 14), 545));
    expect(parseDateTime('31/02/2025')).toBeNull();
    expect(parseDateTime('14/03/2025 25:00')).toBeNull();
  });
  it('predecessors with lag in any unit', () => {
    const q = project([{}, {}, {}]);
    const r = parsePredecessors('1FS+2d;2SS-4h;1FF+3ed', q, 2);
    expect(r.error).toBeUndefined();
    expect(r.links.map((l) => [l.type, l.lag, !!l.elapsed])).toEqual([['FS', 2 * D, false], ['SS', -240, false], ['FF', 3 * 1440, true]]);
    q.tasks[2]!.links = r.links.map((l, i) => ({ ...l, task: q.tasks[i === 1 ? 1 : 0]!.id }));
    expect(formatPredecessors(q, q.tasks[2]!)).toBe('1FS+2d;2SS-4h;1FF+3ed');
    expect(parsePredecessors('9', q, 2).error).toMatch(/no existe/);
  });
});

describe('baselines and earned value', () => {
  function base(): { p: Project } {
    let p = project([{ duration: 2 * D, fixedCost: 0 }, { duration: 2 * D }]);
    const w = { ...newResource('Ana'), rate: 10 };
    p.resources = [w];
    p.tasks[0]!.assignments = [newAssignment(w.id, 1)]; // 16 h = 160
    p.tasks[1]!.assignments = [newAssignment(w.id, 1)];
    p.tasks[1]!.links = [lnk(p.tasks[0]!)];
    const s = schedule(p);
    p = setBaseline(p, s, 0, T(0, 8));
    return { p };
  }
  it('saves several baselines independently', () => {
    const { p } = base();
    const s = schedule(p);
    const p2 = setBaseline(p, s, 3, T(0, 9), [p.tasks[0]!.id]);
    expect(Object.keys(p2.baselines[3]!.tasks)).toEqual([p.tasks[0]!.id]);
    expect(Object.keys(p2.baselines[0]!.tasks).length).toBe(2);
  });
  it('earned value: planned, earned, actual, variances and indexes', () => {
    let { p } = base();
    // finish of task 1 is Tuesday 17:00; measure at the end of that day (50 % of the whole baseline planned)
    p.tasks[0]!.percent = 100;
    p.tasks[1]!.percent = 0;
    p.tasks[0]!.assignments[0]!.actualCost = 200; // cost more than planned
    const s = schedule(p);
    const ev = earnedValue(p, s, 0, T(1, 17));
    expect(ev[0]!.bac).toBeCloseTo(160);
    expect(ev[0]!.pv).toBeCloseTo(160);
    expect(ev[0]!.ev).toBeCloseTo(160);
    expect(ev[0]!.ac).toBeCloseTo(200);
    expect(ev[0]!.cv).toBeCloseTo(-40);
    expect(ev[0]!.cpi).toBeCloseTo(0.8);
    expect(ev[1]!.pv).toBeCloseTo(0);
    const pr = projectEarnedValue(p, s, 0, T(1, 17));
    expect(pr.bac).toBeCloseTo(320);
    expect(pr.pv).toBeCloseTo(160);
    expect(pr.sv).toBeCloseTo(0);
    expect(pr.eac).toBeCloseTo(320 / 0.8);
    expect(pr.vac).toBeCloseTo(320 - 400);
    p = { ...p, statusDate: T(1, 17) };
    const c = evCurves(p, schedule(p), 0, 'day', T(1, 17));
    expect(c.pv[c.pv.length - 1]).toBeCloseTo(320);
    const lastKnown = c.ev.filter((x) => x !== null).pop()!;
    expect(lastKnown).toBeCloseTo(160);
  });
  it('without a baseline there is nothing planned', () => {
    const p = project([{}]);
    const ev = earnedValue(p, schedule(p), 0, T(1, 8));
    expect(ev[0]!.bac).toBe(0);
    expect(ev[0]!.spi).toBeNull();
  });
});

describe('time-phased usage and resource calendars', () => {
  it('distributes work over the days of the task and sums to the total', () => {
    const p = project([{ duration: 3 * D }]);
    const r = { ...newResource('Ana'), rate: 10 };
    p.resources = [r];
    p.tasks[0]!.assignments = [newAssignment(r.id, 1)];
    const s = schedule(p);
    const b = bucketsOf(MON, MON + 7, 'day');
    const u = resourceUsage(p, s, b)[0]!;
    expect(u.total.work.reduce((a, x) => a + x, 0)).toBeCloseTo(3 * D);
    expect(u.total.work.slice(0, 3)).toEqual([D, D, D]);
    expect(u.capacity.slice(0, 5)).toEqual([D, D, D, D, D]);
    const w = bucketsOf(MON, MON + 7, 'week');
    expect(resourceUsage(p, s, w)[0]!.total.work[0]).toBeCloseTo(3 * D);
    const tu = taskUsage(p, s, w);
    expect(tu[0]!.total.cost[0]).toBeCloseTo(3 * 8 * 10);
  });
  it('a part-time resource gets work only in its hours and is overallocated when it cannot cope', () => {
    const p = project([{ duration: 2 * D }]);
    const part = newCalendar('Media jornada');
    part.week = [[], [{ from: 480, to: 720 }], [{ from: 480, to: 720 }], [{ from: 480, to: 720 }], [{ from: 480, to: 720 }], [{ from: 480, to: 720 }], []];
    p.calendars.push(part);
    const r = { ...newResource('Beto'), calendar: part.id };
    p.resources = [r];
    p.tasks[0]!.assignments = [newAssignment(r.id, 1)];
    const s = schedule(p);
    const use = resourceUsage(p, s, bucketsOf(MON, MON + 3, 'day'))[0]!;
    // the resource can do 4 h a day, the task asks 8 h a day: the load shows and is over the capacity
    expect(use.total.work.slice(0, 2)).toEqual([D, D]);
    expect(use.capacity.slice(0, 2)).toEqual([240, 240]);
    expect(s.overallocations.length).toBe(1);
    expect(s.overallocations[0]!.peak).toBeCloseTo(2);
    // half the units is exactly what the part-timer can do
    p.tasks[0]!.assignments = [newAssignment(r.id, 0.5)];
    expect(schedule(p).overallocations.length).toBe(0);
  });
  it('two tasks of the same resource at the same time are overallocated; a different calendar does not matter', () => {
    const p = project([{}, {}]);
    const r = newResource('Ana');
    p.resources = [r];
    p.tasks.forEach((t) => (t.assignments = [newAssignment(r.id, 1)]));
    const s = schedule(p);
    expect(s.overallocations.map((o) => o.resource)).toEqual([r.id]);
    expect(s.overallocations[0]!.peak).toBeCloseTo(2);
  });
});

describe('custom fields, filters and groups', () => {
  function plan() {
    const p = project([{ name: 'Fase', outline: 1 }, { name: 'A', outline: 2, duration: 2 * D, percent: 100 }, { name: 'B', outline: 2, duration: D, percent: 50 }, { name: 'C', outline: 1, duration: 0 }]);
    p.tasks[2]!.links = [lnk(p.tasks[1]!)];
    p.tasks[3]!.links = [lnk(p.tasks[2]!)];
    const r = { ...newResource('Ana'), rate: 10 };
    p.resources = [r];
    p.tasks[1]!.assignments = [newAssignment(r.id, 1)];
    p.customFields = [
      { id: 'f1', name: 'Prioridad', target: 'task', type: 'number', rollup: 'sum' },
      { id: 'f2', name: 'Doble', target: 'task', type: 'number', formula: '[Prioridad] * 2' },
      { id: 'f3', name: 'Estado', target: 'task', type: 'text', formula: 'IIf([% completado] = 100, "Hecha", "Pendiente")' },
      { id: 'f4', name: 'Días', target: 'task', type: 'number', formula: '[Duración]' },
    ];
    p.tasks[1]!.custom = { f1: 3 };
    p.tasks[2]!.custom = { f1: 4 };
    return p;
  }
  it('formulas use field names, functions and types', () => {
    const p = plan();
    const ctx = fieldContext(p, schedule(p), { now: T(0, 8) });
    expect(taskValue(ctx, 1, 'custom:f2')).toBe(6);
    expect(taskValue(ctx, 1, 'custom:f3')).toBe('Hecha');
    expect(taskValue(ctx, 2, 'custom:f3')).toBe('Pendiente');
    expect(taskValue(ctx, 1, 'custom:f4')).toBe(2); // durations are days inside formulas
    expect(taskValue(ctx, 0, 'custom:f1')).toBe(7); // the summary adds its sub-tasks
    expect(evalFormula('Round(10 / 3, 2) & "x"', () => undefined)).toBe('3.33x');
    expect(evalFormula('Not (1 > 2) And True', () => undefined)).toBe(true);
  });
  it('formula errors are reported', () => {
    const p = plan();
    expect(checkFormula(p, '[Nada] + 1')).toMatch(/No existe el campo/);
    expect(checkFormula(p, '1 +')).toBeTruthy();
    expect(checkFormula(p, 'Foo(1)')).toMatch(/función/);
    expect(checkFormula(p, '[Prioridad] + 1')).toBeNull();
  });
  it('built-in and custom filters keep the summaries of what they show', () => {
    const p = plan();
    p.filters = [{ id: 'mine', name: 'Hechas y con costo', mode: 'and', criteria: [{ field: 'percent', op: 'ge', value: 100 }, { field: 'cost', op: 'gt', value: 0 }] }];
    const ctx = fieldContext(p, schedule(p), { now: T(0, 8) });
    expect(filteredRows(ctx, 'milestones')).toEqual([3]);
    expect(filteredRows(ctx, 'complete')).toEqual([0, 1]);
    expect(filteredRows(ctx, 'mine')).toEqual([0, 1]);
    expect(filteredRows(ctx, 'noresources')).toEqual([0, 2, 3]);
    expect(BUILTIN_FILTERS.length).toBeGreaterThan(12);
    p.filters = [{ id: 'txt', name: 'Nombre', mode: 'or', criteria: [{ field: 'name', op: 'contains', value: 'a' }, { field: 'name', op: 'eq', value: 'c' }] }];
    expect(filteredRows(fieldContext(p, schedule(p), { now: T(0, 8) }), 'txt')).toEqual([0, 1, 3]);
  });
  it('groups tasks by a field, with intervals and totals', () => {
    const p = plan();
    const ctx = fieldContext(p, schedule(p), { now: T(0, 8) });
    const g = groupTasks(ctx, { id: 'g', name: 'Por completado', levels: [{ field: 'percent', interval: 50 }] });
    expect(g.map((n) => n.tasks.length)).toEqual([1, 1, 1]); // 0-49: the milestone, 50-99: B, 100-149: A
    const byRes = groupTasks(ctx, { id: 'g2', name: 'Por recurso', levels: [{ field: 'resources' }] });
    expect(byRes.map((n) => n.label).sort()).toEqual(['(sin valor)', 'Ana']);
    expect(byRes.find((n) => n.label === 'Ana')!.totals.cost).toBeCloseTo(160);
    const nested = groupTasks(ctx, { id: 'g3', name: 'Dos niveles', levels: [{ field: 'critical' }, { field: 'milestone' }] });
    expect(nested[0]!.children.length).toBeGreaterThan(0);
  });
});

describe('network diagram', () => {
  it('puts tasks in columns by their chain of predecessors', () => {
    const p = project([{}, {}, {}, {}]);
    p.tasks[1]!.links = [lnk(p.tasks[0]!)];
    p.tasks[2]!.links = [lnk(p.tasks[0]!)];
    p.tasks[3]!.links = [lnk(p.tasks[1]!), lnk(p.tasks[2]!)];
    const n = networkLayout(p, schedule(p));
    const col = (i: number) => n.nodes.find((x) => x.index === i)!.col;
    expect([col(0), col(1), col(2), col(3)]).toEqual([0, 1, 1, 2]);
    expect(n.edges.length).toBe(4);
    expect(n.nodes.find((x) => x.index === 1)!.row).not.toBe(n.nodes.find((x) => x.index === 2)!.row);
    expect(n.width).toBeGreaterThan(0);
    expect(n.edges.every((e) => e.points.length >= 2)).toBe(true);
  });
});

describe('splitting a task from dates', () => {
  it('computes the interruption from the split and resume dates', () => {
    const p = project([{ duration: 4 * D }]);
    const s = schedule(p);
    const r = splitTask(p, s, p.tasks[0]!.id, T(1, 8), T(3, 8));
    expect(r.error).toBeUndefined();
    expect(r.project.tasks[0]!.splits).toEqual([{ after: D, gap: 2 * D }]);
    const s2 = schedule(r.project);
    expect(s2.tasks[0]!.finish).toBe(T(7, 17)); // Monday, Thursday, Friday and the next Monday
    expect(s2.tasks[0]!.segments.length).toBe(2);
    expect(splitTask(p, s, p.tasks[0]!.id, T(10, 8), T(11, 8)).error).toBeTruthy();
  });
});

describe('files', () => {
  function full(): Project {
    const p = project([{ name: 'Fase' }, { name: 'A', outline: 2, duration: 3 * D }, { name: 'B', outline: 2, duration: 4 * H, elapsed: false }, { name: 'C', outline: 2, duration: 2 * 1440, elapsed: true }, { name: 'D', outline: 1, duration: 0 }]);
    p.tasks[2]!.links = [{ ...lnk(p.tasks[1]!, 'SS', 2 * H) }];
    p.tasks[3]!.links = [{ ...lnk(p.tasks[1]!, 'FF', -1 * H), elapsed: true }];
    p.tasks[4]!.links = [lnk(p.tasks[2]!)];
    p.tasks[1]!.type = 'work';
    p.tasks[1]!.work = 24 * H;
    p.tasks[1]!.effortDriven = true;
    p.tasks[1]!.constraint = { type: 'snet', date: T(1, 9) };
    p.tasks[1]!.deadline = T(10, 17);
    p.tasks[1]!.percent = 40;
    p.tasks[1]!.notes = 'Nota';
    p.tasks[2]!.manual = true;
    p.tasks[2]!.manualStart = T(2, 8);
    p.tasks[2]!.manualFinish = T(2, 12);
    p.tasks[1]!.fixedCost = 30;
    p.tasks[1]!.fixedCostAccrual = 'start';
    const night = twentyFourSeven();
    const part = newCalendar('Parcial');
    part.week[1] = [{ from: 480, to: 840 }];
    part.exceptions.push({ from: MON + 2, to: MON + 3, periods: [], name: 'Cierre' });
    p.calendars.push(night, part);
    p.tasks[3]!.calendar = night.id;
    const r = { ...newResource('Ana'), rate: 12.5, costPerUse: 4, maxUnits: 1.5, group: 'Dev', email: 'a@b.c', calendar: part.id };
    const m = { ...newResource('Ladrillos'), type: 'material' as const, rate: 2 };
    p.resources = [r, m];
    p.tasks[1]!.assignments = [newAssignment(r.id, 1.5), newAssignment(m.id, 10)];
    p.statusDate = T(2, 8);
    p.baselines[0] = setBaseline(p, schedule(p), 0, T(0, 8)).baselines[0]!;
    p.baselines[2] = setBaseline(p, schedule(p), 2, T(0, 9)).baselines[2]!;
    p.customFields = [{ id: 'f1', name: 'Prioridad', target: 'task', type: 'number' }];
    p.tasks[1]!.custom = { f1: 5 };
    p.filters = [{ id: 'fl', name: 'Mi filtro', mode: 'and', criteria: [{ field: 'percent', op: 'gt', value: 0 }] }];
    p.groups = [{ id: 'gr', name: 'Mi grupo', levels: [{ field: 'critical', desc: true }] }];
    p.view = { filter: 'fl', group: 'gr' };
    p.tasks[1]!.splits = [{ after: D, gap: D }];
    return p;
  }
  it('.novaplan round trips everything', () => {
    const p = full();
    const back = parseProject(serializeProject(p));
    expect(back).toEqual(p);
    expect(schedule(back).finish).toBe(schedule(p).finish);
  });
  it('rejects damaged files and repairs odd values', () => {
    expect(() => parseProject('no json')).toThrow();
    expect(() => parseProject('{"format":"x"}')).toThrow();
    const odd = JSON.parse(serializeProject(full()));
    odd.tasks[1].outline = 9;
    odd.tasks[2].duration = -5;
    odd.tasks[3].constraint = { type: 'raro', date: 'x' };
    odd.baselines = [{ date: 1, tasks: { x: { start: 'a' } } }];
    const fixed = parseProject(JSON.stringify(odd));
    expect(fixed.tasks[1]!.outline).toBe(2);
    expect(fixed.tasks[2]!.duration).toBe(0);
    expect(fixed.tasks[3]!.constraint).toEqual({ type: 'asap', date: null });
    expect(fixed.baselines.length).toBe(11);
  });
  it('opens the files of the first version: days become minutes and dates keep their day', () => {
    const v1 = {
      format: 'novaplan',
      version: 1,
      name: 'Viejo',
      start: MON,
      calendar: { workDays: [false, true, true, true, true, true, false], hoursPerDay: 8, exceptions: [{ day: MON + 1, working: false, name: 'Fiesta' }] },
      tasks: [
        { id: 'a', name: 'A', outline: 1, duration: 2, constraint: { type: 'asap', date: null }, percent: 0, links: [], assignments: [], fixedCost: 0, notes: '' },
        { id: 'b', name: 'B', outline: 1, duration: 1, constraint: { type: 'snet', date: MON + 7 }, percent: 50, links: [{ task: 'a', type: 'FS', lag: 1 }], assignments: [{ resource: 'r', units: 1 }], fixedCost: 5, notes: 'x' },
      ],
      resources: [{ id: 'r', name: 'Ana', type: 'work', maxUnits: 1, rate: 10 }],
      baseline: { a: { start: MON, finish: MON + 2, duration: 2, cost: 0 } },
      statusDate: MON + 3,
    };
    const p = parseProject(JSON.stringify(v1));
    expect(p.version).toBe(2);
    expect(p.tasks[0]!.duration).toBe(2 * D);
    expect(p.tasks[1]!.links[0]!.lag).toBe(D);
    const s = schedule(p);
    // Monday-Wednesday with Tuesday off: A = Mon, Wed
    expect(s.tasks[0]!.start).toBe(T(0, 8));
    expect(s.tasks[0]!.finish).toBe(T(2, 17));
    expect(p.baselines[0]!.tasks.a!.duration).toBe(2 * D);
    expect(p.statusDate).toBe(timeOf(MON + 3, 0));
  });
  it('MSPDI round trips calendars, hours, types, manual tasks, baselines and resources', () => {
    const p = full();
    p.customFields = [];
    p.tasks.forEach((t) => (t.custom = {}));
    p.tasks[1]!.splits = [];
    const xml = exportMspdi(p);
    expect(xml).toContain('xmlns="http://schemas.microsoft.com/project"');
    const { project: q, warnings } = importMspdi(xml);
    expect(warnings).toEqual([]);
    expect(q.tasks.map((t) => t.name)).toEqual(p.tasks.map((t) => t.name));
    expect(q.tasks.map((t) => t.outline)).toEqual(p.tasks.map((t) => t.outline));
    expect(q.tasks[1]!.type).toBe('work');
    expect(q.tasks[1]!.effortDriven).toBe(true);
    expect(q.tasks[1]!.constraint).toEqual({ type: 'snet', date: T(1, 9) });
    expect(q.tasks[1]!.deadline).toBe(T(10, 17));
    expect(q.tasks[3]!.elapsed).toBe(true);
    expect(q.tasks[3]!.duration).toBe(2 * 1440);
    expect(q.tasks[2]!.manual).toBe(true);
    expect(q.tasks[2]!.manualStart).toBe(T(2, 8));
    expect(q.tasks[1]!.fixedCostAccrual).toBe('start');
    expect(q.tasks[2]!.links[0]).toMatchObject({ type: 'SS', lag: 2 * H });
    expect(q.tasks[3]!.links[0]).toMatchObject({ type: 'FF', lag: -H, elapsed: true });
    expect(q.baselines[0]!.tasks[q.tasks[1]!.id]!.duration).toBe(p.baselines[0]!.tasks[p.tasks[1]!.id]!.duration);
    expect(q.baselines[2]).not.toBeNull();
    expect(q.baselines[1]).toBeNull();
    expect(q.statusDate).toBe(p.statusDate);
    expect(q.resources.map((r) => [r.name, r.type, r.rate, r.costPerUse, r.group, r.email])).toEqual([['Ana', 'work', 12.5, 4, 'Dev', 'a@b.c'], ['Ladrillos', 'material', 2, 0, '', '']]);
    expect(q.resources[0]!.maxUnits).toBe(1.5);
    expect(q.tasks[1]!.assignments.map((a) => a.units)).toEqual([1.5, 10]);
    // calendars: a base-less copy of each, with the exception and the working hours
    const night = q.calendars.find((c) => c.name === '24 horas')!;
    expect(q.tasks[3]!.calendar).toBe(night.id);
    const part = q.calendars.find((c) => c.name === 'Parcial')!;
    expect(q.resources[0]!.calendar).toBe(part.id);
    expect(part.exceptions.some((e) => e.from === MON + 2 && e.to === MON + 3 && e.periods.length === 0)).toBe(true);
    // the plan comes out the same
    const a = schedule(p);
    const b = schedule(q);
    expect(b.tasks.map((t) => [t.start, t.finish])).toEqual(a.tasks.map((t) => [t.start, t.finish]));
  });
  it('reads a file written by another tool: hours per day, lag formats, resource cost and unknown constraints', () => {
    const xml = `<?xml version="1.0"?><Project xmlns="http://schemas.microsoft.com/project"><Name>Ajeno</Name><StartDate>2025-03-03T09:00:00</StartDate><CalendarUID>7</CalendarUID><MinutesPerDay>420</MinutesPerDay><MinutesPerWeek>2100</MinutesPerWeek>
<Calendars><Calendar><UID>7</UID><Name>Mio</Name><IsBaseCalendar>1</IsBaseCalendar><BaseCalendarUID>-1</BaseCalendarUID><WeekDays>
<WeekDay><DayType>1</DayType><DayWorking>0</DayWorking></WeekDay><WeekDay><DayType>2</DayType><DayWorking>1</DayWorking><WorkingTimes><WorkingTime><FromTime>09:00:00</FromTime><ToTime>13:00:00</ToTime></WorkingTime><WorkingTime><FromTime>14:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes></WeekDay>
<WeekDay><DayType>3</DayType><DayWorking>1</DayWorking><WorkingTimes><WorkingTime><FromTime>09:00:00</FromTime><ToTime>13:00:00</ToTime></WorkingTime><WorkingTime><FromTime>14:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes></WeekDay>
<WeekDay><DayType>7</DayType><DayWorking>0</DayWorking></WeekDay></WeekDays></Calendar></Calendars>
<Tasks><Task><UID>0</UID><ID>0</ID><Name>Ajeno</Name></Task>
<Task><UID>1</UID><ID>1</ID><Name>Uno</Name><OutlineLevel>1</OutlineLevel><Duration>PT14H0M0S</Duration><DurationFormat>7</DurationFormat><ConstraintType>1</ConstraintType></Task>
<Task><UID>2</UID><ID>2</ID><Name>Dos</Name><OutlineLevel>1</OutlineLevel><Duration>PT7H0M0S</Duration><PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type><LinkLag>12000</LinkLag><LagFormat>5</LagFormat></PredecessorLink></Task></Tasks>
<Resources><Resource><UID>0</UID><Name>x</Name></Resource><Resource><UID>1</UID><ID>1</ID><Name>Obra</Name><Type>1</Type><MaxUnits>1</MaxUnits><StandardRate>240</StandardRate><StandardRateFormat>3</StandardRateFormat></Resource><Resource><UID>2</UID><Name>Gasto</Name><Type>2</Type></Resource></Resources></Project>`;
    const { project: q } = importMspdi(xml);
    expect(q.minutesPerDay).toBe(420);
    expect(q.tasks[0]!.duration).toBe(14 * H);
    expect(q.tasks[1]!.links[0]!.lag).toBe(1200); // 12000 tenths of a minute = 1200 min = 20 h
    expect(q.tasks[0]!.constraint.type).toBe('alap');
    expect(q.resources[1]!.type).toBe('cost');
    // 240 per day of 7 h = 34.2857 per hour
    expect(q.resources[0]!.rate).toBeCloseTo(240 / 7);
    const s = schedule(q);
    // Monday 9:00: 7 working hours a day (9-13, 14-17); 14 h = two days
    expect(s.tasks[0]!.finish).toBe(timeOf(dayOf(2025, 3, 4), 17 * 60));
  });
  it('refuses what is not Project XML and explains .mpp', () => {
    expect(() => importMspdi('<a/>')).toThrow(/mpp/);
    expect(() => importMspdi('no xml <')).toThrow();
  });
  it('CSV has a header and one row per task', () => {
    const p = full();
    const csv = exportCsv(p).trim().split('\r\n');
    expect(csv.length).toBe(p.tasks.length + 1);
    expect(csv[0]).toContain('Costo real');
  });
});

describe('subprojects', () => {
  function sub(): Project {
    const q = project([{ name: 'S1', duration: 2 * D }, { name: 'S2', duration: D }]);
    q.name = 'Sub';
    q.tasks[1]!.links = [lnk(q.tasks[0]!)];
    q.resources = [{ ...newResource('Ana'), rate: 9 }];
    q.tasks[0]!.assignments = [newAssignment(q.resources[0]!.id, 1)];
    return q;
  }
  it('inserts a project as a summary with its tasks, links and resources (matched by name)', () => {
    const p = project([{ name: 'Antes' }]);
    p.resources = [{ ...newResource('ana'), rate: 5 }];
    const r = insertProject(p, sub(), 0, 'sub.novaplan');
    expect(r.project.tasks.map((t) => t.name)).toEqual(['Antes', 'Sub', 'S1', 'S2']);
    expect(r.project.tasks[1]!.subproject).toEqual({ name: 'Sub', path: 'sub.novaplan' });
    expect(r.project.tasks[2]!.outline).toBe(2);
    expect(r.project.resources.length).toBe(1); // matched by name
    expect(r.project.tasks[3]!.links[0]!.task).toBe(r.project.tasks[2]!.id);
    const s = schedule(r.project);
    expect(s.tasks[1]!.summary).toBe(true);
    expect(s.tasks[1]!.duration).toBe(3 * D);
    expect(r.project.tasks[2]!.origin).toBeDefined();
  });
  it('refreshing replaces the tasks and keeps links from the rest of the plan', () => {
    const p0 = project([{ name: 'Antes' }, { name: 'Despues' }]);
    const base = sub();
    const r = insertProject(p0, base, 0, null);
    let p = r.project;
    const s2 = p.tasks.find((t) => t.name === 'S2')!;
    const after = p.tasks.find((t) => t.name === 'Despues')!;
    p = { ...p, tasks: p.tasks.map((t) => (t.id === after.id ? { ...t, links: [lnk(s2)] } : t)) };
    const newer = { ...base, tasks: base.tasks.map((t, i) => (i === 1 ? { ...t, duration: 3 * D } : t)) };
    const out = refreshSubproject(p, p.tasks[r.index]!.id, newer);
    const s2b = out.project.tasks.find((t) => t.name === 'S2')!;
    expect(s2b.duration).toBe(3 * D);
    expect(out.project.tasks.find((t) => t.name === 'Despues')!.links[0]!.task).toBe(s2b.id);
    expect(out.project.tasks[out.index]!.id).toBe(p.tasks[r.index]!.id);
  });
});

describe('reports and links', () => {
  it('builds every report without failing, with and without baseline', () => {
    const p = project([{ duration: 2 * D, percent: 50 }, { duration: D }, { duration: 0 }]);
    p.tasks[1]!.links = [lnk(p.tasks[0]!)];
    const w = { ...newResource('Ana'), rate: 10 };
    p.resources = [w];
    p.tasks[0]!.assignments = [newAssignment(w.id, 1)];
    for (const withBaseline of [false, true]) {
      const q = withBaseline ? setBaseline(p, schedule(p), 0, T(0, 8)) : p;
      const s = schedule(q);
      for (const r of REPORTS) {
        const rep = buildReport(r.id, q, s, { now: T(1, 12) });
        expect(rep.id).toBe(r.id);
        for (const c of rep.charts) for (const sr of c.series) expect(sr.data.length).toBe(c.categories.length === 0 ? sr.data.length : c.categories.length);
      }
    }
    const rep = buildReport('overview', p, schedule(p), { now: T(1, 12) });
    expect(rep.kpis.find((k) => k.label === 'Tareas atrasadas')!.value).toBe('1'); // the milestone with no predecessor is in the past
    expect(cumulative([1, 2, 3])).toEqual([1, 3, 6]);
  });
  it('linkTasks keeps the optional elapsed flag', () => {
    const p = project([{}, {}]);
    const r = linkTasks(p, p.tasks[0]!.id, p.tasks[1]!.id, 'FS', 60, true);
    expect(r.project.tasks[1]!.links[0]).toEqual({ task: p.tasks[0]!.id, type: 'FS', lag: 60, elapsed: true });
  });
});
