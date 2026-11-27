import { addDays, startOfDay, type CalView } from './ctl';

/* Which days each view of the calendar shows. */

/** How many days the agenda looks ahead. */
export const AGENDA_DAYS = 30;

export const weekStart = (t: number): number => {
  const d = new Date(startOfDay(t));
  const dow = (d.getDay() + 6) % 7; // Monday first
  return addDays(d.getTime(), -dow);
};

export function rangeOf(view: CalView, anchor: number): { from: number; to: number; days: number[] } {
  const run = (from: number, n: number) => ({ from, to: addDays(from, n), days: Array.from({ length: n }, (_, i) => addDays(from, i)) });
  if (view === 'day') return run(startOfDay(anchor), 1);
  if (view === 'week') return run(weekStart(anchor), 7);
  if (view === 'workweek') return run(weekStart(anchor), 5);
  if (view === 'agenda') return run(startOfDay(anchor), AGENDA_DAYS);
  return run(weekStart(new Date(new Date(anchor).getFullYear(), new Date(anchor).getMonth(), 1).getTime()), 42);
}

export function titleOf(view: CalView, anchor: number): string {
  if (view === 'day') return new Date(anchor).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (view === 'month') return new Date(anchor).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const r = rangeOf(view, anchor);
  const a = new Date(r.from);
  const b = new Date(r.days[r.days.length - 1]!);
  return `${a.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${b.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

/** The anchor one step before or after: a day, a week, a month or the span of the agenda. */
export function step(view: CalView, anchor: number, by: -1 | 1): number {
  if (view === 'month') return new Date(new Date(anchor).getFullYear(), new Date(anchor).getMonth() + by, 1).getTime();
  return addDays(anchor, by * (view === 'day' ? 1 : view === 'agenda' ? AGENDA_DAYS : 7));
}
