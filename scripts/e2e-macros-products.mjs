// End-to-end checks for the macros of Slides and Mail (shared editor, PowerPoint and Outlook object models, persistence). Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-macros-products.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const page = await ctx.newPage();
const errors = [];
const dialogs = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => {
  dialogs.push(d.message());
  d.accept();
});
let step = 0;
const shot = async (name) => {
  if (!shotsDir) return;
  await page.waitForTimeout(250);
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
const settle = (ms = 400) => page.waitForTimeout(ms);
const NL = String.fromCharCode(10);
const lines = (...l) => l.join(NL);

const writeInEditor = async (code) => {
  await page.getByRole('button', { name: 'Nuevo módulo' }).click();
  await page.locator('textarea.nv-mac__code').fill(code);
  await settle();
};

// ------------------------------------------------------------------------------------------------ Slides
const SLIDES_CODE = lines(
  'Sub Titulos()',
  '  Dim s, t, i',
  '  For i = 1 To 2',
  '    Set s = ActivePresentation.Slides.Add(ActivePresentation.Slides.Count + 1, ppLayoutBlank)',
  '    Set t = s.Shapes.AddTextbox(msoTextOrientationHorizontal, 60, 60, 500, 60)',
  '    t.Name = "Titulo" & i',
  '    t.TextFrame.TextRange.Text = "Diapositiva " & i',
  '    t.TextFrame.TextRange.Font.Size = 36',
  '    t.TextFrame.TextRange.Font.Bold = True',
  '  Next i',
  '  Debug.Print "diapositivas: " & ActivePresentation.Slides.Count',
  'End Sub',
  '',
);

await check('Slides: Programador › Editor de código: escribir una macro, ejecutarla y ver las diapositivas', async () => {
  await page.goto(`${BASE}?app=slides`, { waitUntil: 'load' });
  await page.waitForSelector('.sl-app');
  await settle(800);
  await page.getByRole('tab', { name: 'Programador', exact: true }).click();
  await page.getByRole('button', { name: 'Editor de código…' }).click();
  await writeInEditor(SLIDES_CODE);
  await page.getByRole('button', { name: 'Ejecutar', exact: true }).first().click();
  await page.locator('.nv-mac__ok').waitFor();
  assert.match(await page.locator('.nv-mac__out').innerText(), /diapositivas: 3/);
  await shot('slides-ejecutada');
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await settle();
  const state = await page.evaluate(() => {
    const c = window.__novaSlides.ctl;
    return { n: c.realDeck.slides.length, name: c.realDeck.slides[2].shapes[0].name };
  });
  assert.deepEqual(state, { n: 3, name: 'Titulo2' });
  // one undo reverts everything the macro did
  await page.evaluate(() => window.__novaSlides.ctl.undo());
  assert.equal(await page.evaluate(() => window.__novaSlides.ctl.realDeck.slides.length), 1);
  await page.evaluate(() => window.__novaSlides.ctl.redo());
  assert.equal(await page.evaluate(() => window.__novaSlides.ctl.realDeck.slides.length), 3);
});

await check('Slides: las macros viajan en el .pptx y al abrirlo están deshabilitadas hasta habilitar el contenido', async () => {
  const bytes = await page.evaluate(() => window.__novaSlides.write());
  await page.evaluate(async (b) => window.__novaSlides.load(b, 'con-macros.pptx'), bytes);
  await settle(500);
  assert.deepEqual(await page.evaluate(() => ({ modules: window.__novaSlides.ctl.macros.map((m) => m.name), enabled: window.__novaSlides.ctl.contentEnabled })), { modules: ['Modulo1'], enabled: false });
  assert.ok(await page.locator('.sl-secbar').count());
  await shot('slides-barra-seguridad');
  // disabled: it does not run
  const blocked = await page.evaluate(() => window.__novaSlides.ctl.macroRt.run('Titulos'));
  assert.equal(blocked.ok, false);
  await page.locator('.sl-secbar').getByRole('button', { name: 'Habilitar contenido' }).click();
  assert.equal(await page.locator('.sl-secbar').count(), 0);
  const ok = await page.evaluate(() => window.__novaSlides.ctl.macroRt.run('Titulos'));
  assert.equal(ok.ok, true, ok.error);
  assert.equal(await page.evaluate(() => window.__novaSlides.ctl.realDeck.slides.length), 5);
});

await check('Slides: el cuadro «Macros» lista la macro y «Paso a paso» la depura', async () => {
  await page.getByRole('tab', { name: 'Programador', exact: true }).click();
  await page.getByRole('button', { name: 'Macros…' }).first().click();
  await page.getByRole('option', { name: /Titulos/ }).click();
  await page.getByRole('button', { name: 'Paso a paso', exact: true }).click();
  await page.getByRole('region', { name: 'Depuración' }).waitFor();
  await page.getByRole('button', { name: 'Paso a paso por instrucciones' }).click();
  await page.getByRole('button', { name: 'Paso a paso por instrucciones' }).click();
  const names = await page.getByRole('region', { name: 'Variables' }).locator('tbody tr').allInnerTexts();
  assert.ok(names.some((r) => /^s\t/.test(r) || /^i\t/.test(r)), names.join('|'));
  await page.getByRole('button', { name: 'Detener' }).click();
  await page.getByRole('button', { name: 'Cerrar' }).click();
});

// ------------------------------------------------------------------------------------------------ Mail
const MAIL_CODE = lines(
  'Sub ContarNoLeidos()',
  '  Dim c, m, n',
  '  Set c = Application.GetNamespace("MAPI").GetDefaultFolder(olFolderInbox)',
  '  For Each m In c.Items',
  '    If m.UnRead Then n = n + 1',
  '  Next',
  '  Debug.Print "sin leer: " & n & " de " & c.Items.Count',
  '  c.Items.Restrict("[Subject] = ' + "'Reunión'" + '").Item(1).UnRead = False',
  'End Sub',
  'Sub Application_Startup()',
  '  Debug.Print "arrancó Nova Mail"',
  'End Sub',
  '',
);
const eml = (from, subject, body) => ['From: ' + from + ' <' + from.toLowerCase() + '@x.test>', 'To: yo@nova.test', 'Subject: ' + subject, 'Date: Mon, 02 Mar 2026 10:00:00 +0000', 'Message-ID: <' + subject + '@x.test>', 'Content-Type: text/plain; charset=utf-8', '', body, ''].join('\r\n');

await check('Mail: escribir una macro con los objetos de Outlook, ejecutarla y ver su efecto en los mensajes', async () => {
  await page.goto(`${BASE}?app=mail`, { waitUntil: 'load' });
  await page.waitForSelector('.nw-app, [role=tablist]');
  await settle(800);
  await page.evaluate((m) => {
    const c = window.__novaMail.ctl;
    c.setOwner({ name: 'Yo', email: 'yo@nova.test' });
    c.importRaw(m[0], 'inbox', { read: false });
    c.importRaw(m[1], 'inbox', { read: false });
    c.importRaw(m[2], 'inbox', { read: true });
  }, [eml('Ana', 'Reunión', 'A las diez'), eml('Luis', 'Factura', 'Adjunta'), eml('Eva', 'Viejo', 'Ya leído')]);
  await page.getByRole('tab', { name: 'Programador', exact: true }).click();
  await page.getByRole('button', { name: 'Editor de código…' }).click();
  await writeInEditor(MAIL_CODE);
  await page.getByRole('combobox', { name: 'Procedimiento que se ejecuta' }).selectOption('ContarNoLeidos');
  await page.getByRole('button', { name: 'Ejecutar', exact: true }).first().click();
  await page.locator('.nv-mac__ok').waitFor();
  assert.match(await page.locator('.nv-mac__out').innerText(), /sin leer: 2 de 3/);
  await shot('mail-ejecutada');
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await settle();
  const unread = await page.evaluate(() => window.__novaMail.ctl.data.messages.filter((m) => !m.read).map((m) => m.subject));
  assert.deepEqual(unread, ['Factura']);
});

await check('Mail: las macros pertenecen al programa: sobreviven a recargar y Application_Startup corre al arrancar', async () => {
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('[role=tablist]');
  await settle(800);
  const state = await page.evaluate(() => ({ modules: window.__novaMail.ctl.macros.map((m) => m.name), out: window.__novaMail.ctl.macroRt.console }));
  assert.deepEqual(state.modules, ['Modulo1']);
  assert.ok(state.out.some((l) => l.includes('arrancó Nova Mail')), state.out.join('|'));
});

await check('Mail: la seguridad de macros las impide, y enviar pide permiso', async () => {
  await page.getByRole('tab', { name: 'Programador', exact: true }).click();
  await page.getByRole('button', { name: 'Seguridad de macros' }).click();
  const off = await page.evaluate(() => ({ enabled: window.__novaMail.ctl.macrosEnabled, r: window.__novaMail.ctl.macroRt.run('ContarNoLeidos') }));
  assert.equal(off.enabled, false);
  assert.equal(off.r.ok, false);
  await page.getByRole('button', { name: 'Seguridad de macros' }).click();
  // sending: the macro asks (the page accepts every confirm, so refuse this one by hand)
  page.removeAllListeners('dialog');
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    d.dismiss();
  });
  const r = await page.evaluate(() => {
    const c = window.__novaMail.ctl;
    c.accounts = [{ id: 'a1', name: 'Yo', email: 'yo@nova.test' }];
    c.macros = [{ name: 'Enviar', code: 'Sub Enviar()\n  Dim m\n  Set m = Application.CreateItem(olMailItem)\n  m.To = "ana@x.test"\n  m.Send\nEnd Sub' }];
    return c.macroRt.run('Enviar');
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /denegó/);
  assert.ok(dialogs.some((d) => /enviar un mensaje de correo en tu nombre/.test(d)));
});

await check('sin errores de consola', async () => assert.deepEqual(errors, []));
await browser.close();
for (const r of results) console.log(r[0] === 'ok' ? '✔' : '✘', r[1], r[2] ?? '');
process.exit(results.some((r) => r[0] !== 'ok') ? 1 : 0);
