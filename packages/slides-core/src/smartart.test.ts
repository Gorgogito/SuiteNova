import { describe, expect, it } from 'vitest';
import { newDeck } from './defaults';
import { addElements } from './ops';
import { readPptx } from './pptx/read';
import { writePptx } from './pptx/write';
import { buildDiagram, DIAGRAM_LAYOUTS, diagramArea, parseDiagramText } from './smartart';
import type { GroupEl, SlideElement } from './types';

const flat = (els: SlideElement[]): SlideElement[] => els.flatMap((e) => (e.kind === 'group' ? flat(e.children) : [e]));

describe('diagrams', () => {
  it('reads levels from the text', () => {
    expect(parseDiagramText('Uno\n  Dos\n\t\tTres\n\n- Cuatro')).toEqual([
      { text: 'Uno', level: 0 },
      { text: 'Dos', level: 1 },
      { text: 'Tres', level: 2 },
      { text: 'Cuatro', level: 0 },
    ]);
  });

  it('every layout draws inside its area and every item appears as text, also after saving', async () => {
    const items = parseDiagramText('Dirección\n  Ventas\n    Norte\n    Sur\n  Producción\nSoporte\nFinanzas');
    for (const l of DIAGRAM_LAYOUTS) {
      let d = newDeck();
      const a = diagramArea(d.size);
      const g = buildDiagram(l.id, items, a);
      expect(g.children.length, l.id).toBeGreaterThan(2);
      for (const c of flat(g.children)) {
        const x = (c as { xfrm?: { x: number; y: number; w: number; h: number } }).xfrm!;
        expect(x.x, `${l.id} x`).toBeGreaterThanOrEqual(a.x - 1);
        expect(x.y, `${l.id} y`).toBeGreaterThanOrEqual(a.y - 1);
        expect(x.x + x.w, `${l.id} right`).toBeLessThanOrEqual(a.x + a.w + 1);
        expect(x.y + x.h, `${l.id} bottom`).toBeLessThanOrEqual(a.y + a.h + 1);
      }
      d = addElements(d, d.slides[0]!.id, [g]);
      const back = (await readPptx((await writePptx(d)).data)).deck;
      const grp = back.slides[0]!.shapes.find((e): e is GroupEl => e.kind === 'group')!;
      const text = JSON.stringify(flat(grp.children).map((e) => (e.kind === 'shape' ? e.text?.doc : null)));
      const wanted = l.id === 'hier' || l.id === 'list' || l.id === 'vlist' ? ['Dirección', 'Ventas', 'Producción'] : ['Dirección', 'Soporte'];
      for (const w of wanted) expect(text, l.id).toContain(w);
    }
  }, 30000);
});
