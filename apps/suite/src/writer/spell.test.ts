import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import nspell from 'nspell';
import { describe, expect, it } from 'vitest';
import { docOf, nodeTypes, writerSchema } from '@suitenova/writer-core';
import { SpellEngine, findWords, skipWord } from './spell-core';

const dictDir = (name: string) => fileURLToPath(new URL(`../../node_modules/${name}/`, import.meta.url));
const make = (name: string) => {
  const d = dictDir(name);
  return new SpellEngine(nspell(fs.readFileSync(d + 'index.aff', 'utf8'), fs.readFileSync(d + 'index.dic', 'utf8')));
};
const es = make('dictionary-es');
const en = make('dictionary-en');

const p = (...c: (string | ReturnType<typeof writerSchema.text>)[]) => nodeTypes.paragraph!.create(null, c.map((x) => (typeof x === 'string' ? writerSchema.text(x) : x)));

describe('words', () => {
  it('finds words with apostrophes and splits hyphenated ones', () => {
    expect(findWords("don't re-hacer 12 año").map((w) => w.word)).toEqual(["don't", 're', 'hacer', 'año']);
  });
  it('skips acronyms, addresses and identifiers', () => {
    const skip = (text: string, word: string) => {
      const w = findWords(text).find((x) => x.word === word)!;
      return skipWord(text, w);
    };
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
    expect(es.isCorrect('ortografia')).toBe(false);
  });
  it('lists the misspelled words of a document with their positions', () => {
    const doc = docOf([p('Esta es una cassa bonita.'), p('Otra frase sin errores.'), p('El perro ladra fuerrte.')]);
    const found = es.inDoc(doc);
    expect(found.map((m) => m.word)).toEqual(['cassa', 'fuerrte']);
    for (const m of found) expect(doc.textBetween(m.from, m.to)).toBe(m.word);
  });
  it('words split by a mark are still one word', () => {
    const bold = writerSchema.marks.strong!.create();
    const doc = docOf([p('una ca', writerSchema.text('ssa', [bold]), ' aquí')]);
    const found = es.inDoc(doc);
    expect(found.map((m) => m.word)).toEqual(['cassa']);
    expect(doc.textBetween(found[0]!.from, found[0]!.to)).toBe('cassa');
  });
  it('does not check text inside links', () => {
    const link = writerSchema.marks.link!.create({ href: 'https://x.org' });
    const doc = docOf([p('ver ', writerSchema.text('xyzzyq', [link]), ' ahora')]);
    expect(es.inDoc(doc)).toEqual([]);
  });
  it('ignoring or adding a word makes it right', () => {
    expect(es.isCorrect('Zorbaxilo')).toBe(false);
    es.ignore('zorbaxilo');
    expect(es.isCorrect('Zorbaxilo')).toBe(true);
  });
});

describe('English', () => {
  it('checks English words', () => {
    expect(en.isCorrect("don't")).toBe(true);
    expect(en.isCorrect('recieve')).toBe(false);
    expect(en.suggest('recieve')).toContain('receive');
  });
});
