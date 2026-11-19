// End-to-end checks for the autocorrect of Nova Writer. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-writer-autocorrect.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=writer';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => {
  errors.push(`dialog: ${d.message()}`);
  d.dismiss();
});
let step = 0;
const shot = async (name) => {
  if (!shotsDir) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
};
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 8).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
await page.waitForTimeout(500);
const ev = (fn, arg) => page.evaluate(fn, arg);
const editor = page.locator('.ProseMirror').first();
const fresh = async () => {
  await ev(() => window.__novaWriter.ctl.newDoc());
  await page.waitForTimeout(500);
  await editor.click();
};
const text = async () => (await editor.innerText()).replace(/ /g, ' ');

await fresh();
await check('comillas tipográficas, símbolos, fracciones y rayas al escribir', async () => {
  await page.keyboard.type('dijo "hola" y (c) 2026 (tm) 1/2 -- fin... ', { delay: 8 });
  const s = await text();
  assert.ok(s.includes('“hola”'), s);
  assert.ok(s.includes('©'), s);
  assert.ok(s.includes('™'), s);
  assert.ok(s.includes('½'), s);
  assert.ok(s.includes('–'), s);
  assert.ok(s.includes('fin…'), s);
  await shot('simbolos');
});

await check('mayúscula inicial de oración y dos mayúsculas iniciales', async () => {
  await fresh();
  await page.keyboard.type('hola mundo. segunda frase. COrrecto texto, etc. sigue igual ', { delay: 8 });
  const s = await text();
  assert.ok(s.startsWith('Hola mundo. Segunda frase. Correcto texto'), s);
  assert.ok(s.includes('etc. sigue igual'), s); // tras «etc.» no se capitaliza
});

await check('direcciones web y de correo se vuelven vínculos', async () => {
  await fresh();
  await page.keyboard.type('visita www.ejemplo.org y escribe a ana@correo.com ahora', { delay: 8 });
  const links = await ev(() => {
    const out = [];
    window.__novaWriter.ctl.state.doc.descendants((n) => {
      if (n.isText) for (const m of n.marks) if (m.type.name === 'link') out.push([n.text, m.attrs.href]);
    });
    return out;
  });
  assert.deepEqual(links, [['www.ejemplo.org', 'http://www.ejemplo.org'], ['ana@correo.com', 'mailto:ana@correo.com']]);
  // lo que sigue al vínculo no lo hereda
  assert.ok((await text()).endsWith(' ahora'));
  await shot('vinculos');
});

await check('listas automáticas: 1. a. i. y guion', async () => {
  for (const [typed, tag, fmt] of [['1. ', 'ordered_list', 'decimal'], ['a. ', 'ordered_list', 'lowerLetter'], ['I. ', 'ordered_list', 'upperRoman'], ['- ', 'bullet_list', undefined]]) {
    await fresh();
    await page.keyboard.type(`${typed}elemento`, { delay: 8 });
    const info = await ev(() => {
      const r = [];
      window.__novaWriter.ctl.state.doc.descendants((n) => { if (n.type.name === 'ordered_list' || n.type.name === 'bullet_list') r.push([n.type.name, n.attrs.format]); });
      return r;
    });
    assert.equal(info[0]?.[0], tag, `${typed} → ${JSON.stringify(info)}`);
    if (fmt) assert.equal(info[0][1], fmt, typed);
  }
});

await check('el cuadro de opciones apaga correcciones y guarda reemplazos propios', async () => {
  await fresh();
  await page.getByRole('tab', { name: 'Revisar', exact: true }).click();
  await page.getByRole('button', { name: 'Ortografía' }).nth(1).click();
  await page.getByRole('menuitem', { name: /Opciones de autocorrección/ }).click();
  await page.waitForTimeout(300);
  await shot('dialogo-autocorreccion');
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Comillas rectas por comillas tipográficas').uncheck();
  await dlg.getByLabel('Reemplazar', { exact: true }).fill('pq');
  await dlg.getByLabel('Con', { exact: true }).fill('porque');
  await dlg.getByRole('button', { name: 'Agregar' }).click();
  await dlg.getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForTimeout(900);
  await editor.click();
  await page.keyboard.type('digo "hola" pq si ', { delay: 8 });
  const s = await text();
  assert.ok(s.includes('"hola"'), s); // comillas rectas: apagado
  assert.ok(s.includes('porque si'), s);
  const saved = await ev(() => JSON.parse(localStorage.getItem('nova.writer.autocorrect')));
  assert.equal(saved.flags.smartQuotes, false);
  assert.equal(saved.lists.es.pq, 'porque');
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
