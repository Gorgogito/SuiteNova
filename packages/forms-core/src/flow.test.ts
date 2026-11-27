import { describe, expect, it } from 'vitest';
import { removeItem, renameItem } from './edit';
import { END, canShuffle, displayOrder, pageAfter, pagesOf, route, staysPut, tidyFlow } from './flow';
import { LOGIC_JS, exportHtml } from './html';
import { parseProject, responsesToCsv, serializeProject } from './io';
import { isVisible, score, validateAll, visibleAnswers } from './logic';
import { conditionsOf, newForm, newQuestion, numbers, showIfOf, type Answer, type Condition, type Form, type Question } from './model';
import { summarize } from './summary';

const q = (id: string, type: Question['type'], over: Partial<Question> = {}): Question => ({ ...newQuestion(type), id, ...over });
const form = (questions: Question[], over: Partial<Form> = {}): Form => ({ ...newForm(), id: 'f', questions, ...over });
const is = (question: string, value: string, op: Condition['op'] = 'eq'): Condition => ({ question, op, value });

/** Page 0: ¿Vienes? (No ends; Tal vez jumps to the last page). Page 1: how. Page 2 (jumps to the end). Page 3: why. */
const trip = (): Form =>
  form([
    q('go', 'choice', { options: ['Sí', 'No', 'Tal vez'], required: true, branch: { No: END, 'Tal vez': 's4' } }),
    q('s2', 'section', { title: 'Cómo' }),
    q('how', 'dropdown', { options: ['A pie', 'En bus'], required: true }),
    q('bus', 'text', { showIf: showIfOf([is('how', 'En bus')]) }),
    q('s3', 'section', { title: 'Comida', next: END }),
    q('eat', 'text', { required: true }),
    q('s4', 'section', { title: 'Motivo' }),
    q('why', 'text', { required: true, showIf: showIfOf([is('go', 'Tal vez')]) }),
  ]);

describe('páginas y recorrido', () => {
  it('cada sección empieza una página', () => {
    expect(pagesOf(trip()).map((p) => [p.section?.id ?? null, p.items.map((x) => x.id)])).toEqual([
      [null, ['go']],
      ['s2', ['how', 'bus']],
      ['s3', ['eat']],
      ['s4', ['why']],
    ]);
    expect(pagesOf(form([]))).toEqual([{ section: null, items: [] }]);
    expect(pagesOf(form([q('s', 'section'), q('a', 'text')])).map((p) => p.section?.id)).toEqual(['s']);
  });

  it('la opción elegida y la sección deciden adónde se va', () => {
    const f = trip();
    const way = (a: Record<string, Answer>) => route(f, a).pages;
    expect(way({})).toEqual([0, 1, 2]);
    expect(way({ go: 'Sí' })).toEqual([0, 1, 2]);
    expect(way({ go: 'No' })).toEqual([0]);
    expect(way({ go: 'Tal vez' })).toEqual([0, 3]);
    expect([...route(f, { go: 'Sí', how: 'En bus' }).shown]).toEqual(['go', 's2', 'how', 'bus', 's3', 'eat']);
    expect(pageAfter(pagesOf(f), 0, new Set(['go']), { go: 'No' })).toBe(4);
    // an option written like a property of every object leads nowhere
    expect(way({ go: 'toString' })).toEqual([0, 1, 2]);
  });

  it('lo que queda fuera del recorrido no se pide, no se guarda y no puntúa', () => {
    const f = { ...trip(), quiz: true };
    f.questions[2] = { ...f.questions[2]!, correct: ['A pie'] };
    const answers = { go: 'No', how: 'A pie', eat: 'pan' };
    expect(validateAll(f, { go: 'No' })).toEqual({});
    expect(Object.keys(validateAll(f, { go: 'Sí' }))).toEqual(['how', 'eat']);
    expect(Object.keys(validateAll(f, { go: 'Tal vez' }))).toEqual(['why']);
    expect(visibleAnswers(f, answers)).toEqual({ go: 'No' });
    expect(score(f, answers).total).toBe(0);
    expect(score(f, { ...answers, go: 'Sí' })).toMatchObject({ total: 1, earned: 1 });
    expect(isVisible(f, f.questions[5]!, answers)).toBe(false);
  });

  it('una condición mira a lo que se mostró: lo saltado no cuenta', () => {
    const f = form([
      q('a', 'choice', { options: ['x', 'y'], branch: { x: 's3' } }),
      q('s2', 'section'),
      q('b', 'text'),
      q('s3', 'section'),
      q('c', 'text', { showIf: showIfOf([is('b', 'hola')]) }),
    ]);
    expect(isVisible(f, f.questions[4]!, { a: 'y', b: 'hola' })).toBe(true);
    expect(isVisible(f, f.questions[4]!, { a: 'x', b: 'hola' })).toBe(false);
  });

  it('varias condiciones: todas o cualquiera', () => {
    const base = [q('a', 'choice', { options: ['1', '2'] }), q('b', 'choice', { options: ['1', '2'] })];
    const make = (anyOf: boolean) => form([...base, q('c', 'text', { showIf: showIfOf([is('a', '1'), is('b', '2')], anyOf) })]);
    const samples: Record<string, Answer>[] = [{}, { a: '1' }, { b: '2' }, { a: '1', b: '2' }];
    const seen = (f: Form) => samples.map((x) => isVisible(f, f.questions[2]!, x));
    expect(seen(make(false))).toEqual([false, false, false, true]);
    expect(seen(make(true))).toEqual([false, true, true, true]);
    // a broken one is not counted
    const broken = form([...base, q('c', 'text', { showIf: showIfOf([is('zz', '1'), is('a', '1')]) })]);
    expect(isVisible(broken, broken.questions[2]!, { a: '1' })).toBe(true);
    expect(conditionsOf(make(true).questions[2]!)).toEqual([is('a', '1'), is('b', '2')]);
    expect(showIfOf([])).toBeNull();
    expect(showIfOf([is('a', '1')], true)).toEqual(is('a', '1'));
  });

  it('renombrar y quitar opciones siguen a las ramas y a cada condición', () => {
    const f = trip();
    f.questions[7] = { ...f.questions[7]!, showIf: showIfOf([is('go', 'Tal vez'), is('how', 'En bus')], true) };
    let doc = renameItem({ form: f, responses: [] }, 'go', 'options', 2, 'Quizá');
    expect(doc.form.questions[0]!.branch).toEqual({ No: END, Quizá: 's4' });
    expect(conditionsOf(doc.form.questions[7]!).map((c) => c.value)).toEqual(['Quizá', 'En bus']);
    doc = removeItem(doc, 'go', 'options', 2);
    expect(doc.form.questions[0]!.branch).toEqual({ No: END });
    expect(conditionsOf(doc.form.questions[7]!)).toEqual([is('how', 'En bus')]);
    doc = removeItem(doc, 'go', 'options', 1);
    expect(doc.form.questions[0]!.branch).toBeUndefined();
  });

  it('al ordenar se quita lo que ya no tiene sentido', () => {
    const f = trip();
    expect(tidyFlow(f.questions)).toEqual(f.questions);
    // the last page moves to the start: nothing can lead back to it, and its condition looks forwards
    const moved = tidyFlow([f.questions[6]!, f.questions[7]!, ...f.questions.slice(0, 6)]);
    expect(moved.find((x) => x.id === 'go')!.branch).toEqual({ No: END });
    expect(moved.find((x) => x.id === 'why')!.showIf).toBeNull();
    const bad = tidyFlow([q('a', 'text', { branch: { x: END }, next: END }), q('s', 'section', { next: 's' }), q('t', 'title', { next: END })]);
    expect(bad.map((x) => [x.branch, x.next])).toEqual([[undefined, undefined], [undefined, undefined], [undefined, undefined]]);
  });

  it('va y vuelve en el archivo; lo que no vale no entra', () => {
    const f = { ...trip(), progress: true, hideNumbers: true };
    f.questions[7] = { ...f.questions[7]!, showIf: showIfOf([is('go', 'Tal vez'), is('how', 'En bus')], true) };
    expect(parseProject(serializeProject({ form: f, responses: [] })).project.form).toEqual(f);
    const raw = {
      format: 'novaforms',
      form: {
        shuffle: 'sí',
        questions: [
          { id: 'a', type: 'choice', options: ['x'], branch: { x: 'a', y: 'end', z: 5 }, locked: true },
          { id: 'b', type: 'text', branch: { x: 'end' }, showIf: { question: 'a', op: 'eq', value: 'x', anyOf: true, more: [{ question: 'b', op: 'eq', value: 'x' }, { question: 'a', op: 'raro' }] } },
        ],
      },
    };
    const back = parseProject(JSON.stringify(raw)).project.form;
    expect(back.shuffle).toBeUndefined();
    expect(back.questions[0]!.branch).toBeUndefined();
    expect(back.questions[0]!.locked).toBe(true);
    expect(back.questions[1]!.branch).toBeUndefined();
    expect(back.questions[1]!.showIf).toEqual(is('a', 'x'));
  });

  it('las secciones no son preguntas: ni número, ni columna, ni resumen', () => {
    const f = trip();
    expect([...numbers(f)].map(([id, n]) => `${id}${n}`)).toEqual(['go1', 'how2', 'bus3', 'eat4', 'why5']);
    expect(responsesToCsv(f, []).split('\r\n')[0]!.split(';')).toHaveLength(7);
    expect(summarize(f, []).questions).toHaveLength(5);
  });
});

describe('preguntas barajadas', () => {
  const f = form(
    [q('a', 'text'), q('b', 'choice', { options: ['1'] }), q('t', 'title'), q('c', 'text', { showIf: showIfOf([is('b', '1')]) }), q('d', 'text', { locked: true }), q('e', 'text'), q('g', 'text'), q('h', 'text'), q('i', 'text')],
    { shuffle: true },
  );

  it('cambian de sitio las libres; las demás se quedan', () => {
    expect(f.questions.filter((x) => staysPut(f, x)).map((x) => x.id)).toEqual(['b', 't', 'c', 'd']);
    const orders = ['1', '2', '3', '4', '5'].map((seed) => displayOrder(f, seed).map((x) => x.id));
    for (const o of orders) {
      expect([o[1], o[2], o[3], o[4]]).toEqual(['b', 't', 'c', 'd']);
      expect([...o].sort()).toEqual(f.questions.map((x) => x.id).sort());
    }
    expect(new Set(orders.map((o) => o.join())).size).toBeGreaterThan(2);
    expect(displayOrder(f, '1')).toEqual(displayOrder(f, '1'));
  });

  it('sin pedirlo, o con secciones, no se barajan', () => {
    expect(displayOrder({ ...f, shuffle: false }, '1')).toBe(f.questions);
    const paged = { ...f, questions: [...f.questions, q('s', 'section')] };
    expect(canShuffle(paged)).toBe(false);
    expect(displayOrder(paged, '1')).toBe(paged.questions);
  });
});

describe('la página web recorre lo mismo', () => {
  type Fn = (...args: never[]) => unknown;
  const js = new Function(`${LOGIC_JS}; return { route, pageAfter, pagesOf, displayOrder, isVisible, validateAll, visibleAnswers, score };`)() as Record<string, Fn> as unknown as {
    route: typeof route;
    displayOrder: typeof displayOrder;
    isVisible: typeof isVisible;
    validateAll: typeof validateAll;
    visibleAnswers: typeof visibleAnswers;
    score: typeof score;
  };

  it('mismo recorrido, mismo orden y mismas cuentas', () => {
    const f = { ...trip(), quiz: true };
    f.questions[2] = { ...f.questions[2]!, correct: ['A pie'] };
    f.questions[7] = { ...f.questions[7]!, showIf: showIfOf([is('go', 'Tal vez'), is('how', 'En bus')], true) };
    const values: (Record<string, Answer>)[] = [];
    for (const go of [null, 'Sí', 'No', 'Tal vez', 'toString']) for (const how of [null, 'A pie', 'En bus']) values.push({ go, how, eat: 'x', why: 'y', bus: 'z' });
    for (const a of values) {
      const mine = route(f, a);
      const theirs = js.route(f, a);
      expect([theirs.pages, [...theirs.shown]]).toEqual([mine.pages, [...mine.shown]]);
      expect(js.validateAll(f, a)).toEqual(validateAll(f, a));
      expect(js.visibleAnswers(f, a)).toEqual(visibleAnswers(f, a));
      expect(js.score(f, a)).toEqual(score(f, a));
      for (const x of f.questions) expect(js.isVisible(f, x, a)).toBe(isVisible(f, x, a));
    }
    const mixed = form([q('a', 'text'), q('b', 'text'), q('c', 'text', { locked: true }), q('d', 'text'), q('e', 'text')], { shuffle: true });
    for (const seed of ['', 'x', 'r1abc']) expect(js.displayOrder(mixed, seed)).toEqual(displayOrder(mixed, seed));
  });

  it('la página sigue siendo un guion válido', () => {
    const html = exportHtml({ ...trip(), progress: true });
    const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
    expect(() => new Function(script)).not.toThrow();
  });
});
