import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dragHandle, presetDefaults, presetGeometry, presetNames } from './preset';

describe('preset shapes', () => {
  it('evaluates every one of the 187 ECMA presets without NaN', () => {
    const names = presetNames();
    expect(names.length).toBe(187);
    for (const n of names) {
      const g = presetGeometry(n, 200, 120)!;
      expect(g, n).toBeTruthy();
      for (const p of g.paths) expect(p.d, n).not.toMatch(/NaN|Infinity/);
      expect(g.textRect.r, n).not.toBeNaN();
    }
  });
  it('draws a rectangle, a rounded rectangle and an ellipse as expected', () => {
    expect(presetGeometry('rect', 100, 50)!.paths[0]!.d).toBe('M0 0L100 0L100 50L0 50Z');
    const rr = presetGeometry('roundRect', 100, 50)!;
    expect(rr.paths[0]!.d).toContain('A');
    expect(presetDefaults('roundRect').adj).toBe(16667);
    const el = presetGeometry('ellipse', 100, 100)!;
    expect(el.paths[0]!.d.match(/A/g)!.length).toBeGreaterThanOrEqual(4);
    expect(el.textRect.l).toBeCloseTo(14.645, 2);
  });
  it('moves an adjust handle', () => {
    const adj = dragHandle('roundRect', 200, 100, {}, 0, 40, 0);
    expect(adj.adj).toBeGreaterThan(35000);
    expect(adj.adj).toBeLessThan(45000);
  });
  it('writes a contact sheet (when asked)', () => {
    if (!process.env.NOVA_SHEET) return;
    const names = presetNames();
    let x = 0;
    let y = 0;
    let body = '';
    for (const n of names) {
      const g = presetGeometry(n, 90, 60)!;
      body += `<g transform="translate(${x * 120 + 10} ${y * 100 + 20})"><text y="-6" font-size="9" font-family="sans-serif">${n}</text>`;
      for (const p of g.paths) body += `<path d="${p.d}" fill="${p.fill === 'none' ? 'none' : '#9db7e8'}" stroke="${p.stroke ? '#1f3d7a' : 'none'}" stroke-width="1"/>`;
      body += '</g>';
      if (++x === 11) (x = 0), y++;
    }
    fs.writeFileSync(process.env.NOVA_SHEET, `<svg xmlns="http://www.w3.org/2000/svg" width="1330" height="${(y + 1) * 100 + 20}" style="background:#fff">${body}</svg>`);
  });
});
