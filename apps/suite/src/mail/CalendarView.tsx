import { Button, DialogActions, DialogContent, DialogTitle } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { occurrencesBetween, type CalEvent, type Occurrence } from '@suitenova/mail-core';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { addDays, startOfDay, type MailCtl } from './ctl';
import { StickyDialog } from './StickyDialog';

const HOUR_H = 44;

const pad = (n: number) => String(n).padStart(2, '0');
export const dateStr = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const timeStr = (t: number): string => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const parseLocal = (date: string, time: string): number => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  return new Date(y!, m! - 1, d!, h ?? 0, mi ?? 0).getTime();
};

const weekStart = (t: number): number => {
  const d = new Date(startOfDay(t));
  const dow = (d.getDay() + 6) % 7; // Monday first
  return addDays(d.getTime(), -dow);
};

export function rangeOf(view: 'day' | 'week' | 'month', anchor: number): { from: number; to: number; days: number[] } {
  if (view === 'day') {
    const f = startOfDay(anchor);
    return { from: f, to: addDays(f, 1), days: [f] };
  }
  if (view === 'week') {
    const f = weekStart(anchor);
    return { from: f, to: addDays(f, 7), days: Array.from({ length: 7 }, (_, i) => addDays(f, i)) };
  }
  const first = new Date(new Date(anchor).getFullYear(), new Date(anchor).getMonth(), 1).getTime();
  const f = weekStart(first);
  return { from: f, to: addDays(f, 42), days: Array.from({ length: 42 }, (_, i) => addDays(f, i)) };
}

export function titleOf(view: 'day' | 'week' | 'month', anchor: number): string {
  const r = rangeOf(view, anchor);
  if (view === 'day') return new Date(anchor).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (view === 'month') return new Date(anchor).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const a = new Date(r.from), b = new Date(addDays(r.from, 6));
  return `${a.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${b.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

interface Placed {
  o: Occurrence;
  col: number;
  cols: number;
}

/** Lay out overlapping events of a day side by side. */
function place(os: Occurrence[]): Placed[] {
  const out: Placed[] = [];
  let group: Placed[] = [];
  let end = 0;
  const flush = () => {
    const cols = Math.max(1, ...group.map((g) => g.col + 1));
    for (const g of group) g.cols = cols;
    out.push(...group);
    group = [];
  };
  for (const o of [...os].sort((a, b) => a.start - b.start)) {
    if (group.length && o.start >= end) flush();
    const used = new Set(group.filter((g) => g.o.end > o.start).map((g) => g.col));
    let col = 0;
    while (used.has(col)) col++;
    group.push({ o, col, cols: 1 });
    end = Math.max(end, o.end);
  }
  flush();
  return out;
}

const REPEATS: [string, string][] = [
  ['', 'No se repite'],
  ['FREQ=DAILY', 'Todos los días'],
  ['FREQ=WEEKLY', 'Todas las semanas'],
  ['FREQ=MONTHLY', 'Todos los meses'],
  ['FREQ=YEARLY', 'Todos los años'],
];
const REMINDERS: [string, string][] = [
  ['', 'Sin recordatorio'],
  ['0', 'Al comenzar'],
  ['5', '5 minutos antes'],
  ['15', '15 minutos antes'],
  ['60', '1 hora antes'],
  ['1440', '1 día antes'],
];

/** The content of the event dialog (shown inside a StickyDialog). */
export function EventBody({ ctl, ev, occurrence, isNew, onClose }: { ctl: MailCtl; ev: CalEvent; occurrence?: number; isNew: boolean; onClose: () => void }) {
  const [e, setE] = useState<CalEvent>(ev);
  const [rep, setRep] = useState(ev.rrule.split(';').find((x) => x.startsWith('FREQ='))?.length ? `FREQ=${/FREQ=(\w+)/.exec(ev.rrule)?.[1]}` : '');
  const [until, setUntil] = useState(() => {
    const m = /UNTIL=(\d{4})(\d{2})(\d{2})/.exec(ev.rrule);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  });
  const [err, setErr] = useState<string | null>(null);
  const customRule = !!ev.rrule && !/^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;UNTIL=\d{8}(T\d{6}Z)?)?$/.test(ev.rrule);
  const set = (p: Partial<CalEvent>) => setE((x) => ({ ...x, ...p }));

  const save = () => {
    if (!e.title.trim()) return setErr(t('Escribe un título.'));
    if (e.end < e.start) return setErr(t('El evento no puede terminar antes de empezar.'));
    const rrule = customRule && rep === `FREQ=${/FREQ=(\w+)/.exec(ev.rrule)?.[1]}` ? ev.rrule : rep ? rep + (until ? `;UNTIL=${until.replace(/-/g, '')}` : '') : '';
    const out = { ...e, title: e.title.trim(), rrule };
    if (isNew) ctl.addEvent(out);
    else ctl.updateEvent(out);
    onClose();
  };

  return (
    <>
          <DialogTitle>{isNew ? t('Evento nuevo') : t('Evento')}</DialogTitle>
          <DialogContent>
            <div className="ml-form">
              <label>
                <span>{t('Título')}</span>
                <input aria-label={t('Título')} value={e.title} onChange={(x) => set({ title: x.target.value })} autoFocus />
              </label>
              <label>
                <span>{t('Lugar')}</span>
                <input aria-label={t('Lugar')} value={e.location} onChange={(x) => set({ location: x.target.value })} />
              </label>
              <label className="ml-check">
                <input
                  type="checkbox"
                  checked={e.allDay}
                  onChange={(x) => {
                    const all = x.target.checked;
                    set(all ? { allDay: true, start: startOfDay(e.start), end: Math.max(addDays(startOfDay(e.start), 1), startOfDay(e.end) + (e.end > startOfDay(e.end) ? 86400000 : 0)) } : { allDay: false, start: startOfDay(e.start) + 9 * 3600000, end: startOfDay(e.start) + 10 * 3600000 });
                  }}
                />{' '}
                {t('Todo el día')}
              </label>
              <div className="ml-row">
                <label>
                  <span>{t('Inicio')}</span>
                  <input type="date" aria-label={t('Fecha de inicio')} value={dateStr(e.start)} onChange={(x) => x.target.value && set({ start: parseLocal(x.target.value, e.allDay ? '00:00' : timeStr(e.start)), end: e.end + (parseLocal(x.target.value, e.allDay ? '00:00' : timeStr(e.start)) - e.start) })} />
                </label>
                {!e.allDay && <input type="time" aria-label={t('Hora de inicio')} value={timeStr(e.start)} onChange={(x) => x.target.value && set({ start: parseLocal(dateStr(e.start), x.target.value), end: e.end + (parseLocal(dateStr(e.start), x.target.value) - e.start) })} />}
              </div>
              <div className="ml-row">
                <label>
                  <span>{t('Fin')}</span>
                  <input
                    type="date"
                    aria-label={t('Fecha de fin')}
                    value={dateStr(e.allDay ? e.end - 86400000 : e.end)}
                    onChange={(x) => x.target.value && set({ end: e.allDay ? addDays(parseLocal(x.target.value, '00:00'), 1) : parseLocal(x.target.value, timeStr(e.end)) })}
                  />
                </label>
                {!e.allDay && <input type="time" aria-label={t('Hora de fin')} value={timeStr(e.end)} onChange={(x) => x.target.value && set({ end: parseLocal(dateStr(e.end), x.target.value) })} />}
              </div>
              <label>
                <span>{t('Repetición')}</span>
                <select aria-label={t('Repetición')} value={rep} onChange={(x) => setRep(x.target.value)}>
                  {REPEATS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {t(l)}
                    </option>
                  ))}
                </select>
              </label>
              {rep && (
                <label>
                  <span>{t('Hasta')}</span>
                  <input type="date" aria-label={t('Repetir hasta')} value={until} onChange={(x) => setUntil(x.target.value)} />
                </label>
              )}
              {customRule && <div className="ml-remote">{t('Este evento tiene una regla de repetición avanzada ({rule}); se conserva si no cambias la repetición.', { rule: ev.rrule })}</div>}
              <label>
                <span>{t('Recordatorio')}</span>
                <select aria-label={t('Recordatorio')} value={e.reminder === null ? '' : String(e.reminder)} onChange={(x) => set({ reminder: x.target.value === '' ? null : Number(x.target.value) })}>
                  {REMINDERS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {t(l)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t('Descripción')}</span>
                <textarea aria-label={t('Descripción')} rows={4} value={e.description} onChange={(x) => set({ description: x.target.value })} />
              </label>
              {err && (
                <div className="ml-error" role="alert">
                  {err}
                </div>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            {!isNew && (
              <Button
                onClick={() => {
                  if (!window.confirm(t('¿Eliminar este evento? Esta acción no se puede deshacer.'))) return;
                  ctl.deleteEvent(ev.id);
                  onClose();
                }}
              >
                {ev.rrule ? t('Eliminar la serie') : t('Eliminar')}
              </Button>
            )}
            {!isNew && ev.rrule && occurrence !== undefined && (
              <Button
                onClick={() => {
                  ctl.updateEvent({ ...ev, exdates: [...ev.exdates, occurrence] });
                  onClose();
                }}
              >
                {t('Eliminar solo esta repetición')}
              </Button>
            )}
            <Button onClick={onClose}>{t('Cancelar')}</Button>
            <Button appearance="primary" onClick={save}>
              {t('Guardar')}
            </Button>
          </DialogActions>
    </>
  );
}

export function CalendarView({ ctl }: { ctl: MailCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const [dlg, setDlg] = useState<{ ev: CalEvent; occ?: number; isNew: boolean } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const { from, to, days } = rangeOf(ctl.calView, ctl.anchor);
  const occ = useMemo(() => occurrencesBetween(ctl.data.events, from, to), [ctl.data.events, from, to]);
  const today = startOfDay(Date.now());

  useEffect(() => {
    if (scroller.current && ctl.calView !== 'month') scroller.current.scrollTop = 7.5 * HOUR_H;
  }, [ctl.calView]);

  const open = (o: Occurrence) => {
    ctl.selectedEvent = o.event.id;
    setDlg({ ev: o.event, occ: o.start, isNew: false });
  };
  const dayName = (d: number) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });

  return (
    <div className="ml-cal" data-view={ctl.calView}>
      <div className="ml-cal__bar" role="toolbar" aria-label={t('Calendario')}>
        <button type="button" className="ml-btn" onClick={() => ctl.setAnchor(Date.now())}>
          {t('Hoy')}
        </button>
        <button type="button" className="ml-btn" aria-label={t('Anterior')} onClick={() => ctl.setAnchor(ctl.calView === 'month' ? new Date(new Date(ctl.anchor).getFullYear(), new Date(ctl.anchor).getMonth() - 1, 1).getTime() : addDays(ctl.anchor, ctl.calView === 'week' ? -7 : -1))}>
          ◀
        </button>
        <button type="button" className="ml-btn" aria-label={t('Siguiente')} onClick={() => ctl.setAnchor(ctl.calView === 'month' ? new Date(new Date(ctl.anchor).getFullYear(), new Date(ctl.anchor).getMonth() + 1, 1).getTime() : addDays(ctl.anchor, ctl.calView === 'week' ? 7 : 1))}>
          ▶
        </button>
        <h2 aria-live="polite">{titleOf(ctl.calView, ctl.anchor)}</h2>
        <div role="group" className="ml-seg" aria-label={t('Vista del calendario')}>
          {(['day', 'week', 'month'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={ctl.calView === v} onClick={() => { ctl.calView = v; ctl.touch(); }}>
              {v === 'day' ? t('Día') : v === 'week' ? t('Semana') : t('Mes')}
            </button>
          ))}
        </div>
      </div>

      {ctl.calView === 'month' ? (
        <div className="ml-month" role="grid" aria-label={titleOf('month', ctl.anchor)}>
          {days.slice(0, 7).map((d) => (
            <div key={d} className="ml-month__dow" role="columnheader">
              {new Date(d).toLocaleDateString(undefined, { weekday: 'short' })}
            </div>
          ))}
          {days.map((d) => {
            const list = occ.filter((o) => o.start < addDays(d, 1) && Math.max(o.end, o.start + 1) > d);
            const other = new Date(d).getMonth() !== new Date(ctl.anchor).getMonth();
            return (
              <div
                key={d}
                role="gridcell"
                className={`ml-month__cell${other ? ' is-other' : ''}${d === today ? ' is-today' : ''}`}
                onDoubleClick={() => setDlg({ ev: ctl.newEventAt(d + 9 * 3600000), isNew: true })}
              >
                <span className="ml-month__n">{new Date(d).getDate()}</span>
                {list.slice(0, 3).map((o) => (
                  <button key={o.event.id + o.start} type="button" className={`ml-ev${o.event.allDay ? ' is-allday' : ''}`} onClick={() => open(o)} title={o.event.title}>
                    {!o.event.allDay && <b>{timeStr(o.start)}</b>} {o.event.title}
                  </button>
                ))}
                {list.length > 3 && (
                  <button type="button" className="ml-more" onClick={() => { ctl.calView = 'day'; ctl.anchor = d; ctl.touch(); }}>
                    +{list.length - 3} {t('más')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="ml-week">
          <div className="ml-week__head" style={{ gridTemplateColumns: `52px repeat(${days.length}, 1fr)` }}>
            <div />
            {days.map((d) => (
              <div key={d} className={`ml-week__day${d === today ? ' is-today' : ''}`} role="columnheader">
                {dayName(d)}
              </div>
            ))}
          </div>
          <div className="ml-week__allday" style={{ gridTemplateColumns: `52px repeat(${days.length}, 1fr)` }}>
            <div className="ml-week__label">{t('Todo el día')}</div>
            {days.map((d) => (
              <div key={d} onDoubleClick={() => setDlg({ ev: ctl.newEventAt(d, true), isNew: true })}>
                {occ
                  .filter((o) => o.event.allDay && o.start < addDays(d, 1) && o.end > d)
                  .map((o) => (
                    <button key={o.event.id + o.start} type="button" className="ml-ev is-allday" onClick={() => open(o)}>
                      {o.event.title}
                    </button>
                  ))}
              </div>
            ))}
          </div>
          <div className="ml-week__scroll" ref={scroller}>
            <div className="ml-week__grid" style={{ gridTemplateColumns: `52px repeat(${days.length}, 1fr)`, height: 24 * HOUR_H }}>
              <div className="ml-week__hours">
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} style={{ height: HOUR_H }}>
                    {pad(h)}:00
                  </div>
                ))}
              </div>
              {days.map((d) => {
                const dayOcc = occ.filter((o) => !o.event.allDay && o.start < addDays(d, 1) && o.end > d).map((o) => ({ ...o, start: Math.max(o.start, d), end: Math.min(o.end, addDays(d, 1)) }));
                const placed = place(dayOcc);
                return (
                  <div
                    key={d}
                    className={`ml-week__col${d === today ? ' is-today' : ''}`}
                    role="gridcell"
                    aria-label={dayName(d)}
                    onDoubleClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      const mins = Math.floor(((e.clientY - r.top) / HOUR_H) * 2) * 30;
                      setDlg({ ev: ctl.newEventAt(d + mins * 60000), isNew: true });
                    }}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <div key={h} className="ml-week__slot" style={{ height: HOUR_H }} />
                    ))}
                    {placed.map((p) => {
                      const top = ((p.o.start - d) / 3600000) * HOUR_H;
                      const height = Math.max(18, ((p.o.end - p.o.start) / 3600000) * HOUR_H - 2);
                      return (
                        <button
                          key={p.o.event.id + p.o.start}
                          type="button"
                          className="ml-ev ml-ev--block"
                          style={{ top, height, left: `${(p.col / p.cols) * 100}%`, width: `${100 / p.cols - 1}%` }}
                          onClick={() => open({ ...p.o, start: occ.find((x) => x.event.id === p.o.event.id && x.start <= p.o.start && x.end >= p.o.end)?.start ?? p.o.start })}
                          title={`${timeStr(p.o.start)}–${timeStr(p.o.end)} ${p.o.event.title}`}
                        >
                          <b>{timeStr(p.o.start)}</b> {p.o.event.title}
                          {p.o.event.location && <i> · {p.o.event.location}</i>}
                        </button>
                      );
                    })}
                    {d === today && <div className="ml-now" style={{ top: ((Date.now() - d) / 3600000) * HOUR_H }} />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <StickyDialog open={dlg !== null} onClose={() => setDlg(null)}>
        {dlg && <EventBody key={dlg.ev.id + String(dlg.occ ?? '')} ctl={ctl} ev={dlg.ev} occurrence={dlg.occ} isNew={dlg.isNew} onClose={() => setDlg(null)} />}
      </StickyDialog>
      <NewEventHook ctl={ctl} open={(ev) => setDlg({ ev, isNew: true })} />
    </div>
  );
}

/** Lets ribbon commands open the new-event dialog of the mounted calendar. */
function NewEventHook({ ctl, open }: { ctl: MailCtl; open: (ev: CalEvent) => void }) {
  useEffect(() => {
    const h = () => {
      const base = ctl.calView === 'month' ? startOfDay(Date.now()) : startOfDay(ctl.anchor);
      open(ctl.newEventAt(base + 9 * 3600000));
    };
    window.addEventListener('nova:new-event', h);
    return () => window.removeEventListener('nova:new-event', h);
  }, [ctl, open]);
  return null;
}
