import { describe, expect, it } from 'vitest';
import {
  addRaw,
  buildMessage,
  contactsFromCsv,
  contactsToCsv,
  decodeWords,
  deleteMessage,
  emptyFolder,
  encodeHeader,
  expandEvent,
  inFolder,
  newEvent,
  newMailData,
  newTask,
  parseAddresses,
  parseIcs,
  parseMailData,
  parseMbox,
  parseMessage,
  parseVcf,
  quoteText,
  rawOf,
  reSubject,
  searchMessages,
  serializeMail,
  unreadCount,
  writeIcs,
  writeMbox,
  writeVcf,
  type CalEvent,
} from './index';

const CRLF = (s: string) => s.replace(/\n/g, '\r\n');

describe('addresses and encoded words', () => {
  it('decodes RFC 2047 words in B and Q form, across charsets, and joins adjacent words', () => {
    expect(decodeWords('=?UTF-8?B?w4FuZ2VsIE11w7Fveg==?=')).toBe('Ángel Muñoz');
    expect(decodeWords('=?ISO-8859-1?Q?Jos=E9_Mar=EDa?=')).toBe('José María');
    expect(decodeWords('=?UTF-8?Q?a?= =?UTF-8?Q?b?=')).toBe('ab');
    expect(decodeWords('plain subject')).toBe('plain subject');
  });

  it('parses address lists with quoted commas, comments, groups and bare addresses', () => {
    expect(parseAddresses('"Pérez, Ana" <ana@x.org>, bob@y.com, =?UTF-8?B?w4FuZ2Vs?= <angel@z.es> (comentario)')).toEqual([
      { name: 'Pérez, Ana', email: 'ana@x.org' },
      { name: '', email: 'bob@y.com' },
      { name: 'Ángel', email: 'angel@z.es' },
    ]);
    expect(parseAddresses('Equipo: a@b.com, c@d.com;')).toEqual([{ name: '', email: 'a@b.com' }, { name: '', email: 'c@d.com' }]);
    expect(parseAddresses('')).toEqual([]);
  });

  it('encodes non-ASCII headers so that they read back', () => {
    const h = encodeHeader('Reunión de planificación – ñandú 日本語');
    expect(h).toMatch(/^=\?UTF-8\?B\?/);
    expect(decodeWords(h)).toBe('Reunión de planificación – ñandú 日本語');
    expect(encodeHeader('ascii only')).toBe('ascii only');
  });
});

describe('reading messages', () => {
  it('reads a simple message with folded headers, Latin-1 body and quoted-printable', () => {
    const raw = CRLF(`From: =?UTF-8?B?QW5hIFDDqXJleg==?= <ana@x.org>
To: bob@y.com,
 carla@z.com
Subject: Hola
 mundo
Date: Tue, 03 Sep 2024 10:15:00 +0200
Message-ID: <abc@x.org>
Content-Type: text/plain; charset=ISO-8859-1
Content-Transfer-Encoding: quoted-printable

Se=F1or, el caf=E9 est=E1 listo=
 ya.
`);
    const m = parseMessage(raw);
    expect(m.subject).toBe('Hola mundo');
    expect(m.from[0]).toEqual({ name: 'Ana Pérez', email: 'ana@x.org' });
    expect(m.to.map((a) => a.email)).toEqual(['bob@y.com', 'carla@z.com']);
    expect(m.date!.toISOString()).toBe('2024-09-03T08:15:00.000Z');
    expect(m.text).toContain('Señor, el café está listo ya.');
    expect(m.messageId).toBe('<abc@x.org>');
  });

  it('reads multipart/alternative with HTML, inline images and attachments (RFC 2231 file names)', () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const raw = CRLF(`From: a@b.c
Subject: Mixto
Content-Type: multipart/mixed; boundary="MIX"

--MIX
Content-Type: multipart/related; boundary="REL"

--REL
Content-Type: multipart/alternative; boundary="ALT"

--ALT
Content-Type: text/plain; charset=utf-8

Texto plano
--ALT
Content-Type: text/html; charset=utf-8

<p>Hola <img src="cid:logo@x"></p>
--ALT--

--REL
Content-Type: image/png
Content-ID: <logo@x>
Content-Disposition: inline
Content-Transfer-Encoding: base64

${png}
--REL--

--MIX
Content-Type: application/pdf; name="x.pdf"
Content-Disposition: attachment; filename*0*=utf-8''Informe%20; filename*1*=final%20%C3%B1.pdf
Content-Transfer-Encoding: base64

JVBERi0xLjQK
--MIX--
`);
    const m = parseMessage(raw);
    expect(m.text).toContain('Texto plano');
    expect(m.html).toContain('cid:logo@x');
    expect(m.inlineParts).toHaveLength(1);
    expect(m.inlineParts[0]!.cid).toBe('logo@x');
    expect(m.inlineParts[0]!.data.length).toBeGreaterThan(30);
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0]!.filename).toBe('Informe final ñ.pdf');
    expect(m.attachments[0]!.contentType).toBe('application/pdf');
    expect(new TextDecoder().decode(m.attachments[0]!.data)).toBe('%PDF-1.4\n');
  });

  it('keeps unreferenced inline images as attachments and survives broken input', () => {
    const raw = CRLF(`Subject: x
Content-Type: multipart/mixed; boundary=B

--B
Content-Type: text/plain

hola
--B
Content-Type: image/gif
Content-ID: <suelta>
Content-Transfer-Encoding: base64

R0lGODlhAQABAAAAACw=
--B--`);
    const m = parseMessage(raw);
    expect(m.attachments).toHaveLength(1);
    expect(parseMessage('').subject).toBe('');
    expect(parseMessage('sin cabeceras ni nada').text).not.toBeNull();
    expect(() => parseMessage('Content-Type: multipart/mixed\r\n\r\nx')).not.toThrow();
    expect(parseMessage('Content-Type: text/plain; charset=raro-9\r\n\r\nhola').warnings[0]).toMatch(/raro-9/);
  });
});

describe('building messages', () => {
  const from = { name: 'Ana Pérez', email: 'ana@x.org' };

  it('writes a plain message that reads back, keeping Bcc out of the headers', () => {
    const raw = buildMessage({ from, to: [{ name: 'Bob, el Jefe', email: 'bob@y.com' }], cc: [{ name: '', email: 'c@z.com' }], bcc: [{ name: '', email: 'secreto@z.com' }], subject: 'Reunión ñ – prueba', text: 'Línea uno con acentos: áéíóú\nLínea dos   \n', date: new Date('2024-05-01T12:00:00Z') });
    expect(raw).not.toContain('secreto');
    expect(raw).toContain('\r\n\r\n');
    for (const line of raw.split('\r\n')) expect(line.length).toBeLessThanOrEqual(998);
    const m = parseMessage(raw);
    expect(m.subject).toBe('Reunión ñ – prueba');
    expect(m.from[0]).toEqual(from);
    expect(m.to[0]).toEqual({ name: 'Bob, el Jefe', email: 'bob@y.com' });
    expect(m.cc[0]!.email).toBe('c@z.com');
    expect(m.text).toBe('Línea uno con acentos: áéíóú\r\nLínea dos   \r\n'.replace(/\r\n/g, '\r\n'));
    expect(m.date!.toISOString()).toBe('2024-05-01T12:00:00.000Z');
    expect(m.messageId).toMatch(/^<.+@x\.org>$/);
  });

  it('writes HTML alternatives and attachments, with long lines and binary data', () => {
    const data = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) % 256);
    const html = '<p>' + 'palabra '.repeat(400) + 'ñ</p>';
    const raw = buildMessage({ from, to: [{ name: '', email: 'b@y.com' }], subject: 'Adjunto', text: 'texto', html, attachments: [{ filename: 'datos ñ.bin', contentType: 'application/octet-stream', data }] });
    for (const line of raw.split('\r\n')) expect(line.length).toBeLessThanOrEqual(998);
    const m = parseMessage(raw);
    expect(m.text).toContain('texto');
    expect(m.html).toContain('palabra palabra');
    expect(m.html!.trim().endsWith('ñ</p>')).toBe(true);
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0]!.filename).toBe('datos ñ.bin');
    expect([...m.attachments[0]!.data]).toEqual([...data]);
  });

  it('keeps threading headers', () => {
    const m = parseMessage(buildMessage({ from, to: [{ name: '', email: 'b@y.com' }], subject: 'Re: x', text: 'ok', inReplyTo: '<a@b>', references: ['<z@b>', '<a@b>'] }));
    expect(m.inReplyTo).toBe('<a@b>');
    expect(m.references).toEqual(['<z@b>', '<a@b>']);
  });
});

describe('mbox', () => {
  it('splits and writes mbox files, escaping From lines in bodies', () => {
    const a = buildMessage({ from: { name: '', email: 'a@x' }, to: [{ name: '', email: 'b@x' }], subject: 'Uno', text: 'hola\nFrom aquí no se corta\n>From tampoco' });
    const b = buildMessage({ from: { name: '', email: 'c@x' }, to: [{ name: '', email: 'b@x' }], subject: 'Dos', text: 'adiós' });
    const mbox = writeMbox([{ raw: a, from: 'a@x' }, { raw: b, from: 'c@x' }]);
    expect(mbox.startsWith('From a@x ')).toBe(true);
    expect(mbox).toMatch(/^>From aqu/m);
    const back = parseMbox(mbox);
    expect(back).toHaveLength(2);
    expect(parseMessage(back[0]!).text).toContain('From aquí no se corta');
    expect(parseMessage(back[0]!).text).toContain('>From tampoco');
    expect(parseMessage(back[1]!).subject).toBe('Dos');
  });
});

describe('iCalendar', () => {
  it('reads events: UTC, IANA zones, floating, all-day, duration, reminders, folded lines and escapes', () => {
    const ics = CRLF(`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:1@x
DTSTART:20240910T090000Z
DTEND:20240910T100000Z
SUMMARY:Reunión\\, con coma
DESCRIPTION:Línea 1\\nLínea 2 que es larga y se
  pliega en dos
LOCATION:Sala 3
BEGIN:VALARM
TRIGGER:-PT15M
ACTION:DISPLAY
END:VALARM
END:VEVENT
BEGIN:VEVENT
UID:2@x
DTSTART;TZID=Europe/Madrid:20240115T100000
DURATION:PT90M
SUMMARY:Madrid
END:VEVENT
BEGIN:VEVENT
UID:3@x
DTSTART;VALUE=DATE:20240501
DTEND;VALUE=DATE:20240503
SUMMARY:Dos días
END:VEVENT
END:VCALENDAR`);
    const { events, warnings } = parseIcs(ics);
    expect(warnings).toEqual([]);
    expect(events).toHaveLength(3);
    const [a, b, c] = events as [CalEvent, CalEvent, CalEvent];
    expect(a.title).toBe('Reunión, con coma');
    expect(a.description).toBe('Línea 1\nLínea 2 que es larga y se pliega en dos');
    expect(a.start).toBe(Date.UTC(2024, 8, 10, 9));
    expect(a.reminder).toBe(15);
    expect(b.start).toBe(Date.UTC(2024, 0, 15, 9)); // Madrid is UTC+1 in January
    expect(b.end - b.start).toBe(90 * 60000);
    expect(c.allDay).toBe(true);
    expect(c.end - c.start).toBe(2 * 86400000);
  });

  it('handles Outlook-style custom time zones (fixed offset, with a warning) and unknown ones', () => {
    const ics = CRLF(`BEGIN:VCALENDAR
BEGIN:VTIMEZONE
TZID:Romance Standard Time
BEGIN:STANDARD
DTSTART:16010101T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:1
DTSTART;TZID=Romance Standard Time:20240115T100000
DTEND;TZID=Romance Standard Time:20240115T110000
SUMMARY:A
END:VEVENT
BEGIN:VEVENT
UID:2
DTSTART;TZID=Zona Inventada:20240115T100000
SUMMARY:B
END:VEVENT
END:VCALENDAR`);
    const { events, warnings } = parseIcs(ics);
    expect(events[0]!.start).toBe(Date.UTC(2024, 0, 15, 9));
    expect(warnings.some((w) => w.includes('Romance Standard Time'))).toBe(true);
    expect(warnings.some((w) => w.includes('Zona Inventada'))).toBe(true);
  });

  it('reads and writes tasks', () => {
    const t1 = { ...newTask('Pagar la factura'), due: new Date(2024, 5, 30).getTime(), priority: 'high' as const, notes: 'con; punto y coma' };
    const t2 = { ...newTask('Hecha'), done: true, completedAt: Date.UTC(2024, 5, 1, 12) };
    const { tasks } = parseIcs(writeIcs([], [t1, t2]));
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ title: 'Pagar la factura', priority: 'high', notes: 'con; punto y coma', done: false });
    expect(new Date(tasks[0]!.due!).getDate()).toBe(30);
    expect(tasks[1]).toMatchObject({ done: true, completedAt: Date.UTC(2024, 5, 1, 12) });
  });

  it('writes calendars that read back, folding long lines without splitting characters', () => {
    const e = { ...newEvent(Date.UTC(2024, 2, 1, 8), Date.UTC(2024, 2, 1, 9), 'ñ'.repeat(120)), description: 'a, b; c\nd', location: 'Aquí', rrule: 'FREQ=WEEKLY;BYDAY=MO', reminder: 30 };
    const day = { ...newEvent(new Date(2024, 3, 2).getTime(), new Date(2024, 3, 3).getTime(), 'Festivo'), allDay: true };
    const text = writeIcs([e, day]);
    for (const l of text.split('\r\n')) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    const { events } = parseIcs(text);
    expect(events[0]).toMatchObject({ title: 'ñ'.repeat(120), description: 'a, b; c\nd', location: 'Aquí', rrule: 'FREQ=WEEKLY;BYDAY=MO', reminder: 30, start: e.start, end: e.end });
    expect(events[1]).toMatchObject({ allDay: true, start: day.start, end: day.end });
  });

  it('expands recurrences: weekly with several days, monthly by position, count, until, exceptions, yearly', () => {
    const at = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h).getTime();
    const mk = (rrule: string, start = at(2024, 1, 1), extra: Partial<CalEvent> = {}): CalEvent => ({ ...newEvent(start, start + 3600000, 'e'), rrule, ...extra });
    const days = (e: CalEvent, from: number, to: number) => expandEvent(e, from, to).map((o) => new Date(o.start).toISOString().slice(0, 10) === '' ? '' : `${new Date(o.start).getMonth() + 1}/${new Date(o.start).getDate()}`);

    // 2024-01-01 is a Monday
    expect(days(mk('FREQ=WEEKLY;BYDAY=MO,WE'), at(2024, 1, 1, 0), at(2024, 1, 15, 0))).toEqual(['1/1', '1/3', '1/8', '1/10']);
    expect(days(mk('FREQ=DAILY;COUNT=3'), at(2024, 1, 1, 0), at(2024, 2, 1, 0))).toEqual(['1/1', '1/2', '1/3']);
    expect(days(mk('FREQ=DAILY;INTERVAL=2;UNTIL=20240107T235959Z'), at(2024, 1, 1, 0), at(2024, 2, 1, 0))).toEqual(['1/1', '1/3', '1/5', '1/7']);
    expect(days(mk('FREQ=MONTHLY;BYDAY=2TU'), at(2024, 1, 1, 0), at(2024, 4, 1, 0))).toEqual(['1/9', '2/13', '3/12']);
    expect(days(mk('FREQ=MONTHLY;BYDAY=-1FR'), at(2024, 1, 1, 0), at(2024, 3, 1, 0))).toEqual(['1/26', '2/23']);
    expect(days(mk('FREQ=MONTHLY', at(2024, 1, 31)), at(2024, 1, 1, 0), at(2024, 6, 1, 0))).toEqual(['1/31', '3/31', '5/31']); // months without a 31st are skipped
    expect(days(mk('FREQ=YEARLY'), at(2024, 1, 1, 0), at(2027, 1, 1, 0))).toEqual(['1/1', '1/1', '1/1']);
    expect(days(mk('FREQ=WEEKLY', at(2024, 1, 1), { exdates: [at(2024, 1, 8)] }), at(2024, 1, 1, 0), at(2024, 1, 23, 0))).toEqual(['1/1', '1/15', '1/22']);
    // COUNT counts occurrences before the visible window too
    expect(days(mk('FREQ=DAILY;COUNT=5'), at(2024, 1, 4, 0), at(2024, 2, 1, 0))).toEqual(['1/4', '1/5']);
    // a single event, and one that only overlaps the window
    expect(expandEvent(mk(''), at(2024, 1, 1, 9) + 1800000, at(2024, 1, 2, 0))).toHaveLength(1);
    expect(expandEvent(mk(''), at(2024, 1, 2, 0), at(2024, 1, 3, 0))).toHaveLength(0);
    // unknown rules fall back to a single event instead of failing
    expect(expandEvent(mk('FREQ=SECONDLY'), at(2024, 1, 1, 0), at(2024, 1, 2, 0))).toHaveLength(1);
  });
});

describe('contacts', () => {
  it('reads vCard 3.0 and 2.1 (quoted-printable, charset), and writes cards that read back', () => {
    const v3 = CRLF(`BEGIN:VCARD
VERSION:3.0
FN:Ana Pérez
N:Pérez;Ana;;;
ORG:ACME\\, S.L.;Ventas
TITLE:Directora
EMAIL;TYPE=INTERNET,WORK:ana@acme.es
TEL;TYPE=CELL:+34 600 000 000
ADR;TYPE=WORK:;;Calle Mayor 1;Madrid;;28001;España
BDAY:19800214
NOTE:Línea 1\\nLínea 2
END:VCARD`);
    const v21 = CRLF(`BEGIN:VCARD
VERSION:2.1
N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Mu=C3=B1oz;=C3=81ngel
TEL;HOME:915 55 55 55
EMAIL:angel@x.es
END:VCARD`);
    const { contacts } = parseVcf(v3 + '\r\n' + v21);
    expect(contacts).toHaveLength(2);
    expect(contacts[0]).toMatchObject({ name: 'Ana Pérez', first: 'Ana', last: 'Pérez', org: 'ACME, S.L. – Ventas', title: 'Directora', birthday: '1980-02-14', note: 'Línea 1\nLínea 2' });
    expect(contacts[0]!.emails).toEqual([{ label: 'trabajo', value: 'ana@acme.es' }]);
    expect(contacts[0]!.phones).toEqual([{ label: 'móvil', value: '+34 600 000 000' }]);
    expect(contacts[0]!.address).toContain('Calle Mayor 1');
    expect(contacts[1]).toMatchObject({ name: 'Ángel Muñoz', first: 'Ángel', last: 'Muñoz' });
    expect(contacts[1]!.phones[0]).toEqual({ label: 'casa', value: '915 55 55 55' });
    const again = parseVcf(writeVcf(contacts)).contacts;
    expect(again.map((c) => c.name)).toEqual(['Ana Pérez', 'Ángel Muñoz']);
    expect(again[0]).toMatchObject({ org: 'ACME, S.L. – Ventas', birthday: '1980-02-14', note: 'Línea 1\nLínea 2' });
    expect(parseVcf('no es un vCard').warnings).toHaveLength(1);
  });

  it('imports and exports contacts as CSV with Outlook-like and Spanish headers', () => {
    const rows = [
      ['Nombre', 'Apellidos', 'Correo electrónico', 'Teléfono móvil', 'Empresa'],
      ['Ana', 'Pérez', 'ana@x.es', '600', 'ACME'],
      ['', '', '', '', ''],
      ['Luis', '', 'luis@y.es', '', ''],
    ];
    const { contacts } = contactsFromCsv(rows);
    expect(contacts).toHaveLength(2);
    expect(contacts[0]).toMatchObject({ name: 'Ana Pérez', org: 'ACME' });
    expect(contacts[0]!.emails[0]!.value).toBe('ana@x.es');
    expect(contactsFromCsv([['a', 'b'], ['1', '2']]).warnings[0]).toMatch(/columna/);
    const out = contactsToCsv(contacts);
    expect(out[0]![3]).toBe('Correo electrónico');
    expect(out[1]![3]).toBe('ana@x.es');
    expect(contactsFromCsv(out).contacts.map((c) => c.name)).toEqual(['Ana Pérez', 'Luis']);
  });
});

describe('mail store', () => {
  const raw = (subject: string, text: string, to = 'yo@x.org', from = 'Ana <ana@y.org>') => buildMessage({ from: { name: from.split(' <')[0]!, email: from.split('<')[1]!.replace('>', '') }, to: [{ name: '', email: to }], subject, text });

  it('indexes messages, searches without accents, counts unread and orders by date', () => {
    const d = newMailData();
    const a = addRaw(d, 'inbox', raw('Presupuesto 2025', 'Adjunto la propuesta económica'));
    addRaw(d, 'inbox', raw('Cumpleaños', 'Tarta de limón el viernes', 'yo@x.org', 'Luis <luis@z.org>'));
    addRaw(d, 'sent', raw('Re: Presupuesto', 'Gracias'));
    expect(unreadCount(d, 'inbox')).toBe(2);
    a.read = true;
    expect(unreadCount(d, 'inbox')).toBe(1);
    expect(searchMessages(d, 'economica propuesta', null)).toHaveLength(1);
    expect(searchMessages(d, 'presupuesto', 'inbox')).toHaveLength(1);
    expect(searchMessages(d, 'presupuesto', null)).toHaveLength(2);
    expect(searchMessages(d, 'luis', null)[0]!.subject).toBe('Cumpleaños');
    expect(inFolder(d, 'inbox')).toHaveLength(2);
    expect(parseMessage(rawOf(a)).subject).toBe('Presupuesto 2025');
    expect(a.preview).toContain('propuesta');
  });

  it('deletes to the trash first and for good from there; empties folders', () => {
    const d = newMailData();
    const a = addRaw(d, 'inbox', raw('Uno', 'x'));
    addRaw(d, 'trash', raw('Dos', 'y'));
    deleteMessage(d, a.id);
    expect(a.folder).toBe('trash');
    deleteMessage(d, a.id);
    expect(d.messages).toHaveLength(1);
    expect(emptyFolder(d, 'trash')).toBe(1);
    expect(d.messages).toHaveLength(0);
  });

  it('builds replies and forwards', () => {
    const r = raw('Presupuesto', 'Línea 1\nLínea 2');
    expect(quoteText(r, 'reply')).toContain('> Línea 1');
    expect(quoteText(r, 'forward')).toContain('Asunto: Presupuesto');
    expect(reSubject('Presupuesto', 'Re')).toBe('Re: Presupuesto');
    expect(reSubject('RE: Presupuesto', 'Re')).toBe('RE: Presupuesto');
    expect(reSubject('Fwd: x', 'Fwd')).toBe('Fwd: x');
  });

  it('saves and reads the data file, repairing what it can and refusing the rest', () => {
    const d = newMailData();
    d.owner = { name: 'Yo', email: 'yo@x.org' };
    addRaw(d, 'inbox', raw('Hola', 'mundo'), { read: true, flagged: true });
    d.events.push(newEvent(1, 2, 'Evento'));
    d.tasks.push(newTask('Tarea'));
    const back = parseMailData(serializeMail(d));
    expect(back.owner.email).toBe('yo@x.org');
    expect(back.messages[0]).toMatchObject({ subject: 'Hola', read: true, flagged: true });
    expect(back.events).toHaveLength(1);
    expect(back.tasks[0]!.title).toBe('Tarea');
    expect(back.folders.map((f) => f.id)).toEqual(['inbox', 'drafts', 'sent', 'archive', 'junk', 'trash']);
    expect(() => parseMailData('no json')).toThrow(/JSON/);
    expect(() => parseMailData('{"version":2}')).toThrow(/formato desconocido/);
    const odd = parseMailData(JSON.stringify({ version: 1, messages: [{ id: 'a', raw: 'eA==', folder: 'carpeta-rara' }, { nada: 1 }], events: [{}, { start: 1, end: 2 }] }));
    expect(odd.messages).toHaveLength(1);
    expect(odd.messages[0]!.folder).toBe('inbox');
    expect(odd.events).toHaveLength(1);
  });
});
