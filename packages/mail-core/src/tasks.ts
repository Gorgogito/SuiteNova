/**
 * Tasks that come back: when the next one is due once this one is done, as Outlook does. What has been done stays as a
 * task of its own and the one that repeats moves on.
 */
import { expandEvent, newEvent, newId, type TaskItem } from './ics';
import type { MailData } from './store';

/** What the form offers; any other rule of a file is kept as it is. */
export const TASK_REPEATS: { rrule: string; label: string }[] = [
  { rrule: '', label: 'No se repite' },
  { rrule: 'FREQ=DAILY', label: 'Todos los días' },
  { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', label: 'Los días laborables' },
  { rrule: 'FREQ=WEEKLY', label: 'Todas las semanas' },
  { rrule: 'FREQ=MONTHLY', label: 'Todos los meses' },
  { rrule: 'FREQ=YEARLY', label: 'Todos los años' },
];

const parts = (rrule: string): Map<string, string> =>
  new Map(
    rrule
      .split(';')
      .map((x) => x.split('='))
      .filter((x) => x.length === 2)
      .map(([k, v]) => [k!.toUpperCase(), v!.toUpperCase()]),
  );
const join = (m: Map<string, string>): string => [...m].map(([k, v]) => `${k}=${v}`).join(';');

/** A rule the form can show: which of its choices it is, every how many, and until when. */
export function readRepeat(rrule: string): { choice: string; every: number; until: string } | null {
  const m = parts(rrule);
  const every = Number(m.get('INTERVAL') ?? 1);
  const until = /^(\d{4})(\d{2})(\d{2})/.exec(m.get('UNTIL') ?? '');
  for (const k of ['INTERVAL', 'UNTIL']) m.delete(k);
  // the day of the month is remembered by the program itself
  if (m.get('FREQ') === 'MONTHLY' || m.get('FREQ') === 'YEARLY') m.delete('BYMONTHDAY');
  const rest = join(m);
  const found = TASK_REPEATS.find((r) => r.rrule === rest);
  return found && Number.isInteger(every) && every > 0 ? { choice: found.rrule, every, until: until ? `${until[1]}-${until[2]}-${until[3]}` : '' } : null;
}

/** The rule of what the form says. The day of the month and the end of an earlier rule of the same kind are kept. */
export function writeRepeat(choice: string, every: number, until: string): string {
  if (!choice) return '';
  const m = parts(choice);
  if (every > 1) m.set('INTERVAL', String(Math.floor(every)));
  if (until) m.set('UNTIL', until.replace(/-/g, ''));
  return join(m);
}

const midnight = (t: number): number => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const plusDays = (t: number, n: number): number => {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
};
/** The same day some months later; a month without that day gives its last one. */
const plusMonths = (t: number, n: number, day: number): number => {
  const d = new Date(t);
  const y = d.getFullYear();
  const m = d.getMonth() + n;
  return new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate())).getTime();
};

/** When a repeating task is due next, and the rule from then on. Null when it does not repeat any more. */
export function nextDue(task: Pick<TaskItem, 'due' | 'rrule' | 'fromDone'>, completedAt: number): { due: number; rrule: string } | null {
  if (!task.rrule) return null;
  const m = parts(task.rrule);
  const freq = m.get('FREQ');
  const every = Math.max(1, Math.floor(Number(m.get('INTERVAL') ?? 1)) || 1);
  const count = m.has('COUNT') ? Number(m.get('COUNT')) : null;
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq) || (count !== null && !(count > 1))) return null;
  const base = task.fromDone || task.due === null ? midnight(completedAt) : midnight(task.due);
  const complex = ['BYDAY', 'BYMONTH', 'BYSETPOS', 'BYYEARDAY', 'BYWEEKNO'].some((k) => m.has(k));
  let due: number;
  if (complex) {
    // the rules of the calendar say which day comes after this one
    const rule = new Map(m);
    for (const k of ['COUNT', 'UNTIL']) rule.delete(k);
    const series = { ...newEvent(base, plusDays(base, 1)), allDay: true, rrule: join(rule) };
    const found = expandEvent(series, plusDays(base, 1), plusDays(base, 366 * every + 366))
      .map((o) => o.start)
      .filter((s) => s > base)
      .sort((a, b) => a - b)[0];
    if (found === undefined) return null;
    due = found;
  } else if (freq === 'DAILY') due = plusDays(base, every);
  else if (freq === 'WEEKLY') due = plusDays(base, 7 * every);
  else {
    // counting from when it was done, the day is that one; otherwise the day the series was set for
    const asked = task.fromDone ? new Date(base).getDate() : Number(m.get('BYMONTHDAY') ?? new Date(base).getDate());
    const day = asked > 0 ? asked : 31;
    due = plusMonths(base, freq === 'MONTHLY' ? every : 12 * every, day);
    if (!task.fromDone && day > 28) m.set('BYMONTHDAY', String(day));
  }
  const until = /^(\d{4})(\d{2})(\d{2})/.exec(m.get('UNTIL') ?? '');
  if (until && due > new Date(Number(until[1]), Number(until[2]) - 1, Number(until[3])).getTime()) return null;
  if (count !== null) m.set('COUNT', String(count - 1));
  return { due, rrule: join(m) };
}

/** Calendar days from one day to another. */
const daysBetween = (a: number, b: number): number => Math.round((midnight(b) - midnight(a)) / 86_400_000);

/**
 * Marks a task as done. One that repeats leaves what was done as a task of its own and moves to its next date, with its
 * reminder moved the same days. Returns the tasks as they are now, and the next date if there is one.
 */
export function completeTask(d: MailData, id: string, now: number): number | null {
  const t = d.tasks.find((x) => x.id === id);
  if (!t || t.done) return null;
  const next = nextDue(t, now);
  const done: TaskItem = { ...t, done: true, completedAt: now };
  if (!next) {
    d.tasks = d.tasks.map((x) => (x.id === id ? done : x));
    return null;
  }
  const copyId = newId('t');
  const copy: TaskItem = { ...done, id: copyId, uid: `${copyId}@nova.local` };
  for (const k of ['rrule', 'fromDone', 'remind'] as const) delete copy[k];
  const moved: TaskItem = { ...t, due: next.due, rrule: next.rrule };
  if (t.remind !== undefined) moved.remind = plusDays(t.remind, daysBetween(t.due ?? now, next.due));
  d.tasks = d.tasks.flatMap((x) => (x.id === id ? [moved, copy] : [x]));
  return next.due;
}

export function reopenTask(d: MailData, id: string): void {
  d.tasks = d.tasks.map((t) => (t.id === id ? { ...t, done: false, completedAt: null } : t));
}

/** A task read from a file, without what does not make sense. */
export function readTask(t: TaskItem): TaskItem {
  const out: TaskItem = { ...t };
  if (typeof out.rrule !== 'string' || !out.rrule || out.rrule.length > 400) delete out.rrule;
  if (out.fromDone !== true || !out.rrule) delete out.fromDone;
  if (typeof out.remind !== 'number' || !Number.isFinite(out.remind)) delete out.remind;
  return out;
}
