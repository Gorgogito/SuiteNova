import { writerSchema } from '@suitenova/writer-core';
import { describe, expect, it } from 'vitest';
import { newPage, newTextContainer, readableLangs, readableText, addContainer } from './index';

const para = (...runs: [string, string?][]) => writerSchema.nodes.paragraph!.create(null, runs.map(([t, lang]) => writerSchema.text(t, lang ? [writerSchema.marks.lang!.create({ value: lang })] : [])));
const doc = (...ps: ReturnType<typeof para>[]) => writerSchema.nodes.doc!.create(null, ps).toJSON();

describe('the languages of the text of a page (to read it aloud)', () => {
  it('gives the runs marked with a language, as offsets into the readable text, across paragraphs, boxes and the title', () => {
    let page = newPage('Título');
    page = addContainer(page, newTextContainer(10, 10, 300, doc(para(['Hola mundo. '], ['Hello world.', 'en']), para(['Otro párrafo ', 'es-MX'], ['y más.']))));
    page = addContainer(page, newTextContainer(10, 200, 300, doc(para(['Bonjour', 'fr']))));
    const text = readableText(page);
    const spans = readableLangs(page);
    expect(spans.map((s) => [text.slice(s.start, s.end), s.lang])).toEqual([['Hello world.', 'en'], ['Otro párrafo ', 'es-MX'], ['Bonjour', 'fr']]);
  });

  it('a page with no marks has none, and an empty box does not shift the others', () => {
    let page = newPage('');
    page = addContainer(page, newTextContainer(10, 10, 300, doc(para(['Sin marcas']))));
    expect(readableLangs(page)).toEqual([]);
    page = addContainer(page, newTextContainer(10, 100, 300, doc(para())));
    page = addContainer(page, newTextContainer(10, 200, 300, doc(para(['Texto', 'en']))));
    const text = readableText(page);
    const s = readableLangs(page);
    expect(s.map((x) => text.slice(x.start, x.end))).toEqual(['Texto']);
  });
});
