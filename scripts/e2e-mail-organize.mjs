// Organising in Nova Mail (second round, phase 4): colour categories, follow-up with dates and reminders, rules, quick
// steps, search by fields, search folders and blocked and safe senders.
// Needs `pnpm dev` on :1420. Usage: node scripts/e2e-mail-organize.mjs [--shots dir]
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
let answer = true;
let ctx;
let page;
let width = 1600;

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

const eml = (subject, { from = 'Ana <ana@x.test>', daysAgo = 0, minutes = 0, extra = '', body = `Texto de ${subject}` } = {}) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 30 - minutes, 0, 0);
  return `From: ${from}\r\nTo: yo@x.test\r\nSubject: ${subject}\r\nMessage-ID: <${subject.replace(/\W/g, '')}@x.test>\r\nDate: ${d.toUTCString()}\r\n${extra}\r\n${body}\r\n`;
};
const MAIL = [
  ['inbox', eml('Presupuesto', { from: 'Carlos <c@x.test>' })],
  ['inbox', eml('Boletín', { from: 'Ofertas <ofertas@tienda.test>', minutes: 5, extra: 'MIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n', body: '<p>Rebajas</p><img src="https://pictures.example/oferta.png">' })],
  ['inbox', eml('Factura 7', { daysAgo: 1 })],
  ['inbox', eml('Cena', { daysAgo: 2 })],
  ['archive', eml('Factura 6', { daysAgo: 40 })],
];

const fresh = async () => {
  await ctx?.close();
  answer = true;
  ctx = await browser.newContext({ viewport: { width, height: 950 }, colorScheme: 'light' });
  page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on('dialog', (d) => (questions.push(d.message()), (answer ? d.accept() : d.dismiss()).catch(() => {})));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|404|beforeunload|Blocked script|img-src data:|ERR_FAILED/.test(m.text()) && errors.push(m.text()));
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
    c.setOwner({ name: 'Yo', email: 'yo@x.test' });
    c.batch(() => mail.forEach(([folder, raw]) => c.importRaw(raw, folder, { read: folder !== 'inbox' })));
  }, MAIL);
  questions.length = 0;
  await settle(300);
};

const list = () => page.getByRole('listbox', { name: 'Mensajes' });
const rows = () => page.locator('.ml-item');
const row = (subject) => page.locator('.ml-item', { has: page.locator('.ml-item__subject > span', { hasText: new RegExp(`^${subject}( |$)`) }) }).first();
const subjects = () => rows().evaluateAll((els) => els.map((e) => e.querySelector('.ml-item__subject > span').childNodes[0].textContent));
const of = (subject) => ctl((c, s) => {
  const m = c.data.messages.find((x) => x.subject === s);
  return m && { folder: m.folder, read: m.read, flagged: m.flagged, categories: m.categories ?? [], due: m.follow?.due ?? null, done: m.follow?.done ?? null };
}, subject);
const folder = (name) => page.locator('.ml-folders .ml-folder-name', { has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) }).first();
const menuItem = (name) => page.locator('.ml-menu button', { has: page.locator('.ml-menu__label', { hasText: new RegExp(`^\\s*${name}$`) }) }).last();
const tab = (name) => page.getByRole('tab', { name, exact: true }).click();
const command = (id) => page.locator(`[data-nv-item="${id}"]`);
/** A button of the ribbon, also when its group is folded because the window is narrow. */
const ribbon = async (id, group) => {
  const direct = command(id);
  if (await direct.count()) return direct;
  await page.locator(`[data-nv-item="group:${group}"]`).click();
  return command(id);
};
/** Opens one of the menus of the ribbon, and checks it is where its button is. */
const menuOf = async (item, group, name) => {
  const button = (await ribbon(item, group)).getByRole('button', { name });
  const from = await button.boundingBox();
  await button.click();
  const menu = page.getByRole('menu', { name });
  const at = await menu.boundingBox();
  const size = page.viewportSize();
  assert.ok(at.x >= 0 && at.x + at.width <= size.width && Math.abs(at.y - (from.y + from.height)) < 30 /* a folded group slides in */, `menu ${name} at ${JSON.stringify(at)}, button ${JSON.stringify(from)}`);
};
const rulesDialog = async () => {
  await menuOf('moveSel', 'move', 'Reglas');
  await menuItem('Administrar y ejecutar reglas…').click();
};
const dialog = () => page.getByRole('dialog');
const closeDialog = async (name = 'Cerrar') => {
  await dialog().getByRole('button', { name, exact: true }).click();
  await dialog().waitFor({ state: 'detached' });
};
const search = () => page.getByRole('searchbox', { name: 'Buscar correo' });
const today = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

await check('categorías: desde el menú del mensaje, en la lista y al leer; administrarlas y deshacer', async () => {
  await row('Presupuesto').click();
  await row('Cena').click({ modifiers: ['Control'] });
  await row('Cena').click({ button: 'right' });
  await menuItem('Categorizar').hover();
  await menuItem('Categoría azul').click();
  assert.deepEqual((await of('Presupuesto')).categories, ['Categoría azul']);
  assert.deepEqual((await of('Cena')).categories, ['Categoría azul']);
  assert.equal(await row('Cena').locator('.ml-cat').innerText(), 'Categoría azul');
  await row('Cena').click();
  await menuOf('tagMenus', 'tags', 'Categorizar');
  await shot('menu-categorias');
  await menuItem('Categoría roja').click();
  assert.deepEqual((await of('Cena')).categories, ['Categoría azul', 'Categoría roja']);
  assert.equal(await page.locator('.ml-read .ml-cat').count(), 2);
  await menuOf('tagMenus', 'tags', 'Categorizar');
  await menuItem('Administrar categorías…').click();
  await dialog().getByLabel('Categoría nueva', { exact: true }).fill('Familia');
  await dialog().getByLabel('Color de la categoría nueva').selectOption('pink');
  await dialog().getByRole('button', { name: 'Agregar' }).click();
  await dialog().getByLabel('Categoría nueva', { exact: true }).fill('familia');
  await dialog().getByRole('button', { name: 'Agregar' }).click();
  assert.match(await dialog().getByRole('alert').innerText(), /Ya existe/);
  const name = dialog().getByLabel('Nombre de la categoría Categoría azul');
  await name.fill('Trabajo');
  await name.press('Enter');
  assert.deepEqual((await of('Presupuesto')).categories, ['Trabajo']);
  await shot('categorias');
  await dialog().getByRole('button', { name: 'Eliminar la categoría Categoría roja' }).click();
  assert.match(questions.at(-1), /Se quitará de todos/);
  assert.deepEqual((await of('Cena')).categories, ['Trabajo']);
  await closeDialog();
  await row('Cena').click({ button: 'right' });
  await menuItem('Categorizar').hover();
  await menuItem('Familia').click();
  assert.deepEqual((await of('Cena')).categories, ['Trabajo', 'Familia']);
  await page.keyboard.press('Control+z');
  assert.deepEqual((await of('Cena')).categories, ['Trabajo']);
  await tab('Vista');
  await page.getByLabel('Ordenar por').selectOption('category');
  assert.deepEqual((await page.locator('.ml-group button span').allInnerTexts()), ['Trabajo', 'Sin categoría']);
  await page.getByLabel('Ordenar por').selectOption('date');
});

await check('seguimiento: bandera, fechas, completar, grupos y la lista de tareas', async () => {
  await row('Presupuesto').getByRole('button', { name: 'Marcar con bandera' }).click();
  assert.equal((await of('Presupuesto')).flagged, true);
  await row('Presupuesto').getByRole('button', { name: 'Marcar como completado' }).click();
  assert.ok((await of('Presupuesto')).done);
  assert.equal(await row('Presupuesto').locator('.ml-flag').innerText(), '✓');
  await row('Cena').click({ button: 'right' });
  await menuItem('Seguimiento').hover();
  await menuItem('Mañana').click();
  assert.equal((await of('Cena')).due, today() + 86400000);
  assert.match(await page.locator('.ml-follow').innerText(), /vence el/);
  await row('Factura 7').click();
  await menuOf('tagMenus', 'tags', 'Seguimiento');
  await menuItem('Fecha y aviso…').click();
  await dialog().getByLabel('Vence el').fill('2020-01-15');
  await dialog().getByRole('checkbox', { name: 'Avisarme' }).check();
  await dialog().getByLabel('Cuándo avisar').fill('2020-01-14T09:00');
  await shot('fecha-aviso');
  await closeDialog('Aceptar');
  // the reminder, of a date that has passed, appears at once; it can open the message or be dismissed for good
  const toast = page.getByRole('region', { name: 'Recordatorios' });
  await toast.waitFor();
  assert.match(await toast.innerText(), /Factura 7/);
  assert.match(await row('Factura 7').locator('.ml-flag').getAttribute('class'), /is-late/);
  await shot('aviso');
  await folder('Archivo').click();
  await toast.getByRole('button', { name: 'Abrir' }).click();
  assert.match(await page.locator('.ml-read h2').innerText(), /Factura 7/);
  await toast.getByRole('button', { name: 'Descartar' }).click();
  await toast.waitFor({ state: 'detached' });
  await tab('Vista');
  await page.getByLabel('Ordenar por').selectOption('flag');
  assert.deepEqual(await page.locator('.ml-group button span').allInnerTexts(), ['Vencidos', 'Mañana', 'Completados', 'Sin bandera']);
  await shot('por-bandera');
  await page.getByLabel('Ordenar por').selectOption('date');
  await tab('Inicio');
  await (await ribbon('mail.go.tasks', 'sections')).click();
  const tasks = page.getByRole('list', { name: 'Tareas' });
  await tasks.waitFor();
  assert.deepEqual(await tasks.locator('strong').allInnerTexts(), ['✉ Factura 7', '✉ Cena']);
  await tasks.getByRole('button', { name: /Cena/ }).click();
  await page.getByRole('region', { name: 'Mensaje con seguimiento' }).getByLabel('Fecha de vencimiento').fill('2030-05-01');
  assert.equal((await of('Cena')).due, new Date(2030, 4, 1).getTime());
  await shot('tareas');
  await tasks.getByRole('checkbox', { name: 'Completar Factura 7' }).click(); // completed, it leaves the pending ones
  assert.ok((await of('Factura 7')).done);
  await page.getByRole('group', { name: 'Filtro de tareas' }).getByRole('button', { name: 'Completadas' }).click();
  assert.equal(await tasks.locator('li').count(), 2);
  await page.getByRole('group', { name: 'Filtro de tareas' }).getByRole('button', { name: 'Pendientes' }).click();
  await tasks.getByRole('button', { name: /Cena/ }).click();
  await page.getByRole('button', { name: 'Abrir el mensaje' }).click();
  assert.match(await page.locator('.ml-read h2').innerText(), /Cena/);
});

await check('categorías en citas, contactos y tareas', async () => {
  await ctl((c) => c.go('calendar'));
  await page.keyboard.press('Control+Shift+A');
  await dialog().getByLabel('Título').fill('Revisión');
  await dialog().getByRole('checkbox', { name: 'Categoría verde' }).check();
  await closeDialog('Guardar');
  assert.deepEqual(await ctl((c) => c.data.events[0].categories), ['Categoría verde']);
  assert.match(await page.locator('.ml-ev', { hasText: 'Revisión' }).getAttribute('style'), /inset/);
  await shot('cita');
  await page.keyboard.press('Control+Shift+C');
  await page.getByLabel('Nombre', { exact: true }).fill('Marta');
  await page.getByRole('checkbox', { name: 'Categoría roja' }).check();
  await page.getByRole('button', { name: 'Guardar contacto' }).click();
  assert.deepEqual(await ctl((c) => c.data.contacts[0].categories), ['Categoría roja']);
  assert.equal(await page.getByRole('listbox', { name: 'Contactos' }).locator('.ml-cat').count(), 1);
});

await check('reglas: crear desde un mensaje, editar, ejecutar y deshacer', async () => {
  await ctl((c) => c.addFolder('Facturas'));
  await row('Factura 7').click({ button: 'right' });
  await menuItem('Reglas').hover();
  await menuItem('Crear una regla con este mensaje…').click();
  assert.equal(await dialog().getByLabel('Cuando se cumple todo esto: valor 1').inputValue(), 'ana@x.test');
  await dialog().getByLabel('Nombre de la regla').fill('Facturas');
  await dialog().getByRole('button', { name: '+ Agregar condición' }).click();
  await dialog().getByLabel('Cuando se cumple todo esto: condición 2').selectOption('subject');
  await dialog().getByRole('button', { name: 'Guardar regla' }).click();
  assert.match(await dialog().getByRole('alert').innerText(), /sin palabras/);
  await dialog().getByLabel('Cuando se cumple todo esto: valor 2').fill('factura; recibo');
  await dialog().getByLabel('Valor de la acción 1').selectOption({ label: 'Facturas' });
  await dialog().getByRole('button', { name: '+ Agregar acción' }).click();
  await dialog().getByLabel('Acción 2', { exact: true }).selectOption('category');
  await dialog().getByLabel('Valor de la acción 2').selectOption('Categoría verde');
  await dialog().getByRole('button', { name: '+ Agregar excepción' }).click();
  await dialog().getByLabel('Excepto si se cumple algo de esto: condición 1').selectOption('hasAttachments');
  await shot('regla');
  await dialog().getByRole('button', { name: 'Guardar regla' }).click();
  await dialog().getByRole('list', { name: 'Reglas' }).waitFor();
  assert.deepEqual(await ctl((c) => c.data.rules.map((r) => [r.name, r.enabled, r.conditions.length, r.actions.length, r.exceptions.length])), [['Facturas', true, 2, 2, 1]]);
  await dialog().getByRole('button', { name: 'Ejecutar' }).click();
  assert.match(await dialog().getByRole('status').innerText(), /a 1 mensaje/);
  await shot('reglas');
  await closeDialog();
  assert.ok(!(await subjects()).includes('Factura 7'));
  assert.deepEqual((await of('Factura 7')).categories, ['Categoría verde']);
  assert.equal((await of('Factura 6')).folder, 'archive', 'only the chosen folder');
  await list().focus();
  await page.keyboard.press('Control+z');
  assert.equal((await of('Factura 7')).folder, 'inbox');
  assert.deepEqual((await of('Factura 7')).categories, []);
  await rulesDialog();
  await dialog().getByRole('checkbox', { name: 'Activar Facturas' }).uncheck();
  assert.equal(await dialog().getByRole('button', { name: 'Ejecutar' }).isDisabled(), true);
  await dialog().getByRole('button', { name: 'Eliminar Facturas' }).click();
  assert.equal(await ctl((c) => c.data.rules?.length ?? 0), 0);
  await closeDialog();
});

await check('pasos rápidos: «Listo», el teclado, uno propio y su orden', async () => {
  await row('Cena').click();
  await row('Cena').getByRole('button', { name: 'Marcar con bandera' }).click();
  await list().focus();
  await page.keyboard.press('Control+Shift+Digit1');
  let m = await of('Cena');
  assert.deepEqual([m.folder, m.read, m.flagged, !!m.done], ['archive', true, false, true]);
  await page.keyboard.press('Control+z');
  m = await of('Cena');
  assert.deepEqual([m.folder, m.flagged, m.done], ['inbox', true, null]);
  await row('Presupuesto').click();
  await menuOf('tagMenus', 'tags', 'Pasos rápidos');
  await shot('menu-pasos');
  await menuItem('Administrar pasos rápidos…').click();
  await dialog().getByRole('button', { name: 'Paso rápido nuevo…' }).click();
  await dialog().getByLabel('Nombre del paso rápido').fill('Avisar a la jefa');
  await dialog().getByLabel('Acción 1', { exact: true }).selectOption('forward');
  await dialog().getByLabel('Valor de la acción 1').fill('jefa@x.test');
  await dialog().getByRole('button', { name: '+ Agregar acción' }).click();
  await dialog().getByLabel('Acción 2', { exact: true }).selectOption('category');
  await shot('paso');
  await dialog().getByRole('button', { name: 'Guardar paso' }).click();
  await dialog().getByRole('button', { name: 'Subir Avisar a la jefa' }).click();
  await dialog().getByRole('button', { name: 'Subir Avisar a la jefa' }).click();
  await closeDialog();
  assert.deepEqual(await ctl((c) => c.data.quickSteps.map((s) => s.name)), ['Avisar a la jefa', 'Listo', 'Responder y eliminar']);
  await row('Presupuesto').click({ button: 'right' });
  await menuItem('Pasos rápidos').hover();
  await menuItem('Avisar a la jefa').click();
  await page.locator('.ml-mail__pane').getByLabel('Para', { exact: true }).waitFor();
  assert.deepEqual(await ctl((c) => [c.compose.to, c.compose.subject]), ['jefa@x.test', 'Fwd: Presupuesto']);
  assert.deepEqual((await of('Presupuesto')).categories, ['Categoría azul']);
});

await check('búsqueda por campos, errores, búsqueda avanzada y carpetas de búsqueda', async () => {
  await search().fill('de:ana asunto:factura');
  assert.deepEqual(await subjects(), ['Factura 7']);
  await search().fill('* asunto:factura');
  assert.deepEqual(await subjects(), ['Factura 7', 'Factura 6']);
  assert.equal(await rows().locator('.ml-item__folder').count(), 2, 'each row says where it is');
  await search().fill('fecha:quizá');
  assert.match(await page.locator('.ml-searcherror').innerText(), /fecha:quizá/);
  assert.equal(await rows().count(), 0);
  await search().fill('rebajas -cena');
  assert.deepEqual(await subjects(), ['Boletín']);
  await search().press('Escape');
  assert.equal(await rows().count(), 4);
  await page.getByRole('button', { name: 'Más…' }).click();
  await dialog().getByLabel('Asunto', { exact: true }).fill('factura');
  await dialog().getByRole('checkbox', { name: 'En todas las carpetas' }).check();
  assert.equal(await dialog().getByTestId('built-query').innerText(), 'asunto:factura');
  await shot('busqueda-avanzada');
  await dialog().getByRole('button', { name: 'Buscar', exact: true }).click();
  assert.equal(await search().inputValue(), '* asunto:factura');
  await page.getByRole('button', { name: 'Guardar búsqueda' }).click();
  await dialog().getByLabel('Nombre de la carpeta de búsqueda').fill('Facturas');
  await closeDialog('Aceptar');
  await folder('Facturas').waitFor();
  assert.deepEqual(await subjects(), ['Factura 7', 'Factura 6']);
  assert.equal(await page.locator('.ml-list__head strong').innerText(), 'Facturas');
  // commands of a real folder wait
  await tab('Carpeta');
  assert.equal(await command('mail.folder.rename').isDisabled(), true);
  assert.equal(await command('mail.folder.favorite').isDisabled(), true);
  await tab('Inicio');
  await shot('carpeta-busqueda');
  // the unread one keeps in sight while it is read
  await folder('Correo no leído').click();
  assert.equal(await rows().count(), 4);
  await row('Cena').click();
  assert.equal(await rows().count(), 4);
  await folder('Facturas').click({ button: 'right' });
  await menuItem('Editar la búsqueda…').click();
  await dialog().getByLabel('Qué buscar').fill('asunto:cena');
  await closeDialog('Aceptar');
  assert.deepEqual(await subjects(), ['Cena']);
  await folder('Facturas').click({ button: 'right' });
  await menuItem('Quitar la carpeta de búsqueda').click();
  assert.equal(await folder('Facturas').count(), 0);
  await page.getByRole('region', { name: 'Carpetas de búsqueda' }).getByRole('button', { name: 'Carpeta de búsqueda nueva…' }).click();
  await dialog().getByLabel('Plantilla').selectOption({ label: 'Correo grande' });
  await closeDialog('Aceptar');
  assert.equal(await rows().count(), 0);
  assert.match(await list().innerText(), /No hay mensajes que cumplan/);
});

await check('remitentes: bloquear, no es correo no deseado, imágenes de un seguro y las listas', async () => {
  const asked = [];
  await page.route('https://pictures.example/**', (r) => (asked.push(r.request().url()), r.abort()));
  await row('Boletín').click();
  await page.getByText('Se bloqueó el contenido externo').waitFor();
  await menuOf('moveSel', 'move', 'Remitente');
  await menuItem('Bloquear remitente').click();
  assert.equal((await of('Boletín')).folder, 'junk');
  await folder('Correo no deseado').click();
  await row('Boletín').click();
  await settle(300);
  assert.deepEqual(asked, []);
  await shot('no-deseado');
  await page.locator('.ml-read').getByRole('button', { name: 'No es correo no deseado' }).click();
  assert.equal((await of('Boletín')).folder, 'inbox');
  await folder('Bandeja de entrada').click();
  await row('Boletín').click();
  await settle(500);
  assert.ok(asked.length >= 1, 'the pictures of a safe sender are fetched');
  assert.equal(await page.getByText('Se bloqueó el contenido externo').count(), 0);
  await menuOf('moveSel', 'move', 'Remitente');
  await menuItem('Remitentes bloqueados y seguros…').click();
  assert.match(await dialog().getByRole('list', { name: 'Remitentes seguros' }).innerText(), /ofertas@tienda\.test/);
  await dialog().getByLabel('Agregar a «Remitentes bloqueados»').fill('nada');
  await dialog().getByLabel('Agregar a «Remitentes bloqueados»').press('Enter');
  assert.match(await dialog().getByRole('alert').innerText(), /Escribe una dirección/);
  await dialog().getByLabel('Agregar a «Remitentes bloqueados»').fill('tienda.test');
  await dialog().getByLabel('Agregar a «Remitentes bloqueados»').press('Enter');
  await shot('remitentes');
  await dialog().getByRole('button', { name: 'Quitar ofertas@tienda.test' }).click();
  assert.deepEqual(await ctl((c) => c.data.junk), { blocked: ['@tienda.test'], safe: [] });
  await closeDialog();
});

await check('en una cuenta: reglas y bloqueados al sincronizar, con aviso, también en el servidor', async () => {
  await ev(async () => {
    const m = await import('/src/mail/fake-server.ts');
    const f = m.standardServer();
    f.add('Junk', ['\\Junk']);
    f.accounts = [m.account()];
    window.__fake = f;
    window.__mailFake = m;
    const c = window.__novaMail.ctl;
    c.newDoc();
    window.__novaMail.setTransport(f.transport);
    await c.loadAccounts();
    await c.syncAll();
    c.organize.saveRule({ id: '', name: 'Informes', enabled: true, conditions: [{ kind: 'subject', words: ['informe'] }], exceptions: [], actions: [{ kind: 'category', name: 'Categoría azul' }, { kind: 'move', folder: 'archive' }, { kind: 'alert', text: 'Ha llegado un informe' }], stop: true });
    c.organize.addSender('blocked', 'spam@x.es');
    f.folder('INBOX').msgs.push(m.FakeServer.mail('20', 'Informe semanal'));
    const junk = m.FakeServer.mail('21', 'Premio');
    junk.raw = junk.raw.replace('Ana <ana@x.es>', 'Premios <spam@x.es>');
    f.folder('INBOX').msgs.push(junk);
    await c.syncAll();
  });
  await page.waitForFunction(() => window.__fake.subjects('Archive').includes('Informe semanal') && window.__fake.subjects('Junk').includes('Premio'));
  assert.match(await page.getByTestId('sync-status').innerText(), /bloqueado.*reglas aplicadas a 1/s);
  const toast = page.getByRole('region', { name: 'Recordatorios' });
  assert.match(await toast.innerText(), /Informes[\s\S]*Ha llegado un informe/);
  await shot('regla-al-recibir');
  await toast.getByRole('button', { name: 'Cerrar' }).click();
  await toast.waitFor({ state: 'detached' });
  assert.deepEqual((await subjects()).sort(), ['Dos', 'Tres', 'Uno'], 'what the rules took is not in the inbox');
  await folder('Archivo').click();
  assert.equal(await row('Informe semanal').locator('.ml-cat').innerText(), 'Categoría azul');
});

width = 1280;
await check('con la ventana estrecha, las órdenes siguen al alcance', async () => {
  await row('Cena').click();
  await shot('cinta-1280');
  await menuOf('tagMenus', 'tags', 'Categorizar');
  await menuItem('Categoría naranja').click();
  assert.deepEqual((await of('Cena')).categories, ['Categoría naranja']);
});
width = 1600;

await check('las etiquetas, las carpetas de búsqueda y los diálogos se leen en los cuatro temas', async () => {
  await ctl((c) => {
    const ids = c.data.messages.filter((m) => m.folder === 'inbox').map((m) => m.id);
    c.categorize(ids.slice(0, 2), 'Categoría azul', true);
    c.followMany([ids[0]], new Date(2020, 0, 1).getTime());
    c.completeMany([ids[1]]);
  });
  await row('Presupuesto').click();
  for (const theme of ['colorful', 'white', 'darkgray', 'black']) {
    await ev((t) => window.__novaSettings.set('theme', t), theme);
    await page.waitForFunction((t) => document.querySelector('[data-app]').dataset.theme === t, theme);
    await settle(300);
    assert.deepEqual(await lowContrast(page, ['.ml-folders', '.ml-list', '.ml-follow']), [], theme);
    await shot(`tema-${theme}`);
    await rulesDialog();
    await dialog().getByRole('button', { name: 'Regla nueva…' }).click();
    await settle(300);
    assert.deepEqual(await lowContrast(page, ['[role="dialog"] .ml-form']), [], `regla ${theme}`);
    await shot(`tema-${theme}-regla`);
    await dialog().getByRole('button', { name: 'Cancelar' }).click();
    await closeDialog();
  }
});

await browser.close();
const failed = results.filter((r) => r[0] !== 'ok').length;
if (errors.length) console.log('Console errors:', [...new Set(errors)].slice(0, 8));
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed || errors.length ? 1 : 0);
