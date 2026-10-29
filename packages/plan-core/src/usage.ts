import type { Cal } from './calendar';
import { dayOfTime, type Day, type Project, type Time } from './model';
import type { AssignmentCalc, Schedule } from './schedule';

export interface Overallocation {
  resource: string;
  from: Day;
  to: Day;
  /** Peak load as a fraction of the units the resource has (2 = twice what it can do). */
  peak: number;
}

/** Working minutes inside `[a, b)` of each day, as periods clipped to that interval. */
function clippedPeriods(cal: Cal, a: Time, b: Time): Map<Day, { from: number; to: number }[]> {
  const out = new Map<Day, { from: number; to: number }[]>();
  if (b <= a) return out;
  for (let d = dayOfTime(a); d <= dayOfTime(b - 1); d++) {
    const lo = Math.max(a, d * 1440) - d * 1440;
    const hi = Math.min(b, (d + 1) * 1440) - d * 1440;
    const ps: { from: number; to: number }[] = [];
    for (const p of cal.periodsOf(d)) {
      const from = Math.max(lo, p.from);
      const to = Math.min(hi, p.to);
      if (to > from) ps.push({ from, to });
    }
    if (ps.length) out.set(d, ps);
  }
  return out;
}

const overlap = (xs: { from: number; to: number }[], ys: { from: number; to: number }[]): number => {
  let t = 0;
  for (const x of xs) for (const y of ys) t += Math.max(0, Math.min(x.to, y.to) - Math.max(x.from, y.from));
  return t;
};

export interface Phased {
  calc: AssignmentCalc;
  task: number;
  resource: string;
  /** Minutes of work, actual work (minutes) and cost, per day. */
  work: Map<Day, number>;
  actualWork: Map<Day, number>;
  cost: Map<Day, number>;
  actualCost: Map<Day, number>;
}

export interface PhasedFixed {
  task: number;
  cost: Map<Day, number>;
  actualCost: Map<Day, number>;
}

export interface Phase {
  assignments: Phased[];
  fixed: PhasedFixed[];
  /** Working minutes of the task calendar per day, per task (the shape of a task over time). */
  shapes: Map<number, Map<Day, number>>;
}

const cache = new WeakMap<Schedule, WeakMap<Project, Phase>>();

const scaleMap = (m: Map<Day, number>, total: number): Map<Day, number> => {
  const sum = [...m.values()].reduce((a, b) => a + b, 0);
  const out = new Map<Day, number>();
  if (sum <= 0) return out;
  for (const [d, v] of m) out.set(d, (total * v) / sum);
  return out;
};

/** Front-load `total` over the days of `plan`, never more than each day holds. */
function frontLoad(plan: Map<Day, number>, total: number): Map<Day, number> {
  const out = new Map<Day, number>();
  let rest = total;
  for (const d of [...plan.keys()].sort((a, b) => a - b)) {
    if (rest <= 1e-9) break;
    const v = Math.min(plan.get(d)!, rest);
    out.set(d, v);
    rest -= v;
  }
  return out;
}

export function phase(p: Project, s: Schedule): Phase {
  let byProject = cache.get(s);
  if (!byProject) cache.set(s, (byProject = new WeakMap()));
  const hit = byProject.get(p);
  if (hit) return hit;

  const shapes = new Map<number, Map<Day, number>>();
  const shapeOf = (i: number): Map<Day, number> => {
    let m = shapes.get(i);
    if (m) return m;
    m = new Map();
    const t = s.tasks[i]!;
    const task = p.tasks[i]!;
    const cal: Cal = task.elapsed ? s.calendars.elapsed : s.calendars.get(task.calendar);
    if (t.milestone) m.set(dayOfTime(t.start), 0);
    else for (const seg of t.segments) for (const [d, ps] of clippedPeriods(cal, seg.start, seg.finish)) m.set(d, (m.get(d) ?? 0) + ps.reduce((a, x) => a + x.to - x.from, 0));
    shapes.set(i, m);
    return m;
  };

  const assignments: Phased[] = [];
  for (const c of s.assignments) {
    const task = p.tasks[c.task]!;
    const res = p.resources.find((r) => r.id === c.resource)!;
    const t = s.tasks[c.task]!;
    const shape = shapeOf(c.task);
    // work follows the hours the resource can actually work inside the task's working time
    let weights = new Map<Day, number>();
    if (res.type === 'work' && !t.milestone) {
      const rcal = s.calendars.get(res.calendar);
      const tcal: Cal = task.elapsed ? s.calendars.elapsed : s.calendars.get(task.calendar);
      for (const seg of t.segments) {
        for (const [d, ps] of clippedPeriods(tcal, seg.start, seg.finish)) {
          const w = overlap(ps, rcal.periodsOf(d));
          if (w > 0) weights.set(d, (weights.get(d) ?? 0) + w);
        }
      }
    }
    if (weights.size === 0) weights = new Map(shape);
    const work = res.type === 'work' ? scaleMap(weights, c.work) : new Map<Day, number>();
    const actualWork = res.type === 'work' ? frontLoad(work, c.actualWork) : new Map<Day, number>();
    const cost = scaleMap(res.type === 'work' ? work : weights, c.cost);
    if (res.costPerUse > 0 && cost.size === 0) cost.set(dayOfTime(t.start), c.cost);
    const actualCost = frontLoad(cost, c.actualCost);
    assignments.push({ calc: c, task: c.task, resource: c.resource, work, actualWork, cost, actualCost });
  }

  const fixed: PhasedFixed[] = [];
  p.tasks.forEach((task, i) => {
    if (task.fixedCost <= 0) return;
    const t = s.tasks[i]!;
    const days = t.summary ? [dayOfTime(t.start)] : [...shapeOf(i).keys()].sort((a, b) => a - b);
    if (!days.length) return;
    const cost = new Map<Day, number>();
    if (task.fixedCostAccrual === 'start') cost.set(days[0]!, task.fixedCost);
    else if (task.fixedCostAccrual === 'end') cost.set(days[days.length - 1]!, task.fixedCost);
    else for (const [d, v] of scaleMap(shapeOf(i), task.fixedCost)) cost.set(d, v);
    if (cost.size === 0) cost.set(days[0]!, task.fixedCost);
    const pct = t.percent / 100;
    const acc = task.fixedCostAccrual === 'start' ? (pct > 0 ? task.fixedCost : 0) : task.fixedCostAccrual === 'end' ? (pct >= 1 ? task.fixedCost : 0) : task.fixedCost * pct;
    fixed.push({ task: i, cost, actualCost: frontLoad(cost, acc) });
  });

  const out: Phase = { assignments, fixed, shapes };
  byProject.set(p, out);
  return out;
}

/** Resources whose work on a day is more than their units allow. */
export function overallocationsOf(p: Project, s: Schedule): Overallocation[] {
  const ph = phase(p, s);
  const out: Overallocation[] = [];
  for (const r of p.resources) {
    if (r.type !== 'work') continue;
    const load = new Map<Day, number>();
    for (const a of ph.assignments) if (a.resource === r.id) for (const [d, v] of a.work) load.set(d, (load.get(d) ?? 0) + v);
    if (!load.size) continue;
    const cal = s.calendars.get(r.calendar);
    const days = [...load.keys()].sort((a, b) => a - b);
    let open: { from: Day; to: Day; peak: number } | null = null;
    for (const d of days) {
      const cap = cal.workInDay(d) * r.maxUnits;
      const w = load.get(d)!;
      const over = w > cap + 0.5 && w > 0;
      const frac = cap > 0 ? w / cap : Infinity;
      const ratio = cal.workInDay(d) > 0 ? w / cal.workInDay(d) / Math.max(r.maxUnits, 1e-9) : Infinity;
      void frac;
      if (over) {
        const peak = Number.isFinite(ratio) ? ratio : w / 480 / Math.max(r.maxUnits, 1e-9);
        if (open) {
          open.to = d;
          open.peak = Math.max(open.peak, peak);
        } else open = { from: d, to: d, peak };
      } else if (open) {
        out.push({ resource: r.id, from: open.from, to: open.to, peak: open.peak });
        open = null;
      }
    }
    if (open) out.push({ resource: r.id, from: open.from, to: open.to, peak: open.peak });
  }
  return out;
}

// ---------- time buckets for the usage views and the graphs

export type Step = 'day' | 'week' | 'month';
export interface Bucket {
  from: Day;
  /** Exclusive. */
  to: Day;
  label: string;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function bucketsOf(from: Day, to: Day, step: Step): Bucket[] {
  const out: Bucket[] = [];
  const dow = (d: Day) => (((d + 3) % 7) + 7) % 7; // 0 = Monday
  let d = step === 'week' ? from - dow(from) : step === 'month' ? Math.floor(Date.UTC(new Date(from * 86400000).getUTCFullYear(), new Date(from * 86400000).getUTCMonth(), 1) / 86400000) : from;
  while (d < to && out.length < 4000) {
    const dt = new Date(d * 86400000);
    let next: Day;
    let label: string;
    if (step === 'day') {
      next = d + 1;
      label = `${dt.getUTCDate()}/${dt.getUTCMonth() + 1}`;
    } else if (step === 'week') {
      next = d + 7;
      label = `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
    } else {
      next = Math.floor(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1) / 86400000);
      label = `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
    }
    out.push({ from: d, to: next, label });
    d = next;
  }
  return out;
}

export function sumInto(m: Map<Day, number>, buckets: Bucket[]): number[] {
  const out = new Array<number>(buckets.length).fill(0);
  if (!buckets.length) return out;
  for (const [d, v] of m) {
    if (d < buckets[0]!.from || d >= buckets[buckets.length - 1]!.to) continue;
    let lo = 0;
    let hi = buckets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (buckets[mid]!.from <= d) lo = mid;
      else hi = mid - 1;
    }
    out[lo]! += v;
  }
  return out;
}

export interface UsageSeries {
  /** Planned work per bucket in minutes. */
  work: number[];
  actualWork: number[];
  cost: number[];
  actualCost: number[];
}

const emptySeries = (n: number): UsageSeries => ({ work: new Array(n).fill(0), actualWork: new Array(n).fill(0), cost: new Array(n).fill(0), actualCost: new Array(n).fill(0) });
const addSeries = (a: UsageSeries, b: UsageSeries) => {
  for (const k of ['work', 'actualWork', 'cost', 'actualCost'] as const) b[k].forEach((v, i) => (a[k][i]! += v));
};
const seriesOf = (a: Phased, buckets: Bucket[]): UsageSeries => ({ work: sumInto(a.work, buckets), actualWork: sumInto(a.actualWork, buckets), cost: sumInto(a.cost, buckets), actualCost: sumInto(a.actualCost, buckets) });

export interface ResourceUsage {
  id: string;
  name: string;
  total: UsageSeries;
  /** What the resource can do in each bucket, in minutes (calendar time × units). */
  capacity: number[];
  /** Peak load per bucket as a fraction of the units (1 = exactly what it has). */
  peak: number[];
  tasks: { task: number; series: UsageSeries }[];
}

export function resourceUsage(p: Project, s: Schedule, buckets: Bucket[]): ResourceUsage[] {
  const ph = phase(p, s);
  return p.resources.map((r) => {
    const total = emptySeries(buckets.length);
    const tasks: ResourceUsage['tasks'] = [];
    const daily = new Map<Day, number>();
    for (const a of ph.assignments) {
      if (a.resource !== r.id) continue;
      const ser = seriesOf(a, buckets);
      addSeries(total, ser);
      tasks.push({ task: a.task, series: ser });
      for (const [d, v] of a.work) daily.set(d, (daily.get(d) ?? 0) + v);
    }
    const cal = s.calendars.get(r.calendar);
    const capacity = buckets.map((b) => {
      let c = 0;
      for (let d = b.from; d < b.to; d++) c += cal.workInDay(d);
      return r.type === 'work' ? c * r.maxUnits : 0;
    });
    const peak = buckets.map((b) => {
      let m = 0;
      for (let d = b.from; d < b.to; d++) {
        const w = daily.get(d) ?? 0;
        const c = cal.workInDay(d);
        if (w > 0) m = Math.max(m, c > 0 ? w / c : w / 480);
      }
      return m;
    });
    return { id: r.id, name: r.name, total, capacity, peak, tasks };
  });
}

export interface TaskUsage {
  task: number;
  total: UsageSeries;
  resources: { resource: string; series: UsageSeries }[];
}

export function taskUsage(p: Project, s: Schedule, buckets: Bucket[]): TaskUsage[] {
  const ph = phase(p, s);
  const out: TaskUsage[] = p.tasks.map((_, i) => ({ task: i, total: emptySeries(buckets.length), resources: [] }));
  for (const a of ph.assignments) {
    const ser = seriesOf(a, buckets);
    out[a.task]!.resources.push({ resource: a.resource, series: ser });
    addSeries(out[a.task]!.total, ser);
  }
  for (const f of ph.fixed) {
    sumInto(f.cost, buckets).forEach((v, i) => (out[f.task]!.total.cost[i]! += v));
    sumInto(f.actualCost, buckets).forEach((v, i) => (out[f.task]!.total.actualCost[i]! += v));
  }
  // summaries add up their children
  const par = p.tasks.map((t, i) => {
    for (let j = i - 1; j >= 0; j--) if (p.tasks[j]!.outline < t.outline) return j;
    return -1;
  });
  for (let i = p.tasks.length - 1; i >= 0; i--) {
    const j = par[i]!;
    if (j >= 0) addSeries(out[j]!.total, out[i]!.total);
  }
  return out;
}

/** Cumulative series (S curves). */
export const cumulative = (xs: number[]): number[] => {
  let a = 0;
  return xs.map((x) => (a += x));
};
