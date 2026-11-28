// Nova Diagram against Visio, phase 1: the faults of the application, in a real browser (Edge). Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-diagram-fixes.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=diagram';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 }, acceptDownloads: true });
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
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
};
const results = [];
const check = async (name, fn) => {
  try {
    await reset();
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 7).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};
const ev = (fn, arg) => page.evaluate(fn, arg);
const settle = (ms = 150) => page.waitForTimeout(ms);
const reset = async () => {
  await page.keyboard.press('Escape');
  await ev(() => { const c = window.__novaDiagram.ctl; c.reset(); c.setZoom(100); });
  await settle();
};
const add = (s, x, y) => ev(([s, x, y]) => window.__novaDiagram.ctl.addStencil(s, { x, y }).id, [s, x, y]);
const box = async (sel) => page.locator(sel).first().boundingBox();
const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const at = async (id) => center(await box(`[data-shape-id="${id}"] path`));
const drag = async (a, b) => {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await settle();
};
const status = () => page.locator('[aria-live="polite"]').filter({ hasText: 'Guardado' }).count();
const saveFile = async () => {
  const wait = page.waitForEvent('download', { timeout: 5000 });
  await page.keyboard.press('Control+s');
  return JSON.parse(fs.readFileSync(await (await wait).path(), 'utf8'));
};
const closeAsks = () => ev(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });

await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForSelector('.dg-app', { timeout: 90000 });

await check('printing: each page keeps its own sheet size', async () => {
  await add('process', 300, 200);
  await ev(() => { const c = window.__novaDiagram.ctl; c.newPage(); c.setPageProps({ width: 794, height: 1123 }); c.addStencil('process', { x: 400, y: 1000 }); c.newPage(); c.setPageProps({ width: 1123, height: 794 }); });
  await ev(() => {
    window.__printed = null;
    new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.tagName === 'IFRAME') window.__printed = n.srcdoc; }).observe(document.body, { childList: true });
  });
  // the print dialog of the frame would stop the browser: the HTML is taken and printed to PDF apart
  await ev(() => { const make = document.createElement.bind(document); document.createElement = (t, o) => { const el = make(t, o); if (t === 'iframe') el.addEventListener('load', () => { el.contentWindow.print = () => {}; }, { capture: true }); return el; }; });
  await page.keyboard.press('Control+p');
  await settle(600);
  const html = await ev(() => window.__printed);
  assert.ok(html, 'no print document');
  const other = await ctx.newPage();
  await other.setContent(html);
  const pdf = await other.pdf({ preferCSSPageSize: true });
  await other.close();
  const sheets = [...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[([^\]]*)\]/g)].map((m) => m[1].trim().split(/\s+/).slice(2).map((v) => Math.round(Number(v))));
  assert.equal(sheets.length, 3, `sheets: ${JSON.stringify(sheets)}`);
  assert.deepEqual(sheets.map(([w, h]) => w > h), [true, false, true], JSON.stringify(sheets));
});

await check('save while typing keeps the text and the editor; closing asks', async () => {
  const a = await add('process', 300, 250);
  await ev(() => window.__novaDiagram.ctl.markSaved('antes.novadiagram', null));
  assert.equal(await closeAsks(), false);
  const p = await at(a);
  await page.mouse.dblclick(p.x, p.y);
  await page.locator('textarea.dg-editor').fill('Texto a medias');
  assert.equal(await closeAsks(), true, 'closing with text typed must ask');
  assert.equal(await status(), 0, 'still says saved');
  const file = await saveFile();
  assert.equal(file.pages[0].shapes[0].text, 'Texto a medias');
  assert.equal(await page.locator('textarea.dg-editor').count(), 1, 'the editor stays open');
  assert.equal(await closeAsks(), false);
  assert.equal(await status(), 1);
  await shot('guardado-mientras-se-escribe');
  await page.keyboard.type(' y más');
  assert.equal(await closeAsks(), true);
  await page.keyboard.press('Control+Enter');
  assert.equal(await ev(() => window.__novaDiagram.ctl.basePage.shapes[0].text), 'Texto a medias y más');
});

await check('save while renaming a lane or a layer keeps the name', async () => {
  await ev(() => { const c = window.__novaDiagram.ctl; const s = c.addStencil('pool', { x: 500, y: 350 }); c.startLaneEdit(s.id, s.container.lanes[0].id); });
  await page.locator('input.dg-laneeditor').fill('Almacén');
  assert.equal((await saveFile()).pages[0].shapes[0].container.lanes[0].title, 'Almacén');
  await reset();
  await ev(() => window.__novaDiagram.ctl.togglePane('layers'));
  await page.locator('[data-testid="layers-pane"] .dg-layername').first().dblclick();
  await page.locator('[data-testid="layers-pane"] .dg-layername input').fill('Planos');
  assert.equal((await saveFile()).pages[0].layers[0].name, 'Planos');
  await ev(() => window.__novaDiagram.ctl.togglePane('layers'));
});

await check('status bar: «Guardado» goes away when the diagram changes', async () => {
  await add('process', 300, 250);
  assert.equal(await status(), 0);
  await saveFile();
  await settle();
  assert.equal(await status(), 1);
  await add('process', 600, 250);
  await settle();
  assert.equal(await status(), 0);
});

await check('the end of a glued connector can be dragged to another shape', async () => {
  const x = await add('process', 250, 150);
  const y = await add('process', 250, 420);
  const z = await add('process', 600, 420);
  await ev(([x, y]) => window.__novaDiagram.ctl.addConnectorBetween({ shape: x, port: 'auto' }, { shape: y, port: 'auto' }), [x, y]);
  await settle();
  const end = center(await box('[data-endpoint="to"]'));
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await settle();
  assert.match(await ev(([px, py]) => document.elementFromPoint(px, py)?.getAttribute('class'), [end.x, end.y]), /dg-endpoint/);
  await shot('extremo-sobre-el-punto-de-conexion');
  await drag(end, await at(z));
  const conns = await ev(() => window.__novaDiagram.ctl.basePage.connectors.map((c) => [c.from.shape, c.to.shape]));
  assert.deepEqual(conns, [[x, z]]);
  // another connection point still starts a new connector
  const p = await at(y);
  await page.mouse.move(p.x, p.y);
  await settle();
  const port = center(await box(`[data-port-shape="${y}"]`));
  await drag(port, { x: port.x + 40, y: port.y - 90 });
  assert.equal(await ev(() => window.__novaDiagram.ctl.basePage.connectors.length), 2);
});

await check('long words stay whole when the shape has room', async () => {
  await ev(() => {
    const c = window.__novaDiagram.ctl;
    const d = c.addStencil('decision', { x: 300, y: 250 });
    c.setText(d.id, 'Hay existencias suficientes en el almacén');
    const p = c.addStencil('process', { x: 600, y: 250 });
    c.setText(p.id, 'Comprobación');
    c.clearSelection();
  });
  await settle();
  const lines = await page.locator('.dg-shapes tspan').allTextContents();
  assert.ok(lines.includes('existencias'), JSON.stringify(lines));
  await shot('palabras-enteras');
});

await check('Ctrl+wheel keeps the point under the pointer', async () => {
  const a = await add('process', 700, 450);
  await ev(() => window.__novaDiagram.ctl.clearSelection());
  await settle(300);
  const before = await at(a);
  await page.mouse.move(before.x, before.y);
  await page.keyboard.down('Control');
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, -100);
    await settle(120);
  }
  await page.keyboard.up('Control');
  assert.equal(await ev(() => window.__novaDiagram.ctl.zoom), 150);
  let after = await at(a);
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) <= 3, `moved ${after.x - before.x}, ${after.y - before.y}`);
  // quick turns, without waiting for each drawing
  await page.keyboard.down('Control');
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 100);
  await settle(400);
  await page.keyboard.up('Control');
  after = await at(a);
  assert.ok((await ev(() => window.__novaDiagram.ctl.zoom)) < 150);
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) <= 3, `moved back ${after.x - before.x}, ${after.y - before.y}`);
});

await check('a new page takes the size of the current one', async () => {
  await ev(() => window.__novaDiagram.ctl.setPageProps({ width: 794, height: 1123 }));
  await page.getByRole('button', { name: 'Página nueva', exact: true }).last().click();
  assert.deepEqual(await ev(() => { const p = window.__novaDiagram.ctl.basePage; return [window.__novaDiagram.ctl.diagram.pages.length, p.width, p.height]; }), [2, 794, 1123]);
});

await check('the fill button shows a paint bucket', async () => {
  await page.getByRole('tab', { name: 'Inicio', exact: true }).click();
  const fill = page.getByRole('button', { name: 'Relleno', exact: true });
  assert.equal(await fill.locator('svg.lucide-paint-bucket').count(), 1);
  await shot('icono-de-relleno');
});

await browser.close();
for (const r of results) console.log(r.join('  '));
if (dialogs.length) console.log('dialogs:', dialogs);
if (errors.length) console.log('errors:', errors);
const bad = results.filter((r) => r[0] !== 'ok').length + errors.length;
console.log(`${results.length - results.filter((r) => r[0] !== 'ok').length}/${results.length} checks`);
process.exit(bad ? 1 : 0);
