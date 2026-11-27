import { Button, DialogActions, DialogContent, DialogTitle } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { PARTSTATS, attendeeOf, calendarsOf, changeSeries, expandGroups, invitees, isMeeting, lostBy, occurrenceOf, organizes, splitRecipients, type CalEvent } from '@suitenova/mail-core';
import { useState } from 'react';
import { ProofTextarea } from '../spell';
import { CategoryPicker } from './CategoryViews';
import { addDays, startOfDay, type MailCtl } from './ctl';
import { dateStr, parseLocal, timeStr } from './dates';
import { RecipientInput } from './RecipientInput';

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

const peopleText = (e: CalEvent): string => (e.attendees ?? []).map((a) => (a.name ? `${/[",;<>@]/.test(a.name) ? `"${a.name.replace(/"/g, '')}"` : a.name} <${a.email}>` : a.email)).join(', ');
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export interface EventBodyProps {
  ctl: MailCtl;
  ev: CalEvent;
  /** In a series: the occurrence that was opened (the start it would have had). */
  occurrence?: number;
  isNew: boolean;
  /** It is opened to call a meeting. */
  meeting?: boolean;
  /** Saves an invitation to send with another program, when there is no account. */
  onSaveEml: (raw: string, name: string) => void;
  onClose: () => void;
}

/** The content of the event dialog (shown inside a StickyDialog). */
export function EventBody({ ctl, ev, occurrence, isNew, meeting, onSaveEml, onClose }: EventBodyProps) {
  const series = !isNew && !!ev.rrule && occurrence !== undefined;
  /** The whole series, or only the occurrence that was opened. */
  const [one, setOne] = useState(false);
  const ofOne = (): CalEvent => {
    const { at: _at, ...how } = occurrenceOf(ev, occurrence!);
    return { ...ev, ...how };
  };
  const [e, setE] = useState<CalEvent>(ev);
  const [people, setPeople] = useState(() => peopleText(ev));
  const [rep, setRep] = useState(ev.rrule.split(';').find((x) => x.startsWith('FREQ='))?.length ? `FREQ=${/FREQ=(\w+)/.exec(ev.rrule)?.[1]}` : '');
  const [until, setUntil] = useState(() => {
    const m = /UNTIL=(\d{4})(\d{2})(\d{2})/.exec(ev.rrule);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  });
  const [err, setErr] = useState<string | null>(null);
  const customRule = !!ev.rrule && !/^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;UNTIL=\d{8}(T\d{6}Z)?)?$/.test(ev.rrule);
  const set = (p: Partial<CalEvent>) => {
    setE((x) => ({ ...x, ...p }));
    setErr(null);
  };

  const own = ctl.ownAddresses();
  const mine = organizes(ev, own);
  const me = attendeeOf(ev, own);
  const asking = mine && (!!meeting || !!people.trim() || isMeeting(ev));
  const sent = ev.sent !== undefined;
  const canInvite = ctl.calendar.canInvite;
  const calendars = calendarsOf(ctl.data);

  const scope = (only: boolean) => {
    setOne(only);
    setE(only ? ofOne() : ev);
    setErr(null);
  };

  /** What the dialog says, as it will be saved; null if something is wrong. */
  const result = (): CalEvent | null => {
    const fail = (text: string) => {
      setErr(text);
      return null;
    };
    if (!e.title.trim()) return fail(t('Escribe un título.'));
    if (e.end < e.start) return fail(t('El evento no puede terminar antes de empezar.'));
    if (one) return { ...e, title: e.title.trim() };
    const rrule = customRule && rep === `FREQ=${/FREQ=(\w+)/.exec(ev.rrule)?.[1]}` ? ev.rrule : rep ? rep + (until ? `;UNTIL=${until.replace(/-/g, '')}` : '') : '';
    const out: CalEvent = { ...e, title: e.title.trim(), rrule };
    if (mine) {
      const list = expandGroups(splitRecipients(people), ctl.data.contacts);
      const bad = list.find((p) => !EMAIL.test(p.email));
      if (bad) return fail(t('La dirección «{email}» no es válida.', { email: bad.email }));
      const attendees = invitees(ev.attendees, list);
      if (attendees.length) out.attendees = attendees;
      else {
        delete out.attendees;
        delete out.organizer;
      }
    }
    return out;
  };

  /** Saves; false when it was not done. */
  const keep = (): boolean => {
    const out = result();
    if (!out) return false;
    if (one) {
      ctl.calendar.changeOne(ev.id, occurrence!, { title: out.title, location: out.location, description: out.description, start: out.start, end: out.end, reminder: out.reminder });
      return true;
    }
    if (isNew) {
      ctl.addEvent(out);
      return true;
    }
    const lost = ev.rrule ? lostBy(ev, out) : 0;
    if (lost && !window.confirm(t('Con este cambio se pierden {n} cambios hechos a repeticiones sueltas. ¿Continuar?', { n: lost }))) return false;
    ctl.updateEvent(ev.rrule ? changeSeries(ev, out) : out);
    return true;
  };

  const save = () => keep() && onClose();

  const saveAndSend = () => {
    const out = result();
    if (!out) return;
    if (!one && !out.attendees?.length) return setErr(t('Escribe a quién invitar.'));
    if (!keep()) return;
    try {
      ctl.calendar.invite(ev.id, one ? occurrence : undefined);
      onClose();
    } catch (x) {
      setErr(t((x as Error).message));
    }
  };

  const saveEml = () => {
    const out = result();
    if (!out) return;
    if (!out.attendees?.length) return setErr(t('Escribe a quién invitar.'));
    if (!keep()) return;
    onSaveEml(ctl.calendar.invitationFile(ev.id), out.title);
    onClose();
  };

  const cancelMeeting = (at: number | undefined) => {
    const question = at === undefined ? t('¿Cancelar la reunión y avisar a los invitados?') : t('¿Cancelar solo esta repetición y avisar a los invitados?');
    if (!window.confirm(question)) return;
    try {
      ctl.calendar.cancel(ev.id, at, true);
      onClose();
    } catch (x) {
      setErr(t((x as Error).message));
    }
  };

  const locked = !mine;
  const title = isNew ? (asking ? t('Reunión nueva') : t('Evento nuevo')) : isMeeting(ev) ? t('Reunión') : t('Evento');
  return (
    <>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <div className="ml-form">
          {series && (
            <fieldset className="ml-scope">
              <legend>{t('Qué se edita')}</legend>
              <label>
                <input type="radio" name="scope" checked={!one} onChange={() => scope(false)} /> {t('Toda la serie')}
              </label>
              <label>
                <input type="radio" name="scope" checked={one} onChange={() => scope(true)} /> {t('Solo esta repetición ({date})', { date: new Date(occurrenceOf(ev, occurrence!).start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) })}
              </label>
            </fieldset>
          )}
          {locked && (
            <div className="ml-follow" role="note">
              <span>
                {t('Organiza {who}.', { who: ev.organizer!.name || ev.organizer!.email })} {me ? t('Tu respuesta: {answer}.', { answer: t(PARTSTATS[me.status]) }) : ''} {ev.cancelled ? t('La reunión se canceló.') : t('Solo quien organiza puede cambiar la hora y los datos.')}
              </span>
            </div>
          )}
          <label>
            <span>{t('Título')}</span>
            <input aria-label={t('Título')} value={e.title} readOnly={locked} onChange={(x) => set({ title: x.target.value })} autoFocus={!meeting} />
          </label>
          {mine && !one && (
            <div className="ml-invitees">
              <RecipientInput label={t('Invitados')} name={t('Invitados')} value={people} onChange={(v) => (setPeople(v), setErr(null))} entries={() => ctl.addressEntries()} autoFocus={meeting} />
            </div>
          )}
          {ev.attendees && ev.attendees.length > 0 && (
            <ul className="ml-answers" aria-label={t('Respuestas')}>
              {ev.attendees.map((a) => (
                <li key={a.email}>
                  <span>{a.name || a.email}</span>
                  <em className={`is-${a.status}`}>{t(PARTSTATS[a.status])}</em>
                </li>
              ))}
            </ul>
          )}
          <label>
            <span>{t('Lugar')}</span>
            <input aria-label={t('Lugar')} value={e.location} readOnly={locked} onChange={(x) => set({ location: x.target.value })} />
          </label>
          {!one && (
            <label className="ml-check">
              <input
                type="checkbox"
                checked={e.allDay}
                disabled={locked}
                onChange={(x) => {
                  const all = x.target.checked;
                  set(all ? { allDay: true, start: startOfDay(e.start), end: Math.max(addDays(startOfDay(e.start), 1), startOfDay(e.end) + (e.end > startOfDay(e.end) ? 86400000 : 0)) } : { allDay: false, start: startOfDay(e.start) + 9 * 3600000, end: startOfDay(e.start) + 10 * 3600000 });
                }}
              />{' '}
              {t('Todo el día')}
            </label>
          )}
          <div className="ml-row">
            <label>
              <span>{t('Inicio')}</span>
              <input type="date" aria-label={t('Fecha de inicio')} disabled={locked} value={dateStr(e.start)} onChange={(x) => x.target.value && set({ start: parseLocal(x.target.value, e.allDay ? '00:00' : timeStr(e.start)), end: e.end + (parseLocal(x.target.value, e.allDay ? '00:00' : timeStr(e.start)) - e.start) })} />
            </label>
            {!e.allDay && <input type="time" aria-label={t('Hora de inicio')} disabled={locked} value={timeStr(e.start)} onChange={(x) => x.target.value && set({ start: parseLocal(dateStr(e.start), x.target.value), end: e.end + (parseLocal(dateStr(e.start), x.target.value) - e.start) })} />}
          </div>
          <div className="ml-row">
            <label>
              <span>{t('Fin')}</span>
              <input type="date" aria-label={t('Fecha de fin')} disabled={locked} value={dateStr(e.allDay ? e.end - 86400000 : e.end)} onChange={(x) => x.target.value && set({ end: e.allDay ? addDays(parseLocal(x.target.value, '00:00'), 1) : parseLocal(x.target.value, timeStr(e.end)) })} />
            </label>
            {!e.allDay && <input type="time" aria-label={t('Hora de fin')} disabled={locked} value={timeStr(e.end)} onChange={(x) => x.target.value && set({ end: parseLocal(dateStr(e.end), x.target.value) })} />}
          </div>
          {!one && (
            <>
              <label>
                <span>{t('Repetición')}</span>
                <select aria-label={t('Repetición')} value={rep} disabled={locked} onChange={(x) => setRep(x.target.value)}>
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
                  <input type="date" aria-label={t('Repetir hasta')} value={until} disabled={locked} onChange={(x) => setUntil(x.target.value)} />
                </label>
              )}
              {customRule && <div className="ml-remote">{t('Este evento tiene una regla de repetición avanzada ({rule}); se conserva si no cambias la repetición.', { rule: ev.rrule })}</div>}
              {calendars.length > 1 && (
                <label>
                  <span>{t('Calendario')}</span>
                  <select aria-label={t('Calendario')} value={e.calendar ?? calendars[0]!.id} onChange={(x) => set({ calendar: x.target.value === 'cal' ? undefined : x.target.value })}>
                    {calendars.map((c) => (
                      <option key={c.id} value={c.id}>
                        {t(c.name)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
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
            <ProofTextarea aria-label={t('Descripción')} rows={4} value={e.description} readOnly={locked} onChange={(x) => set({ description: x.target.value })} />
          </label>
          {!one && <CategoryPicker data={ctl.data} value={e.categories} onChange={(categories) => set({ categories })} />}
          {asking && !canInvite && <p className="ml-hint">{t('Sin una cuenta de correo la invitación no se puede enviar desde aquí: guárdala como .eml.')}</p>}
          {err && (
            <div className="ml-error" role="alert">
              {err}
            </div>
          )}
        </div>
      </DialogContent>
      <DialogActions fluid className="ml-dlgactions">
        {!isNew &&
          (mine && sent && !ev.cancelled ? (
            <Button onClick={() => cancelMeeting(undefined)}>{t('Cancelar la reunión')}</Button>
          ) : (
            <Button
              onClick={() => {
                if (!window.confirm(t('¿Eliminar este evento? Se puede deshacer con Ctrl+Z.'))) return;
                ctl.deleteEvent(ev.id);
                onClose();
              }}
            >
              {ev.rrule ? t('Eliminar la serie') : t('Eliminar')}
            </Button>
          ))}
        {series && (
          <Button
            onClick={() => {
              if (mine && sent) return cancelMeeting(occurrence);
              ctl.calendar.removeOne(ev.id, occurrence!);
              onClose();
            }}
          >
            {t('Eliminar solo esta repetición')}
          </Button>
        )}
        <Button onClick={onClose}>{t('Cancelar')}</Button>
        <Button appearance={asking && canInvite ? 'secondary' : 'primary'} onClick={save}>
          {t('Guardar')}
        </Button>
        {asking && !ev.cancelled && (canInvite ? <Button appearance="primary" onClick={saveAndSend}>{sent ? t('Guardar y enviar la actualización') : t('Guardar y enviar la invitación')}</Button> : !one && <Button onClick={saveEml}>{t('Guardar la invitación (.eml)')}</Button>)}
      </DialogActions>
    </>
  );
}
