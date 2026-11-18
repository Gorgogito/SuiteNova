import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import nspell from 'nspell';
import { describe, expect, it } from 'vitest';
import { docOf, nodeTypes, writerSchema } from '@suitenova/writer-core';
import { DocSpellEngine } from './engine';

const dictDir = (name: string) => fileURLToPath(new URL(`../../node_modules/${name}/`, import.meta.url));
const make = (name: string) => {
  const d = dictDir(name);
  return new DocSpellEngine(nspell(fs.readFileSync(d + 'index.aff', 'utf8'), fs.readFileSync(d + 'index.dic', 'utf8')));
};
const es = make('dictionary-es');

const p = (...c: (string | ReturnType<typeof writerSchema.text>)[]) => nodeTypes.paragraph!.create(null, c.map((x) => (typeof x === 'string' ? writerSchema.text(x) : x)));

describe('Spanish in a ProseMirror document', () => {
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
