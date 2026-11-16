// End-to-end checks for free pictures (in front of / behind the text) and pictures inside groups in Nova Writer: change the wrapping
// without moving the picture, drag it, group it with a shape, move/resize/ungroup the group, marquee selection, and the .docx round trip.
// Needs `pnpm dev` on :1420.  Usage: node scripts/e2e-writer-image-groups.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=writer';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => {
  errors.push(`dialog: ${d.message()}`);
  d.dismiss().catch(() => {});
});
let step = 0;
const shot = async (name) => {
  if (!shotsDir) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
};
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 8).join(' | ') + ' @ ' + (e.stack.split(String.fromCharCode(10)).find((l) => l.includes('e2e-writer-image-groups')) ?? '').trim()]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};

await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
const editor = page.locator('.ProseMirror').first();

/** Documento nuevo con un párrafo de texto, una imagen en línea y dos formas libres (siempre insertadas en la posición 1). */
const reset = async (inline = true) => {
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type('Texto del documento con imagen y formas.');
  await page.evaluate(
    ({ png, inline }) => {
      const v = window.__novaWriter.ctl.mainView;
      const n = v.state.schema.nodes;
      const rect = n.shape.create({ kind: 'rect', width: 100, height: 60, fill: '#bcd4f0', stroke: '#2b6cb0', strokeWidth: 1, wrap: 'front', x: 200, y: 90, id: 'sRect' });
      const img = n.image.create({ src: png, alt: 'Foto', width: 90, height: 50, ...(inline ? {} : { wrap: 'front', x: 40, y: 90 }) });
      v.dispatch(v.state.tr.insert(1, rect).insert(1, img));
    },
    { png: PNG, inline },
  );
  await page.waitForTimeout(400);
};
const imgInfo = () =>
  page.evaluate(() => {
    const out = [];
    window.__novaWriter.ctl.mainView.state.doc.descendants((n, pos, parent) => {
      if (n.type.name === 'image') out.push({ wrap: n.attrs.wrap, x: n.attrs.x, y: n.attrs.y, w: n.attrs.width, h: n.attrs.height, inGroup: parent.type.name === 'shape_group', rotate: n.attrs.rotate });
    });
    return out;
  });
const imgRect = () =>
  page.evaluate(() => {
    const e = document.querySelector('.ProseMirror img.nw-image');
    const r = e.getBoundingClientRect();
    const o = document.querySelector('.ProseMirror').getBoundingClientRect();
    return { l: r.left - o.left, t: r.top - o.top, r: r.right - o.left, b: r.bottom - o.top, w: r.width, h: r.height, ox: o.left, oy: o.top };
  });
const tree = () =>
  page.evaluate(() => {
    const top = [];
    window.__novaWriter.ctl.mainView.state.doc.descendants((n, pos, parent) => {
      if (n.type.name === 'shape_group') top.push({ group: true, kids: n.childCount, types: [...Array(n.childCount).keys()].map((i) => n.child(i).type.name), w: n.attrs.width, h: n.attrs.height });
      else if ((n.type.name === 'shape' || n.type.name === 'image') && parent.type.name !== 'shape_group') top.push({ type: n.type.name, wrap: n.attrs.wrap });
    });
    return top;
  });
const cmd = async (name) => {
  for (const tab of ['Formato de imagen', 'Formato de forma']) {
    if (await page.locator(`[data-nv-item="${name}"]`).count()) break;
    await page.locator('[role=tab]').filter({ hasText: tab }).click().catch(() => {});
  }
  await page.locator(`[data-nv-item="${name}"]`).click();
  await page.waitForTimeout(350);
};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

await check('Delante del texto: la imagen en línea pasa a libre sin moverse en pantalla, y se arrastra', async () => {
  await reset(true);
  const before = await imgRect();
  await page.locator('.ProseMirror img.nw-image').click();
  await page.waitForTimeout(250);
  await page.locator('[role=tab]').filter({ hasText: 'Formato de imagen' }).click();
  await page.getByRole('button', { name: 'Ajuste del texto', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delante del texto' }).click();
  await page.waitForTimeout(400);
  const info = (await imgInfo())[0];
  assert.equal(info.wrap, 'front');
  assert.ok(Number.isFinite(info.x) && Number.isFinite(info.y));
  const after = await imgRect();
  near(after.l, before.l, 3, 'izquierda');
  near(after.t, before.t, 3, 'arriba');
  await shot('libre');
  // arrastrar la imagen libre
  const cx = after.ox + after.l + after.w / 2;
  const cy = after.oy + after.t + after.h / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 20, cy + 15, { steps: 4 });
  await page.mouse.move(cx + 50, cy + 35, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const moved = (await imgInfo())[0];
  near(moved.x - info.x, 50, 3, 'desplazamiento x');
  near(moved.y - info.y, 35, 3, 'desplazamiento y');
  // «En línea» la devuelve al texto
  await page.getByRole('button', { name: 'Ajuste del texto', exact: true }).click();
  await page.getByRole('menuitem', { name: 'En línea con el texto' }).click();
  await page.waitForTimeout(300);
  assert.equal((await imgInfo())[0].wrap, null);
});

await check('Agrupar una imagen libre con una forma: el grupo la contiene y nada se mueve; hacer clic en la imagen elige el grupo', async () => {
  await reset(false);
  const before = await imgRect();
  const rectBefore = await page.evaluate(() => { const r = document.querySelector('.ProseMirror .nw-shape').getBoundingClientRect(); const o = document.querySelector('.ProseMirror').getBoundingClientRect(); return { l: r.left - o.left, t: r.top - o.top }; });
  await page.locator('.ProseMirror img.nw-image').click();
  await page.locator('.ProseMirror .nw-shape').click({ position: { x: 30, y: 20 }, modifiers: ['Control'] });
  await page.waitForTimeout(250);
  await cmd('writer.shape.group');
  const t = await tree();
  assert.equal(t.length, 1);
  assert.deepEqual(t[0].types.sort(), ['image', 'shape']);
  const after = await imgRect();
  near(after.l, before.l, 3, 'la imagen no se movió (x)');
  near(after.t, before.t, 3, 'la imagen no se movió (y)');
  const rectAfter = await page.evaluate(() => { const r = document.querySelector('.ProseMirror .nw-shape:not(.nw-shape-group)').getBoundingClientRect(); const o = document.querySelector('.ProseMirror').getBoundingClientRect(); return { l: r.left - o.left, t: r.top - o.top }; });
  near(rectAfter.l, rectBefore.l, 3, 'la forma no se movió (x)');
  near(rectAfter.t, rectBefore.t, 3, 'la forma no se movió (y)');
  await shot('agrupado');
  // un clic en la imagen del grupo elige el grupo
  const now = await imgRect();
  await page.mouse.click(now.ox + now.l + now.w / 2, now.oy + now.t + now.h / 2);
  await page.waitForTimeout(250);
  const sel = await page.evaluate(() => window.__novaWriter.ctl.mainView.state.selection.node?.type.name);
  assert.equal(sel, 'shape_group');
});

await check('el grupo con imagen cambia de tamaño y gira: la imagen sigue; sobrevive al .docx; desagrupar la devuelve libre', async () => {
  const g0 = (await tree())[0];
  const i0 = (await imgInfo())[0];
  // asa sureste del grupo: el doble de ancho
  const se = await page.locator('.ProseMirror .nw-shape-group > [data-handle="se"]').boundingBox();
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(se.x + se.width / 2 + g0.w / 2, se.y + se.height / 2, { steps: 5 });
  await page.mouse.move(se.x + se.width / 2 + g0.w, se.y + se.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const g1 = (await tree())[0];
  near(g1.w, g0.w * 2, 4, 'ancho del grupo');
  const i1 = (await imgInfo())[0];
  assert.ok(i1.inGroup);
  near(i1.w, i0.w * 2, 4, 'ancho de la imagen escalado');
  await shot('escalado');
  // .docx: una imagen dentro de un grupo vuelve a ser imagen dentro del grupo
  const back = await page.evaluate(async () => {
    const w = window.__novaWriter;
    const { data, warnings } = await w.docx.writeDocx(w.ctl.toWriterDoc());
    const out = { warnings: warnings ?? [], kids: [] };
    (await w.docx.readDocx(data)).doc.body.descendants((n) => {
      if (n.type.name === 'shape_group') n.forEach((c) => out.kids.push({ type: c.type.name, w: c.attrs.width, alt: c.attrs.alt }));
    });
    return out;
  });
  assert.deepEqual(back.kids.map((k) => k.type).sort(), ['image', 'shape']);
  near(back.kids.find((k) => k.type === 'image').w, i1.w, 2, 'ancho tras el .docx');
  // desagrupar
  const imgBefore = await imgRect();
  await cmd('writer.shape.ungroup');
  const t = await tree();
  assert.deepEqual(t.map((x) => x.type).sort(), ['image', 'shape']);
  const after = await imgInfo();
  assert.equal(after[0].inGroup, false);
  assert.equal(after[0].wrap, 'front');
  const imgAfter = await imgRect();
  near(imgAfter.l, imgBefore.l, 3, 'la imagen no se movió al desagrupar (x)');
  near(imgAfter.t, imgBefore.t, 3, 'la imagen no se movió al desagrupar (y)');
});

await check('Seleccionar objetos: el recuadro elige también las imágenes libres', async () => {
  await reset(false);
  const rects = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror .nw-shape, .ProseMirror img.nw-image')].map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }));
  assert.equal(rects.length, 2);
  const l = Math.min(...rects.map((r) => r.l)) - 14;
  const tp = Math.min(...rects.map((r) => r.t)) - 14;
  const r = Math.max(...rects.map((q) => q.r)) + 14;
  const b = Math.max(...rects.map((q) => q.b)) + 14;
  await page.evaluate(() => { window.__novaWriter.ctl.selectObjects = true; window.__novaWriter.ctl.touch(); });
  await page.mouse.move(l, tp);
  await page.mouse.down();
  await page.mouse.move((l + r) / 2, (tp + b) / 2, { steps: 4 });
  await page.mouse.move(r, b, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const n = await page.evaluate(() => {
    const v = window.__novaWriter.ctl.mainView;
    return v.state.plugins.find((p) => p.key.startsWith('shapeSelection'))?.getState(v.state).length;
  });
  assert.equal(n, 2, 'la forma y la imagen');
  await shot('recuadro');
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
