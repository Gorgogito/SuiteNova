// Checks collecting responses over the network in the COMPILED desktop app (Tauri + WebView2): the part in Rust that
// listens, the page it serves to another browser, what arrives and gets written into the file, and that nothing keeps
// listening afterwards. It listens ONLY on 127.0.0.1 (the network of the computer is never opened, so Windows does not
// ask about the firewall). The app runs with its own WebView2 profile. Windows appear on screen while it runs.
// Windows only. Build first: pnpm tauri build --no-bundle   Usage: node scripts/e2e-forms-native.mjs [--exe path] [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const shotsDir = arg('--shots');
const exe = arg('--exe') ?? path.resolve('apps/suite/src-tauri/target/release/suitenova.exe');
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
assert.ok(fs.existsSync(exe), `no existe ${exe}: compila con pnpm tauri build --no-bundle`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-collect-'));

const question = (id, type, title, over = {}) => ({ id, type, title, description: '', required: false, options: [], rows: [], max: 5, min: null, maxValue: null, integer: false, allowOther: false, correct: [], points: 0, format: 'none', showIf: null, ...over });
const file = path.join(dir, 'merienda.novaforms');
const form = { id: 'fnativa', version: 1, title: 'Merienda ñandú', description: '', color: '#0f6cbd', quiz: false, showScore: true, thanks: 'Gracias por responder.', noAgain: true, questions: [question('q1', 'text', 'Tu fruta', { required: true }), question('q2', 'file', 'Una foto', { maxFiles: 1, maxMb: 10 })] };
fs.writeFileSync(file, JSON.stringify({ format: 'novaforms', form, responses: [] }));
const saved = () => JSON.parse(fs.readFileSync(file, 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const results = [];
const check = async (name, fn) => {
  try {
    let timer;
    await Promise.race([fn(), new Promise((_, rej) => (timer = setTimeout(() => rej(new Error('sin respuesta en 90 s')), 90000)))]).finally(() => clearTimeout(timer));
    results.push(['ok', name]);
    console.log(`  ✔ ${name}`);
  } catch (e) {
    results.push(['FAIL', name]);
    console.log(`  ✘ ${name}\n      ${e.message.split('\n').filter(Boolean).slice(0, 10).join(' | ')}`);
  }
};

const PORT = 9361;
const proc = spawn(exe, [file], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`, WEBVIEW2_USER_DATA_FOLDER: path.join(dir, 'perfil') },
  stdio: 'ignore',
});
let app;
let outside;
try {
  for (let i = 0; i < 60 && !app; i++) app = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => sleep(1000).then(() => null));
  assert.ok(app, 'no se pudo conectar con la aplicación');
  const pages = () => app.contexts().flatMap((c) => c.pages());
  const dialogs = [];
  const windowFor = async (match, ready) => {
    let page;
    for (let i = 0; i < 60 && !page; i++) {
      page = pages().find((p) => match(new URL(p.url())));
      if (!page) await sleep(500);
    }
    assert.ok(page, 'no apareció la ventana');
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy/.test(m.text()) && errors.push(m.text()));
    page.on('dialog', (d) => dialogs.push(d));
    await page.waitForSelector(ready);
    await sleep(1200);
    return page;
  };
  const until = async (fn, message) => {
    for (let i = 0; i < 60; i++) {
      if (await fn()) return;
      await sleep(150);
    }
    assert.fail(message);
  };

  const forms = await windowFor((u) => u.searchParams.get('app') === 'forms', '.fm-app');
  // no notice of Windows while this runs (it would register the program for notices on this computer)
  await forms.evaluate(() => (document.hasFocus = () => true));
  outside = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
  const visitor = await outside.newContext({ acceptDownloads: true });

  const listening = async (url) => {
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000) });
      return true;
    } catch {
      return false;
    }
  };
  const status = () => forms.getByRole('button', { name: /Recogiendo respuestas/ });
  const openDialog = async () => {
    await forms.getByRole('tab', { name: 'Respuestas', exact: true }).click();
    await forms.getByRole('button', { name: 'Recoger por la red local…', exact: true }).click();
    const d = forms.getByRole('dialog');
    await d.waitFor();
    return d;
  };
  const closeDialog = async (d) => {
    await d.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await d.waitFor({ state: 'detached' });
  };
  const start = async () => {
    const d = await openDialog();
    await forms.waitForFunction(() => document.querySelector('[role="dialog"] select')?.options.length > 0);
    await d.getByLabel('Dirección de este equipo').selectOption('127.0.0.1');
    await d.getByRole('button', { name: 'Empezar a recoger' }).click();
    const url = await d.getByLabel('Dirección para responder').inputValue();
    await closeDialog(d);
    return url;
  };

  let url;
  await check('el formulario abierto desde fuera lista las direcciones del equipo y empieza a escuchar en 127.0.0.1', async () => {
    const d = await openDialog();
    await forms.waitForFunction(() => document.querySelector('[role="dialog"] select')?.options.length > 0);
    const list = await d.getByLabel('Dirección de este equipo').locator('option').evaluateAll((o) => o.map((x) => x.value));
    assert.equal(list.at(-1), '127.0.0.1');
    for (const ip of list) assert.match(ip, /^(127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/);
    console.log(`      direcciones de red local ofrecidas además de este equipo: ${list.length - 1}`);
    await closeDialog(d);
    url = await start();
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{20}$/);
    await status().waitFor();
    assert.ok(await listening(url));
    if (shotsDir) await forms.screenshot({ path: `${shotsDir}/nativa-recogiendo.png` });
  });

  const photo = Buffer.alloc(9 * 1024 * 1024);
  for (let i = 0; i < photo.length; i += 4096) photo.writeUInt32LE(i, i);
  await check('otro navegador responde con un archivo de 9 MB: llega entero y queda escrito antes de confirmarlo', async () => {
    const p = await visitor.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(url);
    assert.equal(await p.locator('h1').innerText(), 'Merienda ñandú');
    await p.getByRole('textbox', { name: 'Tu fruta' }).fill('piña');
    await p.getByLabel('Una foto').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: photo });
    await p.getByRole('button', { name: 'Quitar foto.png' }).waitFor();
    await p.getByRole('button', { name: 'Enviar' }).click();
    await p.getByText('Respuesta enviada').waitFor({ timeout: 60000 });
    // already in the file when the confirmation is seen
    const r = saved().responses;
    assert.equal(r.length, 1);
    assert.equal(r[0].answers.q1, 'piña');
    assert.ok(Buffer.from(r[0].answers.q2[0].data, 'base64').equals(photo), 'el archivo llegó entero');
    await forms.getByRole('button', { name: /Recogiendo respuestas \(1\)/ }).waitFor();
    // once only: this browser is told it already answered
    await p.reload();
    await p.getByText('Ya has enviado tu respuesta.').waitFor();
    await p.close();
  });

  await check('lo que no es válido no se escribe, y las demás direcciones no dan nada', async () => {
    const send = (body, headers = {}) => fetch(`${url}/r`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body, signal: AbortSignal.timeout(20000) });
    const bad = await send(JSON.stringify({ format: 'novaforms-response', formId: 'fnativa', id: 'x1', answers: {} }));
    assert.deepEqual([bad.status, await bad.json()], [422, { ok: false, message: 'La respuesta está vacía.' }]);
    assert.equal((await send('{}', { Origin: 'http://malo.example' })).status, 403);
    assert.equal((await fetch(url.slice(0, -1))).status, 404);
    assert.equal((await fetch(new globalThis.URL('/', url))).status, 404);
    const rebound = await new Promise((resolve, reject) => http.get(url, { headers: { Host: 'malo.example' } }, (r) => (r.resume(), resolve(r.statusCode))).on('error', reject));
    assert.equal(rebound, 403);
    assert.equal(saved().responses.length, 1);
  });

  await check('los cambios del formulario llegan a la página que se sirve', async () => {
    await forms.getByRole('tab', { name: 'Diseño', exact: true }).click();
    await forms.getByRole('button', { name: 'Ajustes del formulario…', exact: true }).click();
    const d = forms.getByRole('dialog');
    await d.getByLabel('Admitir respuestas', { exact: true }).uncheck();
    await closeDialog(d);
    await until(async () => /"closed":true/.test(await (await fetch(url)).text()), 'la página no cambió');
  });

  await check('otra ventana no puede tocar lo que se recoge', async () => {
    await forms.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:webview|create_webview_window', { options: { label: 'forms-otra', url: 'index.html?app=forms', title: 'Otra' } }));
    await until(() => pages().length > 1, 'no se abrió la otra ventana');
    const other = pages().find((p) => p !== forms);
    await other.waitForSelector('.fm-app');
    await sleep(1500);
    const refused = await other.evaluate(() => window.__TAURI_INTERNALS__.invoke('forms_server_take', { id: 1 }).then(() => 'entregada', (e) => String(e)));
    assert.match(refused, /No se están recogiendo/);
    assert.ok(await listening(url), 'abrir otra ventana no para la primera');
  });

  await check('dejar de recoger cierra el puerto; al volver a empezar la dirección es otra', async () => {
    const d = await openDialog();
    await d.getByRole('button', { name: 'Dejar de recoger' }).click();
    await d.getByRole('button', { name: 'Empezar a recoger' }).waitFor();
    await closeDialog(d);
    await until(async () => !(await listening(url)), 'sigue escuchando');
    const again = await start();
    assert.notEqual(new globalThis.URL(again).pathname, new globalThis.URL(url).pathname);
    assert.equal((await fetch(new globalThis.URL(new globalThis.URL(url).pathname, again))).status, 404, 'la clave anterior ya no sirve');
    url = again;
  });

  await check('recargar la página de la ventana deja de escuchar', async () => {
    await forms.evaluate(() => (window.onbeforeunload = null));
    const reload = forms.reload({ waitUntil: 'load' }).catch(() => {});
    await until(() => dialogs.length > 0, 'recargar no preguntó').catch(() => {});
    for (const d of dialogs.splice(0)) await d.accept().catch(() => {});
    await reload;
    await forms.waitForSelector('.fm-app');
    await until(async () => !(await listening(url)), 'sigue escuchando tras recargar');
  });

  await check('cerrar la ventana pregunta; «Cancelar» sigue recogiendo y «Aceptar» cierra el puerto, con el programa abierto', async () => {
    await forms.evaluate(() => (document.hasFocus = () => true));
    // after reloading the form is a new one: it is saved nowhere until a file is opened, so this is the other window's turn
    const other = pages().find((p) => p !== forms);
    const second = path.join(dir, 'otra.novaforms');
    fs.writeFileSync(second, JSON.stringify({ format: 'novaforms', form: { ...form, id: 'fdos' }, responses: [] }));
    await forms.evaluate((p) => window.__TAURI_INTERNALS__.invoke('plugin:webview|create_webview_window', { options: { label: 'forms-tres', url: `index.html?app=forms&open=${encodeURIComponent(p)}`, title: 'Tres', decorations: false, width: 1100, height: 750 } }), second);
    await until(() => pages().length > 2, 'no se abrió la tercera ventana');
    const third = pages().find((p) => p !== forms && p !== other);
    third.setDefaultTimeout(15000);
    third.on('dialog', (d) => dialogs.push(d));
    await third.getByRole('tab', { name: 'Respuestas', exact: true }).waitFor();
    await sleep(1500);
    await third.getByRole('tab', { name: 'Respuestas', exact: true }).click();
    await third.getByRole('button', { name: 'Recoger por la red local…', exact: true }).click();
    await third.waitForFunction(() => document.querySelector('[role="dialog"] select')?.options.length > 0);
    await third.getByLabel('Dirección de este equipo').selectOption('127.0.0.1');
    await third.getByRole('button', { name: 'Empezar a recoger' }).click();
    const address = await third.getByLabel('Dirección para responder').inputValue();
    await third.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
    // minimized, it goes on taking responses and writing them down
    const windowCommand = (c) => third.evaluate((command) => window.__TAURI_INTERNALS__.invoke(`plugin:window|${command}`, { label: 'forms-tres' }), c);
    await windowCommand('minimize');
    await until(() => windowCommand('is_minimized'), 'no se minimizó');
    await sleep(3000);
    const began = Date.now();
    const sent = await fetch(`${address}/r`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'novaforms-response', formId: 'fdos', id: 'min1', answers: { q1: 'higo' } }), signal: AbortSignal.timeout(30000) });
    assert.equal(sent.status, 200, 'minimizada no contestó');
    assert.equal(JSON.parse(fs.readFileSync(second, 'utf8')).responses[0].answers.q1, 'higo');
    console.log(`      con la ventana minimizada contestó en ${Date.now() - began} ms`);
    await windowCommand('toggle_maximize');
    await sleep(1000);
    const close = () => third.getByRole('group', { name: 'Ventana' }).getByRole('button', { name: 'Cerrar ventana', exact: true }).click({ noWaitAfter: true });
    dialogs.length = 0;
    await close();
    await until(() => dialogs.length > 0, 'no preguntó');
    let d = dialogs.shift();
    assert.match(d.message(), /Se están recogiendo respuestas/);
    await d.dismiss();
    await sleep(800);
    assert.ok(!third.isClosed());
    assert.ok(await listening(address));
    await close();
    await until(() => dialogs.length > 0, 'no preguntó');
    d = dialogs.shift();
    await d.accept();
    await until(() => third.isClosed(), 'la ventana sigue abierta');
    await until(async () => !(await listening(address)), 'sigue escuchando tras cerrar la ventana');
    assert.ok(!forms.isClosed());
  });

  await check('desde Nova Mail: la respuesta adjunta pasa a otra ventana de Nova Forms y se añade a su formulario', async () => {
    // Mail with an account would connect: this only runs when there is none
    assert.ok(!fs.existsSync(path.join(process.env.APPDATA, 'org.suitenova.app', 'mail-accounts.json')), 'hay cuentas de correo: no se abre Nova Mail');
    const answerFile = JSON.stringify({ format: 'novaforms-response', formId: 'fcorreo', id: 'c1', at: '2026-05-04T10:00:00Z', answers: { q1: 'mora' } });
    const eml = path.join(dir, 'respuesta.eml');
    fs.writeFileSync(eml, `From: Ana <ana@x.test>
To: yo@x.test
Subject: Mi merienda
Date: Mon, 04 May 2026 10:00:00 GMT
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="l"

--l
Content-Type: text/plain

Va.
--l
Content-Type: application/json; name="respuesta-c1.json"
Content-Disposition: attachment; filename="respuesta-c1.json"
Content-Transfer-Encoding: base64

${Buffer.from(answerFile).toString('base64')}
--l--
`);
    const create = (label, url) => forms.evaluate((o) => window.__TAURI_INTERNALS__.invoke('plugin:webview|create_webview_window', { options: { ...o, title: o.label, decorations: false, width: 1200, height: 800 } }), { label, url });
    const ready = async (match, selector) => {
      const p = await windowFor(match, selector);
      p.on('dialog', (d) => d.accept().catch(() => {}));
      return p;
    };
    await create('mail-prueba', 'index.html?app=mail');
    const mail = await ready((u) => u.searchParams.get('app') === 'mail', '.ml-app');
    // imported with the command of Mail, found with the search of commands (the ribbon may be folded at this width)
    const chooser = mail.waitForEvent('filechooser');
    await mail.locator('#nv-tellme').fill('Importar mensajes (.eml)');
    await mail.keyboard.press('Enter');
    await (await chooser).setFiles(eml);
    await mail.locator('.ml-item', { hasText: 'Mi merienda' }).first().click();
    await mail.getByRole('button', { name: 'Pasar a Nova Forms', exact: true }).click();
    const before = pages();
    await mail.getByRole('button', { name: 'Abrir Nova Forms', exact: true }).click();
    await until(() => pages().length > before.length, 'no se abrió Nova Forms');
    const blank = pages().find((p) => !before.includes(p));
    await blank.getByText('Hay 1 respuesta del correo para otro formulario.', { exact: false }).waitFor({ timeout: 20000 });
    const target = path.join(dir, 'correo.novaforms');
    fs.writeFileSync(target, JSON.stringify({ format: 'novaforms', form: { ...form, id: 'fcorreo' }, responses: [] }));
    await create('forms-correo', `index.html?app=forms&open=${encodeURIComponent(target)}`);
    const owner = await ready((u) => (u.searchParams.get('open') ?? '').endsWith('correo.novaforms'), '.fm-app');
    const banner = owner.getByRole('region', { name: 'Respuestas del correo' });
    await banner.getByText('Nova Mail dejó 1 respuesta para este formulario.').waitFor({ timeout: 20000 });
    await banner.getByRole('button', { name: 'Añadirlas', exact: true }).click();
    await banner.waitFor({ state: 'detached' });
    // the window of the other form hears that nothing is left
    await blank.getByRole('region', { name: 'Respuestas del correo' }).waitFor({ state: 'detached' });
    await until(() => JSON.parse(fs.readFileSync(target, 'utf8')).responses.length === 1, 'no se guardó solo');
    assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).responses[0].answers.q1, 'mora');
  });

  await check('resultados en la aplicación compilada: el gráfico circular se dibuja con sus colores y el resumen se prepara para imprimir', async () => {
    const results = path.join(dir, 'resultados.novaforms');
    const fruit = question('q1', 'choice', 'Fruta', { options: ['Mango', 'Piña'], chart: 'pie' });
    fs.writeFileSync(results, JSON.stringify({ format: 'novaforms', form: { ...form, id: 'fres', questions: [fruit] }, responses: ['Mango', 'Mango', 'Piña'].map((v, i) => ({ id: `g${i}`, at: '2026-05-04T10:00:00Z', seconds: 30, answers: { q1: v } })) }));
    await forms.evaluate((p) => window.__TAURI_INTERNALS__.invoke('plugin:webview|create_webview_window', { options: { label: 'forms-resultados', url: `index.html?app=forms&open=${encodeURIComponent(p)}`, title: 'Resultados', decorations: false, width: 1200, height: 800 } }), results);
    const win = await windowFor((u) => (u.searchParams.get('open') ?? '').endsWith('resultados.novaforms'), '.fm-app');
    await win.getByRole('tab', { name: 'Vista', exact: true }).click();
    await win.getByRole('button', { name: 'Resultados', exact: true }).click();
    const picture = win.locator('.fm-chart img');
    assert.ok(await picture.evaluate(async (i) => (await i.decode(), i.naturalWidth > 100)), 'el gráfico no se abre');
    const svg = decodeURIComponent(await picture.getAttribute('src'));
    for (const color of ['#3b82c4', '#e8833a']) assert.ok(svg.includes(`fill="${color}"`), color);
    if (shotsDir) await win.screenshot({ path: `${shotsDir}/nativa-resultados.png` });
    // the printer of the system is not opened here: only what would be printed is looked at
    await win.evaluate(() => { window.__printed = new Promise((r) => new MutationObserver(() => { const f = document.querySelector('iframe.ml-print'); if (f) { f.addEventListener('load', () => (f.contentWindow.print = () => {}), { once: true }); r(f.srcdoc); } }).observe(document.body, { childList: true })); });
    await win.getByRole('button', { name: 'Imprimir el resumen', exact: true }).click();
    const printed = await win.evaluate(() => window.__printed);
    assert.match(printed, /Tiempo medio para responder: 0:30[\s\S]*<img /);
    await sleep(800);
  });
} finally {
  await outside?.close().catch(() => {});
  await app?.close().catch(() => {});
  proc.kill();
  await sleep(1500);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}

const failed = results.filter((r) => r[0] !== 'ok').length;
if (errors.length) console.log('Console errors:', errors.slice(0, 8));
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed || errors.length ? 1 : 0);
