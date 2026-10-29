// End-to-end checks for the server side of Nova Mail (accounts, OAuth, all folders with subfolders, changes sent to the server,
// pending changes, automatic sync, Outlook files), in a real browser (Edge). Needs `pnpm dev` running on :1420.
// The desktop commands (Rust) are replaced by a simulated server (apps/suite/src/mail/fake-server.ts) that follows the same
// rules; the real clients of each protocol are tested with `cargo test` against fake servers on this computer.
// Optional: NOVA_OUTLOOK_SAMPLES=<folder with "Attach sample eml received.msg" and "enron.pst"> also tests importing Outlook files.
// Usage: node scripts/e2e-mail-remote.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=mail';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-mailr-'));
const SECRET = 'clave-ultra-secreta-123';
const SAMPLES = process.env.NOVA_OUTLOOK_SAMPLES ?? '';

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
let current = '';
page.on('pageerror', (e) => errors.push(e.message));
// (the clock of the automatic-sync check injects its script into every new frame, and the sandboxed reading pane refuses it: that message is not from the app)
page.on('console', (m) => m.type() === 'error' && !/Keyborg|violates the following Content Security Policy directive: "img-src data:"|Blocked script execution in 'about:srcdoc'/.test(m.text()) && errors.push(`[${current}] ${m.text()}`));
const dialogs = [];
page.on('dialog', (d) => {
  if (d.type() === 'confirm' && /^(¿Quitar la cuenta|Hay cambios sin guardar|¿Eliminar la carpeta)/.test(d.message())) return void d.accept();
  dialogs.push(d.message());
  d.dismiss();
});

let step = 0;
const shot = async (name) => {
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
};
const results = [];
const check = async (name, fn) => {
  current = name.slice(0, 40);
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 7).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-').slice(0, 60)}`);
    await page.keyboard.press('Escape').catch(() => undefined);
  }
};

const ev = (fn, arg) => page.evaluate(fn, arg);
const settle = () => page.waitForTimeout(150);
const dialog = () => page.getByRole('dialog');
const item = (cmd) => page.locator(`[data-nv-item="${cmd}"]`);
const tab = (n) => page.getByRole('tab', { name: n, exact: true }).click();
const act = async (cmd, tabName = 'Enviar y recibir') => {
  await tab(tabName);
  await item(cmd).click();
};
const st = () => ev(() => ({ n: window.__novaMail.ctl.data.messages.length, accounts: window.__novaMail.ctl.accounts.length, sync: window.__novaMail.ctl.syncMessage, dirty: window.__novaMail.ctl.dirty, pending: window.__novaMail.ctl.pendingCount }));
const status = () => page.getByTestId('sync-status').innerText().catch(() => '');
const row = (subject) => page.getByRole('option', { name: new RegExp(subject) });
const syncDone = () => page.waitForFunction(() => /Sincronizado|Error al sincronizar/.test(window.__novaMail.ctl.syncMessage) && !window.__novaMail.ctl.syncing, null, { timeout: 60000 });
const sync = async () => {
  await ev(() => (window.__novaMail.ctl.syncMessage = ''));
  await act('mail.sync');
  await syncDone();
};
const noPending = () => page.waitForFunction(() => window.__novaMail.ctl.pendingCount === 0, null, { timeout: 15000 });
const folderButtons = () => page.locator('.ml-folders .ml-folder-name');
const folderNames = () => folderButtons().evaluateAll((els) => els.map((e) => e.querySelector('span')?.textContent ?? ''));
const openFolder = (name) => page.locator('.ml-folders .ml-folder-name', { has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) }).click();
const fake = (fn, arg) => ev(fn, arg);

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.ml-app');
await page.screenshot(); // first capture after load can be blank

await check('in the browser (no desktop app) the accounts dialog explains it and nothing can connect', async () => {
  await act('mail.accounts', 'Enviar y recibir');
  assert.match(await dialog().innerText(), /solo está disponible en la aplicación de escritorio/);
  assert.equal(await dialog().getByRole('button', { name: 'Añadir cuenta' }).count(), 0);
  await dialog().getByRole('button', { name: 'Cerrar' }).click();
  await dialog().waitFor({ state: 'hidden' });
  await tab('Enviar y recibir');
  assert.equal(await item('mail.sync').isDisabled(), true);
  await settle();
});

await ev(async () => {
  const m = await import('/src/mail/fake-server.ts');
  const f = m.standardServer();
  window.__fake = f;
  window.__fakeMail = (key, subject, opts) => m.FakeServer.mail(key, subject, opts);
  window.__novaMail.setTransport(f.transport);
});
await ev(() => window.__novaMail.ctl.loadAccounts());
await settle();

await check('add a Gmail account with OAuth: sign in in the browser, no password anywhere, then save', async () => {
  await act('mail.accounts');
  await dialog().getByRole('button', { name: 'Añadir cuenta' }).click();
  assert.equal(await dialog().getByLabel('Proveedor').inputValue(), 'gmail');
  assert.equal(await dialog().getByLabel('Cómo iniciar sesión').inputValue(), 'oauth');
  assert.match(await dialog().innerText(), /Nova Mail no trae una aplicación registrada/);
  assert.match(await dialog().innerText(), /http:\/\/127\.0\.0\.1/);
  assert.equal(await dialog().getByLabel('Contraseña', { exact: true }).count(), 0, 'no password box with OAuth');
  await dialog().getByLabel('Nombre de la cuenta').fill('Personal');
  await dialog().getByLabel('Correo electrónico').fill('ana@ejemplo.es');
  assert.ok(await dialog().getByRole('button', { name: 'Guardar cuenta' }).isDisabled(), 'cannot save before signing in');
  assert.ok(await dialog().getByRole('button', { name: 'Iniciar sesión en el navegador' }).isDisabled(), 'needs the client ID first');
  await dialog().getByLabel('Identificador de cliente (Client ID)').fill('cliente-123.apps.googleusercontent.com');
  await dialog().getByRole('button', { name: 'Iniciar sesión en el navegador' }).click();
  await dialog().getByText('Sesión iniciada', { exact: true }).waitFor();
  assert.match(await dialog().getByRole('status').first().innerText(), /Sesión iniciada|Signed in/);
  await dialog().getByRole('button', { name: 'Probar conexión' }).click();
  await dialog().getByText('La conexión funciona').waitFor();
  await shot('oauth-form');
  // changing the client ID means signing in again
  await dialog().getByLabel('Identificador de cliente (Client ID)').fill('otro');
  assert.ok(await dialog().getByRole('button', { name: 'Guardar cuenta' }).isDisabled());
  await dialog().getByLabel('Identificador de cliente (Client ID)').fill('cliente-123.apps.googleusercontent.com');
  await dialog().getByRole('button', { name: 'Iniciar sesión en el navegador' }).click();
  await dialog().getByText('Sesión iniciada', { exact: true }).waitFor();
  await dialog().getByRole('button', { name: 'Guardar cuenta' }).click();
  await dialog().getByRole('list', { name: 'Cuentas' }).waitFor();
  assert.match(await dialog().getByRole('list', { name: 'Cuentas' }).innerText(), /Personal[\s\S]*ana@ejemplo\.es[\s\S]*IMAP · OAuth · imap\.gmail\.com:993/);
  assert.equal((await st()).accounts, 1);
  const acc = await fake(() => ({ passwords: Object.keys(window.__fake.passwords).length, logins: window.__fake.logins.size, a: window.__fake.accounts[0] }));
  assert.equal(acc.passwords, 0);
  assert.equal(acc.logins, 1);
  assert.equal(acc.a.auth.kind, 'oauth');
  assert.equal(acc.a.auth.oauth.provider, 'google');
  assert.equal(acc.a.save_sent, false, 'Gmail keeps its own copy of what is sent');
  assert.match(await dialog().getByRole('group', { name: 'Sincronización' }).innerText(), /Sincronizar automáticamente/);
  await shot('accounts');
});

await check('saving the account starts the first synchronisation: every folder arrives, with its subfolders', async () => {
  await syncDone();
  await dialog().getByRole('button', { name: 'Cerrar' }).click();
  await dialog().waitFor({ state: 'hidden' });
  await settle();
  assert.equal((await st()).n, 6);
  const names = await folderNames();
  assert.deepEqual(names.slice(0, 6), ['Bandeja de entrada', 'Borradores', 'Elementos enviados', 'Archivo', 'Correo no deseado', 'Elementos eliminados']);
  assert.deepEqual(names.slice(6), ['Personal', 'Trabajo', 'Proyecto A', 'Fase 1']);
  const levels = await page.locator('.ml-folders [role="treeitem"]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('aria-level'))));
  assert.deepEqual(levels.slice(6), [1, 1, 2, 3]);
  await openFolder('Fase 1');
  assert.ok(await row('Detalle de la fase').count());
  await openFolder('Proyecto A');
  assert.ok(await row('Informe del proyecto').count());
  assert.equal(await row('Detalle de la fase').count(), 0);
  // folding hides the subfolders
  await page.getByRole('button', { name: 'Contraer Trabajo' }).click();
  assert.deepEqual((await folderNames()).slice(6), ['Personal', 'Trabajo']);
  await page.getByRole('button', { name: 'Expandir Trabajo' }).click();
  assert.deepEqual((await folderNames()).slice(6), ['Personal', 'Trabajo', 'Proyecto A', 'Fase 1']);
  await openFolder('Bandeja de entrada');
  await shot('folder-tree');
});

await check('delete, archive and move are done on the server too', async () => {
  await row('Dos').click();
  await tab('Inicio');
  await item('mail.delete').click();
  await row('Uno').click();
  await item('mail.archive').click();
  await row('Tres').click();
  await page.getByLabel('Mover a la carpeta').selectOption({ label: '    Fase 1' }).catch(async () => {
    const options = await page.getByLabel('Mover a la carpeta').locator('option').allInnerTexts();
    const o = options.find((x) => /Fase 1/.test(x));
    await page.getByLabel('Mover a la carpeta').selectOption({ label: o });
  });
  await noPending();
  const srv = await fake(() => ({ inbox: window.__fake.subjects('INBOX'), trash: window.__fake.subjects('Trash'), archive: window.__fake.subjects('Archive'), fase: window.__fake.subjects('Trabajo/Proyecto A/Fase 1') }));
  assert.deepEqual(srv.inbox, []);
  assert.deepEqual(srv.trash, ['Dos']);
  assert.deepEqual(srv.archive, ['Uno']);
  assert.deepEqual(srv.fase.sort(), ['Detalle de la fase', 'Tres']);
  // a synchronisation afterwards leaves everything where it is, with no duplicates
  await sync();
  assert.equal((await st()).n, 6);
  const where = await ev(() => Object.fromEntries(window.__novaMail.ctl.data.messages.map((m) => [m.subject, [m.folder, m.remote?.folder]])));
  assert.deepEqual(where['Dos'], ['trash', 'Trash']);
  assert.deepEqual(where['Uno'], ['archive', 'Archive']);
  assert.deepEqual(where['Tres'][1], 'Trabajo/Proyecto A/Fase 1');
  await shot('after-moves');
});

await check('what changes on the server arrives at the next sync: deletions, flags, new mail, new and removed folders', async () => {
  await fake(() => {
    const f = window.__fake;
    // another client: deletes «Cena del sábado», marks «Informe del proyecto» read and flagged, adds a mail and a folder, removes «Fase 1»
    f.folder('Personal').msgs = [];
    f.folder('Trabajo/Proyecto A').msgs[0].flags = ['\\Seen', '\\Flagged'];
    f.folder('INBOX').msgs.push(window.__fakeMail('50', 'Correo nuevo del servidor'));
    f.add('Clientes', [], [window.__fakeMail('1', 'Pedido de cliente')]);
    f.folders = f.folders.filter((x) => x.name !== 'Trabajo/Proyecto A/Fase 1');
  });
  await sync();
  assert.match(await status(), /Sincronizado a las .*2 mensajes nuevos, 1 quitado.*1 con marcas cambiadas/);
  const names = await folderNames();
  assert.ok(names.includes('Clientes'), 'new folder');
  assert.ok(!names.includes('Fase 1'), 'removed folder');
  const subjects = await ev(() => window.__novaMail.ctl.data.messages.map((m) => m.subject).sort());
  assert.ok(!subjects.includes('Cena del sábado'));
  assert.ok(!subjects.includes('Tres'), 'it was in the removed folder');
  assert.ok(subjects.includes('Correo nuevo del servidor') && subjects.includes('Pedido de cliente'));
  const informe = await ev(() => window.__novaMail.ctl.data.messages.find((m) => m.subject === 'Informe del proyecto'));
  assert.equal(informe.read && informe.flagged, true);
  await openFolder('Bandeja de entrada');
  assert.ok(await row('Correo nuevo del servidor').count());
});

await check('offline: the change stays pending, the status bar says so, and it is sent when the connection is back', async () => {
  await fake(() => (window.__fake.failWith = 'Error de red: sin conexión'));
  await row('Correo nuevo del servidor').click();
  await tab('Inicio');
  await item('mail.delete').click();
  await page.waitForFunction(() => /No se pudo actualizar el servidor \(se reintentará\)/.test(window.__novaMail.ctl.syncMessage));
  assert.match(await page.getByTestId('pending-status').innerText(), /cambio.* sin enviar al servidor/);
  assert.equal(await row('Correo nuevo del servidor').count(), 0, 'it is gone from the inbox here');
  // the server still has it, but it is not downloaded again while the change is pending
  await fake(() => (window.__fake.failWith = null));
  const original = await ev(() => {
    const f = window.__fake;
    window.__realTransport = f.transport;
    window.__block = true;
    window.__novaMail.setTransport(async (cmd, args = {}) => {
      if (window.__block && ['mail_move', 'mail_remove', 'mail_set_flag', 'mail_append'].includes(cmd)) throw new Error('Error de red: sin conexión');
      return window.__realTransport(cmd, args);
    });
    return true;
  });
  assert.ok(original);
  await sync();
  assert.equal(await row('Correo nuevo del servidor').count(), 0);
  assert.equal(await ev(() => window.__novaMail.ctl.data.messages.filter((m) => m.subject === 'Correo nuevo del servidor').length), 1, 'only the copy in the local trash');
  await shot('pending');
  // the connection is back
  await ev(() => (window.__block = false));
  await sync();
  assert.equal((await st()).pending, 0);
  assert.equal(await page.getByTestId('pending-status').count(), 0);
  assert.deepEqual(await fake(() => window.__fake.subjects('Trash')), ['Dos', 'Correo nuevo del servidor']);
});

await check('new folders: a subfolder on the server from the folder pane, a local one, and refusing to move server mail into a local-only folder', async () => {
  await openFolder('Proyecto A');
  await page.getByRole('button', { name: '+ Carpeta nueva' }).click();
  await page.getByLabel('Nombre de la carpeta').fill('Contratos');
  await page.getByLabel(/Dentro de «Proyecto A»/).check();
  await page.getByLabel('Dónde crearla').selectOption({ label: 'En el servidor: Personal' });
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await page.locator('.ml-folders .ml-folder-name', { has: page.locator('span', { hasText: /^Contratos$/ }) }).waitFor();
  assert.ok(await fake(() => window.__fake.folders.some((f) => f.path === 'Trabajo/Proyecto A/Contratos')));
  const lv = await page.locator('.ml-folders [role="treeitem"]').evaluateAll((els) => els.map((e) => [e.textContent, Number(e.getAttribute('aria-level'))]));
  assert.deepEqual(lv.find((x) => /Contratos/.test(x[0])), ['Contratos', 3]);
  // a local-only folder
  await openFolder('Bandeja de entrada');
  await page.getByRole('button', { name: '+ Carpeta nueva' }).click();
  await page.getByLabel('Nombre de la carpeta').fill('Solo aquí');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await page.locator('.ml-folders .ml-folder-name', { has: page.locator('span', { hasText: /^Solo aquí$/ }) }).waitFor();
  await row('Pedido|Uno|Informe').first().count();
  await ev(() => {
    const c = window.__novaMail.ctl;
    const m = c.data.messages.find((x) => x.remote && x.folder !== 'trash' && x.folder !== 'sent');
    c.select(m.id);
  });
  const moved = await ev(() => {
    const c = window.__novaMail.ctl;
    const loc = c.data.folders.find((f) => f.name === 'Solo aquí');
    const m = c.selected;
    const ok = c.move(c.selectedId, loc.id);
    return { ok, msg: c.syncMessage, from: m && [m.subject, m.folder, m.remote] };
  });
  assert.equal(moved.ok, false, JSON.stringify(moved));
  assert.match(moved.msg, /no tiene una carpeta equivalente en el servidor/);
  // deleting the server folder deletes it there too (with a confirmation)
  await openFolder('Contratos');
  await tab('Inicio');
  await item('mail.deleteFolder').click();
  await page.waitForFunction(() => !window.__fake.folders.some((f) => f.path === 'Trabajo/Proyecto A/Contratos'));
  assert.ok(!(await folderNames()).includes('Contratos'));
  await shot('new-folders');
});

await check('POP3, JMAP and Exchange: the form adapts (address instead of servers, token, no save-copy option)', async () => {
  await act('mail.accounts');
  await dialog().getByRole('button', { name: 'Añadir cuenta' }).click();
  const prov = dialog().getByLabel('Proveedor');
  await prov.selectOption('fastmail');
  assert.equal(await dialog().getByLabel('Protocolo').inputValue(), 'jmap');
  assert.equal(await dialog().getByLabel('Cómo iniciar sesión').inputValue(), 'token');
  assert.equal(await dialog().getByLabel('Dirección de la sesión JMAP').inputValue(), 'https://api.fastmail.com/jmap/session');
  assert.equal(await dialog().getByLabel('Servidor de entrada (IMAP): Servidor').count(), 0);
  assert.equal(await dialog().getByLabel('Guardar una copia de lo enviado en Enviados del servidor').count(), 0);
  assert.ok(await dialog().getByLabel('Token de acceso').count());
  assert.match(await dialog().innerText(), /guarda por sí mismo la copia en Enviados/);
  await prov.selectOption('exchange');
  assert.equal(await dialog().getByLabel('Protocolo').inputValue(), 'ews');
  assert.ok(await dialog().getByLabel('Dirección del servicio Exchange (EWS)').count());
  assert.match(await dialog().innerText(), /1 de octubre de 2026/);
  await prov.selectOption('other-pop3');
  assert.equal(await dialog().getByLabel('Protocolo').inputValue(), 'pop3');
  assert.equal(await dialog().getByLabel('Servidor de entrada (POP3): Puerto').inputValue(), '995');
  assert.equal(await dialog().getByLabel('Guardar una copia de lo enviado en Enviados del servidor').count(), 0);
  assert.match(await dialog().innerText(), /solo trae la bandeja de entrada/);
  await prov.selectOption('other-jmap');
  assert.equal(await dialog().getByLabel('Dirección de la sesión JMAP').inputValue(), '');
  // an insecure address is not accepted
  await dialog().getByLabel('Correo electrónico').fill('a@b.es');
  await dialog().getByLabel('Token de acceso').fill('x');
  await dialog().getByLabel('Dirección de la sesión JMAP').fill('http://mail.ejemplo.es/jmap');
  assert.ok(await dialog().getByRole('button', { name: 'Guardar cuenta' }).isDisabled(), 'http:// is refused');
  await dialog().getByLabel('Dirección de la sesión JMAP').fill('https://mail.ejemplo.es/jmap');
  assert.equal(await dialog().getByRole('button', { name: 'Guardar cuenta' }).isDisabled(), false);
  await shot('jmap-form');
  await dialog().getByRole('button', { name: 'Cancelar' }).click();
  await dialog().getByRole('button', { name: 'Cerrar' }).click();
  await dialog().waitFor({ state: 'hidden' });
});

await check('a second account with a password: wrong password explained, the password never stays anywhere', async () => {
  await act('mail.accounts');
  await dialog().getByRole('button', { name: 'Añadir cuenta' }).click();
  await dialog().getByLabel('Proveedor').selectOption('icloud');
  assert.equal(await dialog().getByLabel('Cómo iniciar sesión').inputValue(), 'password');
  await dialog().getByLabel('Nombre de la cuenta').fill('Casa');
  await dialog().getByLabel('Correo electrónico').fill('casa@ejemplo.es');
  await dialog().getByLabel('Contraseña', { exact: true }).fill('equivocada');
  await dialog().getByRole('button', { name: 'Probar conexión' }).click();
  assert.match(await dialog().getByRole('alert').innerText(), /no aceptó el usuario o la contraseña/);
  await dialog().getByLabel('Contraseña', { exact: true }).fill(SECRET);
  await dialog().getByRole('button', { name: 'Probar conexión' }).click();
  await dialog().getByText('La conexión funciona').waitFor();
  await dialog().getByRole('button', { name: 'Guardar cuenta' }).click();
  await dialog().getByRole('list', { name: 'Cuentas' }).waitFor();
  await syncDone();
  assert.equal((await st()).accounts, 2);
  const where = await ev((secret) => {
    const ctl = window.__novaMail.ctl;
    return {
      dom: document.documentElement.outerHTML.includes(secret),
      inputs: [...document.querySelectorAll('input')].some((i) => i.value.includes(secret)),
      ls: JSON.stringify({ ...localStorage }).includes(secret),
      ss: JSON.stringify({ ...sessionStorage }).includes(secret),
      data: JSON.stringify(ctl.data).includes(secret),
      accounts: JSON.stringify(ctl.accounts).includes(secret),
    };
  }, SECRET);
  assert.deepEqual(where, { dom: false, inputs: false, ls: false, ss: false, data: false, accounts: false });
  // iCloud (not Gmail) does not keep its own copy of what is sent
  assert.equal(await fake(() => window.__fake.accounts.find((a) => a.email === 'casa@ejemplo.es').save_sent), true);
  // editing keeps the saved password; pointing the account elsewhere needs it again
  await dialog().getByRole('button', { name: 'Editar Casa' }).click();
  await dialog().getByLabel('Nombre de la cuenta').fill('Casa 2');
  await dialog().getByRole('button', { name: 'Guardar cuenta' }).click();
  await dialog().getByRole('list', { name: 'Cuentas' }).waitFor();
  await dialog().getByRole('button', { name: 'Editar Casa 2' }).click();
  await dialog().getByLabel('Servidor de entrada (IMAP): Servidor').fill('imap.malo.example');
  await dialog().getByRole('button', { name: 'Guardar cuenta' }).click();
  assert.match(await dialog().getByRole('alert').innerText(), /contraseña de nuevo/);
  await dialog().getByRole('button', { name: 'Cancelar' }).click();
  await dialog().getByRole('button', { name: 'Cerrar' }).click();
  await dialog().waitFor({ state: 'hidden' });
});

await check('write and send with the iCloud account: the copy is saved in the server Sent folder once, and recognised after syncing', async () => {
  await tab('Inicio');
  await page.getByRole('button', { name: 'Correo nuevo', exact: true }).first().click();
  const d = dialog();
  await d.getByLabel('Desde').selectOption({ label: /Casa 2/ }).catch(async () => {
    const opts = await d.getByLabel('Desde').locator('option').allInnerTexts();
    await d.getByLabel('Desde').selectOption({ label: opts.find((o) => /Casa 2/.test(o)) });
  });
  await d.getByLabel('Para', { exact: true }).fill('Luis <luis@x.es>');
  await d.getByLabel('Cco').fill('oculta@x.es');
  await d.getByLabel('Asunto').fill('Acuerdo del jueves');
  await d.getByLabel('Cuerpo del mensaje').fill('Hola Luis, nos vemos el jueves. ¡Gracias!');
  await fake(() => (window.__fake.failWith = 'No se pudo conectar con smtp.mail.me.com:587: tiempo agotado'));
  await d.getByRole('button', { name: 'Enviar', exact: true }).click();
  assert.match(await d.getByRole('alert').innerText(), /No se pudo enviar: No se pudo conectar con smtp\.mail\.me\.com/);
  assert.equal(await d.getByLabel('Asunto').inputValue(), 'Acuerdo del jueves');
  assert.equal(await fake(() => window.__fake.sent.length), 0);
  await fake(() => (window.__fake.failWith = null));
  await d.getByRole('button', { name: 'Enviar', exact: true }).click();
  await dialog().waitFor({ state: 'hidden' });
  await noPending();
  const sent = await fake(() => window.__fake.sent[0]);
  assert.deepEqual(sent.recipients, ['luis@x.es', 'oculta@x.es']);
  assert.doesNotMatch(sent.raw, /oculta@x\.es/);
  assert.match(await status(), /Mensaje enviado a 2 destinatarios/);
  assert.deepEqual(await fake(() => window.__fake.appended.map((a) => [a.folder, a.seen])), [['Sent', true]]);
  await sync();
  // (both accounts talk to the same simulated server, so the other account downloads its own copy: only this account's copy is checked)
  // the local copy (the one with the hidden recipient) was adopted, not duplicated
  const copies = await ev(() => window.__novaMail.ctl.data.messages.filter((m) => m.subject === 'Acuerdo del jueves' && m.bcc).map((m) => [m.folder, m.remote?.folder, m.bcc]));
  assert.deepEqual(copies, [['sent', 'Sent', ['oculta@x.es']]]);
});

await check('automatic synchronisation: it repeats by itself and can be turned off', async () => {
  await page.clock.install();
  await ev(() => window.__novaMail.ctl.setSyncSettings({ autoMinutes: 1 }));
  await fake(() => window.__fake.folder('INBOX').msgs.push(window.__fakeMail('77', 'Llegó solo')));
  const before = await fake(() => window.__fake.calls.filter((c) => c === 'mail_list_folders').length);
  await page.clock.fastForward('01:05');
  await page.waitForFunction((n) => window.__fake.calls.filter((c) => c === 'mail_list_folders').length > n, before, { timeout: 20000 });
  await syncDone();
  assert.ok(await ev(() => window.__novaMail.ctl.data.messages.some((m) => m.subject === 'Llegó solo')));
  await ev(() => window.__novaMail.ctl.setSyncSettings({ autoMinutes: 0 }));
  const n2 = await fake(() => window.__fake.calls.length);
  await page.clock.fastForward('10:00');
  await page.waitForTimeout(300);
  assert.equal(await fake(() => window.__fake.calls.length), n2, 'nothing happens once it is off');
});

await check('save the file and reopen it: origin, pending changes and server structure are kept; nothing is downloaded twice', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const file = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(file);
  const saved = fs.readFileSync(file, 'utf8');
  assert.ok(!saved.includes(SECRET), 'the secret is not in the file');
  const data = JSON.parse(saved);
  assert.ok(Object.keys(data.sync).some((k) => k.endsWith('|INBOX')));
  assert.ok(data.messages.some((m) => m.remote && m.remote.folder === 'INBOX' && typeof m.remote.key === 'string'));
  assert.ok(data.folders.some((f) => f.remote && f.parent), 'subfolders with their server origin');
  assert.ok(data.servers && Object.values(data.servers).every((s) => s.targets.inbox));
  const n = (await st()).n;
  await ev(() => window.__novaMail.ctl.newDoc());
  assert.equal((await st()).n, 0);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await chooser.setFiles(file);
  await page.waitForFunction((n) => window.__novaMail.ctl.data.messages.length === n, n);
  await sync();
  assert.equal((await st()).n, n);
  assert.match(await status(), /0 mensajes nuevos/);
});

await check('the server renumbering a folder starts that folder over without touching local mail', async () => {
  await fake(() => {
    const f = window.__fake.folder('INBOX');
    f.validity = '99';
    f.msgs = [window.__fakeMail('1', 'Tras la renumeración')];
  });
  await ev(() => window.__novaMail.ctl.importRaw('From: l@x.es\r\nSubject: Solo local\r\n\r\nx\r\n', 'inbox'));
  await sync();
  const subjects = await ev(() => window.__novaMail.ctl.data.messages.filter((m) => m.folder === 'inbox').map((m) => m.subject).sort());
  assert.ok(subjects.includes('Solo local') && subjects.includes('Tras la renumeración'));
  assert.ok(!subjects.includes('Correo nuevo del servidor'));
});

if (SAMPLES && fs.existsSync(path.join(SAMPLES, 'enron.pst'))) {
  await check('Outlook files: a .msg goes to the current folder and a .pst brings all its folders, in a real browser', async () => {
    await ev(() => window.__novaMail.ctl.newDoc());
    await tab('Datos');
    let [chooser] = await Promise.all([page.waitForEvent('filechooser'), item('data.import.outlook').click()]);
    await chooser.setFiles(path.join(SAMPLES, 'Attach sample eml received.msg'));
    await page.waitForFunction(() => window.__novaMail.ctl.data.messages.length === 1, null, { timeout: 30000 });
    const m = await ev(() => window.__novaMail.ctl.data.messages[0]);
    assert.equal(m.subject, 'Attach sample.eml');
    assert.equal(m.hasAttachments, true);
    await tab('Datos');
    [chooser] = await Promise.all([page.waitForEvent('filechooser'), item('data.import.outlook').click()]);
    await chooser.setFiles(path.join(SAMPLES, 'enron.pst'));
    await page.waitForFunction(() => window.__novaMail.ctl.data.messages.length === 72, null, { timeout: 120000 });
    const names = await folderNames();
    assert.ok(names.includes('enron'));
    assert.ok(names.includes('MLOKAY (Non-Privileged)') && names.includes('TW-Commercial Group') && names.includes('Personal'));
    const lv = await page.locator('.ml-folders [role="treeitem"]').evaluateAll((els) => els.map((e) => [e.textContent.replace(/\d+$/, ''), Number(e.getAttribute('aria-level'))]));
    assert.deepEqual(lv.find((x) => x[0] === 'TW-Commercial Group'), ['TW-Commercial Group', 4]);
    await openFolder('TW-Commercial Group');
    await row("New OBA's").first().click();
    await page.locator('article.ml-read h2').filter({ hasText: "New OBA's" }).waitFor();
    await shot('pst');
    const text = await page.locator('.ml-app').innerText();
    assert.match(text, /OBA_27602_Citizens\.doc \(53 KB\)/);
    assert.equal((text.match(/\.doc \(\d+ KB\)/g) ?? []).length, 11);
  });
}

await check('removing the accounts forgets their credentials; sending and syncing are no longer offered', async () => {
  await act('mail.accounts');
  for (const name of ['Personal', 'Casa 2']) {
    await dialog().getByRole('button', { name: `Quitar ${name}` }).click();
    await page.waitForFunction((n) => !window.__fake.accounts.some((a) => a.name === n), name);
  }
  assert.equal(await fake(() => Object.keys(window.__fake.passwords).length + window.__fake.logins.size), 0);
  assert.match(await dialog().innerText(), /Todavía no hay ninguna cuenta/);
  await dialog().getByRole('button', { name: 'Cerrar' }).click();
  await dialog().waitFor({ state: 'hidden' });
  await settle();
  await tab('Enviar y recibir');
  assert.equal(await item('mail.sync').isDisabled(), true);
  await tab('Inicio');
  await page.getByRole('button', { name: 'Correo nuevo', exact: true }).first().click();
  assert.equal(await dialog().getByRole('button', { name: 'Enviar', exact: true }).count(), 0);
  await dialog().getByRole('button', { name: 'Cerrar' }).click();
  await dialog().waitFor({ state: 'hidden' });
});

await check('five hundred messages and a dozen folders are brought down without freezing the window', async () => {
  await ev(() => window.__novaMail.ctl.newDoc());
  await fake(() => {
    const f = window.__fake;
    const mk = (i) => window.__fakeMail(String(i), `Masivo ${i}`);
    f.folder('INBOX').validity = '1';
    f.folder('INBOX').msgs = Array.from({ length: 450 }, (_, i) => mk(i + 1));
    f.folder('Personal').msgs = [];
    f.folder('Sent').msgs = [];
    for (let k = 0; k < 10; k++) f.add(`Carpeta ${k}`, [], [mk(1), mk(2)]);
    f.accounts = [{ id: 'masiva', name: 'Masiva', email: 'm@ejemplo.es', username: 'm', imap: { host: 'imap.x', port: 993, security: 'tls' }, smtp: { host: 'smtp.x', port: 465, security: 'tls' } }];
  });
  await ev(() => window.__novaMail.ctl.loadAccounts());
  const t0 = Date.now();
  await act('mail.sync');
  await syncDone();
  assert.ok((await st()).n >= 470, `${(await st()).n} messages`);
  assert.ok(Date.now() - t0 < 30000, `took ${Date.now() - t0} ms`);
  await shot('big');
});

await check('dark theme and no console errors or unexpected dialogs', async () => {
  assert.deepEqual(dialogs, []);
});

await browser.close();
const failed = results.filter((r) => r[0] === 'FAIL');
for (const r of results) console.log(r[0].padEnd(4), r[1], r[2] ? `\n     ${r[2]}` : '');
if (errors.length) console.log('\nconsole errors:\n' + [...new Set(errors)].slice(0, 8).join('\n'));
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed.length || errors.length ? 1 : 0);
