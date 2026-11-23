import { describe, expect, it } from 'vitest';
import { compileQuery, counter, expandReplacement, findAll, findInText, foldAccents, indexOfSelection, nextIndex, parseCellRef, parseGoToNumber, replaceAllInText, type FindOptions } from './index';

const q = (text: string, o: Partial<FindOptions> = {}) => {
  const r = compileQuery(text, o);
  if (!r.ok) throw new Error(r.message);
  return r.query;
};
const found = (text: string, query: string, o: Partial<FindOptions> = {}) => findInText(q(query, o), text).map((m) => m.text);

describe('texto normal', () => {
  it('no distingue mayúsculas salvo que se pida, y busca todas las coincidencias', () => {
    expect(found('Casa casa CASA', 'casa')).toEqual(['Casa', 'casa', 'CASA']);
    expect(found('Casa casa CASA', 'casa', { matchCase: true })).toEqual(['casa']);
  });
  it('? y * son esos caracteres, y lo que parece de expresión regular es texto', () => {
    expect(found('a?b a.b a*b', 'a?b')).toEqual(['a?b']);
    expect(found('a.b axb', 'a.b')).toEqual(['a.b']);
    expect(found('(1+1)', '(1+1)')).toEqual(['(1+1)']);
  });
  it('palabra completa', () => {
    expect(found('casa casas encasa casa.', 'casa', { wholeWord: true })).toEqual(['casa', 'casa']);
    expect(found('canción cancion', 'cancion', { wholeWord: true })).toEqual(['cancion']);
  });
  it('ignorar acentos conserva las posiciones del texto original', () => {
    const ms = findInText(q('cancion', { ignoreAccents: true }), 'La Canción y la cancion');
    expect(ms.map((m) => [m.start, m.text])).toEqual([[3, 'Canción'], [16, 'cancion']]);
    expect(foldAccents('ñandú Ø')).toBe('nandu Ø');
    expect(found('él', 'el')).toEqual([]);
  });
  it('caracteres especiales de Word: ^p ^t ^# ^$ ^w ^s ^nnn ^^', () => {
    expect(found('uno\ndos', 'uno^pdos')).toEqual(['uno\ndos']);
    expect(found('a\tb', 'a^tb')).toEqual(['a\tb']);
    expect(found('v1 v22 vx', 'v^#')).toEqual(['v1', 'v2']);
    expect(found('a1 b2', '^$^#')).toEqual(['a1', 'b2']);
    expect(found('a  \t b', 'a^wb')).toEqual(['a  \t b']);
    expect(found('a\u00a0b', 'a^sb')).toEqual(['a\u00a0b']);
    expect(found('ab', '^97b')).toEqual(['ab']);
    expect(found('a^b', 'a^^b')).toEqual(['a^b']);
    expect(found('x^z', 'x^z')).toEqual(['x^z']);
  });
  it('el texto vacío no se busca, y todo el contenido de la celda', () => {
    expect(compileQuery('')).toMatchObject({ ok: false, error: 'empty' });
    expect(found('casa', 'casa', { wholeUnit: true })).toEqual(['casa']);
    expect(found('la casa', 'casa', { wholeUnit: true })).toEqual([]);
  });
});

describe('comodines de Word', () => {
  const w = (text: string, query: string, o: Partial<FindOptions> = {}) => found(text, query, { mode: 'wildcards', ...o });
  it('? un carácter y * lo mínimo posible', () => {
    expect(w('gato pato rato', '?ato')).toEqual(['gato', 'pato', 'rato']);
    expect(w('abcabc', 'a*c')).toEqual(['abc', 'abc']);
  });
  it('conjuntos, rangos y negación', () => {
    expect(w('bat cat hat', '[bc]at')).toEqual(['bat', 'cat']);
    expect(w('a1 a2 aX', 'a[0-9]')).toEqual(['a1', 'a2']);
    expect(w('bat cat hat', '[!bc]at')).toEqual(['hat']);
  });
  it('< y > son el principio y el final de una palabra', () => {
    expect(w('uno unos desuno', '<uno>')).toEqual(['uno']);
    expect(w('casa casita', '<ca*>')).toEqual(['casa', 'casita']);
  });
  it('{n,m} y @ repiten lo anterior', () => {
    expect(w('a aa aaa aaaa', '<a{2,3}>')).toEqual(['aa', 'aaa']);
    expect(w('12 3456', '[0-9]{4}')).toEqual(['3456']);
    expect(w('ab abb abbb', 'ab@')).toEqual(['ab', 'ab', 'ab']);
    expect(w('ab abb abbb', 'ab@>')).toEqual(['ab', 'abb', 'abbb']);
    expect(w('abbb', '(b)@')).toEqual(['bbb']);
    expect(w('a aa aaa', 'a{2;3}')).toEqual(['aa', 'aaa']);
    expect(w('a aa aaa', 'a{2;}')).toEqual(['aa', 'aaa']);
  });
  it('\\ toma el carácter siguiente tal cual, y lo que Word no tiene es texto', () => {
    expect(w('a*b a-b', 'a\\*b')).toEqual(['a*b']);
    expect(w('x+y', 'x+y')).toEqual(['x+y']);
    expect(w('p.q pxq', 'p.q')).toEqual(['p.q']);
  });
  it('grupos con \\1 al reemplazar (invertir nombre y apellido)', () => {
    const query = q('(<[A-Za-z]@>) (<[A-Za-z]@>)', { mode: 'wildcards' });
    expect(replaceAllInText(query, 'Ana Pérez', '\\2, \\1').text).toBe('Ana Pérez');
    const q2 = q('(<[A-Za-z]@>) (<[A-Za-z]@>)', { mode: 'wildcards' });
    expect(replaceAllInText(q2, 'Juan Lopez, Rosa Diaz', '\\2, \\1')).toEqual({ text: 'Lopez, Juan, Diaz, Rosa', count: 2 });
  });
  it('errores: paréntesis, corchete o repetición sin cerrar', () => {
    for (const bad of ['(a', 'a)', '[abc', 'a{x}']) expect(compileQuery(bad, { mode: 'wildcards' })).toMatchObject({ ok: false, error: 'invalid' });
  });
});

describe('comodines de Excel', () => {
  const e = (text: string, query: string, o: Partial<FindOptions> = {}) => found(text, query, { mode: 'excel', ...o });
  it('? y * y ~ para buscarlos', () => {
    expect(e('gato pato', '?ato')).toEqual(['gato', 'pato']);
    expect(e('a1b', 'a*b')).toEqual(['a1b']);
    expect(e('a*b axb', 'a~*b')).toEqual(['a*b']);
    expect(e('a?b axb', 'a~?b')).toEqual(['a?b']);
    expect(e('50%', '50%')).toEqual(['50%']);
  });
  it('celda entera con comodines', () => {
    expect(e('Madrid', 'Mad*', { wholeUnit: true })).toEqual(['Madrid']);
    expect(e('Gran Madrid', 'Mad*', { wholeUnit: true })).toEqual([]);
  });
});

describe('expresiones regulares', () => {
  it('JavaScript con $1, $& y \\n al reemplazar', () => {
    const query = q('(\\d+)-(\\d+)', { mode: 'regex' });
    expect(replaceAllInText(query, '10-20 y 3-4', '$2/$1')).toEqual({ text: '20/10 y 4/3', count: 2 });
    expect(replaceAllInText(q('a', { mode: 'regex' }), 'banana', '[$&]$$').text).toBe('b[a]$n[a]$n[a]$');
    expect(replaceAllInText(q(',', { mode: 'regex' }), 'a,b', '\\n').text).toBe('a\nb');
  });
  it('una expresión mala da error, y lo vacío no es coincidencia', () => {
    expect(compileQuery('(', { mode: 'regex' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(found('abc', 'x*', { mode: 'regex' })).toEqual([]);
  });
  it('mayúsculas y acentos también', () => {
    expect(found('ÁRBOL árbol', 'arbol', { mode: 'regex', ignoreAccents: true })).toEqual(['ÁRBOL', 'árbol']);
  });
});

describe('reemplazar', () => {
  it('^& es lo encontrado y ^p ^t son esos caracteres', () => {
    const query = q('casa');
    expect(replaceAllInText(query, 'Casa y casa', '^&s')).toEqual({ text: 'Casas y casas', count: 2 });
    expect(replaceAllInText(q(';'), 'a;b', '^p').text).toBe('a\nb');
    expect(replaceAllInText(q(' '), 'a b', '^t').text).toBe('a\tb');
    expect(replaceAllInText(q('x'), 'x', '^^').text).toBe('^');
    expect(replaceAllInText(q('x'), 'x', '^65').text).toBe('A');
  });
  it('en Excel el reemplazo es literal', () => {
    expect(replaceAllInText(q('a*', { mode: 'excel' }), 'abc', '^&$1').text).toBe('^&$1');
  });
  it('sin coincidencias no cambia nada, y expandReplacement da los grupos', () => {
    expect(replaceAllInText(q('zzz'), 'abc', 'x')).toEqual({ text: 'abc', count: 0 });
    const query = q('(a)(b)', { mode: 'wildcards' });
    const m = findInText(query, 'ab')[0]!;
    expect(m.groups).toEqual(['a', 'b']);
    expect(expandReplacement(query, m, '\\2\\1\\\\')).toBe('ba\\');
  });
});

describe('recorrido', () => {
  const units = [{ id: 'a', text: 'uno dos uno' }, { id: 'b', text: 'sin' }, { id: 'c', text: 'uno' }];
  const all = findAll(q('uno'), units);
  it('findAll da la unidad de cada coincidencia', () => {
    expect(all.map((m) => [m.unit, m.start])).toEqual([['a', 0], ['a', 8], ['c', 0]]);
  });
  it('siguiente y anterior, con vuelta al otro extremo', () => {
    expect(nextIndex(all, { index: 0, offset: 0 }, true)).toBe(0);
    expect(nextIndex(all, { index: 0, offset: 1 }, true)).toBe(1);
    expect(nextIndex(all, { index: 2, offset: 1 }, true)).toBe(0);
    expect(nextIndex(all, { index: 2, offset: 1 }, true, false)).toBe(-1);
    expect(nextIndex(all, { index: 2, offset: 3 }, false)).toBe(2);
    expect(nextIndex(all, { index: 0, offset: 0 }, false)).toBe(2);
    expect(nextIndex([], { index: 0, offset: 0 }, true)).toBe(-1);
  });
  it('la selección actual y el contador «3 de 12»', () => {
    expect(indexOfSelection(all, 0, 8, 11)).toBe(1);
    expect(indexOfSelection(all, 0, 8, 10)).toBe(-1);
    expect(counter(1, 3)).toEqual({ position: 2, total: 3 });
    expect(counter(-1, 3)).toEqual({ position: 0, total: 3 });
  });
});

describe('Ir a', () => {
  it('número absoluto y relativo', () => {
    expect(parseGoToNumber('5')).toEqual({ n: 5, relative: false });
    expect(parseGoToNumber('+3')).toEqual({ n: 3, relative: true });
    expect(parseGoToNumber(' - 2 ')).toEqual({ n: -2, relative: true });
    expect(parseGoToNumber('x')).toBeNull();
  });
  it('celda y rango de Excel', () => {
    expect(parseCellRef('B12')).toEqual({ row: 11, col: 1, row2: 11, col2: 1 });
    expect(parseCellRef('$A$1:C5')).toEqual({ row: 0, col: 0, row2: 4, col2: 2 });
    expect(parseCellRef('C5:A1')).toEqual({ row: 0, col: 0, row2: 4, col2: 2 });
    expect(parseCellRef('XFD1')).toEqual({ row: 0, col: 16383, row2: 0, col2: 16383 });
    expect(parseCellRef('XFE1')).toBeNull();
    expect(parseCellRef('A0')).toBeNull();
    expect(parseCellRef('hola')).toBeNull();
  });
});
