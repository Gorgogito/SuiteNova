import { addRaw, newEvent, parseMailData, parseMessage, rawOf, serializeMail } from '@suitenova/mail-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MailCtl, type ComposeState } from './ctl';
import { FakeServer, account, standardServer } from './fake-server';
import { setNotifier, type Pressed, type SystemNotice } from './notify';
import { setTransport, type Transport } from './remote';

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

const NOW = new Date(2026, 5, 10, 9, 0, 0).getTime();
let srv: FakeServer;
let ctl: MailCtl;
let shown: SystemNotice[];
let press: (p: Pressed) => void = () => undefined;
const opened: MailCtl[] = [];

const make = async () => {
  const c = new MailCtl();
  opened.push(c);
  await c.loadAccounts();
  return c;
};
const compose = (over: Partial<ComposeState> = {}): ComposeState => ({ id: `c${Math.random()}`, to: 'luis@x.es', cc: '', bcc: '', subject: 'Hola', body: 'Texto', attachments: [], from: 'a1', ...over });
const write = (over: Partial<ComposeState> = {}) => {
  ctl.newMessage();
  ctl.updateCompose({ ...ctl.compose!, to: 'luis@x.es', subject: 'Hola', body: 'Texto', ...over });
  return ctl.compose!;
};
const inFolder = (folder: string, c = ctl) => c.data.messages.filter((m) => m.folder === folder);
const subjects = (folder: string) => inFolder(folder).map((m) => m.subject).sort();
const pass = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  srv = standardServer();
  srv.accounts = [account()];
  setTransport(srv.transport);
  shown = [];
  setNotifier({
    show: async (n) => void shown.push(n),
    listen: (fn) => {
      press = fn;
      return () => undefined;
    },
  });
  ctl = await make();
});
afterEach(() => {
  for (const c of opened.splice(0)) c.dispose();
  setTransport(null);
  setNotifier(null);
  vi.useRealTimers();
  store.clear();
});

describe('deshacer el envío', () => {
  it('espera los segundos elegidos y se puede recuperar tal como se escribió', async () => {
    ctl.alerts.set({ delay: 10 });
    const c = write({ bcc: 'oculta@x.es', attachments: [{ filename: 'a.txt', contentType: 'text/plain', data: new TextEncoder().encode('x') }] });
    await ctl.send(c, 'a1');
    expect(ctl.compose).toBeNull();
    expect(inFolder('outbox')).toHaveLength(1);
    expect(inFolder('drafts')).toHaveLength(0);
    expect(ctl.outbox.undoable!.subject).toBe('Hola');
    expect(ctl.outbox.status(ctl.outbox.undoable!)).toBe('Se enviará en un momento.');
    await pass(5000);
    expect(srv.sent).toHaveLength(0);
    expect(ctl.outbox.takeBack(ctl.outbox.undoable!.id)).toBe(true);
    expect(ctl.compose).toMatchObject({ to: 'luis@x.es', bcc: 'oculta@x.es', subject: 'Hola' });
    expect(ctl.compose!.body.trim()).toBe('Texto');
    expect(ctl.compose!.attachments.map((a) => a.filename)).toEqual(['a.txt']);
    await pass(60_000);
    expect(srv.sent).toHaveLength(0);
    expect(inFolder('outbox')).toHaveLength(0);
  });

  it('si no se recupera, sale una sola vez, con copia en Enviados y el original contestado', async () => {
    await ctl.syncAll();
    ctl.alerts.set({ delay: 5 });
    const original = ctl.data.messages.find((m) => m.subject === 'Dos')!;
    ctl.reply(original.id, false);
    await ctl.send(ctl.compose!, 'a1');
    expect(original.answered).toBe(false);
    await pass(5100);
    expect(srv.sent).toHaveLength(1);
    expect(subjects('outbox')).toEqual([]);
    expect(subjects('sent')).toContain('Re: Dos');
    expect(inFolder('sent')[0]!.outgoing).toBeUndefined();
    expect(original.answered).toBe(true);
    expect(ctl.syncMessage).toContain('Mensaje enviado a ana@x.es');
    await pass(120_000);
    expect(srv.sent).toHaveLength(1);
    expect(srv.subjects('Sent')).toContain('Re: Dos');
  });

  it('sin retraso sale al momento, como antes', async () => {
    await ctl.send(compose(), 'a1');
    expect(srv.sent).toHaveLength(1);
    expect(inFolder('outbox')).toHaveLength(0);
  });
});

describe('enviar más tarde', () => {
  it('sale a su hora, con la fecha de ese momento', async () => {
    const at = NOW + 3 * 3600_000;
    await ctl.send(compose(), 'a1', { at });
    expect(ctl.outbox.status(inFolder('outbox')[0]!)).toMatch(/^Programado para/);
    expect(ctl.outbox.undoable).toBeNull();
    expect(ctl.outbox.closeQuestion()).toMatch(/Hay 1 mensaje/);
    await pass(3 * 3600_000 - 1000);
    expect(srv.sent).toHaveLength(0);
    await pass(31_000);
    expect(srv.sent).toHaveLength(1);
    const sent = inFolder('sent')[0]!;
    expect(parseMessage(rawOf(sent)).date!.getTime()).toBeGreaterThanOrEqual(at);
    expect(sent.date).toBeGreaterThanOrEqual(at);
    expect(ctl.outbox.closeQuestion()).toBeNull();
  });

  it('se cambia la hora, o se manda ya', async () => {
    await ctl.send(compose(), 'a1', { at: NOW + 3600_000 });
    const m = inFolder('outbox')[0]!;
    ctl.outbox.retime(m.id, NOW + 2 * 3600_000);
    await pass(3700_000);
    expect(srv.sent).toHaveLength(0);
    await ctl.outbox.sendNow(m.id);
    expect(srv.sent).toHaveLength(1);
  });

  it('se guarda en el archivo y sale al volver a abrirlo; pasado más de un día no sale sin preguntar', async () => {
    await ctl.send(compose({ subject: 'Pronto' }), 'a1', { at: NOW + 60_000 });
    await ctl.send(compose({ subject: 'Viejo' }), 'a1', { at: NOW + 120_000 });
    const saved = serializeMail(ctl.data);
    ctl.newDoc();
    await pass(300_000);
    expect(srv.sent).toHaveLength(0);
    const data = parseMailData(saved);
    data.messages.find((m) => m.subject === 'Viejo')!.outgoing!.at = NOW - 2 * 86400_000;
    ctl.load(data, 'correo.novamail', null);
    await pass(1000);
    expect(srv.sent).toHaveLength(1);
    const old = inFolder('outbox')[0]!;
    expect(old).toMatchObject({ subject: 'Viejo', outgoing: { held: true } });
    expect(ctl.outbox.status(old)).toMatch(/más de un día/);
    // lo retenido no cuenta al cerrar
    expect(ctl.outbox.closeQuestion()).toBeNull();
    await ctl.outbox.sendNow(old.id);
    expect(srv.sent).toHaveLength(2);
  });
});

describe('cuando no se puede enviar', () => {
  it('un fallo de red se reintenta cada vez más espaciado, y se dice una vez', async () => {
    await ctl.send(compose(), 'a1', { at: NOW + 1000 });
    srv.failOnly = 'mail_send';
    await pass(1500);
    const m = inFolder('outbox')[0]!;
    expect(m.outgoing).toMatchObject({ tries: 1 });
    expect(m.outgoing!.held).toBeUndefined();
    expect(ctl.alerts.toasts.map((x) => x.title)).toEqual(['No se pudo enviar «Hola»']);
    expect(shown.map((n) => n.title)).toEqual(['No se pudo enviar «Hola»']);
    await pass(61_000);
    expect(inFolder('outbox')[0]!.outgoing).toMatchObject({ tries: 2 });
    expect(shown).toHaveLength(1);
    srv.failOnly = null;
    await pass(125_000);
    expect(srv.sent).toHaveLength(1);
    expect(inFolder('outbox')).toHaveLength(0);
  });

  it('un rechazo definitivo se queda esperando a la persona', async () => {
    await ctl.send(compose(), 'a1', { at: NOW + 1000 });
    srv.failWith = 'Error de SMTP: 550 destinatario desconocido';
    await pass(1500);
    expect(inFolder('outbox')[0]!.outgoing).toMatchObject({ held: true, error: 'Error de SMTP: 550 destinatario desconocido' });
    srv.failWith = null;
    await pass(3600_000);
    expect(srv.sent).toHaveLength(0);
    await ctl.outbox.sendNow(inFolder('outbox')[0]!.id);
    expect(srv.sent).toHaveLength(1);
  });

  it('si falla al enviar en el momento, sigue escrito y se puede dejar en la bandeja', async () => {
    const c = write();
    srv.failOnly = 'mail_send';
    await expect(ctl.send(c, 'a1')).rejects.toThrow(/sin conexión/);
    expect(ctl.compose).toBe(c);
    await ctl.send(c, 'a1', { keep: 'Error de red: sin conexión' });
    expect(ctl.compose).toBeNull();
    expect(inFolder('outbox')[0]!.outgoing).toMatchObject({ kind: 'queued', tries: 1 });
    expect(ctl.outbox.status(inFolder('outbox')[0]!)).toMatch(/^No se pudo enviar \(Error de red: sin conexión\)\. Se reintentará/);
    expect(inFolder('drafts')).toHaveLength(0);
    srv.failOnly = null;
    await pass(61_000);
    expect(srv.sent).toHaveLength(1);
  });

  it('si la cuenta ya no existe, no sale con otra', async () => {
    await ctl.send(compose(), 'a1', { at: NOW + 1000 });
    ctl.accounts = [account('b2', 'Otra')];
    await pass(2000);
    expect(srv.sent).toHaveLength(0);
    expect(inFolder('outbox')[0]!.outgoing!.error).toMatch(/ya no existe/);
  });
});

describe('que nada salga dos veces', () => {
  it('dos ventanas con el mismo archivo lo envían una vez', async () => {
    await ctl.syncAll();
    await ctl.send(compose(), 'a1', { at: NOW + 60_000 });
    const other = await make();
    other.load(parseMailData(serializeMail(ctl.data)), 'correo.novamail', null);
    await pass(61_000);
    await pass(61_000);
    expect(srv.sent).toHaveLength(1);
    // one copy in Sent of the server, not one per window
    expect(srv.subjects('Sent')).toEqual(['Hola']);
    for (const c of [ctl, other]) {
      expect(inFolder('outbox', c)).toHaveLength(0);
      expect(inFolder('sent', c).map((m) => m.subject)).toEqual(['Hola']);
    }
  });

  it('si se cerró a mitad de un envío, pregunta antes de repetirlo', async () => {
    // where the browser cannot keep turns between windows, the other one is given time
    const before = globalThis.navigator;
    vi.stubGlobal('navigator', {});
    await ctl.send(compose(), 'a1', { at: NOW + 1000 });
    const m = inFolder('outbox')[0]!;
    store.set(`novamail.sent.${m.mid}`, JSON.stringify({ state: 'sending', at: NOW, by: 'otra ventana' }));
    // mientras puede seguir en marcha, espera
    await pass(2000);
    expect(srv.sent).toHaveLength(0);
    expect(inFolder('outbox')[0]!.outgoing!.held).toBeUndefined();
    await pass(6 * 60_000);
    expect(inFolder('outbox')[0]!.outgoing).toMatchObject({ held: true });
    expect(inFolder('outbox')[0]!.outgoing!.error).toMatch(/comprueba si llegó/);
    await ctl.outbox.sendNow(m.id);
    expect(srv.sent).toHaveLength(1);
    vi.stubGlobal('navigator', before);
  });

  it('con el turno del navegador, la segunda ventana espera y lo dejado a medias se retiene sin demora', async () => {
    const taken = new Set<string>();
    const before = globalThis.navigator;
    vi.stubGlobal('navigator', {
      locks: {
        request: async (name: string, _o: unknown, run: (lock: object | null) => Promise<unknown>) => {
          if (taken.has(name)) return run(null);
          taken.add(name);
          try {
            return await run({});
          } finally {
            taken.delete(name);
          }
        },
      },
    });
    try {
      await ctl.send(compose(), 'a1', { at: NOW + 1000 });
      const m = inFolder('outbox')[0]!;
      // another window holds the turn: nothing happens here, and it is looked at later
      taken.add(`novamail.sent.${m.mid}`);
      await pass(2000);
      expect(srv.sent).toHaveLength(0);
      expect(m.outgoing!.at).toBeGreaterThan(NOW + 30_000);
      // that window is gone leaving it half sent: nobody is sending it, so it is held at once
      taken.clear();
      store.set(`novamail.sent.${m.mid}`, JSON.stringify({ state: 'sending', at: Date.now(), by: 'otra' }));
      await pass(70_000);
      expect(inFolder('outbox')[0]!.outgoing).toMatchObject({ held: true });
      expect(srv.sent).toHaveLength(0);
    } finally {
      vi.stubGlobal('navigator', before);
    }
  });

  it('mientras se envía no se puede borrar, mover ni recuperar', async () => {
    let release = () => {};
    const slow: Transport = async (cmd, args) => {
      if (cmd === 'mail_send') await new Promise<void>((done) => (release = done));
      return srv.transport(cmd, args);
    };
    setTransport(slow);
    await ctl.send(compose(), 'a1', { at: NOW + 100 });
    const id = inFolder('outbox')[0]!.id;
    await pass(200);
    expect(ctl.outbox.isSending(id)).toBe(true);
    ctl.delete(id);
    expect(ctl.move(id, 'archive')).toBe(false);
    expect(ctl.outbox.takeBack(id)).toBe(false);
    expect(inFolder('outbox').map((m) => m.id)).toEqual([id]);
    release();
    await pass(10);
    expect(srv.sent).toHaveLength(1);
    expect(inFolder('outbox')).toHaveLength(0);
  });
});

describe('quitar algo de la Bandeja de salida', () => {
  it('eliminado o movido ya no se envía; deshacer lo trae como borrador; nada se mueve a ella', async () => {
    await ctl.send(compose({ subject: 'Uno' }), 'a1', { at: NOW + 60_000 });
    await ctl.send(compose({ subject: 'Dos' }), 'a1', { at: NOW + 60_000 });
    const [uno, dos] = [...inFolder('outbox')].sort((a, b) => b.subject.localeCompare(a.subject));
    ctl.delete(uno!.id);
    expect(ctl.data.messages.find((m) => m.id === uno!.id)).toMatchObject({ folder: 'trash' });
    expect(ctl.data.messages.find((m) => m.id === uno!.id)!.outgoing).toBeUndefined();
    ctl.undo();
    expect(ctl.data.messages.find((m) => m.id === uno!.id)).toMatchObject({ folder: 'drafts' });
    expect(ctl.move(dos!.id, 'archive')).toBe(true);
    expect(ctl.move(dos!.id, 'outbox')).toBe(false);
    await pass(120_000);
    expect(srv.sent).toHaveLength(0);
  });
});

describe('avisos de correo nuevo', () => {
  const arrive = (key: string, subject: string) => srv.deliver(FakeServer.mail(key, subject));

  it('la primera sincronización no avisa; después, lo nuevo sin leer', async () => {
    await ctl.syncAll();
    expect(ctl.alerts.toasts).toEqual([]);
    arrive('10', 'Recién llegado');
    await ctl.syncAll();
    expect(ctl.alerts.toasts).toMatchObject([{ title: 'Ana', text: 'Recién llegado' }]);
    expect(shown).toMatchObject([{ title: 'Ana', body: 'Recién llegado' }]);
    await pass(10_100);
    expect(ctl.alerts.toasts).toEqual([]);
    arrive('11', 'A');
    arrive('12', 'B');
    await ctl.syncAll();
    expect(ctl.alerts.toasts[0]!.title).toBe('2 mensajes nuevos');
    // pulsar el aviso de Windows lleva al mensaje
    ctl.go('calendar');
    press({ id: shown.at(-1)!.id, action: 'open' });
    ctl.alerts.pressed({ id: shown.at(-1)!.id, action: 'open' });
    expect(ctl.section).toBe('mail');
    expect(ctl.selected!.subject).toMatch(/^[AB]$/);
  });

  it('se pueden apagar, enteros o solo los de Windows; lo bloqueado no avisa', async () => {
    srv.add('Junk', ['\\Junk']);
    await ctl.syncAll();
    ctl.organize.addSender('blocked', '@x.es');
    arrive('10', 'Publicidad');
    await ctl.syncAll();
    expect(ctl.alerts.toasts).toEqual([]);
    ctl.organize.removeSender('blocked', '@x.es');
    ctl.alerts.set({ system: false });
    arrive('11', 'Visible');
    await ctl.syncAll();
    expect(ctl.alerts.toasts).toHaveLength(1);
    expect(shown).toEqual([]);
    ctl.alerts.set({ newMail: false });
    arrive('12', 'Callado');
    await ctl.syncAll();
    expect(ctl.alerts.toasts).toHaveLength(1);
    expect((await make()).alerts.settings).toMatchObject({ newMail: false, system: false });
  });
});

describe('recibir al instante', () => {
  it('lo que llega se trae solo, sin esperar a sincronizar', async () => {
    await ctl.syncAll();
    ctl.alerts.enableWatch();
    await pass(10);
    expect(ctl.alerts.watching.get('a1')).toBe('instant');
    srv.calls.length = 0;
    srv.deliver(FakeServer.mail('10', 'Al instante'));
    await pass(1000);
    expect(subjects('inbox')).toContain('Al instante');
    expect(ctl.alerts.toasts.map((x) => x.text)).toEqual(['Al instante']);
    expect(srv.calls.filter((x) => x === 'mail_folder_state')).toHaveLength(1);
    // sigue escuchando
    srv.deliver(FakeServer.mail('11', 'Otro más'));
    await pass(1000);
    expect(subjects('inbox')).toContain('Otro más');
  });

  it('un servidor que no avisa se deja para la sincronización; apagado, no se pregunta', async () => {
    srv.idle = false;
    ctl.alerts.enableWatch();
    await pass(60_000);
    expect(ctl.alerts.watching.get('a1')).toBe('polling');
    expect(srv.calls.filter((x) => x === 'mail_wait')).toHaveLength(1);
    ctl.alerts.set({ instant: false });
    expect(ctl.alerts.watching.size).toBe(0);
    srv.calls.length = 0;
    await pass(60_000);
    expect(srv.calls).not.toContain('mail_wait');
  });

  it('sin conexión reintenta y se recupera', async () => {
    await ctl.syncAll();
    srv.failOnly = 'mail_wait';
    ctl.alerts.enableWatch();
    await pass(10);
    expect(ctl.alerts.watching.get('a1')).toBe('retrying');
    srv.calls.length = 0;
    await pass(29_000);
    expect(srv.calls).not.toContain('mail_wait');
    srv.failOnly = null;
    await pass(2000);
    expect(ctl.alerts.watching.get('a1')).toBe('instant');
  });

  it('al quitar la cuenta se deja de escuchar', async () => {
    ctl.alerts.enableWatch();
    await pass(10);
    srv.accounts = [];
    await ctl.loadAccounts();
    expect(ctl.alerts.watching.size).toBe(0);
    srv.calls.length = 0;
    srv.wake();
    await pass(1000);
    expect(srv.calls).not.toContain('mail_wait');
  });
});

describe('recordatorios', () => {
  it('Windows los dice una vez, con posponer y descartar', async () => {
    const e = { ...newEvent(NOW + 10 * 60_000, NOW + 70 * 60_000, 'Reunión'), reminder: 15 };
    ctl.addEvent(e);
    const m = addRaw(ctl.data, 'inbox', 'From: a@x.es\r\nSubject: Llamar\r\n\r\nx\r\n');
    ctl.followMany([m.id], null, NOW - 1000);
    ctl.alerts.reminders(ctl.dueReminders());
    ctl.alerts.reminders(ctl.dueReminders());
    expect(shown.map((n) => n.title)).toEqual(['Llamar', 'Reunión']);
    expect(shown[1]!.actions!.map((a) => a.id)).toEqual(['snooze', 'dismiss']);
    ctl.alerts.pressed({ id: shown[1]!.id, action: 'snooze' });
    expect(ctl.dueReminders().map((r) => r.title)).toEqual(['Llamar']);
    // pasado el tiempo, vuelve a decirlo
    await pass(10 * 60_000 + 1000);
    ctl.alerts.reminders(ctl.dueReminders());
    expect(shown.map((n) => n.title)).toEqual(['Llamar', 'Reunión', 'Reunión']);
    ctl.alerts.pressed({ id: shown[2]!.id, action: 'dismiss' });
    ctl.alerts.pressed({ id: shown[0]!.id, action: 'dismiss' });
    expect(ctl.dueReminders()).toEqual([]);
    expect(m.flagged).toBe(true);
    // pulsar el aviso de una cita lleva al calendario
    ctl.alerts.pressed({ id: shown[2]!.id, action: 'open' });
    expect([ctl.section, ctl.selectedEvent]).toEqual(['calendar', e.id]);
  });
});
