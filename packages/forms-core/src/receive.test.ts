import { describe, expect, it } from 'vitest';
import { MB } from './files';
import { answeredHtml, exportHtml } from './html';
import { newForm, newQuestion, type Form, type Question } from './model';
import { bodyLimit, receiveResponse, responseFileFor, type Reception } from './receive';

const q = (id: string, type: Question['type'], over: Partial<Question> = {}): Question => ({ ...newQuestion(type), id, ...over });
const form = (questions: Question[], over: Partial<Form> = {}): Form => ({ ...newForm(), id: 'f', questions, ...over });
const NOW = Date.parse('2026-06-01T12:00:00.000Z');
const sent = (answers: unknown, over: object = {}) => JSON.stringify({ format: 'novaforms-response', formId: 'f', id: 'r1', at: '2001-01-01T00:00:00Z', answers, ...over });
const refused = (r: Reception): string => (r.ok ? '' : r.message);

const base = form([q('t', 'text', { required: true }), q('n', 'number', { maxValue: 10 }), q('s', 'section'), q('o', 'choice', { options: ['A', 'B'] })]);

describe('una respuesta que llega sola', () => {
  it('se toma con la fecha de este equipo y solo con lo del formulario', () => {
    const r = receiveResponse(base, [], sent({ t: '  hola ', n: '3', o: 'A', otra: 'x' }, { name: 'Ana' }), NOW);
    expect(r).toEqual({ ok: true, duplicate: false, response: { id: 'r1', at: '2026-06-01T12:00:00.000Z', answers: { t: 'hola', n: 3, o: 'A' } } });
  });

  it('lo que no se entiende o es de otro formulario no entra', () => {
    for (const body of ['no', '5', 'null', '[]', JSON.stringify({ format: 'otro' }), sent([]), sent('x'), sent({ t: 'x' }, { id: '' }), sent({ t: 'x' }, { id: '../a' }), sent({ t: 'x' }, { id: 'a'.repeat(61) })]) expect(refused(receiveResponse(base, [], body, NOW)), body).toBe('La respuesta no se entiende.');
    expect(refused(receiveResponse(base, [], sent({ t: 'x' }, { formId: 'g' }), NOW))).toMatch(/otro formulario/);
    expect(refused(receiveResponse(base, [], sent({}), NOW))).toBe('La respuesta está vacía.');
  });

  it('lo no válido o lo que falta no entra: no se guarda a medias', () => {
    for (const answers of [{ t: 'x', n: 50 }, { t: 'x', o: 'Z' }, { n: 1 }, { t: '   ', n: 1 }]) expect(refused(receiveResponse(base, [], sent(answers), NOW)), JSON.stringify(answers)).toMatch(/no son válidas|vacía/);
  });

  it('con tiempo límite entra lo que quedó bien; sin él, decir que se acabó no sirve', () => {
    const answers = { n: 4, o: 'Z' };
    expect(refused(receiveResponse(base, [], sent(answers, { timed: true }), NOW))).toMatch(/no son válidas/);
    const r = receiveResponse({ ...base, timeLimit: 5, askName: true }, [], sent(answers, { timed: true }), NOW);
    expect(r.ok && r.response).toEqual({ id: 'r1', at: '2026-06-01T12:00:00.000Z', answers: { n: 4 } });
  });

  it('repetida: se da por recibida sin añadirla, aunque ya se haya cerrado', () => {
    const had = { id: 'r1', at: 'x', answers: { t: 'x' } };
    expect(receiveResponse({ ...base, closed: true }, [had], sent({ t: 'otra' }), NOW)).toEqual({ ok: true, duplicate: true, response: had });
  });

  it('el cierre y las fechas se imponen aquí, en el idioma del formulario', () => {
    expect(refused(receiveResponse({ ...base, closed: true, closedMessage: 'Fin' }, [], sent({ t: 'x' }), NOW))).toBe('Fin');
    expect(refused(receiveResponse({ ...base, end: '2026-06-01T11:00:00.000Z', language: 'en' }, [], sent({ t: 'x' }), NOW))).toBe('This form is no longer accepting responses.');
    expect(refused(receiveResponse({ ...base, start: '2026-07-01T00:00:00.000Z' }, [], sent({ t: 'x' }), NOW))).toMatch(/todavía no admite respuestas\. Empieza el /);
    expect(refused(receiveResponse({ ...base, language: 'en' }, [], 'x', NOW))).toBe('The response cannot be understood.');
  });

  it('el nombre, si se pide', () => {
    const f = { ...base, askName: true };
    expect(refused(receiveResponse(f, [], sent({ t: 'x' }, { name: '  ' }), NOW))).toBe('Escribe tu nombre.');
    const r = receiveResponse(f, [], sent({ t: 'x' }, { name: ' Ana ' }), NOW);
    expect(r.ok && r.response.name).toBe('Ana');
  });

  it('los archivos: lo que pesan de verdad, y el total de la respuesta', () => {
    const f = form([q('a', 'file', { maxFiles: 10 }), q('b', 'file', { maxFiles: 10 }), q('c', 'file', { maxFiles: 10 })]);
    const file = (name: string, mb: number) => ({ name, size: 1, type: 'text/plain', data: 'A'.repeat(Math.ceil((mb * MB) / 3) * 4) });
    const ok = receiveResponse(f, [], sent({ a: [file('a.txt', 1)] }), NOW);
    expect(ok.ok && (ok.response.answers.a as { size: number }[])[0]!.size).toBeGreaterThanOrEqual(MB);
    expect(refused(receiveResponse(f, [], sent({ a: [file('a.exe', 1)] }), NOW))).toMatch(/vacía|no son válidas/);
    expect(refused(receiveResponse(f, [], sent({ a: [file('a.txt', 9)], b: [file('b.txt', 9)], c: [file('c.txt', 9)] }), NOW))).toBe('Entre todos, los archivos pasan de 25 MB.');
    expect(bodyLimit(f)).toBeGreaterThan(33 * MB);
    expect(bodyLimit(base)).toBe(MB);
  });

  it('reconoce el archivo de una respuesta y de qué formulario es', () => {
    expect(responseFileFor(sent({ t: 'x' }))).toBe('f');
    for (const text of ['{}', 'x', 'null', JSON.stringify({ format: 'novaforms', form: {} }), JSON.stringify({ format: 'novaforms-response', formId: 7 })]) expect(responseFileFor(text), text).toBeNull();
  });
});

describe('la página que se sirve', () => {
  const script = (html: string) => html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));

  it('solo puede hablar con quien la sirve; la que se exporta, con nadie', () => {
    const alone = exportHtml(base);
    expect(alone).not.toContain('connect-src');
    expect(script(alone).startsWith('var SEND=false;')).toBe(true);
    const served = exportHtml(base, { send: true });
    expect(served).toContain("img-src data:; connect-src 'self'\">");
    expect(script(served).startsWith('var SEND=true;')).toBe(true);
    for (const html of [alone, served]) expect(() => new Function(script(html))).not.toThrow();
    // the path where it sends is the one it was served from
    expect(script(served)).toContain("location.pathname.replace(/\\/+$/,'')+'/r'");
  });

  it('la de «ya respondiste» no lleva preguntas ni guion', () => {
    const html = answeredHtml({ ...base, title: '<b>T</b>', color: 'x"><script>', language: 'en' });
    expect(html).toContain('You have already sent your response.');
    expect(html).toContain('&lt;b&gt;T&lt;/b&gt;');
    expect(html).toContain('style="--c:#0f6cbd"');
    expect(html).not.toContain('<script');
  });
});
