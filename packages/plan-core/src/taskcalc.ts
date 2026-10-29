import type { Resource, Task } from './model';

/** Sum of the units of the work resources assigned to a task (1 = one full-time person). */
export function sumUnits(t: Task, resources: Resource[]): number {
  let u = 0;
  for (const a of t.assignments) {
    const r = resources.find((x) => x.id === a.resource);
    if (r?.type === 'work') u += a.units;
  }
  return u;
}

export interface Derived {
  /** Working (or elapsed) minutes the task lasts. */
  duration: number;
  /** Planned work in minutes. */
  work: number;
  units: number;
}

/**
 * Duration and work follow the task type, as in Microsoft Project: with fixed work (or effort-driven fixed units and a
 * work value) the duration is work / units; otherwise the duration is the one entered and work = units × duration.
 */
export function derive(t: Task, resources: Resource[]): Derived {
  const units = sumUnits(t, resources);
  const workFixed = t.work !== null && (t.type === 'work' || (t.type === 'units' && t.effortDriven));
  if (workFixed && units > 0) return { duration: Math.max(0, Math.ceil(t.work! / units - 1e-9)), work: t.work!, units };
  if (t.type === 'work' && t.work !== null) return { duration: Math.max(0, t.duration), work: t.work, units };
  const duration = Math.max(0, Math.round(t.duration));
  return { duration, work: units * duration, units };
}
