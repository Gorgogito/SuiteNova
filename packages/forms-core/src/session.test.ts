import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileProblem } from './files';
import { LOGIC_JS, exportHtml } from './html';
import { PAGE_EN, localize } from './i18n';
import { parseProject, parseResponses, responsesToCsv, serializeProject, serializeResponse } from './io';
import { validateAnswer } from './logic';
import { newForm, newQuestion, showIfOf, type Answer, type Form, type Question, type UploadedFile } from './model';
import { answerLines, availability, closedText, outsideDates, pageBackground, receiptHtml, tidyAnswers, timedAnswers } from './session';

const q = (id: string, type: Question['type'], over: Partial<Question> = {}): Question => ({ ...newQuestion(type), id, ...over });
const form = (questions: Question[], over: Partial<Form> = {}): Form => ({ ...newForm(), id: 'f', questions, ...over });
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const at = (s: string) => Date.parse(s);

describe('cuándo admite respuestas', () => {
  it('cerrado a mano, antes de empezar o después de acabar', () => {
    const f = { start: '2026-06-01T08:00:00.000Z', end: '2026-06-02T08:00:00.000Z' };
    expect(availability({}, 0)).toBe('open');
    expect(availability({ closed: true, ...f }, at('2026-06-01T12:00:00Z'))).toBe('closed');
    expect(availability(f, at('2026-06-01T07:59:59Z'))).toBe('notYet');
    expect(availability(f, at('2026-06-01T08:00:00Z'))).toBe('open');
    expect(availability(f, at('2026-06-02T08:00:00Z'))).toBe('closed');
    expect(outsideDates(f, '2026-06-01T09:00:00Z')).toBe(false);
    expect(outsideDates(f, '2026-05-31T09:00:00Z')).toBe(true);
    expect(outsideDates(f, '2026-07-01T09:00:00Z')).toBe(true);
    expect(outsideDates({}, 'ahora')).toBe(false);
  });

  it('lo que dice a quien llega', () => {
    const f = form([], { closed: true });
    expect(closedText(f, 'closed')).toEqual(['Este formulario ya no admite respuestas.']);
    expect(closedText({ ...f, language: 'en' }, 'closed')).toEqual(['This form is no longer accepting responses.']);
    expect(closedText({ ...f, closedMessage: 'Vuelve en julio', language: 'en' }, 'closed')).toEqual(['Vuelve en julio']);
    const soon = closedText(form([], { start: '2026-06-01T08:00:00.000Z', language: 'en' }), 'notYet', 'en-GB');
    expect(soon[0]).toBe('This form is not accepting responses yet.');
    expect(soon[1]).toMatch(/^It starts on 1 June 2026/);
  });
});

describe('lo que se guarda y lo que se enseña', () => {
  const qs = [
    q('t', 'text', { title: 'Nombre del curso', required: true }),
    q('n', 'number', { title: 'Horas', maxValue: 10 }),
    q('m', 'multi', { title: 'Días', options: ['L', 'M'], allowOther: true, min: 2 }),
    q('s', 'title', { title: 'Parte' }),
    q('r', 'ranking', { title: 'Orden', options: ['A', 'B'] }),
    q('g', 'likert', { title: 'Escala', rows: ['x'], options: ['1'] }),
    q('h', 'text', { title: 'Oculta', showIf: showIfOf([{ question: 't', op: 'eq', value: 'no' }]) }),
  ];
  const f = form(qs);

  it('sin espacios sobrantes; al acabarse el tiempo, solo lo bien respondido', () => {
    const typed = { t: '  Álgebra ', n: '4', m: ['L', ' otro ', ' '], h: 'x' };
    expect(tidyAnswers(f, typed)).toEqual({ t: 'Álgebra', n: 4, m: ['L', 'otro'] });
    expect(timedAnswers(f, { t: '', n: '50', m: ['L'], r: ['B'], g: { x: '1' } })).toEqual({ g: { x: '1' } });
    expect(timedAnswers(f, typed)).toEqual({ t: 'Álgebra', n: 4, m: ['L', 'otro'] });
  });

  it('las respuestas en palabras y la hoja para imprimir', () => {
    const answers: Record<string, Answer> = { t: '<b>x</b>', m: ['L', 'M'], r: ['B', 'A'], g: { x: '1' } };
    expect(answerLines(f, answers, 'Ana').map((l) => `${l.label}=${l.text}`)).toEqual(['Nombre=Ana', '1. Nombre del curso=<b>x</b>', '2. Horas=—', '3. Días=L, M', '4. Orden=1. B  2. A', '5. Escala=x: 1']);
    expect(answerLines({ ...f, hideNumbers: true }, answers)[0]!.label).toBe('Nombre del curso');
    const html = receiptHtml({ ...f, language: 'en', title: 'A & B' }, answers, 'Ana', '2026-06-01T08:00:00Z', 'en-GB');
    expect(html).toContain('<h1>A &amp; B</h1><h2>My answers</h2><p>Sent on 1 June 2026');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x');
  });

  it('el fondo: solo imágenes seguras y colores de verdad', () => {
    expect(pageBackground({ color: '#107c10' }, 'white')).toBeNull();
    expect(pageBackground({ color: '#107c10', background: 'tint' }, 'white')).toBe('color-mix(in srgb, #107c10 16%, white)');
    expect(pageBackground({ color: 'red;}body{x', background: 'gradient' }, 'white')).toContain('#0f6cbd');
    expect(pageBackground({ color: '#107c10', background: 'image', backgroundImage: PNG }, 'white')).toBe(`url("${PNG}") center / cover fixed, white`);
    for (const bad of [undefined, 'https://x.org/a.png', 'data:image/png;base64,x")}', 'data:image/svg+xml;base64,PHN2Zz4=']) expect(pageBackground({ color: '#107c10', background: 'image', backgroundImage: bad }, 'white')).toBeNull();
  });
});

describe('nombre y ajustes en los archivos', () => {
  const f = form([q('t', 'text')], { askName: true, end: '2026-06-02T00:00:00.000Z' });
  const r = { id: 'r1', at: '2026-06-01T10:00:00Z', name: 'Ana', answers: { t: 'x' } };

  it('el nombre va y vuelve, y sale en la tabla', () => {
    expect(parseProject(serializeProject({ form: f, responses: [r] })).project).toEqual({ form: f, responses: [r] });
    expect(parseResponses(serializeResponse(f, r), f).responses).toEqual([r]);
    expect(parseResponses(JSON.stringify([{ ...r, id: 'r2', name: `  ${'n'.repeat(300)} ` }, { ...r, id: 'r3', name: 5 }]), f).responses.map((x) => x.name?.length)).toEqual([200, undefined]);
    expect(responsesToCsv(f, [r]).split('\r\n')[0]).toContain('Fecha;Nombre;');
    expect(responsesToCsv(form([q('t', 'text')]), [{ ...r, name: undefined as never }]).split('\r\n')[0]).not.toContain('Nombre');
  });

  it('avisa de las respuestas fuera de plazo, sin descartarlas', () => {
    const late = parseResponses(JSON.stringify([{ ...r, at: '2026-07-01T00:00:00Z' }]), f);
    expect(late.responses).toHaveLength(1);
    expect(late.warnings.join()).toContain('fuera del plazo');
  });

  it('se leen los ajustes que tienen sentido', () => {
    const raw = { format: 'novaforms', form: { closed: 'sí', closedMessage: 'Fin', start: '2026-06-01T10:00', end: 'mañana', timeLimit: 9999, noAgain: true, receipt: true, askName: 1, background: 'cielo', backgroundImage: 'https://x', language: 'fr', questions: [] } };
    const back = parseProject(JSON.stringify(raw)).project.form;
    expect(back).toMatchObject({ closedMessage: 'Fin', start: new Date('2026-06-01T10:00').toISOString(), timeLimit: 600, noAgain: true, receipt: true });
    for (const key of ['closed', 'end', 'askName', 'background', 'backgroundImage', 'language'] as const) expect(back[key], key).toBeUndefined();
    const good = form([], { closed: true, timeLimit: 5, background: 'image', backgroundImage: PNG, language: 'en' });
    expect(parseProject(serializeProject({ form: good, responses: [] })).project.form).toEqual(good);
  });
});

describe('el idioma', () => {
  it('traduce los textos del programa y deja los demás', () => {
    expect(localize('Enviar', 'es')).toBe('Enviar');
    expect(localize('Enviar', undefined)).toBe('Enviar');
    expect(localize('Enviar', 'en')).toBe('Submit');
    expect(localize('Escribe un número menor que 1 o mayor que 3.', 'en')).toBe('Type a number less than 1 or greater than 3.');
    expect(localize('El archivo «a (1).txt» pasa de 5 MB.', 'en')).toBe('The file “a (1).txt” is over 5 MB.');
    expect(localize('Elige al menos 2 opciones.', 'en')).toBe('Choose at least 2 options.');
    expect(localize('Subir Álgebra', 'en')).toBe('Move up Álgebra');
    expect(localize('Mi propio texto', 'en')).toBe('Mi propio texto');
  });

  it('todo error posible tiene su traducción', () => {
    const file = (name: string, size: number): UploadedFile => ({ name, size, type: '', data: '' });
    const MB = 1048576;
    const cases: [Question, Answer][] = [
      [q('a', 'text', { required: true }), ''], [q('a', 'text', { format: 'email' }), 'x'], [q('a', 'text', { format: 'url' }), 'x'], [q('a', 'text', { min: 3 }), 'x'], [q('a', 'text', { maxValue: 1 }), 'xx'],
      [q('a', 'number'), 'x'], [q('a', 'number', { integer: true }), 1.5], [q('a', 'number', { min: 2 }), 1], [q('a', 'number', { maxValue: -2.5 }), 1], [q('a', 'number', { rule: 'gt', min: 2 }), 1], [q('a', 'number', { rule: 'lt', maxValue: 0 }), 1], [q('a', 'number', { rule: 'ne', min: 1 }), 1], [q('a', 'number', { rule: 'outside', min: 0, maxValue: 2 }), 1],
      [q('a', 'date'), 'x'], [q('a', 'rating'), 9], [q('a', 'nps'), 11], [q('a', 'choice'), 3], [q('a', 'choice'), 'z'], [q('a', 'multi'), 'x'], [q('a', 'multi'), ['z']], [q('a', 'multi', { min: 2 }), ['Opción 1']], [q('a', 'multi', { maxValue: 1 }), ['Opción 1', 'Opción 2']],
      [q('a', 'ranking'), ['z']], [q('a', 'ranking'), ['Elemento 1']], [q('a', 'file'), 'x'], [q('a', 'file'), [file('a.txt', 1), file('b.txt', 1)]], [q('a', 'file', { maxFiles: 10 }), Array.from({ length: 3 }, (_, i) => file(`${i}.txt`, 9 * MB))],
      [q('a', 'file'), [file('a.exe', 1)]], [q('a', 'file', { kinds: ['pdf'] }), [file('a.txt', 1)]], [q('a', 'file'), [file('a.txt', 0)]], [q('a', 'file', { maxMb: 1 }), [file('a.txt', 2 * MB)]],
      [q('a', 'likert'), 'x'], [q('a', 'likert', { required: true }), { 'Afirmación 1': 'De acuerdo' }], [q('a', 'likert'), { 'Afirmación 1': 'z' }],
    ];
    for (const [question, answer] of cases) {
      const error = validateAnswer(question, answer);
      expect(error, `${question.type} ${JSON.stringify(answer)}`).toBeTruthy();
      expect(localize(error!, 'en'), error!).not.toBe(error);
    }
    expect(localize(fileProblem({}, 'a.exe', 1)!, 'en')).toBe('.exe files are not accepted.');
  });

  it('todo texto que la página pide traducir está en la lista', () => {
    const source = fs.readFileSync(path.resolve(__dirname, 'html.ts'), 'utf8');
    const asked = [...source.matchAll(/\bL\('((?:[^'\\]|\\.)*)'\)/g)].map((m) => m[1]!);
    expect(asked.length).toBeGreaterThan(25);
    expect(asked.filter((text) => localize(text, 'en') === text && text !== 'Audio')).toEqual([]);
  });

  it('la página en inglés lo dice y la de siempre sigue en español', () => {
    const english = exportHtml(form([q('a', 'text')], { language: 'en', title: 'Encuesta' }));
    expect(english).toContain('<html lang="en">');
    expect(english).toContain('<p class="foot">Form made with Nova Forms</p>');
    expect(english).toContain('<title>Encuesta</title>');
    const spanish = exportHtml(form([q('a', 'text')]));
    expect(spanish).toContain('<html lang="es">');
    expect(spanish).not.toContain('class="bg"');
    const behind = exportHtml(form([q('a', 'text')], { background: 'image', backgroundImage: PNG }));
    expect(behind).toContain(`@media screen{body{background:url("${PNG}") center / cover fixed, var(--bg);`);
    expect(behind).toContain('<body class="bg">');
    for (const html of [english, spanish, behind]) {
      const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
      expect(() => new Function(script)).not.toThrow();
    }
  });
});

describe('la página web decide lo mismo', () => {
  const js = new Function(`${LOGIC_JS}; return { localize, availability, tidyAnswers, timedAnswers, answerLines };`)() as {
    localize: typeof localize;
    availability: typeof availability;
    tidyAnswers: typeof tidyAnswers;
    timedAnswers: typeof timedAnswers;
    answerLines: typeof answerLines;
  };

  it('idioma', () => {
    const texts = PAGE_EN.map(([es]) => es.replace(/\{#\}/g, '7').replace(/\{\*\}/g, 'algo (1).x'));
    for (const text of [...texts, 'Mi texto', 'Escribe un número mayor que -2.5.']) {
      expect(js.localize(text, 'en'), text).toBe(localize(text, 'en'));
      expect(js.localize(text, 'es')).toBe(text);
    }
  });

  it('plazo, respuestas guardadas y texto de las respuestas', () => {
    const dates = { start: '2026-06-01T08:00:00.000Z', end: '2026-06-02T08:00:00.000Z' };
    for (const f of [{}, { closed: true }, dates]) for (const now of [at('2026-05-01'), at('2026-06-01T09:00:00Z'), at('2026-07-01')]) expect(js.availability(f, now)).toBe(availability(f, now));
    const f = form([
      q('t', 'text', { required: true }), q('n', 'number', { maxValue: 10 }), q('m', 'multi', { options: ['L', 'M'], allowOther: true, min: 2 }), q('r', 'ranking', { options: ['A', 'B'] }),
      q('g', 'likert', { rows: ['x'], options: ['1'] }), q('f', 'file'), q('s', 'section'), q('h', 'text', { showIf: showIfOf([{ question: 't', op: 'eq', value: 'no' }]) }),
    ]);
    const samples: Record<string, Answer>[] = [
      {},
      { t: '  a ', n: '4', m: ['L', ' o ', ' '], r: ['B', 'A'], g: { x: '1' }, f: [{ name: 'a.txt', size: 3, type: '', data: 'QUJD' }] },
      { t: 'no', n: '50', m: ['L'], r: ['B'], h: 'visto', f: [{ name: 'a.exe', size: 3, type: '', data: 'QUJD' }] },
      { n: '2,5', t: '' },
    ];
    for (const a of samples) {
      expect(js.tidyAnswers(f, a)).toEqual(tidyAnswers(f, a));
      expect(js.timedAnswers(f, a)).toEqual(timedAnswers(f, a));
      for (const over of [{}, { hideNumbers: true, language: 'en' as const }]) expect(js.answerLines({ ...f, ...over }, a, 'Ana')).toEqual(answerLines({ ...f, ...over }, a, 'Ana'));
    }
  });
});
