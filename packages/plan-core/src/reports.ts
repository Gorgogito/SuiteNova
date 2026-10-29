import { asOfTime, evCurves, projectEarnedValue } from './evm';
import { formatValue } from './fields';
import { dayOfTime, isSummary, type Day, type Project, type Time } from './model';
import { baselineName, formatDuration, formatTime } from './ops';
import type { Schedule } from './schedule';
import { bucketsOf, cumulative, phase, resourceUsage, sumInto, type Step } from './usage';

export interface ChartSpec {
  id: string;
  kind: 'bar' | 'stack' | 'line' | 'pie' | 'area';
  title: string;
  categories: string[];
  series: { name: string; data: (number | null)[]; color?: string }[];
  /** Unit shown on the value axis. */
  unit?: string;
}

export interface TableSpec {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

export interface Report {
  id: ReportId;
  title: string;
  kpis: { label: string; value: string; tone?: 'good' | 'bad' | 'warn' }[];
  charts: ChartSpec[];
  tables: TableSpec[];
}

export type ReportId = 'overview' | 'cost' | 'work' | 'resources' | 'earned' | 'burndown';

export const REPORTS: { id: ReportId; title: string }[] = [
  { id: 'overview', title: 'Resumen del proyecto' },
  { id: 'cost', title: 'Costos' },
  { id: 'work', title: 'Trabajo' },
  { id: 'resources', title: 'Recursos' },
  { id: 'earned', title: 'Valor ganado' },
  { id: 'burndown', title: 'Trabajo restante (burndown)' },
];

const COLORS = { plan: '#4a7bd0', actual: '#2e7d32', base: '#9e9e9e', bad: '#c0392b', warn: '#e6a100', remaining: '#f39c12' };
const money = (p: Project, v: number) => formatValue({ p }, 'cost', v);
const hours = (m: number) => Math.round((m / 60) * 10) / 10;
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100) / 100}`);
const stepFor = (spanDays: number): Step => (spanDays > 400 ? 'month' : spanDays > 60 ? 'week' : 'day');

export interface ReportOptions {
  /** Baseline used for planned values (0 = "Baseline"). */
  baseline?: number;
  now?: Time;
}

export function buildReport(id: ReportId, p: Project, s: Schedule, opts: ReportOptions = {}): Report {
  const baseline = opts.baseline ?? 0;
  const asOf = asOfTime(p, opts.now ?? Date.now() / 60000);
  const from: Day = dayOfTime(s.start);
  const to: Day = dayOfTime(s.finish) + 1;
  const step = stepFor(to - from);
  switch (id) {
    case 'overview': return overview(p, s, asOf);
    case 'cost': return cost(p, s, from, to, step);
    case 'work': return work(p, s, from, to, step);
    case 'resources': return resources(p, s, from, to, step);
    case 'earned': return earned(p, s, baseline, asOf, step);
    default: return burndown(p, s, baseline, asOf, from, to, step);
  }
}

function overview(p: Project, s: Schedule, asOf: Time): Report {
  const leaves = s.tasks.filter((t) => !t.summary);
  const done = leaves.filter((t) => t.percent >= 100).length;
  const started = leaves.filter((t) => t.percent > 0 && t.percent < 100).length;
  const notStarted = leaves.length - done - started;
  const late = leaves.filter((t) => t.percent < 100 && t.finish < asOf).length;
  const crit = leaves.filter((t) => t.critical);
  const top = s.tasks.filter((t) => t.outline === 1);
  const miles = s.tasks.filter((t) => t.milestone);
  return {
    id: 'overview',
    title: 'Resumen del proyecto',
    kpis: [
      { label: 'Comienzo', value: formatTime(s.start) },
      { label: 'Fin', value: formatTime(s.finish) },
      { label: 'Duración', value: formatDuration(s.duration, false, p) },
      { label: '% completado', value: `${s.percent} %` },
      { label: 'Costo', value: money(p, s.cost) },
      { label: 'Tareas atrasadas', value: String(late), tone: late ? 'bad' : 'good' },
    ],
    charts: [
      { id: 'status', kind: 'pie', title: 'Estado de las tareas', categories: ['Completadas', 'En curso', 'Sin comenzar'], series: [{ name: 'Tareas', data: [done, started, notStarted] }] },
      { id: 'top', kind: 'bar', title: '% completado de las tareas de primer nivel', categories: top.map((t) => p.tasks[t.index]!.name || `#${t.index + 1}`), series: [{ name: '% completado', data: top.map((t) => t.percent), color: COLORS.actual }], unit: '%' },
    ],
    tables: [
      { title: 'Hitos', columns: ['Hito', 'Fecha', 'Estado'], rows: miles.map((m) => [p.tasks[m.index]!.name, formatTime(m.start, false), m.percent >= 100 ? 'Cumplido' : m.start < asOf ? 'Atrasado' : 'Pendiente']) },
      { title: 'Tareas críticas', columns: ['Tarea', 'Comienzo', 'Fin', '% completado'], rows: crit.slice(0, 40).map((t) => [p.tasks[t.index]!.name, formatTime(t.start, false), formatTime(t.finish, false), t.percent]) },
    ],
  };
}

function cost(p: Project, s: Schedule, from: Day, to: Day, step: Step): Report {
  const ph = phase(p, s);
  const buckets = bucketsOf(from, to, step);
  const plan = new Map<Day, number>();
  const act = new Map<Day, number>();
  for (const a of ph.assignments) {
    for (const [d, v] of a.cost) plan.set(d, (plan.get(d) ?? 0) + v);
    for (const [d, v] of a.actualCost) act.set(d, (act.get(d) ?? 0) + v);
  }
  for (const f of ph.fixed) {
    for (const [d, v] of f.cost) plan.set(d, (plan.get(d) ?? 0) + v);
    for (const [d, v] of f.actualCost) act.set(d, (act.get(d) ?? 0) + v);
  }
  const byRes = p.resources.map((r) => ({ r, cost: s.assignments.filter((a) => a.resource === r.id).reduce((a, x) => a + x.cost, 0), actual: s.assignments.filter((a) => a.resource === r.id).reduce((a, x) => a + x.actualCost, 0) })).filter((x) => x.cost > 0);
  const top = s.tasks.filter((t) => t.outline === 1);
  return {
    id: 'cost',
    title: 'Costos',
    kpis: [
      { label: 'Costo total', value: money(p, s.cost) },
      { label: 'Costo real', value: money(p, s.actualCost) },
      { label: 'Costo restante', value: money(p, Math.max(0, s.cost - s.actualCost)) },
      { label: 'Línea base', value: p.baselines[0] ? money(p, Object.values(p.baselines[0].tasks).length ? top.reduce((a, t) => a + (p.baselines[0]!.tasks[p.tasks[t.index]!.id]?.cost ?? 0), 0) : 0) : '—' },
    ],
    charts: [
      { id: 'cum', kind: 'line', title: 'Costo acumulado', categories: buckets.map((b) => b.label), series: [{ name: 'Planificado', data: cumulative(sumInto(plan, buckets)), color: COLORS.plan }, { name: 'Real', data: cumulative(sumInto(act, buckets)), color: COLORS.actual }] },
      { id: 'res', kind: 'stack', title: 'Costo por recurso', categories: byRes.map((x) => x.r.name), series: [{ name: 'Real', data: byRes.map((x) => Math.round(x.actual * 100) / 100), color: COLORS.actual }, { name: 'Restante', data: byRes.map((x) => Math.round((x.cost - x.actual) * 100) / 100), color: COLORS.remaining }] },
      { id: 'tasks', kind: 'bar', title: 'Costo por tarea de primer nivel', categories: top.map((t) => p.tasks[t.index]!.name || `#${t.index + 1}`), series: [{ name: 'Costo', data: top.map((t) => Math.round(t.cost * 100) / 100), color: COLORS.plan }] },
    ],
    tables: [{ title: 'Costo por tarea', columns: ['Tarea', 'Costo', 'Costo real', 'Costo restante'], rows: s.tasks.filter((t) => t.outline <= 2).map((t) => [`${'  '.repeat(t.outline - 1)}${p.tasks[t.index]!.name}`, money(p, t.cost), money(p, t.actualCost), money(p, t.remainingCost)]) }],
  };
}

function work(p: Project, s: Schedule, from: Day, to: Day, step: Step): Report {
  const ph = phase(p, s);
  const buckets = bucketsOf(from, to, step);
  const plan = new Map<Day, number>();
  const act = new Map<Day, number>();
  for (const a of ph.assignments) {
    for (const [d, v] of a.work) plan.set(d, (plan.get(d) ?? 0) + v);
    for (const [d, v] of a.actualWork) act.set(d, (act.get(d) ?? 0) + v);
  }
  const byRes = p.resources.filter((r) => r.type === 'work').map((r) => {
    const mine = s.assignments.filter((a) => a.resource === r.id);
    return { r, work: mine.reduce((a, x) => a + x.work, 0), actual: mine.reduce((a, x) => a + x.actualWork, 0) };
  }).filter((x) => x.work > 0);
  return {
    id: 'work',
    title: 'Trabajo',
    kpis: [
      { label: 'Trabajo', value: `${hours(s.work)} h` },
      { label: 'Trabajo real', value: `${hours(s.actualWork)} h` },
      { label: 'Trabajo restante', value: `${hours(Math.max(0, s.work - s.actualWork))} h` },
      { label: '% de trabajo realizado', value: s.work > 0 ? `${Math.round((s.actualWork / s.work) * 100)} %` : '—' },
    ],
    charts: [
      { id: 'period', kind: 'bar', title: 'Trabajo por período (horas)', categories: buckets.map((b) => b.label), series: [{ name: 'Planificado', data: sumInto(plan, buckets).map(hours), color: COLORS.plan }, { name: 'Real', data: sumInto(act, buckets).map(hours), color: COLORS.actual }], unit: 'h' },
      { id: 'res', kind: 'stack', title: 'Trabajo por recurso (horas)', categories: byRes.map((x) => x.r.name), series: [{ name: 'Real', data: byRes.map((x) => hours(x.actual)), color: COLORS.actual }, { name: 'Restante', data: byRes.map((x) => hours(Math.max(0, x.work - x.actual))), color: COLORS.remaining }], unit: 'h' },
    ],
    tables: [{ title: 'Trabajo por recurso', columns: ['Recurso', 'Trabajo (h)', 'Real (h)', 'Restante (h)'], rows: byRes.map((x) => [x.r.name, hours(x.work), hours(x.actual), hours(Math.max(0, x.work - x.actual))]) }],
  };
}

function resources(p: Project, s: Schedule, from: Day, to: Day, step: Step): Report {
  const buckets = bucketsOf(from, to, step);
  const use = resourceUsage(p, s, buckets).filter((u) => p.resources.find((r) => r.id === u.id)?.type === 'work');
  const over = new Set(s.overallocations.map((o) => o.resource));
  return {
    id: 'resources',
    title: 'Recursos',
    kpis: [
      { label: 'Recursos de trabajo', value: String(use.length) },
      { label: 'Sobreasignados', value: String(over.size), tone: over.size ? 'bad' : 'good' },
    ],
    charts: use.slice(0, 8).map((u) => ({
      id: `r-${u.id}`,
      kind: 'bar' as const,
      title: `Carga de ${u.name} (horas)`,
      categories: buckets.map((b) => b.label),
      series: [
        { name: 'Trabajo', data: u.total.work.map((w) => hours(w)), color: u.peak.some((x, i) => x > 1.0001 && u.total.work[i]! > u.capacity[i]! + 0.5) ? COLORS.bad : COLORS.plan },
        { name: 'Capacidad', data: u.capacity.map(hours), color: COLORS.base },
      ],
      unit: 'h',
    })),
    tables: [{ title: 'Resumen de recursos', columns: ['Recurso', 'Trabajo (h)', 'Costo', 'Sobreasignado'], rows: use.map((u) => [u.name, hours(u.total.work.reduce((a, b) => a + b, 0)), money(p, u.total.cost.reduce((a, b) => a + b, 0)), over.has(u.id) ? 'Sí' : 'No']) }],
  };
}

function earned(p: Project, s: Schedule, baseline: number, asOf: Time, step: Step): Report {
  const ev = projectEarnedValue(p, s, baseline, asOf);
  const c = evCurves(p, s, baseline, step, asOf);
  const has = !!p.baselines[baseline];
  const tone = (v: number | null, good = 1): 'good' | 'bad' | undefined => (v === null ? undefined : v >= good ? 'good' : 'bad');
  return {
    id: 'earned',
    title: 'Valor ganado',
    kpis: has
      ? [
          { label: 'Valor planificado (CPTP)', value: money(p, ev.pv) },
          { label: 'Valor ganado (CPTR)', value: money(p, ev.ev) },
          { label: 'Costo real (CRTR)', value: money(p, ev.ac) },
          { label: 'Variación del costo (VC)', value: money(p, ev.cv), tone: ev.cv >= 0 ? 'good' : 'bad' },
          { label: 'Variación del plazo (VP)', value: money(p, ev.sv), tone: ev.sv >= 0 ? 'good' : 'bad' },
          { label: 'IRC (CPI)', value: pct(ev.cpi), tone: tone(ev.cpi) },
          { label: 'IRP (SPI)', value: pct(ev.spi), tone: tone(ev.spi) },
          { label: 'EAC', value: money(p, ev.eac) },
          { label: 'VAC', value: money(p, ev.vac), tone: ev.vac >= 0 ? 'good' : 'bad' },
        ]
      : [],
    charts: has
      ? [{ id: 's', kind: 'line', title: 'Curvas S: valor planificado, ganado y costo real', categories: c.buckets.map((b) => b.label), series: [{ name: 'Valor planificado', data: c.pv, color: COLORS.base }, { name: 'Valor ganado', data: c.ev, color: COLORS.actual }, { name: 'Costo real', data: c.ac, color: COLORS.bad }, { name: 'Plan actual', data: c.plan, color: COLORS.plan }] }]
      : [],
    tables: [{ title: 'Información', columns: ['Dato'], rows: [[has ? `Medido al ${formatTime(asOf, false)} frente a «${baselineName(baseline)}».` : 'Guarda una línea base (Proyecto > Líneas base) para calcular el valor ganado.']] }],
  };
}

function burndown(p: Project, s: Schedule, baseline: number, asOf: Time, from: Day, to: Day, step: Step): Report {
  const ph = phase(p, s);
  const buckets = bucketsOf(from, to, step);
  const plan = new Map<Day, number>();
  const act = new Map<Day, number>();
  for (const a of ph.assignments) {
    for (const [d, v] of a.work) plan.set(d, (plan.get(d) ?? 0) + v);
    for (const [d, v] of a.actualWork) act.set(d, (act.get(d) ?? 0) + v);
  }
  const total = s.work;
  const cumPlan = cumulative(sumInto(plan, buckets));
  const cumAct = cumulative(sumInto(act, buckets));
  const asOfDay = dayOfTime(asOf);
  const b = p.baselines[baseline];
  const baseWork = b ? Object.entries(b.tasks).reduce((a, [id, e]) => a + (p.tasks.some((t, i) => t.id === id && !isSummary(p.tasks, i)) ? e.work : 0), 0) : null;
  return {
    id: 'burndown',
    title: 'Trabajo restante (burndown)',
    kpis: [
      { label: 'Trabajo total', value: `${hours(total)} h` },
      { label: 'Realizado', value: `${hours(s.actualWork)} h` },
      { label: 'Restante', value: `${hours(Math.max(0, total - s.actualWork))} h` },
    ],
    charts: [
      {
        id: 'burn',
        kind: 'line',
        title: 'Trabajo restante (horas)',
        categories: buckets.map((x) => x.label),
        series: [
          { name: 'Restante previsto', data: cumPlan.map((v) => hours(Math.max(0, total - v))), color: COLORS.plan },
          { name: 'Restante real', data: cumAct.map((v, i) => (buckets[i]!.from <= asOfDay ? hours(Math.max(0, total - v)) : null)), color: COLORS.actual },
          ...(baseWork !== null ? [{ name: 'Ideal (línea base)', data: buckets.map((_x, i) => hours(Math.max(0, baseWork * (1 - (i + 1) / buckets.length)))), color: COLORS.base }] : []),
        ],
        unit: 'h',
      },
    ],
    tables: [],
  };
}
