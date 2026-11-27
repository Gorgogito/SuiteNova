import { describe, expect, it } from 'vitest';
import { cancelPending, folderName, folderParents, remapFolder, toggleFavorite } from './folders';
import { parseMessage, rawHeaders } from './mime';
import { applyPlan, enqueueOp, planFolders } from './remote';
import { addRaw, newMailData, parseMailData, serializeMail, type MailData, type MailRecord } from './store';
import { conversationsOf, topicOf } from './threads';
import { parseTnef } from './tnef';
import { DEFAULT_VIEW, compareMessages, dateGroup, listRows, matchesFilter, readView } from './view';

const mail = (d: MailData, p: { subject?: string; from?: string; id?: string; refs?: string; date?: string; body?: string; folder?: string; read?: boolean; flagged?: boolean }): MailRecord =>
  addRaw(
    d,
    p.folder ?? 'inbox',
    `From: ${p.from ?? 'Ana <ana@x.es>'}\r\nTo: yo@x.es\r\nSubject: ${p.subject ?? 'Hola'}\r\n${p.id ? `Message-ID: ${p.id}\r\n` : ''}${p.refs ? `In-Reply-To: ${p.refs}\r\n` : ''}Date: ${p.date ?? 'Mon, 2 Mar 2026 10:00:00 +0000'}\r\n\r\n${p.body ?? 'x'}\r\n`,
    { read: p.read ?? true, flagged: p.flagged },
  );

describe('orden, filtros y grupos', () => {
  const d = newMailData();
  const a = mail(d, { subject: 'Re: zeta', from: 'Bea <bea@x.es>', date: 'Mon, 2 Mar 2026 10:00:00 +0000' });
  const b = mail(d, { subject: 'Alfa', from: 'ana <ana@x.es>', date: 'Tue, 3 Mar 2026 10:00:00 +0000', read: false, body: 'x'.repeat(20000) });
  const c = mail(d, { subject: 'media', from: 'Carlos <c@x.es>', date: 'Sun, 1 Mar 2026 10:00:00 +0000', flagged: true });
  const order = (sort: Parameters<typeof compareMessages>[0]['sort'], reverse = false) => [a, b, c].sort(compareMessages({ sort, reverse })).map((m) => m.subject);

  it('ordena por cada columna y al revés', () => {
    expect(order('date')).toEqual(['Alfa', 'Re: zeta', 'media']);
    expect(order('date', true)).toEqual(['media', 'Re: zeta', 'Alfa']);
    expect(order('from')).toEqual(['Alfa', 'Re: zeta', 'media']);
    expect(order('subject')).toEqual(['Alfa', 'media', 'Re: zeta']); // «Re:» no cuenta
    expect(order('size')[0]).toBe('Alfa');
    expect(order('flag')[0]).toBe('media');
  });

  it('filtra', () => {
    expect([a, b, c].filter((m) => matchesFilter(m, 'unread'))).toEqual([b]);
    expect([a, b, c].filter((m) => matchesFilter(m, 'flagged'))).toEqual([c]);
    expect([a, b, c].filter((m) => matchesFilter(m, 'attachments'))).toEqual([]);
  });

  it('agrupa por fecha como Outlook', () => {
    const now = new Date(2026, 2, 19, 15).getTime(); // jueves 19 de marzo
    const at = (m: number, day: number) => dateGroup(new Date(2026, m, day, 9).getTime(), now);
    expect(at(2, 19).label).toBe('Hoy');
    expect(at(2, 18).label).toBe('Ayer');
    expect(at(2, 16).day).toBeDefined(); // el lunes de esta semana
    expect(at(2, 13).label).toBe('La semana pasada');
    expect(at(2, 4).label).toBe('Hace dos semanas');
    expect(at(1, 26).label).toBe('Hace tres semanas');
    expect(at(1, 15).label).toBe('El mes pasado');
    expect(at(0, 15).label).toBe('Anteriores');
    expect(at(2, 25).label).toBe('Más adelante');
    expect(dateGroup(new Date(2026, 2, 2).getTime(), new Date(2026, 2, 31).getTime()).label).toBe('Este mes');
  });

  it('forma las filas, con grupos que se cierran', () => {
    const now = new Date(2026, 2, 3, 18).getTime();
    const rows = listRows({ messages: [a, b, c], view: DEFAULT_VIEW, now });
    expect(rows.map((r) => (r.type === 'group' ? `[${r.group.label || 'día'} ${r.count}]` : r.rec.subject))).toEqual(['[Hoy 1]', 'Alfa', '[Ayer 1]', 'Re: zeta', '[La semana pasada 1]', 'media']);
    const closed = listRows({ messages: [a, b, c], view: DEFAULT_VIEW, now, closed: new Set(['d:today']) });
    expect(closed.map((r) => r.key)).toEqual(['g:d:today', 'g:d:yesterday', `m:${a.id}`, 'g:d:week1', `m:${c.id}`]);
    expect(listRows({ messages: [a, b, c], view: { ...DEFAULT_VIEW, groups: false }, now })).toHaveLength(3);
  });

  it('no acepta una vista guardada que no entiende', () => {
    expect(readView({ sort: 'nada', filter: 7, groups: false })).toEqual({ ...DEFAULT_VIEW, groups: false });
    expect(readView(null)).toEqual(DEFAULT_VIEW);
  });
});

describe('conversaciones', () => {
  const d = newMailData();
  const first = mail(d, { subject: 'Cena', id: '<1@x>', date: 'Mon, 2 Mar 2026 10:00:00 +0000' });
  const answer = mail(d, { subject: 'Re: Cena', id: '<2@x>', refs: '<1@x>', folder: 'sent', date: 'Mon, 2 Mar 2026 11:00:00 +0000' });
  const loose = mail(d, { subject: 'RV: Re: Cena', id: '<3@x>', date: 'Mon, 2 Mar 2026 12:00:00 +0000' });
  const other = mail(d, { subject: 'Cena', id: '<9@x>', date: 'Tue, 3 Mar 2026 12:00:00 +0000' });

  it('une por referencias, y por asunto la respuesta que no nombra a nadie', () => {
    const t = conversationsOf(d.messages);
    expect(t.get(answer.id)).toBe(t.get(first.id));
    expect(t.get(loose.id)).toBe(t.get(first.id));
    expect(t.get(other.id)).not.toBe(t.get(first.id)); // mismo asunto, pero no es respuesta
    expect(topicOf('RE: Fwd: re[2]: Cena')).toBe('Cena');
  });

  it('saca las referencias de las cabeceras en los mensajes guardados antes de tenerlas', () => {
    const old = parseMailData(serializeMail(d)).messages;
    for (const m of old) delete m.refs;
    const t = conversationsOf(old);
    expect(t.get(old[1]!.id)).toBe(t.get(old[0]!.id));
    expect(old[1]!.refs).toEqual(['<1@x>']);
  });

  it('una conversación es una fila; abierta, enseña todos sus mensajes, también los de otras carpetas', () => {
    const of = conversationsOf(d.messages);
    const members = new Map<string, MailRecord[]>();
    for (const m of d.messages) members.set(of.get(m.id)!, [...(members.get(of.get(m.id)!) ?? []), m]);
    const view = { ...DEFAULT_VIEW, groups: false, conversations: true };
    const inbox = d.messages.filter((m) => m.folder === 'inbox');
    const rows = listRows({ messages: inbox, view, now: Date.now(), threads: { of, members } });
    expect(rows.map((r) => (r.type === 'message' ? r.rec.id : ''))).toEqual([other.id, loose.id]);
    const head = rows[1]!;
    expect(head.type === 'message' && head.thread).toMatchObject({ ids: [loose.id, first.id], open: false });
    const open = listRows({ messages: inbox, view, now: Date.now(), threads: { of, members }, open: new Set([of.get(first.id)!]) });
    expect(open.map((r) => r.key)).toEqual([`m:${other.id}`, `c:${of.get(first.id)}`, `m:${loose.id}`, `m:${answer.id}`, `m:${first.id}`]);
  });
});

// ------------------------------------------------------------------ winmail.dat

const le = (n: number, size: 2 | 4) => Array.from({ length: size }, (_, i) => (n >>> (8 * i)) & 0xff);
const bytes = (s: string) => [...new TextEncoder().encode(s)];
const utf16 = (s: string) => [...s].flatMap((c) => le(c.charCodeAt(0), 2));
const attr = (level: 1 | 2, id: number, data: number[]) => [level, ...le(id, 4), ...le(data.length, 4), ...data, 0, 0];
const prop = (type: number, id: number, data: number[]) => [...le(type, 2), ...le(id, 2), ...le(1, 4), ...le(data.length, 4), ...data, ...Array((4 - (data.length % 4)) % 4).fill(0)];
const tnef = (...attrs: number[][]) => Uint8Array.from([...le(0x223e9f78, 4), 1, 0, ...attrs.flat()]);

const SAMPLE = tnef(
  attr(1, 0x00069007, le(1252, 4)),
  attr(1, 0x00069003, [...le(1, 4), ...prop(0x0102, 0x1013, bytes('<p>Desde Outlook</p>'))]),
  attr(2, 0x00069002, Array(14).fill(0)),
  attr(2, 0x00018010, [...bytes('INFORM~1.PDF'), 0]),
  attr(2, 0x0006800f, bytes('%PDF-1.4 prueba')),
  attr(2, 0x00069005, [...le(1, 4), ...prop(0x001f, 0x3707, utf16('Informe año.pdf\0'))]),
  attr(2, 0x00069002, Array(14).fill(0)),
  attr(2, 0x00018010, [0x41, 0xf1, 0x6f, 0x2e, 0x74, 0x78, 0x74, 0]), // «Año.txt» en windows-1252
  attr(2, 0x0006800f, bytes('hola')),
);

describe('winmail.dat', () => {
  it('lee los archivos, sus nombres largos y el cuerpo', () => {
    const t = parseTnef(SAMPLE)!;
    expect(t.files.map((f) => [f.filename, f.contentType, new TextDecoder().decode(f.data)])).toEqual([
      ['Informe año.pdf', 'application/pdf', '%PDF-1.4 prueba'],
      ['Año.txt', 'text/plain', 'hola'],
    ]);
    expect(t.html).toBe('<p>Desde Outlook</p>');
  });

  it('no se rompe con datos cortados o que no lo son', () => {
    expect(parseTnef(new TextEncoder().encode('no es tnef'))).toBeNull();
    for (let n = 6; n < SAMPLE.length; n += 7) expect(() => parseTnef(SAMPLE.subarray(0, n))).not.toThrow();
    const broken = Uint8Array.from(SAMPLE);
    broken.set([0xff, 0xff, 0xff, 0x7f], 11); // una longitud imposible
    expect(parseTnef(broken)!.files).toEqual([]);
  });

  it('en un mensaje, sus archivos ocupan su lugar; si no se puede leer, se queda como llegó', () => {
    const b64 = Buffer.from(SAMPLE).toString('base64');
    const msg = (data: string) => `Subject: x\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nvéase\r\n--b\r\nContent-Type: application/ms-tnef; name="winmail.dat"\r\nContent-Disposition: attachment; filename="winmail.dat"\r\nContent-Transfer-Encoding: base64\r\n\r\n${data}\r\n--b--\r\n`;
    const m = parseMessage(msg(b64));
    expect(m.attachments.map((a) => a.filename)).toEqual(['Informe año.pdf', 'Año.txt']);
    expect(m.text?.trim()).toBe('véase');
    expect(m.html).toBe('<p>Desde Outlook</p>');
    expect(parseMessage(msg(Buffer.from('basura').toString('base64'))).attachments.map((a) => a.filename)).toEqual(['winmail.dat']);
  });

  it('enseña las cabeceras como llegaron', () => {
    expect(rawHeaders('Subject: =?utf-8?B?SG9sYQ==?=\r\nX-Raro: 1\r\n y sigue\r\n\r\ncuerpo')).toBe('Subject: =?utf-8?B?SG9sYQ==?=\nX-Raro: 1\n y sigue');
  });
});

// ------------------------------------------------------------------ carpetas

describe('carpetas', () => {
  const server = () => {
    const d = newMailData();
    applyPlan(d, 'a', planFolders('a', ['INBOX', 'Sent', 'Trabajo', 'Trabajo/Uno', 'Otra'].map((path) => ({ name: path, path, attrs: [] }))));
    d.folders.push({ id: 'f1', name: 'Local', system: false }, { id: 'f2', name: 'Hija', system: false, parent: 'f1' });
    return d;
  };

  it('dice adónde se puede mover cada una', () => {
    const d = server();
    expect(folderParents(d, 'inbox')).toEqual([]);
    expect(folderParents(d, 'f1')).toEqual([null, 'inbox', 'drafts', 'sent', 'archive', 'junk', 'trash']);
    expect(folderParents(d, 's:a:Trabajo')).toEqual([null, 'inbox', 'sent', 's:a:Otra']); // ni dentro de sí misma ni en las locales
  });

  it('comprueba el nombre', () => {
    const d = server();
    expect(folderName(d, '  Nueva ', null)).toBe('Nueva');
    expect(() => folderName(d, 'local', null)).toThrow('Ya existe');
    expect(folderName(d, 'LOCAL', null, 'f1')).toBe('LOCAL');
    expect(() => folderName(d, 'a/b', null)).toThrow('barras');
    expect(() => folderName(d, ' ', null)).toThrow();
  });

  it('un cambio de nombre en el servidor conserva mensajes, estado, cambios pendientes y favoritos', () => {
    const d = server();
    const m = mail(d, { folder: 's:a:Trabajo' });
    m.remote = { account: 'a', folder: 'Trabajo', key: '4' };
    d.sync = { 'a|Trabajo': { validity: '9' } };
    enqueueOp(d, { account: 'a', kind: 'move', folder: 'INBOX', keys: ['1'], to: 'Trabajo' });
    toggleFavorite(d, 's:a:Trabajo');
    remapFolder(d, 'a', { id: 's:a:Trabajo', name: 'Trabajo' }, { id: 's:a:Curro', name: 'Curro' });
    expect(m).toMatchObject({ folder: 's:a:Curro', remote: { folder: 'Curro', key: '4' } });
    expect(d.sync).toEqual({ 'a|Curro': { validity: '9' } });
    expect(d.pending![0]).toMatchObject({ to: 'Curro' });
    expect(d.favorites).toEqual(['s:a:Curro']);
    expect(d.folders.find((f) => f.id === 's:a:Trabajo/Uno')!.parent).toBe('s:a:Curro');
  });

  it('los favoritos se guardan con el archivo y solo los de carpetas que existen', () => {
    const d = server();
    toggleFavorite(d, 'f1');
    toggleFavorite(d, 'inbox');
    expect(parseMailData(serializeMail(d)).favorites).toEqual(['f1', 'inbox']);
    d.favorites!.push('no-existe');
    expect(parseMailData(serializeMail(d)).favorites).toEqual(['f1', 'inbox']);
    toggleFavorite(d, 'f1');
    toggleFavorite(d, 'inbox');
    toggleFavorite(d, 'no-existe');
    expect(d.favorites).toBeUndefined();
  });

  it('retira un cambio que aún no se envió', () => {
    const d = server();
    enqueueOp(d, { account: 'a', kind: 'move', folder: 'INBOX', keys: ['1', '2'], to: 'Trabajo' });
    const id = d.pending![0]!.id;
    expect(cancelPending(d, 'move', 'a', 'INBOX', '1', id)).toBe(false); // se está enviando
    expect(cancelPending(d, 'move', 'a', 'INBOX', '1')).toBe(true);
    expect(d.pending![0]).toMatchObject({ keys: ['2'] });
    expect(cancelPending(d, 'move', 'a', 'INBOX', '2')).toBe(true);
    expect(d.pending).toBeUndefined();
    expect(cancelPending(d, 'move', 'a', 'INBOX', '2')).toBe(false);
  });
});
