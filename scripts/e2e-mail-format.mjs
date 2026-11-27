// Formatting in Nova Mail (second round, phase 2): the format bar, the original kept under an answer, signatures,
// templates, importance, drafts that open as written and what is pasted.
// Needs `pnpm dev` on :1420. Usage: node scripts/e2e-mail-format.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lowContrast } from './lib-contrast.mjs';

const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const errors = [];
const questions = [];
let ctx;
let page;

const results = [];
const check = async (name, fn) => {
  try {
    await fresh();
    await fn();
    results.push(['ok', name]);
    console.log(`  ✔ ${name}`);
  } catch (e) {
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/fail-${results.length}.png`, timeout: 5000 }).catch(() => {});
    results.push(['FAIL', name]);
    console.log(`  ✘ ${name}\n      ${e.message.split('\n').filter(Boolean).slice(0, 14).join('\n      ')}`);
  }
};
const settle = (ms = 250) => page.waitForTimeout(ms);
const shot = (n) => (shotsDir ? page.screenshot({ path: `${shotsDir}/${n}.png` }) : Promise.resolve());
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8DwnwEImBigAAAfFwICvkDRvAAAAABJRU5ErkJggg==';
/** A message in HTML with a picture of its own. */
const ORIGINAL = [
  'From: Ana López <ana@x.test>',
  'To: yo@x.test',
  'Subject: Informe',
  'Message-ID: <inf@x.test>',
  'Date: Mon, 23 Nov 2026 10:00:00 +0000',
  'MIME-Version: 1.0',
  'Content-Type: multipart/related; boundary="b"',
  '',
  '--b',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p style="color:#1f4e79;font-size:20px">Informe <b>trimestral</b></p><p><img src="cid:logo" alt="Logo" width="20"></p>',
  '--b',
  'Content-Type: image/png',
  'Content-Transfer-Encoding: base64',
  'Content-ID: <logo>',
  '',
  PNG,
  '--b--',
  '',
].join('\r\n');

const fresh = async () => {
  await ctx?.close();
  ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, colorScheme: 'light', permissions: ['clipboard-read', 'clipboard-write'] });
  page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on('dialog', (d) => (questions.push(d.message()), d.dismiss().catch(() => {})));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|404|beforeunload|Blocked script/.test(m.text()) && errors.push(m.text()));
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(`${BASE}?app=mail`, { waitUntil: 'load', timeout: 45000 });
      await page.waitForSelector('.ml-app', { timeout: 30000 });
      break;
    } catch (e) {
      if (attempt) throw e;
    }
  }
  await page.waitForFunction(() => !!window.__novaMail, null, { timeout: 60000 });
  await page.evaluate((raw) => {
    window.__novaMail.ctl.importRaw(raw, 'inbox');
    window.__novaMail.ctl.touch();
  }, ORIGINAL);
  await settle(400);
};

const composer = () => page.getByRole('region', { name: 'Mensaje que escribes' });
const editor = () => page.getByLabel('Cuerpo del mensaje');
const field = (name) => page.getByLabel(name, { exact: true });
const tool = (name) => composer().getByRole('toolbar', { name: 'Formato del mensaje' }).getByRole('button', { name, exact: true });
const ctl = (fn, arg) => page.evaluate(`(${fn})(window.__novaMail.ctl, ${JSON.stringify(arg ?? null)})`);
const compose = async () => {
  await page.keyboard.press('Control+Shift+M');
  await composer().waitFor();
};
/** What would be sent, decoded. */
const sent = async () => {
  await settle(200);
  const raw = await ctl((c) => c.buildRaw(c.compose).raw);
  return raw.replace(/=\r\n/g, '').replace(/(=[0-9A-F]{2})+/g, (m) => Buffer.from(m.replace(/=/g, ''), 'hex').toString('utf8'));
};
const html = async () => (await sent()).split('Content-Type: text/html')[1] ?? '';
/** A key that moves the cursor, and the moment the editor takes to read where it went (people are slower than that). */
const move = async (key) => {
  await page.keyboard.press(key);
  await settle(80);
};
const typeLine = async (text) => {
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
};

await check('la barra de formato: letra, color, resaltado, listas, alineación y vínculo van en el HTML', async () => {
  await compose();
  await field('Asunto').fill('Formato');
  await editor().click();
  await page.keyboard.type('Título');
  await move('Shift+Home');
  await tool('Negrita').click();
  await composer().getByLabel('Tamaño de fuente').selectOption('18');
  await composer().getByLabel('Fuente', { exact: true }).selectOption('Georgia');
  await tool('Color de fuente').click();
  await page.getByRole('group', { name: 'Color de fuente' }).getByRole('button', { name: 'Rojo', exact: true }).click();
  await tool('Centrar').click();
  assert.equal(await tool('Negrita').getAttribute('aria-pressed'), 'true');
  assert.equal(await tool('Centrar').getAttribute('aria-pressed'), 'true');
  await move('End');
  await page.keyboard.press('Enter');
  await tool('Negrita').click();
  await tool('Alinear a la izquierda').click();
  await tool('Numeración').click();
  await typeLine('primero');
  await typeLine('segundo');
  await page.keyboard.press('Enter');
  await page.keyboard.type('visita ejemplo');
  await move('Shift+Control+ArrowLeft');
  await tool('Vínculo').click();
  await page.getByLabel('Dirección del vínculo').fill('example.org/pagina');
  await page.getByRole('button', { name: 'Insertar vínculo' }).click();
  await move('End');
  await page.keyboard.type(' ');
  await move('Shift+Home');
  await tool('Color de resaltado').click();
  await page.getByRole('group', { name: 'Color de resaltado' }).getByRole('button', { name: 'Amarillo', exact: true }).click();
  await shot('formato');
  const h = await html();
  assert.match(h, /text-align:center/);
  assert.match(h, /font-family:'Georgia'/);
  assert.match(h, /font-size:18pt/);
  assert.match(h, /color:#ff0000/);
  assert.match(h, /<ol[^>]*><li>primero<\/li><li>segundo<\/li><\/ol>/);
  assert.match(h, /<a href="https:\/\/example\.org\/pagina">/);
  assert.match(h, /background-color:#ffff00/);
  assert.doesNotMatch(h, /class="nw-/);
  const text = (await sent()).split('Content-Type: text/plain')[1].split('Content-Type: text/html')[0];
  assert.match(text, /1\. primero\r\n2\. segundo/);
});

await check('un mensaje sin formato se envía solo como texto', async () => {
  await compose();
  await editor().click();
  await typeLine('Solo texto.');
  await page.keyboard.type('Dos líneas.');
  const eml = await sent();
  assert.match(eml, /Content-Type: text\/plain/);
  assert.doesNotMatch(eml, /text\/html/);
});

await check('al responder, el original va debajo con su formato y su imagen; se puede editar o quitar', async () => {
  await page.locator('.ml-item', { hasText: 'Informe' }).click();
  await page.getByRole('button', { name: 'Responder', exact: true }).first().click();
  await composer().waitFor();
  await page.keyboard.type('Gracias.');
  const preview = page.frameLocator('.ml-quote iframe');
  await preview.getByText('trimestral').waitFor();
  assert.equal(await preview.locator('img').evaluate((e) => e.naturalWidth), 2, 'la imagen del original se ve');
  await shot('respuesta');
  const eml = await sent();
  const h = await html();
  assert.match(h, /Gracias\./);
  assert.match(h, /color:#1f4e79;font-size:20px/);
  assert.match(h, /<blockquote/);
  assert.match(eml, /Content-ID: <logo>/);
  assert.ok(h.indexOf('Gracias.') < h.indexOf('trimestral'), 'lo escrito, encima');
  // the original turned into text, to answer inside it
  await composer().getByRole('button', { name: 'Editar el original' }).click();
  await page.locator('.ml-quote').waitFor({ state: 'detached' });
  await page.waitForFunction(() => /> Informe trimestral/.test(window.__novaMail.ctl.compose.body));
  await composer().getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Descartar' }).click();
  await page.getByRole('button', { name: 'Responder', exact: true }).first().click();
  await composer().getByRole('button', { name: 'Quitar el original' }).click();
  await page.keyboard.press('Control+Shift+M');
  await settle();
  assert.equal(await page.locator('.ml-quote').count(), 0);
});

await check('firmas: se crean, se ponen solas, cambian con la cuenta y se eligen en el menú', async () => {
  await page.getByRole('tab', { name: 'Enviar y recibir', exact: true }).click();
  await page.locator('[data-nv-item="mail.signatures"]').click();
  const dialog = page.getByRole('dialog', { name: 'Firmas' });
  await dialog.getByRole('button', { name: 'Nueva firma' }).click();
  await dialog.getByLabel('Nombre de la firma').fill('Trabajo');
  await dialog.getByLabel('Texto de la firma').click();
  await page.keyboard.type('Un saludo');
  await dialog.getByRole('button', { name: 'Nueva firma' }).click();
  await dialog.getByLabel('Nombre de la firma').fill('Casa');
  await dialog.getByLabel('Texto de la firma').click();
  await page.keyboard.type('Abrazos');
  await page.evaluate(async () => {
    const acc = (id, name) => ({ id, name, email: `${id}@x.test`, protocol: 'imap', auth: 'password', imap: { host: 'h.test', port: 993, security: 'tls' }, smtp: { host: 'h.test', port: 465, security: 'tls' } });
    window.__novaMail.setTransport(async (cmd) => (cmd === 'mail_accounts' ? [acc('trabajo', 'Trabajo'), acc('casa', 'Casa')] : []));
    await window.__novaMail.ctl.loadAccounts();
  });
  await dialog.getByLabel('Casa: Mensajes nuevos').selectOption({ label: 'Casa' });
  await shot('firmas');
  await dialog.getByRole('button', { name: 'Guardar firmas' }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('tab', { name: 'Inicio', exact: true }).click();
  await compose();
  await page.waitForFunction(() => window.__novaMail.ctl.compose.body === '\n\nUn saludo');
  await field('Desde').selectOption('casa');
  await page.waitForFunction(() => window.__novaMail.ctl.compose.body === '\n\nAbrazos');
  await field('Desde').selectOption('trabajo');
  await page.waitForFunction(() => window.__novaMail.ctl.compose.body === '\n\nUn saludo');
  await editor().click();
  await move('Control+Home');
  await page.keyboard.type('Hola.');
  await composer().getByRole('button', { name: 'Firma', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Casa', exact: true }).click();
  await page.waitForFunction(() => window.__novaMail.ctl.compose.body === 'Hola.\n\nAbrazos');
  await composer().getByRole('button', { name: 'Firma', exact: true }).click();
  await page.getByRole('menuitem', { name: '(Sin firma)' }).click();
  await page.waitForFunction(() => window.__novaMail.ctl.compose.body.trim() === 'Hola.');
});

await check('mirar un mensaje con firma no lo cambia: se cierra sin preguntar', async () => {
  await page.evaluate(() => localStorage.setItem('novamail.signatures', JSON.stringify({ list: [{ id: 's', name: 'S', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Un saludo' }] }] } }], defaults: { '': { new: 's', reply: 's' } } })));
  await page.locator('.ml-item', { hasText: 'Informe' }).click();
  await page.getByRole('button', { name: 'Responder', exact: true }).first().click();
  await composer().waitFor();
  await settle(400);
  await editor().click();
  await move('Control+End');
  await move('Control+Home');
  await composer().getByRole('button', { name: 'Cerrar', exact: true }).click();
  await composer().waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('alertdialog').count(), 0);
  assert.equal(await ctl((c) => c.data.messages.filter((m) => m.folder === 'drafts').length), 0);
  await page.evaluate(() => localStorage.removeItem('novamail.signatures'));
});

await check('plantillas: se guardan, se insertan con su asunto y se quitan', async () => {
  await compose();
  await field('Asunto').fill('Acuse de recibo');
  await editor().click();
  await tool('Negrita').click();
  await page.keyboard.type('Recibido, gracias.');
  await composer().getByRole('button', { name: 'Plantillas…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plantillas' });
  assert.equal(await dialog.getByLabel('Nombre de la plantilla').inputValue(), 'Acuse de recibo');
  await dialog.getByRole('button', { name: 'Guardar este mensaje como plantilla' }).click();
  await dialog.getByRole('button', { name: 'Cerrar' }).click();
  await composer().getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Descartar' }).click();
  await compose();
  await composer().getByRole('button', { name: 'Plantillas…' }).click();
  await shot('plantillas');
  await dialog.getByRole('button', { name: 'Insertar la plantilla Acuse de recibo' }).click();
  await page.waitForFunction(() => /Recibido, gracias\./.test(window.__novaMail.ctl.compose.body));
  assert.equal(await field('Asunto').inputValue(), 'Acuse de recibo');
  assert.match(await html(), /<b>Recibido, gracias\.<\/b>/);
  await composer().getByRole('button', { name: 'Plantillas…' }).click();
  await dialog.getByRole('button', { name: 'Quitar la plantilla Acuse de recibo' }).click();
  assert.match(await dialog.innerText(), /Todavía no hay plantillas/);
});

await check('importancia: viaja en el mensaje y se ve al recibirlo', async () => {
  await compose();
  await field('Para').fill('ana@x.test');
  await field('Asunto').fill('Urgente');
  await tool('Importancia alta').click();
  assert.equal(await tool('Importancia alta').getAttribute('aria-pressed'), 'true');
  const eml = await sent();
  assert.match(eml, /Importance: High/);
  assert.match(eml, /X-Priority: 1/);
  await page.evaluate((raw) => window.__novaMail.ctl.importRaw(raw, 'inbox'), await ctl((c) => c.buildRaw(c.compose).raw));
  await ctl((c) => (c.closeCompose(), c.touch()));
  const row = page.locator('.ml-item', { hasText: 'Urgente' });
  await row.getByLabel('Importancia alta').waitFor();
  await row.click();
  await page.getByRole('note').filter({ hasText: 'importancia alta' }).waitFor();
});

await check('un borrador con formato, tabla e imagen se abre como se escribió', async () => {
  await compose();
  await field('Asunto').fill('Borrador rico');
  await editor().click();
  await tool('Cursiva').click();
  await typeLine('En cursiva');
  await tool('Cursiva').click();
  await page.getByRole('button', { name: 'Insertar tabla', exact: true }).click();
  await page.getByRole('gridcell', { name: '2 × 2', exact: true }).click();
  await page.keyboard.type('celda');
  await move('Control+End');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), composer().getByRole('button', { name: /Insertar imagen/ }).click()]);
  await chooser.setFiles({ name: 'punto.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
  await page.getByLabel('Texto alternativo de la imagen').fill('Un punto');
  await settle(300);
  const before = await ctl((c) => c.compose.doc);
  await composer().getByRole('button', { name: 'Guardar borrador' }).click();
  await composer().getByRole('button', { name: 'Cerrar', exact: true }).click();
  await composer().waitFor({ state: 'detached' });
  await page.locator('.ml-folders .ml-folder-name', { hasText: 'Borradores' }).click();
  await page.locator('.ml-item', { hasText: 'Borrador rico' }).dblclick();
  await composer().waitFor();
  assert.deepEqual(await ctl((c) => c.compose.doc), before);
  assert.equal(await editor().locator('em', { hasText: 'En cursiva' }).count(), 1);
  assert.equal(await editor().locator('table').count(), 1);
  await editor().locator('img.nw-image').click();
  assert.equal(await field('Texto alternativo de la imagen').inputValue(), 'Un punto');
  await shot('borrador');
  // opening it changed nothing: it closes without a question
  await composer().getByRole('button', { name: 'Cerrar', exact: true }).click();
  await composer().waitFor({ state: 'detached' });
});

await check('lo pegado conserva el formato, sin scripts ni imágenes que se pidan a otro sitio', async () => {
  const asked = [];
  page.on('request', (r) => /tracker\.example/.test(r.url()) && asked.push(r.url()));
  await compose();
  await editor().click();
  await page.evaluate(async () => {
    const html = '<p><b>Pegado</b> <span style="color: rgb(0, 112, 192)">azul</span><img src="https://tracker.example/p.gif"><script>window.__bad = 1</script></p>';
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob(['Pegado azul'], { type: 'text/plain' }) })]);
  });
  await page.keyboard.press('Control+v');
  await page.waitForFunction(() => /Pegado azul/.test(window.__novaMail.ctl.compose.body));
  const h = await html();
  assert.match(h, /<b>Pegado<\/b>/);
  assert.match(h, /color:rgb\(0, 112, 192\)/);
  assert.doesNotMatch(h, /tracker|script/);
  assert.equal(await page.evaluate(() => window.__bad), undefined);
  assert.deepEqual(asked, []);
});

await check('la barra, el original y los cuadros se leen en los cuatro temas', async () => {
  await page.locator('.ml-item', { hasText: 'Informe' }).click();
  await page.getByRole('button', { name: 'Responder', exact: true }).first().click();
  await composer().waitFor();
  for (const theme of ['colorful', 'white', 'darkgray', 'black']) {
    await page.evaluate((t) => window.__novaSettings.set('theme', t), theme);
    await page.waitForFunction((t) => document.querySelector('[data-app]').dataset.theme === t, theme);
    await settle(300);
    assert.deepEqual(await lowContrast(page, ['.ml-composer .ml-format', '.ml-composer .ml-quote header', '.ml-editorbox']), [], theme);
    await shot(`tema-${theme}`);
    await composer().getByRole('button', { name: 'Plantillas…' }).click();
    await settle(700);
    assert.deepEqual(await lowContrast(page, ['.fui-DialogSurface']), [], `plantillas ${theme}`);
    await page.keyboard.press('Escape');
    await page.locator('.fui-DialogSurface').waitFor({ state: 'detached' });
    await composer().getByRole('button', { name: 'Firma', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Firmas…' }).click();
    await page.getByRole('dialog', { name: 'Firmas' }).getByRole('button', { name: 'Nueva firma' }).click();
    await settle(700);
    assert.deepEqual(await lowContrast(page, ['.fui-DialogSurface']), [], `firmas ${theme}`);
    await shot(`firmas-${theme}`);
    await page.getByRole('dialog', { name: 'Firmas' }).getByRole('button', { name: 'Cancelar' }).click();
    await page.locator('.fui-DialogSurface').waitFor({ state: 'detached' });
  }
});

await browser.close();
const failed = results.filter((r) => r[0] !== 'ok').length;
if (questions.length) console.log('Unexpected browser questions:', questions.slice(0, 4));
if (errors.length) console.log('Console errors:', [...new Set(errors)].slice(0, 8));
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed || errors.length || questions.length ? 1 : 0);
