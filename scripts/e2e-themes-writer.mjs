// End-to-end checks of the shared theme menus in Nova Writer (Design tab): the theme of the document, what points at it, undo, and the .docx.
// Needs `pnpm dev` on :1420. Usage: node scripts/e2e-themes-writer.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from '../packages/writer-core/node_modules/jszip/lib/index.js';

const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1700, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|404/.test(m.text()) && errors.push(m.text()));
await page.goto(`${BASE}?app=writer`, { waitUntil: 'load' });
await page.waitForSelector('.nw-doc');
await page.evaluate(() => localStorage.removeItem('suitenova.themes.custom'));
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.nw-doc');
await page.waitForTimeout(600);

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/fail-${results.length}.png` }).catch(() => {});
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 5).join(' | ')]);
    await page.keyboard.press('Escape').catch(() => {});
  }
};
const settle = (ms = 250) => page.waitForTimeout(ms);
const shot = (n) => (shotsDir ? page.screenshot({ path: `${shotsDir}/${n}.png` }) : Promise.resolve());
const open = async (name) => {
  await page.getByRole('button', { name, exact: true }).click();
  await settle(300);
};
const theme = () => page.evaluate(() => { const t = window.__novaWriter.ctl.theme; return { colors: t.colors, fonts: t.fonts, name: t.name }; });

// a document with a heading (style colour of the theme), a coloured run that points at the theme, a fixed colour, and a shaded paragraph
await page.evaluate(() => {
  const v = window.__novaWriter.ctl.mainView;
  const S = v.state.schema;
  const para = (text, attrs, marks) => S.nodes.paragraph.create(attrs, S.text(text, marks));
  const nodes = [
    para('Un título', { style: 'Heading1' }, []),
    para('Cuerpo normal', null, []),
    para('Del tema', null, [S.marks.color.create({ value: '#4472c4', ref: { slot: 'accent1' } })]),
    para('Fijo', null, [S.marks.color.create({ value: '#ff0000' })]),
    para('Sombreado', { shade: '#ed7d31', shadeRef: { slot: 'accent2' } }, []),
  ];
  v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, nodes));
});
await page.getByRole('tab', { name: 'Diseño', exact: true }).click();
const css = (sel, prop) => page.evaluate(([sel, prop]) => getComputedStyle(document.querySelector(sel))[prop], [sel, prop]);
const spanColor = (text) => page.evaluate((text) => { const e = [...document.querySelectorAll('.nw-doc span')].find((x) => x.textContent === text); return e ? getComputedStyle(e).color : null; }, text);
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const headingColor = () => page.evaluate(() => getComputedStyle([...document.querySelectorAll('.nw-doc .nw-p')].find((p) => p.textContent === 'Un título')).color);

await check('the theme menus are in the Design tab', async () => {
  for (const n of ['Temas', 'Colores', 'Fuentes', 'Efectos']) assert.equal(await page.getByRole('button', { name: n, exact: true }).count(), 1, n);
});

await check('a new document has the Office theme and the heading takes its blue', async () => {
  assert.equal((await theme()).colors.accent1.toLowerCase(), '#4472c4');
  assert.equal(await headingColor(), 'rgb(47, 84, 150)');
  assert.equal(await spanColor('Del tema'), rgb('#4472c4'));
});

await check('colours: the heading, the run that points at the theme and the shading follow; the fixed colour does not', async () => {
  await open('Colores');
  await shot('writer-colors');
  await page.getByRole('menuitemradio', { name: 'Verde', exact: true }).click();
  await settle(400);
  const t = await theme();
  assert.equal(t.colors.accent1, '#549e39');
  assert.notEqual(await headingColor(), 'rgb(47, 84, 150)');
  assert.equal(await spanColor('Del tema'), rgb('#549e39'));
  assert.equal(await spanColor('Fijo'), 'rgb(255, 0, 0)');
  const shade = await page.evaluate(() => window.__novaWriter.ctl.mainView.state.doc.firstChild.child(4).attrs.shade);
  assert.equal(shade, t.colors.accent2);
});

await check('undo gives back the theme and every colour with one step', async () => {
  await page.locator('.nw-doc').first().click();
  await page.keyboard.press('Control+z');
  await settle(300);
  assert.equal((await theme()).colors.accent1.toLowerCase(), '#4472c4');
  assert.equal(await headingColor(), 'rgb(47, 84, 150)');
  assert.equal(await spanColor('Del tema'), rgb('#4472c4'));
  await page.keyboard.press('Control+y');
  await settle(300);
  assert.equal((await theme()).colors.accent1, '#549e39');
});

await check('fonts: the body and the headings take the theme fonts', async () => {
  await open('Fuentes');
  await page.getByRole('menuitemradio', { name: /^Georgia/ }).first().click();
  await settle(400);
  assert.equal((await theme()).fonts.major.latin, 'Georgia');
  assert.match(await css('.nw-doc', 'fontFamily'), /Georgia/);
  assert.match(await page.evaluate(() => getComputedStyle([...document.querySelectorAll('.nw-doc .nw-p')].find((p) => p.textContent === 'Un título')).fontFamily), /Georgia/);
});

await check('effects: Intense is kept in the theme of the document', async () => {
  await open('Efectos');
  await page.getByRole('menuitemradio', { name: 'Intenso', exact: true }).click();
  await settle();
  const name = await page.evaluate(() => window.__novaWriter.ctl.theme.effectsName);
  assert.equal(name, 'Intenso');
});

await check('custom colours: applied to the document and listed', async () => {
  await open('Colores');
  await page.getByRole('menuitem', { name: 'Personalizar colores…' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.waitFor();
  await dlg.getByLabel('Énfasis 1').fill('#ff0066');
  await dlg.getByLabel('Nombre').fill('Rosa del documento');
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await settle(400);
  assert.equal((await theme()).colors.accent1, '#ff0066');
  assert.equal(await spanColor('Del tema'), 'rgb(255, 0, 102)');
  await open('Colores');
  assert.equal(await page.getByRole('menuitemradio', { name: 'Rosa del documento' }).getAttribute('aria-checked'), 'true');
  await page.keyboard.press('Escape');
});

await check('the .docx keeps the theme whole and the references to it, and opens again the same', async () => {
  const b64 = await page.evaluate(async () => {
    const w = await window.__novaWriter.docx.writeDocx(window.__novaWriter.ctl.toWriterDoc());
    let s = '';
    for (const b of w.data) s += String.fromCharCode(b);
    return btoa(s);
  });
  const zip = await JSZip.loadAsync(Buffer.from(b64, 'base64'));
  const theme1 = await zip.file('word/theme/theme1.xml').async('string');
  const doc = await zip.file('word/document.xml').async('string');
  const back = await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    const r = await window.__novaWriter.docx.readDocx(data);
    return { back: r.doc.theme.colors.accent1, fonts: r.doc.theme.fonts.major.latin };
  }, b64);
  const out = { accent1: /<a:accent1>.*?val="([0-9A-Fa-f]{6})"/.exec(theme1)?.[1], themed: /w:themeColor="accent1"/.test(doc), fixed: /w:val="FF0000"/.test(doc), ...back };
  assert.equal(out.accent1.toLowerCase(), 'ff0066');
  assert.ok(out.themed, 'themeColor en el documento');
  assert.ok(out.fixed, 'el color fijo sigue fijo');
  assert.equal(out.back.toLowerCase(), '#ff0066');
  assert.equal(out.fonts, 'Georgia');
});

await check('a .thmx of the menu changes the theme of the document (and undoes)', async () => {
  const thmx = path.join(os.tmpdir(), 'nova-writer.thmx');
  // the file is made with the same code as Slides' export: a theme in a .thmx
  const b64 = await page.evaluate(async () => {
    const T = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/theme-core/src/index.ts');
    const bytes = await T.writeThmx(T.withColors(T.officeTheme(), T.COLOR_SCHEMES.find((s) => s.id === 'red').colors, 'Rojo'));
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  });
  fs.writeFileSync(thmx, Buffer.from(b64, 'base64'));
  const before = (await theme()).colors.accent1;
  await open('Temas');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'Buscar temas…' }).click()]);
  await chooser.setFiles(thmx);
  await settle(500);
  assert.notEqual((await theme()).colors.accent1, before);
  await page.locator('.nw-doc').first().click();
  await page.keyboard.press('Control+z');
  await settle(300);
  assert.equal((await theme()).colors.accent1, before);
});

await check('a Word file arrives with its theme and its colours that point at it', async () => {
  const out = await page.evaluate(async () => {
    const T = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/theme-core/src/index.ts');
    const ctl = window.__novaWriter.ctl;
    const th = T.withColors(T.officeTheme(), T.COLOR_SCHEMES.find((s) => s.id === 'violetII').colors, 'Violeta II');
    const v = ctl.mainView;
    const S = v.state.schema;
    const doc = { ...ctl.toWriterDoc(), theme: th, body: S.nodes.doc.create(null, [S.nodes.section.create(ctl.toWriterDoc().body.firstChild.attrs, [S.nodes.paragraph.create(null, S.text('x', [S.marks.color.create({ value: '#000000', ref: { slot: 'accent1', tint: -0.25 } })]))])]) };
    const w = await window.__novaWriter.docx.writeDocx(doc);
    let s = '';
    for (const b of w.data) s += String.fromCharCode(b);
    await window.__novaWriter.load(btoa(s), 'tema.docx');
    return { accent1: ctl.theme.colors.accent1, expected: th.colors.accent1, run: ctl.mainView.state.doc.firstChild.firstChild.firstChild.marks.find((m) => m.type.name === 'color').attrs };
  });
  await settle(300);
  assert.equal(out.accent1.toLowerCase(), out.expected.toLowerCase());
  assert.equal(out.run.ref.slot, 'accent1');
  assert.notEqual(out.run.value, '#000000');
});

await check('the font colour menu offers the theme and the text keeps the reference to it', async () => {
  await page.locator('.nw-doc').first().click();
  await page.keyboard.press('Control+a');
  await page.getByRole('tab', { name: 'Inicio', exact: true }).click();
  await page.getByRole('button', { name: 'Color de fuente (más)', exact: true }).click();
  await settle(300);
  assert.equal(await page.getByRole('group', { name: 'Color de fuente' }).getByRole('button', { name: 'Énfasis 4', exact: true }).count(), 1);
  await shot('writer-picker');
  await page.getByRole('button', { name: 'Énfasis 4, más oscuro 25 %', exact: true }).click();
  await settle(300);
  const mark = () => page.evaluate(() => window.__novaWriter.ctl.mainView.state.doc.firstChild.firstChild.firstChild.marks.find((m) => m.type.name === 'color').attrs);
  const m1 = await mark();
  assert.equal(m1.ref.slot, 'accent4');
  assert.equal(m1.ref.tint, -0.25);
  await page.getByRole('tab', { name: 'Diseño', exact: true }).click();
  await open('Colores');
  await page.getByRole('menuitemradio', { name: 'Rojo', exact: true }).click();
  await settle(400);
  const m2 = await mark();
  assert.equal(m2.ref.slot, 'accent4');
  assert.notEqual(m2.value, m1.value);
  // a standard colour is fixed
  await page.getByRole('tab', { name: 'Inicio', exact: true }).click();
  await page.getByRole('button', { name: 'Color de fuente (más)', exact: true }).click();
  await page.getByRole('group', { name: 'Color de fuente' }).getByRole('button', { name: '#ff0000', exact: true }).click();
  await settle(300);
  const m3 = await mark();
  assert.equal(m3.value, '#ff0000');
  assert.equal(m3.ref, null);
});

await check('keyboard: Colors opens with Enter and the focus goes into its items', async () => {
  await page.getByRole('tab', { name: 'Diseño', exact: true }).click();
  await page.getByRole('button', { name: 'Colores', exact: true }).focus();
  await page.keyboard.press('Enter');
  await settle(300);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'menuitemradio');
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => !!document.activeElement?.closest('.nv-theme-pop')), 'Tab se queda en el menú');
  await page.keyboard.press('Escape');
});

await check('no console errors', async () => assert.deepEqual(errors, []));
await browser.close();
for (const [s, n, d] of results) console.log(s === 'ok' ? `✓ ${n}` : `✗ ${n}\n    ${d}`);
const ok = results.filter((r) => r[0] === 'ok').length;
console.log(`\n${ok}/${results.length} checks passed`);
process.exit(ok === results.length ? 0 : 1);
