import { dayBasis } from './ops';
import { validZone } from './zone';
import {
  BASELINES, STANDARD_CALENDAR_ID, dayOf, isoOfTime, newId, newProject, standardCalendar, timeOf,
  type Accrual, type Assignment, type Baseline, type CalendarDef, type ConstraintType, type CustomFieldDef, type CustomValue, type FilterDef, type GroupDef, type Link, type LinkType, type Project, type Resource, type Task, type TaskType, type Time, type WorkPeriod,
} from './model';
import { normalizePeriods } from './calendar';
import { formatDuration, formatPredecessors } from './ops';
import { durationLabel, schedule } from './schedule';

// ---------- .novaplan ----------

export function serializeProject(p: Project): string {
  return JSON.stringify({ format: 'novaplan', ...p }, null, 1);
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const bool = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d);
const timeOrNull = (v: unknown): Time | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pick = <T extends string>(v: unknown, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d);

const CONSTRAINTS = ['asap', 'alap', 'snet', 'snlt', 'fnet', 'fnlt', 'mso', 'mfo'] as const;
const TASK_TYPES = ['units', 'duration', 'work'] as const;
const ACCRUALS = ['start', 'prorated', 'end'] as const;

const periodsOf = (v: unknown): WorkPeriod[] =>
  Array.isArray(v) ? normalizePeriods(v.filter((x: any) => typeof x?.from === 'number' && typeof x?.to === 'number').map((x: any) => ({ from: x.from, to: x.to }))) : [];

function sanitizeCalendar(raw: any): CalendarDef {
  const week: (WorkPeriod[] | null)[] = Array.from({ length: 7 }, (_, i) => (Array.isArray(raw?.week) && raw.week[i] === null ? null : periodsOf(raw?.week?.[i])));
  return {
    id: str(raw?.id) || newId('c'),
    name: str(raw?.name, 'Calendario'),
    base: typeof raw?.base === 'string' ? raw.base : null,
    week,
    exceptions: Array.isArray(raw?.exceptions)
      ? raw.exceptions.filter((e: any) => typeof e?.from === 'number' && typeof e?.to === 'number').map((e: any) => ({ from: e.from, to: Math.max(e.from, e.to), periods: periodsOf(e.periods), name: typeof e.name === 'string' ? e.name : undefined }))
      : [],
  };
}

function sanitizeCustomMap(v: unknown): Record<string, CustomValue> {
  const out: Record<string, CustomValue> = {};
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (x === null || ['string', 'number', 'boolean'].includes(typeof x)) out[k] = x as CustomValue;
  return out;
}

function sanitizeTask(r: any, ids: Set<string>): Task {
  let id = str(r?.id) || newId('t');
  while (ids.has(id)) id = newId('t');
  ids.add(id);
  const ct = pick<ConstraintType>(r?.constraint?.type, CONSTRAINTS, 'asap');
  const assignments: Assignment[] = Array.isArray(r?.assignments)
    ? r.assignments.filter((a: any) => typeof a?.resource === 'string').map((a: any): Assignment => ({ resource: a.resource, units: num(a.units, 1), actualWork: timeOrNull(a.actualWork), actualCost: timeOrNull(a.actualCost) }))
    : [];
  const links: Link[] = Array.isArray(r?.links)
    ? r.links.filter((l: any) => typeof l?.task === 'string').map((l: any): Link => ({ task: l.task, type: pick<LinkType>(l.type, ['FS', 'SS', 'FF', 'SF'] as const, 'FS'), lag: Math.round(num(l.lag)), ...(l.elapsed ? { elapsed: true } : {}), ...(l.percent ? { percent: true } : {}) }))
    : [];
  const t: Task = {
    id,
    name: str(r?.name),
    outline: Math.min(9, Math.max(1, Math.round(num(r?.outline, 1)))),
    duration: Math.max(0, Math.round(num(r?.duration, 480))),
    elapsed: bool(r?.elapsed),
    type: pick<TaskType>(r?.type, TASK_TYPES, 'units'),
    effortDriven: bool(r?.effortDriven),
    work: timeOrNull(r?.work),
    constraint: { type: ct, date: ct === 'asap' || ct === 'alap' ? null : timeOrNull(r?.constraint?.date) },
    deadline: timeOrNull(r?.deadline),
    manual: bool(r?.manual),
    manualStart: timeOrNull(r?.manualStart),
    manualFinish: timeOrNull(r?.manualFinish),
    percent: Math.min(100, Math.max(0, num(r?.percent))),
    links,
    assignments,
    fixedCost: num(r?.fixedCost),
    fixedCostAccrual: pick<Accrual>(r?.fixedCostAccrual, ACCRUALS, 'prorated'),
    actualStart: timeOrNull(r?.actualStart),
    actualFinish: timeOrNull(r?.actualFinish),
    actualWork: timeOrNull(r?.actualWork),
    actualCost: timeOrNull(r?.actualCost),
    calendar: typeof r?.calendar === 'string' ? r.calendar : null,
    splits: Array.isArray(r?.splits) ? r.splits.filter((s: any) => num(s?.after) > 0).map((s: any) => ({ after: Math.round(s.after), gap: Math.max(0, Math.round(num(s.gap))) })) : [],
    notes: str(r?.notes),
    custom: sanitizeCustomMap(r?.custom),
  };
  if (typeof r?.priority === 'number' && r.priority !== 500) t.priority = Math.min(1000, Math.max(0, Math.round(r.priority)));
  if (typeof r?.levelDelay === 'number' && r.levelDelay > 0) t.levelDelay = Math.round(r.levelDelay);
  if (r?.subproject && typeof r.subproject === 'object') t.subproject = { name: str(r.subproject.name), path: typeof r.subproject.path === 'string' ? r.subproject.path : null, ...(r.subproject.live === true ? { live: true } : {}), ...(typeof r.subproject.stamp === 'string' ? { stamp: r.subproject.stamp } : {}) };
  if (typeof r?.origin === 'string') t.origin = r.origin;
  return t;
}

function sanitizeResource(r: any): Resource {
  return {
    id: str(r?.id) || newId('r'),
    name: str(r?.name),
    type: r?.type === 'material' ? 'material' : r?.type === 'cost' ? 'cost' : 'work',
    maxUnits: num(r?.maxUnits, 1),
    rate: num(r?.rate),
    costPerUse: num(r?.costPerUse),
    calendar: typeof r?.calendar === 'string' ? r.calendar : null,
    group: str(r?.group),
    email: str(r?.email),
    custom: sanitizeCustomMap(r?.custom),
  };
}

function sanitizeBaseline(raw: any): Baseline | null {
  if (!raw || typeof raw !== 'object' || typeof raw.tasks !== 'object' || !raw.tasks) return null;
  const tasks: Baseline['tasks'] = {};
  for (const [id, e] of Object.entries<any>(raw.tasks)) {
    if (typeof e?.start !== 'number' || typeof e?.finish !== 'number') continue;
    tasks[id] = { start: e.start, finish: e.finish, duration: Math.max(0, num(e.duration)), work: Math.max(0, num(e.work)), cost: num(e.cost) };
  }
  return { date: num(raw.date), tasks };
}

/** Outline levels cannot jump more than one level down and the first task is top level. */
function fixOutline(tasks: Task[]): void {
  if (tasks[0]) tasks[0].outline = 1;
  for (let i = 1; i < tasks.length; i++) tasks[i]!.outline = Math.min(tasks[i]!.outline, tasks[i - 1]!.outline + 1);
}

/** Files written by Nova Plan before hours and calendars existed: durations in days, dates in whole days. */
function migrateV1(raw: any): Project {
  const cal = raw.calendar ?? {};
  const hpd = num(cal.hoursPerDay, 8) > 0 ? num(cal.hoursPerDay, 8) : 8;
  const mpd = Math.round(hpd * 60);
  const day: WorkPeriod[] = hpd >= 6 ? [{ from: 480, to: 720 }, { from: 780, to: 780 + Math.round((hpd - 4) * 60) }] : [{ from: 480, to: 480 + mpd }];
  const wd: boolean[] = Array.isArray(cal.workDays) && cal.workDays.length === 7 ? cal.workDays.map(Boolean) : [false, true, true, true, true, true, false];
  const def: CalendarDef = {
    id: STANDARD_CALENDAR_ID,
    name: 'Estándar',
    base: null,
    week: wd.map((w) => (w ? day.map((x) => ({ ...x })) : [])),
    exceptions: Array.isArray(cal.exceptions) ? cal.exceptions.filter((e: any) => typeof e?.day === 'number').map((e: any) => ({ from: e.day, to: e.day, periods: e.working ? day.map((x) => ({ ...x })) : [], name: typeof e.name === 'string' ? e.name : undefined })) : [],
  };
  const dayStart = (d: number): Time => timeOf(d, day[0]!.from);
  const dayEnd = (d: number): Time => timeOf(d, day[day.length - 1]!.to);
  const p = newProject(str(raw.name, 'Proyecto'), dayStart(num(raw.start, dayOf(2025, 1, 6))));
  p.calendars = [def];
  p.minutesPerDay = mpd;
  p.minutesPerWeek = mpd * Math.max(1, wd.filter(Boolean).length);
  const ids = new Set<string>();
  const tasks: Task[] = (raw.tasks as any[]).map((r) => {
    const t = sanitizeTask({ ...r, duration: Math.round(num(r?.duration, 1) * mpd), constraint: { type: r?.constraint?.type, date: typeof r?.constraint?.date === 'number' ? timeOf(r.constraint.date, 0) : null }, links: Array.isArray(r?.links) ? r.links.map((l: any) => ({ ...l, lag: Math.round(num(l?.lag) * mpd) })) : [] }, ids);
    return t;
  });
  fixOutline(tasks);
  p.tasks = tasks;
  p.resources = Array.isArray(raw.resources) ? raw.resources.map(sanitizeResource) : [];
  if (raw.baseline && typeof raw.baseline === 'object') {
    const entries: Baseline['tasks'] = {};
    for (const [id, e] of Object.entries<any>(raw.baseline)) if (typeof e?.start === 'number' && typeof e?.finish === 'number') entries[id] = { start: dayStart(e.start), finish: dayEnd(e.finish), duration: Math.round(num(e.duration) * mpd), work: 0, cost: num(e.cost) };
    p.baselines[0] = { date: dayStart(num(raw.start)), tasks: entries };
  }
  p.statusDate = typeof raw.statusDate === 'number' ? timeOf(raw.statusDate, 0) : null;
  return p;
}

export function parseProject(text: string): Project {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un proyecto de Nova Plan (JSON no válido).');
  }
  if (!raw || raw.format !== 'novaplan' || !Array.isArray(raw.tasks)) throw new Error('El archivo no es un proyecto de Nova Plan.');
  if (raw.version !== 2) return migrateV1(raw);
  const base = newProject(str(raw.name, 'Proyecto'), num(raw.start, timeOf(dayOf(2025, 1, 6), 480)));
  const calendars: CalendarDef[] = Array.isArray(raw.calendars) && raw.calendars.length ? raw.calendars.map(sanitizeCalendar) : [standardCalendar()];
  const calendar = calendars.some((c) => c.id === raw.calendar) ? (raw.calendar as string) : calendars[0]!.id;
  const ids = new Set<string>();
  const tasks: Task[] = raw.tasks.map((r: any) => sanitizeTask(r, ids));
  fixOutline(tasks);
  const baselines: (Baseline | null)[] = Array.from({ length: BASELINES }, (_, i) => sanitizeBaseline(Array.isArray(raw.baselines) ? raw.baselines[i] : null));
  const customFields: CustomFieldDef[] = Array.isArray(raw.customFields)
    ? raw.customFields.filter((c: any) => typeof c?.id === 'string' && typeof c?.name === 'string').map((c: any): CustomFieldDef => ({ id: c.id, name: c.name, target: c.target === 'resource' ? 'resource' : 'task', type: pick(c.type, ['text', 'number', 'cost', 'date', 'flag', 'duration', 'list'] as const, 'text'), ...(Array.isArray(c.list) ? { list: c.list.map(String) } : {}), ...(typeof c.formula === 'string' && c.formula ? { formula: c.formula } : {}), ...(['sum', 'max', 'min', 'avg', 'count'].includes(c.rollup) ? { rollup: c.rollup } : {}) }))
    : [];
  const filters: FilterDef[] = Array.isArray(raw.filters)
    ? raw.filters.filter((f: any) => typeof f?.id === 'string').map((f: any): FilterDef => ({ id: f.id, name: str(f.name, 'Filtro'), mode: f.mode === 'or' ? 'or' : 'and', criteria: Array.isArray(f.criteria) ? f.criteria.filter((c: any) => typeof c?.field === 'string').map((c: any) => ({ field: c.field, op: str(c.op, 'eq'), value: c.value ?? null })) : [] }))
    : [];
  const groups: GroupDef[] = Array.isArray(raw.groups)
    ? raw.groups.filter((g: any) => typeof g?.id === 'string').map((g: any): GroupDef => ({ id: g.id, name: str(g.name, 'Agrupación'), levels: Array.isArray(g.levels) ? g.levels.filter((l: any) => typeof l?.field === 'string').map((l: any) => ({ field: l.field, ...(l.desc ? { desc: true } : {}), ...(typeof l.interval === 'number' ? { interval: l.interval } : {}) })) : [] }))
    : [];
  return {
    ...base,
    calendars,
    calendar,
    minutesPerDay: num(raw.minutesPerDay, 480) > 0 ? Math.round(num(raw.minutesPerDay, 480)) : 480,
    minutesPerWeek: num(raw.minutesPerWeek, 2400) > 0 ? Math.round(num(raw.minutesPerWeek, 2400)) : 2400,
    daysPerMonth: num(raw.daysPerMonth, 20) > 0 ? num(raw.daysPerMonth, 20) : 20,
    tasks,
    resources: Array.isArray(raw.resources) ? raw.resources.map(sanitizeResource) : [],
    baselines,
    statusDate: timeOrNull(raw.statusDate),
    customFields,
    filters,
    groups,
    view: { filter: typeof raw.view?.filter === 'string' ? raw.view.filter : null, group: typeof raw.view?.group === 'string' ? raw.view.group : null },
    currency: str(raw.currency, '€') || '€',
    ...(raw.resourceCalendars === true ? { resourceCalendars: true } : {}),
    ...(raw.taskCalendarDays === true ? { taskCalendarDays: true } : {}),
    ...(typeof raw.timeZone === 'string' && validZone(raw.timeZone) ? { timeZone: raw.timeZone } : {}),
    ...(raw.weightedEarnedValue === true ? { weightedEarnedValue: true } : {}),
  };
}

// ---------- CSV ----------

const csvCell = (v: string | number): string => {
  const s = String(v);
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function exportCsv(p: Project): string {
  const s = schedule(p);
  const rows = [['EDT', 'Nombre', 'Duración', 'Inicio', 'Fin', '% completado', 'Predecesoras', 'Recursos', 'Trabajo (h)', 'Costo', 'Costo real', 'Crítica']];
  s.tasks.forEach((t, i) => {
    const task = p.tasks[i]!;
    const res = task.assignments.map((a) => p.resources.find((r) => r.id === a.resource)?.name ?? '').filter(Boolean).join(';');
    rows.push([
      t.wbs,
      '  '.repeat(t.outline - 1) + task.name,
      formatDuration(t.duration, task.elapsed, dayBasis(p, task)),
      isoOfTime(t.start).replace('T', ' ').slice(0, 16),
      isoOfTime(t.finish).replace('T', ' ').slice(0, 16),
      String(t.percent),
      formatPredecessors(p, task),
      res,
      String(Math.round((t.work / 60) * 100) / 100),
      t.cost.toFixed(2),
      t.actualCost.toFixed(2),
      t.critical ? 'Sí' : 'No',
    ]);
  });
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

export const summaryLine = (p: Project): string => {
  const s = schedule(p);
  return `${isoOfTime(s.start).replace('T', ' ').slice(0, 16)} – ${isoOfTime(s.finish).replace('T', ' ').slice(0, 16)} · ${durationLabel(s.duration, p.minutesPerDay)}`;
};
