import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTOCORRECT, autoCorrectTyped, defaultReplacements, loadAutoCorrectFrom, saveAutoCorrectTo, AUTOCORRECT_KEY } from './autocorrect';

const o = DEFAULT_AUTOCORRECT;
/** Escribe `ch` al final de `text` y devuelve lo que queda. */
const type = (text: string, ch: string, opts = o) => {
  const r = autoCorrectTyped(text, text + ch, text.length + 1, opts);
  return r ? r.text : null;
};

describe('autocorrección de campos de texto sin formato', () => {
  it('corrige la palabra anterior al completarla', () => {
    expect(type('Hola. mañana', ' ')).toBe('Hola. Mañana ');
    expect(type('COrrecto', ' ')).toBe('Correcto ');
    expect(type('', ' ')).toBeNull();
  });
  it('comillas tipográficas, símbolos al instante y fracciones', () => {
    expect(type('dijo ', '"')).toBe('dijo “');
    expect(type('dijo “hola', '"')).toBe('dijo “hola”');
    expect(type('Marca(c', ')')).toBe('Marca©');
    expect(type('espera..', '.')).toBe('espera…');
    expect(type('flecha --', '>')).toBe('flecha →');
    expect(type('mide 1/2', ' ')).toBe('mide ½ ');
  });
  it('reemplazos propios', () => {
    expect(type('hola', ' ', { ...o, custom: { hola: 'buenos días' } })).toBe('buenos días ');
  });
  it('el cursor queda después de lo escrito, también en medio del texto', () => {
    const prev = 'uno dos tres';
    const caret = 'uno dos'.length;
    const next = prev.slice(0, caret) + ' ' + prev.slice(caret);
    const r = autoCorrectTyped(prev, next, caret + 1, { ...o, custom: { dos: '2' } })!;
    expect(r.text).toBe('uno 2  tres');
    expect(r.caret).toBe('uno 2 '.length);
  });
  it('no toca lo que no es una inserción de un carácter ni las direcciones, números o marcadores de lista', () => {
    expect(autoCorrectTyped('abc', 'abcde', 5, o)).toBeNull();
    expect(autoCorrectTyped('abc', 'ab', 2, o)).toBeNull();
    expect(type('visita www.sitio.com', ' ')).toBeNull();
    expect(type('3.5', ' ')).toBeNull();
    expect(type('a', '.')).toBeNull();
    expect(type('Texto', ' ', { ...o, capitalizeSentences: false, smartQuotes: false, symbols: false })).toBeNull();
  });
  it('mayúscula tras un salto de línea', () => {
    expect(type('uno.\ndos', ' ')).toBe('uno.\nDos ');
  });
  it('las opciones se guardan y se leen, y lo dañado vuelve a los valores por omisión', () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    saveAutoCorrectTo(s, { ...o, smartQuotes: false, custom: { a: 'b' } });
    expect(loadAutoCorrectFrom(s)).toMatchObject({ smartQuotes: false, custom: { a: 'b' } });
    m.set(AUTOCORRECT_KEY, '{roto');
    expect(loadAutoCorrectFrom(s)).toEqual({ ...o, custom: defaultReplacements('es') });
    expect(loadAutoCorrectFrom(null)).toEqual({ ...o, custom: defaultReplacements('es') });
  });
});
