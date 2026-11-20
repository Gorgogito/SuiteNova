import { describe, expect, it } from 'vitest';
import { newDeck } from './defaults';
import { findAll, replaceAll } from './find';
import { docText, makeDoc } from './text';
import type { ShapeEl } from './types';

const deckWith = (paras: { text?: string; runs?: { text: string; r?: object }[] }[]) => {
  const d = newDeck();
  const t = d.slides[0]!.shapes.find((s) => s.kind === 'shape') as ShapeEl;
  t.text = { body: {}, doc: makeDoc(paras as never).toJSON() };
  return { d, t };
};

describe('find in the text of pictures', () => {
  it('finds a picture by its read text only when asked, one hit per picture, and replacing leaves it alone', () => {
    const d = newDeck();
    d.assets.a1 = { id: 'a1', mime: 'image/png', data: new Uint8Array(), ocr: { text: 'Factura número 4821\nTotal a pagar' } };
    const pic = { kind: 'pic', id: 'p1', name: 'x', descr: '', src: 'a1', xfrm: { x: 0, y: 0, w: 1, h: 1 } } as never;
    d.slides[0]!.shapes.push(pic);
    expect(findAll(d, 'total').length).toBe(0);
    const hits = findAll(d, 'TOTAL', { pictures: true });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ where: 'picture', elementId: 'p1', context: 'Total a pagar' });
    expect(replaceAll(d, 'total', 'X', { pictures: true }).count).toBe(0);
  });
});

describe('find and replace', () => {
  it('finds case-insensitively, whole words, and across runs', () => {
    const { d } = deckWith([{ runs: [{ text: 'Hola mun' }, { text: 'do', r: { b: true } }] }, { text: 'mundial y MUNDO' }]);
    expect(findAll(d, 'mundo').length).toBe(2);
    expect(findAll(d, 'mundo', { matchCase: true }).length).toBe(1);
    expect(findAll(d, 'mundo', { wholeWord: true }).length).toBe(2);
    expect(findAll(d, 'mund', { wholeWord: true }).length).toBe(0);
  });
  it('replaces keeping the formatting of the run where the match starts', () => {
    const { d, t } = deckWith([{ runs: [{ text: 'Hola mun', r: { i: true } }, { text: 'do', r: { b: true } }, { text: ' fin' }] }]);
    const r = replaceAll(d, 'mundo', 'planeta');
    expect(r.count).toBe(1);
    const el = r.deck.slides[0]!.shapes.find((s) => s.id === t.id) as ShapeEl;
    expect(docText(el.text!.doc)).toBe('Hola planeta fin');
    expect(JSON.stringify(el.text!.doc)).toContain('"i":true');
  });
  it('replaces one match at a time and counts them all', () => {
    const { d, t } = deckWith([{ text: 'a b a b a' }]);
    const one = replaceAll(d, 'a', 'X', {}, { slideId: d.slides[0]!.id, elementId: t.id });
    expect(one.count).toBe(1);
    expect(docText((one.deck.slides[0]!.shapes.find((s) => s.id === t.id) as ShapeEl).text!.doc)).toBe('X b a b a');
    expect(replaceAll(d, 'a', 'X').count).toBe(3);
    expect(replaceAll(d, 'zzz', 'X').count).toBe(0);
  });
});
