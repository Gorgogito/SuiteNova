// End-to-end checks for the trust centre and the global library of the macros (shared dialog, library by product, levels, signature). Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-macros-security.mjs [--shots dir]
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
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => d.accept());
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
const planCtl = (fn, arg) => page.evaluate(([src, a]) => new Function('ctl', 'a', `return (${src})(ctl, a)`)(window.__novaPlan.ctl, a), [fn.toString(), arg]);

const openPlan = async () => {
  await page.goto(`${BASE}?app=plan`, { waitUntil: 'load' });
  await page.waitForSelector('.pl-app');
  await settle(800);
  await page.getByRole('tab', { name: 'Programador', exact: true }).click();
};

// start from a clean profile of the browser (localStorage is the settings of the program)
await page.goto(`${BASE}?app=plan`, { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());

await check('Plan: la biblioteca global — un módulo movido a ella se ve y se ejecuta desde otro archivo', async () => {
  await openPlan();
  await page.getByRole('button', { name: 'Editor de código…' }).click();
  await page.getByRole('button', { name: 'Nuevo módulo' }).click();
  await page.locator('textarea.nv-mac__code').fill(lines('Function Doble(x)', '  Doble = x * 2', 'End Function', 'Sub Saluda()', '  Debug.Print "hola"', 'End Sub', ''));
  await settle();
  await page.getByRole('button', { name: 'Mover a la biblioteca global' }).click();
  await settle();
  await shot('biblioteca-modulo-global');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('nova.macros.library.plan')).map((m) => m.name)), ['Modulo1']);
  assert.equal(await planCtl((c) => c.macros.length), 0);
  await page.getByRole('button', { name: 'Cerrar' }).click();
  // another file (a reload is a new project): the macro of the file calls the function of the library
  await openPlan();
  await page.getByRole('button', { name: 'Editor de código…' }).click();
  await page.getByRole('button', { name: 'Nuevo módulo' }).click();
  await page.locator('textarea.nv-mac__code').fill(lines('Sub Usa()', '  Debug.Print "doble: " & Doble(21)', 'End Sub', ''));
  await settle();
  await page.getByRole('button', { name: 'Ejecutar', exact: true }).first().click();
  await page.locator('.nv-mac__ok').waitFor();
  assert.match(await page.locator('.nv-mac__out').innerText(), /doble: 42/);
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await page.getByRole('button', { name: 'Macros…' }).first().click();
  assert.ok(await page.getByRole('option', { name: /Saluda.*global/ }).count());
  await shot('biblioteca-lista');
  await page.getByRole('button', { name: 'Cerrar' }).click();
});

await check('Diagram: la biblioteca de Plan no aparece en otro producto', async () => {
  await page.goto(`${BASE}?app=diagram`, { waitUntil: 'load' });
  await page.waitForSelector('.dg-app');
  await settle(800);
  const procs = await page.evaluate(() => window.__novaDiagram.ctl.macroRt.procedures().map((p) => p.name));
  assert.deepEqual(procs, []);
});

await check('Seguridad de macros: crear un certificado, firmar y ver el estado de la firma', async () => {
  await openPlan();
  await page.getByRole('button', { name: 'Editor de código…' }).click();
  await page.getByRole('button', { name: 'Nuevo módulo' }).click();
  await page.locator('textarea.nv-mac__code').fill(lines('Sub Firmada()', '  Debug.Print "hola firmada"', 'End Sub', ''));
  await settle();
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await page.getByRole('button', { name: 'Centro de confianza…' }).click();
  await page.getByText('Las macros de este archivo no están firmadas.').waitFor();
  await page.getByLabel('Nombre del publicador').fill('Ana Pérez');
  await page.getByRole('button', { name: 'Crear certificado' }).click();
  await page.getByRole('list', { name: 'Certificados personales' }).getByText('Ana Pérez').waitFor();
  await page.getByRole('button', { name: 'Firmar las macros' }).click();
  await page.getByText(/Firmadas por «Ana Pérez», que no es un publicador de confianza/).waitFor();
  await shot('firma-no-confiable');
  await page.getByRole('button', { name: 'Confiar en este publicador' }).click();
  await page.getByText(/Firmadas por «Ana Pérez», un publicador de confianza/).waitFor();
  await page.getByRole('button', { name: 'Cerrar' }).click();
});

await check('Un archivo firmado por un publicador de confianza se abre con las macros habilitadas; si se cambia el código, no', async () => {
  const text = await planCtl((c) => JSON.stringify({ format: 'novaplan', ...c.saved }));
  assert.match(text, /\$Firma/);
  await page.evaluate((t) => window.__novaPlan.load(t, 'firmado.novaplan'), text);
  await settle(600);
  assert.equal(await planCtl((c) => c.contentEnabled), true);
  assert.equal(await page.locator('.pl-secbar').count(), 0);
  const r = await planCtl((c) => c.macroRt.run('Firmada'));
  assert.equal(r.ok, true, r.error);
  // the same file with one character of the code changed: the signature is not valid and it opens disabled
  const tampered = text.replace('hola firmada', 'hola cambiada');
  await page.evaluate((t) => window.__novaPlan.load(t, 'cambiado.novaplan'), tampered);
  await settle(600);
  assert.equal(await planCtl((c) => c.contentEnabled), false);
  assert.ok(await page.locator('.pl-secbar').count());
  await shot('firma-invalida-barra');
});

await check('Niveles: «solo firmadas» rechaza lo no firmado y «deshabilitar todas» lo rechaza todo; los lugares de confianza abren habilitado', async () => {
  await page.getByRole('button', { name: 'Centro de confianza…' }).click();
  await page.getByRole('radio', { name: /excepto las firmadas/ }).check();
  await page.getByLabel('Carpeta de confianza').fill('C:\\Confianza');
  await page.getByRole('button', { name: 'Agregar lugar' }).click();
  await page.getByRole('list', { name: 'Lugares de confianza' }).getByText('C:\\Confianza').waitFor();
  await shot('niveles');
  await page.getByRole('button', { name: 'Cerrar' }).click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('nova.macros.security')).level), 'signed');
  await page.evaluate(() => {
    const c = window.__novaPlan.ctl;
    c.macros = [{ name: 'Modulo1', code: 'Sub NoFirmada()\nEnd Sub\n' }];
    c.contentEnabled = true;
  });
  const un = await planCtl((c) => c.macroRt.run('NoFirmada'));
  assert.equal(un.ok, false);
  assert.match(un.error, /firmadas por un publicador de confianza/);
  await page.evaluate(() => localStorage.setItem('nova.macros.security', JSON.stringify({ level: 'off', locations: [], publishers: [] })));
  const off = await planCtl((c) => c.macroRt.run('NoFirmada'));
  assert.equal(off.ok, false);
  assert.match(off.error, /deshabilitadas en el Centro de confianza/);
  // a file from a trusted folder opens enabled at the usual level
  await page.evaluate(() => localStorage.setItem('nova.macros.security', JSON.stringify({ level: 'warn', locations: ['C:\\Confianza'], publishers: [] })));
  const sample = JSON.stringify({ format: 'novaplan', ...(await planCtl((c) => c.saved)), macros: [{ name: 'M', code: 'Sub X()\nEnd Sub\n' }] });
  await page.evaluate(
    ([t]) => {
      const c = window.__novaPlan.ctl;
      c.load(JSON.parse(t), 'a.novaplan', 'C:\\Confianza\\sub\\a.novaplan');
    },
    [sample],
  );
  await settle(300);
  assert.equal(await planCtl((c) => c.contentEnabled), true);
});

await browser.close();
let failed = 0;
for (const r of results) {
  if (r[0] === 'FAIL') failed++;
  console.log(`${r[0] === 'ok' ? '✓' : '✗'} ${r[1]}${r[2] ? `\n    ${r[2]}` : ''}`);
}
if (errors.length) {
  console.log('Errores de consola:', errors.slice(0, 5));
  failed++;
}
console.log(`${results.length - results.filter((r) => r[0] === 'FAIL').length}/${results.length} correctas`);
process.exit(failed ? 1 : 0);
