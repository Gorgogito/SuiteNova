import { newId, newResource, subtreeEnd, type Project, type Task } from './model';

/** A short fingerprint of a file's contents (FNV-1a), to know whether a linked project has changed. */
export function fingerprint(data: string | Uint8Array): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return `${bytes.length.toString(16)}-${h.toString(16)}`;
}

/** Tasks that stand for a project in a file and follow it. */
export const liveSubprojects = (p: Project): Task[] => p.tasks.filter((t) => t.subproject?.live && t.subproject.path);

export interface InsertOptions {
  live?: boolean;
  stamp?: string;
}

export interface InsertResult {
  project: Project;
  /** Index of the summary task that stands for the inserted project. */
  index: number;
  warnings: string[];
}

/**
 * Insert another project as a summary task with the other project's tasks inside it (Project's "Insert subproject").
 * Tasks get new ids (the id they had is kept in `origin`), resources and calendars are matched by name, and the links between
 * the inserted tasks go with them. Tasks that had no predecessor start with the project, as before.
 */
export function insertProject(p: Project, other: Project, afterIndex: number | null, path: string | null, opts: InsertOptions = {}): InsertResult {
  const warnings: string[] = [];
  // calendars and resources by name
  const calMap = new Map<string, string>();
  const calendars = [...p.calendars];
  for (const c of other.calendars) {
    const same = calendars.find((x) => x.name.toLowerCase() === c.name.toLowerCase());
    if (same) calMap.set(c.id, same.id);
    else {
      const copy = { ...c, id: newId('c') };
      calendars.push(copy);
      calMap.set(c.id, copy.id);
    }
  }
  for (const c of calendars) if (c.base && calMap.has(c.base) && !p.calendars.some((x) => x.id === c.id)) c.base = calMap.get(c.base)!;
  const resMap = new Map<string, string>();
  const resources = [...p.resources];
  for (const r of other.resources) {
    const same = resources.find((x) => x.name.toLowerCase() === r.name.toLowerCase() && x.type === r.type);
    if (same) resMap.set(r.id, same.id);
    else {
      const copy = { ...newResource(r.name), ...r, id: newId('r'), calendar: r.calendar ? calMap.get(r.calendar) ?? null : null, custom: {} as Record<string, import('./model').CustomValue> };
      resources.push(copy);
      resMap.set(r.id, copy.id);
    }
  }
  if (other.minutesPerDay !== p.minutesPerDay) warnings.push(`El subproyecto cuenta ${other.minutesPerDay / 60} h por día y este proyecto ${p.minutesPerDay / 60} h: las duraciones se conservan en minutos.`);
  // custom fields are matched by name, target and type; the others are brought in
  const fieldMap = new Map<string, string>();
  const customFields = [...p.customFields];
  for (const f of other.customFields) {
    const same = customFields.find((x) => x.name.toLowerCase() === f.name.toLowerCase() && x.target === f.target && x.type === f.type);
    if (same) fieldMap.set(f.id, same.id);
    else {
      const copy = { ...f, id: newId('f') };
      customFields.push(copy);
      fieldMap.set(f.id, copy.id);
    }
  }
  const carry = (v: Record<string, import('./model').CustomValue>): Record<string, import('./model').CustomValue> => Object.fromEntries(Object.entries(v).filter(([k]) => fieldMap.has(k)).map(([k, x]) => [fieldMap.get(k)!, x]));
  for (const [oid, nid] of resMap) {
    const copy = resources.find((x) => x.id === nid);
    const orig = other.resources.find((x) => x.id === oid);
    if (copy && orig && !p.resources.some((x) => x.id === nid)) copy.custom = carry(orig.custom);
  }

  const idMap = new Map<string, string>();
  other.tasks.forEach((t) => idMap.set(t.id, newId('t')));
  const inserted: Task[] = other.tasks.map((t) => ({
    ...t,
    id: idMap.get(t.id)!,
    origin: t.id,
    outline: Math.min(9, t.outline + 1),
    calendar: t.calendar ? calMap.get(t.calendar) ?? null : null,
    custom: carry(t.custom),
    links: t.links.filter((l) => idMap.has(l.task)).map((l) => ({ ...l, task: idMap.get(l.task)! })),
    assignments: t.assignments.filter((a) => resMap.has(a.resource)).map((a) => ({ ...a, resource: resMap.get(a.resource)! })),
  }));
  const summary: Task = { ...(inserted.length ? { ...inserted[0]! } : ({} as Task)), id: newId('t'), name: other.name, outline: 1, links: [], assignments: [], duration: 0, work: null, percent: 0, notes: '', custom: {}, subproject: { name: other.name, path, ...(opts.live ? { live: true } : {}), ...(opts.stamp ? { stamp: opts.stamp } : {}) }, manual: false, manualStart: null, manualFinish: null, splits: [], origin: undefined, fixedCost: 0 };
  summary.outline = 1;
  if (!inserted.length) warnings.push('El proyecto que se inserta no tiene tareas.');
  // a branch that started deeper than the first task cannot start at the same level as the summary
  for (const t of inserted) t.outline = Math.max(2, t.outline);
  const at = afterIndex === null || !p.tasks[afterIndex] ? p.tasks.length : subtreeEnd(p.tasks, afterIndex);
  const tasks = [...p.tasks];
  summary.outline = at > 0 && afterIndex !== null && p.tasks[afterIndex] ? p.tasks[afterIndex]!.outline : 1;
  const delta = summary.outline - 1;
  for (const t of inserted) t.outline = Math.min(9, t.outline + delta);
  tasks.splice(at, 0, summary, ...inserted);
  return { project: { ...p, calendars, resources, customFields, tasks }, index: at, warnings };
}

/** Replace the tasks of an inserted project with a newer copy, keeping the links that other tasks have to them. */
export function refreshSubproject(p: Project, summaryId: string, other: Project, stamp?: string): InsertResult {
  const i = p.tasks.findIndex((t) => t.id === summaryId);
  if (i < 0 || !p.tasks[i]!.subproject) return { project: p, index: i, warnings: ['La tarea no es un subproyecto.'] };
  const end = subtreeEnd(p.tasks, i);
  const old = p.tasks.slice(i + 1, end);
  const path = p.tasks[i]!.subproject!.path;
  const before = { ...p, tasks: [...p.tasks.slice(0, i), ...p.tasks.slice(end)] };
  const keep = p.tasks[i]!.subproject!;
  const r = insertProject(before, other, i === 0 ? null : i - 1, path, { live: keep.live, stamp: stamp ?? keep.stamp });
  // the summary keeps its identity and its place; links from the rest of the plan follow the origin of each task
  const newSummary = r.project.tasks[r.index]!;
  const byOrigin = new Map<string, string>();
  r.project.tasks.forEach((t) => t.origin && byOrigin.set(t.origin, t.id));
  const oldOrigin = new Map(old.map((t) => [t.id, t.origin]));
  const tasks = r.project.tasks.map((t, k) => {
    if (k === r.index) return { ...newSummary, id: summaryId, subproject: { name: other.name, path, ...(keep.live ? { live: true } : {}), ...(stamp ?? keep.stamp ? { stamp: stamp ?? keep.stamp } : {}) }, notes: p.tasks[i]!.notes };
    return {
      ...t,
      links: t.links.map((l) => {
        const o = oldOrigin.get(l.task);
        return o && byOrigin.has(o) ? { ...l, task: byOrigin.get(o)! } : l;
      }),
    };
  });
  // outside tasks that were linked to the old copy keep their links
  const warnings = [...r.warnings];
  const fixed = tasks.map((t) => (t.subproject && t.id === summaryId ? t : { ...t, links: t.links.filter((l) => tasks.some((x) => x.id === l.task) || (warnings.push(`Se perdió un vínculo de "${t.name}" con una tarea que ya no existe en el subproyecto.`), false)) }));
  return { project: { ...r.project, tasks: fixed }, index: r.index, warnings: [...new Set(warnings)] };
}
