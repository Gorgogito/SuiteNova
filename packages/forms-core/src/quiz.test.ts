import { describe, expect, it } from 'vitest';
import { removeItem, renameItem } from './edit';
import { LOGIC_JS, exportHtml } from './html';
import { PAGE_EN, localize } from './i18n';
import { parseProject, parseResponses, responsesToCsv, serializeProject } from './io';
import { score } from './logic';
import { newForm, newQuestion, type Answer, type Form, type Question, type Response, type Review } from './model';
import { checkAnswer, feedbackSheetHtml, optionFeedback, pendingText, reviewLines, worthShowing } from './quiz';
import { receiveResponse } from './receive';
import { summarize } from './summary';

const q = (id: string, type: Question['type'], over: Partial<Question> = {}): Question => ({ ...newQuestion(type), id, title: id.toUpperCase(), ...over });
const quiz: Form = {
  ...newForm(),
  id: 'f',
  quiz: true,
  questions: [
    q('a', 'choice', { options: ['x', 'y'], correct: ['y'], points: 2, feedback: { x: 'Casi', y: 'Bien' }, explanation: 'Porque sí' }),
    q('b', 'multi', { options: ['p', 'q', 'r'], correct: ['p', 'r'], points: 1, feedback: { q: 'La q no' } }),
    q('c', 'text', { correct: ['Lima', 'lima metropolitana'], points: 1 }),
    q('d', 'longtext', { manual: true, points: 3 }),
    q('e', 'longtext', { points: 5, explanation: 'Solo para leer' }),
    q('g', 'number', { manual: true, correct: ['4'], points: 0.5 }),
    q('h', 'choice', { options: ['1', '2'], points: 4 }),
  ],
};
const answers: Record<string, Answer> = { a: 'x', b: ['p', 'q'], c: 'LIMA', d: 'Mi redacción', e: 'libre', g: 4, h: '1' };
const response = (review?: Review): Response => ({ id: 'r1', at: '2026-06-01T10:00:00.000Z', answers, name: 'Ana', ...(review ? { review } : {}) });

describe('puntuación con correcciones', () => {
  it('lo que se corrige a mano queda pendiente; lo que no cuenta, no suma', () => {
    expect(score(quiz, answers)).toEqual({ earned: 1, total: 7.5, byQuestion: { a: 0, b: 0, c: 1 }, pending: 3.5 });
    // nothing written is worth nothing and waits for nobody
    expect(score(quiz, { ...answers, d: '', g: '' })).toEqual({ earned: 1, total: 7.5, byQuestion: { a: 0, b: 0, c: 1, d: 0, g: 0 } });
  });

  it('los puntos puestos a mano sustituyen a los automáticos, sin salirse', () => {
    expect(score(quiz, answers, { points: { a: 1.5, d: 99, g: 0.2, h: 4, e: 5 } })).toEqual({ earned: 5.7, total: 7.5, byQuestion: { a: 1.5, b: 0, c: 1, d: 3, g: 0.2 } });
    expect(score(quiz, answers, { points: { a: -3, c: 0 } }).byQuestion).toEqual({ a: 0, b: 0, c: 0 });
  });

  it('cómo fue cada pregunta', () => {
    const lines = reviewLines(quiz, answers, { points: { d: 2 }, comments: { d: 'Bien escrito' } });
    expect(lines.map((l) => [l.id, l.mark, l.points, l.earned])).toEqual([
      ['a', 'wrong', 2, 0],
      ['b', 'wrong', 1, 0],
      ['c', 'right', 1, 1],
      ['d', 'partial', 3, 2],
      ['e', 'none', null, null],
      ['g', 'pending', 0.5, null],
      ['h', 'none', null, null],
    ]);
    expect(lines[0]).toMatchObject({ label: '1. A', answer: 'x', correct: 'y', feedback: ['Casi'], explanation: 'Porque sí', comment: '' });
    expect([lines[1]!.correct, lines[1]!.feedback, lines[2]!.correct, lines[3]!.comment]).toEqual(['p, r', ['q: La q no'], 'Lima / lima metropolitana', 'Bien escrito']);
    expect(worthShowing(lines).map((l) => l.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'g']);
    expect(reviewLines({ ...quiz, quiz: false }, answers)[0]).toMatchObject({ mark: 'none', correct: '', feedback: [], explanation: '' });
  });

  it('el resumen y la tabla usan las correcciones', () => {
    const done = response({ points: { d: 3, g: 0.5 }, comment: 'Muy bien' });
    expect(summarize(quiz, [done, { ...response(), id: 'r2' }]).quiz).toMatchObject({ average: 2.75, best: 4.5, worst: 1, pending: 1 });
    const [head, first, second] = responsesToCsv(quiz, [done, { ...response(), id: 'r2' }]).replace(/^./, '').split('\r\n');
    expect(head).toContain('Nombre;Puntuación;Puntuación máxima;Puntos por corregir;Comentario general;');
    expect(first).toContain(';Ana;4.5;7.5;0;Muy bien;');
    expect(second).toContain(';Ana;1;7.5;3.5;;');
  });
});

describe('modo práctica', () => {
  it('dice si está bien, con el comentario de lo elegido', () => {
    const [a, b, c] = quiz.questions;
    expect(checkAnswer(a!, 'y')).toEqual({ right: true, feedback: ['Bien'], correct: 'y', explanation: 'Porque sí' });
    expect(checkAnswer(a!, 'x')).toMatchObject({ right: false, feedback: ['Casi'] });
    expect(checkAnswer(b!, [])).toEqual({ problem: 'Responde antes de comprobar.' });
    expect(checkAnswer({ ...b!, min: 2 }, ['p'])).toEqual({ problem: 'Elige al menos 2 opciones.' });
    expect(checkAnswer(c!, ' lima Metropolitana ')).toMatchObject({ right: true });
    expect(optionFeedback(c!, 'x')).toEqual([]);
  });
});

describe('lo que se guarda', () => {
  it('comentarios, ajustes y correcciones van y vuelven', () => {
    const form = { ...quiz, showAnswers: true, practice: true };
    const saved = { form, responses: [response({ points: { d: 2 }, comments: { a: 'ojo' }, comment: 'bien', done: true })] };
    expect(parseProject(serializeProject(saved)).project).toEqual(saved);
  });

  it('lo que no tiene sentido se quita', () => {
    const raw = {
      format: 'novaforms',
      form: {
        quiz: true, showAnswers: 'sí', practice: 1,
        questions: [
          { id: 'a', type: 'choice', options: ['x', 'y'], feedback: { y: 'vale', z: 'no está', x: 5 }, manual: true, explanation: 7 },
          { id: 'b', type: 'longtext', feedback: { x: 'no' }, manual: true, explanation: 'e'.repeat(5000) },
          { id: 'c', type: 'rating', manual: true },
        ],
      },
      responses: [{ id: 'r', at: '2026-01-01T00:00:00Z', answers: { a: 'x' }, review: { points: { a: 5000, zz: 1, b: -1 }, comments: { a: '', b: 'b', zz: 'z' }, comment: 3, done: 'no' } }],
    };
    const { form, responses } = parseProject(JSON.stringify(raw)).project;
    expect(form.showAnswers ?? form.practice).toBeUndefined();
    expect(form.questions[0]).toMatchObject({ feedback: { y: 'vale' } });
    expect(form.questions[0]!.manual ?? form.questions[0]!.explanation).toBeUndefined();
    expect([form.questions[1]!.manual, form.questions[1]!.explanation!.length, form.questions[1]!.feedback, form.questions[2]!.manual]).toEqual([true, 2000, undefined, undefined]);
    expect(responses[0]!.review).toEqual({ points: { a: 1000 }, comments: { b: 'b' } });
  });

  it('una respuesta que llega de otro no puede traer sus propias notas', () => {
    const sent = { format: 'novaforms-response', formId: 'f', id: 'r9', at: '2026-06-01T10:00:00Z', answers: { a: 'y' }, review: { points: { a: 2 }, comment: '¡Me pongo un diez!' } };
    expect(parseResponses(JSON.stringify(sent), quiz).responses[0]!.review).toBeUndefined();
    const received = receiveResponse({ ...quiz, questions: [quiz.questions[0]!] }, [], JSON.stringify(sent), 0);
    expect(received.ok && received.response.review).toBeUndefined();
    expect(parseResponses(serializeProject({ form: quiz, responses: [response({ comment: 'x' })] }), quiz).responses[0]!.review).toBeUndefined();
  });

  it('renombrar o quitar una opción arrastra su comentario', () => {
    const doc = { form: quiz, responses: [] };
    expect(renameItem(doc, 'a', 'options', 0, 'equis').form.questions[0]!.feedback).toEqual({ equis: 'Casi', y: 'Bien' });
    expect(removeItem(doc, 'a', 'options', 0).form.questions[0]!.feedback).toEqual({ y: 'Bien' });
    expect('feedback' in removeItem(removeItem(doc, 'a', 'options', 0), 'a', 'options', 0).form.questions[0]!).toBe(false);
  });
});

describe('la hoja de devolución', () => {
  const reviewed = response({ points: { d: 2 }, comments: { d: '<i>bien</i>' }, comment: 'Sigue así' });

  it('lleva la nota, los comentarios y, si se pide, las respuestas correctas; una por persona', () => {
    const html = feedbackSheetHtml(quiz, [{ response: reviewed, number: 1 }, { response: { ...response(), name: undefined as never }, number: 2 }], { showCorrect: true, locale: 'es' });
    expect(html.match(/<section>/g)).toHaveLength(2);
    expect(html).toContain('<h2>Ana</h2>');
    expect(html).toContain('<h2>Respuesta 2</h2>');
    expect(html).toContain('Puntuación: 3 de 7.5');
    expect(html).toContain('Quedan 0.5 puntos por corregir a mano.');
    expect(html).toContain('Comentario general: Sigue así');
    expect(html).toContain('Respuesta correcta: y');
    expect(html).toContain('Explicación: Porque sí');
    expect(html).toContain('Comentario: &lt;i&gt;bien&lt;/i&gt;');
    expect(html).not.toContain('<i>');
    const bare = feedbackSheetHtml(quiz, [{ response: reviewed, number: 1 }], { showCorrect: false, locale: 'es' });
    expect(bare).not.toMatch(/Respuesta correcta|Explicación|Porque sí/);
    expect(bare).toContain('Casi');
  });

  it('en el idioma del formulario', () => {
    const html = feedbackSheetHtml({ ...quiz, language: 'en' }, [{ response: reviewed, number: 1 }], { showCorrect: true, locale: 'en-GB' });
    expect(html).toContain('<html lang="en">');
    for (const text of ['Score: 3 of 7.5', 'General comment: Sigue así', 'Right answer: y', 'Your answer: x', 'Explanation: Porque sí', 'Incorrect', 'Partly', 'To be marked', 'Points: 2 of 3', 'Points: up to 0.5', 'Sent on 1 June 2026', 'Feedback sheet']) expect(html, text).toContain(text);
    expect(localize(pendingText(1), 'en')).toBe('1 point is still to be marked by hand.');
    expect(localize(pendingText(2.5), 'en')).toBe('2.5 points are still to be marked by hand.');
  });
});

describe('la página web', () => {
  const data = (form: Form) => JSON.parse(/<script type="application\/json" id="form-data">(.*?)<\/script>/s.exec(exportHtml(form))![1]!) as Form;

  it('solo lleva las respuestas y los comentarios cuando los va a enseñar', () => {
    const private_ = data({ ...quiz, showScore: false });
    expect(private_.questions.flatMap((x) => x.correct)).toEqual([]);
    expect(JSON.stringify(private_)).not.toMatch(/Casi|Porque sí/);
    const scored = data({ ...quiz, showScore: true });
    expect(scored.questions[0]!.correct).toEqual(['y']);
    expect(JSON.stringify(scored)).not.toMatch(/Casi|Porque sí/);
    for (const over of [{ showAnswers: true }, { practice: true }]) {
      const open = data({ ...quiz, showScore: false, ...over });
      expect(open.questions[0]).toMatchObject({ correct: ['y'], explanation: 'Porque sí', feedback: { x: 'Casi', y: 'Bien' } });
    }
    expect(JSON.stringify(data({ ...quiz, quiz: false, showAnswers: true }))).not.toMatch(/Casi|Porque sí|"correct":\["y"\]/);
  });

  it('juzga igual que la aplicación', () => {
    const js = new Function(`${LOGIC_JS}; return { score, reviewLines, worthShowing, checkAnswer, pendingText, localize };`)() as {
      score: typeof score;
      reviewLines: typeof reviewLines;
      worthShowing: typeof worthShowing;
      checkAnswer: typeof checkAnswer;
      pendingText: typeof pendingText;
      localize: typeof localize;
    };
    const samples: Record<string, Answer>[] = [{}, answers, { a: 'y', b: ['r', 'p'], c: ' lima ', d: '', g: '4', h: '2' }, { a: 'Otra', b: [], c: 'x', d: 'y' }];
    const reviews: (Review | undefined)[] = [undefined, { points: { a: 1.5, d: 99, g: 0.1, c: 0.2 }, comments: { a: 'c' } }];
    for (const form of [quiz, { ...quiz, hideNumbers: true }, { ...quiz, quiz: false }])
      for (const a of samples) {
        for (const r of reviews) {
          expect(js.score(form, a, r)).toEqual(score(form, a, r));
          expect(js.reviewLines(form, a, r)).toEqual(reviewLines(form, a, r));
          expect(js.worthShowing(js.reviewLines(form, a, r))).toEqual(worthShowing(reviewLines(form, a, r)));
        }
        for (const x of form.questions) expect(js.checkAnswer(x, a[x.id]), x.id).toEqual(checkAnswer(x, a[x.id]));
      }
    for (const n of [1, 2, 0.5]) expect(js.localize(js.pendingText(n), 'en')).toBe(localize(pendingText(n), 'en'));
    for (const [es] of PAGE_EN) {
      const text = es.replace(/\{#\}/g, '2.5').replace(/\{\*\}/g, 'algo: x');
      expect(js.localize(text, 'en'), text).toBe(localize(text, 'en'));
    }
  });

  it('sigue siendo un guion válido con práctica y respuestas', () => {
    const html = exportHtml({ ...quiz, practice: true, showAnswers: true });
    expect(() => new Function(html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>')))).not.toThrow();
  });
});
