// End-to-end checks for Nova Writer in a real browser (Edge). Needs `pnpm dev` running on :1420.
// Usage: node scripts/e2e-writer.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=writer';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-writer-'));

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
const dialogs = [];
page.on('dialog', (d) => {
  dialogs.push(d.message());
  d.dismiss();
});

let step = 0;
const shot = async (name) => {
  if (!shotsDir) return;
  await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
};
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 7).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};
const W = () => page.evaluate(() => window.__novaWriter);
const text = () => page.evaluate(() => window.__novaWriter.ctl.text());
const pages = () => page.evaluate(() => window.__novaWriter.ctl.pages);
const settle = async () => {
  await page.waitForTimeout(250);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
};
const fill = async (n, para) => {
  const s = para ?? 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(6);
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Enter');
    await page.keyboard.insertText(s);
  }
  await settle();
};
const clearDoc = async () => {
  await page.evaluate(() => window.__novaWriter.ctl.newDoc());
  await settle();
  await page.click('.nw-doc');
};

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.nw-doc');
await page.screenshot(); // first capture after load can be blank
await page.click('.nw-doc');

await check('ribbon tabs and status bar', async () => {
  for (const tab of ['Inicio', 'Insertar', 'Diseño', 'Vista', 'Ayuda']) assert.ok(await page.getByRole('tab', { name: tab }).count(), tab);
  assert.match(await page.locator('.nv-statusbar, [class*="status"]').first().innerText(), /Página 1 de 1/);
});

await check('typing, bold with Ctrl+B and undo', async () => {
  await page.keyboard.type('Hola mundo');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+B');
  assert.equal(await page.locator('.nw-doc strong').count(), 1);
  await page.keyboard.press('Control+Z');
  assert.equal(await page.locator('.nw-doc strong').count(), 0);
  assert.equal(await text(), 'Hola mundo');
  await page.keyboard.press('Control+Y');
  assert.equal(await page.locator('.nw-doc strong').count(), 1);
  await shot('bold');
});

await check('font size and color from the ribbon', async () => {
  await page.selectOption('select[aria-label="Tamaño de fuente"]', '18');
  const size = await page.locator('.nw-doc span[style*="font-size"]').first().evaluate((el) => getComputedStyle(el).fontSize);
  assert.equal(size, '24px');
  await page.selectOption('select[aria-label="Fuente"]', 'Georgia');
  assert.match(await page.locator('.nw-doc span[style*="font-family"]').first().evaluate((el) => getComputedStyle(el).fontFamily), /Georgia/);
});

await check('paragraph style gallery and alignment', async () => {
  await page.getByRole('tab', { name: 'Inicio' }).click();
  await clearDoc();
  await page.keyboard.type('Título del documento');
  await page.selectOption('select[aria-label="Estilo de párrafo"]', 'Heading1');
  assert.equal(await page.locator('.nw-doc p.nw-style-Heading1').count(), 1);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Cuerpo');
  assert.equal(await page.locator('.nw-doc p.nw-style-Heading1').count(), 1, 'the paragraph after a heading is body text');
  await page.keyboard.press('Control+E');
  assert.equal(await page.locator('.nw-doc p:last-child').evaluate((p) => getComputedStyle(p).textAlign), 'center');
  await shot('styles');
});

await check('bullet and numbered lists, Tab indents', async () => {
  await clearDoc();
  await page.keyboard.type('- uno');
  await page.keyboard.press('Enter');
  await page.keyboard.type('dos');
  await page.keyboard.press('Tab');
  await page.keyboard.type('anidado');
  assert.equal(await page.locator('.nw-doc ul ul li').count(), 1);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.nw-doc > section > ul > li').count(), 1, 'three Enters on empty items leave the list');
  await page.keyboard.type('1. primero');
  await page.keyboard.press('Enter');
  await page.keyboard.type('segundo');
  assert.equal(await page.locator('.nw-doc > section > ol > li').count(), 2);
  await shot('lists');
});

await check('table: insert, type in cells, contextual tab, add row', async () => {
  await clearDoc();
  await page.getByRole('tab', { name: 'Insertar' }).click();
  await page.getByRole('button', { name: 'Tabla…' }).click();
  await page.getByLabel('Número de columnas').fill('3');
  await page.getByLabel('Número de filas').fill('2');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await settle();
  assert.equal(await page.locator('.nw-doc table td').count(), 6);
  await page.locator('.nw-doc table td').first().click();
  await page.keyboard.type('A1');
  await page.keyboard.press('Tab');
  await page.keyboard.type('B1');
  assert.ok(await page.getByRole('tab', { name: 'Tabla' }).count(), 'contextual tab appears inside a table');
  await page.getByRole('tab', { name: 'Tabla' }).click();
  await page.getByRole('button', { name: 'Insertar fila abajo' }).click();
  assert.equal(await page.locator('.nw-doc table tr').count(), 3);
  await shot('table');
  await page.locator('.nw-doc table td').nth(1).click();
  assert.match(await text(), /A1/);
});

await check('table: merge cells and shading', async () => {
  await page.locator('.nw-doc table td').nth(0).click();
  await page.keyboard.down('Shift');
  await page.locator('.nw-doc table td').nth(1).click();
  await page.keyboard.up('Shift');
  await page.getByRole('tab', { name: 'Tabla' }).click();
  await page.getByRole('button', { name: 'Combinar celdas' }).click();
  assert.equal(await page.locator('.nw-doc table td[colspan="2"]').count(), 1);
});

await check('image insert from a file', async () => {
  await clearDoc();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64');
  const f = path.join(tmp, 'punto.png');
  fs.writeFileSync(f, png);
  await page.getByRole('tab', { name: 'Insertar' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Imagen…' }).click()]);
  await chooser.setFiles(f);
  await page.waitForSelector('.nw-doc img.nw-image');
  assert.equal(await page.locator('.nw-doc img.nw-image').count(), 1);
});

await check('hyperlink dialog rejects javascript: and creates http links', async () => {
  await clearDoc();
  await page.keyboard.type('sitio');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+K');
  await page.getByLabel('Dirección').fill('javascript:alert(1)');
  assert.ok(await page.getByRole('button', { name: 'Aceptar' }).isDisabled());
  await page.getByLabel('Dirección').fill('https://example.org/');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await settle();
  assert.equal(await page.locator('.nw-doc a.nw-link[href="https://example.org/"]').count(), 1);
});

await check('find and replace', async () => {
  await clearDoc();
  await page.keyboard.insertText('gato perro gato Gato');
  await page.keyboard.press('Control+H');
  await page.getByPlaceholder('Buscar', { exact: true }).fill('gato');
  await settle();
  assert.equal(await page.locator('.nw-doc .nw-find').count(), 3);
  await page.getByPlaceholder('Reemplazar con').fill('pez');
  await page.getByRole('button', { name: 'Reemplazar todo' }).click();
  await settle();
  assert.equal(await text(), 'pez perro pez pez');
  await shot('find');
  await page.keyboard.press('Escape');
});

await check('pagination: pages fill and text stays inside the pages', async () => {
  await clearDoc();
  await page.keyboard.type('Documento largo');
  await fill(30);
  const n = await pages();
  assert.ok(n >= 4, `pages ${n}`);
  const bad = await page.evaluate(() => {
    const { ctl } = window.__novaWriter;
    const sheet = document.querySelector('.nw-sheet');
    const s = sheet.getBoundingClientRect().width / sheet.offsetWidth;
    const top0 = sheet.getBoundingClientRect().top;
    const pageH = (ctl.page.height * 96) / 72;
    const mt = (ctl.page.marginTop * 96) / 72;
    const mb = (ctl.page.marginBottom * 96) / 72;
    const pitch = pageH + 20;
    const out = [];
    for (const p of document.querySelectorAll('.nw-doc > section > p')) {
      const tw = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      const rects = [];
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        const r = document.createRange();
        r.selectNodeContents(n);
        rects.push(...r.getClientRects());
      }
      for (const rc of rects) {
        const y0 = (rc.top - top0) / s, y1 = (rc.bottom - top0) / s;
        const k = Math.floor((y0 + 1) / pitch);
        const inPage = y0 >= k * pitch + mt - 6 && y1 <= k * pitch + pageH - mb + 6;
        if (!inPage) out.push([Math.round(y0), Math.round(y1), k]);
      }
    }
    return out;
  });
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} text boxes outside the page text area`);
  await shot('pagination');
});

await check('pagination: page breaks, tables and keep-with-next headings', async () => {
  await clearDoc();
  await page.keyboard.type('Uno');
  await page.keyboard.press('Control+Enter');
  await page.keyboard.type('Dos');
  await page.keyboard.press('Control+Enter');
  await page.keyboard.type('Tres');
  await settle();
  assert.equal(await pages(), 3);
  assert.equal(await text(), 'Uno\nDos\nTres');
  // a heading near the bottom of a page travels with the paragraph that follows it
  await page.getByRole('tab', { name: 'Inicio' }).click();
  const bad = await page.evaluate(async () => {
    const { ctl } = window.__novaWriter;
    const v = ctl.view;
    const S = v.state.schema;
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60))));
    const pitch = (ctl.page.height * 96) / 72 + 20;
    const bad = [];
    for (let k = 28; k <= 40; k++) {
      const short = Array.from({ length: k }, () => S.node('paragraph', null, [S.text('Línea corta')]));
      const heading = S.node('paragraph', { style: 'Heading1' }, [S.text('Encabezado pegado')]);
      const long = S.node('paragraph', null, [S.text('Texto que sigue al encabezado y ocupa varias líneas. '.repeat(20))]);
      v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, [...short, heading, long]).setMeta('nw-load', true));
      await frames();
      await frames();
      const sheet = document.querySelector('.nw-sheet');
      const sc = sheet.getBoundingClientRect().width / sheet.offsetWidth;
      const top0 = sheet.getBoundingClientRect().top;
      const h = document.querySelector('.nw-doc p.nw-style-Heading1');
      let next = h.nextElementSibling;
      while (next && next.classList.contains('nw-gap')) next = next.nextElementSibling;
      const pg = (el) => Math.floor((el.getBoundingClientRect().top - top0) / sc / pitch + 0.0001);
      const hp = pg(h);
      const r = document.createRange();
      r.selectNodeContents(next);
      const firstLine = r.getClientRects()[0];
      const np = Math.floor((firstLine.top - top0) / sc / pitch);
      if (hp !== np) bad.push({ k, hp, np });
    }
    return bad;
  });
  assert.deepEqual(bad, [], 'heading separated from its paragraph');
});

await check('word count, selection count and page indicator', async () => {
  await clearDoc();
  await page.keyboard.insertText('uno dos tres cuatro');
  await settle();
  assert.match(await page.locator('body').innerText(), /4 palabras/);
  await page.keyboard.press('Control+A');
  await settle();
  assert.match(await page.locator('body').innerText(), /4 de 4 palabras/);
});

await check('page setup: landscape and margins re-paginate', async () => {
  await clearDoc();
  await fill(8);
  const before = await pages();
  await page.getByRole('tab', { name: 'Diseño' }).click();
  await page.getByRole('button', { name: 'Orientación' }).click();
  await page.getByRole('menuitem', { name: 'Horizontal' }).click();
  await settle();
  await page.waitForTimeout(300);
  const after = await pages();
  assert.ok(after >= 1, `${before} -> ${after}`);
  assert.ok((await page.locator('.nw-page').first().evaluate((el) => el.offsetWidth)) > 1000, 'landscape width');
  await shot('landscape');
  await page.getByRole('button', { name: 'Orientación' }).click();
  await page.getByRole('menuitem', { name: 'Vertical' }).click();
  await settle();
});

await check('header and footer with page numbers', async () => {
  await clearDoc();
  await page.keyboard.type('Cuerpo');
  await fill(12);
  await page.getByRole('tab', { name: 'Insertar' }).click();
  await page.locator('[data-nv-item="pageNumMenu"]').click();
  await page.getByRole('menuitem', { name: /parte inferior/ }).click();
  await settle();
  const nums = await page.locator('.nw-footer').allInnerTexts();
  assert.deepEqual(
    nums.map((x) => x.trim()),
    Array.from({ length: nums.length }, (_, i) => String(i + 1)),
  );
  assert.ok(nums.length >= 2);
  // header edited right on the page: double-click on the top margin
  await page.locator('.nw-zone-header').first().dblclick();
  await page.locator('.nw-hf-edit .ProseMirror').first().click();
  await page.keyboard.type('Mi encabezado');
  await page.getByRole('button', { name: 'Cerrar encabezado y pie de página' }).click();
  await settle();
  assert.equal((await page.locator('.nw-header').first().innerText()).trim(), 'Mi encabezado');
  assert.equal((await page.locator('.nw-header').nth(1).innerText()).trim(), 'Mi encabezado', 'the header repeats on every page');
  assert.equal((await page.locator('.nw-header').first().innerText()).trim(), 'Mi encabezado');
  await shot('header-footer');
});

await check('save as .docx downloads a valid package and reopens identically', async () => {
  await page.getByRole('tab', { name: 'Inicio' }).click();
  await clearDoc();
  await page.keyboard.type('Documento guardado');
  await page.selectOption('select[aria-label="Estilo de párrafo"]', 'Heading1');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Cuerpo con acentos: áéíóú ñ — “comillas”.');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  const file = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(file);
  assert.match(dl.suggestedFilename(), /\.docx$/);
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  const before = await text();
  await clearDoc();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+O')]);
  await chooser.setFiles(file);
  await page.waitForFunction(() => window.__novaWriter.ctl.text().includes('Cuerpo'));
  assert.equal(await text(), before);
  assert.equal(await page.locator('.nw-doc p.nw-style-Heading1').count(), 1);
});

await check('printing: the PDF has exactly as many pages as the screen', async () => {
  await clearDoc();
  await page.keyboard.type('Impresión');
  await fill(24);
  await page.keyboard.press('Control+Enter');
  await page.keyboard.type('Última página');
  await settle();
  const n = await pages();
  const html = await page.evaluate(() => window.__novaWriter.printHtml());
  const p2 = await ctx.newPage();
  await p2.setContent(html, { waitUntil: 'load' });
  await p2.waitForTimeout(500);
  const pdf = await p2.pdf({ preferCSSPageSize: true, printBackground: true });
  const count = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  fs.writeFileSync(path.join(tmp, 'out.pdf'), pdf);
  assert.equal(count, n, `PDF ${count} pages vs screen ${n}`);
  await p2.close();
});

await check('zoom keeps the layout and the dark theme keeps white paper', async () => {
  await page.keyboard.down('Control');
  await page.mouse.move(640, 500);
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await settle();
  assert.match(await page.locator('body').innerText(), /1[1-9]0 ?%/);
  await page.emulateMedia({ colorScheme: 'dark' });
  await settle();
  const bg = await page.locator('.nw-page').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.equal(bg, 'rgb(255, 255, 255)');
  await shot('dark');
  await page.emulateMedia({ colorScheme: 'light' });
});

await check('no console errors or unexpected dialogs', async () => {
  assert.deepEqual(errors, []);
  assert.deepEqual(dialogs, []);
});

await browser.close();
let failed = 0;
for (const [s, n, msg] of results) {
  if (s !== 'ok') failed++;
  console.log(`${s === 'ok' ? '✓' : '✗'} ${n}${msg ? '\n    ' + msg : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
