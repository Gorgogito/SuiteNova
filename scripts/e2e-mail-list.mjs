// The list and the folders of Nova Mail (second round, phase 3): order, filter, groups, conversations, selecting
// several, menus, dragging, undo, folders and favourites, printing, headers, attachments and winmail.dat.
// Needs `pnpm dev` on :1420. Usage: node scripts/e2e-mail-list.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lowContrast } from './lib-contrast.mjs';

const JSZip = createRequire(new URL('../apps/suite/package.json', import.meta.url))('jszip');
const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const errors = [];
const questions = [];
let answer = false;
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
const settle = (ms = 200) => page.waitForTimeout(ms);
const shot = (n) => (shotsDir ? page.screenshot({ path: `${shotsDir}/${n}.png` }) : Promise.resolve());
const ev = (fn, arg) => page.evaluate(fn, arg);
const ctl = (fn, arg) => page.evaluate(`(${fn})(window.__novaMail.ctl, ${JSON.stringify(arg ?? null)})`);

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8DwnwEImBigAAAfFwICvkDRvAAAAABJRU5ErkJggg==';
const eml = (subject, { from = 'Ana <ana@x.test>', daysAgo = 0, minutes = 0, id, reply, extra = '', body = `Texto de ${subject}` } = {}) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 30 - minutes, 0, 0);
  return `From: ${from}\r\nTo: yo@x.test\r\nSubject: ${subject}\r\nMessage-ID: <${id ?? subject.replace(/\W/g, '')}@x.test>\r\n${reply ? `In-Reply-To: <${reply}@x.test>\r\n` : ''}Date: ${d.toUTCString()}\r\n${extra}\r\n${body}\r\n`;
};
const WITH_FILES = (() => {
  const le = (n, size) => Array.from({ length: size }, (_, i) => (n >>> (8 * i)) & 0xff);
  const attr = (level, id, data) => [level, ...le(id, 4), ...le(data.length, 4), ...data, 0, 0];
  const text = (s) => [...Buffer.from(s, 'latin1')];
  const tnef = Buffer.from([...le(0x223e9f78, 4), 1, 0, ...attr(2, 0x00069002, Array(14).fill(0)), ...attr(2, 0x00018010, [...text('dentro.txt'), 0]), ...attr(2, 0x0006800f, text('desde winmail'))]);
  const part = (name, type, data) => `--b\r\nContent-Type: ${type}\r\nContent-Disposition: attachment; filename="${name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${data}\r\n`;
  return eml('Con archivos', {
    daysAgo: 40,
    extra: 'MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=b\r\nX-Prueba: cabecera propia\r\n',
    body: `--b\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Van los archivos.</p><img src="https://tracker.example/p.gif">\r\n${part('foto.png', 'image/png', PNG)}${part('foto.png', 'image/png', PNG)}${part('winmail.dat', 'application/ms-tnef', tnef.toString('base64'))}--b--`,
  });
})();

/** Subjects, newest first: two today, one yesterday, an old conversation with an answer that was sent, one with files. */
const MAIL = [
  ['inbox', eml('Presupuesto', { from: 'Carlos <c@x.test>' })],
  ['inbox', eml('Boletín', { from: 'Bea <bea@x.test>', minutes: 5 })],
  ['inbox', eml('Cena', { daysAgo: 1 })],
  ['inbox', eml('Re: Viaje', { daysAgo: 20, id: 'v3', reply: 'v2' })],
  ['sent', eml('Re: Viaje', { from: 'yo@x.test', daysAgo: 21, id: 'v2', reply: 'v1' })],
  ['inbox', eml('Viaje', { daysAgo: 22, id: 'v1' })],
  ['inbox', WITH_FILES],
];
const INBOX = ['Presupuesto', 'Boletín', 'Cena', 'Re: Viaje', 'Viaje', 'Con archivos'];

const fresh = async () => {
  await ctx?.close();
  answer = false;
  ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, colorScheme: 'light', acceptDownloads: true });
  page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on('dialog', (d) => (questions.push(d.message()), (answer ? d.accept() : d.dismiss()).catch(() => {})));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|404|beforeunload|Blocked script|img-src data:/.test(m.text()) && errors.push(m.text()));
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
  await ev((mail) => {
    const c = window.__novaMail.ctl;
    c.batch(() => mail.forEach(([folder, raw]) => c.importRaw(raw, folder, { read: folder !== 'inbox' })));
  }, MAIL);
  questions.length = 0;
  await settle(300);
};

const list = () => page.getByRole('listbox', { name: 'Mensajes' });
const rows = () => page.locator('.ml-item');
const row = (subject) => page.locator('.ml-item', { has: page.locator('.ml-item__subject > span', { hasText: new RegExp(`^${subject}( |$)`) }) }).first();
const subjects = () => rows().evaluateAll((els) => els.map((e) => e.querySelector('.ml-item__subject > span').childNodes[0].textContent));
const groups = () => page.locator('.ml-group button span').allInnerTexts();
const selected = () => ctl((c) => c.selectedRecords.map((m) => m.subject).sort());
const folderOf = (subject) => ctl((c, s) => c.data.messages.filter((m) => m.subject === s).map((m) => m.folder).sort(), subject);
const folder = (name) => page.locator('.ml-folders [role="tree"] .ml-folder-name', { has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) });
const menu = (name) => page.getByRole('menu', { name });
const menuItem = (name) => page.locator('.ml-menu button', { has: page.locator('.ml-menu__label', { hasText: new RegExp(`^\\s*${name}$`) }) }).last();
const tab = (name) => page.getByRole('tab', { name, exact: true }).click();
const command = (id) => page.locator(`[data-nv-item="${id}"]`);
const addFolder = (name, parent) =>
  ctl((c, a) => c.addFolder(a.name, a.parent ? c.data.folders.find((f) => f.name === a.parent).id : null), { name, parent });

await check('grupos por fecha, filtro «No leídos» y orden por columna, que se recuerdan', async () => {
  assert.deepEqual(await subjects(), INBOX);
  const g = await groups();
  assert.equal(g[0], 'Hoy');
  assert.ok(g.length >= 3, g.join(' | '));
  await shot('grupos');
  await page.locator('.ml-group button', { hasText: 'Hoy' }).click();
  assert.equal(await rows().count(), 4);
  await page.locator('.ml-group button', { hasText: 'Hoy' }).click();
  // unread: what is read stays until the filter changes
  await ctl((c) => c.setReadMany(c.data.messages.filter((m) => m.subject === 'Cena').map((m) => m.id), true));
  await page.getByRole('button', { name: 'No leídos', exact: true }).click();
  assert.ok(!(await subjects()).includes('Cena'));
  await row('Boletín').click();
  assert.ok((await subjects()).includes('Boletín'), 'it does not vanish while it is read');
  await page.getByRole('button', { name: 'Todos', exact: true }).click();
  await page.locator('.ml-list__sort').click();
  await menuItem('Ordenar por').click();
  await menuItem('Asunto').click();
  assert.deepEqual(await subjects(), ['Boletín', 'Cena', 'Con archivos', 'Presupuesto', 'Re: Viaje', 'Viaje']);
  await page.locator('.ml-list__sort').click();
  await menuItem('Orden inverso').click();
  assert.equal((await subjects())[0], 'Re: Viaje');
  await tab('Vista');
  await page.getByLabel('Ordenar por').selectOption('from');
  await page.getByLabel('Mostrar', { exact: true }).selectOption('attachments');
  assert.deepEqual(await subjects(), ['Con archivos']);
  answer = true; // the mailbox has changes: leaving the page is accepted
  await page.reload({ timeout: 45000 });
  await page.waitForFunction(() => !!window.__novaMail);
  assert.deepEqual(await ctl((c) => [c.view.sort, c.view.reverse, c.view.filter]), ['from', true, 'attachments']);
});

await check('varios a la vez: Ctrl, Mayús, teclado y Ctrl+A; eliminar y deshacer con Ctrl+Z y con el botón', async () => {
  await row('Presupuesto').click();
  await row('Cena').click({ modifiers: ['Shift'] });
  assert.deepEqual(await selected(), ['Boletín', 'Cena', 'Presupuesto']);
  assert.match(await page.locator('.ml-several').innerText(), /3 mensajes seleccionados/);
  await shot('varios');
  await row('Boletín').click({ modifiers: ['Control'] });
  assert.deepEqual(await selected(), ['Cena', 'Presupuesto']);
  assert.equal(await page.locator('.ml-item[aria-selected="true"]').count(), 2);
  await page.keyboard.press('Delete');
  assert.deepEqual(await folderOf('Cena'), ['trash']);
  assert.deepEqual(await folderOf('Presupuesto'), ['trash']);
  assert.equal(questions.length, 0, 'moving to deleted items does not ask');
  await page.keyboard.press('Control+z');
  assert.deepEqual(await folderOf('Cena'), ['inbox']);
  assert.deepEqual(await selected(), ['Cena', 'Presupuesto']);
  // with the keyboard
  await row('Presupuesto').click();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  assert.equal((await selected()).length, 3);
  await page.keyboard.press('Control+a');
  assert.equal((await selected()).length, 6);
  await page.getByRole('toolbar', { name: 'Acciones de la selección' }).getByRole('button', { name: 'Archivar' }).click();
  assert.equal(await rows().count(), 0);
  await page.locator('[data-nv-item="mail.undo"], [data-nv-qat="mail.undo"]').or(page.getByRole('button', { name: /^Deshacer/ })).first().click();
  assert.equal(await rows().count(), 6);
  // in the search field Ctrl+Z is the typing's own
  await row('Cena').click();
  await page.keyboard.press('Delete');
  await page.getByRole('searchbox', { name: 'Buscar correo' }).fill('zzz');
  await page.keyboard.press('Control+z');
  assert.deepEqual(await folderOf('Cena'), ['trash']);
});

await check('Mayús+Supr elimina para siempre y pregunta; «Cancelar» lo conserva', async () => {
  await row('Cena').click();
  await page.keyboard.press('Shift+Delete');
  assert.match(questions[0], /¿Eliminar para siempre este mensaje\?/);
  assert.deepEqual(await folderOf('Cena'), ['inbox']);
  answer = true;
  await page.keyboard.press('Shift+Delete');
  assert.deepEqual(await folderOf('Cena'), []);
});

await check('menú contextual: acciones, «Mover a», teclado y Escape', async () => {
  await addFolder('Clientes');
  await row('Presupuesto').click();
  await row('Boletín').click({ modifiers: ['Control'] });
  await row('Boletín').click({ button: 'right' });
  const m = menu('Acciones del mensaje');
  await m.waitFor();
  assert.deepEqual(await selected(), ['Boletín', 'Presupuesto'], 'the menu keeps the selection');
  assert.equal(await m.getByRole('menuitem', { name: /^Responder/ }).count(), 0, 'answering is for one message');
  await menuItem('Mover a').click();
  await shot('menu');
  await menuItem('Clientes').click();
  assert.equal((await folderOf('Boletín'))[0].startsWith('f'), true);
  assert.equal((await folderOf('Presupuesto'))[0].startsWith('f'), true);
  // another message: right click selects it
  await row('Cena').click({ button: 'right' });
  assert.deepEqual(await selected(), ['Cena']);
  // the pointer opens a submenu and leaves it: the keyboard stays in the menu
  await menuItem('Mover a').hover();
  await menuItem('Archivar').hover();
  assert.equal(await page.locator('.ml-menu').count(), 1);
  await page.keyboard.press('Escape');
  await m.waitFor({ state: 'detached' });
  assert.equal(await list().evaluate((e) => e === document.activeElement), true, 'the focus goes back to the list');
  await page.keyboard.press('Shift+F10');
  await m.waitFor();
  await page.keyboard.press('End'); // «Deshacer: Mover»
  await page.keyboard.press('Enter');
  assert.deepEqual(await folderOf('Boletín'), ['inbox']);
  assert.deepEqual(await folderOf('Presupuesto'), ['inbox']);
});

await check('arrastrar: mensajes a una carpeta, y carpetas dentro de otra y al nivel superior', async () => {
  await addFolder('Clientes');
  await addFolder('Proyectos');
  await row('Presupuesto').click();
  await row('Boletín').click({ modifiers: ['Control'] });
  await row('Boletín').dragTo(folder('Clientes'));
  assert.equal(await rows().count(), 4);
  await row('Cena').dragTo(folder('Archivo'));
  assert.deepEqual(await folderOf('Cena'), ['archive']);
  await folder('Clientes').dragTo(folder('Proyectos'));
  assert.equal(await ctl((c) => c.data.folders.find((f) => f.id === c.data.folders.find((x) => x.name === 'Clientes').parent)?.name), 'Proyectos');
  // onto the space under the tree: the top level
  const box = await page.locator('.ml-folders').boundingBox();
  await folder('Clientes').dragTo(page.locator('.ml-folders'), { targetPosition: { x: 60, y: box.height - 30 } });
  assert.equal(await ctl((c) => c.data.folders.find((f) => f.name === 'Clientes').parent ?? null), null);
});

await check('carpetas: F2, nombre repetido, carpeta dentro, mover desde la cinta, leído y favoritos', async () => {
  await addFolder('Clientes');
  await addFolder('Viejas');
  await folder('Viejas').click();
  await page.keyboard.press('F2');
  const input = page.getByLabel('Nombre nuevo de la carpeta');
  await input.waitFor();
  await page.keyboard.type('Otra'); // the name was selected: typing replaces it
  assert.equal(await input.inputValue(), 'Otra');
  await page.keyboard.press('Escape');
  await folder('Viejas').click();
  assert.equal(await folder('Otra').count(), 0, 'Escape changes nothing');
  await page.keyboard.press('F2');
  await input.fill('clientes');
  await page.keyboard.press('Enter');
  assert.match(await page.locator('.ml-folder-note').innerText(), /Ya existe una carpeta/);
  await input.fill('Archivadas');
  await page.keyboard.press('Enter');
  await folder('Archivadas').waitFor();
  await folder('Clientes').click({ button: 'right' });
  await menuItem('Carpeta nueva dentro…').click();
  await page.getByLabel('Nombre de la carpeta', { exact: true }).fill('2026');
  await page.keyboard.press('Enter');
  await folder('2026').waitFor();
  await folder('Archivadas').click();
  await tab('Carpeta');
  await page.getByLabel('Mover la carpeta a').selectOption({ label: 'Clientes' });
  assert.equal(await ctl((c) => c.data.folders.find((f) => f.name === 'Archivadas').parent === c.data.folders.find((f) => f.name === 'Clientes').id), true);
  await folder('Bandeja de entrada').click({ button: 'right' });
  await shot('menu-carpeta');
  await menuItem('Marcar todo como leído').click();
  assert.equal(await ctl((c) => c.data.messages.filter((m) => !m.read).length), 0);
  await folder('2026').click();
  await command('mail.folder.favorite').click();
  const favorites = page.getByRole('region', { name: 'Favoritos' });
  assert.deepEqual(await favorites.locator('.ml-folder-name').allInnerTexts(), ['2026']);
  await folder('Bandeja de entrada').click();
  await favorites.locator('.ml-folder-name').click();
  assert.equal(await ctl((c) => c.data.folders.find((f) => f.id === c.folder).name), '2026');
  await shot('favoritos');
});

await check('conversaciones: una fila, se abre con sus mensajes de otras carpetas y se elimina entera la de aquí', async () => {
  await tab('Vista');
  await command('mail.view.conversations').click();
  assert.equal(await rows().count(), 5);
  const head = page.locator('.ml-item.is-thread');
  assert.equal(await head.locator('.ml-item__count').innerText(), '3');
  assert.match(await head.locator('.ml-item__from').innerText(), /Ana.*Yo|Yo.*Ana/);
  await head.click();
  assert.deepEqual(await selected(), ['Re: Viaje', 'Viaje']);
  // the last message is read, and answering is possible
  assert.match(await page.locator('.ml-read h2').innerText(), /Re: Viaje/);
  assert.equal(await page.getByRole('button', { name: 'Responder', exact: true }).first().isEnabled(), true);
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('.ml-item.is-child').count(), 3);
  assert.match(await page.locator('.ml-item.is-child .ml-item__folder').innerText(), /Elementos enviados/);
  await shot('conversacion');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.deepEqual(await selected(), ['Re: Viaje'], 'a message of the conversation alone');
  assert.match(await page.locator('.ml-read').innerText(), /yo@x\.test/);
  await page.keyboard.press('ArrowLeft'); // back to the heading
  await page.keyboard.press('Delete');
  assert.equal(await rows().count(), 4);
  assert.deepEqual(await folderOf('Viaje'), ['trash']);
  assert.deepEqual(await folderOf('Re: Viaje'), ['sent', 'trash']);
});

await check('imprimir, encabezados, winmail.dat y guardar todos los adjuntos', async () => {
  const asked = [];
  // only what would really leave: what the content policy stops never gets to the network
  await page.route('https://tracker.example/**', (r) => (asked.push(r.request().url()), r.abort()));
  await ev(() => {
    new MutationObserver((changes) => {
      for (const c of changes)
        for (const n of c.addedNodes)
          if (n.classList?.contains('ml-print'))
            n.addEventListener('load', () => (n.contentWindow.print = () => (window.__printed = n.contentDocument.body.innerText)));
    }).observe(document.body, { childList: true });
  });
  await row('Con archivos').click();
  const attached = page.getByRole('list', { name: 'Adjuntos' });
  assert.deepEqual((await attached.getByRole('button').allInnerTexts()).map((x) => x.replace(/📎 | \(.*/g, '')), ['foto.png', 'foto.png', 'dentro.txt']);
  await page.keyboard.press('Control+p');
  await page.waitForFunction(() => !!window.__printed);
  const printed = await ev(() => window.__printed);
  assert.match(printed, /Con archivos/);
  assert.match(printed, /De:.*ana@x\.test/s);
  assert.match(printed, /dentro\.txt/);
  assert.match(printed, /Van los archivos/);
  await tab('Datos');
  await command('mail.headers').click();
  const headers = page.getByRole('textbox', { name: 'Encabezados del mensaje' });
  assert.match(await headers.inputValue(), /X-Prueba: cabecera propia/);
  assert.doesNotMatch(await headers.inputValue(), /Van los archivos/);
  await shot('encabezados');
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  const [download] = await Promise.all([page.waitForEvent('download'), command('mail.saveAttachments').click()]);
  assert.equal(download.suggestedFilename(), 'Con archivos.zip');
  const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
  assert.deepEqual(Object.keys(zip.files).sort(), ['dentro.txt', 'foto (2).png', 'foto.png']);
  assert.equal(await zip.file('dentro.txt').async('string'), 'desde winmail');
  assert.deepEqual(asked, [], 'printing does not fetch remote pictures');
});

await check('en una cuenta: renombrar una carpeta en el servidor y deshacer un movimiento ya enviado', async () => {
  await ev(async () => {
    const m = await import('/src/mail/fake-server.ts');
    const f = m.standardServer();
    f.accounts = [m.account()];
    window.__fake = f;
    window.__novaMail.ctl.newDoc();
    window.__novaMail.setTransport(f.transport);
    await window.__novaMail.ctl.loadAccounts();
    await window.__novaMail.ctl.syncAll();
  });
  await folder('Personal').click();
  await page.keyboard.press('F2');
  await page.getByLabel('Nombre nuevo de la carpeta').fill('Familia');
  await page.keyboard.press('Enter');
  await folder('Familia').waitFor();
  await page.waitForFunction(() => !window.__novaMail.ctl.syncing);
  assert.deepEqual(await ev(() => window.__fake.folders.map((f) => f.path).filter((p) => /Personal|Familia/.test(p))), ['Familia']);
  assert.equal(await rows().count(), 1);
  await row('Cena del sábado').click();
  await page.keyboard.press('Delete');
  await page.waitForFunction(() => window.__fake.subjects('Trash').length === 1);
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => window.__fake.subjects('Familia').length === 1 && window.__novaMail.ctl.pendingCount === 0 && !!window.__novaMail.ctl.selected?.remote);
  assert.deepEqual(await ev(() => [window.__fake.subjects('Trash'), window.__fake.subjects('Familia')]), [[], ['Cena del sábado']]);
  assert.equal(await rows().count(), 1);
  // for good, from a server: it asks
  await page.keyboard.press('Shift+Delete');
  assert.match(questions[0], /también del servidor/);
  assert.equal(await rows().count(), 1);
});

await check('con 5 000 mensajes, la lista con grupos y conversaciones sigue ágil', async () => {
  const ms = await ev(() => {
    const c = window.__novaMail.ctl;
    c.batch(() => {
      for (let i = 0; i < 5000; i++) c.importRaw(`From: p${i % 40}@x.test\r\nSubject: ${i % 3 ? 'Re: ' : ''}Tema ${i % 700}\r\nMessage-ID: <n${i}@x>\r\n${i % 3 ? `In-Reply-To: <n${i - 1}@x>\r\n` : ''}Date: ${new Date(Date.now() - i * 3600000).toUTCString()}\r\n\r\nx\r\n`, 'inbox', { read: true });
    });
    const time = (f) => {
      const t = performance.now();
      f();
      c.rows();
      return Math.round(performance.now() - t);
    };
    return { plain: time(() => c.setView({ conversations: false })), threads: time(() => c.setView({ conversations: true })), select: time(() => c.selectRow(c.rows()[3].key)) };
  });
  console.log('      ms:', JSON.stringify(ms));
  assert.ok(Math.max(ms.plain, ms.threads, ms.select) < 600, JSON.stringify(ms));
  assert.ok((await rows().count()) < 40, 'only what is seen is drawn');
  await list().evaluate((e) => (e.scrollTop = e.scrollHeight));
  await settle(300);
  assert.ok((await rows().count()) > 3);
});

await check('la lista, los menús y las carpetas se leen en los cuatro temas', async () => {
  await addFolder('Clientes');
  await ctl((c) => {
    c.toggleFavorite('inbox');
    c.setView({ conversations: true });
  });
  await page.locator('.ml-item.is-thread .ml-item__caret').click();
  await page.locator('.ml-item.is-thread').click();
  for (const theme of ['colorful', 'white', 'darkgray', 'black']) {
    await ev((t) => window.__novaSettings.set('theme', t), theme);
    await page.waitForFunction((t) => document.querySelector('[data-app]').dataset.theme === t, theme);
    await settle(300);
    assert.deepEqual(await lowContrast(page, ['.ml-folders', '.ml-list', '.ml-mail__pane > .ml-several']), [], theme);
    await page.locator('.ml-item', { hasText: 'Cena' }).click({ button: 'right' });
    await menuItem('Mover a').click();
    await settle();
    assert.deepEqual(await lowContrast(page, ['.ml-menu']), [], `menú ${theme}`);
    await shot(`tema-${theme}`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('.ml-menu').waitFor({ state: 'detached' });
    await page.locator('.ml-item.is-thread').click();
  }
});

await browser.close();
const failed = results.filter((r) => r[0] !== 'ok').length;
if (errors.length) console.log('Console errors:', [...new Set(errors)].slice(0, 8));
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed || errors.length ? 1 : 0);
