import { describe, expect, it } from 'vitest';
import { tidyFlow } from './flow';
import { exportHtml } from './html';
import { localize } from './i18n';
import { formFromSheet } from './import';
import { parseProject, parseResponses, responsesToCsv, serializeProject, serializeResponse } from './io';
import { score, validateAll } from './logic';
import { chartsFor, isInput, newForm, newQuestion, type Answer, type Form, type Question, type Response } from './model';
import { OTHER_ANSWER, durationText, filterResponses, filterValues, isFiltering, localDay, responseTable, sortResponses } from './query';
import { receiveResponse } from './receive';
import { summaryHtml } from './report';
import { summarize } from './summary';
import { templates } from './templates';

const q = (id: string, type: Question['type'], over: Partial<Question> = {}): Question => ({ ...newQuestion(type), id, title: id.toUpperCase(), ...over });
const form: Form = {
  ...newForm('Merienda'),
  id: 'f',
  questions: [
    q('c', 'choice', { options: ['Mango', 'Piña'], allowOther: true, chart: 'pie' }),
    q('m', 'multi', { options: ['Lunes', 'Martes'] }),
    q('r', 'rating', { max: 5 }),
    q('t', 'longtext'),
    q('n', 'number'),
    q('d', 'date'),
    q('g', 'likert', { rows: ['Sabor'], options: ['1', '2'] }),
  ],
};
const at = (day: number, hour = 12) => new Date(2026, 5, day, hour).toISOString();
const rs: Response[] = [
  { id: 'a', at: at(1), name: 'Zoe', seconds: 30, answers: { c: 'Mango', m: ['Lunes'], r: 5, t: 'Ácido y dulce', n: 10, d: '2026-06-01', g: { Sabor: '2' } } },
  { id: 'b', at: at(3), name: 'ana', seconds: 90, answers: { c: 'Uva', m: ['Lunes', 'Martes'], r: 2, n: 9 } },
  { id: 'c', at: at(2), answers: { c: 'Piña', t: '<script>', r: 4 } },
];
const ids = (list: Response[]) => list.map((r) => r.id).join('');

describe('cuánto se tardó', () => {
  it('se escribe como un reloj', () => {
    expect([0, 5, 65, 600, 3600, 3723, -4].map(durationText)).toEqual(['0:00', '0:05', '1:05', '10:00', '1:00:00', '1:02:03', '0:00']);
  });

  it('va y vuelve en los archivos; lo imposible se quita', () => {
    expect(parseProject(serializeProject({ form, responses: rs })).project.responses.map((r) => r.seconds)).toEqual([30, 90, undefined]);
    expect(parseResponses(serializeResponse(form, rs[0]!), form).responses[0]!.seconds).toBe(30);
    for (const seconds of [0, -1, 1.5, '30', 1e12, null]) expect(parseResponses(JSON.stringify([{ id: 'x', at: at(1), seconds, answers: { r: 1 } }]), form).responses[0]!.seconds, String(seconds)).toBeUndefined();
    const sent = JSON.stringify({ format: 'novaforms-response', formId: 'f', id: 'z', seconds: 42, answers: { r: 1 } });
    const got = receiveResponse(form, [], sent, 0);
    expect(got.ok && got.response.seconds).toBe(42);
    expect(responsesToCsv(form, rs).split('\r\n')[0]).toContain('Nombre;Duración (s);');
    expect(responsesToCsv(form, [rs[2]!])).not.toContain('Duración');
  });

  it('el resumen da la media y la mediana de las que lo dicen', () => {
    expect(summarize(form, rs).time).toEqual({ average: 60, median: 60, count: 2 });
    expect(summarize(form, [...rs, { ...rs[0]!, id: 'd', seconds: 600 }]).time).toEqual({ average: 240, median: 90, count: 3 });
    expect(summarize(form, [rs[2]!]).time).toBeUndefined();
  });

  it('de la hoja de Microsoft Forms sale de las horas de inicio y de fin', () => {
    const imported = formFromSheet(
      [
        ['Id', 'Hora de inicio', 'Hora de finalización', 'Color'],
        ['1', '01/03/2025 10:00', '01/03/2025 10:02', 'Rojo'],
        ['2', '', '02/03/2025 10:00', 'Azul'],
        ['3', '03/03/2025 11:00', '03/03/2025 10:00', 'Rojo'],
      ],
      'x',
    );
    expect(imported.responses.map((r) => r.seconds)).toEqual([120, undefined, undefined]);
  });

  it('la página web lo mide y lo envía', () => {
    const html = exportHtml(form);
    expect(html).toContain('seconds:lastResponse.seconds');
    expect(() => new Function(html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>')))).not.toThrow();
  });
});

describe('buscar, filtrar y ordenar', () => {
  it('por texto, sin mirar mayúsculas ni acentos, también en el nombre y los comentarios', () => {
    expect(ids(filterResponses(form, rs, { text: 'ACIDO' }))).toBe('a');
    expect(ids(filterResponses(form, rs, { text: 'ana' }))).toBe('b');
    expect(ids(filterResponses(form, [{ ...rs[2]!, review: { comments: { t: 'Revísalo' } } }], { text: 'revisalo' }))).toBe('c');
    expect(filterResponses(form, rs, { text: '  ' })).toBe(rs);
    expect(isFiltering({ question: 'c' })).toBe(false);
  });

  it('por lo respondido a una pregunta y por días', () => {
    expect(ids(filterResponses(form, rs, { question: 'c', value: 'Mango' }))).toBe('a');
    expect(ids(filterResponses(form, rs, { question: 'c', value: OTHER_ANSWER }))).toBe('b');
    expect(ids(filterResponses(form, rs, { question: 'm', value: 'Martes' }))).toBe('b');
    expect(ids(filterResponses(form, rs, { question: 'r', value: '4' }))).toBe('c');
    expect(ids(filterResponses(form, rs, { from: '2026-06-02' }))).toBe('bc');
    expect(ids(filterResponses(form, rs, { from: '2026-06-02', to: '2026-06-02' }))).toBe('c');
    expect(ids(filterResponses(form, rs, { question: 't', value: 'x' }))).toBe('abc');
    expect(localDay(at(1, 23))).toBe('2026-06-01');
    expect(filterValues(form.questions[0]!, rs)).toEqual(['Mango', 'Piña', OTHER_ANSWER]);
    expect(filterValues(form.questions[0]!, [rs[0]!])).toEqual(['Mango', 'Piña']);
    expect(filterValues(form.questions[2]!, rs)).toHaveLength(5);
    expect(filterValues(form.questions[3]!, rs)).toEqual([]);
  });

  it('en orden, con lo que no tiene dato siempre al final', () => {
    expect(ids(sortResponses(form, rs, 'date'))).toBe('acb');
    expect(ids(sortResponses(form, rs, 'date', true))).toBe('bca');
    expect(ids(sortResponses(form, rs, 'name'))).toBe('bac');
    expect(ids(sortResponses(form, rs, 'name', true))).toBe('abc');
    expect(ids(sortResponses(form, rs, 'time'))).toBe('abc');
    expect(ids(sortResponses(form, rs, 'time', true))).toBe('bac');
    expect(ids(sortResponses(form, rs, 'q:n'))).toBe('bac');
    expect(ids(sortResponses(form, rs, 'q:c'))).toBe('acb');
    expect(ids(sortResponses({ ...form, quiz: true, questions: [{ ...form.questions[0]!, correct: ['Piña'], points: 3 }] }, rs, 'score', true))).toBe('cab');
  });

  it('la tabla: fechas y números como tales', () => {
    const t = responseTable(form, rs);
    expect(t.head).toEqual(['Id', 'Fecha', 'Nombre', 'Duración (s)', 'C', 'M', 'R', 'T', 'N', 'D', 'G [Sabor]']);
    expect(t.rows[0]).toEqual(['a', new Date(at(1)), 'Zoe', 30, 'Mango', 'Lunes', 5, 'Ácido y dulce', 10, new Date(2026, 5, 1), '2']);
    expect(t.rows[2]!.slice(2, 6)).toEqual([null, null, 'Piña', null]);
    const quiz: Form = { ...form, quiz: true, questions: [q('t', 'longtext', { manual: true, points: 5 })] };
    const graded = responseTable(quiz, [{ ...rs[0]!, review: { points: { t: 4 }, comments: { t: 'bien' }, comment: 'ok' } }, rs[2]!]);
    expect(graded.head).toEqual(['Id', 'Fecha', 'Nombre', 'Duración (s)', 'Puntuación', 'Puntuación máxima', 'Puntos por corregir', 'Comentario general', 'T', 'Puntos: T', 'Comentario: T']);
    expect(graded.rows.map((r) => r.slice(4))).toEqual([[4, 5, 0, 'ok', 'Ácido y dulce', 4, 'bien'], [0, 5, 5, null, '<script>', null, null]]);
  });
});

describe('el resumen para compartir', () => {
  it('lleva las cifras, sin nombres ni textos escritos salvo que se pidan', () => {
    const html = summaryHtml(form, rs, { locale: 'es-ES' });
    expect(html).toContain('<strong>3 respuestas</strong>');
    expect(html).toContain('Tiempo medio para responder: 1:00');
    expect(html).toContain('<h2>1. C</h2>');
    expect(html).toContain('Mango');
    expect(html).toContain('Las respuestas escritas no se incluyen.');
    expect(html).not.toMatch(/Zoe|Ácido|&lt;script|<script|Uva/);
    const all = summaryHtml(form, rs, { texts: true });
    expect(all).toContain('Ácido y dulce');
    expect(all).toContain('&lt;script&gt;');
    expect(all).toContain('Uva');
    expect(all).not.toMatch(/Zoe|<script/);
  });

  it('con el gráfico como imagen, el filtro avisado y en inglés', () => {
    const html = summaryHtml({ ...form, language: 'en' }, rs.slice(0, 2), { charts: { c: '<svg onload="x()"></svg>' }, of: 3, locale: 'en-GB' });
    expect(html).toContain('<img alt="Chart of the responses" src="data:image/svg+xml;charset=utf-8,%3Csvg');
    expect(html).not.toContain('<svg');
    for (const text of ['Summary of responses', '2 of 3 responses are summarised: there is a filter.', 'Average time to answer: 1:00', 'Written answers are not included.', 'Average: 9.5', '3.5 / 5', 'Other answers']) expect(html, text).toContain(text);
    expect(summaryHtml(form, [])).toContain('Nadie ha respondido a esta pregunta.');
  });

  it('todo lo que escribe el programa tiene traducción', () => {
    const everything: Form = { ...form, quiz: true, language: 'en', questions: [...form.questions, q('p', 'nps'), q('k', 'ranking'), q('f', 'file'), q('z', 'choice', { options: ['a'], correct: ['a'] })] };
    const html = summaryHtml(everything, [{ ...rs[0]!, answers: { ...rs[0]!.answers, p: 9, k: ['Elemento 1', 'Elemento 2'], f: [{ name: 'secreto.txt', size: 1, type: '', data: 'QQ==' }], z: 'a' } }], { locale: 'en-GB' });
    expect(html).not.toContain('secreto');
    // what is left in Spanish, with what is around it
    expect(html.replace(/<style>.*<\/style>/s, '').match(/.{0,50}(respuesta|Puntuación|Media\b|Mediana|Elemento medio|Archivos|Promotores|Gráfico|Nadie|Tiempo).{0,50}/g)).toBeNull();
    expect(localize('1 respuesta', 'en')).toBe('1 response');
  });
});

describe('plantillas', () => {
  it('cada una es un formulario correcto en los dos idiomas', () => {
    for (const lang of ['es', 'en'] as const) {
      const list = templates(lang);
      expect(list.map((x) => x.id)).toEqual(['satisfaction', 'event', 'course', 'quiz', 'meeting', 'contact']);
      for (const t of list) {
        const made = t.make();
        expect(made.language, t.id).toBe(lang === 'en' ? 'en' : undefined);
        // reading it back changes nothing: conditions look back, branches forwards, no empty or repeated options
        expect(parseProject(serializeProject({ form: made, responses: [] })).project.form, `${lang} ${t.id}`).toEqual(made);
        expect(tidyFlow(made.questions)).toEqual(made.questions);
        expect(made.questions.filter(isInput).length).toBeGreaterThan(1);
        expect(new Set(made.questions.map((x) => x.id)).size).toBe(made.questions.length);
        for (const x of made.questions) expect(x.title, t.id).not.toBe('');
      }
    }
    expect(templates('en')[0]!.make().title).toBe('Tell us about your experience');
    expect(templates('es')[0]!.make().id).not.toBe(templates('es')[0]!.make().id);
  });

  it('la inscripción termina para quien no va, y el cuestionario puntúa', () => {
    const [, event, , quiz] = templates('es');
    const e = event!.make();
    const going = e.questions[1]!;
    expect(validateAll(e, { [going.id]: 'No' })).toEqual({});
    expect(Object.keys(validateAll(e, { [going.id]: 'Sí' }))).toHaveLength(1);
    const z = quiz!.make();
    const answers: Record<string, Answer> = { [z.questions[0]!.id]: '56', [z.questions[1]!.id]: ['2', '11'], [z.questions[2]!.id]: 'x' };
    expect(score(z, answers)).toMatchObject({ earned: 4, total: 7, pending: 3 });
  });

  it('los gráficos solo donde tienen sentido', () => {
    expect(chartsFor({ type: 'choice' })).toEqual(['column', 'pie', 'doughnut']);
    expect(chartsFor({ type: 'multi' })).toEqual(['column']);
    expect(chartsFor({ type: 'text' })).toEqual([]);
    const raw = { format: 'novaforms', form: { questions: [{ id: 'a', type: 'multi', chart: 'pie' }, { id: 'b', type: 'multi', chart: 'column' }, { id: 'c', type: 'text', chart: 'column' }, { id: 'd', type: 'choice', chart: 'radar' }] } };
    expect(parseProject(JSON.stringify(raw)).project.form.questions.map((x) => x.chart)).toEqual([undefined, 'column', undefined, undefined]);
  });
});
