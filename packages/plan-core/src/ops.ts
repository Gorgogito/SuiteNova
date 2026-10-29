import { calendarById, dayOf, dayOfTime, minuteOfTime, newAssignment, newTask, subtreeEnd, timeOf, type Assignment, type Day, type Link, type LinkType, type Project, type Task, type TaskType, type Time } from './model';
import { CalendarSet } from './calendar';
import type { Schedule } from './schedule';
import { derive, sumUnits } from './taskcalc';

/** Pure edits: every function returns a new project and leaves the argument untouched. */
const withTasks = (p: Project, tasks: Task[]): Project => ({ ...p, tasks });

export function addTask(p: Project, afterIndex: number | null, init: Partial<Task> = {}): { project: Project; index: number } {
  const ref = afterIndex !== null && p.tasks[afterIndex] ? p.tasks[afterIndex]! : null;
  const t: Task = { ...newTask(init.name ?? 'Tarea nueva', init.outline ?? ref?.outline ?? 1), duration: p.minutesPerDay, ...init };
  // a new task goes after the whole branch of the selected one
  const at = afterIndex === null || !ref ? p.tasks.length : subtreeEnd(p.tasks, afterIndex);
  const tasks = [...p.tasks];
  tasks.splice(at, 0, t);
  return { project: withTasks(p, tasks), index: at };
}

export function updateTask(p: Project, id: string, patch: Partial<Task>): Project {
  return withTasks(p, p.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
}

export function canIndent(p: Project, i: number): boolean {
  return i > 0 && p.tasks[i]!.outline <= p.tasks[i - 1]!.outline && p.tasks[i]!.outline < 9;
}
export const canOutdent = (p: Project, i: number): boolean => p.tasks[i]!.outline > 1;

/** Indent or outdent a task together with its sub-tasks. */
export function shiftOutline(p: Project, i: number, delta: 1 | -1): Project {
  if (delta === 1 ? !canIndent(p, i) : !canOutdent(p, i)) return p;
  const end = subtreeEnd(p.tasks, i);
  return withTasks(p, p.tasks.map((t, k) => (k >= i && k < end ? { ...t, outline: t.outline + delta } : t)));
}

/** Move a task (with its branch) above the previous task of the same level, or below the next one. */
export function moveBranch(p: Project, i: number, dir: -1 | 1): { project: Project; index: number } {
  const t = p.tasks;
  const level = t[i]!.outline;
  const end = subtreeEnd(t, i);
  if (dir === -1) {
    let j = i - 1;
    while (j >= 0 && t[j]!.outline > level) j--;
    if (j < 0 || t[j]!.outline < level) return { project: p, index: i };
    const block = t.slice(i, end);
    const rest = [...t.slice(0, i), ...t.slice(end)];
    rest.splice(j, 0, ...block);
    return { project: withTasks(p, rest), index: j };
  }
  if (end >= t.length || t[end]!.outline < level) return { project: p, index: i };
  const nextEnd = subtreeEnd(t, end);
  const block = t.slice(i, end);
  const rest = [...t.slice(0, i), ...t.slice(end)];
  const at = i + (nextEnd - end);
  rest.splice(at, 0, ...block);
  return { project: withTasks(p, rest), index: at };
}

/** Delete tasks and their branches; links that pointed at them disappear. */
export function deleteTasks(p: Project, ids: string[]): Project {
  const drop = new Set<string>();
  p.tasks.forEach((t, i) => {
    if (ids.includes(t.id)) for (let k = i; k < subtreeEnd(p.tasks, i); k++) drop.add(p.tasks[k]!.id);
  });
  const tasks = p.tasks.filter((t) => !drop.has(t.id)).map((t) => ({ ...t, links: t.links.filter((l) => !drop.has(l.task)) }));
  const baselines = p.baselines.map((b) => {
    if (!b) return b;
    const copy = { ...b, tasks: { ...b.tasks } };
    for (const id of drop) delete copy.tasks[id];
    return copy;
  });
  return { ...p, tasks, baselines };
}

/** Would adding a link from `from` to `to` close a cycle? */
export function wouldCycle(p: Project, from: string, to: string): boolean {
  if (from === to) return true;
  const succ = new Map<string, string[]>();
  for (const t of p.tasks) for (const l of t.links) (succ.get(l.task) ?? succ.set(l.task, []).get(l.task)!).push(t.id);
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length) {
    const x = stack.pop()!;
    if (x === from) return true;
    if (seen.has(x)) continue;
    seen.add(x);
    for (const y of succ.get(x) ?? []) stack.push(y);
  }
  return false;
}

export function linkTasks(p: Project, from: string, to: string, type: LinkType = 'FS', lag = 0, elapsed = false): { project: Project; error?: string } {
  const a = p.tasks.findIndex((t) => t.id === from);
  const b = p.tasks.findIndex((t) => t.id === to);
  if (a < 0 || b < 0) return { project: p, error: 'La tarea no existe.' };
  if ((a + 1 < p.tasks.length && p.tasks[a + 1]!.outline > p.tasks[a]!.outline) || (b + 1 < p.tasks.length && p.tasks[b + 1]!.outline > p.tasks[b]!.outline)) return { project: p, error: 'No se pueden vincular tareas de resumen.' };
  if (p.tasks[b]!.links.some((l) => l.task === from)) return { project: p, error: 'Esas tareas ya están vinculadas.' };
  if (wouldCycle(p, from, to)) return { project: p, error: 'Ese vínculo crearía una referencia circular.' };
  const link: Link = { task: from, type, lag, ...(elapsed ? { elapsed: true } : {}) };
  return { project: updateTask(p, to, { links: [...p.tasks[b]!.links, link] }) };
}

export function unlinkTasks(p: Project, from: string, to: string): Project {
  return updateTask(p, to, { links: p.tasks.find((t) => t.id === to)!.links.filter((l) => l.task !== from) });
}

// ---------- durations, dates and links as text ----------

export interface DurationValue {
  minutes: number;
  elapsed: boolean;
}

const UNIT = '(min(?:utos?)?|m|h(?:oras?|rs?|ours?)?|d(?:[ií]as?|ays?)?|sem(?:anas?)?|w(?:eeks?)?|mes(?:es)?|mo(?:nths?)?)';

function unitMinutes(u: string, p: Pick<Project, 'minutesPerDay' | 'minutesPerWeek' | 'daysPerMonth'>, elapsed = false): number {
  const x = u.toLowerCase();
  if (x === 'm' || x.startsWith('min')) return 1;
  if (x.startsWith('h')) return 60;
  if (x.startsWith('sem') || x.startsWith('w')) return elapsed ? 7 * 1440 : p.minutesPerWeek;
  if (x.startsWith('mes') || x.startsWith('mo')) return elapsed ? 30 * 1440 : p.minutesPerDay * p.daysPerMonth;
  return elapsed ? 1440 : p.minutesPerDay;
}

/** "5", "3d", "2sem", "12h", "90 min", "1.5 días", "3ed" (elapsed days), "2 meses" to minutes. Null when it is not a duration. */
export function parseDuration(text: string, p: Pick<Project, 'minutesPerDay' | 'minutesPerWeek' | 'daysPerMonth'>): DurationValue | null {
  const m = new RegExp(`^\\s*(\\d+(?:[.,]\\d+)?)\\s*(e)?\\s*${UNIT}?\\s*$`, 'i').exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  const per = m[3] ? unitMinutes(m[3], p, !!m[2]) : m[2] ? 1440 : p.minutesPerDay;
  return { minutes: Math.round(n * per), elapsed: !!m[2] };
}

const trimNum = (n: number): string => String(Math.round(n * 100) / 100).replace('.', ',');

/** Minutes to "3d", "4h", "1,5d", "30min"; an elapsed duration gets an "e" ("3ed"). */
export function formatDuration(minutes: number, elapsed: boolean, p: Pick<Project, 'minutesPerDay'>): string {
  const e = elapsed ? 'e' : '';
  if (minutes === 0) return `0${e}d`;
  if (elapsed) {
    if (minutes % 1440 === 0) return `${minutes / 1440}ed`;
    if (minutes % 60 === 0) return `${minutes / 60}eh`;
    return `${minutes}emin`;
  }
  if (minutes % p.minutesPerDay === 0) return `${minutes / p.minutesPerDay}d`;
  if (minutes < p.minutesPerDay && minutes % 60 === 0) return `${minutes / 60}h`;
  if (minutes < 60) return `${minutes}min`;
  return `${trimNum(minutes / p.minutesPerDay)}d`;
}

export const formatLag = (lag: number, elapsed: boolean | undefined, p: Pick<Project, 'minutesPerDay'>, percent?: boolean): string => (lag === 0 ? '' : percent ? `${lag > 0 ? '+' : '-'}${Math.abs(lag)}%` : `${lag > 0 ? '+' : '-'}${formatDuration(Math.abs(lag), !!elapsed, p)}`);

const TYPE_ES: Record<string, LinkType> = { FS: 'FS', CF: 'FS', SS: 'SS', CC: 'SS', FF: 'FF', FC: 'FF', SF: 'SF', CF2: 'SF' };

/** "3", "3FS+2d", "5SS-1d", "2FF+3ed" (row numbers, 1-based) to links. */
export function parsePredecessors(text: string, p: Project, selfIndex: number): { links: Link[]; error?: string } {
  const links: Link[] = [];
  for (const raw of text.split(/[,;]/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = new RegExp(`^(\\d+)\\s*([A-Za-z]{2})?\\s*(?:([+-])\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:(%)|(e)?\\s*${UNIT}?))?$`, 'i').exec(part);
    if (!m) return { links: [], error: `No se entiende "${part}". Ejemplos: 3, 3FS+2d, 5SS-1d, 2FF+4h.` };
    const row = Number(m[1]);
    const target = p.tasks[row - 1];
    if (!target) return { links: [], error: `La fila ${row} no existe.` };
    if (row - 1 === selfIndex) return { links: [], error: 'Una tarea no puede ser predecesora de sí misma.' };
    const type = m[2] ? TYPE_ES[m[2].toUpperCase()] : 'FS';
    if (!type) return { links: [], error: `Tipo de vínculo desconocido: ${m[2]}.` };
    let lag = 0;
    if (m[4] && m[5]) {
      lag = Math.round(Number(m[4].replace(',', '.')));
      if (m[3] === '-') lag = -lag;
    } else if (m[4]) {
      const per = m[7] ? unitMinutes(m[7], p, !!m[6]) : m[6] ? 1440 : p.minutesPerDay;
      lag = Math.round(Number(m[4].replace(',', '.')) * per);
      if (m[3] === '-') lag = -lag;
    }
    links.push({ task: target.id, type, lag, ...(m[4] && m[5] ? { percent: true } : m[6] ? { elapsed: true } : {}) });
  }
  return { links };
}

export function formatPredecessors(p: Project, t: Task): string {
  return t.links
    .map((l) => {
      const row = p.tasks.findIndex((x) => x.id === l.task) + 1;
      if (row <= 0) return '';
      return `${row}${l.type === 'FS' && l.lag === 0 ? '' : l.type}${formatLag(l.lag, l.elapsed, p, l.percent)}`;
    })
    .filter(Boolean)
    .join(';');
}

/** ISO (2025-03-14, 2025-03-14 10:30) or day-first (14/03/2025, 14/03/2025 10:30, 14-3-25) to a time; `defaultMinute` when no hour is given. */
export function parseDateTime(text: string, defaultMinute = 480): Time | null {
  const t = text.trim();
  let hh = defaultMinute;
  let rest = t;
  const hm = /[T\s]+(\d{1,2}):(\d{2})\s*$/.exec(t);
  if (hm) {
    const h = +hm[1]!;
    const mi = +hm[2]!;
    if (h > 23 || mi > 59) return null;
    hh = h * 60 + mi;
    rest = t.slice(0, hm.index).trim();
  }
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(rest);
  let day: Day | null = null;
  if (m) day = validDay(+m[1]!, +m[2]!, +m[3]!);
  else {
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(rest);
    if (m) day = validDay(m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!, +m[2]!, +m[1]!);
  }
  return day === null ? null : timeOf(day, hh);
}

/** Kept for callers that only deal with whole days. */
export const parseDateText = (text: string): number | null => {
  const t = parseDateTime(text, 0);
  return t === null ? null : dayOfTime(t);
};

function validDay(y: number, mo: number, d: number): number | null {
  const day = dayOf(y, mo, d);
  const back = new Date(day * 86400000);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? day : null;
}

export const formatDate = (day: Day): string => {
  const x = new Date(day * 86400000);
  return `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}/${x.getUTCFullYear()}`;
};
export const formatClock = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export const formatTime = (t: Time, withHour = true): string => (withHour ? `${formatDate(dayOfTime(t))} ${formatClock(minuteOfTime(t))}` : formatDate(dayOfTime(t)));

// ---------- the rules of the task types ----------

/** Set the duration. With fixed work the units follow (the same work in a different time); otherwise work follows. */
export function setDuration(p: Project, id: string, minutes: number, elapsed?: boolean): Project {
  const t = p.tasks.find((x) => x.id === id);
  if (!t) return p;
  const patch: Partial<Task> = { duration: Math.max(0, Math.round(minutes)) };
  if (elapsed !== undefined) patch.elapsed = elapsed;
  const d = derive(t, p.resources);
  if (t.type === 'work' && t.work !== null && d.units > 0 && minutes > 0) {
    // keep the work and change the units: units × duration = work
    const factor = d.duration / minutes;
    const assignments = t.assignments.map((a) => (p.resources.find((r) => r.id === a.resource)?.type === 'work' ? { ...a, units: round3(a.units * factor) } : a));
    return updateTask(p, id, { ...patch, assignments });
  }
  // fixed units or fixed duration: work = units × duration, so a stored work value no longer applies
  return updateTask(p, id, { ...patch, work: t.effortDriven && t.type === 'units' ? null : t.work });
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Set the work (minutes). Fixed units: the duration changes; fixed duration: the units change; fixed work: the work is the value. */
export function setWork(p: Project, id: string, minutes: number): Project {
  const t = p.tasks.find((x) => x.id === id);
  if (!t) return p;
  const w = Math.max(0, Math.round(minutes));
  const units = sumUnits(t, p.resources);
  if (units <= 0) return updateTask(p, id, { work: w, type: t.type });
  if (t.type === 'duration') {
    const cur = derive(t, p.resources).work;
    const f = cur > 0 ? w / cur : 1;
    const assignments = t.assignments.map((a) => (p.resources.find((r) => r.id === a.resource)?.type === 'work' ? { ...a, units: round3(a.units * f) } : a));
    return updateTask(p, id, { assignments, work: null });
  }
  if (t.type === 'work') return updateTask(p, id, { work: w });
  return updateTask(p, id, { duration: Math.ceil(w / units), work: t.effortDriven ? w : null });
}

/** Change the task type, keeping what the task is today (duration and work). */
export function setTaskType(p: Project, id: string, type: TaskType): Project {
  const t = p.tasks.find((x) => x.id === id);
  if (!t) return p;
  const d = derive(t, p.resources);
  return updateTask(p, id, { type, duration: d.duration, work: type === 'work' || (type === 'units' && t.effortDriven) ? d.work : null });
}

export function setEffortDriven(p: Project, id: string, on: boolean): Project {
  const t = p.tasks.find((x) => x.id === id);
  if (!t) return p;
  const d = derive(t, p.resources);
  return updateTask(p, id, { effortDriven: on, work: on && t.type === 'units' ? d.work : t.type === 'work' ? t.work : null });
}

/**
 * Replace the assignments of a task. When the task is effort-driven (or has fixed work) adding or removing resources keeps the
 * total work: the duration changes with fixed units, the units are shared with fixed duration.
 */
export function setAssignments(p: Project, id: string, assignments: Assignment[]): Project {
  const t = p.tasks.find((x) => x.id === id);
  if (!t) return p;
  const before = derive(t, p.resources);
  const known = assignments.filter((a) => a.units > 0 && p.resources.some((r) => r.id === a.resource));
  const next: Task = { ...t, assignments: known };
  const after = sumUnits(next, p.resources);
  const keepWork = (t.effortDriven || t.type === 'work') && before.work > 0 && after > 0 && before.units > 0;
  if (!keepWork) return updateTask(p, id, { assignments: known, work: t.type === 'work' ? (t.work ?? (after > 0 ? derive({ ...next, work: null }, p.resources).work : null)) : null });
  if (t.type === 'duration') {
    // same work in the same time: the units are spread over the resources
    const f = before.work / (after * Math.max(1, t.duration));
    return updateTask(p, id, { assignments: known.map((a) => (p.resources.find((r) => r.id === a.resource)?.type === 'work' ? { ...a, units: round3(a.units * f) } : a)), work: null });
  }
  return updateTask(p, id, { assignments: known, work: before.work });
}

export function assignResource(p: Project, id: string, resource: string, units = 1): Project {
  const t = p.tasks.find((x) => x.id === id);
  if (!t) return p;
  const rest = t.assignments.filter((a) => a.resource !== resource);
  return setAssignments(p, id, [...rest, newAssignment(resource, units)]);
}

export function setPercent(p: Project, id: string, percent: number): Project {
  return updateTask(p, id, { percent: Math.max(0, Math.min(100, Math.round(percent))) });
}

export function deleteResource(p: Project, id: string): Project {
  return { ...p, resources: p.resources.filter((r) => r.id !== id), tasks: p.tasks.map((t) => (t.assignments.some((a) => a.resource === id) ? { ...t, assignments: t.assignments.filter((a) => a.resource !== id) } : t)) };
}

// ---------- baselines ----------

/** Save the current plan as baseline `index` (0 = "Baseline", 1–10). With `ids` only those tasks (and their summaries) are saved over the old one. */
export function setBaseline(p: Project, s: Schedule, index: number, date: Time, ids?: string[]): Project {
  if (index < 0 || index >= p.baselines.length) return p;
  const entries: NonNullable<Project['baselines'][number]>['tasks'] = {};
  const old = p.baselines[index];
  const only = ids ? new Set(ids) : null;
  if (only) {
    // a summary stays in step with the tasks that were saved
    p.tasks.forEach((t, i) => {
      if (only.has(t.id)) for (let k = i; k < subtreeEnd(p.tasks, i); k++) only.add(p.tasks[k]!.id);
    });
  }
  s.tasks.forEach((t, i) => {
    const id = p.tasks[i]!.id;
    if (only && !only.has(id) && old?.tasks[id]) {
      entries[id] = old.tasks[id]!;
      return;
    }
    if (only && !only.has(id)) return;
    entries[id] = { start: t.start, finish: t.finish, duration: t.duration, work: t.work, cost: t.cost };
  });
  const baselines = [...p.baselines];
  baselines[index] = { date, tasks: entries };
  return { ...p, baselines };
}

export function clearBaseline(p: Project, index: number): Project {
  if (!p.baselines[index]) return p;
  const baselines = [...p.baselines];
  baselines[index] = null;
  return { ...p, baselines };
}

export const baselineName = (index: number): string => (index === 0 ? 'Línea base' : `Línea base ${index}`);

// ---------- splitting a task ----------

/** Stop the task at `splitAt` and resume it at `resumeAt`. */
export function splitTask(p: Project, s: Schedule, id: string, splitAt: Time, resumeAt: Time): { project: Project; error?: string } {
  const i = p.tasks.findIndex((t) => t.id === id);
  const st = s.tasks[i];
  if (!st || st.summary || st.milestone) return { project: p, error: 'Solo se pueden dividir tareas con duración.' };
  if (resumeAt <= splitAt) return { project: p, error: 'La tarea debe continuar después del punto de división.' };
  const cal = p.tasks[i]!.elapsed ? s.calendars.elapsed : s.calendars.get(p.tasks[i]!.calendar);
  // working time of the task that is already done at the split point
  let after = 0;
  for (const seg of st.segments) after += cal.workBetween(seg.start, Math.min(splitAt, seg.finish));
  if (after <= 0 || after >= st.duration) return { project: p, error: 'El punto de división debe quedar dentro de la tarea.' };
  const gap = cal.workBetween(splitAt, resumeAt);
  const splits = [...p.tasks[i]!.splits.filter((x) => x.after !== after), { after, gap }].sort((a, b) => a.after - b.after);
  return { project: updateTask(p, id, { splits }) };
}

export function removeSplits(p: Project, id: string): Project {
  return updateTask(p, id, { splits: [] });
}

// ---------- calendars ----------

/** The calendar of a task or resource (null = the project's). */
export const calendarOf = (p: Project, id: string | null) => calendarById(p, id);

type DayBasis = Pick<Project, 'minutesPerDay' | 'minutesPerWeek' | 'daysPerMonth'>;
const basisCache = new WeakMap<object, Map<string, DayBasis>>();

/**
 * What a "day" is for a task: the project's hours per day, or, when the project asks for it, the average
 * working day of the task's own calendar. Pass the result where a project is expected by `parseDuration`
 * and `formatDuration`.
 */
export function dayBasis(p: Project, task: Pick<Task, 'calendar' | 'elapsed'> | null | undefined): DayBasis {
  if (!p.taskCalendarDays || !task || task.elapsed || !task.calendar || task.calendar === p.calendar) return p;
  let m = basisCache.get(p.calendars);
  if (!m) basisCache.set(p.calendars, (m = new Map()));
  const hit = m.get(task.calendar);
  if (hit) return hit;
  const set = new CalendarSet(p.calendars, p.calendar);
  const cal = set.get(task.calendar);
  let total = 0;
  let days = 0;
  for (let d = 3; d < 10; d++) {
    const w = cal.workInDay(d);
    total += w;
    if (w > 0) days++;
  }
  const out: DayBasis = days ? { minutesPerDay: Math.round(total / days), minutesPerWeek: total, daysPerMonth: p.daysPerMonth } : p;
  m.set(task.calendar, out);
  return out;
}
