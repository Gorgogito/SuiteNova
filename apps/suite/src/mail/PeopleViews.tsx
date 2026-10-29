import { t } from '@suitenova/core-ui';
import { displayName, type Contact, type LabeledValue, type TaskItem } from '@suitenova/mail-core';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { dateStr, parseLocal } from './CalendarView';
import { startOfDay, type MailCtl } from './ctl';

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const LABELS = ['trabajo', 'casa', 'móvil', 'fax', 'otro'];

function LabeledList({ title, items, onChange, kind }: { title: string; items: LabeledValue[]; onChange: (l: LabeledValue[]) => void; kind: 'email' | 'tel' }) {
  return (
    <fieldset className="ml-lv">
      <legend>{title}</legend>
      {items.map((it, i) => (
        <div key={i} className="ml-lv__row">
          <select aria-label={t('Tipo de {t} {n}', { t: title.toLowerCase(), n: i + 1 })} value={LABELS.includes(it.label) ? it.label : 'otro'} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}>
            {LABELS.map((l) => (
              <option key={l} value={l}>
                {t(l)}
              </option>
            ))}
          </select>
          <input type={kind === 'email' ? 'email' : 'tel'} aria-label={`${title} ${i + 1}`} value={it.value} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
          <button type="button" className="ml-btn" aria-label={t('Quitar {name}', { name: it.value || title })} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="ml-btn" onClick={() => onChange([...items, { label: 'trabajo', value: '' }])}>
        + {t('Agregar')}
      </button>
    </fieldset>
  );
}

function ContactForm({ ctl, c }: { ctl: MailCtl; c: Contact }) {
  const [d, setD] = useState<Contact>(c);
  useEffect(() => setD(c), [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(d) !== JSON.stringify(c);
  const set = (p: Partial<Contact>) => setD((x) => ({ ...x, ...p }));
  const field = (k: keyof Contact, label: string, type = 'text') => (
    <label key={k}>
      <span>{label}</span>
      <input type={type} aria-label={label} value={String(d[k] ?? '')} onChange={(e) => set({ [k]: e.target.value } as Partial<Contact>)} />
    </label>
  );
  return (
    <form
      className="ml-contactform"
      onSubmit={(e) => {
        e.preventDefault();
        ctl.updateContact({ ...d, name: d.name.trim() });
      }}
    >
      <h2>{displayName(d)}</h2>
      <div className="ml-grid2">
        {field('first', t('Nombre'))}
        {field('last', t('Apellidos'))}
      </div>
      {field('name', t('Nombre para mostrar'))}
      <div className="ml-grid2">
        {field('org', t('Empresa'))}
        {field('title', t('Cargo'))}
      </div>
      <LabeledList title={t('Correo electrónico')} kind="email" items={d.emails} onChange={(emails) => set({ emails })} />
      <LabeledList title={t('Teléfono')} kind="tel" items={d.phones} onChange={(phones) => set({ phones })} />
      {field('address', t('Dirección'))}
      <div className="ml-grid2">
        {field('url', t('Sitio web'))}
        {field('birthday', t('Cumpleaños'), 'date')}
      </div>
      <label>
        <span>{t('Notas')}</span>
        <textarea aria-label={t('Notas')} rows={4} value={d.note} onChange={(e) => set({ note: e.target.value })} />
      </label>
      <div className="ml-actions">
        <button type="submit" className="ml-btn ml-btn--primary" disabled={!dirty}>
          {t('Guardar contacto')}
        </button>
        <button type="button" className="ml-btn" disabled={!d.emails[0]?.value} onClick={() => ctl.newMessage(d.emails[0]!.value)}>
          {t('Nuevo correo')}
        </button>
        <button
          type="button"
          className="ml-btn"
          onClick={() => {
            if (window.confirm(t('¿Eliminar este contacto? Esta acción no se puede deshacer.'))) ctl.deleteContact(c.id);
          }}
        >
          {t('Eliminar contacto')}
        </button>
      </div>
    </form>
  );
}

export function ContactsView({ ctl }: { ctl: MailCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const q = fold(ctl.contactQuery);
  const list = useMemo(
    () =>
      ctl.data.contacts
        .filter((c) => !q || fold(`${displayName(c)} ${c.org} ${c.emails.map((e) => e.value).join(' ')} ${c.phones.map((p) => p.value).join(' ')}`).includes(q))
        .sort((a, b) => displayName(a).localeCompare(displayName(b), 'es')),
    [ctl.data.contacts, q],
  );
  const sel = ctl.data.contacts.find((c) => c.id === ctl.selectedContact) ?? null;
  return (
    <div className="ml-contacts">
      <div className="ml-contacts__list">
        <input type="search" aria-label={t('Buscar contactos')} placeholder={t('Buscar contactos')} value={ctl.contactQuery} onChange={(e) => { ctl.contactQuery = e.target.value; ctl.touch(); }} />
        <ul role="listbox" aria-label={t('Contactos')}>
          {list.length === 0 && <li className="ml-empty">{ctl.data.contacts.length ? t('Sin resultados') : t('No hay contactos. Crea uno o importa un archivo vCard o CSV.')}</li>}
          {list.map((c) => (
            <li key={c.id} role="option" aria-selected={c.id === ctl.selectedContact}>
              <button type="button" className={c.id === ctl.selectedContact ? 'is-current' : ''} onClick={() => { ctl.selectedContact = c.id; ctl.touch(); }}>
                <span className="ml-avatar" aria-hidden="true">
                  {displayName(c).slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{displayName(c)}</strong>
                  <em>{c.emails[0]?.value || c.org}</em>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="ml-contacts__detail">{sel ? <ContactForm key={sel.id} ctl={ctl} c={sel} /> : <div className="ml-empty">{t('Selecciona un contacto.')}</div>}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- tasks
function TaskForm({ ctl, t0 }: { ctl: MailCtl; t0: TaskItem }) {
  const [d, setD] = useState(t0);
  useEffect(() => setD(t0), [t0.id, t0.done]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(d) !== JSON.stringify(t0);
  return (
    <form
      className="ml-taskform"
      onSubmit={(e) => {
        e.preventDefault();
        if (d.title.trim()) ctl.updateTask({ ...d, title: d.title.trim() });
      }}
    >
      <label>
        <span>{t('Tarea')}</span>
        <input aria-label={t('Título de la tarea')} value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
      </label>
      <label>
        <span>{t('Vencimiento')}</span>
        <input type="date" aria-label={t('Fecha de vencimiento')} value={d.due === null ? '' : dateStr(d.due)} onChange={(e) => setD({ ...d, due: e.target.value ? parseLocal(e.target.value, '00:00') : null })} />
      </label>
      <label>
        <span>{t('Prioridad')}</span>
        <select aria-label={t('Prioridad')} value={d.priority} onChange={(e) => setD({ ...d, priority: e.target.value as TaskItem['priority'] })}>
          <option value="high">{t('Alta')}</option>
          <option value="normal">{t('Normal')}</option>
          <option value="low">{t('Baja')}</option>
        </select>
      </label>
      <label>
        <span>{t('Notas')}</span>
        <textarea aria-label={t('Notas')} rows={5} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} />
      </label>
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

export function TasksView({ ctl }: { ctl: MailCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const [text, setText] = useState('');
  const today = startOfDay(Date.now());
  const list = ctl.data.tasks
    .filter((x) => (ctl.taskFilter === 'all' ? true : ctl.taskFilter === 'done' ? x.done : !x.done))
    .sort((a, b) => Number(a.done) - Number(b.done) || (a.due ?? Infinity) - (b.due ?? Infinity) || a.title.localeCompare(b.title, 'es'));
  const sel = ctl.data.tasks.find((x) => x.id === ctl.selectedTask) ?? null;
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
              <input type="checkbox" aria-label={t('Completar {name}', { name: x.title })} checked={x.done} onChange={() => ctl.toggleTask(x.id)} />
              <button type="button" onClick={() => { ctl.selectedTask = x.id; ctl.touch(); }}>
                <strong>{x.title}</strong>
                {x.due !== null && <em className={!x.done && x.due < today ? 'is-late' : ''}>{new Date(x.due).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}{!x.done && x.due < today ? ` · ${t('vencida')}` : ''}</em>}
                {x.priority === 'high' && <span aria-label={t('Prioridad alta')} title={t('Prioridad alta')}>❗</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="ml-tasks__detail">{sel ? <TaskForm key={sel.id} ctl={ctl} t0={sel} /> : <div className="ml-empty">{t('Selecciona una tarea.')}</div>}</div>
    </div>
  );
}
