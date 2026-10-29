import { Button, DialogActions, DialogContent, DialogTitle, Input, Textarea } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import {
  BASELINES, CONSTRAINT_LABEL, TASK_TYPE_LABEL, baselineName, checkFormula, fieldType, fieldsOf, formatDuration, formatPredecessors, formatTime, linkTasks, newAssignment, newCalendar, newId, parseDateTime,
  dayBasis, validZone, zoneNames, parseDuration, parsePredecessors, schedule, setAssignments, setDuration, setEffortDriven, setTaskType, setWork, updateTask, BUILTIN_FILTERS,
  type Accrual, type CalendarDef, type ConstraintType, type CustomFieldDef, type FilterCriterion, type FilterDef, type FilterOp, type GroupDef, type Project, type Task, type TaskType, type WorkPeriod,
} from '@suitenova/plan-core';
import { useEffect, useState, type ReactNode } from 'react';
import { StickyDialog } from '../mail/StickyDialog';
import type { PlanCtl } from './ctl';

const field: React.CSSProperties = { display: 'grid', gap: 4, marginBottom: 10 };
const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 };

function Shell({ title, onClose, actions, children }: { title: string; onClose: () => void; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>{children}</DialogContent>
      <DialogActions>
        {actions ?? (
          <Button appearance="primary" onClick={onClose}>
            {t('Cerrar')}
          </Button>
        )}
      </DialogActions>
    </>
  );
}

function OkCancel({ onClose, onOk, disabled }: { onClose: () => void; onOk: () => void; disabled?: boolean }) {
  return (
    <>
      <Button onClick={onClose}>{t('Cancelar')}</Button>
      <Button appearance="primary" disabled={disabled} onClick={onOk}>
        {t('Aceptar')}
      </Button>
    </>
  );
}

const Err = ({ text }: { text: string }) => (text ? <p role="alert" className="pl-error">{t(text)}</p> : null);

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div style={field}>
      <label htmlFor={id}>{t(label)}</label>
      {children}
    </div>
  );
}

function Tabs({ tabs, active, onChange }: { tabs: [string, string][]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="pl-tabs" role="tablist">
      {tabs.map(([id, label]) => (
        <button key={id} type="button" role="tab" id={`pl-tab-${id}`} aria-selected={active === id} aria-controls={`pl-panel-${id}`} className={`pl-tab${active === id ? ' is-on' : ''}`} onClick={() => onChange(id)}>
          {t(label)}
        </button>
      ))}
    </div>
  );
}

const hoursOf = (m: number | null): string => (m === null ? '' : String(Math.round((m / 60) * 100) / 100).replace('.', ','));
const parseHours = (v: string): number | null => {
  const n = Number(v.trim().replace(',', '.'));
  return v.trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n * 60) : null;
};
const timeText = (v: number | null): string => (v === null ? '' : formatTime(v));
const parseNum = (v: string): number | null => {
  const n = Number(v.trim().replace(',', '.'));
  return v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
};

/** Run the scheduler on a candidate project: a calendar without working time, for example, cannot be scheduled. */
function checkSchedulable(p: Project): string | null {
  try {
    schedule(p);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

// ---------- task information ----------

const CONSTRAINTS = Object.keys(CONSTRAINT_LABEL) as ConstraintType[];
const ACCRUALS: [Accrual, string][] = [['start', 'Al comenzar'], ['prorated', 'Prorrateado'], ['end', 'Al terminar']];

function TaskForm({ ctl, index, onClose }: { ctl: PlanCtl; index: number; onClose: () => void }) {
  const p0 = ctl.project;
  const t0 = p0.tasks[index]!;
  const st = ctl.sched?.tasks[index];
  const summary = !!st?.summary;
  const [tab, setTab] = useState('general');
  const [err, setErr] = useState('');
  const [name, setName] = useState(t0.name);
  const [duration, setDur] = useState(st ? formatDuration(t0.duration, t0.elapsed, dayBasis(p0, t0)) : '');
  const [percent, setPercent] = useState(String(Math.round(st?.percent ?? t0.percent)));
  const [preds, setPreds] = useState(formatPredecessors(p0, t0));
  const [fixedCost, setFixedCost] = useState(String(t0.fixedCost));
  const [accrual, setAccrual] = useState<Accrual>(t0.fixedCostAccrual);
  const [type, setType] = useState<TaskType>(t0.type);
  const [effort, setEffort] = useState(t0.effortDriven);
  const [work, setWorkText] = useState(hoursOf(st ? st.work : null));
  const [constraint, setConstraint] = useState<ConstraintType>(t0.constraint.type);
  const [cdate, setCdate] = useState(timeText(t0.constraint.date));
  const [deadline, setDeadline] = useState(timeText(t0.deadline));
  const [calendar, setCalendar] = useState(t0.calendar ?? '');
  const [manual, setManual] = useState(t0.manual);
  const [mStart, setMStart] = useState(timeText(t0.manualStart ?? st?.start ?? null));
  const [mFinish, setMFinish] = useState(timeText(t0.manualFinish ?? st?.finish ?? null));
  const [aStart, setAStart] = useState(timeText(t0.actualStart));
  const [aFinish, setAFinish] = useState(timeText(t0.actualFinish));
  const [aWork, setAWork] = useState(hoursOf(t0.actualWork));
  const [aCost, setACost] = useState(t0.actualCost === null ? '' : String(t0.actualCost));
  const [priority, setPriority] = useState(String(t0.priority ?? 500));
  const [notes, setNotes] = useState(t0.notes);
  const [assign, setAssign] = useState(t0.assignments);
  const [custom, setCustom] = useState(t0.custom);
  const customDefs = p0.customFields.filter((c) => c.target === 'task' && !c.formula);
  const workChanged = work !== hoursOf(st ? st.work : null);

  const setUnits = (id: string, units: number | null) => setAssign(units === null ? assign.filter((a) => a.resource !== id) : assign.some((a) => a.resource === id) ? assign.map((a) => (a.resource === id ? { ...a, units } : a)) : [...assign, newAssignment(id, units)]);
  const patchAssign = (id: string, patch: Partial<(typeof assign)[number]>) => setAssign(assign.map((a) => (a.resource === id ? { ...a, ...patch } : a)));

  const ok = () => {
    const fail = (m: string, where: string) => {
      setTab(where);
      setErr(m);
    };
    const id = t0.id;
    let p = p0;
    const patch: Partial<Task> = { name: name.trim() || t0.name, notes, custom, calendar: calendar || null, fixedCostAccrual: accrual };
    const fc = parseNum(fixedCost || '0');
    if (fc === null) return fail('El costo fijo no es válido.', 'general');
    patch.fixedCost = fc;
    if (!summary) {
      const pc = parseNum(percent);
      if (pc === null || pc > 100) return fail('El porcentaje debe estar entre 0 y 100.', 'general');
      patch.percent = Math.round(pc);
      const d = parseDuration(duration.trim(), dayBasis(p0, t0));
      if (!d) return fail('Escribe una duración como 5, 3d, 12h, 90min o 2ed (días transcurridos).', 'general');
      for (const [v, where] of [[cdate, 'advanced'], [deadline, 'advanced'], [aStart, 'actual'], [aFinish, 'actual']] as const) {
        if (v.trim() && parseDateTime(v) === null) return fail('Escribe las fechas como 14/03/2025 o 14/03/2025 10:30.', where);
      }
      if (constraint !== 'asap' && constraint !== 'alap') {
        const cd = parseDateTime(cdate);
        if (cd === null) return fail('La restricción necesita una fecha (14/03/2025).', 'advanced');
        patch.constraint = { type: constraint, date: cd };
      } else patch.constraint = { type: constraint, date: null };
      const prio = parseNum(priority || '500');
      if (prio === null || prio < 0 || prio > 1000) return fail('La prioridad debe estar entre 0 y 1000 (500 es la normal).', 'advanced');
      patch.priority = Math.round(prio) === 500 ? undefined : Math.round(prio);
      patch.deadline = deadline.trim() ? parseDateTime(deadline, 1020) : null;
      patch.actualStart = aStart.trim() ? parseDateTime(aStart) : null;
      patch.actualFinish = aFinish.trim() ? parseDateTime(aFinish, 1020) : null;
      if (aWork.trim()) {
        const w = parseHours(aWork);
        if (w === null) return fail('El trabajo real se escribe en horas (por ejemplo 12,5).', 'actual');
        patch.actualWork = w;
      } else patch.actualWork = null;
      if (aCost.trim()) {
        const c = parseNum(aCost);
        if (c === null) return fail('El costo real no es válido.', 'actual');
        patch.actualCost = c;
      } else patch.actualCost = null;
      patch.manual = manual;
      if (manual) {
        const a = parseDateTime(mStart, 480);
        const b = parseDateTime(mFinish, 1020);
        if (a === null || b === null || b < a) return fail('Las fechas manuales deben ser válidas y el fin no puede ser anterior al comienzo.', 'advanced');
        patch.manualStart = a;
        patch.manualFinish = b;
      } else {
        patch.manualStart = null;
        patch.manualFinish = null;
      }
      // the order matters: type and effort rules first, then the values they protect
      p = updateTask(p, id, patch);
      p = setTaskType(p, id, type);
      p = setEffortDriven(p, id, effort);
      p = setAssignments(p, id, assign);
      p = setDuration(p, id, d.minutes, d.elapsed);
      if (workChanged && work.trim()) {
        const w = parseHours(work);
        if (w === null) return fail('El trabajo se escribe en horas (por ejemplo 40).', 'resources');
        p = setWork(p, id, w);
      }
      // predecessors
      const pr = parsePredecessors(preds, p, index);
      if (pr.error) return fail(pr.error, 'preds');
      let probe: Project = { ...p, tasks: p.tasks.map((x, k) => (k === index ? { ...x, links: [] } : x)) };
      for (const l of pr.links) {
        const res = linkTasks(probe, l.task, id, l.type, l.lag, l.elapsed);
        if (res.error && !/ya están vinculadas/.test(res.error)) return fail(res.error, 'preds');
        probe = res.project;
      }
      p = probe;
    } else {
      p = updateTask(p, id, patch);
    }
    const bad = checkSchedulable(p);
    if (bad) return fail(bad, 'general');
    ctl.commit(p);
    onClose();
  };

  const tabs: [string, string][] = [
    ['general', 'General'],
    ...(summary ? [] : ([['preds', 'Predecesoras'], ['resources', 'Recursos y trabajo'], ['advanced', 'Avanzado'], ['actual', 'Real']] as [string, string][])),
    ['notes', 'Notas'],
    ...(customDefs.length && !summary ? ([['custom', 'Campos personalizados']] as [string, string][]) : []),
  ];

  return (
    <Shell title={t('Información de la tarea')} onClose={onClose} actions={<OkCancel onClose={onClose} onOk={ok} />}>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="pl-panel" role="tabpanel" id={`pl-panel-${tab}`} aria-labelledby={`pl-tab-${tab}`}>
        {tab === 'general' && (
          <>
            <Field id="pl-f-name" label="Nombre">
              <Input id="pl-f-name" value={name} onChange={(_e, d) => setName(d.value)} autoFocus />
            </Field>
            <div style={grid2}>
              <Field id="pl-f-dur" label="Duración">
                <Input id="pl-f-dur" value={duration} disabled={summary} onChange={(_e, d) => setDur(d.value)} />
              </Field>
              <Field id="pl-f-pct" label="% completado">
                <Input id="pl-f-pct" value={percent} disabled={summary} onChange={(_e, d) => setPercent(d.value)} />
              </Field>
            </div>
            {st && (
              <p className="pl-note">
                {t('Comienzo')}: {formatTime(st.start)} · {t('Fin')}: {formatTime(st.finish)} · {t('Holgura')}: {formatDuration(Math.max(0, st.slack), false, p0)}
              </p>
            )}
            <div style={grid2}>
              <Field id="pl-f-cost" label="Costo fijo">
                <Input id="pl-f-cost" value={fixedCost} onChange={(_e, d) => setFixedCost(d.value)} />
              </Field>
              <Field id="pl-f-accr" label="Acumulación del costo fijo">
                <select id="pl-f-accr" className="nv-select" value={accrual} onChange={(e) => setAccrual(e.target.value as Accrual)}>
                  {ACCRUALS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {t(l)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </>
        )}
        {tab === 'preds' && (
          <Field id="pl-f-preds" label="Predecesoras (por ejemplo 1;3SS+2d;4FF-1d;5FS+2ed)">
            <Input id="pl-f-preds" value={preds} placeholder="1;3SS+2d" onChange={(_e, d) => setPreds(d.value)} />
          </Field>
        )}
        {tab === 'resources' && (
          <>
            <div style={grid2}>
              <Field id="pl-f-type" label="Tipo de tarea">
                <select id="pl-f-type" className="nv-select" value={type} onChange={(e) => setType(e.target.value as TaskType)}>
                  {(Object.keys(TASK_TYPE_LABEL) as TaskType[]).map((k) => (
                    <option key={k} value={k}>
                      {t(TASK_TYPE_LABEL[k])}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="pl-f-work" label="Trabajo (horas)">
                <Input id="pl-f-work" value={work} onChange={(_e, d) => setWorkText(d.value)} />
              </Field>
            </div>
            <label className="pl-check">
              <input type="checkbox" checked={effort} onChange={(e) => setEffort(e.target.checked)} /> {t('Conducida por esfuerzo (al añadir recursos baja la duración y el trabajo se mantiene)')}
            </label>
            <fieldset className="pl-fieldset">
              <legend>{t('Recursos asignados')}</legend>
              {p0.resources.length === 0 && <p>{t('Todavía no hay recursos. Créalos en la hoja de recursos.')}</p>}
              {p0.resources.map((r) => {
                const a = assign.find((x) => x.resource === r.id);
                return (
                  <div key={r.id} className="pl-assign">
                    <label>
                      <input type="checkbox" checked={!!a} onChange={(e) => setUnits(r.id, e.target.checked ? 1 : null)} /> {r.name}
                    </label>
                    {a && (
                      <>
                        <input type="number" className="nv-select pl-narrow" min={0} step={r.type === 'work' ? 5 : 1} aria-label={`${t('Unidades de')} ${r.name}`} value={r.type === 'work' ? Math.round(a.units * 100) : a.units} onChange={(e) => setUnits(r.id, r.type === 'work' ? Number(e.target.value) / 100 : Number(e.target.value))} />
                        <span>{r.type === 'work' ? '%' : t('uds.')}</span>
                      </>
                    )}
                  </div>
                );
              })}
            </fieldset>
          </>
        )}
        {tab === 'advanced' && (
          <>
            <div style={grid2}>
              <Field id="pl-f-con" label="Restricción">
                <select id="pl-f-con" className="nv-select" value={constraint} onChange={(e) => setConstraint(e.target.value as ConstraintType)}>
                  {CONSTRAINTS.map((k) => (
                    <option key={k} value={k}>
                      {t(CONSTRAINT_LABEL[k])}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="pl-f-date" label="Fecha de la restricción">
                <Input id="pl-f-date" value={cdate} placeholder="dd/mm/aaaa hh:mm" disabled={constraint === 'asap' || constraint === 'alap'} onChange={(_e, d) => setCdate(d.value)} />
              </Field>
            </div>
            <div style={grid2}>
              <Field id="pl-f-prio" label="Prioridad (0–1000; la nivelación retrasa primero las de menor prioridad)">
                <Input id="pl-f-prio" value={priority} onChange={(_e, d) => setPriority(d.value)} />
              </Field>
              <Field id="pl-f-ld" label="Retraso por nivelación">
                <Input id="pl-f-ld" value={formatDuration(t0.levelDelay ?? 0, false, dayBasis(p0, t0))} readOnly />
              </Field>
            </div>
            <div style={grid2}>
              <Field id="pl-f-dead" label="Fecha límite">
                <Input id="pl-f-dead" value={deadline} placeholder="dd/mm/aaaa hh:mm" onChange={(_e, d) => setDeadline(d.value)} />
              </Field>
              <Field id="pl-f-cal" label="Calendario de la tarea">
                <select id="pl-f-cal" className="nv-select" value={calendar} onChange={(e) => setCalendar(e.target.value)}>
                  <option value="">{t('(el del proyecto)')}</option>
                  {p0.calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <label className="pl-check">
              <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} /> {t('Programada manualmente (las fechas las pones tú)')}
            </label>
            <div style={grid2}>
              <Field id="pl-f-ms" label="Comienzo manual">
                <Input id="pl-f-ms" value={mStart} disabled={!manual} onChange={(_e, d) => setMStart(d.value)} />
              </Field>
              <Field id="pl-f-mf" label="Fin manual">
                <Input id="pl-f-mf" value={mFinish} disabled={!manual} onChange={(_e, d) => setMFinish(d.value)} />
              </Field>
            </div>
          </>
        )}
        {tab === 'actual' && (
          <>
            <div style={grid2}>
              <Field id="pl-f-as" label="Comienzo real">
                <Input id="pl-f-as" value={aStart} placeholder={t('(según el avance)')} onChange={(_e, d) => setAStart(d.value)} />
              </Field>
              <Field id="pl-f-af" label="Fin real">
                <Input id="pl-f-af" value={aFinish} placeholder={t('(según el avance)')} onChange={(_e, d) => setAFinish(d.value)} />
              </Field>
            </div>
            <div style={grid2}>
              <Field id="pl-f-aw" label="Trabajo real (horas)">
                <Input id="pl-f-aw" value={aWork} placeholder={t('(según el avance)')} onChange={(_e, d) => setAWork(d.value)} />
              </Field>
              <Field id="pl-f-ac" label="Costo real">
                <Input id="pl-f-ac" value={aCost} placeholder={t('(según el avance)')} onChange={(_e, d) => setACost(d.value)} />
              </Field>
            </div>
            {assign.length > 0 && (
              <fieldset className="pl-fieldset">
                <legend>{t('Real por recurso')}</legend>
                {assign.map((a) => {
                  const r = p0.resources.find((x) => x.id === a.resource);
                  return (
                    <div key={a.resource} className="pl-assign">
                      <span className="pl-assign-name">{r?.name ?? '?'}</span>
                      <input className="nv-select pl-narrow" aria-label={`${t('Trabajo real (horas)')}, ${r?.name}`} placeholder={t('horas')} value={hoursOf(a.actualWork)} onChange={(e) => patchAssign(a.resource, { actualWork: e.target.value.trim() === '' ? null : (parseHours(e.target.value) ?? a.actualWork) })} />
                      <input className="nv-select pl-narrow" aria-label={`${t('Costo real')}, ${r?.name}`} placeholder={t('costo')} value={a.actualCost ?? ''} onChange={(e) => patchAssign(a.resource, { actualCost: e.target.value.trim() === '' ? null : (parseNum(e.target.value) ?? a.actualCost) })} />
                    </div>
                  );
                })}
              </fieldset>
            )}
          </>
        )}
        {tab === 'notes' && (
          <Field id="pl-f-notes" label="Notas">
            <Textarea id="pl-f-notes" rows={6} value={notes} onChange={(_e, d) => setNotes(d.value)} />
          </Field>
        )}
        {tab === 'custom' &&
          customDefs.map((c) => (
            <Field key={c.id} id={`pl-f-c-${c.id}`} label={c.name}>
              {c.type === 'flag' ? (
                <input id={`pl-f-c-${c.id}`} type="checkbox" checked={custom[c.id] === true} onChange={(e) => setCustom({ ...custom, [c.id]: e.target.checked })} />
              ) : c.type === 'list' ? (
                <select id={`pl-f-c-${c.id}`} className="nv-select" value={String(custom[c.id] ?? '')} onChange={(e) => setCustom({ ...custom, [c.id]: e.target.value || null })}>
                  <option value="" />
                  {(c.list ?? []).map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`pl-f-c-${c.id}`}
                  value={c.type === 'date' && typeof custom[c.id] === 'number' ? formatTime(custom[c.id] as number) : c.type === 'duration' && typeof custom[c.id] === 'number' ? formatDuration(custom[c.id] as number, false, p0) : String(custom[c.id] ?? '')}
                  onChange={(_e, d) => {
                    const v = d.value;
                    let val: string | number | null = v === '' ? null : v;
                    if (c.type === 'number' || c.type === 'cost') val = v === '' ? null : (parseNum(v) ?? v);
                    if (c.type === 'date' && v) val = parseDateTime(v) ?? v;
                    if (c.type === 'duration' && v) val = parseDuration(v, p0)?.minutes ?? v;
                    setCustom({ ...custom, [c.id]: val });
                  }}
                />
              )}
            </Field>
          ))}
      </div>
      <Err text={err} />
    </Shell>
  );
}

export function TaskDialog({ ctl, open, onClose }: { ctl: PlanCtl; open: boolean; onClose: () => void }) {
  return (
    <StickyDialog open={open} onClose={onClose} width={680}>
      {open && ctl.active >= 0 && <TaskForm key={ctl.active} ctl={ctl} index={ctl.active} onClose={onClose} />}
    </StickyDialog>
  );
}

// ---------- project ----------

function ProjectForm({ ctl, onClose }: { ctl: PlanCtl; onClose: () => void }) {
  const p = ctl.project;
  const [name, setName] = useState(p.name);
  const [start, setStart] = useState(formatTime(p.start));
  const [status, setStatus] = useState(p.statusDate !== null ? formatTime(p.statusDate) : '');
  const [calendar, setCalendar] = useState(p.calendar);
  const [hpd, setHpd] = useState(String(p.minutesPerDay / 60));
  const [hpw, setHpw] = useState(String(p.minutesPerWeek / 60));
  const [dpm, setDpm] = useState(String(p.daysPerMonth));
  const [currency, setCurrency] = useState(p.currency);
  const [resCal, setResCal] = useState(!!p.resourceCalendars);
  const [taskDays, setTaskDays] = useState(!!p.taskCalendarDays);
  const [weighted, setWeighted] = useState(!!p.weightedEarnedValue);
  const [zone, setZone] = useState(p.timeZone ?? '');
  const [err, setErr] = useState('');
  const ok = () => {
    if (zone && !validZone(zone)) return setErr('La zona horaria no existe. Usa un nombre como Europe/Madrid o America/Bogota.');
    const s = parseDateTime(start, 480);
    if (s === null) return setErr('La fecha de comienzo no es válida (14/03/2025 08:00).');
    let st: number | null = null;
    if (status.trim()) {
      st = parseDateTime(status, 1020);
      if (st === null) return setErr('La fecha de estado no es válida (14/03/2025).');
    }
    const a = parseNum(hpd);
    const b = parseNum(hpw);
    const c = parseNum(dpm);
    if (a === null || a <= 0 || a > 24) return setErr('Las horas por día deben estar entre 0 y 24.');
    if (b === null || b <= 0 || b > 168) return setErr('Las horas por semana deben estar entre 0 y 168.');
    if (c === null || c <= 0 || c > 31) return setErr('Los días por mes deben estar entre 0 y 31.');
    const next = { ...p, name: name.trim() || p.name, start: s, statusDate: st, calendar, minutesPerDay: Math.round(a * 60), minutesPerWeek: Math.round(b * 60), daysPerMonth: c, currency: currency.trim() || p.currency };
    const { resourceCalendars: _a, taskCalendarDays: _b, weightedEarnedValue: _c, timeZone: _d, ...rest } = next;
    const withOptions: Project = { ...rest, ...(resCal ? { resourceCalendars: true } : {}), ...(taskDays ? { taskCalendarDays: true } : {}), ...(weighted ? { weightedEarnedValue: true } : {}), ...(zone ? { timeZone: zone } : {}) };
    const bad = checkSchedulable(withOptions);
    if (bad) return setErr(bad);
    ctl.commit(withOptions);
    onClose();
  };
  return (
    <Shell title={t('Información del proyecto')} onClose={onClose} actions={<OkCancel onClose={onClose} onOk={ok} />}>
      <Field id="pl-p-name" label="Nombre del proyecto">
        <Input id="pl-p-name" value={name} onChange={(_e, d) => setName(d.value)} autoFocus />
      </Field>
      <div style={grid2}>
        <Field id="pl-p-start" label="Fecha de comienzo">
          <Input id="pl-p-start" value={start} onChange={(_e, d) => setStart(d.value)} />
        </Field>
        <Field id="pl-p-status" label="Fecha de estado">
          <Input id="pl-p-status" value={status} placeholder={t('(ninguna)')} onChange={(_e, d) => setStatus(d.value)} />
        </Field>
      </div>
      <div style={grid2}>
        <Field id="pl-p-cal" label="Calendario del proyecto">
          <select id="pl-p-cal" className="nv-select" value={calendar} onChange={(e) => setCalendar(e.target.value)}>
            {p.calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="pl-p-cur" label="Moneda">
          <Input id="pl-p-cur" value={currency} onChange={(_e, d) => setCurrency(d.value)} style={{ width: 90 }} />
        </Field>
      </div>
      <fieldset className="pl-fieldset">
        <legend>{t('Cómo se convierten las duraciones')}</legend>
        <div className="pl-three">
          <Field id="pl-p-hpd" label="Horas por día">
            <Input id="pl-p-hpd" value={hpd} onChange={(_e, d) => setHpd(d.value)} />
          </Field>
          <Field id="pl-p-hpw" label="Horas por semana">
            <Input id="pl-p-hpw" value={hpw} onChange={(_e, d) => setHpw(d.value)} />
          </Field>
          <Field id="pl-p-dpm" label="Días por mes">
            <Input id="pl-p-dpm" value={dpm} onChange={(_e, d) => setDpm(d.value)} />
          </Field>
        </div>
      </fieldset>
      <fieldset className="pl-fieldset">
        <legend>{t('Cómo se programa')}</legend>
        <label className="pl-check">
          <input type="checkbox" checked={resCal} onChange={(e) => setResCal(e.target.checked)} /> {t('La tarea espera a los calendarios de sus recursos (solo avanza cuando el calendario de la tarea y el de algún recurso asignado trabajan)')}
        </label>
        <label className="pl-check">
          <input type="checkbox" checked={taskDays} onChange={(e) => setTaskDays(e.target.checked)} /> {t('Un «día» de una tarea vale las horas diarias de su propio calendario')}
        </label>
        <label className="pl-check">
          <input type="checkbox" checked={weighted} onChange={(e) => setWeighted(e.target.checked)} /> {t('Valor ganado según el reparto del trabajo y del costo (no solo el porcentaje)')}
        </label>
        <Field id="pl-p-zone" label="Zona horaria (vacía = reloj sin zona)">
          <Input id="pl-p-zone" list="pl-zones" value={zone} placeholder="Europe/Madrid" onChange={(_e, d) => setZone(d.value)} />
        </Field>
        <datalist id="pl-zones">
          {zoneNames().map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
      </fieldset>
      <Err text={err} />
    </Shell>
  );
}
export function ProjectDialog({ ctl, open, onClose }: { ctl: PlanCtl; open: boolean; onClose: () => void }) {
  return (
    <StickyDialog open={open} onClose={onClose} width={600}>
      {open && <ProjectForm ctl={ctl} onClose={onClose} />}
    </StickyDialog>
  );
}

// ---------- calendars ----------

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const periodsText = (ps: WorkPeriod[]): string => ps.map((p) => `${clock(p.from)}-${clock(p.to)}`).join(', ');

/** "08:00-12:00, 13:00-17:00" to periods; null when it is not valid. An empty text is "not working". */
function parsePeriods(text: string): WorkPeriod[] | null {
  const out: WorkPeriod[] = [];
  for (const part of text.split(/[,;]/)) {
    if (!part.trim()) continue;
    const m = /^\s*(\d{1,2}):?(\d{2})?\s*-\s*(\d{1,2}):?(\d{2})?\s*$/.exec(part);
    if (!m) return null;
    const from = +m[1]! * 60 + +(m[2] ?? 0);
    const to = +m[3]! * 60 + +(m[4] ?? 0);
    if (!(from < to) || to > 1440) return null;
    out.push({ from, to });
  }
  out.sort((a, b) => a.from - b.from);
  for (let i = 1; i < out.length; i++) if (out[i]!.from < out[i - 1]!.to) return null;
  return out;
}

type DayMode = 'base' | 'off' | 'hours';

function CalendarsForm({ ctl, onClose }: { ctl: PlanCtl; onClose: () => void }) {
  const [cals, setCals] = useState<CalendarDef[]>(() => ctl.project.calendars.map((c) => ({ ...c, week: c.week.map((w) => (w ? w.map((x) => ({ ...x })) : null)), exceptions: c.exceptions.map((e) => ({ ...e, periods: e.periods.map((x) => ({ ...x })) })) })));
  const [sel, setSel] = useState(ctl.project.calendar);
  const [err, setErr] = useState('');
  // text being typed per day (so a half-written range is not lost)
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [ex, setEx] = useState({ from: '', to: '', name: '', hours: '' });
  const cal = cals.find((c) => c.id === sel) ?? cals[0]!;
  const edit = (patch: Partial<CalendarDef>) => setCals(cals.map((c) => (c.id === cal.id ? { ...c, ...patch } : c)));
  const modeOf = (d: number): DayMode => (cal.week[d] === null ? 'base' : cal.week[d]!.length ? 'hours' : 'off');
  const textOf = (d: number) => texts[`${cal.id}-${d}`] ?? (cal.week[d]?.length ? periodsText(cal.week[d]!) : '');
  const setDay = (d: number, mode: DayMode, text?: string) => {
    const week = [...cal.week];
    if (mode === 'base') week[d] = null;
    else if (mode === 'off') week[d] = [];
    else {
      const ps = parsePeriods(text ?? textOf(d) ?? '08:00-17:00') ?? [];
      week[d] = ps.length ? ps : [{ from: 480, to: 1020 }];
    }
    edit({ week });
  };
  const add = () => {
    const c = newCalendar(`Calendario ${cals.length + 1}`, ctl.project.calendar);
    setCals([...cals, c]);
    setSel(c.id);
  };
  const used = (id: string) => ctl.project.calendar === id || ctl.project.tasks.some((x) => x.calendar === id) || ctl.project.resources.some((r) => r.calendar === id) || cals.some((c) => c.base === id);
  const remove = () => {
    if (used(cal.id)) return setErr('Ese calendario está en uso (proyecto, tareas, recursos u otro calendario).');
    const rest = cals.filter((c) => c.id !== cal.id);
    setCals(rest);
    setSel(rest[0]!.id);
    setErr('');
  };
  const addEx = () => {
    const a = parseDateTime(ex.from, 0);
    const b = ex.to.trim() ? parseDateTime(ex.to, 0) : a;
    if (a === null || b === null || b < a) return setErr('Escribe las fechas de la excepción como 25/12/2025 (el fin no puede ser anterior al comienzo).');
    const ps = parsePeriods(ex.hours);
    if (ps === null) return setErr('Escribe los horarios como 08:00-12:00, 13:00-17:00 (o déjalo vacío para un día no laborable).');
    const from = Math.floor(a / 1440);
    const to = Math.floor(b / 1440);
    edit({ exceptions: [...cal.exceptions.filter((e) => !(e.from === from && e.to === to)), { from, to, periods: ps, name: ex.name.trim() || undefined }].sort((x, y) => x.from - y.from) });
    setEx({ from: '', to: '', name: '', hours: '' });
    setErr('');
  };
  const ok = () => {
    if (!cals.some((c) => c.id === ctl.project.calendar)) return setErr('Falta el calendario del proyecto.');
    for (const c of cals) {
      // a loop in the bases would never end
      const seen = new Set<string>();
      for (let x: CalendarDef | undefined = c; x; x = cals.find((k) => k.id === x!.base)) {
        if (seen.has(x.id)) return setErr(`El calendario "${c.name}" se basa en sí mismo.`);
        seen.add(x.id);
      }
      if (!c.name.trim()) return setErr('Todos los calendarios necesitan un nombre.');
    }
    const next = { ...ctl.project, calendars: cals };
    const bad = checkSchedulable(next);
    if (bad) return setErr(bad);
    ctl.commit(next);
    onClose();
  };
  return (
    <Shell title={t('Calendarios laborales')} onClose={onClose} actions={<OkCancel onClose={onClose} onOk={ok} />}>
      <div className="pl-calbar">
        <label htmlFor="pl-cal-sel">{t('Calendario')}</label>
        <select id="pl-cal-sel" className="nv-select" value={cal.id} onChange={(e) => setSel(e.target.value)}>
          {cals.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button size="small" onClick={add}>
          {t('Nuevo calendario')}
        </Button>
        <Button size="small" onClick={remove}>
          {t('Eliminar')}
        </Button>
      </div>
      <div style={grid2}>
        <Field id="pl-cal-name" label="Nombre">
          <Input id="pl-cal-name" value={cal.name} onChange={(_e, d) => edit({ name: d.value })} />
        </Field>
        <Field id="pl-cal-base" label="Basado en">
          <select id="pl-cal-base" className="nv-select" value={cal.base ?? ''} onChange={(e) => edit({ base: e.target.value || null })}>
            <option value="">{t('(ninguno)')}</option>
            {cals
              .filter((c) => c.id !== cal.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <fieldset className="pl-fieldset">
        <legend>{t('Semana laboral')}</legend>
        <table className="pl-caltable">
          <tbody>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <tr key={d}>
                <th scope="row">{t(DAY_NAMES[d]!)}</th>
                <td>
                  <select className="nv-select" aria-label={`${t(DAY_NAMES[d]!)}: ${t('tipo de día')}`} value={modeOf(d)} onChange={(e) => setDay(d, e.target.value as DayMode)}>
                    <option value="base">{t('Como el calendario base')}</option>
                    <option value="off">{t('No laborable')}</option>
                    <option value="hours">{t('Laborable, con horario')}</option>
                  </select>
                </td>
                <td>
                  <input
                    className="nv-input"
                    aria-label={`${t(DAY_NAMES[d]!)}: ${t('horario')}`}
                    placeholder="08:00-12:00, 13:00-17:00"
                    disabled={modeOf(d) !== 'hours'}
                    value={textOf(d)}
                    onChange={(e) => setTexts({ ...texts, [`${cal.id}-${d}`]: e.target.value })}
                    onBlur={(e) => {
                      const ps = parsePeriods(e.target.value);
                      if (ps === null || !ps.length) setErr('Escribe los horarios como 08:00-12:00, 13:00-17:00.');
                      else {
                        setErr('');
                        setDay(d, 'hours', e.target.value);
                        setTexts({ ...texts, [`${cal.id}-${d}`]: periodsText(ps) });
                      }
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>
      <fieldset className="pl-fieldset">
        <legend>{t('Excepciones (festivos y días con otro horario)')}</legend>
        <ul className="pl-exlist" aria-label={t('Excepciones')}>
          {cal.exceptions.length === 0 && <li>{t('No hay excepciones.')}</li>}
          {cal.exceptions.map((e) => (
            <li key={`${e.from}-${e.to}`}>
              <span>
                {formatTime(e.from * 1440, false)}
                {e.to !== e.from ? ` – ${formatTime(e.to * 1440, false)}` : ''}
              </span>
              <span>{e.name ?? ''}</span>
              <em>{e.periods.length ? periodsText(e.periods) : t('no laborable')}</em>
              <button type="button" aria-label={`${t('Quitar excepción')} ${formatTime(e.from * 1440, false)}`} onClick={() => edit({ exceptions: cal.exceptions.filter((x) => x !== e) })}>
                ✕
              </button>
            </li>
          ))}
        </ul>
        <div className="pl-exadd">
          <Input aria-label={t('Desde')} placeholder={t('desde dd/mm/aaaa')} value={ex.from} onChange={(_e, d) => setEx({ ...ex, from: d.value })} style={{ width: 130 }} />
          <Input aria-label={t('Hasta')} placeholder={t('hasta (opcional)')} value={ex.to} onChange={(_e, d) => setEx({ ...ex, to: d.value })} style={{ width: 130 }} />
          <Input aria-label={t('Nombre de la excepción')} placeholder={t('Nombre')} value={ex.name} onChange={(_e, d) => setEx({ ...ex, name: d.value })} />
          <Input aria-label={t('Horario de la excepción')} placeholder={t('horario (vacío = no laborable)')} value={ex.hours} onChange={(_e, d) => setEx({ ...ex, hours: d.value })} />
          <Button size="small" onClick={addEx}>
            {t('Añadir')}
          </Button>
        </div>
      </fieldset>
      <p className="pl-note">{t('El calendario de una tarea fija su duración; el de un recurso reparte su trabajo y decide cuándo está sobreasignado.')}</p>
      <Err text={err} />
    </Shell>
  );
}
export function CalendarDialog({ ctl, open, onClose }: { ctl: PlanCtl; open: boolean; onClose: () => void }) {
  return (
    <StickyDialog open={open} onClose={onClose} width={760}>
      {open && <CalendarsForm ctl={ctl} onClose={onClose} />}
    </StickyDialog>
  );
}

// ---------- baselines ----------

function BaselinesForm({ ctl, onClose }: { ctl: PlanCtl; onClose: () => void }) {
  useCtl(ctl);
  const p = ctl.project;
  const nSel = ctl.selected.length;
  return (
    <Shell title={t('Líneas base')} onClose={onClose}>
      <p className="pl-note">{t('Una línea base guarda las fechas, el trabajo y el costo del plan para compararlos después. El valor ganado y las variaciones usan la que elijas aquí.')}</p>
      <table className="pl-restable" aria-label={t('Líneas base')}>
        <thead>
          <tr>
            <th>{t('Comparar con')}</th>
            <th>{t('Línea base')}</th>
            <th>{t('Guardada el')}</th>
            <th>{t('Tareas')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: BASELINES }, (_, i) => {
            const b = p.baselines[i];
            return (
              <tr key={i} data-baseline={i}>
                <td>
                  <input type="radio" name="pl-bl-show" aria-label={`${t('Comparar con')} ${t(baselineName(i))}`} checked={ctl.baselineShown === i} onChange={() => ctl.setBaselineShown(i)} />
                </td>
                <td>{t(baselineName(i))}</td>
                <td>{b ? formatTime(b.date) : '—'}</td>
                <td className="pl-usenum">{b ? Object.keys(b.tasks).length : ''}</td>
                <td className="pl-actions">
                  <Button size="small" onClick={() => ctl.saveBaseline(i)} aria-label={`${t('Guardar')} ${t(baselineName(i))}`}>
                    {t('Guardar')}
                  </Button>
                  <Button size="small" disabled={nSel === 0} onClick={() => ctl.saveBaseline(i, true)} aria-label={`${t('Guardar las tareas seleccionadas en')} ${t(baselineName(i))}`}>
                    {t('Solo las seleccionadas')}
                  </Button>
                  <Button size="small" disabled={!b} onClick={() => ctl.deleteBaseline(i)} aria-label={`${t('Borrar')} ${t(baselineName(i))}`}>
                    {t('Borrar')}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Shell>
  );
}
function useCtl(ctl: PlanCtl): void {
  // re-render when the controller changes (the dialog is outside the Gantt's subscription)
  const [, set] = useState(0);
  useSubscription(ctl, () => set((x) => x + 1));
}
function useSubscription(ctl: PlanCtl, fn: () => void) {
  useEffect(() => ctl.subscribe(fn), [ctl]); // eslint-disable-line react-hooks/exhaustive-deps
}
export function BaselinesDialog({ ctl, open, onClose }: { ctl: PlanCtl; open: boolean; onClose: () => void }) {
  return (
    <StickyDialog open={open} onClose={onClose} width={820}>
      {open && <BaselinesForm ctl={ctl} onClose={onClose} />}
    </StickyDialog>
  );
}

// ---------- split ----------

function SplitForm({ ctl, onClose }: { ctl: PlanCtl; onClose: () => void }) {
  const st = ctl.sched?.tasks[ctl.active];
  const task = ctl.activeTask!;
  const mid = st ? st.start + Math.floor((st.finish - st.start) / 2) : 0;
  const [at, setAt] = useState(st ? formatTime(mid) : '');
  const [resume, setResume] = useState(st ? formatTime(mid + 1440) : '');
  const [err, setErr] = useState('');
  const ok = () => {
    const a = parseDateTime(at, 720);
    const b = parseDateTime(resume, 480);
    if (a === null || b === null) return setErr('Escribe las fechas como 14/03/2025 o 14/03/2025 10:30.');
    const e = ctl.splitActive(a, b);
    if (e) setErr(e);
    else onClose();
  };
  return (
    <Shell title={`${t('Dividir tarea')}: ${task.name}`} onClose={onClose} actions={<OkCancel onClose={onClose} onOk={ok} />}>
      <p className="pl-note">{t('La tarea se interrumpe en la primera fecha, no se trabaja en ella hasta la segunda y se reanuda con el trabajo que le quedaba.')}</p>
      <div style={grid2}>
        <Field id="pl-s-at" label="Interrumpir el">
          <Input id="pl-s-at" value={at} onChange={(_e, d) => setAt(d.value)} autoFocus />
        </Field>
        <Field id="pl-s-resume" label="Reanudar el">
          <Input id="pl-s-resume" value={resume} onChange={(_e, d) => setResume(d.value)} />
        </Field>
      </div>
      {task.splits.length > 0 && (
        <p className="pl-note">
          {t('Divisiones actuales')}: {task.splits.map((s) => `${formatDuration(s.after, false, ctl.project)} → ${formatDuration(s.gap, false, ctl.project)}`).join(' · ')}
        </p>
      )}
      <Err text={err} />
    </Shell>
  );
}
export function SplitDialog({ ctl, open, onClose }: { ctl: PlanCtl; open: boolean; onClose: () => void }) {
  return (
    <StickyDialog open={open} onClose={onClose} width={560}>
      {open && ctl.activeTask && <SplitForm key={ctl.active} ctl={ctl} onClose={onClose} />}
    </StickyDialog>
  );
}

// ---------- resource leveling ----------

function LevelForm({ ctl, onClose }: { ctl: PlanCtl; onClose: () => void }) {
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const [slack, setSlack] = useState(false);
  const [keep, setKeep] = useState(false);
  const [err, setErr] = useState('');
  const over = new Set(ctl.sched?.overallocations.map((o) => o.resource) ?? []);
  const ok = () => {
    const ids = scope === 'selected' ? ctl.selected.map((i) => ctl.project.tasks[i]?.id).filter((x): x is string => !!x) : null;
    if (ids && !ids.length) return setErr('Selecciona alguna tarea o nivela todo el proyecto.');
    ctl.say(ctl.levelResources({ scope: ids, withinSlack: slack, keepExisting: keep }));
    onClose();
  };
  return (
    <Shell title={t('Nivelar recursos')} onClose={onClose} actions={<OkCancel onClose={onClose} onOk={ok} />}>
      <p className="pl-note">
        {over.size ? t('Recursos sobreasignados: {n}.', { n: over.size }) : t('Ningún recurso está sobreasignado ahora.')} {t('Se retrasan primero las tareas de menor prioridad y, a igual prioridad, las que empiezan más tarde. No se mueven las tareas ya iniciadas ni las programadas manualmente.')}
      </p>
      <fieldset className="pl-fieldset">
        <legend>{t('Qué tareas se pueden retrasar')}</legend>
        <label className="pl-check">
          <input type="radio" name="pl-lv-scope" checked={scope === 'all'} onChange={() => setScope('all')} /> {t('Todo el proyecto')}
        </label>
        <label className="pl-check">
          <input type="radio" name="pl-lv-scope" checked={scope === 'selected'} onChange={() => setScope('selected')} /> {t('Solo las tareas seleccionadas')}
        </label>
      </fieldset>
      <label className="pl-check">
        <input type="checkbox" checked={slack} onChange={(e) => setSlack(e.target.checked)} /> {t('Solo dentro de la holgura (no retrasa el fin del proyecto)')}
      </label>
      <label className="pl-check">
        <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> {t('Conservar los retrasos de una nivelación anterior')}
      </label>
      <Err text={err} />
    </Shell>
  );
}
export function LevelDialog({ ctl, open, onClose }: { ctl: PlanCtl; open: boolean; onClose: () => void }) {
  return (
    <StickyDialog open={open} onClose={onClose} width={560}>
      {open && <LevelForm ctl={ctl} onClose={onClose} />}
    </StickyDialog>
  );
}

// ---------- custom fields ----------

const CF_TYPES: [CustomFieldDef['type'], string][] = [['text', 'Texto'], ['number', 'Número'], ['cost', 'Costo'], ['date', 'Fecha'], ['flag', 'Sí/No'], ['duration', 'Duración'], ['list', 'Lista']];
const ROLLUPS: [NonNullable<CustomFieldDef['rollup']>, string][] = [['none', 'Ninguno'], ['sum', 'Suma'], ['max', 'Máximo'], ['min', 'Mínimo'], ['avg', 'Promedio'], ['count', 'Cuenta']];

function CustomFieldsForm({ ctl, onClose }: { ctl: PlanCtl; onClose: () => void }) {
  const [defs, setDefs] = useState<CustomFieldDef[]>(() => ctl.project.customFields.map((c) => ({ ...c })));
  const [sel, setSel] = useState(defs[0]?.id ?? '');
  const [err, setErr] = useState('');
  const d = defs.find((x) => x.id === sel);
  const edit = (patch: Partial<CustomFieldDef>) => setDefs(defs.map((x) => (x.id === sel ? { ...x, ...patch } : x)));
  const add = () => {
    const f: CustomFieldDef = { id: newId('cf'), name: `Campo ${defs.length + 1}`, target: 'task', type: 'text' };
    setDefs([...defs, f]);
    setSel(f.id);
  };
  const remove = () => {
    const rest = defs.filter((x) => x.id !== sel);
    setDefs(rest);
    setSel(rest[0]?.id ?? '');
  };
  const ok = () => {
    const names = new Set<string>();
    for (const f of defs) {
      if (!f.name.trim()) return setErr('Todos los campos necesitan un nombre.');
      const key = `${f.target}:${f.name.trim().toLowerCase()}`;
      if (names.has(key)) return setErr(`Hay dos campos llamados "${f.name}".`);
      names.add(key);
      if (f.type === 'list' && !(f.list && f.list.length)) return setErr(`El campo "${f.name}" es una lista y necesita opciones.`);
    }
    const next = { ...ctl.project, customFields: defs.map((f) => ({ ...f, name: f.name.trim() })) };
    for (const f of next.customFields) {
      if (f.formula) {
        const e = checkFormula(next, f.formula);
        if (e) return setErr(`${f.name}: ${e}`);
      }
    }
    const gone = ctl.project.customFields.filter((c) => !defs.some((x) => x.id === c.id)).map((c) => `custom:${c.id}`);
    if (gone.length) ctl.setColumns(ctl.columns.filter((c) => !gone.includes(c)));
    ctl.commit(next);
    onClose();
  };
  const check = d?.formula ? checkFormula({ ...ctl.project, customFields: defs }, d.formula) : null;
  return (
    <Shell title={t('Campos personalizados')} onClose={onClose} actions={<OkCancel onClose={onClose} onOk={ok} />}>
      <div className="pl-calbar">
        <label htmlFor="pl-cf-sel">{t('Campo')}</label>
        <select id="pl-cf-sel" className="nv-select" value={sel} onChange={(e) => setSel(e.target.value)}>
          {defs.length === 0 && <option value="">{t('(ninguno)')}</option>}
          {defs.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} ({x.target === 'task' ? t('tarea') : t('recurso')})
            </option>
          ))}
        </select>
        <Button size="small" onClick={add}>
          {t('Nuevo campo')}
        </Button>
        <Button size="small" disabled={!d} onClick={remove}>
          {t('Eliminar')}
        </Button>
      </div>
      {d && (
        <>
          <div style={grid2}>
            <Field id="pl-cf-name" label="Nombre">
              <Input id="pl-cf-name" value={d.name} onChange={(_e, v) => edit({ name: v.value })} />
            </Field>
            <Field id="pl-cf-target" label="Se aplica a">
              <select id="pl-cf-target" className="nv-select" value={d.target} onChange={(e) => edit({ target: e.target.value as 'task' | 'resource' })}>
                <option value="task">{t('Tareas')}</option>
                <option value="resource">{t('Recursos')}</option>
              </select>
            </Field>
          </div>
          <div style={grid2}>
            <Field id="pl-cf-type" label="Tipo">
              <select id="pl-cf-type" className="nv-select" value={d.type} onChange={(e) => edit({ type: e.target.value as CustomFieldDef['type'] })}>
                {CF_TYPES.map(([k, l]) => (
                  <option key={k} value={k}>
                    {t(l)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="pl-cf-roll" label="En las tareas de resumen">
              <select id="pl-cf-roll" className="nv-select" disabled={d.target !== 'task' || !['number', 'cost', 'duration'].includes(d.type)} value={d.rollup ?? 'none'} onChange={(e) => edit({ rollup: e.target.value as CustomFieldDef['rollup'] })}>
                {ROLLUPS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {t(l)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {d.type === 'list' && (
            <Field id="pl-cf-list" label="Opciones de la lista (separadas por comas)">
              <Input id="pl-cf-list" value={(d.list ?? []).join(', ')} onChange={(_e, v) => edit({ list: v.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
            </Field>
          )}
          <Field id="pl-cf-formula" label="Fórmula (opcional)">
            <Input id="pl-cf-formula" value={d.formula ?? ''} placeholder={'[Trabajo] * 2   ·   IIf([% completado] = 100, "Hecha", "Pendiente")'} onChange={(_e, v) => edit({ formula: v.value || undefined })} />
          </Field>
          {d.formula && (
            <p role="status" className={check ? 'pl-error' : 'pl-note'}>
              {check ? check : t('La fórmula es válida.')}
            </p>
          )}
          <p className="pl-note">{t('En las fórmulas las duraciones se expresan en días, el trabajo en horas y las fechas como número de día. Los nombres de campo van entre corchetes.')}</p>
        </>
      )}
      <Err text={err} />
    </Shell>
  );
}
export function CustomFieldsDialog({ ctl, open, onClose }: { ctl: PlanCtl; open: boolean; onClose: () => void }) {
  return (
    <StickyDialog open={open} onClose={onClose} width={640}>
      {open && <CustomFieldsForm ctl={ctl} onClose={onClose} />}
    </StickyDialog>
  );
}

// ---------- filters ----------

const OPS: [FilterOp, string][] = [['eq', 'es igual a'], ['ne', 'no es igual a'], ['gt', 'mayor que'], ['ge', 'mayor o igual que'], ['lt', 'menor que'], ['le', 'menor o igual que'], ['contains', 'contiene'], ['notcontains', 'no contiene'], ['startswith', 'empieza por'], ['empty', 'está vacío'], ['notempty', 'no está vacío']];

/** What the user types for a criterion value, in the units of the field (days for durations, hours for work). */
function valueText(p: Project, c: FilterCriterion): string {
  if (c.value === null || c.value === undefined) return '';
  const ty = fieldType(p, c.field);
  if (typeof c.value === 'number') {
    if (ty === 'date') return formatTime(c.value);
    if (ty === 'duration') return String(Math.round((c.value / p.minutesPerDay) * 100) / 100);
    if (ty === 'work') return String(Math.round((c.value / 60) * 100) / 100);
  }
  return String(c.value);
}
function parseValue(p: Project, field: string, text: string): FilterCriterion['value'] {
  const ty = fieldType(p, field);
  const v = text.trim();
  if (v === '') return null;
  if (ty === 'flag') return /^(s|sí|si|true|1|yes)$/i.test(v);
  if (ty === 'date') return parseDateTime(v) ?? v;
  const n = Number(v.replace(',', '.'));
  if (ty === 'duration') return Number.isFinite(n) ? Math.round(n * p.minutesPerDay) : v;
  if (ty === 'work') return Number.isFinite(n) ? Math.round(n * 60) : v;
  if (ty === 'text') return v;
  return Number.isFinite(n) ? n : v;
}

function FiltersForm({ ctl, onClose }: { ctl: PlanCtl; onClose: () => void }) {
  const [defs, setDefs] = useState<FilterDef[]>(() => ctl.project.filters.map((f) => ({ ...f, criteria: f.criteria.map((c) => ({ ...c })) })));
  const [sel, setSel] = useState(ctl.project.view.filter ?? 'all');
  const [err, setErr] = useState('');
  const p = ctl.project;
  const fields = fieldsOf(p, 'task');
  const custom = defs.find((x) => x.id === sel);
  const edit = (patch: Partial<FilterDef>) => setDefs(defs.map((x) => (x.id === sel ? { ...x, ...patch } : x)));
  const editCrit = (i: number, patch: Partial<FilterCriterion>) => edit({ criteria: custom!.criteria.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const add = () => {
    const f: FilterDef = { id: newId('fl'), name: `Filtro ${defs.length + 1}`, mode: 'and', criteria: [{ field: 'name', op: 'contains', value: '' }] };
    setDefs([...defs, f]);
    setSel(f.id);
  };
  const remove = () => {
    setDefs(defs.filter((x) => x.id !== sel));
    setSel('all');
  };
  const ok = () => {
    for (const f of defs) if (!f.name.trim()) return setErr('Todos los filtros necesitan un nombre.');
    ctl.commit({ ...p, filters: defs.map((f) => ({ ...f, name: f.name.trim() })), view: { ...p.view, filter: sel === 'all' ? null : sel } });
    onClose();
  };
  return (
    <Shell title={t('Filtros')} onClose={onClose} actions={<OkCancel onClose={onClose} onOk={ok} />}>
      <div className="pl-calbar">
        <label htmlFor="pl-fl-sel">{t('Mostrar solo')}</label>
        <select id="pl-fl-sel" className="nv-select" value={sel} onChange={(e) => setSel(e.target.value)}>
          <optgroup label={t('Filtros predefinidos')}>
            {BUILTIN_FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {t(f.name)}
              </option>
            ))}
          </optgroup>
          {defs.length > 0 && (
            <optgroup label={t('Mis filtros')}>
              {defs.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <Button size="small" onClick={add}>
          {t('Nuevo filtro')}
        </Button>
        <Button size="small" disabled={!custom} onClick={remove}>
          {t('Eliminar')}
        </Button>
      </div>
      {custom && (
        <fieldset className="pl-fieldset">
          <legend>{t('Definición del filtro')}</legend>
          <div style={grid2}>
            <Field id="pl-fl-name" label="Nombre">
              <Input id="pl-fl-name" value={custom.name} onChange={(_e, v) => edit({ name: v.value })} />
            </Field>
            <Field id="pl-fl-mode" label="Se cumplen">
              <select id="pl-fl-mode" className="nv-select" value={custom.mode} onChange={(e) => edit({ mode: e.target.value as 'and' | 'or' })}>
                <option value="and">{t('todas las condiciones')}</option>
                <option value="or">{t('alguna condición')}</option>
              </select>
            </Field>
          </div>
          {custom.criteria.map((c, i) => (
            <div key={i} className="pl-crit">
              <select className="nv-select" aria-label={`${t('Campo')} ${i + 1}`} value={c.field} onChange={(e) => editCrit(i, { field: e.target.value, value: null })}>
                {fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {t(f.label)}
                  </option>
                ))}
              </select>
              <select className="nv-select" aria-label={`${t('Operador')} ${i + 1}`} value={c.op} onChange={(e) => editCrit(i, { op: e.target.value as FilterOp })}>
                {OPS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {t(l)}
                  </option>
                ))}
              </select>
              <input className="nv-input" aria-label={`${t('Valor')} ${i + 1}`} disabled={c.op === 'empty' || c.op === 'notempty'} defaultValue={valueText(p, c)} key={`${i}${c.field}`} onBlur={(e) => editCrit(i, { value: parseValue(p, c.field, e.target.value) })} />
              <button type="button" aria-label={`${t('Quitar condición')} ${i + 1}`} onClick={() => edit({ criteria: custom.criteria.filter((_, k) => k !== i) })}>
                ✕
              </button>
            </div>
          ))}
          <Button size="small" onClick={() => edit({ criteria: [...custom.criteria, { field: 'name', op: 'contains', value: '' }] })}>
            {t('Añadir condición')}
          </Button>
          <p className="pl-note">{t('Duraciones en días, trabajo en horas, fechas como 14/03/2025, Sí/No para marcas.')}</p>
        </fieldset>
      )}
      <Err text={err} />
    </Shell>
  );
}
export function FiltersDialog({ ctl, open, onClose }: { ctl: PlanCtl; open: boolean; onClose: () => void }) {
  return (
    <StickyDialog open={open} onClose={onClose} width={720}>
      {open && <FiltersForm ctl={ctl} onClose={onClose} />}
    </StickyDialog>
  );
}

// ---------- groups ----------

/** Interval unit shown to the user for a field type, and how many internal units it is. */
function intervalUnit(p: Project, field: string): { label: string; k: number } | null {
  const ty = fieldType(p, field);
  if (ty === 'date') return { label: 'días', k: 1440 };
  if (ty === 'duration') return { label: 'días', k: p.minutesPerDay };
  if (ty === 'work') return { label: 'horas', k: 60 };
  if (ty === 'number' || ty === 'cost' || ty === 'percent') return { label: 'unidades', k: 1 };
  return null;
}

function GroupsForm({ ctl, onClose }: { ctl: PlanCtl; onClose: () => void }) {
  const p = ctl.project;
  const [defs, setDefs] = useState<GroupDef[]>(() => p.groups.map((g) => ({ ...g, levels: g.levels.map((l) => ({ ...l })) })));
  const [sel, setSel] = useState(p.view.group ?? '');
  const [err, setErr] = useState('');
  const fields = fieldsOf(p, 'task').filter((f) => f.id !== 'id');
  const g = defs.find((x) => x.id === sel);
  const edit = (patch: Partial<GroupDef>) => setDefs(defs.map((x) => (x.id === sel ? { ...x, ...patch } : x)));
  const editLevel = (i: number, patch: Partial<GroupDef['levels'][number]>) => edit({ levels: g!.levels.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
  const add = () => {
    const n: GroupDef = { id: newId('gr'), name: `Agrupación ${defs.length + 1}`, levels: [{ field: 'resources' }] };
    setDefs([...defs, n]);
    setSel(n.id);
  };
  const ok = () => {
    for (const x of defs) {
      if (!x.name.trim()) return setErr('Todas las agrupaciones necesitan un nombre.');
      if (!x.levels.length) return setErr(`La agrupación "${x.name}" necesita al menos un nivel.`);
    }
    ctl.setGroup(null);
    ctl.commit({ ...ctl.project, groups: defs.map((x) => ({ ...x, name: x.name.trim() })), view: { ...ctl.project.view, group: sel || null } });
    onClose();
  };
  return (
    <Shell title={t('Agrupaciones')} onClose={onClose} actions={<OkCancel onClose={onClose} onOk={ok} />}>
      <div className="pl-calbar">
        <label htmlFor="pl-gr-sel">{t('Agrupar por')}</label>
        <select id="pl-gr-sel" className="nv-select" value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="">{t('Sin agrupar')}</option>
          {defs.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <Button size="small" onClick={add}>
          {t('Nueva agrupación')}
        </Button>
        <Button size="small" disabled={!g} onClick={() => { setDefs(defs.filter((x) => x.id !== sel)); setSel(''); }}>
          {t('Eliminar')}
        </Button>
      </div>
      {g && (
        <fieldset className="pl-fieldset">
          <legend>{t('Definición de la agrupación')}</legend>
          <Field id="pl-gr-name" label="Nombre">
            <Input id="pl-gr-name" value={g.name} onChange={(_e, v) => edit({ name: v.value })} />
          </Field>
          {g.levels.map((l, i) => {
            const u = intervalUnit(p, l.field);
            return (
              <div key={i} className="pl-crit">
                <select className="nv-select" aria-label={`${t('Campo del nivel')} ${i + 1}`} value={l.field} onChange={(e) => editLevel(i, { field: e.target.value, interval: undefined })}>
                  {fields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {t(f.label)}
                    </option>
                  ))}
                </select>
                <label>
                  <input type="checkbox" checked={!!l.desc} onChange={(e) => editLevel(i, { desc: e.target.checked })} /> {t('Descendente')}
                </label>
                {u ? (
                  <input
                    className="nv-input pl-narrow"
                    aria-label={`${t('Intervalo del nivel')} ${i + 1} (${t(u.label)})`}
                    placeholder={`${t('intervalo')} (${t(u.label)})`}
                    defaultValue={l.interval ? l.interval / u.k : ''}
                    key={`${i}${l.field}`}
                    onBlur={(e) => {
                      const n = Number(e.target.value.replace(',', '.'));
                      editLevel(i, { interval: e.target.value.trim() && n > 0 ? n * u.k : undefined });
                    }}
                  />
                ) : (
                  <span />
                )}
                <button type="button" aria-label={`${t('Quitar nivel')} ${i + 1}`} onClick={() => edit({ levels: g.levels.filter((_, k) => k !== i) })}>
                  ✕
                </button>
              </div>
            );
          })}
          <Button size="small" onClick={() => edit({ levels: [...g.levels, { field: 'resources' }] })}>
            {t('Añadir nivel')}
          </Button>
        </fieldset>
      )}
      <Err text={err} />
    </Shell>
  );
}
export function GroupsDialog({ ctl, open, onClose }: { ctl: PlanCtl; open: boolean; onClose: () => void }) {
  return (
    <StickyDialog open={open} onClose={onClose} width={680}>
      {open && <GroupsForm ctl={ctl} onClose={onClose} />}
    </StickyDialog>
  );
}

// ---------- columns ----------

function ColumnsForm({ ctl, onClose }: { ctl: PlanCtl; onClose: () => void }) {
  const [cols, setCols] = useState([...ctl.columns]);
  const all = fieldsOf(ctl.project, 'task').filter((f) => f.id !== 'id');
  const label = (id: string) => all.find((f) => f.id === id)?.label ?? id;
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= cols.length) return;
    const c = [...cols];
    [c[i], c[j]] = [c[j]!, c[i]!];
    setCols(c);
  };
  const free = all.filter((f) => !cols.includes(f.id));
  return (
    <Shell title={t('Columnas de la tabla')} onClose={onClose} actions={<OkCancel onClose={onClose} onOk={() => { ctl.setColumns(cols); onClose(); }} disabled={cols.length === 0} />}>
      <ul className="pl-collist" aria-label={t('Columnas visibles')}>
        {cols.map((c, i) => (
          <li key={c}>
            <span>{t(label(c))}</span>
            <button type="button" aria-label={`${t('Subir')} ${t(label(c))}`} disabled={i === 0} onClick={() => move(i, -1)}>
              ↑
            </button>
            <button type="button" aria-label={`${t('Bajar')} ${t(label(c))}`} disabled={i === cols.length - 1} onClick={() => move(i, 1)}>
              ↓
            </button>
            <button type="button" aria-label={`${t('Quitar')} ${t(label(c))}`} disabled={cols.length === 1} onClick={() => setCols(cols.filter((x) => x !== c))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <Field id="pl-col-add" label="Añadir columna">
        <select id="pl-col-add" className="nv-select" value="" onChange={(e) => e.target.value && setCols([...cols, e.target.value])}>
          <option value="">{t('Elige un campo…')}</option>
          {free.map((f) => (
            <option key={f.id} value={f.id}>
              {t(f.label)}
            </option>
          ))}
        </select>
      </Field>
    </Shell>
  );
}
export function ColumnsDialog({ ctl, open, onClose }: { ctl: PlanCtl; open: boolean; onClose: () => void }) {
  return (
    <StickyDialog open={open} onClose={onClose} width={520}>
      {open && <ColumnsForm ctl={ctl} onClose={onClose} />}
    </StickyDialog>
  );
}
