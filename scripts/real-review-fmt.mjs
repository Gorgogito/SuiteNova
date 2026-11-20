// Lee con Nova Writer un .docx hecho por Word real con cambios controlados (formato, inserción, borrado, tabla) y lo vuelve a escribir, para que Word
// real compruebe que los cambios siguen ahí. Uso: node scripts/real-review-fmt.mjs entrada.docx salida.docx   (necesita `pnpm dev` en :1420)
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
const [input, output] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext()).newPage();
await page.goto('http://localhost:1420/?app=writer', { waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
await page.waitForTimeout(500);
const res = await page.evaluate(async (bytes) => {
  const w = window.__novaWriter;
  const m = await import('/src/writer/review.ts');
  const r = await w.docx.readDocx(Uint8Array.from(bytes));
  const kinds = m.listChanges(r.doc.body).map((c) => c.kind + ':' + c.text);
  const { data } = await w.docx.writeDocx(r.doc);
  return { kinds, out: [...data] };
}, [...fs.readFileSync(input)]);
fs.writeFileSync(output, Buffer.from(res.out));
console.log('cambios que ve Nova:', res.kinds.join(' | '));
await browser.close();
