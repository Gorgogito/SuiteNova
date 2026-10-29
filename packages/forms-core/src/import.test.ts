import { describe, expect, it } from 'vitest';
import { formFromSheet, parseGoogleForm, validateAll } from './index';

/**
 * The structure below follows what the open source library "gforms" reads from FB_PUBLIC_LOAD_DATA_. It is written by
 * hand: no real Google page was available, so these tests prove our reading of that structure, not Google's output.
 */
const opt = (v: string, other = false, jump: unknown = null) => [v, null, jump, null, other ? 1 : 0];
const entry = (id: number, req: number, options: unknown[] | null, extra: unknown[] = []) => [id, options, req, ...extra];
const elem = (id: number, name: string, desc: string | null, type: number, entries: unknown[] | null) => [id, name, desc, type, entries];

const FORM = [
  'Descripción del formulario',
  [
    elem(1, 'Nombre', 'Escribe tu nombre', 0, [entry(11, 1, null)]),
    elem(2, 'Comentarios', null, 1, [entry(12, 0, null)]),
    elem(3, 'Color favorito', null, 2, [entry(13, 1, [opt('Rojo'), opt('Azul'), opt('', true)])]),
    elem(4, 'País', null, 3, [entry(14, 0, [opt('España'), opt('Chile')])]),
    elem(5, 'Aficiones', null, 4, [entry(15, 0, [opt('Cine'), opt('Libros'), opt('Deporte')])]),
    elem(6, 'Satisfacción', null, 5, [[16, [['1'], ['2'], ['3'], ['4'], ['5']], 1, ['Mala', 'Excelente']]]),
    elem(7, 'Recomendarías', null, 5, [[17, Array.from({ length: 11 }, (_, i) => [String(i)]), 0, ['', '']]]),
    elem(8, 'Sección 2', 'Más datos', 8, null),
    elem(9, 'Mensaje', 'Solo texto', 6, null),
    elem(10, 'Valoración', null, 7, [
      [18, [['Mal'], ['Bien']], 1, ['Servicio']],
      [19, [['Mal'], ['Bien']], 1, ['Precio']],
    ]),
    elem(11, 'Fecha de nacimiento', null, 9, [entry(20, 0, null)]),
    elem(12, 'Foto', null, 13, [entry(21, 0, null)]),
    elem(13, 'Hora', null, 10, [entry(22, 0, null)]),
  ],
  null,
  null,
  null,
  null,
  null,
  null,
  'Encuesta de prueba',
];
const DOC = [null, FORM, null, 'nombre-archivo'];
const page = (json: unknown) => `<html><head><script>var other = [1,2];</script><script nonce="x">var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify(json)} ;</script></head><body>texto ] [ "</body></html>`;

describe('Google Forms page', () => {
  const r = parseGoogleForm(page(DOC));
  const byTitle = (t: string) => r.form.questions.find((q) => q.title === t)!;

  it('reads the title, description and each question type', () => {
    expect(r.form.title).toBe('Encuesta de prueba');
    expect(r.form.description).toBe('Descripción del formulario');
    expect(byTitle('Nombre')).toMatchObject({ type: 'text', required: true, description: 'Escribe tu nombre' });
    expect(byTitle('Comentarios').type).toBe('longtext');
    expect(byTitle('Color favorito')).toMatchObject({ type: 'choice', options: ['Rojo', 'Azul'], allowOther: true, required: true });
    expect(byTitle('País')).toMatchObject({ type: 'dropdown', options: ['España', 'Chile'] });
    expect(byTitle('Aficiones')).toMatchObject({ type: 'multi', options: ['Cine', 'Libros', 'Deporte'] });
    expect(byTitle('Satisfacción')).toMatchObject({ type: 'rating', max: 5 });
    expect(byTitle('Satisfacción').description).toContain('Mala');
    expect(byTitle('Recomendarías').type).toBe('nps');
    expect(byTitle('Valoración')).toMatchObject({ type: 'likert', options: ['Mal', 'Bien'], rows: ['Servicio', 'Precio'] });
    expect(byTitle('Fecha de nacimiento').type).toBe('date');
    expect(byTitle('Hora').type).toBe('text');
  });
  it('turns sections and descriptive text into titles and drops what has no equivalent, telling the user', () => {
    expect(byTitle('Sección 2').type).toBe('title');
    expect(byTitle('Mensaje').type).toBe('title');
    expect(r.form.questions.some((q) => q.title === 'Foto')).toBe(false);
    const w = r.warnings.join('\n');
    expect(w).toMatch(/subir archivos/);
    expect(w).toMatch(/hora/);
  });
  it('produces a form that fills in and validates', () => {
    const a = { [byTitle('Nombre').id]: 'Ana', [byTitle('Color favorito').id]: 'Azul', [byTitle('Satisfacción').id]: 4, [byTitle('Valoración').id]: { Servicio: 'Bien', Precio: 'Mal' } };
    expect(validateAll(r.form, a)).toEqual({});
    expect(Object.keys(validateAll(r.form, {}))).toContain(byTitle('Nombre').id);
  });
  it('accepts the bare array and \\x escapes, and refuses other files', () => {
    expect(parseGoogleForm(JSON.stringify(DOC)).form.questions.length).toBeGreaterThan(5);
    expect(parseGoogleForm(page(DOC).replace('Rojo', 'R\\x6fjo')).form.questions[2]!.options[0]).toBe('Rojo');
    expect(() => parseGoogleForm('<html>hola</html>')).toThrow(/No se encontró/);
    expect(() => parseGoogleForm(page([null, null]))).toThrow(/estructura/);
    expect(() => parseGoogleForm(page([null, [null, []], null, 'x']))).toThrow(/no tiene preguntas/);
  });
  it('warns about validation rules, jumps and a scale that is not 1..N', () => {
    const f = [
      'd',
      [
        elem(1, 'Edad', null, 0, [[11, null, 0, null, [[1, 1, ['0', '120'], 'x']]]]),
        elem(2, 'Sí o no', null, 2, [entry(12, 0, [opt('Sí', false, [3]), opt('No', false, [4])])]),
        elem(3, 'Escala', null, 5, [[13, [['2'], ['3'], ['4']], 0, ['', '']]]),
      ],
      null, null, null, null, null, null, 'T',
    ];
    const w = parseGoogleForm(page([null, f, null, 'n'])).warnings.join('\n');
    expect(w).toMatch(/validación/);
    expect(w).toMatch(/salto/);
    expect(w).toMatch(/escala/i);
  });
});

describe('response spreadsheet from Microsoft Forms', () => {
  const rows = [
    ['Id', 'Hora de inicio', 'Hora de finalización', 'Correo electrónico', 'Nombre', 'Hora de la última modificación', '¿Cómo te llamas?', 'Satisfacción', 'Intereses', 'Fecha', 'Edad', 'Contacto', 'Puntos totales', 'Puntos: Satisfacción'],
    ['1', '01/03/2025 10:00', '01/03/2025 10:05', 'a@x.es', 'Ana', '', 'Ana', '5', 'Cine;Libros;', '20/02/1990', '30', 'ana@ejemplo.es', '1', '1'],
    ['2', '02/03/2025 11:00', '02/03/2025 11:03', 'b@x.es', 'Beto', '', 'Beto', '4', 'Cine;', '15/05/1985', '41.5', 'beto@ejemplo.es', '0', '0'],
    ['3', '03/03/2025 12:00', '03/03/2025 12:02', 'c@x.es', 'Cris', '', 'Cris', '5', 'Libros;Deporte;', '01/01/2000', '22', 'cris@ejemplo.es', '1', '1'],
    ['4', '04/03/2025 12:00', '04/03/2025 12:02', 'd@x.es', 'Dani', '', 'Dani', '3', 'Cine;Deporte;', '', '', 'dani@ejemplo.es', '0', '0'],
  ];
  const r = formFromSheet(rows, 'Encuesta MS');

  it('drops the metadata columns and guesses the types', () => {
    expect(r.form.questions.map((q) => [q.title, q.type])).toEqual([
      ["¿Cómo te llamas?", "text"],
      ["Satisfacción", "rating"],
      ["Intereses", "multi"],
      ["Fecha", "date"],
      ["Edad", "number"],
      ["Contacto", "text"],
    ]);
  });
  it('imports the responses with their date and no identity', () => {
    expect(r.responses).toHaveLength(4);
    const sat = r.form.questions[1]!.id;
    const hobby = r.form.questions[2]!.id;
    expect(r.responses.map((x) => x.answers[sat])).toEqual([5, 4, 5, 3]);
    expect(r.responses[0]!.answers[hobby]).toEqual(['Cine', 'Libros']);
    expect(r.responses[0]!.at).toBe('2025-03-01T10:05:00.000Z');
    expect(r.responses[0]!.id).toBe('ms-1');
    expect(JSON.stringify(r)).not.toMatch(/a@x\.es|Puntos/);
    expect(r.responses[0]!.answers[r.form.questions[3]!.id]).toBe('1990-02-20');
    expect(r.form.questions[5]!.format).toBe('email');
    expect(r.warnings.join('\n')).toMatch(/Microsoft Forms/);
  });
  it('is stable: the same answers give the same summary shape', () => {
    expect(r.form.title).toBe('Encuesta MS');
    expect(r.form.questions.every((q) => validateAll(r.form, {})[q.id] === undefined)).toBe(true);
  });
  it('refuses a table without headers', () => {
    expect(() => formFromSheet([[]], 'x')).toThrow(/encabezados/);
    expect(() => formFromSheet([['Id', 'Start time', 'Completion time']], 'x')).toThrow(/preguntas/);
  });
});

describe('response spreadsheet from Google Forms', () => {
  const rows = [
    ['Marca temporal', 'Dirección de correo electrónico', 'Color', 'Aficiones', 'Servicio [Rapidez]', 'Servicio [Trato]', 'Comentario'],
    ['2025/03/01 10:00:00', 'a@x.es', 'Rojo', 'Cine, Libros', 'Bien', 'Mal', 'Todo bien'],
    ['2025/03/02 10:00:00', 'b@x.es', 'Azul', 'Cine', 'Bien', 'Bien', 'Regular, pero bien'],
    ['2025/03/13 10:00:00', 'c@x.es', 'Rojo', 'Libros, Deporte', 'Mal', 'Bien', ''],
    ['2025/03/14 10:00:00', 'd@x.es', 'Rojo', 'Cine, Deporte', 'Bien', 'Bien', 'Ok'],
  ];
  const r = formFromSheet(rows, 'Encuesta G');
  it('groups grid columns and separates multiple answers', () => {
    expect(r.form.questions.map((q) => [q.title, q.type])).toEqual([
      ['Color', 'choice'],
      ['Aficiones', 'multi'],
      ['Servicio', 'likert'],
      ['Comentario', 'text'],
    ]);
    expect(r.form.questions[2]).toMatchObject({ rows: ['Rapidez', 'Trato'], options: ['Bien', 'Mal'] });
    expect(r.responses[0]!.answers[r.form.questions[1]!.id]).toEqual(['Cine', 'Libros']);
    expect(r.responses[0]!.answers[r.form.questions[2]!.id]).toEqual({ Rapidez: 'Bien', Trato: 'Mal' });
    expect(r.responses[2]!.at).toBe('2025-03-13T10:00:00.000Z');
    expect(r.responses).toHaveLength(4);
  });
  it('reads a plain table with no known source', () => {
    const t = formFromSheet([['Pregunta'], ['hola'], ['adiós']], 'tabla');
    expect(t.form.questions[0]!.type).toBe('text');
    expect(t.responses).toHaveLength(2);
  });
});
