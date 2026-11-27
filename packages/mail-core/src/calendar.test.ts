import { describe, expect, it } from 'vitest';
import {
  addCalendar,
  addRaw,
  answerRequest,
  applyCancel,
  applyReply,
  buildMessage,
  calendarOf,
  calendarsOf,
  cancelMessage,
  changeCalendar,
  changeOccurrence,
  changeSeries,
  conflicts,
  dueReminders,
  expandEvent,
  findInvite,
  invitees,
  inviteState,
  lostBy,
  newEvent,
  newMailData,
  occurrenceOf,
  organizes,
  parseIcs,
  parseMailData,
  parseMessage,
  removeCalendar,
  removeOccurrence,
  replyMessage,
  requestMessage,
  serializeMail,
  shiftEvent,
  visibleEvents,
  writeIcs,
  type CalEvent,
  type InviteMessage,
} from './index';

const at = (d: number, h = 10, m = 0) => new Date(2026, 5, d, h, m).getTime();
const HOUR = 3600_000;
const DAY = 86400_000;
/** Every Monday from 1 June 2026, 10 to 11. */
const weekly = (): CalEvent => ({ ...newEvent(at(1), at(1, 11), 'Revisión'), rrule: 'FREQ=WEEKLY', location: 'Sala 1', reminder: 15 });
const starts = (e: CalEvent, from = at(1, 0), to = at(30, 0)) => expandEvent(e, from, to).map((o) => new Date(o.start).getDate() + (o.changed ? 0.5 : 0)).sort((a, b) => a - b);

describe('cambiar una repetición', () => {
  it('solo cambia esa: otro título, otra hora u otro día', () => {
    const e = weekly();
    expect(starts(e)).toEqual([1, 8, 15, 22, 29]);
    const moved = changeOccurrence(e, at(8), { title: 'Revisión larga', start: at(10, 16), end: at(10, 18) });
    expect(e.changes).toBeUndefined();
    expect(starts(moved)).toEqual([1, 10.5, 15, 22, 29]);
    const occ = expandEvent(moved, at(10, 0), at(11, 0));
    expect(occ).toMatchObject([{ original: at(8), changed: true, start: at(10, 16), end: at(10, 18), event: { id: e.id, title: 'Revisión larga', location: 'Sala 1' } }]);
    // moved out of the dates being looked at, it is not seen where it was
    expect(expandEvent(moved, at(8, 0), at(9, 0))).toEqual([]);
    expect(occurrenceOf(moved, at(8)).start).toBe(at(10, 16));
    expect(occurrenceOf(moved, at(15))).toMatchObject({ start: at(15), end: at(15, 11), title: 'Revisión' });
    // back to what the series says, it is no longer a change
    expect(changeOccurrence(moved, at(8), { title: 'Revisión', start: at(8), end: at(8, 11) }).changes).toBeUndefined();
  });

  it('moved before the first one or beyond the count of the series, it is still shown', () => {
    const e = { ...weekly(), rrule: 'FREQ=WEEKLY;COUNT=3' };
    const changed = changeOccurrence(changeOccurrence(e, at(1), { start: at(1, 8) - 7 * DAY, end: at(1, 9) - 7 * DAY }), at(15), { start: at(25), end: at(25, 11) });
    expect(expandEvent(changed, at(1, 0) - 10 * DAY, at(1, 0)).map((o) => o.original)).toEqual([at(1)]);
    expect(starts(changed)).toEqual([8, 25.5]);
  });

  it('quitar una la excluye y olvida su cambio', () => {
    const moved = changeOccurrence(weekly(), at(8), { start: at(9), end: at(9, 11) });
    const gone = removeOccurrence(moved, at(8));
    expect(starts(gone)).toEqual([1, 15, 22, 29]);
    expect(gone.changes).toBeUndefined();
    expect(gone.exdates).toEqual([at(8)]);
  });

  it('al mover la serie entera, lo quitado y lo cambiado la siguen; lo que ya no corresponde se olvida', () => {
    const e = removeOccurrence(changeOccurrence(weekly(), at(8), { title: 'Distinta' }), at(15));
    const later = changeSeries(e, { ...e, start: at(1, 12), end: at(1, 13) });
    expect(later.exdates).toEqual([at(15, 12)]);
    expect(later.changes).toMatchObject([{ at: at(8, 12), start: at(8, 12), title: 'Distinta' }]);
    expect(lostBy(e, { ...e, start: at(1, 12), end: at(1, 13) })).toBe(0);
    const everyOther = { ...e, rrule: 'FREQ=WEEKLY;INTERVAL=2' };
    expect(changeSeries(e, everyOther)).toMatchObject({ exdates: [at(15)] });
    expect(changeSeries(e, everyOther).changes).toBeUndefined();
    expect(lostBy(e, everyOther)).toBe(1);
    const once = changeSeries(e, { ...e, rrule: '' });
    expect(once).toMatchObject({ exdates: [] });
    expect(once.changes).toBeUndefined();
  });

  it('mover y estirar, una cita o una repetición, sin que acabe antes de empezar', () => {
    const single = newEvent(at(3), at(3, 11), 'Sola');
    expect(shiftEvent(single, undefined, DAY, DAY)).toMatchObject({ start: at(4), end: at(4, 11) });
    expect(shiftEvent(single, undefined, 0, -5 * HOUR)).toMatchObject({ start: at(3), end: at(3, 10, 15) });
    const moved = shiftEvent(weekly(), at(8), 2 * HOUR, 3 * HOUR);
    expect(moved.changes).toMatchObject([{ at: at(8), start: at(8, 12), end: at(8, 14) }]);
    expect(moved.start).toBe(at(1));
    // moved again, from where it is
    expect(shiftEvent(moved, at(8), HOUR, HOUR).changes![0]).toMatchObject({ start: at(8, 13), end: at(8, 15) });
  });

  it('se guarda en el archivo y viaja en .ics con RECURRENCE-ID', () => {
    const d = newMailData();
    const e = removeOccurrence(changeOccurrence(weekly(), at(8), { title: 'Cambiada', start: at(9), end: at(9, 11) }), at(15));
    d.events.push(e);
    expect(parseMailData(serializeMail(d)).events[0]).toEqual(e);
    const text = writeIcs([e]);
    expect(text).toContain('RECURRENCE-ID:');
    const back = parseIcs(text).events;
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ rrule: 'FREQ=WEEKLY', exdates: [at(15)], changes: [{ at: at(8), title: 'Cambiada', start: at(9) }] });
    // una repetición cancelada escrita aparte cuenta como quitada
    const cancelled = text.replace('SUMMARY:Cambiada', 'STATUS:CANCELLED\r\nSUMMARY:Cambiada');
    expect(parseIcs(cancelled).events[0]!.exdates).toEqual([at(15), at(8)]);
  });

  it('un recordatorio propio de una repetición', () => {
    const d = newMailData();
    d.events.push(changeOccurrence({ ...weekly(), reminder: null }, at(8), { reminder: 30 }));
    expect(dueReminders(d, at(8, 9, 40)).map((r) => r.at)).toEqual([at(8)]);
    expect(dueReminders(d, at(15, 9, 59))).toEqual([]);
    d.events[0] = { ...weekly(), cancelled: true };
    expect(dueReminders(d, at(8, 9, 50))).toEqual([]);
  });
});

describe('calendarios', () => {
  it('uno de partida; los demás con color, ocultables y se eliminan con sus citas', () => {
    const d = newMailData();
    expect(calendarsOf(d)).toEqual([{ id: 'cal', name: 'Calendario', color: 'blue' }]);
    addCalendar(d, 'w', 'Trabajo', 'red');
    expect(() => addCalendar(d, 'x', ' trabajo ', 'red')).toThrow('Ya existe');
    expect(() => addCalendar(d, 'x', '  ', 'red')).toThrow('nombre');
    const a = newEvent(at(1), at(1, 11), 'A');
    const b = { ...newEvent(at(2), at(2, 11), 'B'), calendar: 'w' };
    d.events.push(a, b);
    expect(calendarOf(d, b).name).toBe('Trabajo');
    expect(calendarOf(d, { calendar: 'ya no está' }).id).toBe('cal');
    changeCalendar(d, 'w', { hidden: true });
    expect(visibleEvents(d).map((e) => e.title)).toEqual(['A']);
    changeCalendar(d, 'cal', { name: 'Personal', color: 'green' });
    expect(calendarsOf(d).map((c) => [c.name, c.color])).toEqual([['Personal', 'green'], ['Trabajo', 'red']]);
    const back = parseMailData(serializeMail(d));
    expect(back.calendars).toEqual(d.calendars);
    expect(back.events[1]!.calendar).toBe('w');
    expect(removeCalendar(d, 'cal')).toBe(0);
    expect(removeCalendar(d, 'w')).toBe(1);
    expect(d.events.map((e) => e.title)).toEqual(['A']);
  });
});

describe('invitaciones', () => {
  const OWN = new Set(['yo@x.es']);
  const meeting = (): CalEvent => ({
    ...newEvent(at(10, 16), at(10, 17), 'Plan; de, junio'),
    location: 'Sala 2',
    description: 'Orden del día:\n1. Plan',
    organizer: { name: 'Ana, Jefa', email: 'ana@x.es' },
    attendees: [
      { name: 'Yo', email: 'yo@x.es', status: 'needs-action' },
      { name: '', email: 'luis@x.es', status: 'accepted', optional: true },
    ],
    sequence: 0,
  });
  /** The message as it would arrive. */
  const mailed = (m: InviteMessage, from: { name: string; email: string }) =>
    buildMessage({ from, to: m.to, cc: [], bcc: [], subject: m.subject, text: m.text, attachments: [], calendar: { method: m.method, ics: m.ics } });

  it('viaja como parte del cuerpo y como archivo, y se lee de vuelta', () => {
    const raw = mailed(requestMessage(meeting(), false), { name: 'Ana', email: 'ana@x.es' });
    expect(raw).toContain('Content-Type: multipart/mixed');
    expect(raw).toContain('Content-Type: text/calendar; method=REQUEST; charset=UTF-8');
    expect(raw).toContain('filename="invitacion.ics"');
    const parsed = parseMessage(raw);
    expect(parsed.subject).toBe('Invitación: Plan; de, junio');
    expect(parsed.text).toContain('Sala 2');
    // the calendar of the body is not shown as one more file
    expect(parsed.attachments.map((a) => a.filename)).toEqual(['invitacion.ics']);
    const invite = findInvite(parsed)!;
    expect(invite.method).toBe('REQUEST');
    expect(invite.event).toMatchObject({ title: 'Plan; de, junio', location: 'Sala 2', start: at(10, 16), end: at(10, 17), organizer: { name: 'Ana, Jefa', email: 'ana@x.es' }, sequence: 0 });
    expect(invite.event.attendees).toEqual(meeting().attendees);
    const d = newMailData();
    expect(addRaw(d, 'inbox', raw).meeting).toBe('REQUEST');
    expect(parseMailData(serializeMail(d)).messages[0]!.meeting).toBe('REQUEST');
    // a plain .ics attached without a method is not an invitation
    const plain = buildMessage({ from: { name: '', email: 'a@x.es' }, to: [], subject: 's', text: 't', attachments: [{ filename: 'cal.ics', contentType: 'text/calendar', data: new TextEncoder().encode(writeIcs([meeting()])) }] });
    expect(findInvite(parseMessage(plain))).toBeNull();
    expect(parseMessage(plain).attachments.map((a) => a.filename)).toEqual(['cal.ics']);
    expect(addRaw(d, 'inbox', plain).meeting).toBeUndefined();
  });

  it('aceptar la pone en el calendario; rechazar la quita; una versión nueva la actualiza sin perder lo propio', () => {
    const d = newMailData();
    const invite = findInvite(parseMessage(mailed(requestMessage(meeting(), false), { name: '', email: 'ana@x.es' })))!;
    expect(inviteState(d, invite, 'ana@x.es')).toEqual({ kind: 'new', warning: '' });
    expect(inviteState(d, invite, 'otro@x.es').warning).toContain('no viene de quien organiza');
    const added = answerRequest(d, invite, 'tentative', OWN, 'w')!;
    expect(added).toMatchObject({ calendar: 'w', reminder: 15, attendees: [{ email: 'yo@x.es', status: 'tentative' }, { email: 'luis@x.es', status: 'accepted' }] });
    expect(organizes(added, OWN)).toBe(false);
    d.events = [{ ...added, categories: ['Mía'], reminder: 60 }];
    expect(inviteState(d, invite, 'ana@x.es').kind).toBe('same');
    const newer = { ...invite, event: { ...invite.event, sequence: 1, start: at(11, 16), end: at(11, 17) } };
    expect(inviteState(d, newer, 'ana@x.es').kind).toBe('update');
    const updated = answerRequest(d, newer, 'accepted', OWN)!;
    expect(d.events).toHaveLength(1);
    expect(updated).toMatchObject({ id: added.id, start: at(11, 16), calendar: 'w', categories: ['Mía'], reminder: 60 });
    expect(inviteState(d, invite, 'ana@x.es').kind).toBe('outdated');
    const other = { ...invite, event: { ...invite.event, organizer: { name: '', email: 'mal@x.es' } } };
    expect(inviteState(d, other, 'mal@x.es').warning).toContain('El organizador no es');
    expect(answerRequest(d, newer, 'declined', OWN)).toBeNull();
    expect(d.events).toEqual([]);
  });

  it('dice lo que coincide a esa hora', () => {
    const d = newMailData();
    d.events.push(newEvent(at(10, 16, 30), at(10, 18), 'Médico'), newEvent(at(10, 17), at(10, 18), 'Después'), { ...newEvent(at(10, 0), at(11, 0), 'Festivo'), allDay: true }, { ...meeting(), uid: 'otro', cancelled: true });
    expect(conflicts(d, meeting()).map((e) => e.title)).toEqual(['Médico']);
  });

  it('la respuesta nombra solo a quien responde y se anota en la reunión de quien invita', () => {
    const invite = findInvite(parseMessage(mailed(requestMessage(meeting(), false), { name: '', email: 'ana@x.es' })))!;
    const reply = replyMessage(invite, { name: 'Yo', email: 'yo@x.es' }, 'declined')!;
    expect(reply).toMatchObject({ subject: 'Rechazada: Plan; de, junio', method: 'REPLY', to: [{ email: 'ana@x.es' }] });
    const got = findInvite(parseMessage(mailed(reply, { name: 'Yo', email: 'yo@x.es' })))!;
    expect(got.event.attendees).toEqual([{ name: 'Yo', email: 'yo@x.es', status: 'declined' }]);
    expect(replyMessage({ ...invite, event: { ...invite.event, organizer: undefined } }, { name: '', email: 'yo@x.es' }, 'accepted')).toBeNull();
    const d = newMailData();
    const mine = () => ({ ...meeting(), uid: invite.event.uid });
    d.events.push(mine());
    const ana = new Set(['ana@x.es']);
    // from someone else, or in someone else's calendar, it changes nothing
    expect(applyReply(d, got, 'intruso@x.es', ana)).toBeNull();
    expect(applyReply(d, got, 'yo@x.es', OWN)).toBeNull();
    expect(applyReply(d, got, 'yo@x.es', ana)).toMatchObject({ email: 'yo@x.es', status: 'declined' });
    expect(d.events[0]!.attendees![0]!.status).toBe('declined');
    expect(applyReply(d, got, 'yo@x.es', ana)).toBeNull();
    // an answer to an older version does not count
    d.events = [{ ...mine(), sequence: 2 }];
    expect(applyReply(d, got, 'yo@x.es', ana)).toBeNull();
  });

  it('la cancelación solo vale si viene del organizador', () => {
    const d = newMailData();
    d.events.push(meeting());
    const cancel = findInvite(parseMessage(mailed(cancelMessage({ ...meeting(), uid: d.events[0]!.uid, sequence: 1 }), { name: '', email: 'ana@x.es' })))!;
    expect(cancel).toMatchObject({ method: 'CANCEL', event: { cancelled: true } });
    expect(applyCancel(d, cancel, 'intruso@x.es')).toBe(false);
    expect(applyCancel(d, cancel, 'ana@x.es')).toBe(true);
    expect(d.events).toEqual([]);
    expect(applyCancel(d, cancel, 'ana@x.es')).toBe(false);
  });

  it('de una sola repetición: se cambia o se quita solo esa', () => {
    const d = newMailData();
    const series = { ...weekly(), organizer: { name: '', email: 'ana@x.es' }, attendees: [{ name: '', email: 'yo@x.es', status: 'accepted' as const }] };
    d.events.push(series);
    const one = { ...series, rrule: '', recurrenceId: at(8), start: at(9), end: at(9, 11), exdates: [] };
    const invite = findInvite(parseMessage(mailed(requestMessage(one, true), { name: '', email: 'ana@x.es' })))!;
    expect(invite.event.recurrenceId).toBe(at(8));
    answerRequest(d, invite, 'accepted', OWN);
    expect(d.events).toHaveLength(1);
    expect(d.events[0]!.changes).toMatchObject([{ at: at(8), start: at(9) }]);
    const cancel = findInvite(parseMessage(mailed(cancelMessage(one), { name: '', email: 'ana@x.es' })))!;
    expect(applyCancel(d, cancel, 'ana@x.es')).toBe(true);
    expect(d.events[0]!.exdates).toEqual([at(8)]);
  });

  it('los invitados conservan su respuesta; las direcciones raras de un archivo se dejan fuera', () => {
    const before = meeting().attendees;
    expect(invitees(before, [{ name: '', email: 'LUIS@x.es' }, { name: 'Nueva', email: 'n@x.es' }, { name: '', email: 'n@x.es' }])).toEqual([
      { name: '', email: 'luis@x.es', status: 'accepted', optional: true },
      { name: 'Nueva', email: 'n@x.es', status: 'needs-action' },
    ]);
    const bad = writeIcs([meeting()]).replace(/mailto:luis@x\.es/, 'mailto:no es una dirección');
    expect(parseIcs(bad).events[0]!.attendees!.map((a) => a.email)).toEqual(['yo@x.es']);
    const d = newMailData();
    d.events.push({ ...meeting(), attendees: [{ name: 'x', email: 'sin arroba', status: 'accepted' }, { name: '', email: 'ok@x.es', status: 'raro' as never }], changes: [{ at: 1 } as never], sequence: 'a' as never });
    const read = parseMailData(serializeMail(d)).events[0]!;
    expect(read.attendees).toEqual([{ name: '', email: 'ok@x.es', status: 'needs-action' }]);
    expect(read.changes).toBeUndefined();
    expect(read.sequence).toBeUndefined();
  });
});
