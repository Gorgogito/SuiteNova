// End-to-end checks for Read Aloud in Nova Notes (the immersive reader on the shared reader) with the real voices of Windows. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-notes-voice.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=notes';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1900, height: 950 } })).newPage();
page.setDefaultTimeout(90000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.nn-canvas');
await page.waitForFunction(() => !!window.__novaNotes);
await page.waitForTimeout(500);
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
const dlg = () => page.getByRole('dialog');
const bar = () => page.getByRole('toolbar', { name: 'Leer en voz alta' });

await check('«Leer en voz alta» abre el lector con la barra y empieza a leer la página', async () => {
  const b = await page.locator('.nn-canvas').boundingBox();
  await page.mouse.click(b.x + 120, b.y + 220);
  await page.keyboard.type('Primera frase de la nota. Segunda frase de la nota.');
  await page.getByRole('tab', { name: 'Revisar', exact: true }).click();
  await page.getByRole('button', { name: 'Leer en voz alta', exact: true }).first().click();
  await bar().waitFor();
  await page.waitForFunction(() => !!document.querySelector('[data-testid=nn-immersive] mark'), null, { timeout: 30000 });
  const box = page.getByTestId('nn-immersive');
  assert.match(await box.innerText(), /Primera frase de la nota/);
  assert.equal(await bar().getByText('No hay una voz instalada').count(), 0);
  await shot('leyendo');
});

await check('la palabra que suena se marca dentro del texto del lector', async () => {
  const words = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 12000 && words.size < 3) {
    const w = await page.locator('[data-testid=nn-immersive] mark').first().innerText().catch(() => '');
    if (w) words.add(w.replace(/[.,]/g, ''));
    await page.waitForTimeout(150);
  }
  assert.ok(words.size >= 2, `palabras: ${[...words].join(', ')}`);
  for (const w of words) assert.match('Primera frase de la nota. Segunda frase de la nota.', new RegExp(w));
});

await check('pausa, continuar, velocidad y siguiente funcionan desde la barra', async () => {
  await bar().getByRole('button', { name: 'Pausa' }).click();
  await bar().getByRole('button', { name: 'Reproducir' }).click();
  await bar().getByLabel('Velocidad de lectura').selectOption('1.5');
  await bar().getByRole('button', { name: 'Voz siguiente' }).click();
  assert.match(await bar().innerText(), /Frase \d de \d/);
});

await check('el aspecto del lector (fondo oscuro) sigue funcionando', async () => {
  await dlg().getByLabel('Fondo').selectOption('dark');
  assert.equal(await page.getByTestId('nn-immersive').evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(28, 28, 28)');
});

await check('cerrar el lector detiene la voz', async () => {
  await dlg().getByRole('button', { name: 'Cerrar', exact: true }).last().click();
  await dlg().waitFor({ state: 'detached' });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.speechSynthesis.speaking), false);
});

await check('«Lector inmersivo y voz» abre el lector sin empezar a leer, y Reproducir lo lee', async () => {
  await page.getByRole('button', { name: 'Lector inmersivo y voz', exact: true }).first().click();
  await bar().waitFor();
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => window.speechSynthesis.speaking), false);
  await bar().getByRole('button', { name: 'Reproducir' }).click();
  await page.waitForFunction(() => window.speechSynthesis.speaking, null, { timeout: 10000 });
  await dlg().getByRole('button', { name: 'Cerrar', exact: true }).last().click();
  await dlg().waitFor({ state: 'detached' });
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
