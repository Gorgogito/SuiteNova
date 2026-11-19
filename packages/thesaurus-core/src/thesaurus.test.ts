import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { lemmaCandidates, matchCase, Thesaurus, thesaurusLangFor } from './index';

const load = (f: string, lang: 'es' | 'en') => new Thesaurus(fs.readFileSync(fileURLToPath(new URL(`../data/${f}`, import.meta.url)), 'utf8'), lang);
let es: Thesaurus;
let en: Thesaurus;
beforeAll(() => {
  es = load('th-es.txt', 'es');
  en = load('th-en.txt', 'en');
});

describe('thesaurus-core', () => {
  it('los tres españoles usan el mismo tesauro', () => {
    expect(['es', 'es-MX', 'es-PE'].map((l) => thesaurusLangFor(l as 'es'))).toEqual(['es', 'es', 'es']);
    expect(thesaurusLangFor('en')).toBe('en');
  });

  it('carga ordenado y con miles de entradas', () => {
    expect(es.size).toBeGreaterThan(20000);
    expect(en.size).toBeGreaterThan(100000);
  });

  it('español: entrada directa con sinónimos', () => {
    const r = es.lookup('feliz')!;
    expect(r.lemma).toBe(false);
    expect(r.senses.flatMap((s) => s.synonyms)).toContain('contento');
  });

  it('inglés: significados por categoría, parecidos y antónimos separados', () => {
    const r = en.lookup('happy')!;
    expect(r.senses.length).toBeGreaterThan(1);
    expect(r.senses[0]!.pos).toBe('adj');
    expect(r.senses.flatMap((s) => s.related)).toContain('joyful');
    expect(r.senses.flatMap((s) => s.antonyms)).toContain('unhappy');
    expect(r.senses.flatMap((s) => s.synonyms)).toContain('glad');
  });

  it('palabras flexionadas: plural, femenino e infinitivo en español', () => {
    expect(es.lookup('casas')?.entry).toBe('casa');
    expect(es.lookup('felices')?.entry).toBe('feliz');
    expect(es.lookup('contentas')?.entry).toBe('contento');
    expect(es.lookup('corriendo')?.entry).toBe('correr');
    expect(es.lookup('hablábamos')?.entry).toBe('hablar');
    expect(es.lookup('casas')?.lemma).toBe(true);
  });

  it('palabras flexionadas en inglés', () => {
    expect(en.lookup('walked')?.entry).toBe('walk');
    expect(en.lookup('happier')?.entry).toBe('happy');
    expect(en.lookup('cities')?.entry).toBe('city');
    expect(en.lookup('was')?.entry).toBe('be');
  });

  it('mayúsculas del original en los sinónimos', () => {
    expect(matchCase('Casa', 'vivienda')).toBe('Vivienda');
    expect(matchCase('CASA', 'vivienda')).toBe('VIVIENDA');
    expect(matchCase('casa', 'vivienda')).toBe('vivienda');
    expect(matchCase('iPhone', 'telefono')).toBe('telefono');
    const s = es.synonymsFor('Feliz')!;
    expect(s.senses.flatMap((x) => x.synonyms).every((w) => w[0] === w[0]!.toUpperCase())).toBe(true);
  });

  it('expresiones de varias palabras y palabras que no existen', () => {
    expect(es.lookup('a la vez')?.senses.length).toBeGreaterThan(0);
    expect(es.lookup('xqzvbn')).toBeNull();
    expect(en.lookup('')).toBeNull();
    expect(es.has('  casa  ')).toBe(true);
  });

  it('las formas candidatas no repiten ni incluyen la palabra', () => {
    for (const w of ['casas', 'corriendo', 'felices']) {
      const c = lemmaCandidates(w, 'es');
      expect(new Set(c).size).toBe(c.length);
      expect(c).not.toContain(w);
    }
  });

  it('cada significado tiene alguna palabra y los antónimos no se cuelan entre los sinónimos', () => {
    for (const w of ['bueno', 'rápido', 'grande']) {
      for (const s of es.lookup(w)?.senses ?? []) expect(s.synonyms.length + s.related.length + s.antonyms.length).toBeGreaterThan(0);
    }
    expect(en.lookup('good')!.senses.flatMap((s) => s.synonyms)).not.toContain('bad');
  });
});
