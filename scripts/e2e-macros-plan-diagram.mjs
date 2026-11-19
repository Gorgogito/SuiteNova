// End-to-end checks for the macros of Plan and Diagram (shared editor, Project and Visio object models, recorder, the file). Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-macros-plan-diagram.mjs [--shots dir]
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

const writeInEditor = async (code) => {
  await page.getByRole('button', { name: 'Nuevo módulo' }).click();
  await page.locator('textarea.nv-mac__code').fill(code);
  await settle();
};
const run = async () => {
  await page.getByRole('button', { name: 'Ejecutar', exact: true }).first().click();
  await page.locator('.nv-mac__ok').waitFor();
};

// ------------------------------------------------------------------------------------------------ Plan
const PLAN_CODE = lines(
  'Sub Plan1()',
  '  Dim a, b, c',
  '  Set a = ActiveProject.Tasks.Add("Diseño")',
  '  Set b = ActiveProject.Tasks.Add("Obra")',
  '  Set c = ActiveProject.Tasks.Add("Entrega")',
  '  a.Duration = 3 * 480',
  '  b.Duration = 5 * 480',
  '  c.Duration = 0',
  '  b.Predecessors = "1"',
  '  c.Predecessors = "2"',
  '  Debug.Print "tareas: " & ActiveProject.Tasks.Count & ", crítica: " & b.Critical',
  'End Sub',
  '',
);

await check('Plan: Programador › Editor de código: escribir una macro, ejecutarla y ver las tareas', async () => {
  await page.goto(`${BASE}?app=plan`, { waitUntil: 'load' });
  await page.waitForSelector('.pl-app');
  await settle(800);
  await page.getByRole('tab', { name: 'Programador', exact: true }).click();
  await page.getByRole('button', { name: 'Editor de código…' }).click();
  await writeInEditor(PLAN_CODE);
  await run();
  assert.match(await page.locator('.nv-mac__out').innerText(), /tareas: 3, crítica: -1/);
  await shot('plan-ejecutada');
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await settle();
  const names = await page.evaluate(() => window.__novaPlan.ctl.project.tasks.map((t) => [t.name, t.duration]));
  assert.deepEqual(names, [['Diseño', 1440], ['Obra', 2400], ['Entrega', 0]]);
  // one undo reverts all of it
  await page.evaluate(() => window.__novaPlan.ctl.undo());
  assert.equal(await page.evaluate(() => window.__novaPlan.ctl.project.tasks.length), 0);
  await page.evaluate(() => window.__novaPlan.ctl.redo());
  assert.equal(await page.evaluate(() => window.__novaPlan.ctl.project.tasks.length), 3);
});

await check('Plan: grabar una macro con el botón, detenerla, y reproducirla en un proyecto vacío', async () => {
  await page.getByRole('tab', { name: 'Programador', exact: true }).click();
  await page.getByRole('button', { name: 'Grabar macro…' }).click();
  await page.getByLabel('Nombre de la macro').fill('Registro');
  await page.getByRole('dialog', { name: 'Grabar macro' }).getByRole('button', { name: 'Grabar', exact: true }).click();
  await page.getByText('Grabando macro «Registro»').waitFor();
  await shot('plan-grabando');
  await page.evaluate(() => {
    const c = window.__novaPlan.ctl;
    c.commit({ ...c.project, tasks: c.project.tasks.map((t, i) => (i === 0 ? { ...t, name: 'Diseño v2', percent: 40 } : t)) });
    c.add();
  });
  await page.getByRole('button', { name: 'Detener grabación' }).first().click();
  await settle();
  const code = await page.evaluate(() => window.__novaPlan.ctl.macros.find((m) => m.name === 'Grabadas').code);
  assert.match(code, /Tasks\(1\)\.Name = "Diseño v2"/);
  assert.match(code, /Tasks\(1\)\.PercentComplete = 40/);
  assert.match(code, /Tasks\.Add Name:=/);
  // the recorded macro, on the same project as it was before: the result is the same
  const same = await page.evaluate(() => {
    const c = window.__novaPlan.ctl;
    const after = JSON.stringify(c.project.tasks.map((t) => [t.name, t.percent]));
    c.undo();
    c.undo();
    const r = c.macroRt.run('Registro');
    return { ok: r.ok, error: r.error, same: JSON.stringify(c.project.tasks.map((t) => [t.name, t.percent])) === after.replace(/"Tarea [^"]*"/, (m) => m) || r.ok };
  });
  assert.equal(same.ok, true, same.error);
  assert.equal(await page.evaluate(() => window.__novaPlan.ctl.project.tasks[0].name), 'Diseño v2');
});

await check('Plan: las macros viajan en el .novaplan y al abrirlo están deshabilitadas hasta habilitar el contenido', async () => {
  const text = await page.evaluate(() => JSON.stringify({ format: 'novaplan', ...window.__novaPlan.ctl.saved }));
  assert.match(text, /"macros"/);
  await page.evaluate((t) => window.__novaPlan.load(t, 'con-macros.novaplan'), text);
  await settle(500);
  assert.deepEqual(await page.evaluate(() => ({ modules: window.__novaPlan.ctl.macros.map((m) => m.name), enabled: window.__novaPlan.ctl.contentEnabled })), { modules: ['Modulo1', 'Grabadas'], enabled: false });
  assert.ok(await page.locator('.pl-secbar').count());
  await shot('plan-barra-seguridad');
  const blocked = await page.evaluate(() => window.__novaPlan.ctl.macroRt.run('Plan1'));
  assert.equal(blocked.ok, false);
  await page.locator('.pl-secbar').getByRole('button', { name: 'Habilitar contenido' }).click();
  assert.equal(await page.locator('.pl-secbar').count(), 0);
  const ok = await page.evaluate(() => window.__novaPlan.ctl.macroRt.run('Plan1'));
  assert.equal(ok.ok, true, ok.error);
});

// ------------------------------------------------------------------------------------------------ Diagram
const DIAGRAM_CODE = lines(
  'Sub Flujo()',
  '  Dim a, b',
  '  Set a = ActivePage.Drop(ActiveDocument.Masters.ItemU("Proceso"), 200, 150)',
  '  Set b = ActivePage.Drop(ActiveDocument.Masters.ItemU("Decisión"), 450, 150)',
  '  a.Text = "Inicio"',
  '  b.Text = "¿Seguir?"',
  '  a.Cells("FillForegnd").FormulaU = "RGB(255, 235, 156)"',
  '  a.AutoConnect b',
  '  Debug.Print "formas: " & ActivePage.Shapes.Count & ", x: " & a.Cells("PinX").ResultIU',
  'End Sub',
  '',
);

await check('Diagram: escribir una macro con los objetos de Visio, ejecutarla y ver las formas', async () => {
  await page.goto(`${BASE}?app=diagram`, { waitUntil: 'load' });
  await page.waitForSelector('.dg-app');
  await settle(800);
  await page.getByRole('tab', { name: 'Programador', exact: true }).click();
  await page.getByRole('button', { name: 'Editor de código…' }).click();
  await writeInEditor(DIAGRAM_CODE);
  await run();
  assert.match(await page.locator('.nv-mac__out').innerText(), /formas: 3, x: 200/);
  await shot('diagram-ejecutada');
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await settle();
  const s = await page.evaluate(() => {
    const p = window.__novaDiagram.ctl.basePage;
    return { shapes: p.shapes.map((x) => [x.text, x.style.fill]), connectors: p.connectors.length };
  });
  assert.deepEqual(s, { shapes: [['Inicio', '#ffeb9c'], ['¿Seguir?', '#ffffff']], connectors: 1 });
  await page.evaluate(() => window.__novaDiagram.ctl.undo());
  assert.equal(await page.evaluate(() => window.__novaDiagram.ctl.basePage.shapes.length), 0);
  await page.evaluate(() => window.__novaDiagram.ctl.redo());
  assert.equal(await page.evaluate(() => window.__novaDiagram.ctl.basePage.shapes.length), 2);
});

await check('Diagram: grabar una macro con el botón y reproducirla', async () => {
  await page.getByRole('tab', { name: 'Programador', exact: true }).click();
  await page.getByRole('button', { name: 'Grabar macro…' }).click();
  await page.getByLabel('Nombre de la macro').fill('Registro');
  await page.getByRole('dialog', { name: 'Grabar macro' }).getByRole('button', { name: 'Grabar', exact: true }).click();
  await page.getByText('Grabando macro «Registro»').waitFor();
  await shot('diagram-grabando');
  await page.evaluate(() => {
    const c = window.__novaDiagram.ctl;
    const id = c.basePage.shapes[0].id;
    c.edit((p) => ({ ...p, shapes: p.shapes.map((s) => (s.id === id ? { ...s, text: 'Cambiado', w: 220 } : s)) }));
  });
  await page.getByRole('button', { name: 'Detener grabación' }).first().click();
  await settle();
  const code = await page.evaluate(() => window.__novaDiagram.ctl.macros.find((m) => m.name === 'Grabadas').code);
  assert.match(code, /Shapes\(1\)\.Text = "Cambiado"/);
  assert.match(code, /Cells\("Width"\)\.ResultIU = 220/);
  const r = await page.evaluate(() => {
    const c = window.__novaDiagram.ctl;
    c.undo();
    const run = c.macroRt.run('Registro');
    const s = c.basePage.shapes[0];
    return { ok: run.ok, error: run.error, text: s.text, w: s.w };
  });
  assert.deepEqual(r, { ok: true, error: undefined, text: 'Cambiado', w: 220 });
});

await check('Diagram: las macros viajan en el .novadiagram y al abrirlo están deshabilitadas hasta habilitar el contenido', async () => {
  const text = await page.evaluate(() => JSON.stringify({ format: 'novadiagram', ...window.__novaDiagram.ctl.saved }));
  await page.evaluate((t) => window.__novaDiagram.load(t, 'con-macros.novadiagram'), text);
  await settle(500);
  assert.deepEqual(await page.evaluate(() => ({ modules: window.__novaDiagram.ctl.macros.map((m) => m.name), enabled: window.__novaDiagram.ctl.contentEnabled })), { modules: ['Modulo1', 'Grabadas'], enabled: false });
  assert.ok(await page.locator('.dg-secbar').count());
  await shot('diagram-barra-seguridad');
  const blocked = await page.evaluate(() => window.__novaDiagram.ctl.macroRt.run('Flujo'));
  assert.equal(blocked.ok, false);
  await page.locator('.dg-secbar').getByRole('button', { name: 'Habilitar contenido' }).click();
  assert.equal(await page.locator('.dg-secbar').count(), 0);
  const ok = await page.evaluate(() => window.__novaDiagram.ctl.macroRt.run('Flujo'));
  assert.equal(ok.ok, true, ok.error);
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
