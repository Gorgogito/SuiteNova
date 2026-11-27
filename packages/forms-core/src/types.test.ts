import { describe, expect, it } from 'vitest';
import { removeItem, renameItem } from './edit';
import { BLOCKED_EXTENSIONS, MB, base64Size, extensionOf, fileProblem, readFileItem, safeFileName } from './files';
import { LOGIC_JS, exportHtml } from './html';
import { parseProject, parseResponses, responsesToCsv, serializeProject, serializeResponse } from './io';
import { cleanResponse, isVisible, orderOf, shuffled, validateAll, validateAnswer, visibleAnswers } from './logic';
import { newForm, newQuestion, type Answer, type Form, type Question, type UploadedFile } from './model';
import { summarize } from './summary';

const q = (id: string, type: Question['type'], over: Partial<Question> = {}): Question => ({ ...newQuestion(type), id, ...over });
const form = (questions: Question[], over: Partial<Form> = {}): Form => ({ ...newForm(), id: 'f', questions, ...over });
const file = (name: string, bytes = 3, type = ''): UploadedFile => {
  const data = Buffer.alloc(bytes, 65).toString('base64');
  return { name, size: bytes, type, data };
};
const response = (id: string, answers: Record<string, Answer>) => ({ id, at: '2026-01-01T00:00:00Z', answers });

describe('límites de número y de casillas', () => {
  const check = (over: Partial<Question>, values: number[]) => values.map((v) => validateAnswer(q('n', 'number', over), v));

  it('cada regla', () => {
    expect(check({ rule: 'gt', min: 5 }, [5, 6])).toEqual(['Escribe un número mayor que 5.', null]);
    expect(check({ rule: 'lt', maxValue: 5 }, [5, 4])).toEqual(['Escribe un número menor que 5.', null]);
    expect(check({ rule: 'ne', min: 0 }, [0, 1])).toEqual(['El número no puede ser 0.', null]);
    expect(check({ rule: 'outside', min: 1, maxValue: 3 }, [0, 1, 3, 4])).toEqual([null, 'Escribe un número menor que 1 o mayor que 3.', 'Escribe un número menor que 1 o mayor que 3.', null]);
    expect(check({ min: 1, maxValue: 3 }, [0, 1, 3, 4])).toEqual(['El valor mínimo es 1.', null, null, 'El valor máximo es 3.']);
    // without its bound, a rule limits nothing
    expect(check({ rule: 'gt' }, [-9])).toEqual([null]);
    expect(check({ rule: 'outside', min: 1 }, [2])).toEqual([null]);
  });

  it('cuántas casillas', () => {
    const m = q('m', 'multi', { options: ['a', 'b', 'c'], min: 2, maxValue: 2 });
    expect([['a'], ['a', 'b'], ['a', 'b', 'c']].map((a) => validateAnswer(m, a))).toEqual(['Elige al menos 2 opciones.', null, 'Elige como máximo 2 opciones.']);
    // not required and left empty: nothing to say
    expect(validateAnswer(m, [])).toBeNull();
  });
});

describe('clasificación', () => {
  const r = q('r', 'ranking', { options: ['A', 'B', 'C'] });

  it('hay que ordenarlo todo, sin repetir', () => {
    expect(validateAnswer(r, ['C', 'A', 'B'])).toBeNull();
    expect(validateAnswer(r, ['C', 'A'])).toBe('Ordena todos los elementos.');
    expect(validateAnswer(r, ['A', 'A', 'B'])).toBe('Ordena todos los elementos.');
    expect(validateAnswer(r, ['A', 'B', 'Z'])).toBe('Hay un elemento que no existe.');
    expect(validateAnswer({ ...r, required: true }, [])).toBe('Esta pregunta es obligatoria.');
  });

  it('el resumen da el puesto medio, y renombrar y quitar siguen a lo ordenado', () => {
    const f = form([r]);
    const rs = [response('1', { r: ['C', 'A', 'B'] }), response('2', { r: ['C', 'B', 'A'] }), response('3', { r: ['A', 'C', 'B'] })];
    expect(summarize(f, rs).questions[0]).toMatchObject({ kind: 'ranking', answered: 3, items: [{ label: 'C', first: 2 }, { label: 'A', average: 2, first: 1 }, { label: 'B', first: 0 }] });
    const doc = renameItem({ form: f, responses: rs }, 'r', 'options', 2, 'Ce');
    expect(doc.responses[0]!.answers.r).toEqual(['Ce', 'A', 'B']);
    const less = removeItem(doc, 'r', 'options', 0);
    expect(summarize(less.form, less.responses).questions[0]).toMatchObject({ items: [{ label: 'Ce' }, { label: 'B' }] });
    expect(responsesToCsv(f, rs.slice(0, 1))).toContain(';C > A > B');
  });

  it('una condición no puede depender de ella', () => {
    const f = form([r, q('t', 'text', { showIf: { question: 'r', op: 'eq', value: 'A' } })]);
    expect(parseProject(serializeProject({ form: f, responses: [] })).project.form.questions[1]!.showIf).toBeNull();
  });
});

describe('archivos', () => {
  it('nombres seguros y tipos vetados', () => {
    expect(safeFileName('C:\\x\\..\\informe?.pdf')).toBe('informe_.pdf');
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('factura‮fdp.exe')).toBe('facturafdp.exe');
    expect(safeFileName('CON.txt')).toBe('_CON.txt');
    expect(safeFileName('...')).toBe('archivo');
    expect(extensionOf('a.PDF.EXE. ')).toBe('exe');
    for (const ext of ['exe', 'bat', 'ps1', 'js', 'lnk', 'html', 'svg', 'msi', 'iso']) expect(BLOCKED_EXTENSIONS).toContain(ext);
    const any = q('a', 'file');
    expect(fileProblem(any, 'virus.pdf.exe', 3)).toBe('No se admiten archivos .exe.');
    expect(fileProblem(any, 'sin-extension', 3)).toBeNull();
    expect(fileProblem(any, 'a.pdf', 0)).toContain('vacío');
    expect(fileProblem(any, 'a.pdf', 10 * MB + 1)).toContain('pasa de 10 MB');
    const pics = q('p', 'file', { kinds: ['image'], maxMb: 1 });
    expect(fileProblem(pics, 'foto.JPG', MB)).toBeNull();
    expect(fileProblem(pics, 'a.pdf', 3)).toContain('no es de un tipo admitido');
    // a blocked one stays blocked even among the allowed kinds
    expect(fileProblem(pics, 'dibujo.svg', 3)).toBe('No se admiten archivos .svg.');
  });

  it('cuántos y cuánto pesan entre todos', () => {
    const f = q('f', 'file', { maxFiles: 2 });
    expect(validateAnswer(f, [file('a.txt'), file('b.txt')])).toBeNull();
    expect(validateAnswer(f, [file('a.txt'), file('b.txt'), file('c.txt')])).toContain('como máximo 2');
    const many = q('f', 'file', { maxFiles: 10 });
    expect(validateAnswer(many, Array.from({ length: 3 }, (_, i) => ({ ...file(`${i}.txt`), size: 9 * MB })))).toContain('pasan de 25 MB');
    expect(validateAnswer(f, 'texto' as never)).toBe('Adjunta un archivo.');
  });

  it('lo que llega de fuera se limpia: nombre, contenido y tamaño real', () => {
    expect(readFileItem({ name: '..\\a.txt', size: 999999, data: 'QUJD', type: '<x>' })).toEqual({ name: 'a.txt', size: 3, type: '', data: 'QUJD' });
    expect(base64Size('QQ==')).toBe(1);
    for (const bad of [null, { name: 'a' }, { name: 'a', data: 'no es base64!' }, { name: 'a', data: 'QUJ' }, { name: 3, data: 'QUJD' }]) expect(readFileItem(bad)).toBeNull();
    const f = form([q('f', 'file', { maxFiles: 2 })]);
    expect(cleanResponse(f, { answers: { f: [{ name: 'a.txt', data: 'QUJD' }, 'basura'] } })!.response.answers.f).toEqual([{ name: 'a.txt', size: 3, type: '', data: 'QUJD' }]);
    expect(cleanResponse(f, { answers: { f: [{ name: 'a.exe', data: 'QUJD' }] } })).toBeNull();
  });

  it('van y vuelven en el archivo y en un archivo de respuesta; el resumen y la tabla los nombran', () => {
    const f = form([q('f', 'file', { maxFiles: 2, kinds: ['document'], maxMb: 2 })]);
    const r = response('1', { f: [file('uno.txt', 4, 'text/plain'), file('dos.md', 5)] });
    const back = parseProject(serializeProject({ form: f, responses: [r] })).project;
    expect(back.form.questions[0]).toMatchObject({ maxFiles: 2, kinds: ['document'], maxMb: 2 });
    expect(back.responses).toEqual([r]);
    expect(parseResponses(serializeResponse(f, r), f).responses).toEqual([r]);
    expect(summarize(f, [r]).questions[0]).toMatchObject({ kind: 'files', files: [{ response: 1, file: { name: 'uno.txt' } }, { response: 1 }] });
    expect(responsesToCsv(f, [r])).toContain(';uno.txt | dos.md');
    // taking the question's limits down does not take away what was collected
    const tighter = { ...f, questions: [{ ...f.questions[0]!, maxFiles: 1, kinds: ['pdf' as const] }] };
    expect(parseProject(serializeProject({ form: tighter, responses: [r] })).project.responses).toEqual([r]);
  });
});

describe('barajar', () => {
  it('cada semilla da su orden, siempre el mismo y sin perder nada', () => {
    const list = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const one = shuffled(list, 'uno');
    expect(one).toEqual(shuffled(list, 'uno'));
    expect([...one].sort()).toEqual(list);
    expect(new Set(['1', '2', '3', '4', '5'].map((s) => shuffled(list, s).join())).size).toBeGreaterThan(3);
    expect(list.join('')).toBe('abcdefgh');
    const plain = q('c', 'choice', { options: list });
    expect(orderOf(plain, 'uno')).toBe(list);
    expect(orderOf({ ...plain, shuffle: true }, 'uno')).toEqual(shuffled(list, 'unoc'));
  });
});

describe('la página web hace lo mismo con lo nuevo', () => {
  const js = new Function(`${LOGIC_JS}; return { validateAnswer, validateAll, visibleAnswers, isVisible, shuffled, fileProblem };`)() as {
    validateAnswer: typeof validateAnswer;
    validateAll: typeof validateAll;
    visibleAnswers: typeof visibleAnswers;
    isVisible: typeof isVisible;
    shuffled: typeof shuffled;
    fileProblem: typeof fileProblem;
  };
  const qs = [
    q('n1', 'number', { rule: 'gt', min: 2 }),
    q('n2', 'number', { rule: 'lt', maxValue: 2 }),
    q('n3', 'number', { rule: 'ne', min: 3 }),
    q('n4', 'number', { rule: 'outside', min: 1, maxValue: 3, integer: true }),
    q('m', 'multi', { options: ['A', 'B', 'C'], min: 2, maxValue: 2, required: true }),
    q('r', 'ranking', { options: ['A', 'B', 'C'] }),
    q('f', 'file', { maxFiles: 2, kinds: ['image', 'pdf'], maxMb: 1 }),
    q('g', 'file'),
    q('t', 'text', { showIf: { question: 'f', op: 'contains', value: 'a' } }),
  ];
  const samples: Answer[] = [
    null, '', 0, 1, 2, 2.5, 3, 4, '2,5', 'x', [], ['A'], ['A', 'B'], ['C', 'A', 'B'], ['A', 'A', 'B'], ['A', 'B', 'Z'],
    [file('a.png')], [file('a.pdf'), file('b.jpg')], [file('a.exe')], [file('a.doc')], [file('a.png', 0)], [{ ...file('a.png'), size: 2 * MB }], [file('a.png'), file('b.png'), file('c.png')], { x: '1' },
  ];

  it('los mismos errores para cada pregunta y muestra', () => {
    for (const x of qs) for (const s of samples) expect(js.validateAnswer(x, s), `${x.id} ${JSON.stringify(s)}`).toBe(validateAnswer(x, s));
  });

  it('el mismo orden barajado, y archivos como respuesta no rompen una condición', () => {
    const list = ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis'];
    for (const seed of ['', 'a', 'rk3x9qy', 'ñandú']) expect(js.shuffled(list, seed)).toEqual(shuffled(list, seed));
    const f = form(qs);
    const a: Record<string, Answer> = { f: [file('a.png')], r: ['A', 'B', 'C'] };
    expect(js.isVisible(f, qs[8]!, a)).toBe(isVisible(f, qs[8]!, a));
    expect(js.validateAll(f, a)).toEqual(validateAll(f, a));
    expect(js.visibleAnswers(f, a)).toEqual(visibleAnswers(f, a));
  });

  it('la página lleva las ecuaciones ya dibujadas y sin salirse de sus datos', () => {
    const html = exportHtml(form([q('t', 'text', { title: 'Área', equation: 'A=\\pi r^2 </script><b>' })]));
    const data = JSON.parse(/id="form-data">(.*?)<\/script>/s.exec(html)![1]!) as { questions: { mathml: string }[] };
    expect(data.questions[0]!.mathml).toMatch(/^<math [^>]*display="block"/);
    expect(data.questions[0]!.mathml).toContain('<msup>');
    expect(data.questions[0]!.mathml).not.toContain('<b>');
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
    expect(() => new Function(script)).not.toThrow();
  });
});

describe('ajustes en el archivo', () => {
  it('se leen los que tienen sentido y el resto se ignora', () => {
    const raw = {
      format: 'novaforms',
      form: {
        questions: [
          { id: 'a', type: 'number', rule: 'gt', min: 1, shuffle: true, equation: 'x^2' },
          { id: 'b', type: 'number', rule: 'raro' },
          { id: 'c', type: 'rating', symbol: 'heart', lowLabel: 'Poco', highLabel: '  ' },
          { id: 'd', type: 'rating', symbol: 'cohete' },
          { id: 'e', type: 'file', maxFiles: 99, maxMb: 7, kinds: ['pdf', 'virus'] },
          { id: 'f', type: 'ranking', options: ['', 'x', 'x'] },
          { id: 'g', type: 'text', symbol: 'star', maxFiles: 3, rule: 'gt' },
        ],
      },
    };
    const [a, b, c, d, e, f, g] = parseProject(JSON.stringify(raw)).project.form.questions;
    expect(a).toMatchObject({ rule: 'gt', shuffle: true, equation: 'x^2' });
    expect(b!.rule).toBeUndefined();
    expect(c).toMatchObject({ symbol: 'heart', lowLabel: 'Poco' });
    expect(c!.highLabel).toBeUndefined();
    expect(d!.symbol).toBeUndefined();
    expect(e).toMatchObject({ maxFiles: 10, maxMb: 10, kinds: ['pdf'] });
    expect(f!.options).toEqual(['Elemento 1', 'x', 'x (2)']);
    expect([g!.symbol, g!.maxFiles, g!.rule]).toEqual([undefined, undefined, undefined]);
    // a new rating is drawn with stars; one written before, with numbers
    expect(newQuestion('rating').symbol).toBe('star');
  });
});
