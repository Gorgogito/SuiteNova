// End-to-end checks for sections, columns, watermark, headers/footers and views of Nova Writer. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-writer-layout.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=writer';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => {
  errors.push(`dialog: ${d.message()}`);
  d.dismiss();
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

await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.nw-doc');
await page.waitForTimeout(500);
const ev = (fn, arg) => page.evaluate(fn, arg);
const settle = () => page.waitForTimeout(700);
const lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ';
const fill = (paras, text = lorem.repeat(4)) =>
  ev(
    ([n, t]) => {
      const { ctl } = window.__novaWriter;
      const v = ctl.mainView;
      const S = v.state.schema;
      const blocks = Array.from({ length: n }, () => S.node('paragraph', null, [S.text(t)]));
      const sec = v.state.doc.child(v.state.doc.childCount - 1);
      const end = v.state.doc.content.size - 1;
      v.dispatch(v.state.tr.insert(end, blocks));
      void sec;
    },
    [paras, text],
  );
const specs = () => ev(() => window.__novaWriter.ctl.pageSpecs.map((p) => [p.section, p.number, p.blank]));
const newDoc = async () => {
  await ev(() => window.__novaWriter.ctl.newDoc());
  await settle();
};

await check('a next-page section break starts a section with its own page size', async () => {
  await newDoc();
  await fill(3);
  await ev(() => {
    const { ctl } = window.__novaWriter;
    const v = ctl.mainView;
    v.focus();
    const end = v.state.doc.content.size - 1;
    const sel = v.state.selection.constructor;
    v.dispatch(v.state.tr.setSelection(sel.near(v.state.doc.resolve(end))));
  });
  await page.keyboard.press('Control+End');
  await page.getByRole('tab', { name: 'Diseño' }).click();
  await page.locator('[data-nv-item="breaksMenu"]').click();
  await page.getByRole('menuitem', { name: /página siguiente/ }).click();
  await settle();
  await page.keyboard.type('Sección dos');
  await ev(() => {
    const { ctl } = window.__novaWriter;
    ctl.setPage({ width: 841.9, height: 595.3 }, 'section');
  });
  await settle();
  const info = await ev(() => {
    const { ctl } = window.__novaWriter;
    return { sections: ctl.sections().length, rects: ctl.pageRects().map((r) => [Math.round(r.width), Math.round(r.height)]), start: ctl.sections()[1].props.start };
  });
  assert.equal(info.sections, 2);
  assert.equal(info.rects.length, 2);
  assert.notDeepEqual(info.rects[0], info.rects[1], 'the sections have different page sizes');
  assert.ok(info.rects[1][0] > info.rects[1][1], 'the second section is landscape');
  const domRects = await page.locator('.nw-page').evaluateAll((els) => els.map((e) => [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]));
  assert.equal(domRects.length, 2);
  assert.ok(domRects[1][0] > domRects[0][0]);
  await shot('sections-two-sizes');
});

await check('Backspace at the start of a section joins it with the previous one (taking its formatting)', async () => {
  await ev(() => {
    const { ctl } = window.__novaWriter;
    const v = ctl.mainView;
    const second = ctl.sections()[1];
    const sel = v.state.selection.constructor;
    v.dispatch(v.state.tr.setSelection(sel.near(v.state.doc.resolve(second.pos + 2))));
    v.focus();
  });
  await page.keyboard.press('Backspace');
  await settle();
  const n = await ev(() => window.__novaWriter.ctl.sections().length);
  assert.equal(n, 1);
  assert.ok((await ev(() => window.__novaWriter.ctl.page.width)) > 800, 'the merged section keeps the page of the section that followed the break');
});

await check('two columns across pages: rows of columns are pages', async () => {
  await newDoc();
  await ev(() => window.__novaWriter.ctl.mainView.focus());
  await fill(40, lorem.repeat(3));
  await settle();
  await ev(() => {
    const { ctl } = window.__novaWriter;
    const v = ctl.mainView;
    v.dispatch(v.state.tr.setNodeMarkup(0, undefined, { ...v.state.doc.child(0).attrs, cols: { count: 2, space: 36, sep: true, widths: null } }));
  });
  await settle();
  await settle();
  const info = await ev(() => {
    const { ctl } = window.__novaWriter;
    const sec = document.querySelector('.nw-doc section.nw-section');
    const cs = getComputedStyle(sec);
    const ps = [...sec.querySelectorAll(':scope > p')];
    const left = new Set(ps.map((p) => Math.round(p.getBoundingClientRect().left)));
    return { pages: ctl.pages, count: cs.columnCount, wrap: cs.columnWrap, paged: sec.classList.contains('nw-paged'), lefts: [...left].length };
  });
  assert.equal(info.count, '2');
  assert.ok(info.pages >= 2, `pages ${info.pages}`);
  assert.equal(info.paged, true);
  await shot('columns-paged');
  // each page paints text only inside its rectangle
  const bad = await ev(() => {
    const { ctl } = window.__novaWriter;
    const sheet = document.querySelector('.nw-sheet');
    const sc = sheet.getBoundingClientRect().width / sheet.offsetWidth;
    const top0 = sheet.getBoundingClientRect().top;
    const rects = ctl.pageRects();
    const out = [];
    for (const p of document.querySelectorAll('.nw-doc section > p')) {
      const r = document.createRange();
      r.selectNodeContents(p);
      for (const q of r.getClientRects()) {
        const y = (q.top - top0) / sc;
        const inPage = rects.some((pg) => y >= pg.top - 1 && (q.bottom - top0) / sc <= pg.top + pg.height + 1);
        if (!inPage) out.push(Math.round(y));
      }
    }
    return out.slice(0, 5);
  });
  assert.deepEqual(bad, [], 'lines fall between pages');
});

await check('a continuous section with columns is balanced on the page', async () => {
  await newDoc();
  await fill(1, 'Introducción del documento.');
  await ev(() => {
    const { ctl } = window.__novaWriter;
    const v = ctl.mainView;
    v.focus();
    const sel = v.state.selection.constructor;
    v.dispatch(v.state.tr.setSelection(sel.near(v.state.doc.resolve(v.state.doc.content.size - 1))));
  });
  await page.keyboard.press('Control+End');
  await page.getByRole('tab', { name: 'Diseño' }).click();
  await page.locator('[data-nv-item="breaksMenu"]').click();
  await page.getByRole('menuitem', { name: /continuo/ }).click();
  await fill(1, lorem.repeat(5));
  await page.keyboard.press('Control+End');
  await page.locator('[data-nv-item="columnsMenu"]').click();
  await page.getByRole('menuitem', { name: 'Dos', exact: true }).click();
  await settle();
  const info = await ev(() => {
    const { ctl } = window.__novaWriter;
    return { pages: ctl.pages, sections: ctl.sections().map((s) => [s.props.start, s.props.cols.count]), paged: [...document.querySelectorAll('section.nw-paged')].length };
  });
  assert.equal(info.pages, 1);
  assert.deepEqual(info.sections.map((s) => s[1]), [1, 2]);
  assert.equal(info.paged, 0);
  await shot('columns-continuous');
});

await check('watermark appears on every page and can be removed', async () => {
  await newDoc();
  await fill(30, lorem.repeat(3));
  await settle();
  await page.getByRole('tab', { name: 'Diseño' }).click();
  await page.locator('[data-nv-item="watermarkMenu"]').click();
  await page.getByRole('menuitem', { name: 'Confidencial' }).click();
  await settle();
  const n = await page.locator('.nw-watermark').count();
  const pages = await ev(() => window.__novaWriter.ctl.pages);
  assert.equal(n, pages);
  assert.ok(pages >= 2);
  assert.equal(await page.locator('.nw-watermark').first().innerText(), 'CONFIDENCIAL');
  await shot('watermark');
  await page.locator('[data-nv-item="watermarkMenu"]').click();
  await page.getByRole('menuitem', { name: 'Quitar marca de agua' }).click();
  assert.equal(await page.locator('.nw-watermark').count(), 0);
});

await check('header: different first page and edited right on the page', async () => {
  await newDoc();
  await fill(30, lorem.repeat(3));
  await settle();
  await page.locator('.nw-zone-header').first().dblclick();
  await page.locator('.nw-hf-edit .ProseMirror').first().click();
  await page.keyboard.type('Encabezado general');
  await page.getByRole('tab', { name: 'Encabezado y pie' }).click();
  await page.getByRole('button', { name: 'Primera página diferente' }).click();
  await settle();
  // the first page now has its own (empty) header; type one for it
  await page.locator('.nw-hf-edit .ProseMirror').first().click();
  await page.keyboard.type('Solo primera');
  await page.getByRole('button', { name: 'Cerrar encabezado y pie de página' }).first().click();
  await settle();
  const heads = (await page.locator('.nw-header').allInnerTexts()).map((x) => x.trim());
  assert.equal(heads[0], 'Solo primera');
  assert.equal(heads[1], 'Encabezado general');
  await shot('header-first-page');
});

await check('page numbers restart in a section and use roman numerals', async () => {
  await newDoc();
  await fill(2, lorem.repeat(2));
  await ev(() => {
    const { ctl } = window.__novaWriter;
    const v = ctl.mainView;
    v.focus();
    const sel = v.state.selection.constructor;
    v.dispatch(v.state.tr.setSelection(sel.near(v.state.doc.resolve(v.state.doc.content.size - 1))));
  });
  await page.keyboard.press('Control+End');
  await page.getByRole('tab', { name: 'Diseño' }).click();
  await page.locator('[data-nv-item="breaksMenu"]').click();
  await page.getByRole('menuitem', { name: /página siguiente/ }).click();
  await fill(2, lorem.repeat(2));
  await ev(() => {
    const { ctl } = window.__novaWriter;
    ctl.setSectionProps(1, { pgNumStart: 1, pgNumFmt: 'lowerRoman' });
    ctl.setPart(0, 'footer', 'default', ctl.mainView.state.schema.nodes.doc.create(null, [ctl.mainView.state.schema.nodes.paragraph.create({ align: 'center' }, [ctl.mainView.state.schema.nodes.field.create({ kind: 'page' })])]));
  });
  await settle();
  const feet = (await page.locator('.nw-footer').allInnerTexts()).map((x) => x.trim());
  assert.deepEqual(feet, ['1', 'i']);
});

await check('view modes: web layout has no pages, draft and print restore them', async () => {
  await page.getByRole('tab', { name: 'Vista' }).click();
  await page.getByRole('button', { name: 'Diseño web' }).click();
  await settle();
  assert.equal(await page.locator('.nw-page').count(), 0);
  await shot('web-view');
  await page.getByRole('button', { name: 'Diseño de impresión' }).click();
  await settle();
  assert.ok((await page.locator('.nw-page').count()) >= 1);
});

await check('navigation pane lists headings and goes to them', async () => {
  await newDoc();
  await ev(() => {
    const { ctl } = window.__novaWriter;
    const v = ctl.mainView;
    const S = v.state.schema;
    const H = (lv, t) => S.node('paragraph', { style: `Heading${lv}` }, [S.text(t)]);
    const P = (t) => S.node('paragraph', null, [S.text(t)]);
    const blocks = [H(1, 'Uno'), P('texto uno'), H(2, 'Uno punto uno'), P('texto'), H(1, 'Dos'), P('texto dos')];
    v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, S.node('section', v.state.doc.child(0).attrs, blocks)).setMeta('nw-load', true));
  });
  await settle();
  await page.getByRole('tab', { name: 'Vista' }).click();
  await page.getByRole('button', { name: 'Panel de navegación' }).click();
  const items = await page.locator('.nw-nav li button').allInnerTexts();
  assert.deepEqual(items, ['Uno', 'Uno punto uno', 'Dos']);
  await page.locator('.nw-nav li button', { hasText: 'Dos' }).click();
  const head = await ev(() => { const s = window.__novaWriter.ctl.mainView.state; return s.doc.textBetween(s.selection.$head.start(), s.selection.$head.end()); });
  assert.equal(head, 'Dos');
  await page.getByRole('button', { name: 'Cerrar' }).first().click();
});

await check('outline view: levels, fold, promote and move', async () => {
  await page.getByRole('tab', { name: 'Vista' }).click();
  await page.getByRole('button', { name: 'Esquema', exact: true }).click();
  await settle();
  await page.locator('[role=tab]', { hasText: 'Esquema' }).last().click();
  assert.equal(await page.locator('.nw-doc .nw-ol-h:not(.nw-ol-hidden)').count(), 3);
  await page.locator('[data-nv-item="olLevelMenu"]').click();
  await page.getByRole('menuitem', { name: 'Mostrar nivel 1' }).click();
  assert.equal(await page.locator('.nw-doc .nw-ol-lv2:not(.nw-ol-hidden)').count(), 0);
  assert.equal(await page.locator('.nw-doc .nw-ol-body:not(.nw-ol-hidden)').count(), 0);
  await page.locator('[data-nv-item="olLevelMenu"]').click();
  await page.getByRole('menuitem', { name: 'Mostrar nivel 6' }).click();
  // fold "Uno" with its marker
  await page.locator('.nw-ol-marker').first().click();
  const visible = await page.locator('.nw-doc .nw-ol-h:not(.nw-ol-hidden)').allInnerTexts();
  assert.equal(visible.length, 2, `folded: ${visible.join('|')}`);
  await page.locator('.nw-ol-marker').first().click();
  // move "Dos" up above "Uno"
  await page.locator('.nw-doc .nw-ol-h', { hasText: /^.?Dos/ }).first().click();
  await page.getByRole('button', { name: 'Subir', exact: true }).click();
  await settle();
  const order = await ev(() => [...window.__novaWriter.ctl.mainView.state.doc.firstChild.content.content].filter((n) => n.attrs.style).map((n) => n.textContent));
  assert.deepEqual(order, ['Dos', 'Uno', 'Uno punto uno']);
  // demote "Uno punto uno"
  await page.locator('.nw-doc .nw-ol-h', { hasText: 'Uno punto uno' }).first().click();
  await page.getByRole('button', { name: 'Bajar de nivel' }).click();
  const lv = await ev(() => window.__novaWriter.ctl.mainView.state.doc.firstChild.child(4).attrs.style);
  assert.equal(lv, 'Heading3');
  await shot('outline');
  await page.getByRole('button', { name: 'Cerrar vista Esquema' }).click();
  await settle();
  assert.ok((await page.locator('.nw-page').count()) >= 1);
});

await check('tab stops: right tab with dot leader lines the text up', async () => {
  await newDoc();
  await ev(() => {
    const { ctl } = window.__novaWriter;
    const v = ctl.mainView;
    const S = v.state.schema;
    const tabs = [{ pos: 400, kind: 'right', leader: 'dot' }];
    const p = (t) => S.node('paragraph', { tabs }, [S.text(t)]);
    v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, S.node('section', v.state.doc.child(0).attrs, [p('Capítulo uno\t3'), p('Capítulo dos con título largo\t45')])).setMeta('nw-load', true));
  });
  await settle();
  const r = await ev(() => {
    const out = [];
    for (const p of document.querySelectorAll('.nw-doc p[data-tabs]')) {
      const tab = p.querySelector('span.nw-tab');
      const range = document.createRange();
      range.selectNodeContents(p);
      const rects = range.getClientRects();
      const right = Math.max(...[...rects].map((q) => q.right));
      out.push({ w: Math.round(tab.getBoundingClientRect().width), right: Math.round(right), bg: tab.style.backgroundImage.slice(0, 12) });
    }
    return out;
  });
  assert.equal(r.length, 2);
  assert.ok(r[0].w > 100 && r[1].w > 100, JSON.stringify(r));
  assert.ok(Math.abs(r[0].right - r[1].right) <= 1.5, `right edges differ: ${JSON.stringify(r)}`);
  assert.match(r[0].bg, /radial/);
  await shot('tabs-leader');
});

await check('the ruler shows indents and the margin handle changes the margin', async () => {
  await newDoc();
  await page.locator('.nw-doc').click();
  await page.keyboard.type('Texto con sangría');
  assert.ok((await page.locator('.nw-hruler').count()) === 1);
  assert.ok((await page.locator('.nw-mk').count()) === 3);
  const before = await ev(() => window.__novaWriter.ctl.page.marginLeft);
  const box = await page.locator('.nw-hruler-handle').first().boundingBox();
  await page.mouse.move(box.x + 3, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 10, { steps: 6 });
  await page.mouse.up();
  const after = await ev(() => window.__novaWriter.ctl.page.marginLeft);
  assert.ok(after > before + 20, `${before} -> ${after}`);
  // drag the left indent marker
  const mk = await page.locator('.nw-mk-left').boundingBox();
  await page.mouse.move(mk.x + 5, mk.y + 5);
  await page.mouse.down();
  await page.mouse.move(mk.x + 45, mk.y + 5, { steps: 5 });
  await page.mouse.up();
  const ind = await ev(() => window.__novaWriter.ctl.mainView.state.doc.firstChild.firstChild.attrs.indentLeft);
  assert.ok(ind > 20, `indent ${ind}`);
  // click on the ruler adds a tab stop
  const hr = await page.locator('.nw-hruler').boundingBox();
  await page.mouse.click(hr.x + hr.width / 2, hr.y + 12);
  const tabs = await ev(() => window.__novaWriter.ctl.mainView.state.doc.firstChild.firstChild.attrs.tabs);
  assert.equal(tabs?.length, 1);
  await shot('ruler');
});

await check('no console errors', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
