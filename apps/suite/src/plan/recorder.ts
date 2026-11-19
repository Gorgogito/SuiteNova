import { formatPredecessors, type Project, type Resource, type Task } from '@suitenova/plan-core';
import { vbString, type MacroRecorder } from '../macros/recorder';

const num = (n: number) => String(Math.round(n * 1e6) / 1e6);
const TYPES = ['work', 'material', 'cost'];
const namesOf = (t: Task, p: Project) =>
  t.assignments
    .map((a) => p.resources.find((r) => r.id === a.resource)?.name ?? '')
    .filter(Boolean)
    .join(', ');

/** The fields of a task that a macro can set: what to compare and the line that sets it. */
const TASK_FIELDS: [(t: Task, p: Project) => unknown, (t: Task, p: Project) => string][] = [
  [(t) => t.name, (t) => `Name = ${vbString(t.name)}`],
  [(t) => t.notes, (t) => `Notes = ${vbString(t.notes)}`],
  [(t) => [t.duration, t.elapsed], (t) => `Duration = ${num(t.duration)}`],
  [(t) => t.percent, (t) => `PercentComplete = ${num(t.percent)}`],
  [(t) => t.outline, (t) => `OutlineLevel = ${t.outline}`],
  [(t) => t.fixedCost, (t) => `FixedCost = ${num(t.fixedCost)}`],
  [(t) => t.priority ?? 500, (t) => `Priority = ${num(t.priority ?? 500)}`],
  [(t) => t.manual, (t) => `Manual = ${t.manual ? 'True' : 'False'}`],
  [(t, p) => formatPredecessors(p, t), (t, p) => `Predecessors = ${vbString(formatPredecessors(p, t))}`],
  [(t, p) => namesOf(t, p), (t, p) => `ResourceNames = ${vbString(namesOf(t, p))}`],
];
const HANDLED = new Set(['name', 'notes', 'duration', 'elapsed', 'percent', 'outline', 'fixedCost', 'priority', 'manual', 'links', 'assignments']);

const RESOURCE_FIELDS: [keyof Resource, (r: Resource) => string][] = [
  ['name', (r) => `Name = ${vbString(r.name)}`],
  ['type', (r) => `Type = ${Math.max(0, TYPES.indexOf(r.type))}`],
  ['maxUnits', (r) => `MaxUnits = ${num(r.maxUnits)}`],
  ['rate', (r) => `StandardRate = ${num(r.rate)}`],
  ['costPerUse', (r) => `CostPerUse = ${num(r.costPerUse)}`],
  ['group', (r) => `Group = ${vbString(r.group)}`],
  ['email', (r) => `EmailAddress = ${vbString(r.email)}`],
];
const RESOURCE_KEYS = new Set<string>(RESOURCE_FIELDS.map(([f]) => f));

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The keys of two objects whose values differ, ignoring the ones in `skip`. */
function otherChanges(a: object, b: object, skip: Set<string>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => !skip.has(k) && !same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

const LABELS: Record<string, string> = {
  constraint: 'restricciones',
  deadline: 'fecha límite',
  manualStart: 'fechas manuales',
  manualFinish: 'fechas manuales',
  type: 'tipo de tarea',
  effortDriven: 'tarea de esfuerzo conducido',
  work: 'trabajo',
  actualStart: 'fechas reales',
  actualFinish: 'fechas reales',
  actualWork: 'trabajo real',
  actualCost: 'costo real',
  calendar: 'calendarios',
  splits: 'divisiones',
  levelDelay: 'nivelación',
  custom: 'campos personalizados',
  subproject: 'subproyectos',
  fixedCostAccrual: 'acumulación del costo fijo',
};
const label = (k: string) => LABELS[k] ?? k;

/**
 * Translates what happened between two versions of a project into lines of Nova Basic with the objects of Project
 * (`ActiveProject.Tasks(2).Duration = 2400`). What a macro cannot say comes back in `unsupported`.
 * Deletions come first (from the end), then the changes, then the additions, so that the index in every line is the one the macro finds when it replays.
 */
export function describeChange(prev: Project, next: Project): { lines: string[]; unsupported: string[] } {
  const lines: string[] = [];
  const un = new Set<string>();
  if (prev === next) return { lines, unsupported: [] };

  // the project itself
  if (prev.name !== next.name) lines.push(`ActiveProject.Name = ${vbString(next.name)}`);
  for (const k of otherChanges(prev, next, new Set(['tasks', 'resources', 'name', 'macros']))) un.add(`cambios del proyecto (${k})`);

  // tasks
  const nextIds = new Set(next.tasks.map((t) => t.id));
  const prevIds = new Set(prev.tasks.map((t) => t.id));
  const gone = prev.tasks.map((t, i) => [t, i] as const).filter(([t]) => !nextIds.has(t.id));
  for (const [, i] of [...gone].reverse()) lines.push(`ActiveProject.Tasks(${i + 1}).Delete`);
  const survivors = prev.tasks.filter((t) => nextIds.has(t.id));
  const nextSurvivors = next.tasks.filter((t) => prevIds.has(t.id));
  if (!same(survivors.map((t) => t.id), nextSurvivors.map((t) => t.id))) un.add('mover tareas');
  else {
    survivors.forEach((before, i) => {
      const after = nextSurvivors[i]!;
      if (before === after) return;
      const at = `ActiveProject.Tasks(${i + 1})`;
      for (const [get, line] of TASK_FIELDS) if (!same(get(before, prev), get(after, next))) lines.push(`${at}.${line(after, next)}`);
      for (const k of otherChanges(before, after, HANDLED)) un.add(label(k));
    });
  }
  const added = next.tasks.map((t, i) => [t, i] as const).filter(([t]) => !prevIds.has(t.id));
  const tailStart = next.tasks.length - added.length;
  for (const [t, i] of added) {
    // the tasks added at the very end are appended; the others go before the task that follows them
    const appended = i >= tailStart && added.every(([, j]) => j >= tailStart);
    lines.push(`ActiveProject.Tasks.Add Name:=${vbString(t.name)}${appended ? '' : `, Before:=${i + 1}`}`);
    if (t.outline !== 1) lines.push(`ActiveProject.Tasks(${i + 1}).OutlineLevel = ${t.outline}`);
    if (!t.elapsed && t.duration !== 480) lines.push(`ActiveProject.Tasks(${i + 1}).Duration = ${num(t.duration)}`);
  }

  // resources
  const rPrev = new Set(prev.resources.map((r) => r.id));
  const rNext = new Set(next.resources.map((r) => r.id));
  const rGone = prev.resources.map((r, i) => [r, i] as const).filter(([r]) => !rNext.has(r.id));
  for (const [, i] of [...rGone].reverse()) lines.push(`ActiveProject.Resources(${i + 1}).Delete`);
  const rSurv = prev.resources.filter((r) => rNext.has(r.id));
  const rNextSurv = next.resources.filter((r) => rPrev.has(r.id));
  if (!same(rSurv.map((r) => r.id), rNextSurv.map((r) => r.id))) un.add('mover recursos');
  else {
    rSurv.forEach((before, i) => {
      const after = rNextSurv[i]!;
      if (before === after) return;
      for (const [key, line] of RESOURCE_FIELDS) if (!same(before[key], after[key])) lines.push(`ActiveProject.Resources(${i + 1}).${line(after)}`);
      for (const k of otherChanges(before, after, RESOURCE_KEYS)) un.add(label(k));
    });
  }
  for (const r of next.resources) if (!rPrev.has(r.id)) lines.push(`ActiveProject.Resources.Add ${vbString(r.name)}`);
  return { lines, unsupported: [...un] };
}

/** Writes into the recording what the project did between two versions (the controller calls it from `commit`). */
export function recordChange(rec: MacroRecorder, prev: Project, next: Project): void {
  const { lines, unsupported } = describeChange(prev, next);
  for (const l of lines) rec.add(l);
  for (const u of unsupported) rec.unsupported(u);
}
