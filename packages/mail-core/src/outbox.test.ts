import { describe, expect, it } from 'vitest';
import {
  addRaw,
  buildMessage,
  decodeBase64,
  dismissReminder,
  dueReminders,
  encodeBase64,
  folderParents,
  isRetryable,
  newEvent,
  newMailData,
  parseMailData,
  parseMessage,
  pruneReminders,
  retryDelay,
  sendLaterPresets,
  serializeMail,
  setFollow,
  snoozeReminder,
  withSendDate,
  type MailData,
} from './index';

const at = (d: number, h = 12, m = 0) => new Date(2026, 5, d, h, m).getTime();
const message = (d: MailData, folder: string, body = 'Hola') =>
  addRaw(d, folder, buildMessage({ from: { name: 'Yo', email: 'yo@x.es' }, to: [{ name: '', email: 'a@x.es' }], cc: [], bcc: [], subject: 'Asunto ñ', text: body, attachments: [], date: new Date(at(1)) }));

describe('bandeja de salida', () => {
  it('la fecha del mensaje es la del envío, sin tocar nada más', () => {
    const d = newMailData();
    const rec = message(d, 'outbox', 'Date: esto es texto\r\nñandú — €');
    const sent = withSendDate(rec.raw, new Date(Date.UTC(2026, 6, 2, 9, 30)));
    const parsed = parseMessage(decodeBase64(sent));
    expect(parsed.date!.toISOString()).toBe('2026-07-02T09:30:00.000Z');
    expect(parsed.subject).toBe('Asunto ñ');
    expect(parsed.text).toContain('Date: esto es texto');
    expect(parsed.text).toContain('ñandú — €');
    expect(parsed.messageId).toBe(parseMessage(decodeBase64(rec.raw)).messageId);
    // solo cambia una línea
    const lines = (b: string) => new TextDecoder().decode(decodeBase64(b)).split('\r\n');
    expect(lines(sent).filter((l, i) => l !== lines(rec.raw)[i])).toHaveLength(1);
    // un mensaje sin cabecera Date se queda como estaba
    const bare = encodeBase64(new TextEncoder().encode('Subject: x\r\n\r\ny\r\n'));
    expect(withSendDate(bare, new Date())).toBe(bare);
  });

  it('qué fallos se reintentan y cuándo', () => {
    for (const m of ['Error de red: sin conexión', 'Error temporal de SMTP: 451 later', 'El servidor SMTP no respondió a tiempo.', 'No se pudo conectar con smtp.x.es:465: timed out', 'No se encontró el servidor smtp.x.es: dns']) expect(isRetryable(m), m).toBe(true);
    for (const m of ['Error de SMTP: 550 no such user', 'El servidor no aceptó el usuario o la contraseña.', 'No se pudo establecer la conexión segura (¿el certificado es válido?)', 'La dirección «x» no es válida.']) expect(isRetryable(m), m).toBe(false);
    expect([1, 2, 3, 4, 5, 9].map((n) => retryDelay(n) / 60000)).toEqual([1, 2, 5, 15, 30, 30]);
    expect(retryDelay(0)).toBe(60000);
  });

  it('las horas que se ofrecen para enviar más tarde', () => {
    // miércoles 10 de junio
    expect(sendLaterPresets(at(10, 9)).map((p) => p.at)).toEqual([at(10, 18), at(11, 8), at(15, 8)]);
    expect(sendLaterPresets(at(10, 17, 45)).map((p) => p.label)).toEqual(['Mañana a las 8:00', 'El lunes a las 8:00']);
    // en domingo, mañana ya es lunes
    expect(sendLaterPresets(at(14, 20)).map((p) => p.label)).toEqual(['Mañana a las 8:00']);
    // en lunes, el lunes que viene
    expect(sendLaterPresets(at(15, 20)).at(-1)!.at).toBe(at(22, 8));
  });

  it('se guarda; lo que no sabe cómo salir vuelve a Borradores', () => {
    const d = newMailData();
    const ok = message(d, 'outbox');
    ok.outgoing = { account: 'a', recipients: ['a@x.es'], at: at(2), kind: 'later', held: true, error: 'x', tries: 2 };
    const bad = message(d, 'outbox');
    bad.outgoing = { account: 'a', recipients: [], at: at(2), kind: 'later' };
    const loose = message(d, 'inbox');
    loose.outgoing = { ...ok.outgoing };
    const back = parseMailData(serializeMail(d));
    expect(back.messages.map((m) => [m.folder, m.outgoing?.kind])).toEqual([['outbox', 'later'], ['drafts', undefined], ['inbox', undefined]]);
    expect(back.messages[0]!.outgoing).toEqual(ok.outgoing);
    d.folders.push({ id: 'f1', name: 'Mía', system: false });
    expect(folderParents(d, 'f1')).not.toContain('outbox');
  });
});

describe('recordatorios', () => {
  const setup = () => {
    const d = newMailData();
    const e = { ...newEvent(at(10, 10), at(10, 11), 'Reunión'), reminder: 15 };
    d.events.push(e);
    return { d, e, key: `${e.id}@${at(10, 10)}` };
  };

  it('de una cita: a su hora, hasta que termina, y descartado no vuelve', () => {
    const { d, key } = setup();
    expect(dueReminders(d, at(10, 9, 44))).toEqual([]);
    expect(dueReminders(d, at(10, 9, 45))).toEqual([{ key, kind: 'event', title: 'Reunión', at: at(10, 10) }]);
    expect(dueReminders(d, at(10, 11))).toEqual([]);
    dismissReminder(d, key);
    expect(dueReminders(d, at(10, 10))).toEqual([]);
    expect(parseMailData(serializeMail(d)).reminders).toEqual({ [key]: { done: true } });
  });

  it('pospuesto: calla hasta entonces y vuelve aunque la cita haya pasado', () => {
    const { d, key } = setup();
    snoozeReminder(d, key, at(10, 12));
    expect(dueReminders(d, at(10, 10))).toEqual([]);
    expect(dueReminders(d, at(10, 12)).map((r) => r.key)).toEqual([key]);
    expect(dueReminders(d, at(30)).map((r) => r.title)).toEqual(['Reunión']);
    expect(parseMailData(serializeMail(d)).reminders).toEqual({ [key]: { until: at(10, 12) } });
    dismissReminder(d, key);
    expect(dueReminders(d, at(30))).toEqual([]);
  });

  it('de un mensaje: se pospone y se descarta', () => {
    const d = newMailData();
    const m = message(d, 'inbox');
    setFollow(m, null, at(10, 9));
    const key = `f:${m.id}`;
    expect(dueReminders(d, at(10, 9))).toMatchObject([{ key, kind: 'mail', messageId: m.id }]);
    snoozeReminder(d, key, at(10, 10));
    expect(dueReminders(d, at(10, 9, 30))).toEqual([]);
    expect(dueReminders(d, at(10, 10))).toHaveLength(1);
    dismissReminder(d, key);
    expect(m.follow).toBeUndefined();
    expect(m.flagged).toBe(true);
  });

  it('olvida lo de citas que ya no están o muy antiguas', () => {
    const { d, e, key } = setup();
    d.reminders = { [key]: { done: true }, 'nadie@1': { until: 5 } };
    pruneReminders(d, at(10));
    expect(Object.keys(d.reminders)).toEqual([key]);
    pruneReminders(d, at(10) + 40 * 86400000);
    expect(d.reminders).toBeUndefined();
    expect(e.id).toBeTruthy();
  });
});
