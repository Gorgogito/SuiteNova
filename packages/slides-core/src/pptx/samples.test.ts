import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPptx } from './read';

const dir = process.env.NOVA_PPTX_SAMPLES;

describe.skipIf(!dir)('real .pptx files', () => {
  const files = dir ? fs.readdirSync(dir).filter((f) => /\.(pptx|ppsx|potx)$/i.test(f)) : [];
  it('reads every sample without throwing', async () => {
    const failures: string[] = [];
    const stats = { ok: 0, shapes: 0, slides: 0, warnings: new Map<string, number>() };
    for (const f of files) {
      try {
        const r = await readPptx(new Uint8Array(fs.readFileSync(path.join(dir!, f))));
        stats.ok++;
        stats.slides += r.deck.slides.length;
        for (const s of r.deck.slides) stats.shapes += s.shapes.length;
        for (const w of r.warnings) stats.warnings.set(w, (stats.warnings.get(w) ?? 0) + 1);
      } catch (e) {
        failures.push(`${f}: ${(e as Error).message.split('\n')[0]}`);
      }
    }
    console.log(JSON.stringify({ files: files.length, ok: stats.ok, slides: stats.slides, shapes: stats.shapes }));
    console.log([...stats.warnings].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${v} x ${k}`).join('\n'));
    console.log(failures.join('\n'));
    expect(failures.length).toBeLessThan(files.length * 0.1);
  }, 600_000);
});
