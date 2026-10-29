import { describe, expect, it } from 'vitest';
import { cleanAddress, guessType, outlookToMime, parseMessage, type OutlookMessage } from './index';

const msg = (over: Partial<OutlookMessage> = {}): OutlookMessage => ({
  subject: 'Reunión de proyecto',
  from: { name: 'Ana López', email: 'ana@ejemplo.es' },
  to: [{ name: 'Luis', email: 'luis@ejemplo.es' }],
  cc: [{ name: '', email: 'cc@ejemplo.es' }],
  bcc: [{ name: '', email: 'oculta@ejemplo.es' }],
  date: new Date(Date.UTC(2025, 2, 3, 10, 0, 0)),
  messageId: '<abc@ejemplo.es>',
  text: 'Hola Luis,\nnos vemos mañana.',
  html: null,
  read: true,
  attachments: [],
  ...over,
});
const parse = (m: OutlookMessage) => {
  const { raw, bcc } = outlookToMime(m);
  return { p: parseMessage(raw), raw, bcc };
};

describe('mensajes de Outlook convertidos a correo normal', () => {
  it('texto, remitente, destinatarios, fecha y Message-ID; el Cco no va en las cabeceras', () => {
    const { p, raw, bcc } = parse(msg());
    expect(p.subject).toBe('Reunión de proyecto');
    expect(p.from[0]).toEqual({ name: 'Ana López', email: 'ana@ejemplo.es' });
    expect(p.to.map((a) => a.email)).toEqual(['luis@ejemplo.es']);
    expect(p.cc.map((a) => a.email)).toEqual(['cc@ejemplo.es']);
    expect(p.messageId).toBe('<abc@ejemplo.es>');
    expect(p.date?.toISOString()).toBe('2025-03-03T10:00:00.000Z');
    expect(p.text?.replace(/\r/g, '').trim()).toBe('Hola Luis,\nnos vemos mañana.');
    expect(bcc).toEqual(['oculta@ejemplo.es']);
    expect(raw).not.toContain('oculta@');
  });
  it('HTML con imágenes incrustadas y adjuntos', () => {
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const { p } = parse(msg({ html: '<p>Mira <img src="cid:logo123"></p>', attachments: [{ filename: 'logo.png', contentType: 'image/png', data: png, contentId: '<logo123>' }, { filename: 'Informe ñandú.pdf', contentType: '', data: new TextEncoder().encode('%PDF-1.4'), }] }));
    expect(p.html).toContain('cid:logo123');
    expect(p.text).toBeTruthy();
    expect(p.attachments.some((a) => a.filename === 'logo.png')).toBe(false);
    const inline = p.inlineParts.find((a) => a.filename === 'logo.png')!;
    expect(inline.cid).toBe('logo123');
    expect([...inline.data]).toEqual([...png]);
    const pdf = p.attachments.find((a) => a.filename === 'Informe ñandú.pdf')!;
    expect(pdf.contentType).toBe('application/pdf');
    expect(new TextDecoder().decode(pdf.data)).toBe('%PDF-1.4');
  });
  it('sin Message-ID se inventa uno estable; sin remitente ni fecha el mensaje sigue siendo legible', () => {
    const a = outlookToMime(msg({ messageId: undefined })).raw;
    const b = outlookToMime(msg({ messageId: undefined })).raw;
    expect(parseMessage(a).messageId).toBe(parseMessage(b).messageId);
    expect(parseMessage(a).messageId).toMatch(/^<[0-9a-f]{8}@outlook\.import>$/);
    const { p } = parse(msg({ from: null, date: null, messageId: 'no valido' }));
    expect(p.from[0]!.email).toBe('desconocido@invalid');
    expect(p.messageId).toMatch(/@outlook\.import>$/);
    expect(p.subject).toBe('Reunión de proyecto');
  });
  it('las direcciones internas de Exchange no se inventan como reales', () => {
    expect(cleanAddress('/O=EXCH/OU=GRUPO/CN=RECIPIENTS/CN=Ana.Lopez', undefined)).toBe('ana.lopez@exchange.invalid');
    expect(cleanAddress('/O=EXCH/CN=X', 'ana@ejemplo.es')).toBe('ana@ejemplo.es');
    expect(cleanAddress('ana@ejemplo.es')).toBe('ana@ejemplo.es');
    expect(cleanAddress('', '')).toBe('desconocido@invalid');
    expect(cleanAddress('Ana <ana@x.es>')).toBe('desconocido@invalid');
    const { p } = parse(msg({ to: [{ name: 'Ana', email: '/O=EXCH/CN=RECIPIENTS/CN=ana' }] }));
    expect(p.to[0]!.email).toBe('ana@exchange.invalid');
  });
  it('un asunto o nombre con saltos de línea no puede colar otra cabecera', () => {
    const { raw, p } = parse(msg({ subject: 'Hola\r\nBcc: x@y.z', from: { name: 'Ana\r\nX-Evil: 1', email: 'ana@ejemplo.es' }, attachments: [{ filename: 'a\r\nX-Evil: 2.txt', contentType: 'text/plain', data: new Uint8Array([65]) }] }));
    const head = raw.split('\r\n\r\n')[0]!;
    expect(head).not.toMatch(/^X-Evil/m);
    expect(head).not.toMatch(/^Bcc:/m);
    expect(p.subject).toBe('Hola Bcc: x@y.z');
  });
  it('tipos de archivo por extensión', () => {
    expect(guessType('a.PDF')).toBe('application/pdf');
    expect(guessType('x.desconocido')).toBe('application/octet-stream');
    expect(guessType('x.bin', 'Image/PNG')).toBe('image/png');
    expect(guessType('x.docx', 'basura')).toContain('wordprocessingml');
  });
});
