import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { COLORS_CATALOG, STYLE_CATALOG, dataModelToTree, parseColorsDef, parseDataModel, parseLayoutDef, parseStyleDef, render, serializeXml, LAYOUT_CATALOG, parseDrawing } from './index';

/*
 * El catálogo propio contra Office: se ejecuta cada diseño nuestro sobre los datos de un archivo real con el diseño equivalente de
 * Office y se compara con el dibujo que Office guardó. Solo con archivos reales (SMARTART_FILES); informe en SMARTART_CAT_REPORT.
 * Los diseños que se afirman (los equivalentes de verdad) están en `STRICT`; los demás se informan sin exigir.
 */
const files = (process.env.SMARTART_FILES ?? '').split(';').filter(Boolean);
const frame = (process.env.SMARTART_FRAME ?? '640x380').split('x').map(Number) as [number, number];
const MAP: Record<string, string> = { default: 'blocklist', process1: 'process', cycle2: 'cycle', hierarchy1: 'hierarchy', pyramid1: 'pyramid', venn1: 'venn', vList2: 'vlist', matrix1: 'matrix' };
const STRICT = new Set(['default', 'process1', 'cycle2', 'pyramid1', 'hierarchy1']);

describe.skipIf(!files.length)('catálogo propio contra el dibujo de Office', () => {
  const require = createRequire(new URL('../../../apps/suite/package.json', import.meta.url));
  const JSZip = require('jszip') as { loadAsync(b: Buffer): Promise<{ files: Record<string, unknown>; file(n: string): { async(t: 'string'): Promise<string> } | null }> };
  const pt = (v: number) => Math.round((v / 12700) * 10) / 10;

  it('compara', async () => {
    const lines: string[] = [];
    const bad: string[] = [];
    for (const f of files) {
      const zip = await JSZip.loadAsync(fs.readFileSync(f));
      for (const dp of Object.keys(zip.files).filter((n) => /diagrams\/data\d*\.xml$/.test(n)).sort()) {
        const dir = dp.replace(/data\d*\.xml$/, '');
        const k = /data(\d*)\.xml$/.exec(dp)![1]!;
        const get = async (name: string) => (await zip.file(`${dir}${name}${k}.xml`)?.async('string')) ?? undefined;
        const officeLayout = parseLayoutDef((await get('layout'))!);
        const key = officeLayout.uniqueId.split('/').pop()!;
        const ours = LAYOUT_CATALOG.find((l) => l.id.endsWith('/' + MAP[key]));
        if (!ours) continue;
        const dm = parseDataModel(await zip.file(dp)!.async('string'));
        const ref = parseDrawing((await get('drawing'))!);
        const style = parseStyleDef(STYLE_CATALOG[0]!.xml);
        const colors = parseColorsDef(COLORS_CATALOG[0]!.xml);
        const mine = render(parseLayoutDef(ours.xml), dataModelToTree(dm), { width: frame[0], height: frame[1], style, colors });
        lines.push(`### ${key} -> ${ours.name}: ${mine.length} formas (Office ${ref.length})`);
        const free = [...ref];
        let worst = 0;
        let looks = 0;
        for (const m of mine) {
          let kk = 0;
          const dist = (a: typeof m, b: typeof m) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.w - b.w) + Math.abs(a.h - b.h);
          free.forEach((c, i) => dist(m, c) < dist(m, free[kk]!) && (kk = i));
          const o = free.splice(kk, 1)[0];
          if (!o) continue;
          const d = Math.max(Math.abs(pt(m.x) - pt(o.x)), Math.abs(pt(m.y) - pt(o.y)), Math.abs(pt(m.w) - pt(o.w)), Math.abs(pt(m.h) - pt(o.h)));
          worst = Math.max(worst, d);
          if (m.spPr.map(serializeXml).join('') !== o.spPr.map(serializeXml).join('')) looks++;
          if (d > 3) lines.push(`  XX mío ${m.prst} ${pt(m.x)},${pt(m.y)} ${pt(m.w)}x${pt(m.h)}  office ${o.prst} ${pt(o.x)},${pt(o.y)} ${pt(o.w)}x${pt(o.h)}`);
        }
        lines.push(`  peor diferencia ${worst} pt; aspecto distinto en ${looks} formas; formas sin pareja: ${free.length}`);
        if (STRICT.has(key) && (worst > 3 || mine.length !== ref.length)) bad.push(`${key}: ${worst} pt, ${mine.length}/${ref.length} formas`);
      }
    }
    if (process.env.SMARTART_CAT_REPORT) fs.writeFileSync(process.env.SMARTART_CAT_REPORT, lines.join('\n'));
    expect(bad, bad.join('; ')).toEqual([]);
  });
});
