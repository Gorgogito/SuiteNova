import { t } from '@suitenova/core-ui';
import { CATEGORY_COLORS, attendeeOf, calendarHex, calendarOf, calendarsOf, categoryHex, occurrencesBetween, visibleEvents, type CalEvent, type CalendarInfo, type Occurrence } from '@suitenova/mail-core';
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { AGENDA_DAYS, rangeOf, step, titleOf } from './calendar-range';
import type { MailUI } from './commands';
import type { MenuItem } from './ContextMenu';
import { addDays, startOfDay, type CalView, type MailCtl } from './ctl';
import { timeStr } from './dates';
import { EventBody } from './EventDialog';
import { StickyDialog } from './StickyDialog';

const HOUR_H = 44;
/** Minutes a dragged appointment jumps by. */
const SNAP = 15;
const VIEWS: { id: CalView; label: string }[] = [
  { id: 'day', label: 'Día' },
  { id: 'workweek', label: 'Semana laboral' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mes' },
  { id: 'agenda', label: 'Agenda' },
];

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

/** What names an occurrence while it is moved about. */
const keyOf = (o: Occurrence): string => `${o.event.id}:${o.original ?? ''}`;

interface Dragged {
  key: string;
  start: number;
  end: number;
}

/** The list of calendars beside the view: which are shown, their colours and what can be done with each. */
function CalendarList({ ctl, ui }: { ctl: MailCtl; ui: MailUI }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('green');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [err, setErr] = useState('');
  const all = calendarsOf(ctl.data);
  const attempt = (run: () => void): boolean => {
    try {
      run();
      setErr('');
      return true;
    } catch (e) {
      setErr(t((e as Error).message));
      return false;
    }
  };
  const menu = (c: CalendarInfo): MenuItem[] => [
    { label: t('Cambiar nombre'), run: () => setRenaming({ id: c.id, name: t(c.name) }) },
    { label: t('Color'), sub: CATEGORY_COLORS.map((x) => ({ label: t(x.label), color: x.hex, checked: c.color === x.id, run: () => ctl.calendar.edit(c.id, { color: x.id }) })) },
    { label: t('Mostrar solo este'), run: () => all.forEach((x) => ctl.calendar.edit(x.id, { hidden: x.id !== c.id })) },
    'separator',
    {
      label: t('Importar .ics en este calendario…'),
      run: () => {
        ctl.calendar.importInto = c.id;
        ui.importFiles('ics');
      },
    },
    { label: t('Exportar este calendario (.ics)…'), run: () => void ui.exportOneCalendar(c.id) },
    'separator',
    {
      label: t('Eliminar el calendario'),
      disabled: c.id === 'cal',
      run: () => {
        const n = ctl.data.events.filter((e) => e.calendar === c.id).length;
        if (window.confirm(t('¿Eliminar el calendario «{name}» y sus {n} citas? No se puede deshacer.', { name: c.name, n }))) ctl.calendar.remove(c.id);
      },
    },
  ];
  const finish = () => {
    if (!renaming) return;
    const c = all.find((x) => x.id === renaming.id);
    if (!c || renaming.name === t(c.name) || attempt(() => ctl.calendar.edit(c.id, { name: renaming.name }))) setRenaming(null);
  };
  return (
    <aside className="ml-cals nv-panel" aria-label={t('Calendarios')}>
      <h3>{t('Calendarios')}</h3>
      <ul>
        {all.map((c) => (
          <li key={c.id}>
            {renaming?.id === c.id ? (
              <input
                autoFocus
                aria-label={t('Nombre nuevo del calendario')}
                value={renaming.name}
                onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                onBlur={finish}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') finish();
                  else if (e.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <label>
                <input type="checkbox" checked={!c.hidden} onChange={(e) => ctl.calendar.edit(c.id, { hidden: !e.target.checked })} />
                <i className="ml-swatch" style={{ background: calendarHex(c) }} aria-hidden="true" />
                <span>{t(c.name)}</span>
              </label>
            )}
            <button
              type="button"
              aria-haspopup="menu"
              aria-label={t('Opciones del calendario {name}', { name: t(c.name) })}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                ui.showMenu({ x: r.left, y: r.bottom + 2, label: t('Calendario {name}', { name: t(c.name) }), items: menu(c) });
              }}
            >
              ⋯
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (attempt(() => ctl.calendar.add(name, color))) {
              setName('');
              setAdding(false);
            }
          }}
        >
          <input autoFocus aria-label={t('Nombre del calendario')} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
          <select aria-label={t('Color del calendario')} value={color} onChange={(e) => setColor(e.target.value)}>
            {CATEGORY_COLORS.map((x) => (
              <option key={x.id} value={x.id}>
                {t(x.label)}
              </option>
            ))}
          </select>
          <div>
            <button type="submit" className="ml-btn" disabled={!name.trim()}>
              {t('Crear')}
            </button>
            <button type="button" className="ml-btn" onClick={() => (setAdding(false), setErr(''))}>
              {t('Cancelar')}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="ml-addfolder" onClick={() => setAdding(true)}>
          + {t('Calendario nuevo')}
        </button>
      )}
      {err && (
        <span className="ml-error" role="alert">
          {err}
        </span>
      )}
    </aside>
  );
}

export function CalendarView({ ctl, ui }: { ctl: MailCtl; ui: MailUI }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const [dlg, setDlg] = useState<{ ev: CalEvent; occ?: number; isNew: boolean; meeting?: boolean } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const view = ctl.calView;
  const { from, to, days } = rangeOf(view, ctl.anchor);
  const occ = occurrencesBetween(visibleEvents(ctl.data), from, to);
  const [drag, setDrag] = useState<Dragged | null>(null);
  /** A drag ends with a click on what was dragged: it does not open it. */
  const dragged = useRef(false);
  /** The appointment to give the focus back to after the keyboard moved it. */
  const refocus = useRef<string | null>(null);
  /** A meeting already sent that was moved: the others do not know yet. */
  const [moved, setMoved] = useState<{ id: string; at?: number } | null>(null);
  const [problem, setProblem] = useState('');
  const shown = drag ? occ.map((o) => (keyOf(o) === drag.key ? { ...o, start: drag.start, end: drag.end } : o)) : occ;
  const today = startOfDay(Date.now());
  const own = ctl.ownAddresses();

  useEffect(() => {
    if (scroller.current && view !== 'month' && view !== 'agenda') scroller.current.scrollTop = 7.5 * HOUR_H;
  }, [view]);
  useEffect(() => {
    if (!refocus.current) return;
    root.current?.querySelector<HTMLElement>(`[data-ev="${CSS.escape(refocus.current)}"]`)?.focus();
    refocus.current = null;
  });

  const open = (o: Occurrence) => {
    if (dragged.current) return;
    ctl.selectedEvent = o.event.id;
    const series = ctl.calendar.find(o.event.id)!;
    setDlg({ ev: series, occ: o.original ?? o.start, isNew: false });
  };

  const apply = (o: Occurrence, start: number, end: number) => {
    if (start === o.start && end === o.end) return;
    ctl.calendar.move(o.event.id, o.original, start - o.start, end - o.end);
    if (o.event.attendees?.length && o.event.sent !== undefined) setMoved({ id: o.event.id, at: o.original });
  };

  /** Follows the pointer from an appointment: to move it, or to stretch it by its lower edge. */
  const begin = (down: ReactPointerEvent, o: Occurrence, mode: 'move' | 'resize') => {
    if (down.button !== 0 || !ctl.calendar.editable(o.event)) return;
    down.stopPropagation();
    const x0 = down.clientX;
    const y0 = down.clientY;
    const dayAt = (x: number, y: number): number | null => {
      for (const el of document.elementsFromPoint(x, y)) {
        const d = (el as HTMLElement).dataset?.day;
        if (d) return Number(d);
      }
      return null;
    };
    const fromDay = dayAt(x0, y0);
    const timed = !o.event.allDay && view !== 'month';
    let now: Dragged | null = null;
    const move = (e: PointerEvent) => {
      if (!now && Math.hypot(e.clientX - x0, e.clientY - y0) < 5) return;
      const over = dayAt(e.clientX, e.clientY);
      const byDays = over !== null && fromDay !== null ? Math.round((over - fromDay) / 86400000) : 0;
      const minutes = timed ? Math.round((((e.clientY - y0) / HOUR_H) * 60) / SNAP) * SNAP : 0;
      if (mode === 'resize') now = { key: keyOf(o), start: o.start, end: Math.max(o.start + SNAP * 60000, o.end + minutes * 60000) };
      else {
        const start = addDays(o.start, byDays) + minutes * 60000;
        now = { key: keyOf(o), start, end: start + (o.end - o.start) };
      }
      setDrag(now);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key, true);
      if (now) {
        dragged.current = true;
        setTimeout(() => (dragged.current = false), 0);
      }
      setDrag(null);
    };
    const up = () => {
      const end = now;
      stop();
      if (end) apply(o, end.start, end.end);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      stop();
      now = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key, true);
  };

  /** Ctrl with the arrows moves an appointment; with Shift too, it stretches it. */
  const keys = (e: ReactKeyboardEvent, o: Occurrence) => {
    if (!(e.ctrlKey || e.metaKey) || !e.key.startsWith('Arrow') || !ctl.calendar.editable(o.event) || view === 'agenda') return;
    e.preventDefault();
    e.stopPropagation();
    const timed = !o.event.allDay && view !== 'month';
    const across = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    const down = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    const minutes = timed ? down * SNAP * 60000 : 0;
    const byDays = across + (view === 'month' ? down * 7 : 0);
    refocus.current = keyOf(o);
    if (e.shiftKey) {
      const end = timed ? o.end + minutes : addDays(o.end, byDays);
      apply(o, o.start, Math.max(o.start + (timed ? SNAP * 60000 : 86400000), end));
    } else {
      const start = addDays(o.start, byDays) + minutes;
      apply(o, start, start + (o.end - o.start));
    }
  };

  const dayName = (d: number) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
  const look = (e: CalEvent): { className: string; style: CSSProperties } => {
    // the calendar gives the colour; the first category, a band of its own
    const category = e.categories?.[0];
    const style: CSSProperties = { ['--ev' as string]: calendarHex(calendarOf(ctl.data, e)), ...(category ? { boxShadow: `inset 4px 0 0 ${categoryHex(ctl.data, category)}`, paddingInlineStart: 8 } : {}) };
    const answer = attendeeOf(e, own)?.status;
    return { className: `ml-ev${e.cancelled ? ' is-cancelled' : ''}${answer === 'tentative' || answer === 'needs-action' ? ' is-tentative' : ''}`, style };
  };
  const props = (o: Occurrence, extra = '', more: CSSProperties = {}) => {
    const l = look(o.event);
    return {
      type: 'button' as const,
      'data-ev': keyOf(o),
      className: `${l.className} ${extra}${drag?.key === keyOf(o) ? ' is-dragging' : ''}`,
      style: { ...more, ...l.style },
      onClick: () => open(o),
      onKeyDown: (e: ReactKeyboardEvent) => keys(e, o),
      onPointerDown: (e: ReactPointerEvent) => begin(e, o, 'move'),
      onDoubleClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
    };
  };
  const meetingName = moved ? ctl.calendar.find(moved.id)?.title : undefined;

  return (
    <div className="ml-cal" data-view={view} ref={root}>
      <CalendarList ctl={ctl} ui={ui} />
      <div className="ml-cal__main">
        <div className="ml-cal__bar" role="toolbar" aria-label={t('Calendario')}>
          <button type="button" className="ml-btn" onClick={() => ctl.setAnchor(Date.now())}>
            {t('Hoy')}
          </button>
          <button type="button" className="ml-btn" aria-label={t('Anterior')} onClick={() => ctl.setAnchor(step(view, ctl.anchor, -1))}>
            ◀
          </button>
          <button type="button" className="ml-btn" aria-label={t('Siguiente')} onClick={() => ctl.setAnchor(step(view, ctl.anchor, 1))}>
            ▶
          </button>
          <h2 aria-live="polite">{titleOf(view, ctl.anchor)}</h2>
          <div role="group" className="ml-seg" aria-label={t('Vista del calendario')}>
            {VIEWS.map((v) => (
              <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => ctl.setCalView(v.id)}>
                {t(v.label)}
              </button>
            ))}
          </div>
        </div>
        {moved && meetingName !== undefined && (
          <div className="ml-moved" role="status">
            <span>{t('Has cambiado la hora de «{title}»: los invitados todavía no lo saben.', { title: meetingName })}</span>
            <button
              type="button"
              className="ml-btn ml-btn--primary"
              disabled={!ctl.calendar.canInvite}
              onClick={() => {
                try {
                  ctl.calendar.invite(moved.id, moved.at);
                  setMoved(null);
                  setProblem('');
                } catch (e) {
                  setProblem(t((e as Error).message));
                }
              }}
            >
              {t('Enviar la actualización')}
            </button>
            <button type="button" className="ml-btn" onClick={() => setMoved(null)}>
              {t('Ahora no')}
            </button>
            {problem && <span role="alert">{problem}</span>}
          </div>
        )}

        {view === 'agenda' ? (
          <div className="ml-agenda" role="region" aria-label={t('Agenda')}>
            {occ.length === 0 && <div className="ml-empty">{t('No hay citas en estos {n} días.', { n: AGENDA_DAYS })}</div>}
            {days.map((d) => {
              const list = occ.filter((o) => o.start < addDays(d, 1) && Math.max(o.end, o.start + 1) > d);
              if (!list.length) return null;
              return (
                <section key={d}>
                  <h3 className={d === today ? 'is-today' : ''}>{new Date(d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
                  <ul>
                    {list.map((o) => {
                      const l = look(o.event);
                      return (
                        <li key={keyOf(o)}>
                          <button type="button" className={`${l.className} ml-agenda__item`} style={l.style} onClick={() => open(o)}>
                            <span className="ml-agenda__time">{o.event.allDay ? t('Todo el día') : `${timeStr(Math.max(o.start, d))} – ${timeStr(Math.min(o.end, addDays(d, 1)))}`}</span>
                            <strong>{o.event.title}</strong>
                            <span>{o.event.location}</span>
                            <em>{t(calendarOf(ctl.data, o.event).name)}</em>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        ) : view === 'month' ? (
          <div className="ml-month" role="grid" aria-label={titleOf('month', ctl.anchor)}>
            {days.slice(0, 7).map((d) => (
              <div key={d} className="ml-month__dow" role="columnheader">
                {new Date(d).toLocaleDateString(undefined, { weekday: 'short' })}
              </div>
            ))}
            {days.map((d) => {
              const list = shown.filter((o) => o.start < addDays(d, 1) && Math.max(o.end, o.start + 1) > d);
              const other = new Date(d).getMonth() !== new Date(ctl.anchor).getMonth();
              return (
                <div key={d} role="gridcell" data-day={d} className={`ml-month__cell${other ? ' is-other' : ''}${d === today ? ' is-today' : ''}`} onDoubleClick={() => setDlg({ ev: ctl.newEventAt(d + 9 * 3600000), isNew: true })}>
                  <span className="ml-month__n">{new Date(d).getDate()}</span>
                  {list.slice(0, 3).map((o) => (
                    <button key={keyOf(o)} {...props(o, o.event.allDay ? 'is-allday' : '')} title={o.event.title}>
                      {!o.event.allDay && <b>{timeStr(o.start)}</b>} {o.event.title}
                    </button>
                  ))}
                  {list.length > 3 && (
                    <button
                      type="button"
                      className="ml-more"
                      onClick={() => {
                        ctl.anchor = d;
                        ctl.setCalView('day');
                      }}
                    >
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
                <div key={d} data-day={d} onDoubleClick={() => setDlg({ ev: ctl.newEventAt(d, true), isNew: true })}>
                  {shown
                    .filter((o) => o.event.allDay && o.start < addDays(d, 1) && o.end > d)
                    .map((o) => (
                      <button key={keyOf(o)} {...props(o, 'is-allday')}>
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
                      {String(h).padStart(2, '0')}:00
                    </div>
                  ))}
                </div>
                {days.map((d) => {
                  const of = shown.filter((o) => !o.event.allDay && o.start < addDays(d, 1) && o.end > d);
                  // each day shows its part of what spans several
                  const placed = place(of.map((o) => ({ ...o, start: Math.max(o.start, d), end: Math.min(o.end, addDays(d, 1)) })));
                  return (
                    <div
                      key={d}
                      data-day={d}
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
                        const whole = of.find((o) => keyOf(o) === keyOf(p.o))!;
                        const top = ((p.o.start - d) / 3600000) * HOUR_H;
                        const height = Math.max(18, ((p.o.end - p.o.start) / 3600000) * HOUR_H - 2);
                        // dragging and keys act on the whole appointment, not on the part of this day
                        const real = drag ? (occ.find((o) => keyOf(o) === keyOf(whole)) ?? whole) : whole;
                        return (
                          <button key={keyOf(whole)} {...props(real, 'ml-ev--block', { top, height, left: `${(p.col / p.cols) * 100}%`, width: `${100 / p.cols - 1}%` })} title={`${timeStr(whole.start)}–${timeStr(whole.end)} ${whole.event.title}`}>
                            <b>{timeStr(p.o.start)}</b> {p.o.event.title}
                            {p.o.event.location && <i> · {p.o.event.location}</i>}
                            {ctl.calendar.editable(whole.event) && whole.end <= addDays(d, 1) && <span className="ml-ev__resize" aria-hidden="true" onPointerDown={(e) => begin(e, real, 'resize')} />}
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
      </div>
      <StickyDialog open={dlg !== null} onClose={() => setDlg(null)} width={640}>
        {dlg && <EventBody key={dlg.ev.id + String(dlg.occ ?? '')} ctl={ctl} ev={dlg.ev} occurrence={dlg.occ} isNew={dlg.isNew} meeting={dlg.meeting} onSaveEml={(raw, name) => void ui.saveEml(raw, name)} onClose={() => setDlg(null)} />}
      </StickyDialog>
      <NewEventHook ctl={ctl} open={(ev, meeting) => setDlg({ ev, isNew: true, meeting })} />
    </div>
  );
}

/** Lets ribbon commands open the new-event dialog of the mounted calendar. */
function NewEventHook({ ctl, open }: { ctl: MailCtl; open: (ev: CalEvent, meeting: boolean) => void }) {
  useEffect(() => {
    const h = (e: Event) => {
      const base = ctl.calView === 'month' ? startOfDay(Date.now()) : startOfDay(ctl.anchor);
      open(ctl.newEventAt(base + 9 * 3600000), !!(e as CustomEvent<{ meeting?: boolean }>).detail?.meeting);
    };
    window.addEventListener('nova:new-event', h);
    return () => window.removeEventListener('nova:new-event', h);
  }, [ctl, open]);
  return null;
}
