import { describe, expect, it } from 'vitest';
import { nextName, removeItem, renameInAnswers, renameItem, uniqueTexts, type Doc } from './edit';
import { exportHtml } from './html';
import { parseProject, serializeProject } from './io';
import { isVisible, score } from './logic';
import { newForm, newQuestion, numbers, type Question } from './model';
import { summarize } from './summary';

const q = (id: string, type: Question['type'], over: Partial<Question> = {}): Question => ({ ...newQuestion(type), id, ...over });
const response = (id: string, answers: Doc['responses'][number]['answers']) => ({ id, at: '2026-01-01T00:00:00Z', answers });

const quiz = (): Doc => ({
  form: {
    ...newForm(),
    quiz: true,
    questions: [
      q('a', 'choice', { options: ['Si', 'No', 'Quizá'], correct: ['Si'], allowOther: true }),
      q('m', 'multi', { options: ['Rojo', 'Verde'], correct: ['Rojo', 'Verde'] }),
      q('g', 'likert', { options: ['Mal', 'Bien'], rows: ['Ritmo', 'Voz'] }),
      q('t', 'text', { showIf: { question: 'a', op: 'eq', value: 'si' }, correct: ['x'] }),
      q('u', 'text', { showIf: { question: 'g', op: 'contains', value: 'Bien' } }),
    ],
  },
  responses: [response('1', { a: 'Si', m: ['Rojo', 'Verde'], g: { Ritmo: 'Bien', Voz: 'Mal' }, t: 'x' }), response('2', { a: 'Otra cosa', m: ['Verde'] })],
});

describe('cambiar el texto de una opción', () => {
  it('se lleva las respuestas, la correcta y las condiciones', () => {
    const before = quiz();
    const doc = renameItem(before, 'a', 'options', 0, '  Sí, claro ');
    const [a, , , t] = doc.form.questions;
    expect(a!.options).toEqual(['Sí, claro', 'No', 'Quizá']);
    expect(a!.correct).toEqual(['Sí, claro']);
    // the condition was written without the capital
    expect(t!.showIf!.value).toBe('Sí, claro');
    expect(doc.responses.map((r) => r.answers.a)).toEqual(['Sí, claro', 'Otra cosa']);
    expect(score(doc.form, doc.responses[0]!.answers)).toEqual(score(before.form, before.responses[0]!.answers));
    expect(isVisible(doc.form, t!, doc.responses[0]!.answers)).toBe(true);
    // what was there is not changed, and untouched answers are the same objects
    expect(before.form.questions[0]!.options[0]).toBe('Si');
    expect(doc.responses[1]).toBe(before.responses[1]);
  });

  it('en casillas, columnas y filas', () => {
    let doc = renameItem(quiz(), 'm', 'options', 0, 'Granate');
    expect(doc.form.questions[1]!.correct).toEqual(['Granate', 'Verde']);
    expect(doc.responses[0]!.answers.m).toEqual(['Granate', 'Verde']);
    doc = renameItem(doc, 'g', 'options', 1, 'Muy bien');
    expect(doc.responses[0]!.answers.g).toEqual({ Ritmo: 'Muy bien', Voz: 'Mal' });
    expect(doc.form.questions[4]!.showIf!.value).toBe('Muy bien');
    doc = renameItem(doc, 'g', 'rows', 0, 'Velocidad');
    expect(doc.responses[0]!.answers.g).toEqual({ Velocidad: 'Muy bien', Voz: 'Mal' });
    expect(summarize(doc.form, doc.responses).questions[2]).toMatchObject({ rows: [{ row: 'Velocidad', counts: [0, 1] }, { row: 'Voz', counts: [1, 0] }] });
    // a row is not what a condition compares with
    expect(renameItem(doc, 'g', 'rows', 1, 'Muy bien').form.questions[4]!.showIf!.value).toBe('Muy bien');
  });

  it('no admite vacíos ni repetidos, y sin cambio no hace nada', () => {
    const doc = quiz();
    expect(() => renameItem(doc, 'a', 'options', 0, '  ')).toThrow('vacío');
    expect(() => renameItem(doc, 'a', 'options', 0, ' No ')).toThrow('Ya hay otro igual');
    expect(renameItem(doc, 'a', 'options', 0, 'Si')).toBe(doc);
    expect(renameItem(doc, 'zz', 'options', 0, 'x')).toBe(doc);
    expect(renameItem(doc, 'a', 'options', 9, 'x')).toBe(doc);
    // capitals and accents do tell them apart, as in the files of other programs
    expect(renameItem(doc, 'a', 'options', 1, 'si').form.questions[0]!.options).toEqual(['Si', 'si', 'Quizá']);
  });

  it('con dos opciones que solo difieren en el acento, la condición sigue a la suya', () => {
    const doc = quiz();
    doc.form.questions[0] = q('a', 'choice', { options: ['Si', 'Sí'] });
    expect(renameItem(doc, 'a', 'options', 1, 'Claro').form.questions[3]!.showIf!.value).toBe('si');
  });

  it('también las respuestas a medio escribir', () => {
    const doc = quiz();
    const answers = { a: 'No', other: 'x' };
    expect(renameInAnswers(doc.form.questions[0]!, 'options', 'No', 'Nunca', answers)).toEqual({ a: 'Nunca', other: 'x' });
    expect(renameInAnswers(doc.form.questions[0]!, 'options', 'Si', 'Nunca', answers)).toBe(answers);
  });

  it('quitarla olvida la correcta y la condición, y conserva lo respondido', () => {
    const doc = removeItem(quiz(), 'a', 'options', 0);
    expect(doc.form.questions[0]).toMatchObject({ options: ['No', 'Quizá'], correct: [] });
    expect(doc.responses[0]!.answers.a).toBe('Si');
    // written otherwise, the condition may still be met by something typed: it stays
    expect(doc.form.questions[3]!.showIf).not.toBeNull();
    const other = quiz();
    other.form.questions[3]!.showIf!.value = 'Si';
    expect(removeItem(other, 'a', 'options', 0).form.questions[3]!.showIf).toBeNull();
    expect(removeItem(quiz(), 'g', 'rows', 0).form.questions[2]!.rows).toEqual(['Voz']);
  });
});

describe('nombres de las listas', () => {
  it('el siguiente libre', () => {
    expect(nextName(['Opción 1', 'Opción 2'], 'Opción')).toBe('Opción 3');
    expect(nextName(['Opción 3', 'B'], 'Opción')).toBe('Opción 4');
    expect(nextName([], 'Fila')).toBe('Fila 1');
  });

  it('un archivo con vacíos o repetidos se arregla al abrirlo, sin perder ninguno', () => {
    expect(uniqueTexts(['A', 'A', '', 'A (2)', 'Opción 3', ' '], 'Opción')).toEqual(['A', 'A (3)', 'Opción 4', 'A (2)', 'Opción 3', 'Opción 6']);
    const form = { ...newForm(), questions: [q('a', 'choice', { options: ['A', 'A', ''] }), q('g', 'likert', { options: ['', ''], rows: ['F', 'F'] })] };
    const back = parseProject(serializeProject({ form, responses: [] })).project.form.questions;
    expect(back[0]!.options).toEqual(['A', 'A (2)', 'Opción 3']);
    expect(back[1]).toMatchObject({ options: ['Columna 1', 'Columna 2'], rows: ['F', 'F (2)'] });
  });
});

describe('numeración y puntuación', () => {
  it('los títulos no llevan número, tampoco en la página', () => {
    const form = { ...newForm(), questions: [q('a', 'text'), q('s', 'title'), q('b', 'text')] };
    expect([...numbers(form)]).toEqual([['a', 1], ['b', 2]]);
    expect(exportHtml(form)).toContain('if(isInput(q))n++;var b=renderQ(q,n)');
  });

  it('el resumen dice la verdad cuando cada persona tiene su máximo', () => {
    const form = { ...newForm(), quiz: true, questions: [q('a', 'choice', { options: ['1', '2'], correct: ['1'] }), q('b', 'choice', { options: ['1', '2'], correct: ['1'], showIf: { question: 'a', op: 'eq', value: '1' } })] };
    const s = summarize(form, [response('1', { a: '2' }), response('2', { a: '1', b: '1' })]);
    expect(s.quiz).toEqual({ average: 1, max: 2, best: 2, worst: 0, varies: true, percent: 50 });
    expect(summarize(form, [response('2', { a: '1', b: '2' })]).quiz).toMatchObject({ max: 2, varies: false, percent: 50 });
  });
});

describe('lo recogido no se pierde al volver a abrir', () => {
  it('una opción quitada o un límite cambiado no borran respuestas del archivo propio', () => {
    let doc = removeItem(quiz(), 'a', 'options', 0);
    doc = removeItem(doc, 'g', 'rows', 0);
    doc.form.questions.push(q('n', 'number', { maxValue: 10 }), q('r', 'rating', { max: 3 }));
    doc.responses[0] = { ...doc.responses[0]!, answers: { ...doc.responses[0]!.answers, n: 50, r: 5 } };
    const back = parseProject(serializeProject(doc));
    expect(back.project.responses).toEqual(doc.responses);
    expect(back.warnings).toEqual([]);
  });

  it('pero lo que no tiene la forma de una respuesta no entra', () => {
    const form = { ...newForm(), questions: [q('a', 'choice'), q('m', 'multi'), q('n', 'number'), q('g', 'likert')] };
    const bad = response('1', { a: 5 as never, m: [1] as never, n: 'muchos', g: ['x'], z: 'otra' });
    const odd = response('2', { a: 'Antigua', m: 'Suelta' as never, n: '3,5' as never, g: { F: 7 as never, G: 'ok' } });
    const back = parseProject(serializeProject({ form, responses: [bad, odd] }));
    expect(back.project.responses.map((r) => r.answers)).toEqual([{ a: 'Antigua', m: ['Suelta'], n: 3.5, g: { G: 'ok' } }]);
    expect(back.warnings.join()).toContain('Se omitieron 1');
  });
});
