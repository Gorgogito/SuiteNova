import type { Cal } from './calendar';
import { dayOfTime, isSummary, parentsOf, type Day, type Project, type Task, type Time } from './model';
import type { Schedule } from './schedule';
import { bucketsOf, cumulative, phase, sumInto, type Bucket, type Step } from './usage';

/** Earned value: what was planned, what was done and what it cost. */
export interface EarnedValue {
  /** Budget at completion (baseline cost). */
  bac: number;
  /** Planned value to the status date (BCWS). */
  pv: number;
  /** Earned value (BCWP): baseline cost × % complete, or × the share of cost that the work done earns (see `weightedEarnedValue`). */
  ev: number;
  /** Actual cost (ACWP). */
  ac: number;
  /** Cost variance EV − AC and schedule variance EV − PV. */
  cv: number;
  sv: number;
  /** Performance indexes; null when they cannot be calculated. */
  cpi: number | null;
  spi: number | null;
  /** Estimate at completion and variance at completion. */
  eac: number;
  vac: number;
  /** To-complete performance index. */
  tcpi: number | null;
}

const calOf = (_p: Project, s: Schedule, t: Task): Cal => (t.elapsed ? s.calendars.elapsed : s.calendars.get(t.calendar));

/** The point in time earned value is measured at: the status date, or `now` when there is none. */
export const asOfTime = (p: Project, now: Time): Time => p.statusDate ?? now;

function metrics(bac: number, pv: number, ev: number, ac: number): EarnedValue {
  const cpi = ac > 1e-9 ? ev / ac : null;
  const spi = pv > 1e-9 ? ev / pv : null;
  const eac = cpi && cpi > 1e-9 ? bac / cpi : ac + Math.max(0, bac - ev);
  const rest = bac - ac;
  return { bac, pv, ev, ac, cv: ev - ac, sv: ev - pv, cpi, spi, eac, vac: bac - eac, tcpi: Math.abs(rest) > 1e-9 ? (bac - ev) / rest : null };
}

/**
 * Share of a task's cost that is earned when `percent` of its work is done, following how the current plan
 * spreads work and cost over the days: a fixed cost charged at the start counts as soon as the task starts, one
 * charged at the end only when it finishes, and costs that follow the work grow with it.
 */
export function costShareAt(p: Project, s: Schedule, i: number, percent: number): number {
  const task = p.tasks[i]!;
  const ph = phase(p, s);
  const mine = ph.assignments.filter((a) => a.task === i);
  const pct = Math.max(0, Math.min(100, percent)) / 100;
  const work = new Map<Day, number>();
  const cost = new Map<Day, number>();
  for (const a of mine) {
    for (const [d, v] of a.work) work.set(d, (work.get(d) ?? 0) + v);
    for (const [d, v] of a.cost) cost.set(d, (cost.get(d) ?? 0) + v);
  }
  const flowTotal = [...cost.values()].reduce((a, v) => a + v, 0);
  const total = flowTotal + task.fixedCost;
  if (total <= 1e-9) return pct;
  const profile = work.size && [...work.values()].some((v) => v > 0) ? work : (ph.shapes.get(i) ?? new Map<Day, number>());
  const days = [...new Set([...profile.keys(), ...cost.keys()])].sort((a, b) => a - b);
  const profileTotal = [...profile.values()].reduce((a, v) => a + v, 0);
  let earnedFlow = 0;
  if (profileTotal > 1e-9) {
    let target = pct * profileTotal;
    for (const d of days) {
      const w = profile.get(d) ?? 0;
      const c = cost.get(d) ?? 0;
      if (target >= w - 1e-9) {
        earnedFlow += c;
        target -= w;
      } else {
        earnedFlow += w > 0 ? (c * target) / w : 0;
        break;
      }
    }
  } else earnedFlow = flowTotal * pct;
  const fixed = task.fixedCostAccrual === 'start' ? (pct > 0 ? task.fixedCost : 0) : task.fixedCostAccrual === 'end' ? (pct >= 1 ? task.fixedCost : 0) : task.fixedCost * pct;
  return Math.min(1, (earnedFlow + fixed) / total);
}

/** Earned value per task (summaries add up their sub-tasks) against baseline `index`. */
export function earnedValue(p: Project, s: Schedule, index: number, asOf: Time): EarnedValue[] {
  const b = p.baselines[index];
  const n = p.tasks.length;
  const bac = new Array<number>(n).fill(0);
  const pv = new Array<number>(n).fill(0);
  const ev = new Array<number>(n).fill(0);
  const ac = new Array<number>(n).fill(0);
  const parent = parentsOf(p.tasks);
  p.tasks.forEach((t, i) => {
    if (isSummary(p.tasks, i)) return;
    const e = b?.tasks[t.id];
    const st = s.tasks[i]!;
    ac[i] = st.actualCost;
    if (!e) return;
    bac[i] = e.cost;
    const cal = calOf(p, s, t);
    let frac: number;
    if (e.finish <= e.start) frac = asOf >= e.finish ? 1 : 0;
    else {
      const total = cal.workBetween(e.start, e.finish);
      frac = total > 0 ? Math.min(1, cal.workBetween(e.start, Math.max(e.start, Math.min(asOf, e.finish))) / total) : asOf >= e.finish ? 1 : 0;
    }
    pv[i] = e.cost * frac;
    ev[i] = p.weightedEarnedValue ? e.cost * costShareAt(p, s, i, st.percent) : (e.cost * st.percent) / 100;
  });
  for (let i = n - 1; i >= 0; i--) {
    const j = parent[i]!;
    if (j < 0) continue;
    bac[j]! += bac[i]!;
    pv[j]! += pv[i]!;
    ev[j]! += ev[i]!;
    ac[j]! += ac[i]!;
  }
  return p.tasks.map((_, i) => metrics(bac[i]!, pv[i]!, ev[i]!, ac[i]!));
}

/** The whole project: the sum of the top-level tasks. */
export function projectEarnedValue(p: Project, s: Schedule, index: number, asOf: Time): EarnedValue {
  const rows = earnedValue(p, s, index, asOf);
  const top = rows.filter((_, i) => p.tasks[i]!.outline === 1);
  const sum = (k: 'bac' | 'pv' | 'ev' | 'ac') => top.reduce((a, r) => a + r[k], 0);
  const fixedSummary = 0;
  return metrics(sum('bac') + fixedSummary, sum('pv'), sum('ev'), sum('ac'));
}

export interface EvCurves {
  buckets: Bucket[];
  /** Cumulative planned value (baseline). */
  pv: number[];
  /** Cumulative earned value up to the status date (null afterwards). */
  ev: (number | null)[];
  /** Cumulative actual cost up to the status date (null afterwards). */
  ac: (number | null)[];
  /** Cumulative cost of the current plan (the forecast). */
  plan: number[];
  asOf: Time;
}

/** S curves of planned value, earned value and actual cost. */
export function evCurves(p: Project, s: Schedule, index: number, step: Step, asOf: Time): EvCurves {
  const b = p.baselines[index];
  let from: Day = dayOfTime(p.start);
  let to: Day = dayOfTime(s.finish) + 1;
  const planned = new Map<Day, number>();
  const earned = new Map<Day, number>();
  p.tasks.forEach((t, i) => {
    if (isSummary(p.tasks, i)) return;
    const e = b?.tasks[t.id];
    if (!e) return;
    from = Math.min(from, dayOfTime(e.start));
    to = Math.max(to, dayOfTime(e.finish) + 1);
    const cal = calOf(p, s, t);
    // baseline cost over the working time of the baseline span
    const days = new Map<Day, number>();
    for (let d = dayOfTime(e.start); d <= dayOfTime(Math.max(e.start, e.finish - 1)); d++) {
      const lo = Math.max(e.start, d * 1440);
      const hi = Math.min(Math.max(e.finish, e.start + 1), (d + 1) * 1440);
      const w = cal.workBetween(lo, hi);
      if (w > 0) days.set(d, w);
    }
    if (!days.size) days.set(dayOfTime(e.start), 1);
    const sum = [...days.values()].reduce((a, v) => a + v, 0);
    for (const [d, w] of days) planned.set(d, (planned.get(d) ?? 0) + (e.cost * w) / sum);
    // earned value: the % complete spread over the days between the start and the status date
    const st = s.tasks[i]!;
    const value = p.weightedEarnedValue ? e.cost * costShareAt(p, s, i, st.percent) : (e.cost * st.percent) / 100;
    if (value > 0) {
      const a = st.actualStart ?? st.start;
      const z = Math.max(a, Math.min(asOf, Math.max(st.finish, a)));
      const dd = new Map<Day, number>();
      for (let d = dayOfTime(a); d <= dayOfTime(Math.max(a, z - 1)); d++) {
        const w = cal.workBetween(Math.max(a, d * 1440), Math.min(Math.max(z, a + 1), (d + 1) * 1440));
        if (w > 0) dd.set(d, w);
      }
      if (!dd.size) dd.set(dayOfTime(a), 1);
      const tot = [...dd.values()].reduce((x, v) => x + v, 0);
      for (const [d, w] of dd) earned.set(d, (earned.get(d) ?? 0) + (value * w) / tot);
    }
  });
  const ph = phase(p, s);
  const actual = new Map<Day, number>();
  const plan = new Map<Day, number>();
  for (const a of ph.assignments) {
    for (const [d, v] of a.actualCost) actual.set(d, (actual.get(d) ?? 0) + v);
    for (const [d, v] of a.cost) plan.set(d, (plan.get(d) ?? 0) + v);
  }
  for (const f of ph.fixed) {
    for (const [d, v] of f.actualCost) actual.set(d, (actual.get(d) ?? 0) + v);
    for (const [d, v] of f.cost) plan.set(d, (plan.get(d) ?? 0) + v);
  }
  const buckets = bucketsOf(from, Math.max(to, from + 1), step);
  const asOfDay = dayOfTime(asOf);
  const upto = (m: Map<Day, number>) => {
    const cut = new Map<Day, number>();
    for (const [d, v] of m) if (d <= asOfDay) cut.set(d, v);
    return cut;
  };
  const known = buckets.map((bk) => bk.from <= asOfDay);
  const ev = cumulative(sumInto(upto(earned), buckets));
  const ac = cumulative(sumInto(upto(actual), buckets));
  return {
    buckets,
    pv: cumulative(sumInto(planned, buckets)),
    ev: ev.map((v, i) => (known[i] ? v : null)),
    ac: ac.map((v, i) => (known[i] ? v : null)),
    plan: cumulative(sumInto(plan, buckets)),
    asOf,
  };
}
