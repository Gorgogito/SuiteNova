// Nova Diagram against Visio, phases 2 and 3: opening Visio drawings and saving for Visio, in a real browser (Edge).
// Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-diagram-visio.mjs [--shots dir]
// The drawing is written here by hand, in the structure Visio uses (theme, style sheets, masters, groups, layers…).
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from '../packages/writer-core/node_modules/jszip/lib/index.js';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=diagram';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-visio-'));

const NS = 'http://schemas.microsoft.com/office/visio/2012/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGUlEQVR42mNk+M9AEmAc1TCqYVTDsNUAAJ0NIAFf3Vh5AAAAAElFTkSuQmCC';
const c = (n, v) => `<Cell N="${n}" V="${v}"/>`;
const cells = (o) => Object.entries(o).map(([n, v]) => c(n, v)).join('');
const box = (x, y, w, h) => cells({ PinX: x, PinY: y, Width: w, Height: h });
const row = (t, ix, o) => `<Row T="${t}" IX="${ix}">${cells(o)}</Row>`;
const rect = (w, h) => `<Section N="Geometry" IX="0">${row('MoveTo', 1, { X: 0, Y: 0 })}${row('LineTo', 2, { X: w, Y: 0 })}${row('LineTo', 3, { X: w, Y: h })}${row('LineTo', 4, { X: 0, Y: h })}${row('LineTo', 5, { X: 0, Y: 0 })}</Section>`;
const styled = 'LineStyle="3" FillStyle="3" TextStyle="3"';

async function drawing() {
  const zip = new JSZip();
  const rel = (id, type, target) => `<Relationship Id="${id}" Type="http://x/${type}" Target="${target}"/>`;
  const rels = (x) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${x}</Relationships>`;
  const clr = (n, v) => `<a:${n}><a:srgbClr val="${v}"/></a:${n}>`;
  const solid = (x) => `<a:solidFill>${x}</a:solidFill>`;
  const ph = '<a:schemeClr val="phClr"/>';
  const ln = `<a:ln w="9525">${solid('<a:srgbClr val="2F528F"/>')}</a:ln>`;
  const theme = `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:vt="${NS.replace('main', 'theme')}"><a:themeElements><a:clrScheme name="x">${clr('dk1', '000000')}${clr('lt1', 'FFFFFF')}${clr('accent1', '4672C4')}</a:clrScheme><a:fontScheme name="x"><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme><a:fmtScheme name="x"><a:fillStyleLst>${solid(ph)}</a:fillStyleLst><a:lnStyleLst>${ln}</a:lnStyleLst></a:fmtScheme></a:themeElements><a:extLst><a:ext><vt:themeScheme><vt:schemeID schemeEnum="59"/></vt:themeScheme></a:ext><a:ext><vt:variationClrSchemeLst><vt:variationClrScheme monotone="1">${[1, 2, 3, 4, 5, 6, 7].map((i) => clr(`x`, '4672C4').replace(/a:x/g, `vt:varColor${i}`)).join('')}</vt:variationClrScheme></vt:variationClrSchemeLst></a:ext><a:ext><vt:fontStylesGroup><vt:fontStyles><vt:fontProps><vt:color><a:schemeClr val="lt1"/></vt:color></vt:fontProps></vt:fontStyles></vt:fontStylesGroup></a:ext><a:ext><vt:variationStyleSchemeLst><vt:variationStyleScheme><vt:varStyle fillIdx="1" lineIdx="1" effectIdx="1" fontIdx="1"/></vt:variationStyleScheme></vt:variationStyleSchemeLst></a:ext></a:extLst></a:theme>`;
  const themedCells = ['FillForegnd', 'FillPattern', 'LineColor', 'LinePattern'].map((n) => c(n, 'Themed')).join('');
  zip.file('visio/document.xml', `<VisioDocument xmlns="${NS}"><StyleSheets><StyleSheet ID="0">${cells({ LineWeight: 0.0104, QuickStyleFillColor: 100, QuickStyleFillMatrix: 100, QuickStyleLineColor: 100, QuickStyleLineMatrix: 100, QuickStyleFontColor: 100, QuickStyleFontMatrix: 100 })}</StyleSheet><StyleSheet ID="3" LineStyle="0" FillStyle="0" TextStyle="0">${themedCells}<Section N="Character"><Row IX="0">${c('Color', 'Themed')}${c('Font', 'Themed')}${c('Size', 0.1667)}</Row></Section></StyleSheet></StyleSheets></VisioDocument>`);
  zip.file('visio/_rels/document.xml.rels', rels(rel('r1', 'pages', 'pages/pages.xml') + rel('r2', 'masters', 'masters/masters.xml') + rel('r3', 'theme', 'theme/theme1.xml')));
  zip.file('visio/theme/theme1.xml', theme);
  zip.file('visio/masters/masters.xml', `<Masters xmlns="${NS}" xmlns:r="${R}"><Master ID="2" NameU="Decision"><Rel r:id="m1"/></Master></Masters>`);
  zip.file('visio/masters/_rels/masters.xml.rels', rels(rel('m1', 'master', 'master1.xml')));
  zip.file('visio/masters/master1.xml', `<MasterContents xmlns="${NS}"><Shapes><Shape ID="5" ${styled}>${box(1, 1, 1.5, 1)}${rect(1.5, 1)}</Shape></Shapes></MasterContents>`);
  const sheet = (extra) => `<PageSheet>${cells({ PageWidth: 11, PageHeight: 7, ThemeIndex: 59, ColorSchemeIndex: 59 })}${extra}</PageSheet>`;
  zip.file('visio/pages/pages.xml', `<Pages xmlns="${NS}" xmlns:r="${R}"><Page ID="4" Name="Marco" Background="1">${sheet('')}<Rel r:id="p0"/></Page><Page ID="0" Name="Pedido" BackPage="4">${sheet('<Section N="Layer"><Row IX="0"><Cell N="Name" V="Avisos"/><Cell N="Visible" V="1"/></Row></Section>')}<Rel r:id="p1"/></Page><Page ID="1" Name="Anexo">${sheet('')}<Rel r:id="p2"/></Page></Pages>`);
  zip.file('visio/pages/_rels/pages.xml.rels', rels([0, 1, 2].map((i) => rel(`p${i}`, 'page', `page${i}.xml`)).join('')));
  const contents = (shapes, connects = '') => `<PageContents xmlns="${NS}" xmlns:r="${R}"><Shapes>${shapes}</Shapes>${connects ? `<Connects>${connects}</Connects>` : ''}</PageContents>`;
  zip.file('visio/pages/page0.xml', contents(`<Shape ID="1" ${styled}>${box(5.5, 6.5, 10, 0.6)}${rect(10, 0.6)}<Text>Título del fondo</Text></Shape>`));
  zip.file(
    'visio/pages/page1.xml',
    contents(
      `<Shape ID="1" Master="2">${cells({ PinX: 2, PinY: 4 })}<Section N="Property"><Row N="Responsable"><Cell N="Label" V="Responsable"/><Cell N="Value" V="Ana Ruiz"/></Row></Section><Section N="Hyperlink"><Row N="Row_1"><Cell N="Address" V="https://example.org/pedido"/></Row></Section><Text>¿Hay existencias?</Text></Shape>
<Shape ID="2" ${styled}>${box(6, 4, 1.8, 1)}${c('FillForegnd', '#ffc000')}${c('LayerMember', '0')}${rect(1.8, 1)}<Text>Enviar</Text></Shape>
<Shape ID="3">${box(4, 4, 2.5, 0)}${cells({ BeginX: 2.75, BeginY: 4, EndX: 5.1, EndY: 4, EndArrow: 4, LineColor: '#4672c4' })}<Text>Sí</Text></Shape>
<Shape ID="4" Type="Group" ${styled}>${box(3, 1.6, 3, 1)}${c('Angle', 0.35)}<Shapes><Shape ID="5" ${styled}>${box(0.75, 0.5, 1.3, 0.9)}${rect(1.3, 0.9)}<Text>Grupo A</Text></Shape><Shape ID="6" ${styled}>${box(2.25, 0.5, 1.3, 0.9)}${rect(1.3, 0.9)}<Text>Grupo B</Text></Shape></Shapes></Shape>
<Shape ID="7" Type="Foreign">${box(8.6, 1.8, 1.4, 1.4)}<ForeignData ForeignType="Bitmap"><Rel r:id="img"/></ForeignData></Shape>
<Shape ID="8" Type="Foreign">${box(8.6, 4, 1.4, 1)}<ForeignData ForeignType="EnhMetaFile"><Rel r:id="emf"/></ForeignData></Shape>`,
      '<Connect FromSheet="3" FromCell="BeginX" ToSheet="1" ToCell="PinX"/><Connect FromSheet="3" FromCell="EndX" ToSheet="2" ToCell="PinX"/>',
    ),
  );
  zip.file('visio/pages/_rels/page1.xml.rels', rels(rel('img', 'image', '../media/foto.png') + rel('emf', 'image', '../media/dibujo.emf')));
  zip.file('visio/pages/page2.xml', contents(''));
  zip.file('visio/media/foto.png', PNG, { base64: true });
  zip.file('visio/media/dibujo.emf', 'AAAA', { base64: true });
  const file = path.join(tmp, 'pedido.vsdx');
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
  return file;
}

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
const dialogs = [];
page.on('dialog', (d) => {
  dialogs.push(d.message());
  d.accept();
});
let step = 0;
const shot = async (name) => {
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
};
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 7).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};
const ev = (fn, arg) => page.evaluate(fn, arg);
const settle = (ms = 250) => page.waitForTimeout(ms);
const current = () => ev(() => { const { ctl } = window.__novaDiagram; const p = ctl.basePage; return { pages: ctl.diagram.pages.map((x) => x.name), shapes: p.shapes, connectors: p.connectors, layers: p.layers, groups: p.groups, w: p.width, h: p.height, dirty: ctl.dirty }; });

await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForSelector('.dg-app', { timeout: 90000 });
const file = await drawing();
let first;

await check('opens the drawing and tells what did not come in', async () => {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await chooser.setFiles(file);
  await settle(800);
  first = await current();
  assert.deepEqual(first.pages, ['Pedido', 'Anexo']);
  assert.deepEqual([first.w, first.h], [1056, 672]);
  const message = dialogs.at(-1) ?? '';
  assert.match(message, /1 imagen\(es\) u objetos incrustados/);
  assert.match(message, /fondo/);
  await shot('dibujo-abierto');
});

await check('theme colours, the shape of Nova, data and link', async () => {
  const by = (t) => first.shapes.find((s) => s.text === t);
  const d = by('¿Hay existencias?');
  assert.equal(d.stencil, 'decision');
  assert.equal(d.style.fill, '#4672c4');
  assert.equal(d.font.color, '#ffffff');
  assert.equal(d.font.family, 'Calibri');
  assert.deepEqual(d.data, [{ name: 'Responsable', value: 'Ana Ruiz', type: 'text' }]);
  assert.equal(d.link.url, 'https://example.org/pedido');
  assert.equal(by('Enviar').style.fill, '#ffc000');
  // what is drawn on screen carries the colour
  const fill = await page.locator(`[data-shape-id="${d.id}"] path`).first().getAttribute('fill');
  assert.equal(fill, '#4672c4');
});

await check('the connector stays glued and follows its shape', async () => {
  const k = first.connectors[0];
  const from = first.shapes.find((s) => s.text === '¿Hay existencias?');
  assert.equal(k.from.shape, from.id);
  assert.equal(k.endArrow, 'arrow');
  const path = () => page.locator('[data-connector-id] path').first().getAttribute('d');
  const before = await path();
  await ev(([id]) => { const c = window.__novaDiagram.ctl; c.setSelection([id]); c.nudge(0, -60); }, [from.id]);
  await settle();
  assert.notEqual(await path(), before);
  await ev(() => window.__novaDiagram.ctl.undo());
});

await check('groups, the locked background, layers and pictures', async () => {
  assert.equal(first.groups.length, 1);
  const a = first.shapes.find((s) => s.text === 'Grupo A');
  assert.ok(Math.abs(a.rot - 339.9) < 0.2, `rot ${a.rot}`);
  assert.deepEqual(first.layers.map((l) => [l.name, l.locked]), [['Sin capa', false], ['Avisos', false], ['Fondo', true]]);
  // a click on the background selects nothing; one on a member of the group selects the group
  await ev(() => window.__novaDiagram.ctl.clearSelection());
  const mid = async (t) => { const b = await page.locator(`[data-shape-id="${first.shapes.find((s) => s.text === t).id}"] path`).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  await page.mouse.click(...(await mid('Título del fondo')));
  await settle();
  assert.equal(await ev(() => window.__novaDiagram.ctl.selShapes.length), 0);
  await page.mouse.click(...(await mid('Grupo A')));
  await settle();
  assert.equal(await ev(() => window.__novaDiagram.ctl.selShapes.length), 2);
  await shot('grupo-seleccionado');
  assert.equal(first.shapes.filter((s) => s.image).length, 1);
  assert.equal(await page.locator('.dg-shapes image').count(), 1);
  assert.ok(first.shapes.some((s) => s.text === 'Imagen no compatible'));
});

await check('saves it as a diagram of Nova and opens it again the same', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const saved = path.join(tmp, 'pedido.novadiagram');
  await dl.saveAs(saved);
  const seen = dialogs.length;
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await chooser.setFiles(saved);
  await settle(600);
  const again = await current();
  assert.deepEqual(dialogs.slice(seen), [], 'no warnings when reopening');
  for (const [i, s] of again.shapes.entries()) for (const k of Object.keys({ ...s, ...first.shapes[i] })) assert.deepEqual(s[k], first.shapes[i][k], `${k} of "${s.text}"`);
  assert.deepEqual(again.layers, first.layers);
});

await check('saved for Visio it keeps glue, containers, data, links and layers, and comes back', async () => {
  // a pool with a shape in it, as the user would put them, below what was opened
  await ev(() => {
    const { ctl } = window.__novaDiagram;
    ctl.addStencil('pool', { x: 400, y: 1000 });
    ctl.addStencil('process', { x: 330, y: 900 });
    const made = ctl.basePage.shapes.at(-1);
    ctl.setSelection([made.id]);
    ctl.setText(made.id, 'En el carril');
  });
  await settle();
  const before = await current();
  assert.ok(before.shapes.find((x) => x.text === 'En el carril').lane, 'the new shape is in a lane');
  const tab = (name) => page.getByRole('tab', { name, exact: true }).click();
  await tab('Diseño');
  await page.getByRole('button', { name: 'Exportar', exact: true }).first().click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Visio/ }).click()]);
  const out = path.join(tmp, 'salida.vsdx');
  await dl.saveAs(out);
  const zip = await JSZip.loadAsync(fs.readFileSync(out));
  const one = await zip.file('visio/pages/page1.xml').async('string');
  assert.equal((one.match(/<Connect /g) ?? []).length, 2, 'both ends of the connector are glued');
  assert.match(one, /_WALKGLUE\(BegTrigger,EndTrigger,WalkPreference\)/);
  assert.match(one, /<Row N="Responsable">/);
  assert.match(one, /N="Address" V="https:\/\/example\.org\/pedido"/);
  assert.match(one, /V="Container" U="STR"/);
  assert.match(one, /DEPENDSON\(4,/);
  assert.match(await zip.file('visio/pages/pages.xml').async('string'), /N="Name" V="Fondo"/);
  const seen = dialogs.length;
  await ev(() => window.__novaDiagram.ctl.flushTyping());
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await chooser.setFiles(out);
  await page.waitForFunction(() => window.__novaDiagram.ctl.diagram.name === 'salida');
  await settle(600);
  const back = await current();
  assert.deepEqual(dialogs.slice(seen).filter((m) => !/descartarlos/.test(m)), [], 'no warnings when coming back');
  assert.equal(back.shapes.length, before.shapes.length);
  assert.equal(back.groups.length, before.groups.length);
  const layersOf = (x) => JSON.stringify(x.layers.map((l) => [l.name, l.visible, l.locked]));
  assert.equal(layersOf(back), layersOf(before));
  assert.ok(back.connectors[0].from.shape && back.connectors[0].to.shape);
  const pool = back.shapes.find((x) => x.stencil === 'pool');
  const inside = back.shapes.find((x) => x.text === 'En el carril');
  assert.equal(inside.parent, pool.id);
  assert.ok(pool.container.lanes.some((l) => l.id === inside.lane));
  assert.deepEqual(back.shapes.find((x) => x.text === '¿Hay existencias?').data, before.shapes.find((x) => x.text === '¿Hay existencias?').data);
  await shot('ida-y-vuelta');
});

await browser.close();
for (const r of results) console.log(r.join('  '));
if (errors.length) console.log('errors:', errors);
const failed = results.filter((r) => r[0] !== 'ok').length;
console.log(`${results.length - failed}/${results.length} checks`);
process.exit(failed + errors.length ? 1 : 0);
