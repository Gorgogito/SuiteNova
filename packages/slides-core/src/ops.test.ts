import { describe, expect, it } from 'vitest';
import { newDeck, newId } from './defaults';
import { addElements, addSlide, alignElements, deleteSlides, distributeElements, duplicateSlides, findElement, groupElements, moveSlides, reorderElements, resizeSlide, setLayout, ungroupElements, type Resolver } from './ops';
import { docNode, makeDoc } from './text';
import type { Deck, ShapeEl, SlideElement } from './types';

const box = (x: number, y: number, w: number, h: number, extra: Partial<ShapeEl> = {}): ShapeEl => ({ kind: 'shape', id: newId(), geom: { prst: 'rect' }, xfrm: { x, y, w, h }, ...extra });
const resolve: Resolver = (e) => (e as ShapeEl).xfrm!;
function deckWith(...els: SlideElement[]): { deck: Deck; sid: string } {
  const d = newDeck();
  const sid = d.slides[0]!.id;
  d.slides[0]!.shapes = els;
  return { deck: d, sid };
}
const x = (d: Deck, id: string) => (findElement(d.slides[0]!.shapes, id)!.el as ShapeEl).xfrm!;

describe('slide operations', () => {
  it('aligns several objects to their common box and a single one to the slide', () => {
    const a = box(100, 50, 100, 40);
    const b = box(300, 200, 50, 80);
    const { deck, sid } = deckWith(a, b);
    const left = alignElements(deck, sid, [a.id, b.id], 'left', resolve);
    expect(x(left, a.id).x).toBe(100);
    expect(x(left, b.id).x).toBe(100);
    const right = alignElements(deck, sid, [a.id, b.id], 'right', resolve);
    expect(x(right, a.id).x + 100).toBe(350);
    expect(x(right, b.id).x + 50).toBe(350);
    const one = alignElements(deck, sid, [a.id], 'center', resolve);
    expect(x(one, a.id).x).toBe((960 - 100) / 2);
    const mid = alignElements(deck, sid, [a.id], 'middle', resolve);
    expect(x(mid, a.id).y).toBe((540 - 40) / 2);
  });
  it('distributes objects with equal gaps', () => {
    const a = box(0, 0, 100, 10);
    const b = box(130, 0, 100, 10);
    const c = box(500, 0, 100, 10);
    const { deck, sid } = deckWith(a, b, c);
    const d = distributeElements(deck, sid, [a.id, b.id, c.id], 'h', resolve);
    expect(x(d, a.id).x).toBe(0);
    expect(x(d, c.id).x).toBe(500);
    expect(x(d, b.id).x).toBe(250);
  });
  it('groups and ungroups keeping the positions', () => {
    const a = box(100, 100, 100, 50);
    const b = box(300, 200, 100, 50);
    const { deck, sid } = deckWith(a, b);
    const g = groupElements(deck, sid, [a.id, b.id], resolve);
    expect(g.id).toBeTruthy();
    expect(g.deck.slides[0]!.shapes).toHaveLength(1);
    const grp = g.deck.slides[0]!.shapes[0]!;
    expect(grp.kind).toBe('group');
    expect((grp as { xfrm: { x: number; w: number } }).xfrm).toMatchObject({ x: 100, w: 300 });
    const u = ungroupElements(g.deck, sid, [g.id!]);
    expect(u.deck.slides[0]!.shapes).toHaveLength(2);
    expect(x(u.deck, a.id).x).toBe(100);
    expect(x(u.deck, b.id).y).toBe(200);
  });
  it('reorders objects', () => {
    const a = box(0, 0, 10, 10);
    const b = box(0, 0, 10, 10);
    const c = box(0, 0, 10, 10);
    const { deck, sid } = deckWith(a, b, c);
    const ids = (d: Deck) => d.slides[0]!.shapes.map((s) => s.id);
    expect(ids(reorderElements(deck, sid, [a.id], 'front'))).toEqual([b.id, c.id, a.id]);
    expect(ids(reorderElements(deck, sid, [c.id], 'back'))).toEqual([c.id, a.id, b.id]);
    expect(ids(reorderElements(deck, sid, [a.id], 'forward'))).toEqual([b.id, a.id, c.id]);
    expect(ids(reorderElements(deck, sid, [c.id], 'backward'))).toEqual([a.id, c.id, b.id]);
  });
  it('adds, duplicates, moves and deletes slides, keeping the sections', () => {
    let d = newDeck();
    d.sections = [{ id: 's1', name: 'A', slideIds: [d.slides[0]!.id] }];
    d = addSlide(d, d.layouts[1]!.id, 0).deck;
    d = addSlide(d, d.layouts[1]!.id, 1).deck;
    expect(d.slides).toHaveLength(3);
    expect(d.sections[0]!.slideIds).toHaveLength(3);
    const [s1, s2] = [d.slides[0]!.id, d.slides[1]!.id];
    d = moveSlides(d, [s1], 2);
    expect(d.slides.map((s) => s.id)[2]).toBe(s1);
    const dup = duplicateSlides(d, [s2]);
    expect(dup.deck.slides).toHaveLength(4);
    expect(dup.deck.sections[0]!.slideIds).toHaveLength(4);
    const del = deleteSlides(dup.deck, [s2]);
    expect(del.slides).toHaveLength(3);
    expect(deleteSlides(del, del.slides.map((s) => s.id)).slides).toHaveLength(3); // the last slide cannot be deleted
  });
  it('changing the layout keeps the text of the placeholders that stay', () => {
    let d = newDeck();
    const sid = d.slides[0]!.id;
    const title = d.slides[0]!.shapes[0] as ShapeEl;
    title.text = { body: {}, doc: makeDoc([{ text: 'Mi título' }]).toJSON() };
    d = setLayout(d, sid, d.layouts.find((l) => l.type === 'titleOnly')!.id);
    const texts = d.slides[0]!.shapes.filter((s): s is ShapeEl => s.kind === 'shape').map((s) => docNode(s.text?.doc).textContent);
    expect(texts).toContain('Mi título');
    expect(d.slides[0]!.shapes.length).toBe(1);
  });
  it('scales the text size when the slide size changes', () => {
    const t = box(100, 100, 400, 100, { text: { body: {}, doc: makeDoc([{ runs: [{ text: 'Hola', r: { sz: 40 } }] }]).toJSON() } });
    const { deck } = deckWith(t);
    const r = resizeSlide(deck, 720, 540, 'fit');
    expect(r.size).toMatchObject({ w: 720, h: 540 });
    const el = r.slides[0]!.shapes[0] as ShapeEl;
    expect(el.xfrm!.w).toBeCloseTo(300, 5);
    const run = JSON.stringify(el.text!.doc);
    expect(run).toContain('"sz":30');
    // the master's text sizes scale too
    expect(r.masters[0]!.txStyles.title.lvl![0]!.rPr!.sz).toBeCloseTo(33, 5);
    const big = resizeSlide(deck, 1920, 1080, 'fit');
    expect(JSON.stringify((big.slides[0]!.shapes[0] as ShapeEl).text!.doc)).toContain('"sz":80');
  });
  it('adds elements to a slide', () => {
    const { deck, sid } = deckWith();
    const d = addElements(deck, sid, [box(1, 2, 3, 4)]);
    expect(d.slides[0]!.shapes).toHaveLength(1);
  });
});

describe('header and footer', () => {
  it('adds, reads back and removes the footer placeholders; title slides can be skipped', async () => {
    const { applyHeaderFooter, headerFooterOf } = await import('./ops');
    let d = newDeck();
    d = addSlide(d, d.layouts.find((l) => l.type === 'obj')!.id, 0).deck;
    const ids = d.slides.map((s) => s.id);
    d = applyHeaderFooter(d, ids, { sldNum: true, ftr: 'Mi empresa', dt: { fixed: '1 de enero' }, skipTitle: true });
    expect(headerFooterOf(d.slides[1]!)).toEqual({ sldNum: true, ftr: 'Mi empresa', dt: { fixed: '1 de enero' } });
    expect(headerFooterOf(d.slides[0]!)).toEqual({ sldNum: false, ftr: null, dt: null });
    d = applyHeaderFooter(d, [ids[1]!], { sldNum: false, ftr: null, dt: { auto: 'datetime1' } });
    const h = headerFooterOf(d.slides[1]!);
    expect(h.sldNum).toBe(false);
    expect(h.ftr).toBeNull();
    expect(h.dt).toEqual({ auto: 'datetime1' });
  });
});

describe('sections', () => {
  it('adds, renames, moves and removes sections keeping every slide in one', async () => {
    const { addSection, moveSection, removeSection, renameSection } = await import('./ops');
    let d = newDeck();
    for (let i = 0; i < 3; i++) d = addSlide(d, d.layouts[1]!.id, d.slides.length - 1).deck;
    const ids = d.slides.map((s) => s.id);
    d = addSection(d, ids[2]!, 'B');
    expect(d.sections.map((s) => [s.name, s.slideIds.length])).toEqual([['Sección predeterminada', 2], ['B', 2]]);
    expect(addSection(d, ids[2]!, 'X')).toBe(d);
    d = renameSection(d, d.sections[1]!.id, 'Final');
    d = moveSection(d, d.sections[1]!.id, -1);
    expect(d.slides.map((s) => s.id)).toEqual([ids[2], ids[3], ids[0], ids[1]]);
    expect(d.sections.map((s) => s.name)).toEqual(['Final', 'Sección predeterminada']);
    const merged = removeSection(d, d.sections[0]!.id, false);
    expect(merged.sections.length).toBe(1);
    expect(merged.sections[0]!.slideIds.length).toBe(4);
    const cut = removeSection(d, d.sections[0]!.id, true);
    expect(cut.slides.length).toBe(2);
    expect(removeSection(merged, merged.sections[0]!.id, true)).toBe(merged);
    expect(removeSection(merged, merged.sections[0]!.id, false).sections).toEqual([]);
  });
});
