import { Workbook, resolveThemeRef } from '@suitenova/calc-engine';
import { COLOR_SCHEMES, officeTheme, withColors } from '@suitenova/theme-core';
import { describe, expect, it } from 'vitest';

describe('Calc: rendimiento del cambio de tema', () => {
  it('cambia el tema de un libro con 100 000 celdas de color de tema en bien menos de un segundo', () => {
    const w = new Workbook();
    const id = w.sheets[0]!.id;
    const ref = { slot: 'accent1', tint: 0.4 } as const;
    w.setInput(id, 0, 0, 'x');
    w.formatRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bgRef: ref, bg: resolveThemeRef(w.theme, ref) });
    const style = w.getCell(id, 0, 0)!.style;
    for (let r = 0; r < 1000; r++) for (let c = 0; c < 100; c++) { w.setInput(id, r, c, '1'); w.getCell(id, r, c)!.style = style; }
    const next = withColors(officeTheme(), COLOR_SCHEMES.find((s) => s.id === 'green')!.colors, 'Verde');
    const t0 = performance.now();
    w.setTheme(next);
    const ms = performance.now() - t0;
    console.log(`calc 100000 celdas: ${ms.toFixed(0)} ms`);
    expect(w.styles.get(style).bg).toBe(resolveThemeRef(next, ref));
    expect(ms).toBeLessThan(1000);
  });
});
