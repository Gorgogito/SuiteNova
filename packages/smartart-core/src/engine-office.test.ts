import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { dataModelToTree, parseSmartArt, render } from './index';

/*
 * El motor contra Office: se ejecuta el diseño que trae un archivo real sobre sus datos y se compara la geometría con el dibujo que
 * Office guardó. Solo con archivos reales (variable SMARTART_FILES); tolerancia en puntos en SMARTART_TOL (por omisión 2).
 */
const files = (process.env.SMARTART_FILES ?? '').split(';').filter(Boolean);
const frame = (process.env.SMARTART_FRAME ?? '640x380').split('x').map(Number) as [number, number];
const tol = Number(process.env.SMARTART_TOL ?? 2);
const only = process.env.SMARTART_ONLY;
const report = process.env.SMARTART_REPORT;

describe.skipIf(!files.length)('motor contra el dibujo de Office', () => {
  const require = createRequire(new URL('../../../apps/suite/package.json', import.meta.url));
  const JSZip = require('jszip') as { loadAsync(b: Buffer): Promise<{ files: Record<string, unknown>; file(n: string): { async(t: 'string'): Promise<string> } | null }> };
  const pt = (v: number) => Math.round((v / 12700) * 10) / 10;

  it('compara la geometría de cada diseño', async () => {
    const lines: string[] = [];
    const bad: string[] = [];
    for (const f of files) {
      const zip = await JSZip.loadAsync(fs.readFileSync(f));
      for (const dp of Object.keys(zip.files).filter((n) => /diagrams\/data\d*\.xml$/.test(n)).sort()) {
        const dir = dp.replace(/data\d*\.xml$/, '');
        const k = /data(\d*)\.xml$/.exec(dp)![1]!;
        const part = async (name: string) => (await zip.file(`${dir}${name}${k}.xml`)?.async('string')) ?? undefined;
        const sa = parseSmartArt({ data: await zip.file(dp)!.async('string'), layout: (await part('layout'))!, style: (await part('quickStyle'))!, colors: (await part('colors'))!, drawing: await part('drawing') });
        const id = sa.layout.uniqueId.split('/').pop()!;
        if (only && !only.split(',').includes(id)) continue;
        // el orden de los conectores no importa: se comparan ordenadas por posición
        const ref = sa.drawing ?? [];
        let mine;
        try {
          const raw = render(sa.layout, dataModelToTree(sa.data), { width: frame[0], height: frame[1] });
          // cada forma mía se empareja con la más parecida de Office (el orden de los conectores no importa)
          const free = [...ref];
          const dist = (a: (typeof raw)[number], b: (typeof raw)[number]) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.w - b.w) + Math.abs(a.h - b.h);
          mine = raw;
          const paired = raw.map((m) => {
            let k = 0;
            free.forEach((f, i) => dist(m, f) < dist(m, free[k]!) && (k = i));
            return free.splice(k, 1)[0];
          });
          ref.splice(0, ref.length, ...(paired.filter(Boolean) as typeof raw), ...free);
        } catch (e) {
          lines.push(`### ${id}: ERROR ${(e as Error).message}`);
          bad.push(id);
          continue;
        }
        lines.push(`### ${id}: ${mine.length} formas (Office ${ref.length})`);
        let worst = 0;
        const n = Math.max(mine.length, ref.length);
        for (let i = 0; i < n; i++) {
          const a = mine[i];
          const b = ref[i];
          const fmt = (s?: typeof a) => (s ? `${s.prst} ${pt(s.x)},${pt(s.y)} ${pt(s.w)}x${pt(s.h)} r${s.rot / 60000}` : '—');
          const d = a && b ? Math.max(Math.abs(pt(a.x) - pt(b.x)), Math.abs(pt(a.y) - pt(b.y)), Math.abs(pt(a.w) - pt(b.w)), Math.abs(pt(a.h) - pt(b.h))) : Infinity;
          worst = Math.max(worst, d);
          lines.push(`  ${d <= tol ? 'ok ' : 'XX '} mío: ${fmt(a)}   office: ${fmt(b)}`);
        }
        if (mine.length !== ref.length || worst > tol) bad.push(`${id} (peor diferencia ${worst === Infinity ? 'forma que falta' : worst.toFixed(1) + ' pt'})`);
      }
    }
    if (report) fs.writeFileSync(report, lines.join('\n'));
    expect(bad, bad.join('; ')).toEqual([]);
  });
});
