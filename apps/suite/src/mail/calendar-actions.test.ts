import { findInvite, newEvent, parseMailData, parseMessage, serializeMail, type CalEvent } from '@suitenova/mail-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calendarHtml } from './calendar-print';
import { rangeOf, step, titleOf } from './calendar-range';
import { MailCtl } from './ctl';
import { FakeServer, account, standardServer } from './fake-server';
import { setTransport } from './remote';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
});

const at = (d: number, h = 10, m = 0) => new Date(2026, 5, d, h, m).getTime();
const HOUR = 3600_000;
let srv: FakeServer;
const opened: MailCtl[] = [];
const mailbox = (id: string, name: string) => {
  const c = new MailCtl();
  c.accounts = [account(id, name)];
  c.setOwner({ name, email: `${id}@ejemplo.es` });
  opened.push(c);
  return c;
};

beforeEach(() => {
  srv = standardServer();
  setTransport(srv.transport);
});
afterEach(() => {
  for (const c of opened.splice(0)) c.dispose();
  setTransport(null);
  store.clear();
});

const meeting = (c: MailCtl, over: Partial<CalEvent> = {}) => {
  const e = { ...newEvent(at(10, 16), at(10, 17), 'Plan'), location: 'Sala', attendees: [{ name: 'Luis', email: 'luis@ejemplo.es', status: 'needs-action' as const }], ...over };
  c.addEvent(e);
  return e.id;
};
const event = (c: MailCtl, id: string) => c.calendar.find(id)!;
/** What was sent arrives in another mailbox. */
const deliver = (to: MailCtl, index = srv.sent.length - 1) => {
  const raw = srv.sent[index]!.raw;
  return to.importRaw(Uint8Array.from(raw, (ch) => ch.charCodeAt(0)), 'inbox', { read: false });
};
const sentInvite = (index = srv.sent.length - 1) => findInvite(parseMessage(Uint8Array.from(srv.sent[index]!.raw, (ch) => ch.charCodeAt(0))))!;
const settled = (c: MailCtl) => c.outbox.process();

describe('citas', () => {
  it('cambios y deshacer, aparte de lo del correo', () => {
    const c = mailbox('a1', 'Ana');
    const m = c.importRaw('Subject: x\r\n\r\ny\r\n', 'inbox');
    c.setReadMany([m.id], false);
    c.setReadMany([m.id], true);
    c.go('calendar');
    expect(c.undoLabel).toBe('');
    const e = newEvent(at(1), at(1, 11), 'Uno');
    c.addEvent(e);
    c.calendar.move(e.id, undefined, HOUR, HOUR);
    expect(event(c, e.id).start).toBe(at(1, 11));
    expect(c.undoLabel).toBe('Mover cita');
    // moving it nowhere is not a change
    c.calendar.move(e.id, undefined, 0, 0);
    c.deleteEvent(e.id);
    c.undo();
    expect(event(c, e.id).start).toBe(at(1, 11));
    c.undo();
    expect(event(c, e.id).start).toBe(at(1));
    c.undo();
    expect(c.data.events).toEqual([]);
    expect(c.undoLabel).toBe('');
    c.go('mail');
    expect(c.undoLabel).toBe('Marcar como leído');
    c.undo();
    expect(m.read).toBe(false);
  });

  it('mover una repetición cambia solo esa; quitarla, también', () => {
    const c = mailbox('a1', 'Ana');
    const e = { ...newEvent(at(1), at(1, 11), 'Serie'), rrule: 'FREQ=WEEKLY' };
    c.addEvent(e);
    c.calendar.move(e.id, at(8), 2 * HOUR, 2 * HOUR);
    c.calendar.removeOne(e.id, at(15));
    expect(event(c, e.id)).toMatchObject({ start: at(1), exdates: [at(15)], changes: [{ at: at(8), start: at(8, 12) }] });
    expect(parseMailData(serializeMail(c.data)).events[0]).toEqual(event(c, e.id));
    c.go('calendar');
    c.undo();
    c.undo();
    expect(event(c, e.id).changes).toBeUndefined();
  });

  it('calendarios: lo nuevo va al que se ve, se importa en uno y al eliminarlo se van sus citas', () => {
    const c = mailbox('a1', 'Ana');
    const work = c.calendar.add('Trabajo', 'red');
    expect(c.newEventAt(at(2)).calendar).toBeUndefined();
    c.calendar.edit('cal', { hidden: true });
    expect(c.newEventAt(at(2)).calendar).toBe(work);
    c.calendar.importInto = work;
    c.calendar.import([newEvent(at(3), at(3, 11), 'Importada')], []);
    expect(c.data.events[0]!.calendar).toBe(work);
    c.calendar.import([newEvent(at(4), at(4, 11), 'Otra')], []);
    expect(c.data.events[1]!.calendar).toBeUndefined();
    // ver una cita de un calendario oculto lo muestra
    c.openEvent(c.data.events[1]!.id);
    expect(c.data.calendars!.find((x) => x.id === 'cal')!.hidden).toBeUndefined();
    expect([c.section, c.anchor]).toEqual(['calendar', at(4)]);
    expect(c.calendar.remove(work)).toBe(1);
    expect(c.data.events.map((x) => x.title)).toEqual(['Otra']);
    expect(c.calendar.undoLabel).toBe('');
  });

  it('las vistas: sus días, sus pasos y lo que imprimen', () => {
    const c = mailbox('a1', 'Ana');
    c.addEvent({ ...newEvent(at(6), at(6, 11), 'Sábado <b>') });
    c.addEvent({ ...newEvent(at(10), at(10, 11), 'Miércoles'), location: 'Sala' });
    c.anchor = at(10);
    expect(rangeOf('workweek', at(10)).days.map((d) => new Date(d).getDate())).toEqual([8, 9, 10, 11, 12]);
    expect(rangeOf('agenda', at(10)).days).toHaveLength(30);
    expect(new Date(step('workweek', at(10), 1)).getDate()).toBe(17);
    expect(new Date(step('agenda', at(10), -1)).getMonth()).toBe(4);
    expect(titleOf('workweek', at(10))).toContain('12');
    c.setCalView('week');
    expect(calendarHtml(c)).toContain('Miércoles</b> · Sala');
    expect(calendarHtml(c)).toContain('Sin citas.');
    c.setCalView('agenda');
    expect(calendarHtml(c)).not.toContain('Sábado');
    c.setCalView('month');
    expect(calendarHtml(c)).toContain('class="month"');
    expect(calendarHtml(c)).toContain('Sábado &lt;b&gt;');
    expect(calendarHtml(c)).not.toContain('<script');
  });
});

describe('reuniones entre dos buzones', () => {
  it('invitar, aceptar, y que la respuesta quede anotada', async () => {
    const ana = mailbox('a1', 'Ana');
    const luis = mailbox('luis', 'Luis');
    const id = meeting(ana);
    ana.calendar.invite(id);
    await settled(ana);
    expect(srv.sent).toHaveLength(1);
    expect(srv.sent[0]!.recipients).toEqual(['luis@ejemplo.es']);
    expect(sentInvite()).toMatchObject({ method: 'REQUEST', event: { sequence: 0, organizer: { email: 'a1@ejemplo.es' } } });
    expect(event(ana, id)).toMatchObject({ sent: 0, sequence: 0, organizer: { email: 'a1@ejemplo.es' } });
    expect(ana.data.messages.filter((m) => m.folder === 'sent').map((m) => m.subject)).toEqual(['Invitación: Plan']);

    const invitation = deliver(luis);
    expect(invitation.meeting).toBe('REQUEST');
    luis.calendar.respond(invitation.id, 'accepted', true);
    await settled(luis);
    expect(invitation.rsvp).toBe('accepted');
    expect(luis.data.events).toMatchObject([{ title: 'Plan', attendees: [{ email: 'luis@ejemplo.es', status: 'accepted' }], organizer: { email: 'a1@ejemplo.es' } }]);
    expect(luis.calendar.editable(luis.data.events[0]!)).toBe(false);
    expect(srv.sent[1]!.recipients).toEqual(['a1@ejemplo.es']);
    expect(sentInvite().method).toBe('REPLY');
    expect(invitation.answered).toBe(true);

    const reply = deliver(ana);
    expect(event(ana, id).attendees![0]!.status).toBe('needs-action');
    ana.select(reply.id);
    expect(event(ana, id).attendees![0]!.status).toBe('accepted');
  });

  it('la actualización sube de versión y la cancelación la quita de los dos calendarios', async () => {
    const ana = mailbox('a1', 'Ana');
    const luis = mailbox('luis', 'Luis');
    const id = meeting(ana);
    ana.calendar.invite(id);
    await settled(ana);
    luis.calendar.respond(deliver(luis).id, 'tentative', false);
    expect(srv.sent).toHaveLength(1);
    ana.calendar.move(id, undefined, HOUR, HOUR);
    ana.calendar.invite(id);
    await settled(ana);
    expect(sentInvite()).toMatchObject({ event: { sequence: 1, start: at(10, 17) } });
    expect(parseMessage(Uint8Array.from(srv.sent[1]!.raw, (ch) => ch.charCodeAt(0))).subject).toContain('Actualizaci');
    luis.calendar.respond(deliver(luis).id, 'accepted', false);
    expect(luis.data.events).toHaveLength(1);
    expect(luis.data.events[0]).toMatchObject({ start: at(10, 17), sequence: 1 });
    ana.calendar.cancel(id, undefined, true);
    await settled(ana);
    expect(ana.data.events).toEqual([]);
    expect(sentInvite()).toMatchObject({ method: 'CANCEL', event: { sequence: 2 } });
    const cancel = deliver(luis);
    expect(cancel.meeting).toBe('CANCEL');
    expect(luis.calendar.removeCancelled(cancel.id)).toBe(true);
    expect(luis.data.events).toEqual([]);
    luis.go('calendar');
    luis.undo();
    expect(luis.data.events).toHaveLength(1);
  });

  it('una sola repetición: se actualiza o se cancela esa', async () => {
    const ana = mailbox('a1', 'Ana');
    const luis = mailbox('luis', 'Luis');
    const id = meeting(ana, { rrule: 'FREQ=WEEKLY' });
    ana.calendar.invite(id);
    await settled(ana);
    luis.calendar.respond(deliver(luis).id, 'accepted', false);
    ana.calendar.changeOne(id, at(17, 16), { start: at(18, 9), end: at(18, 10) });
    ana.calendar.invite(id, at(17, 16));
    await settled(ana);
    expect(sentInvite().event).toMatchObject({ recurrenceId: at(17, 16), start: at(18, 9), rrule: '' });
    luis.calendar.respond(deliver(luis).id, 'accepted', false);
    expect(luis.data.events).toHaveLength(1);
    expect(luis.data.events[0]!.changes).toMatchObject([{ at: at(17, 16), start: at(18, 9) }]);
    ana.calendar.cancel(id, at(24, 16), true);
    await settled(ana);
    expect(ana.calendar.find(id)!.exdates).toEqual([at(24, 16)]);
    expect(luis.calendar.removeCancelled(deliver(luis).id)).toBe(true);
    expect(luis.data.events[0]!.exdates).toEqual([at(24, 16)]);
  });

  it('deshacer no reutiliza versiones ni borra las respuestas anotadas', async () => {
    const ana = mailbox('a1', 'Ana');
    const luis = mailbox('luis', 'Luis');
    const id = meeting(ana);
    ana.calendar.move(id, undefined, HOUR, HOUR);
    ana.calendar.invite(id);
    await settled(ana);
    luis.calendar.respond(deliver(luis).id, 'accepted', true);
    await settled(luis);
    ana.select(deliver(ana).id);
    ana.go('calendar');
    ana.undo();
    expect(event(ana, id)).toMatchObject({ start: at(10, 16), sent: 0, sequence: 0, organizer: { email: 'a1@ejemplo.es' }, attendees: [{ status: 'accepted' }] });
    ana.calendar.invite(id);
    await settled(ana);
    expect(sentInvite()).toMatchObject({ event: { sequence: 1, start: at(10, 16) } });
  });

  it('cancelar sin avisar, o lo que nunca se envió, no manda nada', async () => {
    const ana = mailbox('a1', 'Ana');
    const id = meeting(ana);
    ana.calendar.cancel(id, undefined, true);
    await settled(ana);
    expect(srv.sent).toHaveLength(0);
    expect(ana.data.events).toEqual([]);
  });

  it('sin conexión la invitación espera en la Bandeja de salida', async () => {
    const ana = mailbox('a1', 'Ana');
    const id = meeting(ana);
    srv.failWith = 'Error de red';
    ana.calendar.invite(id);
    await settled(ana);
    expect(ana.outbox.messages.map((m) => m.subject)).toEqual(['Invitación: Plan']);
    srv.failWith = null;
    await ana.outbox.sendNow(ana.outbox.messages[0]!.id);
    expect(srv.sent).toHaveLength(1);
  });

  it('sin cuenta se guarda como mensaje para otro programa; sin invitados no hay nada que enviar', () => {
    const ana = mailbox('a1', 'Ana');
    ana.accounts = [];
    const id = meeting(ana);
    expect(ana.calendar.canInvite).toBe(false);
    expect(() => ana.calendar.invite(id)).toThrow('guarda la invitación');
    const parsed = parseMessage(ana.calendar.invitationFile(id));
    expect(parsed.to.map((a) => a.email)).toEqual(['luis@ejemplo.es']);
    expect(parsed.from[0]!.email).toBe('a1@ejemplo.es');
    expect(findInvite(parsed)!.method).toBe('REQUEST');
    // nothing was sent, so nothing is noted as sent
    expect(event(ana, id).sent).toBeUndefined();
    const alone = newEvent(at(1), at(1, 11), 'Sola');
    ana.addEvent(alone);
    expect(() => ana.calendar.invite(alone.id)).toThrow('no tiene invitados');
  });

  it('lo que llega de quien no debe no cambia nada', async () => {
    const ana = mailbox('a1', 'Ana');
    const luis = mailbox('luis', 'Luis');
    const id = meeting(ana);
    ana.calendar.invite(id);
    await settled(ana);
    luis.calendar.respond(deliver(luis).id, 'declined', true);
    await settled(luis);
    expect(luis.data.events).toEqual([]);
    // la misma respuesta, enviada por otra persona
    const forged = srv.sent[1]!.raw.replace(/^From: .*$/m, 'From: intruso@malo.es');
    const m = ana.importRaw(Uint8Array.from(forged, (ch) => ch.charCodeAt(0)), 'inbox', { read: false });
    ana.select(m.id);
    expect(event(ana, id).attendees![0]!.status).toBe('needs-action');
    // y en la carpeta de correo no deseado tampoco se anota
    const junk = ana.importRaw(Uint8Array.from(srv.sent[1]!.raw, (ch) => ch.charCodeAt(0)), 'junk', { read: false });
    ana.select(junk.id);
    expect(event(ana, id).attendees![0]!.status).toBe('needs-action');
  });

  it('una respuesta que llega al sincronizar se anota sola', async () => {
    const ana = mailbox('a1', 'Ana');
    const luis = mailbox('luis', 'Luis');
    srv.accounts = [...ana.accounts];
    await ana.syncAll();
    const id = meeting(ana);
    ana.calendar.invite(id);
    await settled(ana);
    luis.calendar.respond(deliver(luis).id, 'accepted', true);
    await settled(luis);
    srv.deliver({ key: '40', flags: [], raw: srv.sent.at(-1)!.raw });
    await ana.syncAll();
    expect(event(ana, id).attendees![0]!.status).toBe('accepted');
  });
});
