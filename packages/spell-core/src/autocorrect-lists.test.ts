import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTOCORRECT, exportReplacements, importReplacements, loadMathListFrom, saveMathListTo, autoCorrectTyped, correctWord, defaultExceptions, defaultReplacements, findMarkup, loadAutoCorrectFrom, ordinalOf, parseAutoCorrectStore, replacementFor, resolveAutoCorrect, ruleLineKind, saveAutoCorrectTo, startsSentence } from './autocorrect';
import { autoLangOf } from './autocorrect-data';

const es = { ...DEFAULT_AUTOCORRECT, custom: defaultReplacements('es') };
const en = { ...DEFAULT_AUTOCORRECT, lang: 'en' as const, exceptions: defaultExceptions('en'), custom: defaultReplacements('en') };
const type = (text: string, ch: string, opts = es) => {
  const r = autoCorrectTyped(text, text + ch, text.length + 1, opts);
  return r ? r.text : null;
};

describe('lista de reemplazos por idioma', () => {
  it('trae reemplazos de fábrica distintos en español y en inglés', () => {
    expect(correctWord('tambien', 'dijo ', es)?.text).toBe('también');
    expect(correctWord('tambien', 'dijo ', en)).toBeNull();
    expect(correctWord('teh', 'said ', en)?.text).toBe('the');
    expect(correctWord('teh', 'dijo ', es)).toBeNull();
  });
  it('respeta la mayúscula de lo escrito', () => {
    expect(correctWord('Teh', 'said ', en)?.text).toBe('The');
    expect(correctWord('TEH', 'said ', en)?.text).toBe('THE');
    expect(replacementFor({ hola: 'buenos días' }, 'Hola')).toBe('Buenos días');
    expect(replacementFor({ hola: 'buenos días' }, 'hOLA')).toBeUndefined();
    expect(replacementFor({ BSS: 'buenos' }, 'bss')).toBeUndefined();
    expect(replacementFor({ BSS: 'buenos' }, 'BSS')).toBe('buenos');
  });
  it('el idioma de autocorrección sale del de revisión', () => {
    expect(['es', 'es-MX', 'es-PE', 'es-AR', null, undefined].map(autoLangOf)).toEqual(['es', 'es', 'es', 'es', 'es', 'es']);
    expect(['en', 'en-US', 'EN-gb'].map(autoLangOf)).toEqual(['en', 'en', 'en']);
  });
  it('lo guardado es por idioma y no se pisa entre idiomas', () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    saveAutoCorrectTo(st, { ...es, custom: { bss: 'buenos días' } });
    saveAutoCorrectTo(st, { ...en, custom: { omw: 'on my way' }, smartQuotes: false });
    expect(loadAutoCorrectFrom(st, 'es').custom).toEqual({ bss: 'buenos días' });
    expect(loadAutoCorrectFrom(st, 'en').custom).toEqual({ omw: 'on my way' });
    // las casillas valen para todos los idiomas
    expect(loadAutoCorrectFrom(st, 'es').smartQuotes).toBe(false);
  });
  it('lee el formato anterior: la lista propia pasa a ser la del español, con la de fábrica', () => {
    const s = parseAutoCorrectStore(JSON.stringify({ smartQuotes: false, custom: { bss: 'buenos días' } }));
    expect(s.flags.smartQuotes).toBe(false);
    const o = resolveAutoCorrect(s, 'es');
    expect(o.custom.bss).toBe('buenos días');
    expect(o.custom.tambien).toBe('también');
    expect(resolveAutoCorrect(s, 'en').custom.teh).toBe('the');
    expect(parseAutoCorrectStore('{roto').flags.smartQuotes).toBe(true);
  });
});

describe('excepciones', () => {
  it('las abreviaturas de la lista no abren oración', () => {
    expect(startsSentence('Vea el Sr. ', ['sr'])).toBe(false);
    expect(startsSentence('Vea el Sr. ', [])).toBe(true);
    expect(correctWord('perez', 'Vea el Sr. ', es)).toBeNull();
    expect(correctWord('perez', 'Vea el Sr. ', { ...es, exceptions: { ...es.exceptions, firstLetter: [] } })?.text).toBe('Perez');
    expect(correctWord('smith', 'See Mr. ', en)).toBeNull();
  });
  it('las dos mayúsculas permitidas no se corrigen', () => {
    expect(correctWord('COrrecto', 'dijo ', es)?.text).toBe('Correcto');
    expect(correctWord('COrrecto', 'dijo ', { ...es, exceptions: { ...es.exceptions, twoInitialCaps: ['COrrecto'] } })).toBeNull();
  });
  it('las palabras de «otras correcciones» no se tocan por ninguna regla', () => {
    expect(correctWord('tambien', 'dijo ', { ...es, exceptions: { ...es.exceptions, other: ['Tambien'] } })).toBeNull();
    expect(correctWord('hola', 'Fin. ', { ...es, exceptions: { ...es.exceptions, other: ['hola'] } })).toBeNull();
  });
});

describe('ordinales, marcado y líneas de borde', () => {
  it('ordinales en español en texto plano y en inglés con superíndice', () => {
    expect(correctWord('1.o', 'el ', es)?.text).toBe('1.º');
    expect(correctWord('2.a', 'la ', es)?.text).toBe('2.ª');
    expect(correctWord('1st', 'the ', en)).toEqual({ text: '1st', sup: [1, 3] });
    expect(correctWord('22nd', 'the ', en)).toEqual({ text: '22nd', sup: [2, 4] });
    expect(ordinalOf('11th', 'en')?.sup).toEqual([2, 4]);
    expect(ordinalOf('2st', 'en')).toBeNull();
    expect(correctWord('1.o', 'el ', { ...es, ordinals: false })).toBeNull();
  });
  it('en un campo sin formato el ordinal inglés se deja como está y el español se corrige', () => {
    expect(type('the 1st', ' ', en)).toBeNull();
    expect(type('el 1.o', ' ', es)).toBe('el 1.º ');
  });
  it('*negrita* y _cursiva_ al cerrar el marcador', () => {
    expect(findMarkup('un *hola*')).toEqual({ kind: 'bold', open: 3, close: 8, inner: 'hola' });
    expect(findMarkup('_hola mundo_')).toEqual({ kind: 'italic', open: 0, close: 11, inner: 'hola mundo' });
    expect(findMarkup('(*a*')).toEqual({ kind: 'bold', open: 1, close: 3, inner: 'a' });
    expect(findMarkup('2 * 3 *')).toBeNull();
    expect(findMarkup('a*b*')).toBeNull();
    expect(findMarkup('un * hola*')).toBeNull();
    expect(findMarkup('**')).toBeNull();
    expect(findMarkup('sin cierre')).toBeNull();
  });
  it('líneas de borde', () => {
    expect(ruleLineKind('---')).toBe('thin');
    expect(ruleLineKind('___')).toBe('thick');
    expect(ruleLineKind('===')).toBe('double');
    expect(ruleLineKind('***')).toBe('dotted');
    expect(ruleLineKind('~~~~')).toBe('wavy');
    expect(ruleLineKind('###')).toBe('triple');
    expect(ruleLineKind('--')).toBeNull();
    expect(ruleLineKind('--- a')).toBeNull();
  });
});

describe('lista matemática e importar/exportar', () => {
  it('la lista matemática se guarda aparte y se puede volver a la de fábrica', () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(loadMathListFrom(st)).toBeNull();
    saveAutoCorrectTo(st, { ...es, custom: { bss: 'buenos' } });
    saveMathListTo(st, { alpha: 'α', mio: '★' });
    expect(loadMathListFrom(st)).toEqual({ alpha: 'α', mio: '★' });
    expect(loadAutoCorrectFrom(st, 'es').custom).toEqual({ bss: 'buenos' });
    saveMathListTo(st, null);
    expect(loadMathListFrom(st)).toBeNull();
  });
  it('exporta e importa sin perder comas, comillas ni saltos', () => {
    const list = { bss: 'buenos días, a todos', q: 'dijo "hola"', ml: 'a\nb', ab: 'x' };
    expect(importReplacements(exportReplacements(list))).toEqual(list);
  });
  it('importa tabulador, punto y coma, comentarios y BOM; descarta lo inválido', () => {
    const t = '﻿# mi lista\r\nbss\tbuenos días\r\nomw;on my way\r\n\r\nsolo\r\n"con espacio";x\r\nok,vale';
    expect(importReplacements(t)).toEqual({ bss: 'buenos días', omw: 'on my way', ok: 'vale' });
  });
});
