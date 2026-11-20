// Crea con Nova Writer un .docx con comentarios (con respuesta y resuelto) y cambios controlados de dos revisores, para abrirlo con Word real por COM
// (scripts/real-review.ps1). Necesita `pnpm dev` en :1420. Uso: node scripts/real-review.mjs outdir
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
page.on('pageerror', (e) => console.log('ERROR', e.message));
await page.goto('http://localhost:1420/?app=writer', { waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
await page.waitForTimeout(600);
await page.evaluate(() => { window.__novaWriter.ctl.newDoc(); });
await page.waitForTimeout(500);
await page.locator('.ProseMirror').click();
await page.keyboard.type('Primera frase del informe. Segunda frase con cifras. Tercera frase final.');
const sel = (a, b) => page.evaluate(([x, y]) => { const v = window.__novaWriter.ctl.mainView; const S = v.state.selection.constructor; v.dispatch(v.state.tr.setSelection(S.create(v.state.doc, x, y))); v.focus(); }, [a, b]);
await page.evaluate(() => localStorage.setItem('nova.user', JSON.stringify({ name: 'Ana María', initials: 'AM' })));
// comments: one with a reply, resolved; another open
await sel(1, 8);
await page.evaluate(() => {
  const { ctl } = window.__novaWriter;
  ctl.mainView; 
});
const bytes = await page.evaluate(async () => {
  const w = window.__novaWriter;
  const c = w.ctl;
  const v = c.mainView;
  const mark = (id, a, b) => v.dispatch(v.state.tr.addMark(a, b, v.state.schema.marks.comment.create({ id })));
  mark('k1', 1, 8);
  mark('k2', 30, 36);
  const d = (min) => new Date(Date.UTC(2026, 10, 20, 10, min)).toISOString();
  c.comments = [
    { id: 'k1', author: 'Ana María', initials: 'AM', date: d(0), text: 'Revisar esta frase', parent: null, done: true },
    { id: 'k1r', author: 'Luis Torres', initials: 'LT', date: d(5), text: 'De acuerdo\nSegunda línea', parent: 'k1', done: true },
    { id: 'k2', author: 'Luis Torres', initials: 'LT', date: d(10), text: 'Otro asunto', parent: null, done: false },
  ];
  c.touch();
  // tracked changes by two people
  c.trackChanges = true;
  const end = () => { const S = v.state.selection.constructor; v.dispatch(v.state.tr.setSelection(S.atEnd(v.state.doc))); };
  localStorage.setItem('nova.user', JSON.stringify({ name: 'Ana María', initials: 'AM' }));
  end();
  v.dispatch(v.state.tr.insertText(' Añadido por Ana.'));
  localStorage.setItem('nova.user', JSON.stringify({ name: 'Luis Torres', initials: 'LT' }));
  // delete "Segunda frase con cifras."
  const text = v.state.doc.textContent;
  const from = text.indexOf('Segunda') + 1;
  v.dispatch(v.state.tr.delete(from, from + 'Segunda frase con cifras. '.length));
  const { data } = await w.docx.writeDocx(c.toWriterDoc());
  return [...data];
});
fs.writeFileSync(path.join(out, 'revision.docx'), Buffer.from(bytes));
await browser.close();
console.log('ok');
