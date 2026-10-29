import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { CalendarSet, normalizePeriods } from './calendar';
import {
  BASELINES, STANDARD_CALENDAR_ID, dayOfTime, isoOfTime, newAssignment, newId, newProject, newResource, newTask, standardCalendar, timeOf, timeOfIso,
  type Accrual, type CalendarDef, type ConstraintType, type CustomFieldDef, type CustomFieldType, type LinkType, type Project, type TaskType, type WorkPeriod,
} from './model';
import { schedule } from './schedule';

const NS = 'http://schemas.microsoft.com/project';

/** "PT40H0M0S" / "P1DT4H" to minutes. */
export function parseIsoDuration(s: string): number {
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s.trim());
  if (!m) return 0;
  return Math.round(Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) + Number(m[4] ?? 0) / 60);
}

const isoDuration = (minutes: number): string => `PT${Math.floor(minutes / 60)}H${Math.round(minutes % 60)}M0S`;
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

// MSPDI link type: 0 FF, 1 FS, 2 SF, 3 SS
const LINK_OUT: Record<LinkType, number> = { FF: 0, FS: 1, SF: 2, SS: 3 };
const LINK_IN: LinkType[] = ['FF', 'FS', 'SF', 'SS'];
// MSPDI constraint types: 0 ASAP, 1 ALAP, 2 MSO, 3 MFO, 4 SNET, 5 SNLT, 6 FNET, 7 FNLT
const CONSTRAINT_OUT: Record<ConstraintType, number> = { asap: 0, alap: 1, mso: 2, mfo: 3, snet: 4, snlt: 5, fnet: 6, fnlt: 7 };
const CONSTRAINT_IN: Record<number, ConstraintType> = { 0: 'asap', 1: 'alap', 2: 'mso', 3: 'mfo', 4: 'snet', 5: 'snlt', 6: 'fnet', 7: 'fnlt' };
const TYPE_OUT: Record<TaskType, number> = { units: 0, duration: 1, work: 2 };
const TYPE_IN: TaskType[] = ['units', 'duration', 'work'];
const ACCRUAL_OUT: Record<Accrual, number> = { start: 1, end: 2, prorated: 3 };
const ACCRUAL_IN: Record<number, Accrual> = { 1: 'start', 2: 'end', 3: 'prorated' };

/** Formats 4, 6, 8, 10, 12 (and the estimated variants +32) are elapsed units. */
const isElapsedFormat = (f: number): boolean => [4, 6, 8, 10, 12, 36, 38, 40, 42, 44].includes(f);

const clock = (m: number): string => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
const minuteOfClock = (s: string): number => {
  const m = /^(\d{1,2}):(\d{2})/.exec(s.trim());
  return m ? +m[1]! * 60 + +m[2]! : 0;
};

/** The periods of a calendar for each day of the week after resolving its base calendar. */
function flatWeek(def: CalendarDef, set: CalendarSet): WorkPeriod[][] {
  const cal = set.get(def.id);
  // 1970-01-04 is a Sunday
  return Array.from({ length: 7 }, (_, i) => cal.periodsOf(3 + i));
}

function flatExceptions(def: CalendarDef, set: CalendarSet, depth = 0): CalendarDef['exceptions'] {
  const base = def.base && depth < 8 ? set.def(def.base) : undefined;
  return [...(base && base !== def ? flatExceptions(base, set, depth + 1) : []), ...def.exceptions];
}

export interface MspdiExportOptions {
  /**
   * Write the custom task fields and the full list of task splits as extended attributes. The field numbers are
   * not checked against Microsoft Project, so this is off unless asked for: NovaPlan reads them back, Project may not.
   */
  extendedFields?: boolean;
}

/** Kinds of extended attribute with how many Project has and the (unverified) number of the first. */
const EXT_KINDS: Record<string, { name: string; max: number; base: number }> = {
  text: { name: 'Text', max: 30, base: 188743731 },
  number: { name: 'Number', max: 20, base: 188743767 },
  cost: { name: 'Cost', max: 10, base: 188743786 },
  date: { name: 'Date', max: 10, base: 188743745 },
  flag: { name: 'Flag', max: 20, base: 188743752 },
  duration: { name: 'Duration', max: 10, base: 188743776 },
};
const SPLITS_ALIAS = 'NovaPlan:divisiones';

export function exportMspdi(p: Project, opts: MspdiExportOptions = {}): string {
  const s = schedule(p);
  const set = s.calendars;
  const uid = (id: string) => p.tasks.findIndex((t) => t.id === id) + 1;
  const ruid = (id: string) => p.resources.findIndex((r) => r.id === id) + 1;
  const cuid = (id: string | null) => {
    const i = p.calendars.findIndex((c) => c.id === (id ?? p.calendar));
    return (i < 0 ? 0 : i) + 1;
  };
  const times = (ps: WorkPeriod[]) => ({ WorkingTime: ps.slice(0, 5).map((x) => ({ FromTime: clock(x.from), ToTime: x.to >= 1440 ? '00:00:00' : clock(x.to) })) });
  const calendars = p.calendars.map((c, i) => {
    const week = flatWeek(c, set);
    const exceptions = flatExceptions(c, set);
    return {
      UID: i + 1,
      Name: c.name,
      IsBaseCalendar: 1,
      IsBaselineCalendar: 0,
      BaseCalendarUID: -1,
      WeekDays: { WeekDay: week.map((ps, k) => ({ DayType: k + 1, DayWorking: ps.length ? 1 : 0, ...(ps.length ? { WorkingTimes: times(ps) } : {}) })) },
      ...(exceptions.length
        ? {
            Exceptions: {
              Exception: exceptions.map((e, k) => ({
                EnteredByOccurrences: 0,
                Name: e.name ?? `Excepción ${k + 1}`,
                TimePeriod: { FromDate: `${isoOfTime(timeOf(e.from, 0))}`, ToDate: `${isoOfTime(timeOf(e.to, 1439))}` },
                DayWorking: e.periods.length ? 1 : 0,
                ...(e.periods.length ? { WorkingTimes: times(normalizePeriods(e.periods)) } : {}),
              })),
            },
          }
        : {}),
    };
  });

  // extended attributes: one per custom task field, plus one for the splits
  interface Ext { fieldId: number; name: string; alias: string; kind: string; custom: string | null }
  const ext: Ext[] = [];
  if (opts.extendedFields) {
    const used: Record<string, number> = {};
    const take = (kind: string, alias: string, custom: string | null) => {
      const k = EXT_KINDS[kind]!;
      const n = (used[kind] = (used[kind] ?? 0) + 1);
      if (n > k.max) return;
      ext.push({ fieldId: k.base + (n - 1) * (kind === 'text' ? 3 : 1), name: `${k.name}${n}`, alias, kind, custom });
    };
    for (const c of p.customFields.filter((x) => x.target === 'task')) take(c.type === 'list' ? 'text' : c.type, c.name, c.id);
    if (p.tasks.some((t) => t.splits.length)) take('text', SPLITS_ALIAS, null);
  }
  const extValue = (kind: string, v: unknown): string | null => {
    if (v === null || v === undefined || v === '') return null;
    if (kind === 'flag') return v ? '1' : '0';
    if (kind === 'date') return typeof v === 'number' ? isoOfTime(v) : null;
    if (kind === 'duration') return typeof v === 'number' ? isoDuration(v) : null;
    return String(v);
  };

  const bl = (i: number, id: string) => {
    const e = p.baselines[i]?.tasks[id];
    return e ? { Number: i, Start: isoOfTime(e.start), Finish: isoOfTime(e.finish), Duration: isoDuration(e.duration), DurationFormat: 7, Work: isoDuration(e.work), Cost: Math.round(e.cost * 100) / 100 } : null;
  };

  const tasks = [
    { UID: 0, ID: 0, Name: p.name, Type: 1, IsNull: 0, OutlineNumber: '0', OutlineLevel: 0, Summary: 1, Start: isoOfTime(s.start), Finish: isoOfTime(s.finish) },
    ...p.tasks.map((t, i) => {
      const st = s.tasks[i]!;
      const baselines = Array.from({ length: BASELINES }, (_, k) => bl(k, t.id)).filter((x): x is NonNullable<ReturnType<typeof bl>> => x !== null);
      return {
        UID: i + 1,
        ID: i + 1,
        Name: t.name,
        Type: TYPE_OUT[t.type],
        IsNull: 0,
        WBS: st.wbs,
        OutlineNumber: st.wbs,
        OutlineLevel: t.outline,
        Priority: t.priority ?? 500,
        ...(t.levelDelay ? { LevelingDelay: t.levelDelay * 10, LevelingDelayFormat: 3 } : {}),
        Start: isoOfTime(st.start),
        Finish: isoOfTime(st.finish),
        Duration: isoDuration(st.duration),
        DurationFormat: t.elapsed ? 8 : 7,
        Work: isoDuration(st.work),
        EffortDriven: t.effortDriven ? 1 : 0,
        Milestone: st.milestone ? 1 : 0,
        Summary: st.summary ? 1 : 0,
        Critical: st.critical ? 1 : 0,
        ...(t.subproject ? { IsSubproject: 1, SubprojectName: t.subproject.path ?? t.subproject.name } : {}),
        ...(t.calendar ? { CalendarUID: cuid(t.calendar) } : { CalendarUID: -1 }),
        // Project keeps only the last interruption of a task
        ...(st.segments.length > 1 ? { Stop: isoOfTime(st.segments[st.segments.length - 2]!.finish), Resume: isoOfTime(st.segments[st.segments.length - 1]!.start), ResumeValid: 1 } : {}),
        ConstraintType: CONSTRAINT_OUT[t.constraint.type],
        ...(t.constraint.date !== null && t.constraint.type !== 'asap' && t.constraint.type !== 'alap' ? { ConstraintDate: isoOfTime(t.constraint.date) } : {}),
        ...(t.deadline !== null ? { Deadline: isoOfTime(t.deadline) } : {}),
        PercentComplete: Math.round(st.percent),
        PercentWorkComplete: st.work > 0 ? Math.round((st.actualWork / st.work) * 100) : Math.round(st.percent),
        FixedCost: t.fixedCost,
        FixedCostAccrual: ACCRUAL_OUT[t.fixedCostAccrual],
        Cost: Math.round(st.cost * 100) / 100,
        ActualCost: Math.round(st.actualCost * 100) / 100,
        ActualWork: isoDuration(st.actualWork),
        RemainingWork: isoDuration(st.remainingWork),
        ...(st.actualStart !== null ? { ActualStart: isoOfTime(st.actualStart) } : {}),
        ...(st.actualFinish !== null ? { ActualFinish: isoOfTime(st.actualFinish) } : {}),
        Manual: t.manual ? 1 : 0,
        ...(t.manual && t.manualStart !== null ? { ManualStart: isoOfTime(t.manualStart) } : {}),
        ...(t.manual && t.manualFinish !== null ? { ManualFinish: isoOfTime(t.manualFinish) } : {}),
        ...(t.manual ? { ManualDuration: isoDuration(st.duration) } : {}),
        ...(t.notes ? { Notes: t.notes } : {}),
        ...(t.links.length
          ? {
              PredecessorLink: t.links
                .filter((l) => uid(l.task) > 0)
                .map((l) => ({ PredecessorUID: uid(l.task), Type: LINK_OUT[l.type], CrossProject: 0, LinkLag: Math.round(l.lag * 10), LagFormat: l.percent ? (l.elapsed ? 20 : 19) : l.elapsed ? 8 : 7 })),
            }
          : {}),
        ...(baselines.length ? { Baseline: baselines } : {}),
        ...(() => {
          const values = ext
            .map((e) => {
              const v = e.custom ? extValue(e.kind, t.custom[e.custom]) : t.splits.length ? t.splits.map((x) => `${x.after}:${x.gap}`).join(';') : null;
              return v === null ? null : { FieldID: e.fieldId, Value: v };
            })
            .filter((x): x is { FieldID: number; Value: string } => x !== null);
          return values.length ? { ExtendedAttribute: values } : {};
        })(),
      };
    }),
  ];
  const resources = [
    { UID: 0, ID: 0, Name: 'Sin asignar', Type: 1, IsNull: 0 },
    ...p.resources.map((r, i) => ({
      UID: i + 1,
      ID: i + 1,
      Name: r.name,
      Type: r.type === 'work' ? 1 : r.type === 'cost' ? 2 : 0,
      IsNull: 0,
      ...(r.group ? { Group: r.group } : {}),
      ...(r.email ? { EmailAddress: r.email } : {}),
      MaxUnits: r.maxUnits,
      StandardRate: r.rate,
      StandardRateFormat: r.type === 'work' ? 2 : 0,
      CostPerUse: r.costPerUse,
      ...(r.calendar ? { CalendarUID: cuid(r.calendar) } : {}),
    })),
  ];
  const assignments: object[] = [];
  s.assignments.forEach((a) => {
    const r = ruid(a.resource);
    if (r <= 0) return;
    assignments.push({
      UID: assignments.length + 1,
      TaskUID: a.task + 1,
      ResourceUID: r,
      Units: a.units,
      Work: isoDuration(a.work),
      ActualWork: isoDuration(a.actualWork),
      RemainingWork: isoDuration(a.remainingWork),
      Cost: Math.round(a.cost * 100) / 100,
      ActualCost: Math.round(a.actualCost * 100) / 100,
    });
  });
  const doc = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8', '@_standalone': 'yes' },
    Project: {
      '@_xmlns': NS,
      SaveVersion: 12,
      Name: p.name,
      Title: p.name,
      CreationDate: new Date().toISOString().slice(0, 19),
      ScheduleFromStart: 1,
      StartDate: isoOfTime(p.start),
      FinishDate: isoOfTime(s.finish),
      ...(p.statusDate !== null ? { StatusDate: isoOfTime(p.statusDate) } : {}),
      CalendarUID: cuid(null),
      MinutesPerDay: p.minutesPerDay,
      MinutesPerWeek: p.minutesPerWeek,
      DaysPerMonth: p.daysPerMonth,
      DefaultStartTime: '08:00:00',
      DefaultFinishTime: '17:00:00',
      CurrencySymbol: p.currency,
      ...(ext.length ? { ExtendedAttributes: { ExtendedAttribute: ext.map((e) => ({ FieldID: e.fieldId, FieldName: e.name, Alias: e.alias })) } } : {}),
      Calendars: { Calendar: calendars },
      Tasks: { Task: tasks },
      Resources: { Resource: resources },
      ...(assignments.length ? { Assignments: { Assignment: assignments } } : {}),
    },
  };
  return new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', format: true, suppressEmptyNode: false }).build(doc) as string;
}

export interface MspdiResult {
  project: Project;
  warnings: string[];
}

const CUSTOM_PREFIX: Record<string, CustomFieldType> = { text: 'text', number: 'number', cost: 'cost', flag: 'flag', date: 'date', duration: 'duration', start: 'date', finish: 'date' };

export function importMspdi(xml: string): MspdiResult {
  let doc: any;
  try {
    doc = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true, removeNSPrefix: true }).parse(xml);
  } catch {
    throw new Error('El archivo no es un XML válido.');
  }
  const root = doc?.Project;
  if (!root || typeof root !== 'object') throw new Error('No es un archivo de Microsoft Project XML (MSPDI). Los archivos .mpp no se pueden abrir: en Project, usa Archivo > Guardar como > XML.');
  const warnings: string[] = [];
  const minPerDay = Number(root.MinutesPerDay) > 0 ? Number(root.MinutesPerDay) : 480;
  const rawTasksAll = arr<any>(root.Tasks?.Task);
  const first = rawTasksAll.find((t) => String(t.UID) !== '0');
  const start = timeOfIso(String(root.StartDate ?? '')) ?? timeOfIso(String(first?.Start ?? '')) ?? timeOf(Math.floor(Date.now() / 86400000), 480);
  const p = newProject(String(root.Title ?? root.Name ?? 'Proyecto importado'), start);
  p.minutesPerDay = minPerDay;
  p.minutesPerWeek = Number(root.MinutesPerWeek) > 0 ? Number(root.MinutesPerWeek) : minPerDay * 5;
  p.daysPerMonth = Number(root.DaysPerMonth) > 0 ? Number(root.DaysPerMonth) : 20;
  if (root.CurrencySymbol) p.currency = String(root.CurrencySymbol);
  const status = timeOfIso(String(root.StatusDate ?? ''));
  p.statusDate = status;

  // calendars (a derived calendar keeps its base)
  const cals = arr<any>(root.Calendars?.Calendar);
  const calId = new Map<string, string>();
  p.calendars = [];
  for (const c of cals) {
    const def: CalendarDef = { id: newId('c'), name: String(c.Name ?? 'Calendario'), base: null, week: Array.from({ length: 7 }, () => null), exceptions: [] };
    calId.set(String(c.UID), def.id);
    p.calendars.push(def);
  }
  cals.forEach((c, i) => {
    const def = p.calendars[i]!;
    const baseUid = String(c.BaseCalendarUID ?? '-1');
    def.base = baseUid !== '-1' && calId.has(baseUid) && baseUid !== String(c.UID) ? calId.get(baseUid)! : null;
    const periodsOf = (w: any): WorkPeriod[] =>
      normalizePeriods(
        arr<any>(w?.WorkingTimes?.WorkingTime).map((x) => {
          const from = minuteOfClock(String(x.FromTime ?? '0:00'));
          let to = minuteOfClock(String(x.ToTime ?? '0:00'));
          if (to === 0 && from > 0) to = 1440;
          return { from, to };
        }),
      );
    for (const w of arr<any>(c.WeekDays?.WeekDay)) {
      const t = Number(w.DayType);
      if (t >= 1 && t <= 7) def.week[t - 1] = String(w.DayWorking) === '1' ? periodsOf(w) : [];
    }
    for (const e of arr<any>(c.Exceptions?.Exception)) {
      const a = timeOfIso(String(e.TimePeriod?.FromDate ?? ''));
      const b = timeOfIso(String(e.TimePeriod?.ToDate ?? ''));
      if (a === null || b === null || b < a || dayOfTime(b) - dayOfTime(a) > 3660) continue;
      def.exceptions.push({ from: dayOfTime(a), to: dayOfTime(b), periods: String(e.DayWorking) === '1' ? periodsOf(e) : [], name: e.Name ? String(e.Name) : undefined });
    }
  });
  // a base calendar that defines no week at all is just the standard one
  if (!p.calendars.length) p.calendars = [standardCalendar()];
  const projCal = calId.get(String(root.CalendarUID)) ?? p.calendars[0]!.id;
  p.calendar = projCal;
  // days a calendar without base leaves undefined work as in the standard calendar
  for (const c of p.calendars) if (c.base === null) c.week = c.week.map((w, k) => w ?? standardCalendar().week[k]!);

  // custom (extended) fields: type from the field name (Text1, Number2, Flag3, Cost1, Date4, Duration2)
  const custom = new Map<string, CustomFieldDef>();
  for (const e of arr<any>(root.ExtendedAttributes?.ExtendedAttribute)) {
    const name = String(e.FieldName ?? '');
    const kind = CUSTOM_PREFIX[name.replace(/\d+$/, '').toLowerCase()];
    if (!kind) continue;
    const def: CustomFieldDef = { id: newId('f'), name: String(e.Alias ?? name) || name, target: 'task', type: kind };
    custom.set(String(e.FieldID), def);
  }
  const customUsed = new Set<string>();

  const uidToId = new Map<string, string>();
  const rawTasks = rawTasksAll.filter((t) => String(t.UID) !== '0' && String(t.IsNull) !== '1');
  const tasks = rawTasks.map((r) => {
    const t = newTask(String(r.Name ?? ''), Math.max(1, Number(r.OutlineLevel) || 1));
    uidToId.set(String(r.UID), t.id);
    const fmt = Number(r.DurationFormat);
    t.elapsed = isElapsedFormat(fmt);
    t.duration = String(r.Summary) === '1' ? 0 : r.Duration ? parseIsoDuration(String(r.Duration)) : 0;
    if (String(r.Milestone) === '1') t.duration = 0;
    t.type = TYPE_IN[Number(r.Type)] ?? 'units';
    t.effortDriven = String(r.EffortDriven) === '1';
    if (r.Work && String(r.Summary) !== '1' && (t.type === 'work' || t.effortDriven)) t.work = parseIsoDuration(String(r.Work));
    t.percent = Math.min(100, Math.max(0, Number(r.PercentComplete) || 0));
    if (r.Priority !== undefined && Number(r.Priority) !== 500 && Number.isFinite(Number(r.Priority))) t.priority = Math.min(1000, Math.max(0, Math.round(Number(r.Priority))));
    if (Number(r.LevelingDelay) > 0) t.levelDelay = Math.round(Number(r.LevelingDelay) / 10);
    t.fixedCost = Number(r.FixedCost) || 0;
    t.fixedCostAccrual = ACCRUAL_IN[Number(r.FixedCostAccrual)] ?? 'prorated';
    t.notes = r.Notes ? String(r.Notes) : '';
    const ct = Number(r.ConstraintType) || 0;
    const cd = timeOfIso(String(r.ConstraintDate ?? ''));
    const mapped = CONSTRAINT_IN[ct];
    if (mapped === 'alap') t.constraint = { type: 'alap', date: null };
    else if (mapped && mapped !== 'asap' && cd !== null) t.constraint = { type: mapped, date: cd };
    t.deadline = timeOfIso(String(r.Deadline ?? ''));
    t.actualStart = timeOfIso(String(r.ActualStart ?? ''));
    t.actualFinish = timeOfIso(String(r.ActualFinish ?? ''));
    if (r.CalendarUID !== undefined && String(r.CalendarUID) !== '-1' && calId.has(String(r.CalendarUID)) && calId.get(String(r.CalendarUID)) !== projCal) t.calendar = calId.get(String(r.CalendarUID))!;
    if (String(r.Manual) === '1') {
      t.manual = true;
      t.manualStart = timeOfIso(String(r.ManualStart ?? r.Start ?? ''));
      t.manualFinish = timeOfIso(String(r.ManualFinish ?? r.Finish ?? ''));
      if (r.ManualDuration && String(r.Summary) !== '1') t.duration = parseIsoDuration(String(r.ManualDuration));
    }
    if (String(r.IsSubproject) === '1') t.subproject = { name: String(r.SubprojectName ?? 'Subproyecto'), path: null };
    for (const x of arr<any>(r.ExtendedAttribute)) {
      const def = custom.get(String(x.FieldID));
      if (def && def.name === SPLITS_ALIAS) {
        t.splits = String(x.Value ?? '').split(';').map((z) => z.split(':').map(Number)).filter((z) => z.length === 2 && z[0]! > 0 && z[1]! >= 0).map((z) => ({ after: Math.round(z[0]!), gap: Math.round(z[1]!) }));
        continue;
      }
      if (!def) continue;
      customUsed.add(String(x.FieldID));
      const v = String(x.Value ?? '');
      t.custom[def.id] = def.type === 'flag' ? v === '1' || v.toLowerCase() === 'true' : def.type === 'number' || def.type === 'cost' ? Number(v) || 0 : def.type === 'date' ? timeOfIso(v) : def.type === 'duration' ? parseIsoDuration(v) : v;
    }
    for (const b of arr<any>(r.Baseline)) {
      const n = Number(b.Number);
      const bs = timeOfIso(String(b.Start ?? ''));
      const bf = timeOfIso(String(b.Finish ?? ''));
      if (!(n >= 0 && n < BASELINES) || bs === null || bf === null) continue;
      const cur = (p.baselines[n] ??= { date: status ?? p.start, tasks: {} });
      cur.tasks[t.id] = { start: bs, finish: bf, duration: b.Duration ? parseIsoDuration(String(b.Duration)) : 0, work: b.Work ? parseIsoDuration(String(b.Work)) : 0, cost: Number(b.Cost) || 0 };
    }
    return t;
  });
  // the interruption that Project writes (stop and resume dates); the full list comes from NovaPlan's own attribute
  const sets = new CalendarSet(p.calendars, projCal);
  rawTasks.forEach((r, i) => {
    const t = tasks[i]!;
    if (t.splits.length || !(String(r.ResumeValid) === '1' && r.Stop && r.Resume)) return;
    const a = timeOfIso(String(r.Start ?? ''));
    const stop = timeOfIso(String(r.Stop));
    const back = timeOfIso(String(r.Resume));
    if (a === null || stop === null || back === null || stop <= a || back < stop) return;
    const cal = sets.get(t.calendar ?? null);
    const after = cal.workBetween(a, stop);
    if (after > 0 && after < t.duration) t.splits = [{ after, gap: cal.workBetween(stop, back) }];
  });
  if (tasks[0]) tasks[0].outline = 1;
  for (let i = 1; i < tasks.length; i++) tasks[i]!.outline = Math.min(tasks[i]!.outline, tasks[i - 1]!.outline + 1);
  rawTasks.forEach((r, i) => {
    for (const l of arr<any>(r.PredecessorLink)) {
      const from = uidToId.get(String(l.PredecessorUID));
      if (!from) continue;
      const type = LINK_IN[Number(l.Type)] ?? 'FS';
      const fmt = Number(l.LagFormat);
      // LinkLag is in tenths of a minute; the format only says how Project shows it
      let lag = Math.round(Number(l.LinkLag || 0) / 10);
      const pct = fmt === 19 || fmt === 20;
      tasks[i]!.links.push({ task: from, type, lag, ...(pct ? { percent: true } : {}), ...(isElapsedFormat(fmt) ? { elapsed: true } : {}) });
    }
  });
  p.tasks = tasks;
  p.customFields = [...custom.entries()].filter(([k]) => customUsed.has(k) && custom.get(k)!.name !== SPLITS_ALIAS).map(([, d]) => d);

  const ruid = new Map<string, string>();
  for (const r of arr<any>(root.Resources?.Resource)) {
    if (String(r.UID) === '0' || String(r.IsNull) === '1' || !r.Name) continue;
    const res = newResource(String(r.Name));
    res.type = Number(r.Type) === 0 ? 'material' : Number(r.Type) === 2 ? 'cost' : 'work';
    res.maxUnits = r.MaxUnits !== undefined ? Number(r.MaxUnits) || 1 : 1;
    res.rate = res.type === 'cost' ? 1 : Number(r.StandardRate) || 0;
    // rates per day or week would need converting; Project writes per hour by default
    const rf = Number(r.StandardRateFormat);
    if (res.type === 'work' && rf && rf !== 2) {
      const per = rf === 1 ? 1 / 60 : rf === 3 ? 1 / (minPerDay / 60) : rf === 4 ? 1 / (p.minutesPerWeek / 60) : 1;
      res.rate = res.rate * per;
      if (rf > 4) warnings.push(`La tasa de "${res.name}" está en una unidad (mes o año) que no se admite: se ha dejado como tasa por hora.`);
    }
    res.costPerUse = Number(r.CostPerUse) || 0;
    res.group = r.Group ? String(r.Group) : '';
    res.email = r.EmailAddress ? String(r.EmailAddress) : '';
    if (r.CalendarUID !== undefined && calId.has(String(r.CalendarUID)) && calId.get(String(r.CalendarUID)) !== projCal) res.calendar = calId.get(String(r.CalendarUID))!;
    ruid.set(String(r.UID), res.id);
    p.resources.push(res);
  }
  for (const a of arr<any>(root.Assignments?.Assignment)) {
    const tid = uidToId.get(String(a.TaskUID));
    const rid = ruid.get(String(a.ResourceUID));
    const task = tasks.find((t) => t.id === tid);
    if (!task || !rid) continue;
    const isCost = p.resources.find((x) => x.id === rid)?.type === 'cost';
    // the amount of a cost resource is the cost of its assignment
    const asg = newAssignment(rid, isCost ? Number(a.Cost) || 0 : a.Units !== undefined ? Number(a.Units) || 1 : 1);
    if (a.ActualWork && parseIsoDuration(String(a.ActualWork)) > 0) asg.actualWork = parseIsoDuration(String(a.ActualWork));
    task.assignments.push(asg);
  }
  if (tasks.length === 0) warnings.push('El proyecto no contiene tareas.');
  void STANDARD_CALENDAR_ID;
  return { project: p, warnings };
}
