import { describe, expect, it } from 'vitest';
import {
  LOGIC_JS, cleanResponse, exportHtml, isVisible, newForm, newQuestion, parseProject, parseResponses, responsesToCsv, score, serializeProject, serializeResponse, summarize, validateAll, validateAnswer, visibleAnswers,
  type Answer, type Form, type Question, type QType, type Response,
} from './index';

const q = (type: QType, over: Partial<Question> = {}): Question => ({ ...newQuestion(type), title: type, ...over });
const form = (qs: Question[], over: Partial<Form> = {}): Form => ({ ...newForm('Prueba'), questions: qs, ...over });
const resp = (answers: Record<string, Answer>, id = 'r' + Math.random()): Response => ({ id, at: '2025-03-01T10:00:00.000Z', answers });

describe('validation', () => {
  it('required, text formats and lengths', () => {
    expect(validateAnswer(q('text', { required: true }), '  ')).toMatch(/obligatoria/);
    expect(validateAnswer(q('text'), '')).toBeNull();
    expect(validateAnswer(q('text', { format: 'email' }), 'a@b')).toMatch(/correo/);
    expect(validateAnswer(q('text', { format: 'email' }), 'ana@ejemplo.es')).toBeNull();
    expect(validateAnswer(q('text', { format: 'url' }), 'javascript:alert(1)')).toMatch(/http/);
    expect(validateAnswer(q('text', { format: 'url' }), 'https://x.org')).toBeNull();
    expect(validateAnswer(q('longtext', { min: 5, maxValue: 10 }), 'abc')).toMatch(/al menos 5/);
    expect(validateAnswer(q('longtext', { min: 5, maxValue: 10 }), 'abcdefghijkl')).toMatch(/como máximo 10/);
  });
  it('numbers, dates, ratings', () => {
    const n = q('number', { min: 1, maxValue: 10, integer: true });
    expect(validateAnswer(n, 'x')).toMatch(/número/);
    expect(validateAnswer(n, 2.5)).toMatch(/entero/);
    expect(validateAnswer(n, 0)).toMatch(/mínimo/);
    expect(validateAnswer(n, 11)).toMatch(/máximo/);
    expect(validateAnswer(n, '7')).toBeNull();
    expect(validateAnswer(q('number'), '3,5')).toBeNull();
    expect(validateAnswer(q('date'), '2025-02-30')).toMatch(/fecha/);
    expect(validateAnswer(q('date'), '2025-02-20')).toBeNull();
    expect(validateAnswer(q('date'), '20/02/2025')).toMatch(/fecha/);
    expect(validateAnswer(q('rating', { max: 5 }), 6)).toMatch(/1 a 5/);
    expect(validateAnswer(q('rating', { max: 5 }), 4)).toBeNull();
    expect(validateAnswer(q('nps'), 0)).toBeNull();
    expect(validateAnswer(q('nps'), 11)).toMatch(/0 a 10/);
  });
  it('choices, other, multi and likert', () => {
    const c = q('choice', { options: ['A', 'B'] });
    expect(validateAnswer(c, 'C')).toMatch(/opciones/);
    expect(validateAnswer({ ...c, allowOther: true }, 'C')).toBeNull();
    expect(validateAnswer(q('dropdown', { options: ['A'], allowOther: true }), 'Z')).toMatch(/opciones/);
    const m = q('multi', { options: ['A', 'B'] });
    expect(validateAnswer(m, ['A', 'B'])).toBeNull();
    expect(validateAnswer(m, ['A', 'Z'])).toMatch(/no existe/);
    expect(validateAnswer(m, 'A')).toMatch(/varias/);
    const l = q('likert', { rows: ['r1', 'r2'], options: ['x', 'y'], required: true });
    expect(validateAnswer(l, { r1: 'x' })).toMatch(/todas las filas/);
    expect(validateAnswer(l, { r1: 'x', r2: 'y' })).toBeNull();
    expect(validateAnswer(l, { r1: 'x', r2: 'zzz' })).toMatch(/no existe/);
    expect(validateAnswer(q('title', { required: true }), null)).toBeNull();
  });
});

describe('conditions', () => {
  const a = q('choice', { id: 'a', options: ['Sí', 'No'] });
  const b = q('text', { id: 'b', required: true, showIf: { question: 'a', op: 'eq', value: 'sí' } });
  const c = q('text', { id: 'c', showIf: { question: 'b', op: 'contains', value: 'hola' } });
  const f = form([a, b, c]);
  it('show or hide by an earlier answer (no accents, no case)', () => {
    expect(isVisible(f, b, {})).toBe(false);
    expect(isVisible(f, b, { a: 'Sí' })).toBe(true);
    expect(isVisible(f, b, { a: 'No' })).toBe(false);
    const g = form([a, { ...b, showIf: { question: 'a', op: 'neq', value: 'no' } }]);
    expect(isVisible(g, g.questions[1]!, { a: 'No' })).toBe(false);
    expect(isVisible(g, g.questions[1]!, { a: 'Sí' })).toBe(true);
  });
  it('chained conditions need the whole chain visible', () => {
    expect(isVisible(f, c, { a: 'No', b: 'hola' })).toBe(false);
    expect(isVisible(f, c, { a: 'Sí', b: '¡HOLA amigo!' })).toBe(true);
  });
  it('hidden required questions are not required; their answers are dropped', () => {
    expect(validateAll(f, { a: 'No' })).toEqual({});
    expect(validateAll(f, { a: 'Sí' })).toEqual({ b: 'Esta pregunta es obligatoria.' });
    expect(visibleAnswers(f, { a: 'No', b: 'quedó escrito' })).toEqual({ a: 'No' });
  });
  it('a broken condition never hides (unknown or later question)', () => {
    expect(isVisible(f, { ...b, showIf: { question: 'zzz', op: 'eq', value: 'x' } }, {})).toBe(true);
    expect(isVisible(f, { ...a, showIf: { question: 'b', op: 'eq', value: 'x' } }, {})).toBe(true);
  });
});

describe('quiz', () => {
  const f = form(
    [
      q('choice', { id: 'a', options: ['x', 'y'], correct: ['y'], points: 2 }),
      q('multi', { id: 'b', options: ['p', 'q', 'r'], correct: ['p', 'r'] }),
      q('text', { id: 'c', correct: ['París', 'paris'] }),
      q('number', { id: 'd', correct: ['3,5'], points: 3 }),
      q('text', { id: 'e' }),
    ],
    { quiz: true },
  );
  it('grades each type and ignores questions without a right answer', () => {
    const s = score(f, { a: 'y', b: ['r', 'p'], c: ' PARIS ', d: 3.5, e: 'libre' });
    expect(s).toEqual({ earned: 7, total: 7, byQuestion: { a: 2, b: 1, c: 1, d: 3 } });
    const w = score(f, { a: 'x', b: ['p'], c: 'Roma', d: '3,6' });
    expect(w.earned).toBe(0);
    expect(w.total).toBe(7);
    expect(score({ ...f, quiz: false }, { a: 'y' })).toEqual({ earned: 0, total: 0, byQuestion: {} });
  });
});

describe('untrusted responses', () => {
  const f = form([q('text', { id: 'a', required: true }), q('number', { id: 'b', min: 0 }), q('multi', { id: 'c', options: ['x', 'y'] })]);
  it('keeps what is valid, drops the rest, coerces simple mistakes', () => {
    const r = cleanResponse(f, { id: 'r1', at: '2025-01-02T03:04:05Z', answers: { a: 'hola', b: '-4', c: 'x', zzz: 'desconocida', __proto__: 'x' } })!;
    expect(r.response.answers).toEqual({ a: 'hola', c: ['x'] });
    expect(r.dropped).toBe(1);
    expect(r.response.id).toBe('r1');
    expect(cleanResponse(f, { answers: {} })).toBeNull();
    expect(cleanResponse(f, 'x')).toBeNull();
    expect(cleanResponse(f, { at: 'nunca', answers: { a: 'x' } })!.response.at).toMatch(/^\d{4}-/);
  });
});

describe('summary', () => {
  const f = form([
    q('choice', { id: 'a', options: ['x', 'y'], allowOther: true }),
    q('multi', { id: 'b', options: ['p', 'q'] }),
    q('rating', { id: 'c', max: 5 }),
    q('nps', { id: 'd' }),
    q('number', { id: 'e' }),
    q('likert', { id: 'g', rows: ['r1'], options: ['bajo', 'alto'] }),
    q('text', { id: 'h' }),
    q('title', { id: 't' }),
  ]);
  const rs = [
    resp({ a: 'x', b: ['p', 'q'], c: 5, d: 10, e: 4, g: { r1: 'alto' }, h: 'uno' }),
    resp({ a: 'x', b: ['p'], c: 3, d: 9, e: 8, g: { r1: 'alto' } }),
    resp({ a: 'otra', c: 4, d: 3, e: 6, g: { r1: 'bajo' } }),
    resp({ c: 4, d: 7, e: 2 }),
  ];
  const s = summarize(f, rs);
  it('counts and percentages are of the people who answered', () => {
    expect(s.total).toBe(4);
    expect(s.questions).toHaveLength(7); // the title is not a question
    const a = s.questions[0]!;
    expect(a.kind).toBe('counts');
    if (a.kind === 'counts') {
      expect(a.answered).toBe(3);
      expect(a.items.map((i) => [i.label, i.count])).toEqual([['x', 2], ['y', 0], ['Otras respuestas', 1]]);
      expect(a.items[0]!.pct).toBe(66.7);
      expect(a.others).toEqual(['otra']);
    }
    const b = s.questions[1]!;
    if (b.kind === 'counts') expect(b.items.map((i) => i.count)).toEqual([2, 1]);
  });
  it('rating, NPS, number and likert', () => {
    const [, , c, d, e, g] = s.questions;
    if (c!.kind === 'rating') expect(c!.average).toBe(4);
    if (d!.kind === 'nps') expect([d!.score, d!.promoters, d!.detractors, d!.passives]).toEqual([25 - 25 + 0, 2, 1, 1].map((x, i) => (i === 0 ? 25 : x)));
    if (e!.kind === 'number') expect([e!.average, e!.min, e!.max, e!.median]).toEqual([5, 2, 8, 5]);
    if (g!.kind === 'likert') {
      expect(g!.rows[0]!.counts).toEqual([1, 2]);
      expect(g!.rows[0]!.average).toBeCloseTo(5 / 3);
    }
  });
  it('quiz statistics and empty forms', () => {
    const qf = form([q('choice', { id: 'a', options: ['x', 'y'], correct: ['x'], points: 2 })], { quiz: true });
    const qs = summarize(qf, [resp({ a: 'x' }), resp({ a: 'y' })]);
    expect(qs.quiz).toEqual({ average: 1, max: 2, best: 2, worst: 0 });
    const none = summarize(f, []);
    expect(none.total).toBe(0);
    expect(none.first).toBeNull();
    expect(none.quiz).toBeNull();
  });
});

describe('files', () => {
  const f = form([q('text', { id: 'a', title: 'Nombre' }), q('likert', { id: 'g', title: 'Valora', rows: ['uno', 'dos'], options: ['x', 'y'] }), q('multi', { id: 'm', title: 'Cosas', options: ['p', 'q'] })], { quiz: true });
  it('project round trip and repairs', () => {
    const p = { form: f, responses: [resp({ a: 'Ana', m: ['p', 'q'] }, 'r1')] };
    const r = parseProject(serializeProject(p));
    expect(r.project).toEqual(p);
    expect(() => parseProject('hola')).toThrow(/JSON/);
    expect(() => parseProject('{"format":"x"}')).toThrow(/no es un formulario/);
    const bad = parseProject(JSON.stringify({ format: 'novaforms', form: { title: 7, color: 'rojo', questions: [{ id: 'a', type: 'inventada', showIf: { question: 'zzz', op: 'eq', value: 'x' } }, { id: 'a', type: 'rating', max: 99 }] }, responses: [{ id: 'x', answers: { a: 'ok' } }, 'basura', { id: 'x', answers: { a: 'dup' } }] }));
    const fb = bad.project.form;
    expect(fb.color).toBe('#0f6cbd');
    expect(fb.questions.map((x) => x.type)).toEqual(['text', 'rating']);
    expect(new Set(fb.questions.map((x) => x.id)).size).toBe(2);
    expect(fb.questions[0]!.showIf).toBeNull();
    expect(fb.questions[1]!.max).toBe(10);
    expect(bad.project.responses).toHaveLength(1);
    expect(bad.warnings[0]).toMatch(/2 respuestas/);
  });
  it('imports responses from a single file, a list and a whole project; skips repeats; refuses another form', () => {
    const r1 = resp({ a: 'Ana' }, 'r1');
    const one = parseResponses(serializeResponse(f, r1), f);
    expect(one.responses).toEqual([r1]);
    expect(parseResponses(serializeResponse(f, r1), f, [r1])).toMatchObject({ responses: [], warnings: [expect.stringMatching(/ya estaban/)] });
    expect(parseResponses(JSON.stringify([r1, resp({ a: 'Luis' }, 'r2'), { x: 1 }]), f).responses).toHaveLength(2);
    expect(parseResponses(serializeProject({ form: f, responses: [r1] }), f).responses).toHaveLength(1);
    const other = { ...f, id: 'otro' };
    expect(() => parseResponses(serializeResponse(other, r1), f)).toThrow(/otro formulario/);
    expect(() => parseResponses('{"a":1}', f)).toThrow(/no contiene respuestas/);
    expect(() => parseResponses('x', f)).toThrow(/JSON/);
  });
  it('CSV: one column per likert row, quiz columns, quoting and formula safety', () => {
    const rs = [resp({ a: '=HYPERLINK("x")', g: { uno: 'x' }, m: ['p', 'q'] }, 'r1'), resp({ a: 'con; punto y "comillas"', g: { uno: 'y', dos: 'x' } }, 'r2')];
    const csv = responsesToCsv(f, rs);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe('Id;Fecha;Puntuación;Puntuación máxima;Nombre;Valora [uno];Valora [dos];Cosas');
    expect(lines[1]).toContain("'=HYPERLINK(");
    expect(lines[1]).toMatch(/;x;;p \| q$/);
    expect(lines[2]).toContain('"con; punto y ""comillas"""');
    expect(lines).toHaveLength(3);
  });
});

describe('standalone HTML', () => {
  const f = form([q('text', { id: 'a', title: '</script><b>x', required: true }), q('choice', { id: 'b', options: ['x', 'y'], correct: ['x'] })], { title: 'A & B <i>', quiz: true });
  it('is one safe page: nothing can break out of the embedded data', () => {
    const html = exportHtml(f);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>A &amp; B &lt;i&gt;</title>');
    expect(html).toContain("default-src 'none'");
    expect((html.match(/<\/script>/g) ?? []).length).toBe(2); // the data block and the program, nothing else
    expect(html).toContain('\\u003c/script>');
    const data = html.match(/<script type="application\/json" id="form-data">(.*?)<\/script>/s)![1]!;
    expect(JSON.parse(data).title).toBe('A & B <i>');
  });
  it('correct answers are only embedded when the score is shown', () => {
    const embedded = (h: string) => JSON.parse(h.match(/id="form-data">(.*?)<\/script>/s)![1]!).questions[1].correct;
    expect(embedded(exportHtml({ ...f, showScore: true }))).toEqual(['x']);
    expect(embedded(exportHtml({ ...f, showScore: false }))).toEqual([]);
  });
});

describe('the logic inside the HTML agrees with the TypeScript rules', () => {
  const js = new Function(`${LOGIC_JS}; return { isVisible, validateAnswer, validateAll, visibleAnswers, score };`)() as {
    isVisible: (f: Form, q: Question, a: Record<string, Answer>) => boolean;
    validateAnswer: (q: Question, a: Answer | undefined) => string | null;
    validateAll: (f: Form, a: Record<string, Answer>) => Record<string, string>;
    visibleAnswers: (f: Form, a: Record<string, Answer>) => Record<string, Answer>;
    score: (f: Form, a: Record<string, Answer>) => unknown;
  };
  const qs: Question[] = [
    q('text', { id: 't1', required: true }), q('text', { id: 't2', format: 'email', min: 3 }), q('longtext', { id: 't3', maxValue: 5 }), q('text', { id: 't4', format: 'url' }),
    q('number', { id: 'n1', min: 1, maxValue: 9, integer: true }), q('number', { id: 'n2', correct: ['2,5'] }), q('date', { id: 'd1' }), q('rating', { id: 'r1', max: 4 }), q('nps', { id: 'p1' }),
    q('choice', { id: 'c1', options: ['A', 'B'], allowOther: true, correct: ['A'], showIf: { question: 't1', op: 'contains', value: 'sí' } }), q('dropdown', { id: 'c2', options: ['A', 'B'], correct: ['b'] }),
    q('multi', { id: 'm1', options: ['A', 'B', 'C'], correct: ['a', 'c'], required: true }), q('likert', { id: 'l1', rows: ['x', 'y'], options: ['1', '2'], required: true }), q('title', { id: 'ti' }),
  ];
  const f = form(qs, { quiz: true });
  const samples: Answer[] = [null, '', '  ', 'sí', 'No', 'a@b.co', 'a@b', 'https://x.org', 'ftp://x', 'abcdefg', '2025-01-31', '2025-13-01', '2,5', '12', 0, 3, 3.5, 11, ['A'], ['a', 'c'], ['A', 'Z'], { x: '1' }, { x: '1', y: '2' }, { x: '9' }, 'A', 'B', 'Z'];
  it('same errors for every question and sample', () => {
    for (const x of qs) for (const s of samples) expect(js.validateAnswer(x, s), `${x.id} ${JSON.stringify(s)}`).toBe(validateAnswer(x, s));
  });
  it('same visibility, validation, cleaned answers and score on whole forms', () => {
    const cases: Record<string, Answer>[] = [
      {},
      { t1: 'sí', c1: 'A', m1: ['A', 'C'], l1: { x: '1', y: '2' }, c2: 'B', n2: 2.5 },
      { t1: 'no', c1: 'A', m1: ['B'], l1: { x: '1' } },
      { t1: 'Sí quiero', c1: 'Otro', t2: 'x@y.zz', n1: '4', p1: 10, r1: 2, d1: '2025-02-02' },
    ];
    for (const a of cases) {
      expect(js.validateAll(f, a)).toEqual(validateAll(f, a));
      expect(js.visibleAnswers(f, a)).toEqual(visibleAnswers(f, a));
      expect(js.score(f, a)).toEqual(score(f, a));
      for (const x of qs) expect(js.isVisible(f, x, a)).toBe(isVisible(f, x, a));
    }
  });
});
