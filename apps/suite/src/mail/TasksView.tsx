import { t } from '@suitenova/core-ui';
import { TASK_REPEATS, isDone, isFollowed, readRepeat, writeRepeat, type MailRecord, type TaskItem } from '@suitenova/mail-core';
import { useState, useSyncExternalStore } from 'react';
import { ProofTextarea } from '../spell';
import { CategoryChips, CategoryPicker } from './CategoryViews';
import { startOfDay, type MailCtl } from './ctl';
import { dateStr, parseLocal, timeStr } from './dates';

/** What the repetition of a rule the form does not offer is called in its list. */
const OTHER = 'other';

/** The reminder a task starts with: the day it is due (or tomorrow) at nine. */
const firstReminder = (due: number | null): number => {
  const day = new Date(due ?? startOfDay(Date.now()));
  if (due === null) day.setDate(day.getDate() + 1);
  day.setHours(9, 0, 0, 0);
  return day.getTime();
};

function TaskForm({ ctl, t0 }: { ctl: MailCtl; t0: TaskItem }) {
  // a change made elsewhere (completing, an undo, a reminder dismissed) starts the form again
  const [state, setState] = useState({ of: t0, d: t0 });
  if (state.of !== t0) setState({ of: t0, d: t0 });
  const d = state.of === t0 ? state.d : t0;
  const set = (p: Partial<TaskItem>) => setState((x) => ({ ...x, d: { ...x.d, ...p } }));
  const dirty = d !== t0 && JSON.stringify(d) !== JSON.stringify(t0);
  const repeat = d.rrule ? readRepeat(d.rrule) : { choice: '', every: 1, until: '' };
  const setRepeat = (choice: string, every: number, until: string) => {
    const rrule = writeRepeat(choice, every, until);
    // one that repeats needs a date to start from
    set(rrule ? { rrule, due: d.due ?? startOfDay(Date.now()) } : { rrule: undefined, fromDone: undefined });
  };
  const save = () => {
    const out: TaskItem = { ...d, title: d.title.trim() };
    if (out.rrule && out.due === null) out.due = startOfDay(Date.now());
    for (const k of ['rrule', 'fromDone', 'remind'] as const) if (!out[k]) delete out[k];
    ctl.updateTask(out);
  };
  const every: Record<string, string> = { 'FREQ=DAILY': 'días', 'FREQ=WEEKLY': 'semanas', 'FREQ=MONTHLY': 'meses', 'FREQ=YEARLY': 'años' };
  return (
    <form
      className="ml-taskform"
      onSubmit={(e) => {
        e.preventDefault();
        if (d.title.trim()) save();
      }}
    >
      <label>
        <span>{t('Tarea')}</span>
        <input aria-label={t('Título de la tarea')} value={d.title} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label>
        <span>{t('Vencimiento')}</span>
        <input type="date" aria-label={t('Fecha de vencimiento')} value={d.due === null ? '' : dateStr(d.due)} onChange={(e) => set({ due: e.target.value ? parseLocal(e.target.value, '00:00') : null })} />
      </label>
      <label>
        <span>{t('Prioridad')}</span>
        <select aria-label={t('Prioridad')} value={d.priority} onChange={(e) => set({ priority: e.target.value as TaskItem['priority'] })}>
          <option value="high">{t('Alta')}</option>
          <option value="normal">{t('Normal')}</option>
          <option value="low">{t('Baja')}</option>
        </select>
      </label>
      <label>
        <span>{t('Repetición')}</span>
        <select aria-label={t('Repetición')} value={repeat ? repeat.choice : OTHER} onChange={(e) => e.target.value !== OTHER && setRepeat(e.target.value, repeat?.every ?? 1, repeat?.until ?? '')}>
          {TASK_REPEATS.map((r) => (
            <option key={r.rrule} value={r.rrule}>
              {t(r.label)}
            </option>
          ))}
          {!repeat && <option value={OTHER}>{t('Regla avanzada')}</option>}
        </select>
      </label>
      {!repeat && <p className="ml-hint">{t('Esta tarea tiene una regla de repetición avanzada ({rule}); se conserva si no cambias la repetición.', { rule: d.rrule! })}</p>}
      {repeat?.choice && (
        <>
          {every[repeat.choice] && (
            <label>
              <span>{t('Cada')}</span>
              <span className="ml-every">
                <input type="number" min={1} max={999} aria-label={t('Cada cuántas veces')} value={repeat.every} onChange={(e) => setRepeat(repeat.choice, Math.min(999, Math.max(1, Math.floor(Number(e.target.value)) || 1)), repeat.until)} />
                {t(every[repeat.choice]!)}
              </span>
            </label>
          )}
          <label>
            <span>{t('Hasta')}</span>
            <input type="date" aria-label={t('Repetir hasta')} value={repeat.until} onChange={(e) => setRepeat(repeat.choice, repeat.every, e.target.value)} />
          </label>
        </>
      )}
      {d.rrule && (
        <label className="ml-check">
          <input type="checkbox" checked={!!d.fromDone} onChange={(e) => set({ fromDone: e.target.checked || undefined })} /> {t('Contar la fecha siguiente desde el día en que se completa')}
        </label>
      )}
      <label className="ml-check">
        <input type="checkbox" checked={d.remind !== undefined} onChange={(e) => set({ remind: e.target.checked ? firstReminder(d.due) : undefined })} /> {t('Recordármelo')}
      </label>
      {d.remind !== undefined && (
        <div className="ml-taskform__remind">
          <input type="date" aria-label={t('Fecha del aviso')} value={dateStr(d.remind)} onChange={(e) => e.target.value && set({ remind: parseLocal(e.target.value, timeStr(d.remind!)) })} />
          <input type="time" aria-label={t('Hora del aviso')} value={timeStr(d.remind)} onChange={(e) => e.target.value && set({ remind: parseLocal(dateStr(d.remind!), e.target.value) })} />
        </div>
      )}
      <label>
        <span>{t('Notas')}</span>
        <ProofTextarea aria-label={t('Notas')} rows={5} value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
      </label>
      <CategoryPicker data={ctl.data} value={d.categories} onChange={(categories) => set({ categories })} />
      <div className="ml-actions">
        <button type="submit" className="ml-btn ml-btn--primary" disabled={!dirty || !d.title.trim()}>
          {t('Guardar tarea')}
        </button>
        <button type="button" className="ml-btn" onClick={() => ctl.deleteTask(t0.id)}>
          {t('Eliminar tarea')}
        </button>
      </div>
    </form>
  );
}

/** A message followed up, seen among the tasks. */
function FollowedMail({ ctl, m }: { ctl: MailCtl; m: MailRecord }) {
  const done = isDone(m);
  return (
    <div className="ml-taskform" role="region" aria-label={t('Mensaje con seguimiento')}>
      <h3>{m.subject || t('(sin asunto)')}</h3>
      <p>{t('De')}: {m.from || m.fromEmail || t('(sin remitente)')} · {new Date(m.date).toLocaleDateString()}</p>
      <CategoryChips data={ctl.data} names={m.categories} />
      {done ? (
        <p>✓ {t('Seguimiento completado el {date}.', { date: new Date(m.follow!.done!).toLocaleDateString() })}</p>
      ) : (
        <label>
          <span>{t('Vencimiento')}</span>
          <input type="date" aria-label={t('Fecha de vencimiento')} value={m.follow?.due != null ? dateStr(m.follow.due) : ''} onChange={(e) => ctl.followMany([m.id], e.target.value ? parseLocal(e.target.value, '00:00') : null, m.follow?.remind)} />
        </label>
      )}
      <p className="ml-hint">{m.preview}</p>
      <div className="ml-actions">
        <button
          type="button"
          className="ml-btn ml-btn--primary"
          onClick={() => {
            ctl.go('mail');
            ctl.setFolder(m.folder);
            ctl.select(m.id);
          }}
        >
          {t('Abrir el mensaje')}
        </button>
        <button type="button" className="ml-btn" onClick={() => ctl.setFlagMany([m.id], false)}>
          {t('Quitar la marca')}
        </button>
      </div>
    </div>
  );
}

/** A task, or a message followed up: both are things to do. */
interface ToDo {
  id: string;
  title: string;
  due: number | null;
  done: boolean;
  high: boolean;
  categories?: string[];
  mail?: boolean;
  repeats?: boolean;
  reminds?: boolean;
  toggle: () => void;
}

export function TasksView({ ctl }: { ctl: MailCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const [text, setText] = useState('');
  const today = startOfDay(Date.now());
  const all: ToDo[] = [
    ...ctl.data.tasks.map((x): ToDo => ({ id: x.id, title: x.title, due: x.due, done: x.done, high: x.priority === 'high', categories: x.categories, repeats: !!x.rrule, reminds: !x.done && x.remind !== undefined, toggle: () => ctl.toggleTask(x.id) })),
    ...ctl.data.messages.filter(isFollowed).map((m): ToDo => ({
      id: `mail:${m.id}`,
      title: m.subject || t('(sin asunto)'),
      due: m.follow?.due ?? null,
      done: isDone(m),
      high: m.importance === 'high',
      categories: m.categories,
      mail: true,
      // taken back, it is due when it was
      toggle: () => (isDone(m) ? ctl.followMany([m.id], m.follow!.due) : ctl.completeMany([m.id])),
    })),
  ];
  const list = all
    .filter((x) => (ctl.taskFilter === 'all' ? true : ctl.taskFilter === 'done' ? x.done : !x.done))
    .sort((a, b) => Number(a.done) - Number(b.done) || (a.due ?? Infinity) - (b.due ?? Infinity) || a.title.localeCompare(b.title, 'es'));
  const sel = ctl.data.tasks.find((x) => x.id === ctl.selectedTask) ?? null;
  const mail = ctl.selectedTask?.startsWith('mail:') ? (ctl.data.messages.find((m) => `mail:${m.id}` === ctl.selectedTask && isFollowed(m)) ?? null) : null;
  const sign = (label: string, icon: string) => (
    <span role="img" aria-label={label} title={label}>
      {icon}
    </span>
  );
  return (
    <div className="ml-tasks">
      <div className="ml-tasks__list">
        <form
          className="ml-tasks__add"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) {
              ctl.addTask(text);
              setText('');
            }
          }}
        >
          <input aria-label={t('Tarea nueva')} placeholder={t('Agregar una tarea y pulsar Intro')} value={text} onChange={(e) => setText(e.target.value)} />
        </form>
        <div role="group" className="ml-seg" aria-label={t('Filtro de tareas')}>
          {(['open', 'done', 'all'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={ctl.taskFilter === f} onClick={() => { ctl.taskFilter = f; ctl.touch(); }}>
              {f === 'open' ? t('Pendientes') : f === 'done' ? t('Completadas') : t('Todas')}
            </button>
          ))}
        </div>
        <ul aria-label={t('Tareas')}>
          {list.length === 0 && <li className="ml-empty">{t('No hay tareas aquí.')}</li>}
          {list.map((x) => (
            <li key={x.id} className={`${x.id === ctl.selectedTask ? 'is-current' : ''}${x.done ? ' is-done' : ''}`}>
              <input type="checkbox" aria-label={t('Completar {name}', { name: x.title })} checked={x.done} onChange={x.toggle} />
              <button type="button" onClick={() => { ctl.selectedTask = x.id; ctl.touch(); }}>
                <strong>
                  {x.mail && <span aria-label={t('Mensaje')} title={t('Mensaje')}>✉ </span>}
                  {x.title}
                </strong>
                <CategoryChips data={ctl.data} names={x.categories} max={2} />
                {x.due !== null && <em className={!x.done && x.due < today ? 'is-late' : ''}>{new Date(x.due).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}{!x.done && x.due < today ? ` · ${t('vencida')}` : ''}</em>}
                {x.repeats && sign(t('Se repite'), '🔁')}
                {x.reminds && sign(t('Con aviso'), '🔔')}
                {x.high && <span aria-label={t('Prioridad alta')} title={t('Prioridad alta')}>❗</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="ml-tasks__detail">{sel ? <TaskForm key={sel.id} ctl={ctl} t0={sel} /> : mail ? <FollowedMail key={mail.id} ctl={ctl} m={mail} /> : <div className="ml-empty">{t('Selecciona una tarea.')}</div>}</div>
    </div>
  );
}
