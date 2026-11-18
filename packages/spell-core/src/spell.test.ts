import { describe, expect, it } from 'vitest';
import { nodeEngine } from './dicts';
import { SPELL_LANGS, findWords, isSpellLang, langForTag, skipWord, spellLangTag, UserDictionary, type KeyValueStore } from './index';

const es = nodeEngine('es');
const mx = nodeEngine('es-MX');
const pe = nodeEngine('es-PE');
const en = nodeEngine('en');

describe('words', () => {
  it('finds words with apostrophes and splits hyphenated ones', () => {
    expect(findWords("don't re-hacer 12 año").map((w) => w.word)).toEqual(["don't", 're', 'hacer', 'año']);
  });
  it('skips acronyms, addresses and identifiers', () => {
    const skip = (text: string, word: string) => skipWord(text, findWords(text).find((x) => x.word === word)!);
    expect(skip('la ONU dijo', 'ONU')).toBe(true);
    expect(skip('escriba a juan@correo.com ya', 'correo')).toBe(true);
    expect(skip('abra www.ejemplo.org hoy', 'ejemplo')).toBe(true);
    expect(skip('variable_x1 y', 'variable')).toBe(true);
    expect(skip('una palabra', 'palabra')).toBe(false);
  });
});

describe('Spanish', () => {
  it('accepts correct words, accents, capitals and verb forms', () => {
    for (const w of ['casa', 'Casa', 'canción', 'cantábamos', 'ñandú', 'Madrid', 'españoles']) expect(es.isCorrect(w), w).toBe(true);
  });
  it('flags wrong words and suggests the right one', () => {
    expect(es.isCorrect('cassa')).toBe(false);
    expect(es.suggest('cassa')).toContain('casa');
    expect(es.suggest('cancion')).toContain('canción');
  });
  it('checks a plain text with positions', () => {
    const text = 'Esta es una cassa bonita. El perro ladra fuerrte.';
    const found = es.check(text);
    expect(found.map((w) => w.word)).toEqual(['cassa', 'fuerrte']);
    for (const w of found) expect(text.slice(w.start, w.end)).toBe(w.word);
  });
  it('ignoring or adding a word makes it right', () => {
    expect(es.isCorrect('Zorbaxilo')).toBe(false);
    es.ignore('zorbaxilo');
    expect(es.isCorrect('Zorbaxilo')).toBe(true);
  });
  it('the Latin American dictionaries accept words that the one from Spain does not', () => {
    for (const w of ['chévere', 'cholo']) {
      expect(es.isCorrect(w), `es ${w}`).toBe(false);
      expect(mx.isCorrect(w), `es-MX ${w}`).toBe(true);
      expect(pe.isCorrect(w), `es-PE ${w}`).toBe(true);
    }
    for (const e of [mx, pe]) {
      expect(e.isCorrect('casa')).toBe(true);
      expect(e.isCorrect('canción')).toBe(true);
      expect(e.isCorrect('cassa')).toBe(false);
      expect(e.suggest('cancion')).toContain('canción');
    }
  });
});

describe('English', () => {
  it('checks English words', () => {
    expect(en.isCorrect("don't")).toBe(true);
    expect(en.isCorrect('recieve')).toBe(false);
    expect(en.suggest('recieve')).toContain('receive');
  });
});

describe('languages', () => {
  it('has Spain, Mexico, Peru and English, with their BCP 47 tags', () => {
    expect(SPELL_LANGS.map((l) => [l.id, l.tag])).toEqual([['es', 'es-ES'], ['es-MX', 'es-MX'], ['es-PE', 'es-PE'], ['en', 'en-US']]);
    expect(isSpellLang('es-MX')).toBe(true);
    expect(isSpellLang('fr')).toBe(false);
    expect(spellLangTag('es-PE')).toBe('es-PE');
  });
  it('maps a language tag to the closest dictionary', () => {
    expect(langForTag('es-MX')).toBe('es-MX');
    expect(langForTag('es_PE')).toBe('es-PE');
    expect(langForTag('es-ES')).toBe('es');
    expect(langForTag('es-AR')).toBe('es');
    expect(langForTag('es')).toBe('es');
    expect(langForTag('en-GB')).toBe('en');
    expect(langForTag('fr-FR')).toBeNull();
    expect(langForTag(undefined)).toBeNull();
  });
});

describe('user dictionary', () => {
  const memory = (): KeyValueStore & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  };
  it('adds, finds and removes words, and is shared by whoever uses the same store', () => {
    const store = memory();
    const a = new UserDictionary(store);
    a.add('Zorbaxilo');
    a.add('zorbaxilo');
    expect(a.words()).toEqual(['Zorbaxilo']);
    expect(new UserDictionary(store).has('ZORBAXILO')).toBe(true);
    a.remove('Zorbaxilo');
    expect(new UserDictionary(store).words()).toEqual([]);
  });
  it('survives a missing or broken store', () => {
    expect(new UserDictionary(null).words()).toEqual([]);
    const bad = { getItem: () => '{no', setItem: () => { throw new Error('lleno'); } };
    const d = new UserDictionary(bad);
    expect(d.words()).toEqual([]);
    expect(() => d.add('x')).not.toThrow();
  });
});
