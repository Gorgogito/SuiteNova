import { CalendarSet, SharedCalendar, type Cal, type WorkCalendar } from './calendar';
import { isSummary, parentsOf, wbsOf, type Day, type Link, type Project, type Task, type Time } from './model';
import { derive } from './taskcalc';
import { overallocationsOf, type Overallocation } from './usage';

export interface Segment {
  start: Time;
  finish: Time;
}

export interface ScheduledTask {
  id: string;
  /** 0-based position. */
  index: number;
  /** "1.2.3" */
  wbs: string;
  outline: number;
  summary: boolean;
  milestone: boolean;
  manual: boolean;
  start: Time;
  finish: Time;
  /** The parts of the task, more than one when it is split. */
  segments: Segment[];
  /** Working minutes of the task (elapsed minutes for an elapsed task); the span of a summary. */
  duration: number;
  percent: number;
  /** Total slack in working minutes (negative when the dates are not reachable). */
  slack: number;
  critical: boolean;
  /** A fixed-date constraint that cannot be met because of the links. */
  conflict: boolean;
  /** The task finishes after its deadline. */
  deadlineMissed: boolean;
  /** Planned work, actual work and remaining work in minutes (work resources only). */
  work: number;
  actualWork: number;
  remainingWork: number;
  cost: number;
  actualCost: number;
  remainingCost: number;
  actualStart: Time | null;
  actualFinish: Time | null;
  calendar: string;
}

/** What one resource does on one task. */
export interface AssignmentCalc {
  task: number;
  resource: string;
  units: number;
  work: number;
  actualWork: number;
  remainingWork: number;
  cost: number;
  actualCost: number;
  remainingCost: number;
}

export interface Schedule {
  tasks: ScheduledTask[];
  byId: Map<string, ScheduledTask>;
  assignments: AssignmentCalc[];
  start: Time;
  finish: Time;
  /** Working minutes (project calendar) from start to finish. */
  duration: number;
  cost: number;
  actualCost: number;
  work: number;
  actualWork: number;
  percent: number;
  overallocations: Overallocation[];
  warnings: string[];
  calendars: CalendarSet;
}

export type { Overallocation };

const startDay = (t: Time): Day => Math.floor(t / 1440);

/** A task finishes `dur` working minutes after `start`, stopping for each split. */
export function finishWithSplits(cal: Cal, start: Time, dur: number, splits: Task['splits']): { finish: Time; segments: Segment[] } {
  const segments: Segment[] = [];
  let t = start;
  let done = 0;
  for (const s of [...splits].sort((a, b) => a.after - b.after)) {
    if (s.after >= dur || s.after <= done) continue;
    const end = cal.addWork(t, s.after - done);
    segments.push({ start: t, finish: end });
    t = cal.nextStart(cal.addWork(end, Math.max(0, s.gap)));
    done = s.after;
  }
  const finish = cal.addWork(t, dur - done);
  segments.push({ start: t, finish });
  return { finish, segments };
}

const shift = (cal: Cal, t: Time, lag: number): Time => (lag === 0 ? t : lag > 0 ? cal.addWork(t, lag) : cal.subWork(t, -lag));
const shiftBack = (cal: Cal, t: Time, lag: number): Time => (lag === 0 ? t : lag > 0 ? cal.subWork(t, lag) : cal.addWork(t, -lag));

/** Links that are ignored (cycles, links to summary tasks, unknown predecessors) are reported in `warnings`. */
export function schedule(p: Project): Schedule {
  const calendars = new CalendarSet(p.calendars, p.calendar, p.timeZone);
  const dcal = calendars.default;
  if (!dcal.hasWork(startDay(p.start))) throw new Error('El calendario del proyecto no tiene tiempo laborable: revisa los días de la semana y las excepciones.');
  const tasks = p.tasks;
  const n = tasks.length;
  const warnings: string[] = [];
  const idx = new Map<string, number>();
  tasks.forEach((t, i) => idx.set(t.id, i));
  const summary = tasks.map((_, i) => isSummary(tasks, i));
  const parent = parentsOf(tasks);
  const wbs = wbsOf(tasks);

  // calendar of each task (an elapsed task counts every minute) and what its type makes of duration and work
  const cal: Cal[] = tasks.map((t) => (t.elapsed ? calendars.elapsed : calendars.get(t.calendar)));
  if (p.resourceCalendars) {
    // the task also waits for its people: both calendars must be working
    tasks.forEach((t, i) => {
      if (t.elapsed || summary[i]) return;
      const res = [...new Set(t.assignments.map((a) => a.resource))].map((id) => p.resources.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r && r.type === 'work');
      const own = calendars.get(t.calendar);
      const people = res.map((r) => calendars.get(r.calendar)).filter((c) => c.def.id !== own.def.id);
      if (!res.length || !people.length) return;
      const shared = new SharedCalendar(own, res.map((r) => calendars.get(r.calendar)), calendars);
      let any = false;
      for (let d = startDay(p.start); d < startDay(p.start) + 400 && !any; d++) any = shared.periodsOf(d).length > 0;
      if (any) cal[i] = shared;
      else warnings.push(`"${t.name}": el calendario de la tarea y los de sus recursos no coinciden nunca; se usa solo el de la tarea.`);
    });
  }
  const dv = tasks.map((t) => derive(t, p.resources));
  const dur = tasks.map((_t, i) => (summary[i] ? 0 : dv[i]!.duration));

  interface L extends Link {
    from: number;
    to: number;
  }
  const links: L[] = [];
  tasks.forEach((t, j) => {
    for (const l of t.links) {
      const i = idx.get(l.task);
      if (i === undefined) {
        warnings.push(`"${t.name}": la predecesora ya no existe.`);
        continue;
      }
      if (i === j) {
        warnings.push(`"${t.name}": una tarea no puede ser predecesora de sí misma.`);
        continue;
      }
      if (summary[i] || summary[j]) {
        warnings.push(`"${t.name}": los vínculos con tareas de resumen no se admiten y se ignoran.`);
        continue;
      }
      links.push({ ...l, from: i, to: j });
    }
  });

  // order the leaf tasks so that predecessors come first; links that close a cycle are dropped
  const succ: L[][] = tasks.map(() => []);
  for (const l of links) succ[l.from]!.push(l);
  const state = new Array<number>(n).fill(0); // 0 new, 1 visiting, 2 done
  const order: number[] = [];
  const dropped = new Set<L>();
  const visit = (i: number) => {
    state[i] = 1;
    for (const l of succ[i]!) {
      if (dropped.has(l)) continue;
      if (state[l.to] === 1) {
        dropped.add(l);
        warnings.push(`Referencia circular: "${tasks[l.to]!.name}" depende de sí misma a través de "${tasks[i]!.name}"; se ignora ese vínculo.`);
      } else if (state[l.to] === 0) visit(l.to);
    }
    state[i] = 2;
    order.push(i);
  };
  for (let i = 0; i < n; i++) if (!summary[i] && state[i] === 0) visit(i);
  order.reverse();
  const live = links.filter((l) => !dropped.has(l));
  const liveSucc: L[][] = tasks.map(() => []);
  const livePred: L[][] = tasks.map(() => []);
  for (const l of live) {
    liveSucc[l.from]!.push(l);
    livePred[l.to]!.push(l);
  }

  // ---------- forward pass
  const S = new Array<Time>(n).fill(0);
  const F = new Array<Time>(n).fill(0);
  const segs: Segment[][] = tasks.map(() => []);
  const conflict = new Array<boolean>(n).fill(false);
  /** Minutes of lag; a percent lag is a share of the predecessor's duration. */
  const lagOf = (l: L): number => (l.percent ? Math.round((dur[l.from]! * l.lag) / 100) : l.lag);
  const lagCal = (l: Link, c: Cal): Cal => (l.elapsed ? calendars.elapsed : c);
  const origin = dcal.nextStart(p.start);

  for (const i of order) {
    const t = tasks[i]!;
    const c = cal[i]!;
    const d = dur[i]!;
    const place = (start: Time) => {
      const r = finishWithSplits(c, start, d, t.splits);
      S[i] = start;
      F[i] = r.finish;
      segs[i] = r.segments;
    };

    // dates that follow from the links and the project start
    let es = p.start;
    for (const l of livePred[i]!) {
      const a = l.from;
      const lc = lagCal(l, c);
      let cand: Time;
      switch (l.type) {
        case 'FS': cand = shift(lc, F[a]!, lagOf(l)); break;
        case 'SS': cand = shift(lc, S[a]!, lagOf(l)); break;
        case 'FF': {
          const fin = shift(lc, F[a]!, lagOf(l));
          cand = d > 0 ? c.subWork(fin, d) : fin;
          break;
        }
        default: {
          const fin = shift(lc, S[a]!, lagOf(l));
          cand = d > 0 ? c.subWork(fin, d) : fin;
        }
      }
      es = Math.max(es, cand);
    }
    const ct = t.constraint;
    const cdate = ct.date;
    if (cdate !== null && (ct.type === 'snet' || ct.type === 'fnet')) es = Math.max(es, ct.type === 'snet' ? cdate : d > 0 ? c.subWork(cdate, d) : cdate);
    const align = (x: Time) => (d > 0 ? c.nextStart(x) : x);
    // what leveling added: the task waits that many working minutes after its links allow it to start
    if (t.levelDelay && t.levelDelay > 0 && !t.manual) es = c.addWork(align(es), t.levelDelay);

    if (t.manual && (t.manualStart !== null || t.manualFinish !== null)) {
      // the user's dates; whatever is missing follows from the duration
      if (t.manualStart !== null && t.manualFinish !== null) {
        S[i] = t.manualStart;
        F[i] = Math.max(t.manualStart, t.manualFinish);
        segs[i] = [{ start: S[i]!, finish: F[i]! }];
        dur[i] = t.elapsed ? F[i]! - S[i]! : c.workBetween(S[i]!, F[i]!);
      } else if (t.manualStart !== null) place(d > 0 ? c.nextStart(t.manualStart) : t.manualStart);
      else {
        const f = t.manualFinish!;
        place(d > 0 ? c.subWork(f, d) : f);
      }
      continue;
    }

    if (cdate !== null && ct.type === 'mso') {
      const fixed = align(cdate);
      if (fixed < align(es) && livePred[i]!.length) conflict[i] = true;
      place(fixed);
    } else if (cdate !== null && ct.type === 'mfo') {
      const start = d > 0 ? c.subWork(cdate, d) : cdate;
      if (start < align(es) && livePred[i]!.length) conflict[i] = true;
      place(start);
    } else {
      place(align(es));
      if (cdate !== null && ct.type === 'snlt' && S[i]! > cdate) conflict[i] = true;
      if (cdate !== null && ct.type === 'fnlt' && F[i]! > cdate) conflict[i] = true;
    }
  }

  let projectFinish = origin;
  for (const i of order) projectFinish = Math.max(projectFinish, F[i]!);

  // ---------- "as late as possible": pushed back toward the successors (or the end of the project), never earlier
  for (const i of [...order].reverse()) {
    const t = tasks[i]!;
    if (t.constraint.type !== 'alap' || (t.manual && (t.manualStart !== null || t.manualFinish !== null))) continue;
    const c = cal[i]!;
    const d = dur[i]!;
    let lf = projectFinish;
    for (const l of liveSucc[i]!) {
      const j = l.to;
      const lc = lagCal(l, cal[j]!);
      switch (l.type) {
        case 'FS': lf = Math.min(lf, shiftBack(lc, S[j]!, lagOf(l))); break;
        case 'FF': lf = Math.min(lf, shiftBack(lc, F[j]!, lagOf(l))); break;
        case 'SS': {
          const ls = shiftBack(lc, S[j]!, lagOf(l));
          lf = Math.min(lf, d > 0 ? c.addWork(ls, d) : ls);
          break;
        }
        default: {
          const ls = shiftBack(lc, F[j]!, lagOf(l));
          lf = Math.min(lf, d > 0 ? c.addWork(ls, d) : ls);
        }
      }
    }
    if (lf <= F[i]!) continue;
    let start = d > 0 ? c.subWork(c.prevEnd(lf), d) : lf;
    for (let k = 0; k < 4 && d > 0; k++) {
      const r = finishWithSplits(c, start, d, t.splits);
      if (r.finish <= lf) break;
      start = c.subWork(start, c.workBetween(lf, r.finish));
    }
    if (start <= S[i]!) continue;
    const r = finishWithSplits(c, d > 0 ? c.nextStart(start) : start, d, t.splits);
    S[i] = r.segments[0]!.start;
    F[i] = r.finish;
    segs[i] = r.segments;
  }
  projectFinish = origin;
  for (const i of order) projectFinish = Math.max(projectFinish, F[i]!);

  // ---------- backward pass
  const LF = new Array<Time>(n).fill(projectFinish);
  const LS = new Array<Time>(n).fill(projectFinish);
  for (const i of [...order].reverse()) {
    const c = cal[i]!;
    const d = dur[i]!;
    let lf = Infinity;
    let ls = Infinity;
    for (const l of liveSucc[i]!) {
      const j = l.to;
      const lc = lagCal(l, cal[j]!);
      switch (l.type) {
        case 'FS': lf = Math.min(lf, shiftBack(lc, LS[j]!, lagOf(l))); break;
        case 'FF': lf = Math.min(lf, shiftBack(lc, LF[j]!, lagOf(l))); break;
        case 'SS': ls = Math.min(ls, shiftBack(lc, LS[j]!, lagOf(l))); break;
        default: ls = Math.min(ls, shiftBack(lc, LF[j]!, lagOf(l)));
      }
    }
    let finish = lf === Infinity ? projectFinish : lf;
    if (ls !== Infinity) {
      // the latest start that is a working minute, then the finish it implies
      const s2 = c.isWorking(ls) ? ls : d > 0 ? c.subWork(c.prevEnd(ls), 1) : ls;
      finish = Math.min(finish, d > 0 ? c.addWork(s2, d) : s2);
    }
    finish = Math.min(finish, projectFinish);
    LF[i] = d > 0 ? c.prevEnd(finish) : finish;
    LS[i] = d > 0 ? c.subWork(LF[i]!, d) : LF[i]!;
  }

  // ---------- work and cost
  const assignments: AssignmentCalc[] = [];
  const taskWork = new Array<number>(n).fill(0);
  const taskActualWork = new Array<number>(n).fill(0);
  const taskCost = new Array<number>(n).fill(0);
  const taskActualCost = new Array<number>(n).fill(0);
  tasks.forEach((t, i) => {
    if (summary[i]) {
      taskCost[i] = t.fixedCost;
      return;
    }
    const pct = Math.max(0, Math.min(100, t.percent)) / 100;
    const units = dv[i]!.units;
    let cost = t.fixedCost;
    let actualCost = 0;
    let actualWork = 0;
    for (const a of t.assignments) {
      const r = p.resources.find((x) => x.id === a.resource);
      if (!r) continue;
      let work = 0;
      let c: number;
      let ac: number;
      let aw = 0;
      if (r.type === 'work') {
        work = units > 0 ? (dv[i]!.work * a.units) / units : 0;
        aw = a.actualWork ?? work * pct;
        c = (work / 60) * r.rate + r.costPerUse;
        ac = a.actualCost ?? (aw / 60) * r.rate + (aw > 0 ? r.costPerUse : 0);
      } else {
        c = a.units * r.rate + r.costPerUse;
        ac = a.actualCost ?? c * pct;
      }
      assignments.push({ task: i, resource: r.id, units: a.units, work, actualWork: aw, remainingWork: Math.max(0, work - aw), cost: c, actualCost: ac, remainingCost: Math.max(0, c - ac) });
      cost += c;
      actualCost += ac;
      actualWork += aw;
    }
    const accrued = t.fixedCostAccrual === 'start' ? (pct > 0 ? t.fixedCost : 0) : t.fixedCostAccrual === 'end' ? (pct >= 1 ? t.fixedCost : 0) : t.fixedCost * pct;
    taskWork[i] = dv[i]!.work;
    taskActualWork[i] = t.actualWork ?? actualWork;
    taskCost[i] = cost;
    taskActualCost[i] = t.actualCost ?? actualCost + accrued;
  });

  const out: ScheduledTask[] = tasks.map((t, i) => {
    const leaf = !summary[i];
    const c = cal[i]!;
    const d = dur[i]!;
    // a milestone has a single date
    const start = leaf ? S[i]! : 0;
    const finish = leaf ? F[i]! : 0;
    const sl = leaf ? (LF[i]! >= F[i]! ? c.workBetween(F[i]!, LF[i]!) : -c.workBetween(LF[i]!, F[i]!)) : 0;
    const percent = Math.max(0, Math.min(100, t.percent));
    return {
      id: t.id,
      index: i,
      wbs: wbs[i]!,
      outline: t.outline,
      summary: summary[i]!,
      milestone: leaf && d === 0,
      manual: t.manual,
      start,
      finish,
      segments: leaf ? segs[i]! : [],
      duration: d,
      percent,
      slack: sl,
      critical: leaf && sl <= 0 && percent < 100,
      conflict: conflict[i]!,
      deadlineMissed: leaf && t.deadline !== null && F[i]! > t.deadline,
      work: taskWork[i]!,
      actualWork: taskActualWork[i]!,
      remainingWork: Math.max(0, taskWork[i]! - taskActualWork[i]!),
      cost: taskCost[i]!,
      actualCost: taskActualCost[i]!,
      remainingCost: Math.max(0, taskCost[i]! - taskActualCost[i]!),
      actualStart: leaf ? (t.actualStart ?? (percent > 0 ? S[i]! : null)) : null,
      actualFinish: leaf ? (t.actualFinish ?? (percent >= 100 ? F[i]! : null)) : null,
      calendar: t.calendar ?? p.calendar,
    };
  });

  // summaries from their children (bottom-up)
  for (let i = n - 1; i >= 0; i--) {
    if (!summary[i]) continue;
    let end = i + 1;
    while (end < n && tasks[end]!.outline > tasks[i]!.outline) end++;
    const kids: number[] = [];
    for (let j = i + 1; j < end; j++) if (parent[j] === i) kids.push(j);
    const s = out[i]!;
    s.start = Math.min(...kids.map((k) => out[k]!.start));
    s.finish = Math.max(...kids.map((k) => out[k]!.finish));
    s.duration = dcal.workBetween(s.start, s.finish);
    const weight = kids.reduce((a, k) => a + Math.max(1, out[k]!.duration), 0);
    s.percent = Math.round(kids.reduce((a, k) => a + Math.max(1, out[k]!.duration) * out[k]!.percent, 0) / (weight || 1));
    s.cost = tasks[i]!.fixedCost + kids.reduce((a, k) => a + out[k]!.cost, 0);
    s.actualCost = kids.reduce((a, k) => a + out[k]!.actualCost, 0);
    s.remainingCost = Math.max(0, s.cost - s.actualCost);
    s.work = kids.reduce((a, k) => a + out[k]!.work, 0);
    s.actualWork = kids.reduce((a, k) => a + out[k]!.actualWork, 0);
    s.remainingWork = Math.max(0, s.work - s.actualWork);
    s.critical = kids.some((k) => out[k]!.critical);
    s.slack = Math.min(...kids.map((k) => out[k]!.slack));
    s.conflict = kids.some((k) => out[k]!.conflict);
    s.deadlineMissed = kids.some((k) => out[k]!.deadlineMissed);
    s.manual = false;
    const starts = kids.map((k) => out[k]!.actualStart).filter((x): x is Time => x !== null);
    s.actualStart = starts.length ? Math.min(...starts) : null;
    s.actualFinish = kids.every((k) => out[k]!.actualFinish !== null) ? Math.max(...kids.map((k) => out[k]!.actualFinish!)) : null;
  }

  const leaves = out.filter((t) => !t.summary);
  const first = leaves.length ? Math.min(...leaves.map((t) => t.start)) : origin;
  const last = leaves.length ? Math.max(...leaves.map((t) => t.finish)) : origin;
  const totalDur = leaves.reduce((a, t) => a + Math.max(1, t.duration), 0);
  const percent = leaves.length ? Math.round(leaves.reduce((a, t) => a + Math.max(1, t.duration) * t.percent, 0) / totalDur) : 0;
  const summaryFixed = tasks.reduce((a, t, i) => a + (summary[i] ? t.fixedCost : 0), 0);

  const result: Schedule = {
    tasks: out,
    byId: new Map(out.map((t) => [t.id, t])),
    assignments,
    start: first,
    finish: last,
    duration: leaves.length ? dcal.workBetween(first, last) : 0,
    cost: out.reduce((a, t, i) => a + (summary[i] ? 0 : t.cost), 0) + summaryFixed,
    actualCost: out.reduce((a, t, i) => a + (summary[i] ? 0 : t.actualCost), 0),
    work: out.reduce((a, t, i) => a + (summary[i] ? 0 : t.work), 0),
    actualWork: out.reduce((a, t, i) => a + (summary[i] ? 0 : t.actualWork), 0),
    percent,
    overallocations: [],
    warnings,
    calendars,
  };
  result.overallocations = overallocationsOf(p, result);
  return result;
}

export function durationLabel(minutes: number, minutesPerDay = 480): string {
  const d = minutes / minutesPerDay;
  if (minutes === 0) return '0 días';
  if (minutes < minutesPerDay && minutes % 60 === 0) return `${minutes / 60} h`;
  if (minutes < minutesPerDay) return `${minutes} min`;
  const r = Math.round(d * 100) / 100;
  return `${r} ${r === 1 ? 'día' : 'días'}`;
}

export type { Task };
export type { WorkCalendar };
