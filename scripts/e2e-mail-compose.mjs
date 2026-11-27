// Writing in Nova Mail (second round, phase 1): the message in the reading pane, drafts saved on their own, closing without
// losing anything, recipient suggestions, files dropped or pasted, the large window and the account a reply leaves from.
// Needs `pnpm dev` on :1420. Usage: node scripts/e2e-mail-compose.mjs [--shots dir]
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
const eml = (from, to, subject, extra = []) => [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, `Message-ID: <${subject.replace(/\W/g, '')}@x.test>`, 'Date: Mon, 23 Nov 2026 10:00:00 +0000', ...extra, '', 'Hola, ¿qué tal?', ''].join('\r\n');

/** A clean window with two received messages and a contact. */
const fresh = async () => {
  await ctx?.close();
  ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, colorScheme: 'light' });
  page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on('dialog', (d) => (questions.push(d.message()), d.dismiss().catch(() => {})));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|404|beforeunload/.test(m.text()) && errors.push(m.text()));
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
  await page.evaluate(
    ([a, b]) => {
      const c = window.__novaMail.ctl;
      c.importRaw(a, 'inbox');
      c.importRaw(b, 'inbox');
      const contact = c.addContact();
      c.updateContact({ ...contact, name: 'Marta Ruiz', emails: [{ label: '', value: 'marta@x.test' }] });
      c.go('mail');
    },
    [eml('Ana López <ana@x.test>', 'yo@x.test, luis@x.test', 'Reunion', ['Delivered-To: yo@x.test']), eml('Mario Gil <mario@x.test>', 'yo@x.test', 'Facturas')],
  );
  await settle(400);
};

const composer = () => page.getByRole('region', { name: 'Mensaje que escribes' });
const question = () => page.getByRole('alertdialog');
const field = (name) => page.getByLabel(name, { exact: true });
const body = () => page.getByLabel('Cuerpo del mensaje');
const row = (subject) => page.locator('.ml-item', { hasText: subject }).first();
const compose = async () => {
  await page.keyboard.press('Control+Shift+M');
  await composer().waitFor();
};
const ctl = (fn, arg) => page.evaluate(`(${fn})(window.__novaMail.ctl, ${JSON.stringify(arg ?? null)})`);
const drafts = () => ctl((c) => c.data.messages.filter((m) => m.folder === 'drafts').map((m) => m.subject));
const close = () => composer().getByRole('button', { name: 'Cerrar', exact: true }).click();

await check('el mensaje se escribe en el panel de lectura, sin cuadro que tape el correo', async () => {
  await row('Reunion').click();
  await compose();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await field('Para').evaluate((e) => e === document.activeElement), true);
  await row('Facturas').waitFor();
  await shot('panel');
  // sin nada escrito, Esc lo cierra sin preguntar y vuelve el mensaje
  await page.keyboard.press('Escape');
  await composer().waitFor({ state: 'detached' });
  assert.equal(await question().count(), 0);
  assert.deepEqual(await drafts(), []);
  await page.locator('.ml-read h2', { hasText: 'Reunion' }).waitFor();
});

await check('con algo escrito, Esc y «Cerrar» preguntan: seguir, descartar o guardar', async () => {
  await compose();
  await field('Asunto').fill('Importante');
  await body().fill('Un texto que no quiero perder.');
  await page.keyboard.press('Escape');
  await question().waitFor();
  assert.match(await question().innerText(), /¿Guardar el mensaje\?/);
  await shot('pregunta');
  await question().getByRole('button', { name: 'Seguir escribiendo' }).click();
  await question().waitFor({ state: 'detached' });
  assert.equal(await body().inputValue(), 'Un texto que no quiero perder.');
  await close();
  await question().getByRole('button', { name: 'Guardar en Borradores' }).click();
  await composer().waitFor({ state: 'detached' });
  assert.deepEqual(await drafts(), ['Importante']);
  await compose();
  await body().fill('Esto sí lo tiro.');
  await close();
  await question().getByRole('button', { name: 'Descartar' }).click();
  await composer().waitFor({ state: 'detached' });
  assert.deepEqual(await drafts(), ['Importante']);
});

await check('el borrador se guarda solo, y al pasar a otro mensaje no se pierde y se avisa', async () => {
  await compose();
  await field('Asunto').fill('A medias');
  await page.waitForFunction(() => window.__novaMail.ctl.data.messages.some((m) => m.folder === 'drafts' && m.subject === 'A medias'), null, { timeout: 8000 });
  await body().fill('Más texto');
  await row('Facturas').click();
  await composer().waitFor({ state: 'detached' });
  assert.equal(await question().count(), 0);
  assert.deepEqual(await drafts(), ['A medias']);
  assert.match(await page.getByTestId('compose-status').innerText(), /se guardó en Borradores/);
  await page.locator('.ml-folders .ml-folder-name', { hasText: 'Borradores' }).click();
  await row('A medias').dblclick();
  await composer().waitFor();
  assert.equal(await body().inputValue(), 'Más texto');
  await close();
  await composer().waitFor({ state: 'detached' });
  assert.deepEqual(await drafts(), ['A medias']);
});

await check('Para, Cc y Cco sugieren contactos y personas del correo, con el teclado y con el ratón', async () => {
  await compose();
  const list = page.getByRole('listbox', { name: 'Sugerencias de destinatarios' });
  await field('Para').pressSequentially('mar');
  await list.waitFor();
  assert.deepEqual((await list.getByRole('option').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim()), ['Marta Ruiz marta@x.test', 'Mario Gil mario@x.test']);
  await shot('sugerencias');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await field('Para').inputValue(), 'Mario Gil <mario@x.test>, ');
  await field('Para').pressSequentially('mar');
  // ya elegido, Mario no vuelve a salir
  assert.equal(await list.getByRole('option').count(), 1);
  await page.keyboard.press('Tab');
  assert.equal(await field('Para').inputValue(), 'Mario Gil <mario@x.test>, Marta Ruiz <marta@x.test>, ');
  await field('Cc').pressSequentially('lopez');
  await list.getByRole('option').first().click();
  assert.equal(await field('Cc').inputValue(), 'Ana López <ana@x.test>, ');
  // Esc cierra la lista, no el mensaje
  await field('Cco').pressSequentially('an');
  await list.waitFor();
  await page.keyboard.press('Escape');
  await list.waitFor({ state: 'detached' });
  assert.equal(await composer().count(), 1);
  assert.equal(await question().count(), 0);
});

await check('responder a todos no me incluye, y Ctrl+F mientras escribo no abre un reenvío', async () => {
  await row('Reunion').click();
  await page.getByRole('button', { name: 'Responder a todos' }).first().click();
  await composer().waitFor();
  assert.equal(await field('Para').inputValue(), 'ana@x.test, luis@x.test');
  // el cursor, encima de lo citado
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Cuerpo del mensaje' && document.activeElement.selectionStart === 0);
  await page.keyboard.type('De acuerdo.');
  await page.keyboard.press('Control+f');
  await settle();
  assert.equal(await field('Asunto').inputValue(), 'Re: Reunion');
  assert.equal(await ctl((c) => c.data.messages.find((m) => m.subject === 'Reunion').answered), false);
  await shot('respuesta');
});

/** A drag or a paste carrying files, as the system would send it. */
const sendFiles = (selector, type, files) =>
  page.evaluate(
    ([sel, kind, list]) => {
      const data = new DataTransfer();
      for (const f of list) data.items.add(new File([Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
      const el = document.querySelector(sel);
      if (kind === 'paste') return !el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      for (const name of ['dragenter', 'dragover', 'drop']) {
        const e = new DragEvent(name, { dataTransfer: data, bubbles: true, cancelable: true });
        el.dispatchEvent(e);
        if (name === 'drop') return e.defaultPrevented;
      }
      return false;
    },
    [selector, type, files],
  );
const TEXT = { name: 'informe.txt', type: 'text/plain', base64: Buffer.from('cifras').toString('base64') };
const PNG = { name: 'foto.png', type: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8DwnwEImBigAAAfFwICvkDRvAAAAABJRU5ErkJggg==' };

await check('arrastrar y pegar adjunta; una imagen sobre el texto se inserta en él; fuera del mensaje no pasa nada', async () => {
  await compose();
  assert.equal(await sendFiles('.ml-compose__att', 'drop', [TEXT]), true);
  await composer().locator('.ml-chip', { hasText: 'informe.txt' }).waitFor();
  await sendFiles('textarea[aria-label="Cuerpo del mensaje"]', 'drop', [PNG]);
  await page.waitForFunction(() => /\[Imagen: foto\.png\]/.test(document.querySelector('textarea[aria-label="Cuerpo del mensaje"]').value));
  assert.equal(await sendFiles('.ml-composer__head', 'drop', [{ ...PNG, name: 'otra.png' }]), true);
  await composer().locator('.ml-chip', { hasText: 'otra.png' }).waitFor();
  await sendFiles('textarea[aria-label="Cuerpo del mensaje"]', 'paste', [{ ...TEXT, name: 'pegado.txt' }]);
  await composer().locator('.ml-chip', { hasText: 'pegado.txt' }).waitFor();
  await shot('adjuntos');
  // en la lista de mensajes se rechaza, y la ventana sigue siendo la de correo
  assert.equal(await sendFiles('.ml-list__scroll', 'drop', [TEXT]), true);
  assert.equal(await composer().locator('.ml-chip', { hasText: '.txt' }).count(), 2);
  // lo adjuntado queda en el borrador
  await composer().getByRole('button', { name: 'Guardar borrador' }).click();
  const kept = await ctl((c) => c.compose.attachments.map((a) => a.filename));
  assert.deepEqual(kept, ['informe.txt', 'otra.png', 'pegado.txt']);
});

await check('«Abrir en grande» y volver al panel conservan lo escrito; sin panel de lectura se escribe en grande', async () => {
  await compose();
  await body().fill('Lo mismo en los dos sitios');
  await composer().getByRole('button', { name: 'Abrir en grande' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mensaje nuevo' });
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel('Cuerpo del mensaje').inputValue(), 'Lo mismo en los dos sitios');
  await dialog.getByLabel('Asunto').fill('Grande');
  await shot('en-grande');
  await page.keyboard.press('Escape');
  await question().getByRole('button', { name: 'Seguir escribiendo' }).click();
  await dialog.getByRole('button', { name: 'Volver al panel de lectura' }).click();
  await composer().waitFor();
  assert.equal(await field('Asunto').inputValue(), 'Grande');
  await close();
  await question().getByRole('button', { name: 'Descartar' }).click();
  await ctl((c) => ((c.showReadingPane = false), c.touch()));
  await page.keyboard.press('Control+Shift+M');
  await page.getByRole('dialog', { name: 'Mensaje nuevo' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Volver al panel de lectura' }).count(), 0);
});

await check('escribir a un contacto abre el mensaje sobre Contactos, sin cambiar de sección', async () => {
  await page.keyboard.press('Control+3');
  await page.getByRole('option', { name: /Marta Ruiz/ }).click();
  await page.getByRole('button', { name: 'Nuevo correo', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Mensaje nuevo' });
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel('Para', { exact: true }).inputValue(), 'marta@x.test');
  assert.equal(await ctl((c) => c.section), 'contacts');
});

await check('con dos cuentas, la respuesta sale de la que recibió el correo; Ctrl+Intro envía y marca el original', async () => {
  await page.evaluate(async () => {
    window.__sent = [];
    const acc = (id, name, email) => ({ id, name, email, protocol: 'imap', auth: 'password', imap: { host: 'imap.x.test', port: 993, security: 'tls' }, smtp: { host: 'smtp.x.test', port: 465, security: 'tls' } });
    window.__novaMail.setTransport(async (cmd, args = {}) => {
      if (cmd === 'mail_accounts') return [acc('a1', 'Trabajo', 'trabajo@x.test'), acc('a2', 'Casa', 'yo@x.test')];
      if (cmd === 'mail_send') return void window.__sent.push(args);
      return [];
    });
    await window.__novaMail.ctl.loadAccounts();
  });
  await row('Reunion').click();
  await page.getByRole('button', { name: 'Responder', exact: true }).first().click();
  await composer().waitFor();
  assert.equal(await field('Desde').inputValue(), 'a2');
  await page.keyboard.type('Allí estaré.');
  await page.keyboard.press('Control+Enter');
  await composer().waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.__sent.length), 1);
  assert.equal(await page.evaluate(() => window.__sent[0].id), 'a2');
  assert.equal(await ctl((c) => c.data.messages.find((m) => m.subject === 'Reunion').answered), true);
  assert.deepEqual(await drafts(), []);
});

await check('el editor, las sugerencias y la pregunta se leen en los cuatro temas', async () => {
  await compose();
  await field('Asunto').fill('Colores');
  await field('Para').pressSequentially('mar');
  for (const theme of ['colorful', 'white', 'darkgray', 'black']) {
    await page.evaluate((t) => window.__novaSettings.set('theme', t), theme);
    await page.waitForFunction((t) => document.querySelector('[data-app]').dataset.theme === t, theme);
    await field('Para').focus();
    await field('Para').fill('');
    await field('Para').pressSequentially('mar');
    await settle(300);
    assert.deepEqual(await lowContrast(page, ['.ml-composer', '.ml-recip ul']), [], theme);
    await shot(`tema-${theme}`);
    await page.keyboard.press('Escape');
    await close();
    await question().waitFor();
    await settle(700); // past the fade of the dialog
    assert.deepEqual(await lowContrast(page, ['.fui-DialogSurface']), [], `pregunta ${theme}`);
    await question().getByRole('button', { name: 'Seguir escribiendo' }).click();
    await question().waitFor({ state: 'detached' });
  }
});

await browser.close();
const failed = results.filter((r) => r[0] !== 'ok').length;
if (questions.length) console.log('Unexpected browser questions:', questions.slice(0, 4));
if (errors.length) console.log('Console errors:', [...new Set(errors)].slice(0, 8));
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed || errors.length || questions.length ? 1 : 0);
