/** Calendar days since 1970-01-01 (UTC). */
export type Day = number;
/** Minutes since 1970-01-01 00:00 (UTC). Dates and hours of the day are one number; there are no time zones or DST. */
export type Time = number;

export const MIN_PER_DAY = 1440;
export const timeOf = (day: Day, minute = 0): Time => day * MIN_PER_DAY + minute;
export const dayOfTime = (t: Time): Day => Math.floor(t / MIN_PER_DAY);
export const minuteOfTime = (t: Time): number => t - dayOfTime(t) * MIN_PER_DAY;

export const dayOf = (y: number, m: number, d: number): Day => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
export const dateOfDay = (day: Day): Date => new Date(day * 86400000);
/** 0 = Sunday … 6 = Saturday. */
export const dowOf = (day: Day): number => (((day + 4) % 7) + 7) % 7;

export function isoOf(day: Day): string {
  const d = dateOfDay(day);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function dayOfIso(s: string): Day | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (!m) return null;
  const day = dayOf(+m[1]!, +m[2]!, +m[3]!);
  return isoOf(day) === `${m[1]}-${m[2]}-${m[3]}` ? day : null;
}

/** "2025-03-14T08:00:00" to a time (seconds are dropped). */
export function timeOfIso(s: string): Time | null {
  const day = dayOfIso(s);
  if (day === null) return null;
  const m = /T(\d{2}):(\d{2})/.exec(s);
  return timeOf(day, m ? +m[1]! * 60 + +m[2]! : 0);
}
export const hhmm = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export function isoOfTime(t: Time): string {
  return `${isoOf(dayOfTime(t))}T${hhmm(minuteOfTime(t))}:00`;
}

export const todayDay = (): Day => {
  const n = new Date();
  return dayOf(n.getFullYear(), n.getMonth() + 1, n.getDate());
};
export const nowTime = (): Time => {
  const n = new Date();
  return timeOf(todayDay(), n.getHours() * 60 + n.getMinutes());
};

export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';

export interface Link {
  /** Id of the predecessor task. */
  task: string;
  type: LinkType;
  /** Minutes of working time of the successor's calendar (negative = lead), or elapsed minutes when `elapsed`. */
  lag: number;
  elapsed?: boolean;
  /** `lag` is a percentage of the predecessor's duration (50 = half of it), not minutes. */
  percent?: boolean;
}

export type ConstraintType = 'asap' | 'alap' | 'snet' | 'snlt' | 'fnet' | 'fnlt' | 'mso' | 'mfo';
/** Duration is fixed (work follows), work is fixed (duration follows), or units are fixed (as in Project's default). */
export type TaskType = 'units' | 'duration' | 'work';
export type Accrual = 'start' | 'prorated' | 'end';

export interface Assignment {
  resource: string;
  /** Work resources: 1 = 100 %. Material resources: quantity. */
  units: number;
  /** Work done by this resource, in minutes, when entered by hand; null = from the percent complete of the task. */
  actualWork: number | null;
  /** Cost already incurred, when entered by hand; null = actual work times the rate. */
  actualCost: number | null;
}

/** A pause inside a task: after `after` working minutes the task stops for `gap` working minutes, then goes on. */
export interface Split {
  after: number;
  gap: number;
}

export type CustomValue = string | number | boolean | null;

export interface Task {
  id: string;
  name: string;
  /** 1 = top level. A task is a summary when the next task is deeper. */
  outline: number;
  /** Working minutes of the task's calendar, or elapsed minutes when `elapsed` (0 = milestone). */
  duration: number;
  elapsed: boolean;
  type: TaskType;
  effortDriven: boolean;
  /** Planned work in minutes. Only used when the type or effort-driven rule makes work the fixed value. */
  work: number | null;
  constraint: { type: ConstraintType; date: Time | null };
  deadline: Time | null;
  /** Manually scheduled: the dates below are the user's and the links do not move the task. */
  manual: boolean;
  manualStart: Time | null;
  manualFinish: Time | null;
  /** 0–100. */
  percent: number;
  links: Link[];
  assignments: Assignment[];
  fixedCost: number;
  fixedCostAccrual: Accrual;
  /** Actual dates and totals entered by hand (null = taken from the percent complete). */
  actualStart: Time | null;
  actualFinish: Time | null;
  actualWork: number | null;
  actualCost: number | null;
  /** Calendar of the task (null = the project's). */
  calendar: string | null;
  splits: Split[];
  /** 0–1000 (500 = normal): leveling delays the lower ones first. */
  priority?: number;
  /** Working minutes the leveling added before the task starts. */
  levelDelay?: number;
  notes: string;
  custom: Record<string, CustomValue>;
  /** This summary task stands for another project that was inserted here. */
  subproject?: {
    name: string;
    path: string | null;
    /** Live link: the tasks are read again from the file whenever it changes. */
    live?: boolean;
    /** Fingerprint of the file the tasks were read from. */
    stamp?: string;
  };
  /** Id the task had in the file it came from (subprojects). */
  origin?: string;
}

export interface Resource {
  id: string;
  name: string;
  /** Cost: no work, no rate; the units of an assignment are the amount of money. */
  type: 'work' | 'material' | 'cost';
  /** Work: maximum units (1 = 100 %). */
  maxUnits: number;
  /** Cost per hour (work) or per unit (material). */
  rate: number;
  /** Cost each time the resource is assigned to a task. */
  costPerUse: number;
  /** Calendar of the resource (null = the project's). */
  calendar: string | null;
  group: string;
  email: string;
  custom: Record<string, CustomValue>;
}

export interface WorkPeriod {
  /** Minutes of the day, `from` < `to`. */
  from: number;
  to: number;
}

export interface CalendarException {
  from: Day;
  to: Day;
  /** Working periods of those days; empty = not working. */
  periods: WorkPeriod[];
  name?: string;
}

export interface CalendarDef {
  id: string;
  name: string;
  /** Calendar this one is based on (days it does not define come from there). */
  base: string | null;
  /** Sunday … Saturday. null = as the base calendar (non-working when there is none); [] = non-working. */
  week: (WorkPeriod[] | null)[];
  exceptions: CalendarException[];
}

export interface BaselineEntry {
  start: Time;
  finish: Time;
  /** Working minutes. */
  duration: number;
  work: number;
  cost: number;
}

export interface Baseline {
  /** When it was saved. */
  date: Time;
  tasks: Record<string, BaselineEntry>;
}

export type CustomFieldType = 'text' | 'number' | 'cost' | 'date' | 'flag' | 'duration' | 'list';

export interface CustomFieldDef {
  id: string;
  name: string;
  target: 'task' | 'resource';
  type: CustomFieldType;
  /** Choices of a `list` field. */
  list?: string[];
  /** Expression that calculates the value ([Duración] * 2, IIf([% completado] = 100, "Hecha", "Pendiente")). */
  formula?: string;
  /** How a summary task gets its value from its sub-tasks (number, cost, duration fields). */
  rollup?: 'none' | 'sum' | 'max' | 'min' | 'avg' | 'count';
}

export type FilterOp = 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le' | 'contains' | 'notcontains' | 'startswith' | 'empty' | 'notempty';

export interface FilterCriterion {
  field: string;
  op: FilterOp;
  value: string | number | boolean | null;
}

export interface FilterDef {
  id: string;
  name: string;
  mode: 'and' | 'or';
  criteria: FilterCriterion[];
}

export interface GroupLevel {
  field: string;
  desc?: boolean;
  /** Numbers and dates: group in intervals of this size (minutes for dates and durations). */
  interval?: number;
}

export interface GroupDef {
  id: string;
  name: string;
  levels: GroupLevel[];
}

export const BASELINES = 11;

export interface Project {
  version: 2;
  name: string;
  /** Start of the project (a date and an hour). */
  start: Time;
  calendars: CalendarDef[];
  /** Id of the project calendar. */
  calendar: string;
  /** How a "day", a "week" and a "month" convert to working minutes in durations. */
  minutesPerDay: number;
  minutesPerWeek: number;
  daysPerMonth: number;
  tasks: Task[];
  resources: Resource[];
  /** Baseline and baselines 1 to 10. */
  baselines: (Baseline | null)[];
  statusDate: Time | null;
  customFields: CustomFieldDef[];
  filters: FilterDef[];
  groups: GroupDef[];
  /** Current filter and group of the task table. */
  view: { filter: string | null; group: string | null };
  /** Currency symbol shown with costs. */
  currency: string;
  /** A task advances only while the calendar of the task and the calendar of at least one of its work resources are both working. */
  resourceCalendars?: boolean;
  /** "Days" typed or shown for a task use the hours per day of that task's own calendar. */
  taskCalendarDays?: boolean;
  /** IANA zone of the project ("Europe/Madrid"): elapsed time and the current date follow its clock changes. */
  timeZone?: string;
  /** Earned value follows the baseline distribution of work and cost instead of a straight percent. */
  weightedEarnedValue?: boolean;
}

let counter = 0;
export const newId = (p: string): string => `${p}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const STANDARD_CALENDAR_ID = 'cal-standard';

const weekday = (): WorkPeriod[] => [
  { from: 480, to: 720 },
  { from: 780, to: 1020 },
];

export function standardCalendar(): CalendarDef {
  return { id: STANDARD_CALENDAR_ID, name: 'Estándar', base: null, week: [[], weekday(), weekday(), weekday(), weekday(), weekday(), []], exceptions: [] };
}

/** A calendar that works around the clock (night shift, machines). */
export function twentyFourSeven(id = 'cal-24h'): CalendarDef {
  const all = (): WorkPeriod[] => [{ from: 0, to: 1440 }];
  return { id, name: '24 horas', base: null, week: [all(), all(), all(), all(), all(), all(), all()], exceptions: [] };
}

export function newCalendar(name: string, base: string | null = STANDARD_CALENDAR_ID): CalendarDef {
  return { id: newId('c'), name, base, week: [null, null, null, null, null, null, null], exceptions: [] };
}

export function newTask(name = '', outline = 1): Task {
  return {
    id: newId('t'),
    name,
    outline,
    duration: 480,
    elapsed: false,
    type: 'units',
    effortDriven: false,
    work: null,
    constraint: { type: 'asap', date: null },
    deadline: null,
    manual: false,
    manualStart: null,
    manualFinish: null,
    percent: 0,
    links: [],
    assignments: [],
    fixedCost: 0,
    fixedCostAccrual: 'prorated',
    actualStart: null,
    actualFinish: null,
    actualWork: null,
    actualCost: null,
    calendar: null,
    splits: [],
    notes: '',
    custom: {},
  };
}

export function newResource(name = ''): Resource {
  return { id: newId('r'), name, type: 'work', maxUnits: 1, rate: 0, costPerUse: 0, calendar: null, group: '', email: '', custom: {} };
}

export function newAssignment(resource: string, units = 1): Assignment {
  return { resource, units, actualWork: null, actualCost: null };
}

export function newProject(name = 'Proyecto nuevo', start: Time = timeOf(todayDay(), 480)): Project {
  return {
    version: 2,
    name,
    start,
    calendars: [standardCalendar()],
    calendar: STANDARD_CALENDAR_ID,
    minutesPerDay: 480,
    minutesPerWeek: 2400,
    daysPerMonth: 20,
    tasks: [],
    resources: [],
    baselines: Array.from({ length: BASELINES }, () => null),
    statusDate: null,
    customFields: [],
    filters: [],
    groups: [],
    view: { filter: null, group: null },
    currency: '€',
  };
}

export const isSummary = (tasks: Task[], i: number): boolean => i + 1 < tasks.length && tasks[i + 1]!.outline > tasks[i]!.outline;

/** Index of the parent summary of each task (or -1). */
export function parentsOf(tasks: Task[]): number[] {
  const out: number[] = [];
  const stack: number[] = [];
  tasks.forEach((t, i) => {
    while (stack.length && tasks[stack[stack.length - 1]!]!.outline >= t.outline) stack.pop();
    out.push(stack.length ? stack[stack.length - 1]! : -1);
    stack.push(i);
  });
  return out;
}

/** Index one past the last descendant of task `i`. */
export function subtreeEnd(tasks: Task[], i: number): number {
  let j = i + 1;
  while (j < tasks.length && tasks[j]!.outline > tasks[i]!.outline) j++;
  return j;
}

export function wbsOf(tasks: Task[]): string[] {
  const counters: number[] = [];
  return tasks.map((t) => {
    counters.length = t.outline;
    for (let k = 0; k < t.outline; k++) counters[k] = counters[k] ?? 0;
    counters[t.outline - 1]!++;
    return counters.slice(0, t.outline).join('.');
  });
}

export const calendarById = (p: Project, id: string | null): CalendarDef => p.calendars.find((c) => c.id === (id ?? p.calendar)) ?? p.calendars.find((c) => c.id === p.calendar) ?? p.calendars[0]!;
