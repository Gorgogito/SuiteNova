import {
  TASK_TYPE_LABEL, assignResource, dayBasis, fieldsOf, formatDuration, formatTime, formatValue, newAssignment, parseDateTime, parseDuration, parsePredecessors, setAssignments, setDuration, setTaskType, setWork, taskValue, updateTask, linkTasks,
  type FieldContext, type FieldDef, type Project, type TaskType,
} from '@suitenova/plan-core';

export interface ColumnDef {
  id: string;
  label: string;
  width: number;
  align: 'left' | 'right';
}

/** Columns the table starts with. */
export const DEFAULT_COLUMNS = ['name', 'duration', 'start', 'finish', 'percent', 'predecessors', 'resources'];

const WIDTHS: Record<string, number> = { name: 220, id: 36, wbs: 60, duration: 66, start: 124, finish: 124, percent: 62, predecessors: 92, resources: 120, work: 74, actualWork: 80, remainingWork: 80, cost: 92, actualCost: 92, remainingCost: 92, fixedCost: 84, slack: 70, notes: 160, type: 110, constraint: 140, calendar: 110 };
const LABELS: Record<string, string> = { name: 'Nombre de la tarea', duration: 'Duración', start: 'Comienzo', finish: 'Fin', percent: '% compl.', predecessors: 'Predecesoras', resources: 'Recursos' };
const LEFT = new Set(['name', 'predecessors', 'resources', 'notes', 'type', 'constraint', 'calendar', 'wbs']);

export function columnDef(p: Project, id: string): ColumnDef | null {
  const f = fieldsOf(p, 'task').find((x) => x.id === id);
  if (!f) return null;
  return { id, label: LABELS[id] ?? f.label, width: WIDTHS[id] ?? (f.type === 'date' ? 124 : f.type === 'text' ? 120 : 84), align: LEFT.has(id) || f.type === 'text' ? 'left' : 'right' };
}

/** What a cell shows. */
export function cellText(ctx: FieldContext, i: number, id: string): string {
  const t = ctx.p.tasks[i];
  const s = ctx.s.tasks[i];
  if (!t || !s) return '';
  if (id === 'duration') return formatDuration(s.duration, t.elapsed && !s.summary, dayBasis(ctx.p, s.summary ? null : t));
  if (id === 'name') return t.name;
  const v = taskValue(ctx, i, id);
  const f = fieldsOf(ctx.p, 'task').find((x) => x.id === id);
  if (f?.type === 'date') return typeof v === 'number' ? formatTime(v, true) : '';
  if (id === 'percent') return `${Math.round(Number(v ?? 0))}`;
  if (id === 'slack') return typeof v === 'number' ? formatDuration(v, false, ctx.p) : '';
  if (f?.type === 'duration') return typeof v === 'number' ? formatDuration(Math.abs(v), false, ctx.p).replace(/^/, v < 0 ? '-' : '') : '';
  return f ? formatValue(ctx, f.type, v) : '';
}

const CUSTOM_EDITABLE = (p: Project, id: string): FieldDef | null => {
  if (!id.startsWith('custom:')) return null;
  const def = p.customFields.find((c) => c.id === id.slice(7) && c.target === 'task');
  return def && !def.formula ? { id, label: def.name, type: def.type === 'list' ? 'text' : def.type } : null;
};

const EDITABLE = new Set(['name', 'duration', 'start', 'finish', 'percent', 'predecessors', 'resources', 'work', 'actualWork', 'fixedCost', 'deadline', 'notes', 'type', 'manual', 'effortDriven', 'elapsed', 'priority']);

export function isEditable(ctx: FieldContext, i: number, id: string): boolean {
  const s = ctx.s.tasks[i];
  if (!s) return false;
  if (s.summary && !['name', 'notes'].includes(id) && !id.startsWith('custom:')) return false;
  if (id.startsWith('custom:')) return !!CUSTOM_EDITABLE(ctx.p, id) && !s.summary;
  if (!EDITABLE.has(id)) return false;
  return true;
}

const parseNumber = (v: string): number | null => {
  const n = Number(v.replace(',', '.').replace(/[^\d.\-]/g, ''));
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
};

const YES = /^(s|sí|si|y|yes|true|1|verdadero)$/i;
const NO = /^(n|no|false|0|falso)$/i;

const TYPE_BY_TEXT: Record<string, TaskType> = { unidades: 'units', 'unidades fijas': 'units', units: 'units', duración: 'duration', 'duración fija': 'duration', duracion: 'duration', 'duracion fija': 'duration', duration: 'duration', trabajo: 'work', 'trabajo fijo': 'work', work: 'work' };

/** Apply the text typed in a cell. Returns the new project, or an error message. */
export function applyCell(ctx: FieldContext, i: number, id: string, text: string): { project: Project } | { error: string } {
  const p = ctx.p;
  const t = p.tasks[i];
  if (!t) return { project: p };
  const v = text.trim();
  const ok = (project: Project) => ({ project });
  switch (id) {
    case 'name': return ok(updateTask(p, t.id, { name: v }));
    case 'notes': return ok(updateTask(p, t.id, { notes: text }));
    case 'duration': {
      const d = parseDuration(v, dayBasis(p, t));
      if (!d) return { error: 'Escribe una duración como 5, 3d, 2sem, 12h, 90min o 2ed (días transcurridos).' };
      if (d.minutes > 5000 * p.minutesPerDay) return { error: 'La duración es demasiado grande.' };
      return ok(setDuration(p, t.id, d.minutes, d.elapsed));
    }
    case 'start':
    case 'finish': {
      if (!v) return ok(p);
      const time = parseDateTime(v, id === 'start' ? 480 : 1020);
      if (time === null) return { error: 'Escribe una fecha como 14/03/2025 o 14/03/2025 10:30.' };
      if (t.manual) return ok(updateTask(p, t.id, id === 'start' ? { manualStart: time } : { manualFinish: time }));
      return ok(updateTask(p, t.id, { constraint: { type: id === 'start' ? 'snet' : 'fnet', date: time } }));
    }
    case 'deadline': {
      if (!v) return ok(updateTask(p, t.id, { deadline: null }));
      const time = parseDateTime(v, 1020);
      return time === null ? { error: 'Escribe una fecha como 14/03/2025 o 14/03/2025 17:00.' } : ok(updateTask(p, t.id, { deadline: time }));
    }
    case 'priority': {
      const n = parseNumber(v);
      if (n === null || n < 0 || n > 1000) return { error: 'La prioridad debe estar entre 0 y 1000 (500 es la normal).' };
      return ok(updateTask(p, t.id, { priority: n === 500 ? undefined : Math.round(n) }));
    }
    case 'percent': {
      const n = parseNumber(v);
      if (n === null || n < 0 || n > 100) return { error: 'El porcentaje debe estar entre 0 y 100.' };
      return ok(updateTask(p, t.id, { percent: Math.round(n) }));
    }
    case 'fixedCost': {
      const n = parseNumber(v || '0');
      return n === null || n < 0 ? { error: 'El costo fijo no es válido.' } : ok(updateTask(p, t.id, { fixedCost: n }));
    }
    case 'work':
    case 'actualWork': {
      if (id === 'actualWork' && !v) return ok(updateTask(p, t.id, { actualWork: null }));
      const d = parseDuration(/\d\s*[a-z]/i.test(v) ? v : `${v}h`, dayBasis(p, t));
      if (!d) return { error: 'Escribe el trabajo en horas, como 40 o 40h (también 2d, 90min).' };
      return ok(id === 'work' ? setWork(p, t.id, d.minutes) : updateTask(p, t.id, { actualWork: d.minutes }));
    }
    case 'type': {
      const k = TYPE_BY_TEXT[v.toLowerCase()] ?? (Object.entries(TASK_TYPE_LABEL).find(([, l]) => l.toLowerCase() === v.toLowerCase())?.[0] as TaskType | undefined);
      return k ? ok(setTaskType(p, t.id, k)) : { error: 'Escribe Unidades fijas, Duración fija o Trabajo fijo.' };
    }
    case 'manual':
    case 'effortDriven':
    case 'elapsed': {
      const on = YES.test(v) ? true : NO.test(v) ? false : null;
      if (on === null) return { error: 'Escribe Sí o No.' };
      if (id === 'manual') return ok(updateTask(p, t.id, on ? { manual: true, manualStart: ctx.s.tasks[i]!.start, manualFinish: ctx.s.tasks[i]!.finish } : { manual: false, manualStart: null, manualFinish: null }));
      if (id === 'elapsed') return ok(updateTask(p, t.id, { elapsed: on }));
      return ok(updateTask(p, t.id, { effortDriven: on }));
    }
    case 'predecessors': {
      const r = parsePredecessors(v, p, i);
      if (r.error) return { error: r.error };
      // reject links that would close a cycle or that touch summaries
      let probe: Project = { ...p, tasks: p.tasks.map((x, k) => (k === i ? { ...x, links: [] } : x)) };
      for (const l of r.links) {
        const res = linkTasks(probe, l.task, t.id, l.type, l.lag, l.elapsed);
        if (res.error && !/ya están vinculadas/.test(res.error)) return { error: res.error };
        probe = res.project;
      }
      return ok(probe);
    }
    case 'resources': {
      const out = [];
      for (const raw of v.split(/[;,]/)) {
        const part = raw.trim();
        if (!part) continue;
        const m = /^(.*?)\s*(?:\[\s*(\d+(?:[.,]\d+)?)\s*(%)?\s*\])?$/.exec(part)!;
        const r = p.resources.find((x) => x.name.toLowerCase() === m[1]!.trim().toLowerCase());
        if (!r) return { error: `No existe el recurso "${m[1]}". Créalo antes en la hoja de recursos.` };
        let units = m[2] ? Number(m[2].replace(',', '.')) : 1;
        if (m[3] || (r.type === 'work' && m[2] && units > 10)) units /= 100;
        out.push(newAssignment(r.id, units));
      }
      return ok(setAssignments(p, t.id, out));
    }
    default: {
      const def = CUSTOM_EDITABLE(p, id);
      if (!def) return ok(p);
      const key = id.slice(7);
      let val: string | number | boolean | null;
      if (!v) val = null;
      else if (def.type === 'number' || def.type === 'cost') {
        const n = parseNumber(v);
        if (n === null) return { error: 'Escribe un número.' };
        val = n;
      } else if (def.type === 'date') {
        const time = parseDateTime(v, 480);
        if (time === null) return { error: 'Escribe una fecha como 14/03/2025.' };
        val = time;
      } else if (def.type === 'duration') {
        const d = parseDuration(v, p);
        if (!d) return { error: 'Escribe una duración como 5d o 4h.' };
        val = d.minutes;
      } else if (def.type === 'flag') {
        const on = YES.test(v) ? true : NO.test(v) ? false : null;
        if (on === null) return { error: 'Escribe Sí o No.' };
        val = on;
      } else val = v;
      const cf = p.customFields.find((c) => c.id === key);
      if (cf?.type === 'list' && val !== null && cf.list && !cf.list.some((x) => x.toLowerCase() === String(val).toLowerCase())) return { error: `Elige uno de: ${cf.list.join(', ')}.` };
      return ok(updateTask(p, t.id, { custom: { ...t.custom, [key]: val } }));
    }
  }
}

export { assignResource };
