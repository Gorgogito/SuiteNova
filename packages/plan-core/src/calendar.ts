import { zonedElapsed } from './zone';
import { MIN_PER_DAY, dayOfTime, dowOf, minuteOfTime, type CalendarDef, type Day, type Time, type WorkPeriod } from './model';

/** Arithmetic on working time. All times are minutes; `[from, to)` periods. */
export interface Cal {
  /** Is the minute that starts at `t` working time? */
  isWorking(t: Time): boolean;
  /** The first working minute at or after `t` (a task starts there). */
  nextStart(t: Time): Time;
  /** The end of working time at or before `t` (a task finishes there). */
  prevEnd(t: Time): Time;
  /** `t` plus `minutes` of working time. */
  addWork(t: Time, minutes: number): Time;
  /** `t` minus `minutes` of working time. */
  subWork(t: Time, minutes: number): Time;
  /** Working minutes in `[a, b)`. */
  workBetween(a: Time, b: Time): number;
  periodsOf(day: Day): WorkPeriod[];
}

const GUARD_DAYS = 366 * 30;

export function normalizePeriods(ps: WorkPeriod[]): WorkPeriod[] {
  const clean = ps
    .map((p) => ({ from: Math.max(0, Math.min(1440, Math.round(p.from))), to: Math.max(0, Math.min(1440, Math.round(p.to))) }))
    .filter((p) => p.to > p.from)
    .sort((a, b) => a.from - b.from);
  const out: WorkPeriod[] = [];
  for (const p of clean) {
    const last = out[out.length - 1];
    if (last && p.from <= last.to) last.to = Math.max(last.to, p.to);
    else out.push({ ...p });
  }
  return out;
}

export const periodsMinutes = (ps: WorkPeriod[]): number => ps.reduce((a, p) => a + (p.to - p.from), 0);

export class WorkCalendar implements Cal {
  private cache = new Map<Day, WorkPeriod[]>();
  constructor(readonly def: CalendarDef, private set: CalendarSet) {}

  periodsOf(day: Day): WorkPeriod[] {
    let c = this.cache.get(day);
    if (!c) {
      c = this.resolve(this.def, day, 0);
      this.cache.set(day, c);
    }
    return c;
  }

  private resolve(def: CalendarDef, day: Day, depth: number): WorkPeriod[] {
    for (let i = def.exceptions.length - 1; i >= 0; i--) {
      const e = def.exceptions[i]!;
      if (day >= e.from && day <= e.to) return normalizePeriods(e.periods);
    }
    const w = def.week[dowOf(day)];
    if (w) return normalizePeriods(w);
    if (def.base && depth < 8) {
      const base = this.set.def(def.base);
      if (base && base !== def) return this.resolve(base, day, depth + 1);
    }
    return [];
  }

  isWorking(t: Time): boolean {
    const m = minuteOfTime(t);
    return this.periodsOf(dayOfTime(t)).some((p) => m >= p.from && m < p.to);
  }

  nextStart(t: Time): Time {
    let d = dayOfTime(t);
    let m = minuteOfTime(t);
    for (let guard = 0; guard < GUARD_DAYS; guard++, d++, m = 0) {
      for (const p of this.periodsOf(d)) if (m < p.to) return d * MIN_PER_DAY + Math.max(m, p.from);
    }
    throw new Error('El calendario no tiene tiempo laborable: revisa los días de la semana y las excepciones.');
  }

  prevEnd(t: Time): Time {
    let d = dayOfTime(t);
    let m = minuteOfTime(t);
    for (let guard = 0; guard < GUARD_DAYS; guard++, d--, m = MIN_PER_DAY) {
      const ps = this.periodsOf(d);
      for (let i = ps.length - 1; i >= 0; i--) if (m > ps[i]!.from) return d * MIN_PER_DAY + Math.min(m, ps[i]!.to);
    }
    throw new Error('El calendario no tiene tiempo laborable: revisa los días de la semana y las excepciones.');
  }

  addWork(t: Time, minutes: number): Time {
    if (minutes <= 0) return t;
    let u = this.nextStart(t);
    let rest = minutes;
    for (;;) {
      const d = dayOfTime(u);
      const m = minuteOfTime(u);
      const p = this.periodsOf(d).find((x) => m >= x.from && m < x.to)!;
      const avail = p.to - m;
      if (rest <= avail) return u + rest;
      rest -= avail;
      u = this.nextStart(d * MIN_PER_DAY + p.to);
    }
  }

  subWork(t: Time, minutes: number): Time {
    if (minutes <= 0) return t;
    let u = this.prevEnd(t);
    let rest = minutes;
    for (;;) {
      const d = dayOfTime(u);
      const m = minuteOfTime(u);
      // a period ending exactly at midnight is at minute 1440 of the day before
      const dd = m === 0 ? d - 1 : d;
      const mm = m === 0 ? MIN_PER_DAY : m;
      const p = this.periodsOf(dd).find((x) => mm > x.from && mm <= x.to)!;
      const avail = mm - p.from;
      if (rest <= avail) return dd * MIN_PER_DAY + mm - rest;
      rest -= avail;
      u = this.prevEnd(dd * MIN_PER_DAY + p.from);
    }
  }

  workBetween(a: Time, b: Time): number {
    if (b <= a) return 0;
    let total = 0;
    const d0 = dayOfTime(a);
    const d1 = dayOfTime(b - 1);
    for (let d = d0; d <= d1; d++) {
      const lo = Math.max(a, d * MIN_PER_DAY) - d * MIN_PER_DAY;
      const hi = Math.min(b, (d + 1) * MIN_PER_DAY) - d * MIN_PER_DAY;
      for (const p of this.periodsOf(d)) total += Math.max(0, Math.min(hi, p.to) - Math.max(lo, p.from));
    }
    return total;
  }

  /** Working minutes of a whole day. */
  workInDay(day: Day): number {
    return periodsMinutes(this.periodsOf(day));
  }

  /** Does the calendar have any working time in the next weeks? */
  hasWork(from: Day): boolean {
    for (let d = from; d < from + 400; d++) if (this.periodsOf(d).length) return true;
    return false;
  }
}

/** Elapsed time: every minute counts. */
export const ELAPSED: Cal = {
  isWorking: () => true,
  nextStart: (t) => t,
  prevEnd: (t) => t,
  addWork: (t, m) => t + Math.max(0, m),
  subWork: (t, m) => t - Math.max(0, m),
  workBetween: (a, b) => Math.max(0, b - a),
  periodsOf: () => [{ from: 0, to: MIN_PER_DAY }],
};

export class CalendarSet {
  private defs = new Map<string, CalendarDef>();
  private made = new Map<string, WorkCalendar>();
  /** Elapsed time: every minute counts, and with a time zone the real minutes across a clock change. */
  readonly elapsed: Cal;
  constructor(defs: CalendarDef[], readonly defaultId: string, zone?: string) {
    this.elapsed = zone ? zonedElapsed(zone) : ELAPSED;
    for (const d of defs) this.defs.set(d.id, d);
  }
  def(id: string): CalendarDef | undefined {
    return this.defs.get(id);
  }
  /** The calendar with that id, or the project calendar when it is null or no longer exists. */
  get(id: string | null): WorkCalendar {
    const key = id && this.defs.has(id) ? id : this.defaultId;
    let c = this.made.get(key);
    if (!c) {
      const def = this.defs.get(key) ?? [...this.defs.values()][0]!;
      c = new WorkCalendar(def, this);
      this.made.set(key, c);
    }
    return c;
  }
  get default(): WorkCalendar {
    return this.get(null);
  }
}

/** Working minutes in a day of a week pattern, for display ("8 h"). */
export function weekMinutes(def: CalendarDef, set: CalendarSet): number {
  const c = new WorkCalendar(def, set);
  let total = 0;
  for (let d = 0; d < 7; d++) total += c.workInDay(d + 3); // 1970-01-04 is a Sunday: days 3..9 hold every weekday once
  return total;
}

/** Working time shared by a task's calendar and (at least one of) the calendars of the people who do the work. */
export class SharedCalendar extends WorkCalendar {
  private shared = new Map<Day, WorkPeriod[]>();
  constructor(private task: WorkCalendar, private people: WorkCalendar[], set: CalendarSet) {
    super(task.def, set);
  }
  override periodsOf(day: Day): WorkPeriod[] {
    let c = this.shared.get(day);
    if (!c) {
      const union = normalizePeriods(this.people.flatMap((p) => p.periodsOf(day)));
      c = [];
      for (const a of this.task.periodsOf(day)) for (const b of union) if (Math.min(a.to, b.to) > Math.max(a.from, b.from)) c.push({ from: Math.max(a.from, b.from), to: Math.min(a.to, b.to) });
      this.shared.set(day, c);
    }
    return c;
  }
}
