import { describe, expect, it } from 'vitest';
import { newDeck } from './defaults';
import { addElements } from './ops';
import { docText } from './text';
import { readPptx } from './pptx/read';
import { writePptx } from './pptx/write';
import { NOVAART_STYLES, newNovaArt } from './wordart';
import type { ShapeEl } from './types';

describe('NovaArt', () => {
  it('has distinct styles', () => {
    expect(new Set(NOVAART_STYLES.map((s) => s.id)).size).toBe(NOVAART_STYLES.length);
    expect(NOVAART_STYLES.length).toBeGreaterThanOrEqual(20);
  });

  it('every style and transform survives saving', async () => {
    let d = newDeck();
    const ids: string[] = [];
    for (const [i, s] of NOVAART_STYLES.entries()) {
      const el = newNovaArt(s.id, `Texto ${i}`, i % 2 ? 'textArchUp' : 'textPlain', d.size);
      ids.push(el.id);
      d = addElements(d, d.slides[0]!.id, [el]);
    }
    const back = (await readPptx((await writePptx(d)).data)).deck;
    const shapes = back.slides[0]!.shapes.filter((e): e is ShapeEl => e.kind === 'shape' && e.name === 'NovaArt');
    expect(shapes.length).toBe(NOVAART_STYLES.length);
    shapes.forEach((sh, i) => {
      expect(docText(sh.text!.doc)).toBe(`Texto ${i}`);
      expect(sh.text!.body.warp?.prst).toBe(i % 2 ? 'textArchUp' : undefined);
      const r = JSON.stringify(sh.text!.doc);
      const want = NOVAART_STYLES[i]!.fx;
      // a plain solid fill is stored as the run colour
      expect(r).toContain(want.ln || want.effects || want.fill?.t !== 'solid' ? '"fx"' : '"color"');
      if (want.effects?.outer) expect(r).toContain('"outer"');
      if (want.effects?.glow) expect(r).toContain('"glow"');
      if (want.effects?.reflection) expect(r).toContain('"reflection"');
      if (want.fill?.t === 'grad') expect(r).toContain('"grad"');
      if (want.ln) expect(r).toContain('"ln"');
    });
  });
});
