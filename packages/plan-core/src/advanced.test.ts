import { describe, expect, it } from 'vitest';
import { absToWall, REPORTS, buildReport, chartSvg, reportToCsv, reportToHtml, clearLeveling, dayBasis, dayOf, exportMspdi, fingerprint, insertProject, liveSubprojects, refreshSubproject, formatDuration, formatPredecessors, importMspdi, levelResources, newAssignment, newCalendar, newProject, newResource, newTask, nowIn, offsetAt, parseDuration, parsePredecessors, parseProject, projectEarnedValue, schedule, setBaseline, serializeProject, timeOf, validZone, wallToAbs, type Project, type Report, type Task } from './index';

const MON = dayOf(2025, 3, 3);
const T = (d: number, h = 0, m = 0) => timeOf(MON + d, h * 60 + m);
const D = 480;

function project(tasks: Partial<Task>[]): Project {
  const p = newProject('Prueba', T(0, 8));
  p.tasks = tasks.map((t, i) => ({ ...newTask(t.name ?? `T${i + 1}`), duration: D, ...t }));
  return p;
}
const lnk = (t: Task, type: 'FS' | 'SS' | 'FF' | 'SF' = 'FS', lag = 0) => ({ task: t.id, type, lag });

describe('"as late as possible"', () => {
  it('a task with no successors goes to the end of the project; a chain stays put', () => {
    const p = project([{ name: 'Larga', duration: 5 * D }, { name: 'Corta', duration: D, constraint: { type: 'alap', date: null } }]);
    const s = schedule(p);
    expect(s.tasks[1]!.finish).toBe(s.tasks[0]!.finish);
    expect(s.tasks[1]!.start).toBeGreaterThan(s.tasks[0]!.start);
    expect(s.tasks[1]!.slack).toBe(0);
  });
  it('stops before its successor and respects the lag', () => {
    const p = project([{ name: 'A', duration: 5 * D }, { name: 'B', duration: D, constraint: { type: 'alap', date: null } }, { name: 'C', duration: D }]);
    p.tasks[2]!.links = [lnk(p.tasks[1]!, 'FS', 0), lnk(p.tasks[0]!)];
    const s = schedule(p);
    // B finishes where C starts: the day after A ends
    expect(s.tasks[1]!.finish).toBe(s.tasks[0]!.finish);
    expect(s.tasks[1]!.start).toBeGreaterThan(s.tasks[0]!.start);
    expect(s.tasks[2]!.start).toBeGreaterThanOrEqual(s.tasks[0]!.finish);
  });
  it('never moves earlier than the links allow', () => {
    const p = project([{ name: 'A', duration: D }, { name: 'B', duration: D, constraint: { type: 'alap', date: null } }]);
    p.tasks[1]!.links = [lnk(p.tasks[0]!)];
    const s = schedule(p);
    expect(s.tasks[1]!.start).toBe(T(1, 8));
  });
});

describe('resource leveling', () => {
  const crowded = () => {
    const p = project([{ name: 'A', duration: 2 * D }, { name: 'B', duration: 2 * D }, { name: 'C', duration: D }]);
    const r = newResource('Ana');
    p.resources = [r];
    for (const t of p.tasks) t.assignments = [newAssignment(r.id, 1)];
    return p;
  };
  it('detects the overallocation and leveling removes it by delaying the least important task', () => {
    const p = crowded();
    p.tasks[1]!.priority = 200;
    expect(schedule(p).overallocations.length).toBeGreaterThan(0);
    const r = levelResources(p);
    expect(schedule(r.project).overallocations).toEqual([]);
    expect(r.unresolved).toEqual([]);
    // B (priority 200) goes first to the back; A keeps its start
    const a = r.project.tasks[0]!;
    const b = r.project.tasks[1]!;
    expect(a.levelDelay ?? 0).toBe(0);
    expect(b.levelDelay ?? 0).toBeGreaterThan(0);
    const s = schedule(r.project);
    expect(s.tasks[1]!.start).toBeGreaterThanOrEqual(s.tasks[0]!.finish);
    expect(r.moved.length).toBeGreaterThan(0);
  });
  it('clears the delays', () => {
    const r = levelResources(crowded());
    const back = clearLeveling(r.project);
    expect(back.tasks.every((t) => !t.levelDelay)).toBe(true);
    expect(schedule(back).overallocations.length).toBeGreaterThan(0);
  });
  it('within the slack it refuses to push the end of the project', () => {
    const p = crowded();
    const r = levelResources(p, { withinSlack: true });
    expect(r.unresolved.length).toBeGreaterThan(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it('does not touch tasks under way or outside the scope', () => {
    const p = crowded();
    p.tasks[1]!.percent = 50;
    p.tasks[2]!.percent = 50;
    const r = levelResources(p);
    expect(r.project.tasks[0]!.levelDelay ?? 0).toBeGreaterThan(0);
    expect(r.project.tasks[1]!.levelDelay ?? 0).toBe(0);
    const only = levelResources(crowded(), { scope: [] });
    expect(only.moved).toEqual([]);
  });
  it('survives a round trip through the file and MSPDI', () => {
    const r = levelResources(crowded());
    r.project.tasks[0]!.priority = 800;
    const again = parseProject(serializeProject(r.project));
    expect(again.tasks.map((t) => [t.priority, t.levelDelay])).toEqual(r.project.tasks.map((t) => [t.priority, t.levelDelay]));
    const x = importMspdi(exportMspdi(r.project)).project;
    expect(x.tasks.map((t) => [t.priority ?? 500, t.levelDelay ?? 0])).toEqual(r.project.tasks.map((t) => [t.priority ?? 500, t.levelDelay ?? 0]));
  });
});

describe('calendars of resources and of tasks', () => {
  it('with the option on, a task waits for the days its resource works', () => {
    const p = project([{ name: 'A', duration: 2 * D }]);
    const part = newCalendar('Lun-Mié');
    const day = [{ from: 480, to: 720 }, { from: 780, to: 1020 }];
    part.week = [[], day, day, day, [], [], []] as never;
    p.calendars.push(part);
    const r = newResource('Pili');
    r.calendar = part.id;
    p.resources = [r];
    p.tasks[0]!.duration = 5 * D;
    p.tasks[0]!.assignments = [newAssignment(r.id, 1)];
    const off = schedule(p);
    expect(off.tasks[0]!.finish).toBe(T(4, 17));
    p.resourceCalendars = true;
    const on = schedule(p);
    // Mon–Wed 3 days, then Mon–Tue of the next week
    expect(on.tasks[0]!.finish).toBe(T(8, 17));
    expect(on.tasks[0]!.finish).toBeGreaterThan(off.tasks[0]!.finish);
  });
  it('a resource that never matches the task calendar leaves the task as it was, with a warning', () => {
    const p = project([{ name: 'A', duration: D }]);
    const none = newCalendar('Nada');
    none.week = [[], [], [], [], [], [], []] as never;
    p.calendars.push(none);
    const r = newResource('X');
    r.calendar = none.id;
    p.resources = [r];
    p.tasks[0]!.assignments = [newAssignment(r.id, 1)];
    p.resourceCalendars = true;
    const s = schedule(p);
    expect(s.tasks[0]!.finish).toBe(T(0, 17));
    expect(s.warnings.some((w) => /no coinciden/.test(w))).toBe(true);
  });
  it('days follow the hours of the task calendar only when the project asks', () => {
    const p = project([{ name: 'A' }]);
    const six = newCalendar('Seis horas');
    six.week = [null, [{ from: 480, to: 840 }], [{ from: 480, to: 840 }], [{ from: 480, to: 840 }], [{ from: 480, to: 840 }], [{ from: 480, to: 840 }], null].map((x) => x ?? []) as never;
    p.calendars.push(six);
    p.tasks[0]!.calendar = six.id;
    p.tasks[0]!.duration = 6 * 60 * 2;
    expect(formatDuration(p.tasks[0]!.duration, false, dayBasis(p, p.tasks[0]!))).toBe('1,5d');
    p.taskCalendarDays = true;
    expect(dayBasis(p, p.tasks[0]!).minutesPerDay).toBe(360);
    expect(formatDuration(p.tasks[0]!.duration, false, dayBasis(p, p.tasks[0]!))).toBe('2d');
    expect(parseDuration('3d', dayBasis(p, p.tasks[0]!))?.minutes).toBe(1080);
    expect(parseDuration('3d', dayBasis(p, newTask('x')))?.minutes).toBe(1440);
    expect(parseProject(serializeProject(p)).taskCalendarDays).toBe(true);
  });
});

describe('time zone', () => {
  const zone = 'Europe/Madrid';
  it('knows the offsets and the clock change', () => {
    expect(validZone(zone)).toBe(true);
    expect(validZone('Marte/Olimpo')).toBe(false);
    expect(offsetAt(zone, Date.UTC(2025, 0, 15, 12))).toBe(60);
    expect(offsetAt(zone, Date.UTC(2025, 6, 15, 12))).toBe(120);
    const wall = timeOf(dayOf(2025, 3, 29), 12 * 60);
    expect(absToWall(zone, wallToAbs(zone, wall))).toBe(wall);
  });
  it('an elapsed task that crosses the spring-forward is one hour shorter on the clock... and one hour longer in minutes', () => {
    // 29 March 2025, 12:00 -> 30 March 12:00 is a day of 24 h; the 30th has only 23 h (clock goes 2:00 -> 3:00)
    const make = (z?: string) => {
      const p = project([{ name: 'E', duration: 2 * 1440, elapsed: true, constraint: { type: 'snet', date: timeOf(dayOf(2025, 3, 29), 12 * 60) } }]);
      if (z) p.timeZone = z;
      return p;
    };
    const plain = schedule(make());
    const zoned = schedule(make(zone));
    expect(plain.tasks[0]!.finish).toBe(timeOf(dayOf(2025, 3, 31), 12 * 60));
    // 48 real hours after Saturday 12:00 is Monday 13:00 on the wall clock (the Sunday lost an hour)
    expect(zoned.tasks[0]!.finish).toBe(timeOf(dayOf(2025, 3, 31), 13 * 60));
    expect(parseProject(serializeProject(make(zone))).timeZone).toBe(zone);
    expect(parseProject(serializeProject({ ...make(), timeZone: 'Marte/Olimpo' })).timeZone).toBeUndefined();
  });
  it('now is read in the project zone', () => {
    const at = new Date(Date.UTC(2025, 6, 1, 22, 30));
    expect(nowIn('Asia/Tokyo', at)).toBe(timeOf(dayOf(2025, 7, 2), 7 * 60 + 30));
    expect(nowIn('America/New_York', at)).toBe(timeOf(dayOf(2025, 7, 1), 18 * 60 + 30));
  });
});

describe('Project XML extras', () => {
  it('writes the interruption of a split task and reads it back', () => {
    const p = project([{ name: 'Partida', duration: 4 * D, splits: [{ after: D, gap: D }] }]);
    const xml = exportMspdi(p);
    expect(xml).toContain('<ResumeValid>1</ResumeValid>');
    const q = importMspdi(xml).project;
    expect(q.tasks[0]!.splits).toEqual([{ after: D, gap: D }]);
    expect(schedule(q).tasks[0]!.finish).toBe(schedule(p).tasks[0]!.finish);
  });
  it('custom fields and the full list of splits only travel when asked for, and come back', () => {
    const p = project([{ name: 'A', duration: 5 * D, splits: [{ after: D, gap: D }, { after: 3 * D, gap: 2 * D }] }]);
    p.customFields = [{ id: 'f1', name: 'Área', target: 'task', type: 'text' }, { id: 'f2', name: 'Riesgo', target: 'task', type: 'number' }, { id: 'f3', name: 'Revisada', target: 'task', type: 'flag' }];
    p.tasks[0]!.custom = { f1: 'Obras', f2: 7, f3: true };
    expect(exportMspdi(p)).not.toContain('Área');
    const xml = exportMspdi(p, { extendedFields: true });
    expect(xml).toContain('<Alias>Área</Alias>');
    const q = importMspdi(xml).project;
    expect(q.tasks[0]!.splits).toEqual(p.tasks[0]!.splits);
    expect(q.customFields.map((c) => c.name).sort()).toEqual(['Revisada', 'Riesgo', 'Área']);
    const byName = Object.fromEntries(q.customFields.map((c) => [c.name, q.tasks[0]!.custom[c.id]]));
    expect(byName).toEqual({ Área: 'Obras', Riesgo: 7, Revisada: true });
  });
  it('percent lag: typed, scheduled, saved and exchanged', () => {
    const p = project([{ name: 'A', duration: 4 * D }, { name: 'B' }]);
    expect(parsePredecessors('1SS+50%', p, 1).links[0]).toMatchObject({ type: 'SS', lag: 50, percent: true });
    p.tasks[1]!.links = parsePredecessors('1SS+50%', p, 1).links;
    expect(formatPredecessors(p, p.tasks[1]!)).toBe('1SS+50%');
    const s = schedule(p);
    // half of 4 days after the start of A
    expect(s.tasks[1]!.start).toBe(T(2, 8));
    p.tasks[0]!.duration = 2 * D;
    expect(schedule(p).tasks[1]!.start).toBe(T(1, 8));
    expect(parseProject(serializeProject(p)).tasks[1]!.links[0]!.percent).toBe(true);
    const q = importMspdi(exportMspdi(p));
    expect(q.project.tasks[1]!.links[0]).toMatchObject({ lag: 50, percent: true });
    expect(q.warnings.some((w) => /porcentaje/.test(w))).toBe(false);
  });
  it('cost resources: their units are money and they travel as type 2', () => {
    const p = project([{ name: 'A' }]);
    const r = newResource('Viaje');
    r.type = 'cost';
    r.rate = 1;
    p.resources = [r];
    p.tasks[0]!.assignments = [newAssignment(r.id, 250)];
    const s = schedule(p);
    expect(s.tasks[0]!.cost).toBe(250);
    expect(s.tasks[0]!.work).toBe(0);
    const q = importMspdi(exportMspdi(p));
    expect(q.project.resources[0]!.type).toBe('cost');
    expect(schedule(q.project).tasks[0]!.cost).toBe(250);
    expect(parseProject(serializeProject(p)).resources[0]!.type).toBe('cost');
  });
});

describe('weighted earned value', () => {
  const plan = (accrual: 'start' | 'end' | 'prorated') => {
    const p = project([{ name: 'A', duration: 2 * D, fixedCost: 1000, fixedCostAccrual: accrual }]);
    const r = newResource('Ana');
    r.rate = 60; // 60 per hour: 16 h = 960
    p.resources = [r];
    p.tasks[0]!.assignments = [newAssignment(r.id, 1)];
    const s0 = schedule(p);
    const withBase = setBaseline(p, s0, 0, T(0, 8));
    return withBase;
  };
  const ev = (p: Project) => projectEarnedValue(p, schedule(p), 0, T(1, 8));
  it('by percent, 50 % of the baseline is earned whatever the cost is made of', () => {
    const p = plan('start');
    p.tasks[0]!.percent = 50;
    expect(ev(p).ev).toBeCloseTo(0.5 * ev(p).bac, 3);
  });
  it('a fixed cost charged at the start counts as soon as the task starts', () => {
    const p = plan('start');
    p.weightedEarnedValue = true;
    p.tasks[0]!.percent = 50;
    // 1000 at the start + half of 960
    expect(ev(p).ev).toBeCloseTo(1000 + 480, 3);
    p.tasks[0]!.percent = 0;
    expect(ev(p).ev).toBe(0);
  });
  it('a fixed cost charged at the end only counts when the task is done', () => {
    const p = plan('end');
    p.weightedEarnedValue = true;
    p.tasks[0]!.percent = 50;
    expect(ev(p).ev).toBeCloseTo(480, 3);
    p.tasks[0]!.percent = 100;
    expect(ev(p).ev).toBeCloseTo(1960, 3);
  });
  it('prorated costs give the same result as the percent, and the option is saved', () => {
    const p = plan('prorated');
    p.weightedEarnedValue = true;
    p.tasks[0]!.percent = 25;
    expect(ev(p).ev).toBeCloseTo(0.25 * ev(p).bac, 3);
    expect(parseProject(serializeProject(p)).weightedEarnedValue).toBe(true);
  });
});

describe('subprojects as a live link', () => {
  const other = () => {
    const o = project([{ name: 'Cimientos' }, { name: 'Muros' }]);
    o.name = 'Obra';
    o.customFields = [{ id: 'cf', name: 'Zona', target: 'task', type: 'text' }];
    o.tasks[0]!.custom = { cf: 'Norte' };
    o.tasks[1]!.links = [{ task: o.tasks[0]!.id, type: 'FS', lag: 0 }];
    return o;
  };
  it('brings the custom fields of the subproject and their values', () => {
    const p = project([{ name: 'Mío' }]);
    const r = insertProject(p, other(), 0, 'obra.novaplan', { live: true, stamp: 'x' });
    expect(r.warnings.some((w) => /personalizados/.test(w))).toBe(false);
    expect(r.project.customFields.map((c) => c.name)).toEqual(['Zona']);
    const id = r.project.customFields[0]!.id;
    expect(r.project.tasks.find((t) => t.name === 'Cimientos')!.custom[id]).toBe('Norte');
    // a second insertion reuses the field
    expect(insertProject(r.project, other(), 0, null).project.customFields).toHaveLength(1);
    expect(r.project.tasks[r.index]!.subproject).toMatchObject({ live: true, stamp: 'x', path: 'obra.novaplan' });
  });
  it('knows which tasks follow a file, and a refresh keeps the link and takes the new stamp', () => {
    const p = project([{ name: 'Mío' }]);
    const r = insertProject(p, other(), 0, 'obra.novaplan', { live: true, stamp: fingerprint('uno') });
    expect(liveSubprojects(r.project).map((t) => t.name)).toEqual(['Obra']);
    const o2 = other();
    o2.tasks.push({ ...newTask('Cubierta'), duration: D });
    const again = refreshSubproject(r.project, r.project.tasks[r.index]!.id, o2, fingerprint('dos'));
    expect(again.project.tasks.map((t) => t.name)).toContain('Cubierta');
    expect(again.project.tasks[again.index]!.subproject).toMatchObject({ live: true, stamp: fingerprint('dos') });
    expect(fingerprint('uno')).not.toBe(fingerprint('dos'));
    expect(fingerprint('uno')).toBe(fingerprint(new TextEncoder().encode('uno')));
    expect(parseProject(serializeProject(again.project)).tasks[again.index]!.subproject?.live).toBe(true);
  });
});

describe('report export', () => {
  const rep = () => {
    const p = project([{ name: 'A', fixedCost: 100 }, { name: 'B', fixedCost: 50 }]);
    p.tasks[1]!.links = [{ task: p.tasks[0]!.id, type: 'FS', lag: 0 }];
    const s = schedule(p);
    return { p, s };
  };
  it('writes every report as CSV with its KPIs, tables and the data behind the charts', () => {
    const { p, s } = rep();
    for (const r of REPORTS) {
      const report = buildReport(r.id, p, s, { now: T(1, 8) });
      const csv = reportToCsv(report);
      expect(csv.split('\r\n')[0]).toBe(report.title);
      for (const k of report.kpis) expect(csv).toContain(k.value);
      for (const t of report.tables) expect(csv).toContain(t.title);
      for (const c of report.charts) expect(csv).toContain(c.title);
    }
  });
  it('quotes cells that have the separator or quotes, and translates with the function it is given', () => {
    const report: Report = { id: 'overview', title: 'Título', kpis: [{ label: 'Total; neto', value: '1' }], charts: [], tables: [{ title: 'T', columns: ['a'], rows: [['x "y"']] }] };
    const csv = reportToCsv(report, (s) => (s === 'Título' ? 'Title' : s));
    expect(csv).toContain('"Total; neto";1');
    expect(csv).toContain('"x ""y"""');
    expect(csv.startsWith('Title')).toBe(true);
  });
  it('draws all kinds of chart as SVG and escapes the text', () => {
    const base = { id: 'c', title: 'A <b>', categories: ['x&y', 'z'], series: [{ name: 'S1', data: [1, 3] as (number | null)[] }, { name: 'S2', data: [2, null] as (number | null)[] }] };
    for (const kind of ['bar', 'stack', 'line', 'area', 'pie'] as const) {
      const svg = chartSvg({ ...base, kind });
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      expect(svg).not.toContain('<b>');
    }
    expect(chartSvg({ ...base, kind: 'bar' })).toContain('x&amp;y');
    expect(chartSvg({ ...base, kind: 'bar', categories: [], series: [] })).toContain('<svg');
  });
  it('builds one HTML page per report with the title, the project and its tables', () => {
    const { p, s } = rep();
    for (const r of REPORTS) {
      const report = buildReport(r.id, p, s, { now: T(1, 8) });
      const html = reportToHtml(report, { project: 'Mi <proyecto>', date: '3/3/2025' });
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).toContain('Mi &lt;proyecto&gt;');
      expect(html).toContain(report.title);
      expect(html).not.toContain('onload');
      expect((html.match(/<svg/g) ?? []).length).toBe(report.charts.length);
      expect((html.match(/<table/g) ?? []).length).toBe(report.tables.length);
    }
    expect(reportToHtml(buildReport('overview', p, s), { project: 'x', autoPrint: true })).toContain('window.print()');
  });
});
