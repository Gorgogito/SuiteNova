import { earnedValue, type EarnedValue } from './evm';
import { dayOfTime, isSummary, nowTime, parentsOf, type CustomFieldDef, type CustomValue, type FilterCriterion, type FilterDef, type GroupDef, type Project, type Time } from './model';
import { formatDuration, formatPredecessors, formatTime } from './ops';
import type { Schedule } from './schedule';

export type FieldType = 'text' | 'number' | 'cost' | 'date' | 'flag' | 'duration' | 'percent' | 'work';
export type Value = string | number | boolean | null;

export interface FieldDef {
  id: string;
  label: string;
  type: FieldType;
}

/** Fields every task has. Dates are times, durations and work are minutes. */
export const TASK_FIELDS: FieldDef[] = [
  { id: 'id', label: 'Id', type: 'number' },
  { id: 'name', label: 'Nombre', type: 'text' },
  { id: 'wbs', label: 'EDT', type: 'text' },
  { id: 'outline', label: 'Nivel de esquema', type: 'number' },
  { id: 'duration', label: 'Duración', type: 'duration' },
  { id: 'start', label: 'Comienzo', type: 'date' },
  { id: 'finish', label: 'Fin', type: 'date' },
  { id: 'percent', label: '% completado', type: 'percent' },
  { id: 'work', label: 'Trabajo', type: 'work' },
  { id: 'actualWork', label: 'Trabajo real', type: 'work' },
  { id: 'remainingWork', label: 'Trabajo restante', type: 'work' },
  { id: 'cost', label: 'Costo', type: 'cost' },
  { id: 'actualCost', label: 'Costo real', type: 'cost' },
  { id: 'remainingCost', label: 'Costo restante', type: 'cost' },
  { id: 'fixedCost', label: 'Costo fijo', type: 'cost' },
  { id: 'slack', label: 'Holgura total', type: 'duration' },
  { id: 'priority', label: 'Prioridad', type: 'number' },
  { id: 'levelDelay', label: 'Retraso por nivelación', type: 'duration' },
  { id: 'critical', label: 'Crítica', type: 'flag' },
  { id: 'summary', label: 'Resumen', type: 'flag' },
  { id: 'milestone', label: 'Hito', type: 'flag' },
  { id: 'manual', label: 'Programada manualmente', type: 'flag' },
  { id: 'elapsed', label: 'Duración transcurrida', type: 'flag' },
  { id: 'effortDriven', label: 'Conducida por esfuerzo', type: 'flag' },
  { id: 'type', label: 'Tipo de tarea', type: 'text' },
  { id: 'constraint', label: 'Tipo de restricción', type: 'text' },
  { id: 'constraintDate', label: 'Fecha de restricción', type: 'date' },
  { id: 'deadline', label: 'Fecha límite', type: 'date' },
  { id: 'predecessors', label: 'Predecesoras', type: 'text' },
  { id: 'resources', label: 'Nombres de los recursos', type: 'text' },
  { id: 'calendar', label: 'Calendario', type: 'text' },
  { id: 'notes', label: 'Notas', type: 'text' },
  { id: 'actualStart', label: 'Comienzo real', type: 'date' },
  { id: 'actualFinish', label: 'Fin real', type: 'date' },
  { id: 'baselineStart', label: 'Comienzo de la línea base', type: 'date' },
  { id: 'baselineFinish', label: 'Fin de la línea base', type: 'date' },
  { id: 'baselineDuration', label: 'Duración de la línea base', type: 'duration' },
  { id: 'baselineWork', label: 'Trabajo de la línea base', type: 'work' },
  { id: 'baselineCost', label: 'Costo de la línea base', type: 'cost' },
  { id: 'startVariance', label: 'Variación del comienzo', type: 'duration' },
  { id: 'finishVariance', label: 'Variación del fin', type: 'duration' },
  { id: 'durationVariance', label: 'Variación de la duración', type: 'duration' },
  { id: 'workVariance', label: 'Variación del trabajo', type: 'work' },
  { id: 'costVariance', label: 'Variación del costo', type: 'cost' },
  { id: 'bcws', label: 'CPTP (valor planificado)', type: 'cost' },
  { id: 'bcwp', label: 'CPTR (valor ganado)', type: 'cost' },
  { id: 'acwp', label: 'CRTR (costo real)', type: 'cost' },
  { id: 'cv', label: 'VC (variación del costo)', type: 'cost' },
  { id: 'sv', label: 'VP (variación del plazo)', type: 'cost' },
  { id: 'cpi', label: 'IRC', type: 'number' },
  { id: 'spi', label: 'IRP', type: 'number' },
  { id: 'eac', label: 'EAC (estimación al finalizar)', type: 'cost' },
  { id: 'vac', label: 'VAC (variación al finalizar)', type: 'cost' },
];

export const RESOURCE_FIELDS: FieldDef[] = [
  { id: 'name', label: 'Nombre del recurso', type: 'text' },
  { id: 'type', label: 'Tipo', type: 'text' },
  { id: 'group', label: 'Grupo', type: 'text' },
  { id: 'maxUnits', label: 'Unidades máximas', type: 'percent' },
  { id: 'rate', label: 'Tasa estándar', type: 'cost' },
  { id: 'costPerUse', label: 'Costo por uso', type: 'cost' },
  { id: 'calendar', label: 'Calendario', type: 'text' },
  { id: 'work', label: 'Trabajo', type: 'work' },
  { id: 'actualWork', label: 'Trabajo real', type: 'work' },
  { id: 'cost', label: 'Costo', type: 'cost' },
  { id: 'overallocated', label: 'Sobreasignado', type: 'flag' },
];

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const customFieldId = (id: string): string => `custom:${id}`;

export function fieldsOf(p: Project, scope: 'task' | 'resource' = 'task'): FieldDef[] {
  const custom: FieldDef[] = p.customFields.filter((c) => c.target === scope).map((c) => ({ id: customFieldId(c.id), label: c.name, type: c.type === 'list' ? 'text' : c.type }));
  return [...(scope === 'task' ? TASK_FIELDS : RESOURCE_FIELDS), ...custom];
}

export const TASK_TYPE_LABEL = { units: 'Unidades fijas', duration: 'Duración fija', work: 'Trabajo fijo' } as const;
export const CONSTRAINT_LABEL = {
  asap: 'Lo antes posible',
  alap: 'Lo más tarde posible',
  snet: 'No comenzar antes del',
  snlt: 'No comenzar después del',
  fnet: 'No terminar antes del',
  fnlt: 'No terminar después del',
  mso: 'Debe comenzar el',
  mfo: 'Debe terminar el',
} as const;

/** Everything a field needs to be read from a task: the project, its schedule and earned value against one baseline. */
export interface FieldContext {
  p: Project;
  s: Schedule;
  baseline: number;
  asOf: Time;
  ev: EarnedValue[];
  parent: number[];
  cache: Map<string, Value>;
}

export function fieldContext(p: Project, s: Schedule, opts: { baseline?: number; now?: Time } = {}): FieldContext {
  const baseline = opts.baseline ?? 0;
  const asOf = p.statusDate ?? opts.now ?? nowTime();
  return { p, s, baseline, asOf, ev: earnedValue(p, s, baseline, asOf), parent: parentsOf(p.tasks), cache: new Map() };
}

const resourceNames = (ctx: FieldContext, i: number): string =>
  ctx.p.tasks[i]!.assignments
    .map((a) => {
      const r = ctx.p.resources.find((x) => x.id === a.resource);
      if (!r) return '';
      return r.type === 'work' ? (a.units === 1 ? r.name : `${r.name}[${Math.round(a.units * 100)}%]`) : `${r.name}[${a.units}]`;
    })
    .filter(Boolean)
    .join(';');

/** The value of a field of task `i`. Dates are times, durations and work are minutes, flags are booleans. */
export function taskValue(ctx: FieldContext, i: number, id: string): Value {
  const t = ctx.p.tasks[i];
  const s = ctx.s.tasks[i];
  if (!t || !s) return null;
  if (id.startsWith('custom:')) return customValue(ctx, i, id.slice(7), 0);
  const b = ctx.p.baselines[ctx.baseline]?.tasks[t.id];
  const e = ctx.ev[i]!;
  switch (id) {
    case 'id': return i + 1;
    case 'name': return t.name;
    case 'wbs': return s.wbs;
    case 'outline': return t.outline;
    case 'duration': return s.duration;
    case 'start': return s.start;
    case 'finish': return s.finish;
    case 'percent': return s.percent;
    case 'work': return s.work;
    case 'actualWork': return s.actualWork;
    case 'remainingWork': return s.remainingWork;
    case 'cost': return s.cost;
    case 'actualCost': return s.actualCost;
    case 'remainingCost': return s.remainingCost;
    case 'fixedCost': return t.fixedCost;
    case 'slack': return s.slack;
    case 'priority': return t.priority ?? 500;
    case 'levelDelay': return t.levelDelay ?? 0;
    case 'critical': return s.critical;
    case 'summary': return s.summary;
    case 'milestone': return s.milestone;
    case 'manual': return t.manual;
    case 'elapsed': return t.elapsed;
    case 'effortDriven': return t.effortDriven;
    case 'type': return TASK_TYPE_LABEL[t.type];
    case 'constraint': return CONSTRAINT_LABEL[t.constraint.type];
    case 'constraintDate': return t.constraint.date;
    case 'deadline': return t.deadline;
    case 'predecessors': return formatPredecessors(ctx.p, t);
    case 'resources': return resourceNames(ctx, i);
    case 'calendar': return ctx.p.calendars.find((c) => c.id === (t.calendar ?? ctx.p.calendar))?.name ?? '';
    case 'notes': return t.notes;
    case 'actualStart': return s.actualStart;
    case 'actualFinish': return s.actualFinish;
    case 'baselineStart': return b ? b.start : null;
    case 'baselineFinish': return b ? b.finish : null;
    case 'baselineDuration': return b ? b.duration : null;
    case 'baselineWork': return b ? b.work : null;
    case 'baselineCost': return b ? b.cost : null;
    case 'startVariance': return b ? s.start - b.start : null;
    case 'finishVariance': return b ? s.finish - b.finish : null;
    case 'durationVariance': return b ? s.duration - b.duration : null;
    case 'workVariance': return b ? s.work - b.work : null;
    case 'costVariance': return b ? s.cost - b.cost : null;
    case 'bcws': return e.pv;
    case 'bcwp': return e.ev;
    case 'acwp': return e.ac;
    case 'cv': return e.cv;
    case 'sv': return e.sv;
    case 'cpi': return e.cpi;
    case 'spi': return e.spi;
    case 'eac': return e.eac;
    case 'vac': return e.vac;
    default: return null;
  }
}

export function resourceValue(ctx: FieldContext, index: number, id: string): Value {
  const r = ctx.p.resources[index];
  if (!r) return null;
  if (id.startsWith('custom:')) return r.custom[id.slice(7)] ?? null;
  const mine = ctx.s.assignments.filter((a) => a.resource === r.id);
  switch (id) {
    case 'name': return r.name;
    case 'type': return r.type === 'work' ? 'Trabajo' : r.type === 'cost' ? 'Costo' : 'Material';
    case 'group': return r.group;
    case 'maxUnits': return r.maxUnits * 100;
    case 'rate': return r.rate;
    case 'costPerUse': return r.costPerUse;
    case 'calendar': return ctx.p.calendars.find((c) => c.id === (r.calendar ?? ctx.p.calendar))?.name ?? '';
    case 'work': return mine.reduce((a, x) => a + x.work, 0);
    case 'actualWork': return mine.reduce((a, x) => a + x.actualWork, 0);
    case 'cost': return mine.reduce((a, x) => a + x.cost, 0);
    case 'overallocated': return ctx.s.overallocations.some((o) => o.resource === r.id);
    default: return null;
  }
}

// ---------- custom fields ----------

function customValue(ctx: FieldContext, i: number, fieldId: string, depth: number): Value {
  const def = ctx.p.customFields.find((c) => c.id === fieldId && c.target === 'task');
  if (!def) return null;
  const key = `${i}|${fieldId}`;
  const hit = ctx.cache.get(key);
  if (hit !== undefined) return hit;
  let v: Value;
  const summary = isSummary(ctx.p.tasks, i);
  if (summary && def.rollup && def.rollup !== 'none') v = rollup(ctx, i, def, depth);
  else if (def.formula && depth < 8) v = evalCustom(ctx, def, (name) => taskValueByName(ctx, i, name, depth + 1));
  else v = ctx.p.tasks[i]!.custom[fieldId] ?? null;
  ctx.cache.set(key, v);
  return v;
}

function rollup(ctx: FieldContext, i: number, def: CustomFieldDef, depth: number): Value {
  const kids: number[] = [];
  const end = (() => {
    let j = i + 1;
    while (j < ctx.p.tasks.length && ctx.p.tasks[j]!.outline > ctx.p.tasks[i]!.outline) j++;
    return j;
  })();
  for (let j = i + 1; j < end; j++) if (!isSummary(ctx.p.tasks, j)) kids.push(j);
  const vals = kids.map((k) => customValue(ctx, k, def.id, depth + 1)).filter((v): v is number => typeof v === 'number');
  if (def.rollup === 'count') return vals.length;
  if (!vals.length) return null;
  switch (def.rollup) {
    case 'sum': return vals.reduce((a, b) => a + b, 0);
    case 'max': return Math.max(...vals);
    case 'min': return Math.min(...vals);
    default: return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
}

/** A field named in a formula: by its label (accents and case do not matter), a custom field by its name. */
function taskValueByName(ctx: FieldContext, i: number, name: string, depth: number): Value | undefined {
  const n = norm(name);
  const custom = ctx.p.customFields.find((c) => c.target === 'task' && norm(c.name) === n);
  if (custom) return customValue(ctx, i, custom.id, depth);
  const f = TASK_FIELDS.find((x) => norm(x.label) === n || norm(x.id) === n);
  return f ? taskValue(ctx, i, f.id) : undefined;
}

/** Values enter formulas in friendly units: durations in days, work in hours, dates as day numbers. */
function toFormula(ctx: FieldContext, type: FieldType, v: Value): Value {
  if (typeof v !== 'number') return v;
  if (type === 'duration') return v / ctx.p.minutesPerDay;
  if (type === 'work') return v / 60;
  if (type === 'date') return v / 1440;
  return v;
}

function evalCustom(ctx: FieldContext, def: CustomFieldDef, lookup: (name: string) => Value | undefined): Value {
  const r = evalFormula(def.formula!, (name) => {
    const v = lookup(name);
    if (v === undefined) return undefined;
    const f = TASK_FIELDS.find((x) => norm(x.label) === norm(name) || norm(x.id) === norm(name));
    const c = ctx.p.customFields.find((x) => x.target === 'task' && norm(x.name) === norm(name));
    return toFormula(ctx, (c ? (c.type === 'list' ? 'text' : c.type) : f?.type) ?? 'text', v);
  });
  if (typeof r !== 'number') return r;
  if (def.type === 'duration') return Math.round(r * ctx.p.minutesPerDay);
  if (def.type === 'date') return Math.round(r * 1440);
  return r;
}

// ---------- formulas ----------

type Tok = { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'ref'; v: string } | { t: 'id'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) i++;
    else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      out.push({ t: 'num', v: Number(src.slice(i, j)) });
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== '"') s += src[j++];
      if (j >= src.length) throw new Error('Falta cerrar unas comillas.');
      out.push({ t: 'str', v: s });
      i = j + 1;
    } else if (c === '[') {
      const j = src.indexOf(']', i);
      if (j < 0) throw new Error('Falta cerrar un corchete.');
      out.push({ t: 'ref', v: src.slice(i + 1, j) });
      i = j + 1;
    } else if (/[A-Za-z_À-ÿ]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_À-ÿ]/.test(src[j]!)) j++;
      out.push({ t: 'id', v: src.slice(i, j) });
      i = j;
    } else {
      const two = src.slice(i, i + 2);
      if (['<=', '>=', '<>'].includes(two)) {
        out.push({ t: 'op', v: two });
        i += 2;
      } else if ('+-*/^&=<>(),'.includes(c)) {
        out.push({ t: 'op', v: c });
        i++;
      } else throw new Error(`Carácter no válido: ${c}`);
    }
  }
  return out;
}

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'ref'; v: string }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[] };

const BINARY: Record<string, number> = { or: 1, and: 2, '=': 4, '<>': 4, '<': 4, '>': 4, '<=': 4, '>=': 4, '&': 5, '+': 6, '-': 6, '*': 7, '/': 7, '^': 9 };

function parse(src: string): Node {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const word = (t: Tok | undefined) => (t && t.t === 'id' ? t.v.toLowerCase() : null);
  const expr = (min: number): Node => {
    let left = unary();
    for (;;) {
      const t = peek();
      if (!t) break;
      const op = t.t === 'op' ? t.v : word(t);
      if (!op || !(op in BINARY) || BINARY[op]! < min) break;
      const prec = BINARY[op]!;
      pos++;
      const right = expr(op === '^' ? prec : prec + 1);
      left = { k: 'bin', op, a: left, b: right };
    }
    return left;
  };
  const unary = (): Node => {
    const t = peek();
    if (t?.t === 'op' && (t.v === '-' || t.v === '+')) {
      pos++;
      return { k: 'un', op: t.v, a: unary() };
    }
    if (word(t) === 'not') {
      pos++;
      return { k: 'un', op: 'not', a: expr(3) };
    }
    return primary();
  };
  const primary = (): Node => {
    const t = toks[pos++];
    if (!t) throw new Error('La fórmula está incompleta.');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'ref') return { k: 'ref', v: t.v };
    if (t.t === 'op' && t.v === '(') {
      const e = expr(0);
      const c = toks[pos++];
      if (!c || c.t !== 'op' || c.v !== ')') throw new Error('Falta cerrar un paréntesis.');
      return e;
    }
    if (t.t === 'id') {
      const w = t.v.toLowerCase();
      if (w === 'true' || w === 'verdadero') return { k: 'bool', v: true };
      if (w === 'false' || w === 'falso') return { k: 'bool', v: false };
      const n = peek();
      if (n?.t === 'op' && n.v === '(') {
        pos++;
        const args: Node[] = [];
        if (!(peek()?.t === 'op' && (peek() as { v: string }).v === ')')) {
          for (;;) {
            args.push(expr(0));
            const c = toks[pos++];
            if (c?.t === 'op' && c.v === ',') continue;
            if (c?.t === 'op' && c.v === ')') break;
            throw new Error('Falta cerrar un paréntesis.');
          }
        } else pos++;
        return { k: 'call', fn: w, args };
      }
      throw new Error(`No se entiende "${t.v}". Los campos van entre corchetes: [Duración].`);
    }
    throw new Error('La fórmula no es válida.');
  };
  const root = expr(0);
  if (pos < toks.length) throw new Error('Sobra texto al final de la fórmula.');
  return root;
}

const truthy = (v: Value): boolean => (typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : typeof v === 'string' ? v !== '' : false);
const num = (v: Value): number => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v.replace(',', '.'))) ? Number(v.replace(',', '.')) : 0);
const text = (v: Value): string => (v === null ? '' : typeof v === 'boolean' ? (v ? 'Sí' : 'No') : String(v));

const FUNCS: Record<string, (a: Value[]) => Value> = {
  iif: (a) => (truthy(a[0] ?? null) ? (a[1] ?? null) : (a[2] ?? null)),
  si: (a) => (truthy(a[0] ?? null) ? (a[1] ?? null) : (a[2] ?? null)),
  round: (a) => {
    const d = Math.trunc(num(a[1] ?? 0));
    const f = 10 ** d;
    return Math.round(num(a[0] ?? 0) * f) / f;
  },
  abs: (a) => Math.abs(num(a[0] ?? 0)),
  int: (a) => Math.floor(num(a[0] ?? 0)),
  min: (a) => Math.min(...a.map(num)),
  max: (a) => Math.max(...a.map(num)),
  len: (a) => text(a[0] ?? null).length,
  left: (a) => text(a[0] ?? null).slice(0, num(a[1] ?? 0)),
  right: (a) => text(a[0] ?? null).slice(Math.max(0, text(a[0] ?? null).length - num(a[1] ?? 0))),
  mid: (a) => text(a[0] ?? null).substr(Math.max(0, num(a[1] ?? 1) - 1), a[2] === undefined ? undefined : num(a[2])),
  upper: (a) => text(a[0] ?? null).toUpperCase(),
  lower: (a) => text(a[0] ?? null).toLowerCase(),
  year: (a) => new Date(num(a[0] ?? 0) * 86400000).getUTCFullYear(),
  month: (a) => new Date(num(a[0] ?? 0) * 86400000).getUTCMonth() + 1,
  day: (a) => new Date(num(a[0] ?? 0) * 86400000).getUTCDate(),
};

/** Evaluate a formula. `ref` gives the value of a field named between brackets; undefined = no such field. */
export function evalFormula(src: string, ref: (name: string) => Value | undefined): Value {
  const root = parse(src);
  const go = (n: Node): Value => {
    switch (n.k) {
      case 'num': case 'str': case 'bool': return n.v;
      case 'ref': {
        const v = ref(n.v);
        if (v === undefined) throw new Error(`No existe el campo [${n.v}].`);
        return v;
      }
      case 'un': {
        const a = go(n.a);
        return n.op === 'not' ? !truthy(a) : n.op === '-' ? -num(a) : num(a);
      }
      case 'call': {
        const f = FUNCS[n.fn];
        if (!f) throw new Error(`La función ${n.fn} no existe.`);
        return f(n.args.map(go));
      }
      case 'bin': {
        if (n.op === 'and') return truthy(go(n.a)) && truthy(go(n.b));
        if (n.op === 'or') return truthy(go(n.a)) || truthy(go(n.b));
        const a = go(n.a);
        const b = go(n.b);
        switch (n.op) {
          case '+': return typeof a === 'string' || typeof b === 'string' ? text(a) + text(b) : num(a) + num(b);
          case '-': return num(a) - num(b);
          case '*': return num(a) * num(b);
          case '/': return num(b) === 0 ? null : num(a) / num(b);
          case '^': return num(a) ** num(b);
          case '&': return text(a) + text(b);
          default: {
            const x = typeof a === 'string' || typeof b === 'string' ? text(a).toLowerCase() : num(a);
            const y = typeof a === 'string' || typeof b === 'string' ? text(b).toLowerCase() : num(b);
            switch (n.op) {
              case '=': return x === y;
              case '<>': return x !== y;
              case '<': return x < y;
              case '>': return x > y;
              case '<=': return x <= y;
              default: return x >= y;
            }
          }
        }
      }
    }
  };
  return go(root);
}

/** Error text of a formula, or null when it parses (field names are checked too). */
export function checkFormula(p: Project, src: string): string | null {
  try {
    const names = new Set<string>();
    const scan = (n: Node) => {
      if (n.k === 'ref') names.add(n.v);
      else if (n.k === 'un') scan(n.a);
      else if (n.k === 'bin') {
        scan(n.a);
        scan(n.b);
      } else if (n.k === 'call') {
        if (!FUNCS[n.fn]) throw new Error(`La función ${n.fn} no existe.`);
        n.args.forEach(scan);
      }
    };
    scan(parse(src));
    for (const name of names) {
      const ok = TASK_FIELDS.some((f) => norm(f.label) === norm(name) || norm(f.id) === norm(name)) || p.customFields.some((c) => c.target === 'task' && norm(c.name) === norm(name));
      if (!ok) return `No existe el campo [${name}].`;
    }
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

// ---------- formatting ----------

export function formatValue(ctx: Pick<FieldContext, 'p'>, type: FieldType, v: Value, withHour = true): string {
  if (v === null || v === undefined) return '';
  switch (type) {
    case 'date': return typeof v === 'number' ? formatTime(v, withHour) : String(v);
    case 'duration': return typeof v === 'number' ? formatDuration(v, false, ctx.p) : String(v);
    case 'work': return typeof v === 'number' ? `${Math.round((v / 60) * 100) / 100} h` : String(v);
    case 'cost': return typeof v === 'number' ? `${(Math.round(v * 100) / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ctx.p.currency}` : String(v);
    case 'percent': return typeof v === 'number' ? `${Math.round(v)} %` : String(v);
    case 'flag': return v === true ? 'Sí' : v === false ? 'No' : String(v);
    case 'number': return typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : String(v);
    default: return String(v);
  }
}

export function fieldType(p: Project, id: string, scope: 'task' | 'resource' = 'task'): FieldType {
  return fieldsOf(p, scope).find((f) => f.id === id)?.type ?? 'text';
}

// ---------- filters ----------

export interface BuiltinFilter {
  id: string;
  name: string;
  test: (ctx: FieldContext, i: number) => boolean;
}

const late = (ctx: FieldContext, i: number): boolean => {
  const s = ctx.s.tasks[i]!;
  const fv = taskValue(ctx, i, 'finishVariance');
  if (typeof fv === 'number' && fv > 0) return true;
  return s.percent < 100 && s.finish < ctx.asOf && !s.summary;
};

export const BUILTIN_FILTERS: BuiltinFilter[] = [
  { id: 'all', name: 'Todas las tareas', test: () => true },
  { id: 'critical', name: 'Tareas críticas', test: (c, i) => c.s.tasks[i]!.critical },
  { id: 'milestones', name: 'Hitos', test: (c, i) => c.s.tasks[i]!.milestone },
  { id: 'summary', name: 'Tareas de resumen', test: (c, i) => c.s.tasks[i]!.summary },
  { id: 'incomplete', name: 'Tareas incompletas', test: (c, i) => c.s.tasks[i]!.percent < 100 },
  { id: 'complete', name: 'Tareas completadas', test: (c, i) => c.s.tasks[i]!.percent >= 100 },
  { id: 'inprogress', name: 'Tareas en curso', test: (c, i) => c.s.tasks[i]!.percent > 0 && c.s.tasks[i]!.percent < 100 },
  { id: 'notstarted', name: 'Tareas sin comenzar', test: (c, i) => c.s.tasks[i]!.percent === 0 && !c.s.tasks[i]!.summary },
  { id: 'late', name: 'Tareas atrasadas', test: late },
  { id: 'overbudget', name: 'Costo superior a la línea base', test: (c, i) => { const v = taskValue(c, i, 'costVariance'); return typeof v === 'number' && v > 0.005; } },
  { id: 'noresources', name: 'Tareas sin recursos', test: (c, i) => !c.s.tasks[i]!.summary && c.p.tasks[i]!.assignments.length === 0 },
  { id: 'withresources', name: 'Tareas con recursos', test: (c, i) => c.p.tasks[i]!.assignments.length > 0 },
  { id: 'manual', name: 'Programadas manualmente', test: (c, i) => c.p.tasks[i]!.manual },
  { id: 'constrained', name: 'Con restricciones', test: (c, i) => c.p.tasks[i]!.constraint.type !== 'asap' },
  { id: 'deadline', name: 'Con la fecha límite incumplida', test: (c, i) => c.s.tasks[i]!.deadlineMissed },
  {
    id: 'overallocated',
    name: 'Con recursos sobreasignados',
    test: (c, i) => {
      const t = c.p.tasks[i]!;
      const s = c.s.tasks[i]!;
      return c.s.overallocations.some((o) => t.assignments.some((a) => a.resource === o.resource) && o.from <= dayOfTime(s.finish) && o.to >= dayOfTime(s.start));
    },
  },
];

function compare(v: Value, c: FilterCriterion, type: FieldType): boolean {
  const empty = v === null || v === '' || v === undefined;
  if (c.op === 'empty') return empty;
  if (c.op === 'notempty') return !empty;
  if (type === 'text') {
    const a = String(v ?? '').toLowerCase();
    const b = String(c.value ?? '').toLowerCase();
    switch (c.op) {
      case 'eq': return a === b;
      case 'ne': return a !== b;
      case 'contains': return a.includes(b);
      case 'notcontains': return !a.includes(b);
      case 'startswith': return a.startsWith(b);
      case 'gt': return a > b;
      case 'ge': return a >= b;
      case 'lt': return a < b;
      default: return a <= b;
    }
  }
  if (type === 'flag') {
    const a = v === true;
    const b = c.value === true || c.value === 'true' || c.value === 1;
    return c.op === 'ne' ? a !== b : a === b;
  }
  if (typeof v !== 'number') return c.op === 'ne';
  const b = typeof c.value === 'number' ? c.value : Number(c.value);
  switch (c.op) {
    case 'eq': return v === b;
    case 'ne': return v !== b;
    case 'gt': return v > b;
    case 'ge': return v >= b;
    case 'lt': return v < b;
    case 'le': return v <= b;
    default: return false;
  }
}

export function matchesFilter(ctx: FieldContext, f: FilterDef, i: number): boolean {
  if (!f.criteria.length) return true;
  const results = f.criteria.map((c) => compare(taskValue(ctx, i, c.field), c, fieldType(ctx.p, c.field)));
  return f.mode === 'or' ? results.some(Boolean) : results.every(Boolean);
}

export const allFilters = (p: Project): { id: string; name: string; builtin: boolean }[] => [...BUILTIN_FILTERS.map((f) => ({ id: f.id, name: f.name, builtin: true })), ...p.filters.map((f) => ({ id: f.id, name: f.name, builtin: false }))];

/** The rows that pass a filter (by id: built-in or the project's own). Summary tasks that hold a passing task stay, so the outline is readable. */
export function filteredRows(ctx: FieldContext, filterId: string | null): number[] {
  const n = ctx.p.tasks.length;
  const all = Array.from({ length: n }, (_, i) => i);
  if (!filterId || filterId === 'all') return all;
  const builtin = BUILTIN_FILTERS.find((f) => f.id === filterId);
  const custom = ctx.p.filters.find((f) => f.id === filterId);
  if (!builtin && !custom) return all;
  const pass = all.map((i) => (builtin ? builtin.test(ctx, i) : matchesFilter(ctx, custom!, i)));
  const keep = [...pass];
  for (let i = 0; i < n; i++) {
    if (!pass[i]) continue;
    for (let j = ctx.parent[i]!; j >= 0; j = ctx.parent[j]!) keep[j] = true;
  }
  return all.filter((i) => keep[i]);
}

// ---------- groups ----------

export interface GroupNode {
  key: string;
  label: string;
  /** Leaf tasks inside (all levels). */
  tasks: number[];
  children: GroupNode[];
  totals: { count: number; work: number; cost: number; actualCost: number; start: Time | null; finish: Time | null };
}

function keyOf(ctx: FieldContext, i: number, level: GroupDef['levels'][number]): { key: string; label: string; sort: number | string } {
  const type = fieldType(ctx.p, level.field);
  const v = taskValue(ctx, i, level.field);
  if (v === null || v === '') return { key: '∅', label: '(sin valor)', sort: level.desc ? -Infinity : Infinity };
  if (typeof v === 'number' && level.interval && level.interval > 0) {
    const lo = Math.floor(v / level.interval) * level.interval;
    const hi = lo + level.interval;
    const lab = type === 'date' ? `${formatTime(lo, false)} – ${formatTime(hi - 1, false)}` : `${formatValue(ctx, type, lo)} – ${formatValue(ctx, type, hi)}`;
    return { key: String(lo), label: lab, sort: lo };
  }
  if (type === 'flag') return { key: String(v), label: v ? 'Sí' : 'No', sort: v ? 1 : 0 };
  const lab = formatValue(ctx, type, v, false);
  return { key: String(v), label: lab, sort: typeof v === 'number' ? v : String(v).toLowerCase() };
}

/** Group the leaf tasks (summaries are left out) by the levels of a group definition. */
export function groupTasks(ctx: FieldContext, g: GroupDef, rows?: number[]): GroupNode[] {
  const base = (rows ?? ctx.p.tasks.map((_, i) => i)).filter((i) => !ctx.s.tasks[i]!.summary);
  const build = (ids: number[], depth: number): GroupNode[] => {
    const level = g.levels[depth];
    if (!level) return [];
    const buckets = new Map<string, { label: string; sort: number | string; ids: number[] }>();
    for (const i of ids) {
      const k = keyOf(ctx, i, level);
      const b = buckets.get(k.key) ?? buckets.set(k.key, { label: k.label, sort: k.sort, ids: [] }).get(k.key)!;
      b.ids.push(i);
    }
    const list = [...buckets.entries()].sort((a, b) => {
      const x = a[1].sort;
      const y = b[1].sort;
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return level.desc ? -c : c;
    });
    return list.map(([key, b]) => {
      const leaf = ids.length ? b.ids : [];
      const st = leaf.map((i) => ctx.s.tasks[i]!);
      return {
        key,
        label: b.label,
        tasks: leaf,
        children: build(leaf, depth + 1),
        totals: {
          count: leaf.length,
          work: st.reduce((a, t) => a + t.work, 0),
          cost: st.reduce((a, t) => a + t.cost, 0),
          actualCost: st.reduce((a, t) => a + t.actualCost, 0),
          start: st.length ? Math.min(...st.map((t) => t.start)) : null,
          finish: st.length ? Math.max(...st.map((t) => t.finish)) : null,
        },
      };
    });
  };
  return build(base, 0);
}

export type { CustomValue };
