import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import {
  bucketsOf, buildReport, dayBasis, dayOfTime, formatDuration, formatTime, formatValue, networkLayout, nowIn, resourceUsage, taskUsage, REPORTS, deleteResource,
  type ChartSpec, type Project, type Resource, type UsageSeries,
} from '@suitenova/plan-core';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { Chart } from './Chart';
import type { PlanCtl } from './ctl';

const hours = (m: number): string => (m === 0 ? '' : String(Math.round((m / 60) * 10) / 10).replace('.', ','));
const Empty = ({ text }: { text: string }) => <div className="pl-empty-view">{t(text)}</div>;

/** Days covered by the schedule (at least a week), and no more than the tables can reasonably show. */
function span(ctl: PlanCtl): { from: number; to: number } | null {
  const s = ctl.sched;
  if (!s || !s.tasks.length) return null;
  const from = dayOfTime(s.start);
  return { from, to: Math.max(dayOfTime(s.finish) + 1, from + 7) };
}

// ---------- network diagram (PERT) ----------

export function NetworkView({ ctl }: { ctl: PlanCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const s = ctl.sched;
  const p = ctl.project;
  const layout = useMemo(() => (s ? networkLayout(p, s, { nodeW: 236 }) : null), [p, s]);
  if (!s || !layout || !layout.nodes.length) return <Empty text="No hay tareas que dibujar en el diagrama de red." />;
  return (
    <div className="pl-view pl-netview">
      <svg width={layout.width + 24} height={layout.height + 24} role="img" aria-label={t('Diagrama de red (PERT)')} className="pl-net">
        <defs>
          <marker id="pl-net-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
          </marker>
        </defs>
        <g transform="translate(12 12)">
          {layout.edges.map((e) => (
            <polyline key={`${e.from}>${e.to}`} points={e.points.map((q) => `${q.x},${q.y}`).join(' ')} className={`pl-netedge${e.critical && ctl.showCritical ? ' is-critical' : ''}`} fill="none" markerEnd="url(#pl-net-arrow)" data-edge={`${e.from}>${e.to}`}>
              <title>{e.type}</title>
            </polyline>
          ))}
          {layout.nodes.map((n) => {
            const st = s.tasks[n.index]!;
            const task = p.tasks[n.index]!;
            const sel = ctl.selected.includes(n.index);
            return (
              <g
                key={n.id}
                transform={`translate(${n.x} ${n.y})`}
                className={`pl-netnode${n.critical && ctl.showCritical ? ' is-critical' : ''}${sel ? ' is-sel' : ''}${n.milestone ? ' is-milestone' : ''}`}
                data-task-id={n.id}
                role="button"
                tabIndex={0}
                aria-label={`${task.name}, ${formatTime(st.start)} – ${formatTime(st.finish)}`}
                onClick={(e) => ctl.select(n.index, e.ctrlKey || e.metaKey ? 'toggle' : 'one')}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && ctl.select(n.index)}
              >
                <rect width={n.w} height={n.h} rx={4} className="pl-netbox" />
                <line x1={0} x2={n.w} y1={22} y2={22} className="pl-netline" />
                <text x={6} y={15} className="pl-nettitle">
                  {n.index + 1}. {task.name.length > 24 ? `${task.name.slice(0, 23)}…` : task.name}
                </text>
                <text x={6} y={38} className="pl-nettext">{formatTime(st.start)}</text>
                <text x={n.w - 6} y={38} textAnchor="end" className="pl-nettext">{formatTime(st.finish)}</text>
                <text x={6} y={56} className="pl-nettext">{formatDuration(st.duration, task.elapsed, dayBasis(p, task))}</text>
                <text x={n.w - 6} y={56} textAnchor="end" className="pl-nettext">{Math.round(st.percent)} %</text>
                <text x={6} y={70} className="pl-nettext pl-netsmall">{t('Holgura')}: {formatDuration(Math.max(0, st.slack), false, p)}</text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

// ---------- usage tables ----------

type Metric = 'work' | 'actualWork' | 'cost' | 'actualCost';
const METRICS: [Metric, string][] = [
  ['work', 'Trabajo'],
  ['actualWork', 'Trabajo real'],
  ['cost', 'Costo'],
  ['actualCost', 'Costo real'],
];

function metricText(p: Project, m: Metric, v: number): string {
  if (Math.abs(v) < 1e-9) return '';
  return m === 'work' || m === 'actualWork' ? hours(v) : formatValue({ p }, 'cost', v);
}
const sumOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function StepPicker({ ctl, metric, setMetric }: { ctl: PlanCtl; metric?: Metric; setMetric?: (m: Metric) => void }) {
  return (
    <div className="pl-viewbar">
      {setMetric && (
        <label>
          {t('Detalles')}{' '}
          <select className="nv-select" value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
            {METRICS.map(([m, l]) => (
              <option key={m} value={m}>
                {t(l)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        {t('Escala')}{' '}
        <select className="nv-select" value={ctl.usageStep} onChange={(e) => ctl.setUsageStep(e.target.value as 'day' | 'week' | 'month')}>
          <option value="day">{t('Días')}</option>
          <option value="week">{t('Semanas')}</option>
          <option value="month">{t('Meses')}</option>
        </select>
      </label>
    </div>
  );
}

const MAX_BUCKETS = 400;

export function UsageView({ ctl, mode }: { ctl: PlanCtl; mode: 'task' | 'resource' }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const [metric, setMetric] = useState<Metric>('work');
  const s = ctl.sched;
  const p = ctl.project;
  const range = span(ctl);
  const data = useMemo(() => {
    if (!s || !range) return null;
    const buckets = bucketsOf(range.from, range.to, ctl.usageStep).slice(0, MAX_BUCKETS);
    return { buckets, tasks: mode === 'task' ? taskUsage(p, s, buckets) : null, resources: mode === 'resource' ? resourceUsage(p, s, buckets) : null };
  }, [p, s, range?.from, range?.to, ctl.usageStep, mode]);
  if (!data || !s) return <Empty text="No hay tareas con las que calcular el uso." />;
  const { buckets } = data;
  const head = (
    <thead>
      <tr>
        <th className="pl-usename">{mode === 'task' ? t('Tarea') : t('Recurso')}</th>
        <th className="pl-usenum">{t('Total')}</th>
        {buckets.map((b) => (
          <th key={b.from} className="pl-usenum">
            {b.label}
          </th>
        ))}
      </tr>
    </thead>
  );
  const row = (key: string, name: string, ser: UsageSeries, level: number, strong = false, extraClass = '') => (
    <tr key={key} className={`${strong ? 'is-strong' : ''} ${extraClass}`}>
      <th scope="row" className="pl-usename" style={{ paddingLeft: 6 + level * 14 }}>
        {name}
      </th>
      <td className="pl-usenum">{metricText(p, metric, sumOf(ser[metric]))}</td>
      {ser[metric].map((v, i) => (
        <td key={i} className="pl-usenum">
          {metricText(p, metric, v)}
        </td>
      ))}
    </tr>
  );
  return (
    <div className="pl-view">
      <StepPicker ctl={ctl} metric={metric} setMetric={setMetric} />
      {buckets.length >= MAX_BUCKETS && <p className="pl-note">{t('Se muestran los primeros {n} periodos; usa una escala mayor para ver el resto.', { n: MAX_BUCKETS })}</p>}
      <div className="pl-usewrap">
        <table className="pl-usage" aria-label={mode === 'task' ? t('Uso de tareas') : t('Uso de recursos')}>
          {head}
          <tbody>
            {mode === 'task' &&
              data.tasks!.flatMap((u) => {
                const st = s.tasks[u.task]!;
                const task = p.tasks[u.task]!;
                if (sumOf(u.total[metric]) === 0 && !st.summary && u.resources.length === 0) return [];
                return [
                  row(`t${u.task}`, task.name, u.total, task.outline - 1, true, ctl.selected.includes(u.task) ? 'is-sel' : ''),
                  ...u.resources.filter((r) => sumOf(r.series[metric]) !== 0).map((r) => row(`t${u.task}r${r.resource}`, p.resources.find((x) => x.id === r.resource)?.name ?? '?', r.series, task.outline)),
                ];
              })}
            {mode === 'resource' &&
              data.resources!.flatMap((u) => {
                const over = u.peak.some((x) => x > 1.0001);
                return [
                  <tr key={`r${u.id}`} className={`is-strong${over ? ' is-over' : ''}`}>
                    <th scope="row" className="pl-usename">
                      {u.name}
                      {over ? ` ⚠ ${t('sobreasignado')}` : ''}
                    </th>
                    <td className="pl-usenum">{metricText(p, metric, sumOf(u.total[metric]))}</td>
                    {u.total[metric].map((v, i) => (
                      <td key={i} className={`pl-usenum${u.peak[i]! > 1.0001 ? ' is-over' : ''}`}>
                        {metricText(p, metric, v)}
                      </td>
                    ))}
                  </tr>,
                  ...u.tasks.filter((x) => sumOf(x.series[metric]) !== 0).map((x) => row(`r${u.id}t${x.task}`, p.tasks[x.task]!.name, x.series, 1)),
                ];
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- resource sheet ----------

type ResField = 'name' | 'group' | 'email';

export function ResourceSheet({ ctl }: { ctl: PlanCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const p = ctl.project;
  const s = ctl.sched;
  const over = new Set(s?.overallocations.map((o) => o.resource));
  const [err, setErr] = useState('');
  const update = (id: string, patch: Partial<Resource>) => ctl.commit({ ...ctl.project, resources: ctl.project.resources.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const num = (id: string, v: string, key: 'rate' | 'costPerUse' | 'maxUnits', scale = 1) => {
    const n = Number(v.replace(',', '.'));
    if (v.trim() === '' || !Number.isFinite(n) || n < 0) return setErr(t('Escribe un número mayor o igual que cero.'));
    setErr('');
    update(id, { [key]: n / scale });
  };
  const custom = p.customFields.filter((c) => c.target === 'resource' && !c.formula);
  if (!p.resources.length)
    return (
      <div className="pl-view">
        <Empty text="Todavía no hay recursos." />
        <div className="pl-center">
          <Button appearance="primary" onClick={() => ctl.commit({ ...p, resources: [...p.resources, { id: `r${Date.now().toString(36)}`, name: 'Recurso 1', type: 'work', maxUnits: 1, rate: 0, costPerUse: 0, calendar: null, group: '', email: '', custom: {} }] })}>
            {t('Añadir el primer recurso')}
          </Button>
        </div>
      </div>
    );
  const text = (r: Resource, k: ResField, label: string) => <input className="nv-input" aria-label={`${t(label)}, ${r.name}`} defaultValue={r[k]} key={`${r.id}${k}${r[k]}`} onBlur={(e) => e.target.value !== r[k] && update(r.id, { [k]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
  return (
    <div className="pl-view">
      {err && (
        <p role="alert" className="pl-error">
          {err}
        </p>
      )}
      <div className="pl-usewrap">
        <table className="pl-restable pl-sheet" aria-label={t('Hoja de recursos')}>
          <thead>
            <tr>
              <th>{t('Nombre del recurso')}</th>
              <th>{t('Tipo')}</th>
              <th>{t('Unidades máx. (%)')}</th>
              <th>{t('Tasa estándar (por hora)')}</th>
              <th>{t('Costo por uso')}</th>
              <th>{t('Calendario')}</th>
              <th>{t('Grupo')}</th>
              <th>{t('Correo')}</th>
              {custom.map((c) => (
                <th key={c.id}>{c.name}</th>
              ))}
              <th>{t('Trabajo')}</th>
              <th>{t('Costo')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {p.resources.map((r) => {
              const mine = s?.assignments.filter((a) => a.resource === r.id) ?? [];
              return (
                <tr key={r.id} className={over.has(r.id) ? 'is-over' : ''} data-resource={r.id}>
                  <td>{text(r, 'name', 'Nombre del recurso')}</td>
                  <td>
                    <select className="nv-select" aria-label={`${t('Tipo')}, ${r.name}`} value={r.type} onChange={(e) => update(r.id, { type: e.target.value as Resource['type'] })}>
                      <option value="work">{t('Trabajo')}</option>
                      <option value="material">{t('Material')}</option>
                      <option value="cost">{t('Costo')}</option>
                    </select>
                  </td>
                  <td>
                    <input className="nv-input pl-narrow" aria-label={`${t('Unidades máx. (%)')}, ${r.name}`} disabled={r.type !== 'work'} defaultValue={Math.round(r.maxUnits * 100)} key={`${r.id}u${r.maxUnits}`} onBlur={(e) => num(r.id, e.target.value, 'maxUnits', 100)} />
                  </td>
                  <td>
                    <input className="nv-input pl-narrow" aria-label={`${t('Tasa estándar (por hora)')}, ${r.name}`} defaultValue={r.rate} key={`${r.id}t${r.rate}`} onBlur={(e) => num(r.id, e.target.value, 'rate')} />
                  </td>
                  <td>
                    <input className="nv-input pl-narrow" aria-label={`${t('Costo por uso')}, ${r.name}`} defaultValue={r.costPerUse} key={`${r.id}c${r.costPerUse}`} onBlur={(e) => num(r.id, e.target.value, 'costPerUse')} />
                  </td>
                  <td>
                    <select className="nv-select" aria-label={`${t('Calendario')}, ${r.name}`} value={r.calendar ?? ''} onChange={(e) => update(r.id, { calendar: e.target.value || null })}>
                      <option value="">{t('(el del proyecto)')}</option>
                      {p.calendars.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{text(r, 'group', 'Grupo')}</td>
                  <td>{text(r, 'email', 'Correo')}</td>
                  {custom.map((c) => (
                    <td key={c.id}>
                      <input className="nv-input" aria-label={`${c.name}, ${r.name}`} defaultValue={String(r.custom[c.id] ?? '')} key={`${r.id}${c.id}${String(r.custom[c.id] ?? '')}`} onBlur={(e) => update(r.id, { custom: { ...r.custom, [c.id]: e.target.value === '' ? null : c.type === 'number' || c.type === 'cost' ? Number(e.target.value.replace(',', '.')) || 0 : e.target.value } })} />
                    </td>
                  ))}
                  <td className="pl-usenum">{hours(sumOf(mine.map((a) => a.work)))}</td>
                  <td className="pl-usenum">{formatValue({ p }, 'cost', sumOf(mine.map((a) => a.cost)))}</td>
                  <td>
                    <Button size="small" appearance="subtle" aria-label={`${t('Eliminar')} ${r.name}`} onClick={() => ctl.commit(deleteResource(ctl.project, r.id))}>
                      {t('Eliminar')}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {over.size > 0 && <p className="pl-note">⚠ {t('Los recursos en rojo están sobreasignados: tienen más trabajo del que su calendario y sus unidades permiten.')}</p>}
    </div>
  );
}

// ---------- resource graph ----------

export function ResourceGraph({ ctl }: { ctl: PlanCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const p = ctl.project;
  const s = ctl.sched;
  const [pick, setPick] = useState('');
  const range = span(ctl);
  const works = p.resources.filter((r) => r.type === 'work');
  const data = useMemo(() => {
    if (!s || !range) return null;
    const buckets = bucketsOf(range.from, range.to, ctl.usageStep).slice(0, MAX_BUCKETS);
    return { buckets, usage: resourceUsage(p, s, buckets) };
  }, [p, s, range?.from, range?.to, ctl.usageStep]);
  if (!data || !works.length) return <Empty text="Asigna recursos de trabajo a las tareas para ver su gráfico." />;
  const sel = works.find((r) => r.id === pick) ?? works[0]!;
  const u = data.usage.find((x) => x.id === sel.id)!;
  const hrs = (m: number) => Math.round((m / 60) * 10) / 10;
  const spec: ChartSpec = {
    id: 'resource-load',
    kind: 'bar',
    title: `Carga de trabajo: ${sel.name}`,
    categories: data.buckets.map((b) => b.label),
    series: [
      { name: 'Trabajo asignado', data: u.total.work.map(hrs), color: '#4a7bd0' },
    ],
    unit: 'h',
  };
  const colors = [u.peak.map((x) => (x > 1.0001 ? '#c0392b' : undefined))];
  const overCount = u.peak.filter((x) => x > 1.0001).length;
  return (
    <div className="pl-view">
      <div className="pl-viewbar">
        <label>
          {t('Recurso')}{' '}
          <select className="nv-select" value={sel.id} onChange={(e) => setPick(e.target.value)}>
            {works.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('Escala')}{' '}
          <select className="nv-select" value={ctl.usageStep} onChange={(e) => ctl.setUsageStep(e.target.value as 'day' | 'week' | 'month')}>
            <option value="day">{t('Días')}</option>
            <option value="week">{t('Semanas')}</option>
            <option value="month">{t('Meses')}</option>
          </select>
        </label>
        <span role="status" className={overCount ? 'pl-over-msg' : ''}>
          {overCount ? `⚠ ${overCount === 1 ? t('1 periodo sobreasignado') : t('{n} periodos sobreasignados', { n: overCount })}` : t('Sin sobreasignación')}
        </span>
      </div>
      <Chart spec={spec} height={380} extra={{ colors, line: { name: 'Capacidad', data: u.capacity.map(hrs), color: '#2e7d32' } }} />
      <p className="pl-note">{t('Las barras rojas son periodos en los que algún día el recurso tiene más trabajo del que su calendario y sus unidades permiten.')}</p>
    </div>
  );
}

// ---------- visual reports ----------

export function ReportsView({ ctl }: { ctl: PlanCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const s = ctl.sched;
  const p = ctl.project;
  const report = useMemo(() => (s && s.tasks.length ? buildReport(ctl.reportId, p, s, { baseline: ctl.baselineShown, now: nowIn(p.timeZone) }) : null), [p, s, ctl.reportId, ctl.baselineShown]);
  if (!report) return <Empty text="No hay tareas con las que construir informes." />;
  return (
    <div className="pl-view pl-reports">
      <div className="pl-viewbar" role="tablist" aria-label={t('Informes')}>
        {REPORTS.map((r) => (
          <button key={r.id} type="button" role="tab" aria-selected={ctl.reportId === r.id} className={`pl-tab${ctl.reportId === r.id ? ' is-on' : ''}`} onClick={() => ctl.setReport(r.id)}>
            {t(r.title)}
          </button>
        ))}
      </div>
      <h2 className="pl-reporth">{t(report.title)}</h2>
      <div className="pl-kpis">
        {report.kpis.map((k) => (
          <div key={k.label} className={`pl-kpi${k.tone ? ` is-${k.tone}` : ''}`}>
            <div className="pl-kpi-v">{k.value}</div>
            <div className="pl-kpi-l">{t(k.label)}</div>
          </div>
        ))}
      </div>
      <div className="pl-charts">
        {report.charts.map((c) => (
          <div key={c.id} className="pl-chartcard">
            <Chart spec={c} />
          </div>
        ))}
      </div>
      {report.tables.map((tb) => (
        <section key={tb.title} className="pl-reporttable">
          <h3>{t(tb.title)}</h3>
          <table className="pl-usage" aria-label={t(tb.title)}>
            <thead>
              <tr>
                {tb.columns.map((c) => (
                  <th key={c}>{t(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tb.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((v, k) => (
                    <td key={k} className={typeof v === 'number' ? 'pl-usenum' : ''}>
                      {typeof v === 'string' ? t(v) : v}
                    </td>
                  ))}
                </tr>
              ))}
              {tb.rows.length === 0 && (
                <tr>
                  <td colSpan={tb.columns.length}>{t('Sin datos')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

