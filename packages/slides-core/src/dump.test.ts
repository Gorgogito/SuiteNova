import fs from 'node:fs';
import { it } from 'vitest';
import { readPptx } from './pptx/read';
it('dump', async () => {
  const f = process.env.NOVA_DUMP;
  if (!f) return;
  const r = await readPptx(new Uint8Array(fs.readFileSync(f)));
  const s = r.deck.slides[0]!;
  console.log(JSON.stringify(s.shapes.slice(0, 3), (k, v) => (k === 'doc' ? '[doc]' : v), 1).slice(0, 3500));
  console.log(r.warnings);
});
