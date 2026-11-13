import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTOCORRECT, correctWord, smartQuote, startsSentence } from './autocorrect';

const o = DEFAULT_AUTOCORRECT;
const fix = (word: string, before = 'texto previo ', opts = o) => correctWord(word, before, opts);

describe('comillas tipográficas', () => {
  it('abren tras un espacio o al empezar, y cierran pegadas a una letra', () => {
    expect(smartQuote('"', '')).toBe('“');
    expect(smartQuote('"', 'dijo ')).toBe('“');
    expect(smartQuote('"', 'dijo “hola')).toBe('”');
    expect(smartQuote('"', '(')).toBe('“');
    expect(smartQuote("'", 'it')).toBe('’');
    expect(smartQuote("'", 'dijo ')).toBe('‘');
    expect(smartQuote('"', 'a—')).toBe('“');
  });
});

describe('inicio de oración', () => {
  it('al empezar el párrafo y tras . ! ? con espacio', () => {
    expect(startsSentence('')).toBe(true);
    expect(startsSentence('Hola. ')).toBe(true);
    expect(startsSentence('¿Qué? ')).toBe(true);
    expect(startsSentence('Hola ')).toBe(false);
    expect(startsSentence('Hola, ')).toBe(false);
    expect(startsSentence('Cuesta 3.')).toBe(false);
  });
  it('no tras abreviaturas ni iniciales', () => {
    expect(startsSentence('Vea el Sr. ')).toBe(false);
    expect(startsSentence('manzanas, peras, etc. ')).toBe(false);
    expect(startsSentence('de J. ')).toBe(false);
  });
});

describe('corrección de palabras', () => {
  it('símbolos, fracciones y rayas', () => {
    expect(fix('(c)')).toEqual({ text: '©' });
    expect(fix('(tm)')).toEqual({ text: '™' });
    expect(fix('...')).toEqual({ text: '…' });
    expect(fix('-->')).toEqual({ text: '→' });
    expect(fix('1/2')).toEqual({ text: '½' });
    expect(fix('3/4')).toEqual({ text: '¾' });
    expect(fix('--')).toEqual({ text: '–' });
    expect(fix('---')).toEqual({ text: '—' });
    expect(fix('(c)', '', { ...o, symbols: false })).toBeNull();
  });
  it('vínculos automáticos para direcciones web y de correo', () => {
    expect(fix('https://ejemplo.org/a?b=1')).toEqual({ text: 'https://ejemplo.org/a?b=1', href: 'https://ejemplo.org/a?b=1' });
    expect(fix('www.ejemplo.org')).toEqual({ text: 'www.ejemplo.org', href: 'http://www.ejemplo.org' });
    expect(fix('ana@correo.com')).toEqual({ text: 'ana@correo.com', href: 'mailto:ana@correo.com' });
    expect(fix('http://')).toBeNull();
  });
  it('mayúscula inicial al empezar oración, y no en medio', () => {
    expect(fix('hola', '')).toEqual({ text: 'Hola' });
    expect(fix('segunda', 'Primera. ')).toEqual({ text: 'Segunda' });
    expect(fix('palabra', 'una ')).toBeNull();
    expect(fix('etc', 'peras, ')).toBeNull();
    expect(fix('hola', '', { ...o, capitalizeSentences: false })).toBeNull();
    expect(fix('ñandú', '')).toEqual({ text: 'Ñandú' });
  });
  it('dos mayúsculas iniciales', () => {
    expect(fix('COrrecto')).toEqual({ text: 'Correcto' });
    expect(fix('PRimero', 'Hola. ')).toEqual({ text: 'Primero' });
    expect(fix('ID')).toBeNull();
    expect(fix('IDs')).toBeNull(); // 3 letras: no se toca
    expect(fix('NASA')).toBeNull();
    expect(fix('COrrecto', '', { ...o, fixTwoInitialCaps: false })).toBeNull();
  });
  it('no toca números, rutas ni mezclas', () => {
    expect(fix('3.5')).toBeNull();
    expect(fix('a/b', '')).toBeNull();
    expect(fix('v2beta', '')).toBeNull();
  });
  it('reemplazos propios de la tabla del usuario', () => {
    expect(fix('pq', 'dije ', { ...o, custom: { pq: 'porque' } })).toEqual({ text: 'porque' });
  });
});
