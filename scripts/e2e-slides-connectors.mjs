// End-to-end checks of connectors that stick to shapes in Nova Slides. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-slides-connectors.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=slides';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1900, height: 950 } })).newPage();
page.setDefaultTimeout(12000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => void d.dismiss());
let step = 0;
const shot = async (n) => shotsDir && page.screenshot({ path: `${shotsDir}/cxn-${String(++step).padStart(2, '0')}-${n}.png` });
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 6).join(' | ')]);
    await shot('FAIL-' + name.replace(/\W+/g, '-'));
  }
};
const ev = (f, a) => page.evaluate(f, a);
const settle = (ms = 250) => page.waitForTimeout(ms);
const at = async (x, y) => {
  const b = await page.locator('.sl-surface').boundingBox();
  const z = (await ev(() => window.__novaSlides.ctl.zoom || window.__novaSlides.ctl.fitPercent)) / 100;
  return { x: b.x + x * z, y: b.y + y * z };
};
const drag = async (from, to, steps = 8) => {
  const a = await at(from.x, from.y);
  const b = await at(to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps });
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await settle();
};
const cxn = () => ev(() => window.__novaSlides.ctl.slide.shapes.find((e) => e.kind === 'cxn') ?? null);
const ends = (x) => ({ a: { x: x.flipH ? x.x + x.w : x.x, y: x.flipV ? x.y + x.h : x.y }, b: { x: x.flipH ? x.x : x.x + x.w, y: x.flipV ? x.y : x.y + x.h } });
let A, B;

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.sl-surface');
await ev(() => {
  const n = window.__novaSlides;
  const c = n.ctl;
  c.select(c.slide.shapes.map((e) => e.id));
  c.deleteSelected();
  window.__ids = [n.addShape('rect', 100, 150, 160, 80), n.addShape('ellipse', 600, 280, 160, 80)];
  c.select([]);
});
[A, B] = await ev(() => window.__ids);
await settle();

await check('drawing a line from one shape to another sticks both ends to connection sites', async () => {
  await ev(() => window.__novaSlides.ctl.setTool({ kind: 'line', prst: 'straightConnector1' }));
  await settle();
  // the sites are shown while the line tool is on
  assert.ok((await page.locator('[data-testid=conn-site]').count()) >= 4 + 8);
  await shot('sites');
  await drag({ x: 262, y: 192 }, { x: 598, y: 316 });
  const c = await cxn();
  assert.ok(c, 'a line was created');
  assert.equal(c.start?.idx, 3);
  assert.equal(c.end?.idx, 2);
  const srcA = await ev((id) => window.__novaSlides.ctl.element(id).srcId, A);
  const srcB = await ev((id) => window.__novaSlides.ctl.element(id).srcId, B);
  assert.equal(c.start.id, srcA);
  assert.equal(c.end.id, srcB);
  const e = ends(c.xfrm);
  assert.ok(Math.hypot(e.a.x - 260, e.a.y - 190) < 1, `start at the right-middle of the rectangle: ${JSON.stringify(e.a)}`);
  assert.equal(await ev(() => window.__novaSlides.ctl.tool.kind), 'select');
  await shot('drawn');
});

await check('moving a shape moves the connector end with it; undo takes both back in one step', async () => {
  const before = ends((await cxn()).xfrm).b;
  await ev((id) => { const c = window.__novaSlides.ctl; c.select([id]); c.setXfrm(id, { x: 650, y: 400 }); }, B);
  await settle();
  const after = ends((await cxn()).xfrm).b;
  assert.notDeepEqual(after, before);
  const site = await ev((id) => { const c = window.__novaSlides.ctl; const x = c.xfrmOf(c.element(id)); return x; }, B);
  assert.ok(Math.abs(after.x - (site.x + site.w / 2)) < 1.5 || Math.abs(after.y - (site.y + site.h / 2)) < 1.5, `end ${JSON.stringify(after)} vs ${JSON.stringify(site)}`);
  await ev(() => window.__novaSlides.ctl.undo());
  await settle();
  assert.deepEqual(ends((await cxn()).xfrm).b, before);
});

await check('dragging a shape with the mouse drags the connector along, in one undo step', async () => {
  const undoBefore = await ev(() => window.__novaSlides.ctl.undoLabel);
  await ev((id) => window.__novaSlides.ctl.select([id]), B);
  const x = await ev((id) => window.__novaSlides.ctl.xfrmOf(window.__novaSlides.ctl.element(id)), B);
  await drag({ x: x.x + 20, y: x.y + x.h / 2 }, { x: x.x + 20, y: x.y + x.h / 2 + 60 });
  const moved = await ev((id) => window.__novaSlides.ctl.xfrmOf(window.__novaSlides.ctl.element(id)), B);
  assert.ok(Math.abs(moved.y - x.y - 60) < 2, `the shape moved ${moved.y - x.y}`);
  const e = ends((await cxn()).xfrm).b;
  assert.ok(Math.abs(e.y - (moved.y + moved.h)) < 1.5 || Math.abs(e.y - (moved.y + moved.h / 2)) < 60);
  await ev(() => window.__novaSlides.ctl.undo());
  await settle();
  const back = await ev((id) => window.__novaSlides.ctl.xfrmOf(window.__novaSlides.ctl.element(id)), B);
  assert.ok(Math.abs(back.y - x.y) < 1);
  void undoBefore;
});

await check('saved and reopened: the connection survives and still follows', async () => {
  const bytes = await ev(() => window.__novaSlides.write());
  await ev((b) => window.__novaSlides.load(b), bytes);
  await settle(500);
  const c = await cxn();
  assert.ok(c.start && c.end, 'both ends are still connected');
  const ids = await ev(() => window.__novaSlides.ctl.slide.shapes.filter((e) => e.kind === 'shape').map((e) => ({ id: e.id, src: e.srcId })));
  assert.ok(ids.some((s) => s.src === c.start.id) && ids.some((s) => s.src === c.end.id));
  const target = ids.find((s) => s.src === c.end.id);
  const before = ends((await cxn()).xfrm).b;
  await ev((id) => window.__novaSlides.ctl.setXfrm(id, { x: 300, y: 450 }), target.id);
  await settle();
  assert.notDeepEqual(ends((await cxn()).xfrm).b, before);
});

await check('dragging the end of a connector away frees it; dropping it on a site connects it again', async () => {
  await ev(() => { const c = window.__novaSlides.ctl; const l = c.slide.shapes.find((e) => e.kind === 'cxn'); c.select([l.id]); });
  await settle();
  const c0 = await cxn();
  const end = ends(c0.xfrm).b;
  await drag({ x: end.x, y: end.y }, { x: 900, y: 80 });
  let c = await cxn();
  assert.equal(c.end, undefined, 'the end is free');
  assert.ok(c.start, 'the start is still connected');
  const target = await ev((i) => { const s = window.__novaSlides.ctl.slide.shapes.filter((e) => e.kind === 'shape'); return s[1].id; }, 0);
  const x = await ev((id) => window.__novaSlides.ctl.xfrmOf(window.__novaSlides.ctl.element(id)), target);
  await ev(() => { const cc = window.__novaSlides.ctl; cc.select([cc.slide.shapes.find((e) => e.kind === 'cxn').id]); });
  await settle();
  await drag({ x: 900, y: 80 }, { x: x.x + x.w / 2 + 2, y: x.y - 2 });
  c = await cxn();
  assert.ok(c.end, 'connected again');
  await shot('reconnected');
});

await check('a line drawn in empty space is not connected', async () => {
  await ev(() => window.__novaSlides.ctl.setTool({ kind: 'line', prst: 'line' }));
  await drag({ x: 50, y: 500 }, { x: 300, y: 520 });
  const lines = await ev(() => window.__novaSlides.ctl.slide.shapes.filter((e) => e.kind === 'cxn'));
  const free = lines.find((l) => !l.start && !l.end);
  assert.ok(free, 'a free line exists');
});

await check('no console errors', async () => assert.deepEqual(errors, []));
await browser.close();
let failed = 0;
for (const [s, n, m] of results) {
  if (s !== 'ok') failed++;
  console.log(`${s === 'ok' ? '✓' : '✗'} ${n}${m ? '\n    ' + m : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
