import { describe, expect, it } from 'vitest';
import { checkSlidesAccessibility, compareDecks, importSlides, slideText } from './review';
import { newDeck } from './defaults';
import { newShape, newPicture, newTable } from './factory';
import { addSlide } from './ops';
import { docFromText } from './text';
import type { Deck, ShapeEl } from './types';

const withTitle = (d: Deck, i: number, title: string): Deck => {
  const s = d.slides[i]!;
  const t = s.shapes.find((e) => e.kind === 'shape' && (e.ph?.type === 'title' || e.ph?.type === 'ctrTitle')) as ShapeEl;
  t.text = { ...t.text!, doc: docFromText(title) as never };
  return d;
};
const deckOf = (...titles: string[]): Deck => {
  let d = newDeck();
  for (let i = 1; i < titles.length; i++) d = addSlide(d, d.layouts[1]?.id ?? d.layouts[0]!.id, i - 1).deck;
  titles.forEach((t, i) => withTitle(d, i, t));
  return d;
};

describe('accessibility', () => {
  it('finds a slide without title, a picture without description, a table without header and tiny text', () => {
    const d = deckOf('Uno');
    d.props.title = 'Mi presentación';
    const s = d.slides[0]!;
    s.shapes.push(newPicture('x', 10, 10, 100, 80, ''));
    const tb = { ...newTable(2, 2, 10, 200, 300), firstRow: false };
    s.shapes.push(tb);
    const small = newShape('rect', 10, 300, 100, 40) as ShapeEl;
    small.text = { body: {}, doc: { type: 'doc', content: [{ type: 'paragraph', attrs: { lvl: 0, p: {}, end: {} }, content: [{ type: 'text', text: 'chico', marks: [{ type: 'run', attrs: { r: { sz: 9 } } }] }] }] } as never };
    s.shapes.push(small);
    const kinds = checkSlidesAccessibility(d).map((i) => i.kind);
    expect(kinds).toContain('imageAlt');
    expect(kinds).toContain('tableHeader');
    expect(kinds).toContain('smallText');
    expect(kinds).not.toContain('noTitle');
    const noTitle = checkSlidesAccessibility(addSlide(d, d.layouts.find((l) => l.type === 'blank')!.id, 0).deck).map((i) => i.kind);
    expect(noTitle).toContain('noTitle');
  });
  it('a picture with a description passes and an empty document title is a tip', () => {
    const d = deckOf('Uno');
    d.slides[0]!.shapes.push({ ...newPicture('x', 0, 0, 10, 10, 'Un gato'), descr: 'Un gato' });
    const issues = checkSlidesAccessibility(d);
    expect(issues.some((i) => i.kind === 'imageAlt')).toBe(false);
    expect(issues.find((i) => i.kind === 'noDocTitle')?.slideId).toBeNull();
  });
  it('same title twice, and low contrast text', () => {
    const d = deckOf('Igual', 'Igual');
    const t = d.slides[0]!.shapes.find((e) => e.kind === 'shape' && e.ph) as ShapeEl;
    t.text = { body: {}, doc: { type: 'doc', content: [{ type: 'paragraph', attrs: { lvl: 0, p: {}, end: {} }, content: [{ type: 'text', text: 'Igual', marks: [{ type: 'run', attrs: { r: { color: { rgb: '#f8f8f8' } } } }] }] }] } as never };
    const kinds = checkSlidesAccessibility(d).map((i) => i.kind);
    expect(kinds).toContain('dupTitle');
    expect(kinds).toContain('contrast');
  });
});

describe('compare decks', () => {
  it('same deck: all same', () => {
    expect(compareDecks(deckOf('A', 'B'), deckOf('A', 'B')).every((x) => x.kind === 'same')).toBe(true);
  });
  it('finds added, removed and changed slides', () => {
    const r = compareDecks(deckOf('Introducción al proyecto', 'Presupuesto 2025', 'Cierre'), deckOf('Introducción al proyecto', 'Presupuesto 2026 revisado', 'Cierre', 'Anexo'));
    expect(r.map((x) => x.kind)).toEqual(['same', 'changed', 'same', 'added']);
    const none = compareDecks(deckOf('A', 'B'), deckOf('A'));
    expect(none.map((x) => x.kind)).toEqual(['same', 'removed']);
  });
  it('a slide text lists title first', () => {
    expect(slideText(deckOf('Hola').slides[0]!).startsWith('Hola')).toBe(true);
  });
});

describe('reuse slides', () => {
  it('copies slides with the destination layouts and new picture names', () => {
    const src = deckOf('Uno', 'Dos');
    src.assets['a_old'] = { id: 'a_old', mime: 'image/png', data: new Uint8Array([1, 2, 3]), name: 'f.png' };
    src.slides[1]!.shapes.push(newPicture('a_old', 0, 0, 10, 10, 'foto'));
    const dest = deckOf('Destino');
    const r = importSlides(dest, src, [1], 0);
    expect(r.deck.slides).toHaveLength(2);
    expect(r.deck.slides[1]!.id).toBe(r.ids[0]);
    expect(dest.layouts.some((l) => l.id === r.deck.slides[1]!.layoutId)).toBe(true);
    const pic = r.deck.slides[1]!.shapes.find((e) => e.kind === 'pic')!;
    expect(pic.kind === 'pic' && pic.src).not.toBe('a_old');
    expect(pic.kind === 'pic' && r.deck.assets[pic.src]?.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(src.slides).toHaveLength(2);
  });
});
