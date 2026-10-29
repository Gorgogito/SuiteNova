import { describe, expect, it } from 'vitest';
import {
  CalendarSet, ELAPSED, dayOf, newAssignment, newCalendar, newProject, newResource, newTask, schedule, setDuration, setWork, setAssignments, assignResource, setTaskType, timeOf, twentyFourSeven,
  type Project, type Task,
} from './index';

// Monday 2025-03-03
const MON = dayOf(2025, 3, 3);
const T = (dayOffset: number, h = 0, m = 0) => timeOf(MON + dayOffset, h * 60 + m);
const H = 60;
const D = 480;

function project(tasks: Partial<Task>[], extra: Partial<Project> = {}): Project {
  const p = newProject('Prueba', T(0, 8));
  p.tasks = tasks.map((t, i) => ({ ...newTask(t.name ?? `T${i + 1}`), duration: D, ...t }));
  return { ...p, ...extra };
}
const link = (task: Task, type: 'FS' | 'SS' | 'FF' | 'SF' = 'FS', lag = 0, elapsed = false) => ({ task: task.id, type, lag, ...(elapsed ? { elapsed: true } : {}) });

describe('working time arithmetic', () => {
  const set = new CalendarSet(newProject().calendars, newProject().calendar);
  const c = set.default;
  it('adds work across lunch and days', () => {
    expect(c.addWork(T(0, 8), 4 * H)).toBe(T(0, 12));
    expect(c.addWork(T(0, 8), 5 * H)).toBe(T(0, 14));
    expect(c.addWork(T(0, 8), 8 * H)).toBe(T(0, 17));
    expect(c.addWork(T(0, 8), 9 * H)).toBe(T(1, 9));
    expect(c.addWork(T(4, 16), 2 * H)).toBe(T(7, 9)); // Friday 16:00 + 2 h = Monday 9:00
  });
  it('finds the next start and previous end', () => {
    expect(c.nextStart(T(0, 12))).toBe(T(0, 13));
    expect(c.nextStart(T(0, 17))).toBe(T(1, 8));
    expect(c.nextStart(T(5, 10))).toBe(T(7, 8)); // Saturday
    expect(c.prevEnd(T(0, 8))).toBe(T(-3, 17)); // Monday 8:00 -> Friday 17:00 before
    expect(c.prevEnd(T(0, 12, 30))).toBe(T(0, 12));
  });
  it('subtracts work and counts working minutes', () => {
    expect(c.subWork(T(1, 9), 2 * H)).toBe(T(0, 16));
    expect(c.subWork(T(0, 17), 8 * H)).toBe(T(0, 8));
    expect(c.workBetween(T(0, 0), T(7, 0))).toBe(5 * D);
    expect(c.workBetween(T(0, 11), T(0, 14))).toBe(2 * H);
  });
  it('knows holidays, working Saturdays and a base calendar', () => {
    const p = newProject();
    const base = p.calendars[0]!;
    base.exceptions.push({ from: MON + 1, to: MON + 1, periods: [], name: 'Festivo' });
    const mine = newCalendar('Mia');
    mine.week[6] = [{ from: 480, to: 720 }]; // Saturdays in the morning
    p.calendars.push(mine);
    const s = new CalendarSet(p.calendars, p.calendar);
    expect(s.get(base.id).isWorking(T(1, 9))).toBe(false);
    expect(s.get(mine.id).isWorking(T(1, 9))).toBe(false); // the holiday comes from the base
    expect(s.get(mine.id).isWorking(T(5, 9))).toBe(true);
    expect(s.get(mine.id).isWorking(T(0, 9))).toBe(true);
  });
  it('elapsed time counts every minute', () => {
    expect(ELAPSED.addWork(T(4, 8), 2 * 1440)).toBe(T(6, 8));
  });
  it('refuses a calendar without working time', () => {
    const p = newProject();
    p.calendars[0]!.week = [[], [], [], [], [], [], []];
    p.tasks = [newTask('x')];
    expect(() => schedule(p)).toThrow(/tiempo laborable/);
  });
});

describe('scheduling in hours', () => {
  it('chains tasks of days and hours', () => {
    const p = project([{ duration: 4 * H }, { duration: 4 * H }]);
    p.tasks[1]!.links = [link(p.tasks[0]!)];
    const s = schedule(p);
    expect(s.tasks[0]!.start).toBe(T(0, 8));
    expect(s.tasks[0]!.finish).toBe(T(0, 12));
    expect(s.tasks[1]!.start).toBe(T(0, 13));
    expect(s.tasks[1]!.finish).toBe(T(0, 17));
    expect(s.finish).toBe(T(0, 17));
    expect(s.duration).toBe(8 * H);
  });
  it('a task of 3 days starting Monday ends Wednesday 17:00 and the next starts Thursday', () => {
    const p = project([{ duration: 3 * D }, { duration: D }]);
    p.tasks[1]!.links = [link(p.tasks[0]!)];
    const s = schedule(p);
    expect(s.tasks[0]!.finish).toBe(T(2, 17));
    expect(s.tasks[1]!.start).toBe(T(3, 8));
  });
  it('lag and lead are working time of the successor', () => {
    const p = project([{ duration: D }, { duration: D }, { duration: D }]);
    p.tasks[1]!.links = [link(p.tasks[0]!, 'FS', D)];
    p.tasks[2]!.links = [link(p.tasks[0]!, 'FS', -4 * H)];
    const s = schedule(p);
    expect(s.tasks[1]!.start).toBe(T(2, 8)); // one day of lag after Monday's finish
    expect(s.tasks[2]!.start).toBe(T(0, 13)); // 4 h before the finish
  });
  it('elapsed lag runs through the weekend', () => {
    const p = project([{ duration: D }, { duration: D }]);
    p.tasks[0]!.constraint = { type: 'snet', date: T(4, 8) }; // Friday
    p.tasks[1]!.links = [link(p.tasks[0]!, 'FS', 1440, true)];
    const s = schedule(p);
    expect(s.tasks[0]!.finish).toBe(T(4, 17));
    expect(s.tasks[1]!.start).toBe(T(7, 8)); // Friday 17:00 + 24 h = Saturday 17:00 -> Monday
  });
  it('SS, FF and SF links', () => {
    const p = project([{ duration: 2 * D }, { duration: D }, { duration: D }, { duration: D }]);
    const [a, ss, ff, sf] = p.tasks as [Task, Task, Task, Task];
    ss.links = [link(a, 'SS', 4 * H)];
    ff.links = [link(a, 'FF', 0)];
    sf.links = [link(a, 'SF', 0)];
    sf.constraint = { type: 'snet', date: T(0, 8) };
    const s = schedule(p);
    expect(s.tasks[1]!.start).toBe(T(0, 13));
    expect(s.tasks[2]!.finish).toBe(T(1, 17)); // finishes with A
    expect(s.tasks[2]!.start).toBe(T(1, 8));
  });
  it('a milestone sits at the end of what drives it', () => {
    const p = project([{ duration: D }, { duration: 0 }]);
    p.tasks[1]!.links = [link(p.tasks[0]!)];
    const s = schedule(p);
    expect(s.tasks[1]!.milestone).toBe(true);
    expect(s.tasks[1]!.start).toBe(T(0, 17));
    expect(s.tasks[1]!.finish).toBe(T(0, 17));
  });
  it('an elapsed task runs through nights and weekends', () => {
    const p = project([{ duration: 2 * 1440, elapsed: true, constraint: { type: 'snet', date: T(4, 8) } }]);
    const s = schedule(p);
    expect(s.tasks[0]!.start).toBe(T(4, 8));
    expect(s.tasks[0]!.finish).toBe(T(6, 8));
  });
  it('a task can have its own calendar (a night shift)', () => {
    const p = project([{ duration: 10 * H }]);
    const night = twentyFourSeven();
    p.calendars.push(night);
    p.tasks[0]!.calendar = night.id;
    const s = schedule(p);
    expect(s.tasks[0]!.start).toBe(T(0, 8));
    expect(s.tasks[0]!.finish).toBe(T(0, 18));
  });
  it('constraints: SNET, MSO conflict, FNLT conflict and deadline', () => {
    const p = project([{ duration: D }, { duration: D }, { duration: D, deadline: T(0, 12) }, { duration: D }]);
    p.tasks[0]!.constraint = { type: 'snet', date: T(2, 10) };
    p.tasks[1]!.links = [link(p.tasks[0]!)];
    p.tasks[1]!.constraint = { type: 'mso', date: T(0, 8) };
    p.tasks[3]!.constraint = { type: 'fnlt', date: T(0, 10) };
    const s = schedule(p);
    expect(s.tasks[0]!.start).toBe(T(2, 10));
    expect(s.tasks[1]!.start).toBe(T(0, 8));
    expect(s.tasks[1]!.conflict).toBe(true);
    expect(s.tasks[2]!.deadlineMissed).toBe(true);
    expect(s.tasks[3]!.conflict).toBe(true);
  });
  it('critical path and slack in minutes', () => {
    const p = project([{ duration: 2 * D }, { duration: D }, { duration: D }]);
    // 1 -> 3 and 2 -> 3, where 2 is shorter
    p.tasks[2]!.links = [link(p.tasks[0]!), link(p.tasks[1]!)];
    const s = schedule(p);
    expect(s.tasks[0]!.critical).toBe(true);
    expect(s.tasks[1]!.critical).toBe(false);
    expect(s.tasks[1]!.slack).toBe(D);
    expect(s.tasks[2]!.critical).toBe(true);
  });
  it('ignores circular links with a warning', () => {
    const p = project([{}, {}]);
    p.tasks[0]!.links = [link(p.tasks[1]!)];
    p.tasks[1]!.links = [link(p.tasks[0]!)];
    const s = schedule(p);
    expect(s.warnings.some((w) => /circular/.test(w))).toBe(true);
  });
});

describe('split tasks and manual scheduling', () => {
  it('a split task stops and resumes', () => {
    const p = project([{ duration: 4 * D, splits: [{ after: 2 * D, gap: D }] }, { duration: D }]);
    p.tasks[1]!.links = [link(p.tasks[0]!)];
    const s = schedule(p);
    expect(s.tasks[0]!.segments.length).toBe(2);
    expect(s.tasks[0]!.segments[0]).toEqual({ start: T(0, 8), finish: T(1, 17) });
    expect(s.tasks[0]!.segments[1]).toEqual({ start: T(3, 8), finish: T(4, 17) });
    expect(s.tasks[0]!.finish).toBe(T(4, 17));
    expect(s.tasks[0]!.duration).toBe(4 * D);
  });
  it('a manual task keeps the user dates and does not follow its predecessor', () => {
    const p = project([{ duration: 3 * D }, { duration: D, manual: true, manualStart: T(1, 8), manualFinish: T(1, 17) }, { duration: D }]);
    p.tasks[1]!.links = [link(p.tasks[0]!)];
    p.tasks[2]!.links = [link(p.tasks[1]!)];
    const s = schedule(p);
    expect(s.tasks[1]!.start).toBe(T(1, 8));
    expect(s.tasks[1]!.finish).toBe(T(1, 17));
    expect(s.tasks[2]!.start).toBe(T(2, 8)); // the successor follows the manual dates
  });
  it('a manual task with only a start uses its duration', () => {
    const p = project([{ duration: 2 * D, manual: true, manualStart: T(1, 8) }]);
    const s = schedule(p);
    expect(s.tasks[0]!.finish).toBe(T(2, 17));
  });
});

describe('task types, work and cost', () => {
  const resOf = (rate = 10, extra: Partial<ReturnType<typeof newResource>> = {}) => ({ ...newResource('Ana'), rate, ...extra });
  it('fixed units: work = units x duration', () => {
    const p = project([{ duration: 2 * D }]);
    const r = resOf();
    p.resources = [r];
    p.tasks[0]!.assignments = [newAssignment(r.id, 0.5)];
    const s = schedule(p);
    expect(s.tasks[0]!.work).toBe(0.5 * 2 * D);
    expect(s.tasks[0]!.cost).toBeCloseTo(0.5 * 2 * 8 * 10);
  });
  it('fixed work: the duration follows the units', () => {
    const p = project([{ duration: D, type: 'work', work: 16 * H }]);
    const r = resOf();
    p.resources = [r];
    p.tasks[0]!.assignments = [newAssignment(r.id, 1)];
    expect(schedule(p).tasks[0]!.duration).toBe(2 * D);
    p.tasks[0]!.assignments = [newAssignment(r.id, 2)];
    expect(schedule(p).tasks[0]!.duration).toBe(D);
  });
  it('effort driven: adding people shortens the task and keeps the work', () => {
    let p = project([{ duration: 2 * D, effortDriven: true }]);
    const a = resOf();
    const b = { ...newResource('Beto'), rate: 10 };
    p.resources = [a, b];
    const id = p.tasks[0]!.id;
    p = assignResource(p, id, a.id, 1);
    expect(schedule(p).tasks[0]!.work).toBe(2 * D);
    p = assignResource(p, id, b.id, 1);
    const t = schedule(p).tasks[0]!;
    expect(t.work).toBe(2 * D);
    expect(t.duration).toBe(D);
  });
  it('editing rules: work changes the duration (units fixed), duration changes the units (work fixed)', () => {
    let p = project([{ duration: 2 * D }]);
    const r = resOf();
    p.resources = [r];
    const id = p.tasks[0]!.id;
    p = setAssignments(p, id, [newAssignment(r.id, 1)]);
    p = setWork(p, id, 4 * D);
    expect(schedule(p).tasks[0]!.duration).toBe(4 * D);
    p = setTaskType(p, id, 'work');
    p = setDuration(p, id, 2 * D);
    const t = schedule(p).tasks[0]!;
    expect(t.work).toBe(4 * D);
    expect(t.duration).toBe(2 * D);
    expect(p.tasks[0]!.assignments[0]!.units).toBe(2);
  });
  it('costs: rates per hour, cost per use, materials, fixed cost and its accrual', () => {
    const p = project([{ duration: D, fixedCost: 100, fixedCostAccrual: 'end', percent: 50 }]);
    const w = resOf(20, { costPerUse: 5 });
    const m = { ...newResource('Cemento'), type: 'material' as const, rate: 3 };
    p.resources = [w, m];
    p.tasks[0]!.assignments = [newAssignment(w.id, 1), newAssignment(m.id, 4)];
    const t = schedule(p).tasks[0]!;
    expect(t.cost).toBeCloseTo(100 + 8 * 20 + 5 + 4 * 3);
    // 50 %: half of the work and of the material, the fixed cost accrues at the end
    expect(t.actualCost).toBeCloseTo(4 * 20 + 5 + 6);
    expect(t.actualWork).toBe(4 * H);
    expect(t.remainingWork).toBe(4 * H);
  });
  it('actual work and cost entered by hand win over the percent', () => {
    const p = project([{ duration: D, percent: 10 }]);
    const w = resOf(10);
    p.resources = [w];
    p.tasks[0]!.assignments = [{ ...newAssignment(w.id, 1), actualWork: 6 * H, actualCost: 70 }];
    const t = schedule(p).tasks[0]!;
    expect(t.actualWork).toBe(6 * H);
    expect(t.actualCost).toBe(70);
  });
  it('summaries add up their children', () => {
    const p = project([{ name: 'Fase', outline: 1 }, { outline: 2, duration: D }, { outline: 2, duration: 2 * D, fixedCost: 50 }]);
    const s = schedule(p);
    expect(s.tasks[0]!.summary).toBe(true);
    expect(s.tasks[0]!.duration).toBe(2 * D); // unlinked tasks run in parallel
    expect(s.tasks[0]!.cost).toBe(50);
    expect(s.cost).toBe(50);
  });
});
