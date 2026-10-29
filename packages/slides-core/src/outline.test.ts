import { describe, expect, it } from 'vitest';
import { newDeck } from './defaults';
import { addSlide } from './ops';
import { outlineBody, outlineOf, outlineTitle, outlineToDeck, type OutlineRow } from './outline';
import { docText } from './text';

const objLayout = (d: ReturnType<typeof newDeck>) => d.layouts.find((l) => l.type === 'obj')!.id;

describe('outline', () => {
  it('reads title and body rows, writes text back and keeps untouched paragraphs', () => {
    let d = newDeck();
    d = addSlide(d, objLayout(d), d.slides.length - 1).deck;
    const rows = outlineOf(d);
    const last = d.slides[d.slides.length - 1]!;
    expect(rows.filter((r) => r.sid === last.id)[0]!.kind).toBe('title');
    const edited: OutlineRow[] = [
      ...rows,
      { sid: last.id, kind: 'title', lvl: 0, text: 'x' },
    ];
    // the title row of the last slide gets text, then body rows follow
    const r2: OutlineRow[] = rows.map((r) => (r.sid === last.id && r.kind === 'title' ? { ...r, text: 'Resultados' } : r));
    r2.push({ sid: last.id, kind: 'body', lvl: 0, text: 'Primero' }, { sid: last.id, kind: 'body', lvl: 1, text: 'Detalle' });
    void edited;
    const d2 = outlineToDeck(d, r2);
    const s = d2.slides.find((x) => x.id === last.id)!;
    expect(docText(outlineTitle(s)!.text!.doc)).toBe('Resultados');
    expect(docText(outlineBody(s)!.text!.doc)).toBe('Primero\nDetalle');
    const back = outlineOf(d2).filter((r) => r.sid === last.id);
    expect(back.map((r) => [r.kind, r.lvl, r.text])).toEqual([['title', 0, 'Resultados'], ['body', 0, 'Primero'], ['body', 1, 'Detalle']]);
    // nothing changes when the rows are the same
    expect(outlineToDeck(d2, outlineOf(d2))).toBe(d2);
  });

  it('a new title row makes a slide and a removed one deletes it', () => {
    let d = newDeck();
    d = addSlide(d, objLayout(d), 0).deck;
    const rows = outlineOf(d);
    const n = d.slides.length;
    const withNew: OutlineRow[] = [...rows, { sid: 'nuevo', kind: 'title', lvl: 0, text: 'Otra' }, { sid: 'nuevo', kind: 'body', lvl: 0, text: 'Punto' }];
    const d2 = outlineToDeck(d, withNew);
    expect(d2.slides.length).toBe(n + 1);
    const s = d2.slides[d2.slides.length - 1]!;
    expect(s.id).toBe('nuevo');
    expect(docText(outlineTitle(s)!.text!.doc)).toBe('Otra');
    expect(docText(outlineBody(s)!.text!.doc)).toBe('Punto');
    const d3 = outlineToDeck(d2, outlineOf(d2).filter((r) => r.sid !== 'nuevo'));
    expect(d3.slides.length).toBe(n);
  });
});
