import { describe, expect, it } from 'vitest';
import { BG_STYLES, applyBackgroundStyle, currentBackgroundStyle, resetSlide } from './designops';
import { newDeck } from './defaults';
import { isDark } from './themes';
import type { ShapeEl } from './types';

describe('background styles', () => {
  it('there are twelve and each one is recognised after applying it', () => {
    expect(BG_STYLES).toHaveLength(12);
    for (const s of BG_STYLES) {
      const d = applyBackgroundStyle(newDeck(), s.id);
      expect(isDark(d)).toBe(s.dark);
      expect(currentBackgroundStyle(d)).toBe(s.id);
    }
  });
});

describe('reset slide', () => {
  it('placeholders lose their own position and format', () => {
    const d = newDeck();
    const slide = d.slides[0]!;
    const ph = slide.shapes.find((e) => e.kind === 'shape' && e.ph) as ShapeEl;
    expect(ph).toBeTruthy();
    ph.xfrm = { x: 1, y: 2, w: 3, h: 4 };
    ph.fill = { t: 'solid', c: { rgb: '#ff0000' } };
    const r = resetSlide(d, slide.id);
    const back = r.slides[0]!.shapes.find((e) => e.id === ph.id) as ShapeEl;
    expect(back.xfrm).toBeUndefined();
    expect(back.fill).toBeUndefined();
  });
});
