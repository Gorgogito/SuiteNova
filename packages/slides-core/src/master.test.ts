import { describe, expect, it } from 'vitest';
import { newDeck } from './defaults';
import { addElements, addSlide, updateElements } from './ops';
import { addLayout, deleteLayout, deleteMaster, duplicateLayout, duplicateMaster, foldMasterDeck, layoutFooters, moveLayout, newPlaceholder, virtualMasterDeck, VIRTUAL_LAYOUT } from './master';
import { readPptx } from './pptx/read';
import { writePptx } from './pptx/write';
import { chainFor } from './resolve';
import type { ShapeEl } from './types';

describe('master view', () => {
  it('a layout is edited as a slide and folds back', () => {
    const d = newDeck();
    const l = d.layouts[1]!;
    const v = virtualMasterDeck(d, { kind: 'layout', id: l.id });
    expect(v.slides.length).toBe(1);
    expect(v.slides[0]!.shapes).toBe(l.shapes);
    expect(v.layouts.find((x) => x.id === l.id)!.shapes).toEqual([]);
    const ph = newPlaceholder(d, l.masterId, 'pic');
    const edited = addElements(v, v.slides[0]!.id, [ph]);
    const back = foldMasterDeck(d, edited, { kind: 'layout', id: l.id });
    expect(back.layouts.find((x) => x.id === l.id)!.shapes.length).toBe(l.shapes.length + 1);
    expect(back.slides).toBe(d.slides);
    expect(back.layouts.length).toBe(d.layouts.length);
  });

  it('the master is edited the same way, and slides see the change', () => {
    const d = newDeck();
    const m = d.masters[0]!;
    const v = virtualMasterDeck(d, { kind: 'master', id: m.id });
    expect(v.layouts.some((x) => x.id === VIRTUAL_LAYOUT)).toBe(true);
    expect(chainFor(v, v.slides[0]).master?.id).toBe(m.id);
    const title = v.slides[0]!.shapes.find((s): s is ShapeEl => s.kind === 'shape' && s.ph?.type === 'title')!;
    const edited = updateElements(v, v.slides[0]!.id, [title.id], (e) => ({ ...e, xfrm: { ...(e as ShapeEl).xfrm!, y: 5 } }) as ShapeEl);
    const back = foldMasterDeck(d, { ...edited, slides: [{ ...edited.slides[0]!, bg: { fill: { t: 'solid', c: { rgb: '#112233' } } } }] }, { kind: 'master', id: m.id });
    expect(back.layouts.some((x) => x.id === VIRTUAL_LAYOUT)).toBe(false);
    expect(back.layouts.length).toBe(d.layouts.length);
    expect(back.masters[0]!.bg).toEqual({ fill: { t: 'solid', c: { rgb: '#112233' } } });
    expect((back.masters[0]!.shapes.find((s) => s.id === title.id) as ShapeEl).xfrm!.y).toBe(5);
    expect(back.slides).toBe(d.slides);
  });

  it('adds, duplicates, moves and deletes layouts; slides of a deleted layout move to another', () => {
    let d = newDeck();
    const mid = d.masters[0]!.id;
    const a = addLayout(d, mid, 'Mío', d.layouts[0]!.id);
    d = a.deck;
    expect(d.masters[0]!.layoutIds[1]).toBe(a.id);
    expect(layoutFooters(d.layouts.find((l) => l.id === a.id)!)).toEqual({ dt: true, ftr: true, sldNum: true });
    const b = duplicateLayout(d, a.id);
    d = moveLayout(b.deck, b.id, 3);
    expect(d.masters[0]!.layoutIds.indexOf(b.id)).toBe(5);
    d = addSlide(d, a.id, 0).deck;
    const r = deleteLayout(d, a.id);
    expect(r.moved).toBe(1);
    expect(r.deck.layouts.some((l) => l.id === a.id)).toBe(false);
    expect(r.deck.slides.every((s) => r.deck.layouts.some((l) => l.id === s.layoutId))).toBe(true);
  });

  it('duplicates and deletes masters; everything survives saving', async () => {
    let d = newDeck();
    d = addSlide(d, d.layouts[1]!.id, 0).deck;
    const c = duplicateMaster(d, d.masters[0]!.id);
    d = c.deck;
    expect(d.masters.length).toBe(2);
    expect(d.themes.length).toBe(2);
    const back = (await readPptx((await writePptx(d)).data)).deck;
    expect(back.masters.length).toBe(2);
    expect(back.layouts.length).toBe(d.layouts.length);
    const gone = deleteMaster(d, d.masters[0]!.id);
    expect(gone.masters.length).toBe(1);
    expect(gone.slides.every((s) => gone.layouts.some((l) => l.id === s.layoutId))).toBe(true);
    expect(deleteMaster(gone, gone.masters[0]!.id)).toBe(gone);
  });
});
