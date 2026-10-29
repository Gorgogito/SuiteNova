import type { Cal } from './calendar';
import type { Day, Project } from './model';
import { schedule } from './schedule';
import { phase } from './usage';

export interface LevelOptions {
  /** Only these tasks may be delayed (null = any task). */
  scope?: string[] | null;
  /** Only delay a task when it still finishes without moving the end of the project (uses the slack). */
  withinSlack?: boolean;
  /** Keep the delays that an earlier leveling left (default: start from nothing). */
  keepExisting?: boolean;
}

export interface LevelResult {
  project: Project;
  /** Tasks that now start later, with the working minutes of delay. */
  moved: { task: string; delay: number }[];
  /** Days with more work than the resource can do that leveling could not solve. */
  unresolved: { resource: string; day: Day }[];
  warnings: string[];
}

export const priorityOf = (p: { priority?: number }): number => p.priority ?? 500;

/** Remove every delay that leveling added. */
export function clearLeveling(p: Project, ids?: string[]): Project {
  const set = ids ? new Set(ids) : null;
  return { ...p, tasks: p.tasks.map((t) => ((!set || set.has(t.id)) && t.levelDelay ? { ...t, levelDelay: undefined } : t)).map(strip) };
}

function strip<T extends { levelDelay?: number }>(t: T): T {
  if (t.levelDelay === undefined && 'levelDelay' in t) {
    const { levelDelay: _x, ...rest } = t;
    return rest as T;
  }
  return t;
}

/**
 * Solve overallocations by delaying tasks: the least important first, then the one that starts later. A task
 * that is already under way, a manually scheduled one and one outside the scope are never moved.
 */
export function levelResources(p0: Project, opts: LevelOptions = {}): LevelResult {
  const warnings: string[] = [];
  let q: Project = opts.keepExisting ? p0 : clearLeveling(p0);
  const scope = opts.scope ? new Set(opts.scope) : null;
  const giveUp = new Set<string>();
  const unresolved: LevelResult['unresolved'] = [];
  const limit = Math.max(200, p0.tasks.length * 60);

  for (let pass = 0; pass < limit; pass++) {
    const s = schedule(q);
    const ph = phase(q, s);
    // the first day, in time order, on which a resource has more work than it can do
    let found: { day: Day; resource: string; tasks: { task: number; work: number }[] } | null = null;
    for (const r of q.resources) {
      if (r.type !== 'work') continue;
      const cal = s.calendars.get(r.calendar);
      const load = new Map<Day, { task: number; work: number }[]>();
      for (const a of ph.assignments) {
        if (a.resource !== r.id) continue;
        for (const [d, w] of a.work) if (w > 0) load.set(d, [...(load.get(d) ?? []), { task: a.task, work: w }]);
      }
      for (const [d, list] of load) {
        if (giveUp.has(`${r.id}|${d}`)) continue;
        const total = list.reduce((a, x) => a + x.work, 0);
        if (total > cal.workInDay(d) * r.maxUnits + 0.5 && (!found || d < found.day)) found = { day: d, resource: r.id, tasks: list };
      }
    }
    if (!found) break;

    const key = `${found.resource}|${found.day}`;
    const movable = found.tasks
      .map((x) => x.task)
      .filter((i, k, a) => a.indexOf(i) === k)
      .filter((i) => {
        const t = q.tasks[i]!;
        return !t.manual && t.percent <= 0 && t.actualStart === null && (!scope || scope.has(t.id));
      });
    const involved = new Set(found.tasks.map((x) => x.task));
    if (involved.size < 2 || movable.length === 0) {
      giveUp.add(key);
      unresolved.push({ resource: found.resource, day: found.day });
      continue;
    }
    movable.sort((a, b) => priorityOf(q.tasks[a]!) - priorityOf(q.tasks[b]!) || s.tasks[b]!.start - s.tasks[a]!.start || b - a);

    let done = false;
    for (const i of movable) {
      const t = q.tasks[i]!;
      const st = s.tasks[i]!;
      const cal: Cal = t.elapsed ? s.calendars.elapsed : s.calendars.get(t.calendar);
      // wait until the first of the other tasks on that day has finished
      const ends = [...involved].filter((j) => j !== i && s.tasks[j]!.finish > st.start).map((j) => s.tasks[j]!.finish);
      let delay = ends.length ? cal.workBetween(st.start, Math.min(...ends)) : 0;
      if (delay <= 0) delay = q.minutesPerDay;
      if (opts.withinSlack && delay > Math.max(0, st.slack)) continue;
      q = { ...q, tasks: q.tasks.map((x, k) => (k === i ? { ...x, levelDelay: (x.levelDelay ?? 0) + delay } : x)) };
      done = true;
      break;
    }
    if (!done) {
      giveUp.add(key);
      unresolved.push({ resource: found.resource, day: found.day });
    }
    if (pass === limit - 1) warnings.push('Se alcanzó el límite de pasos de la nivelación; puede quedar trabajo sin resolver.');
  }

  const moved = q.tasks.filter((t) => (t.levelDelay ?? 0) > 0).map((t) => ({ task: t.id, delay: t.levelDelay! }));
  if (unresolved.length) {
    const names = [...new Set(unresolved.map((u) => q.resources.find((r) => r.id === u.resource)?.name ?? ''))].filter(Boolean);
    warnings.push(`No se pudo resolver la sobreasignación de: ${names.join(', ')} (la causa es una sola tarea, una tarea ya iniciada o manual, o el margen no alcanza).`);
  }
  return { project: q, moved, unresolved, warnings };
}

