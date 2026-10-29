// End-to-end checks for equations, shapes and content controls. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-writer-objects.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=writer';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
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
await page.waitForSelector('.ProseMirror');
await page.waitForTimeout(500);
const ev = (fn, arg) => page.evaluate(fn, arg);
const settle = (ms = 700) => page.waitForTimeout(ms);
const tab = async (n) => {
  const t = page.getByRole('tab', { name: n, exact: true });
  if ((await t.getAttribute('aria-selected')) !== 'true') await t.click();
};
const newDoc = async () => {
  await ev(() => window.__novaWriter.ctl.newDoc());
  await settle();
  await page.locator('.ProseMirror').click();
};
const findPos = (pred) =>
  ev((p) => {
    const v = window.__novaWriter.ctl.mainView;
    let pos = -1;
    v.state.doc.descendants((n, q) => {
      if (n.type.name === p.name && (!p.type || n.attrs.type === p.type)) pos = q;
    });
    return pos;
  }, pred);

await check('equation: insert from the dialog, preview, MathML drawn, edit by double click', async () => {
  await newDoc();
  await page.keyboard.type('Sea ');
  await tab('Insertar');
  await ev(() => window.__novaWriter.ctl.onDialog('equation', {}));
  await page.locator('#nw-eq-src').waitFor();
  await page.locator('#nw-eq-src').fill(String.raw`\frac{a}{b}+\sqrt{x^{2}}`);
  await settle(300);
  assert.equal(await page.locator('.nw-eq-preview math').count(), 1, 'preview');
  await shot('equation-dialog');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await settle();
  assert.equal(await page.locator('.ProseMirror .nw-math math').count(), 1);
  await shot('equation-inserted');
  await page.locator('.ProseMirror .nw-math').dblclick();
  await page.locator('#nw-eq-src').waitFor();
  assert.match(await page.locator('#nw-eq-src').inputValue(), /frac/);
  await page.locator('#nw-eq-src').fill('x^{2}');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await settle();
  const tex = await ev(() => {
    let t = '';
    window.__novaWriter.ctl.mainView.state.doc.descendants((n) => {
      if (n.type.name === 'math') t = n.attrs.tex;
    });
    return t;
  });
  assert.equal(tex, 'x^{2}');
});

await check('equation: ribbon menu has the sample equations and inserts one', async () => {
  await newDoc();
  await tab('Insertar');
  await page.getByRole('button', { name: 'Ecuación' }).last().click();
  await page.getByRole('menuitem', { name: 'Teorema de Pitágoras' }).click();
  await settle();
  assert.equal(await page.locator('.ProseMirror .nw-math math').count(), 1);
});

await check('equation: survives a docx round trip', async () => {
  const tex = await ev(async () => {
    const { ctl, docx } = window.__novaWriter;
    const { data } = await docx.writeDocx(ctl.toWriterDoc());
    const { doc } = await docx.readDocx(data);
    let t = '';
    doc.body.descendants((n) => {
      if (n.type.name === 'math') t = n.attrs.tex;
    });
    return t;
  });
  assert.match(tex, /a\^\{?2\}?\+b\^\{?2\}?=c\^\{?2\}?/);
});

await check('shapes: ribbon inserts an ellipse; format dialog changes size and wrap', async () => {
  await newDoc();
  await page.keyboard.type('Antes ');
  await tab('Insertar');
  await page.getByRole('button', { name: 'Formas' }).first().click();
  await page.getByRole('menuitem', { name: 'Elipse', exact: true }).click();
  await settle();
  assert.equal(await page.locator('.ProseMirror .nw-shape').count(), 1);
  await shot('shape-inserted');
  const pos = await findPos({ name: 'shape' });
  await ev((p) => window.__novaWriter.ctl.onDialog('shape', { pos: p }), pos);
  await page.locator('#nw-sh-w').fill('180');
  await page.locator('#nw-sh-wrap').selectOption('right');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await settle();
  const a = await ev(() => {
    let r;
    window.__novaWriter.ctl.mainView.state.doc.descendants((n) => {
      if (n.type.name === 'shape') r = n.attrs;
    });
    return r;
  });
  assert.equal(a.width, 180);
  assert.equal(a.wrap, 'right');
  await shot('shape-formatted');
});

await check('text box keeps its text through a docx round trip', async () => {
  await newDoc();
  await ev(() => {
    const v = window.__novaWriter.ctl.mainView;
    const S = v.state.schema;
    const box = S.nodes.shape.create({ kind: 'textbox', width: 200, height: 80 }, [S.nodes.paragraph.create(null, S.text('Dentro del cuadro'))]);
    v.dispatch(v.state.tr.replaceSelectionWith(box, false));
  });
  await settle();
  const out = await ev(async () => {
    const { ctl, docx } = window.__novaWriter;
    const { data } = await docx.writeDocx(ctl.toWriterDoc());
    const { doc } = await docx.readDocx(data);
    let r = null;
    doc.body.descendants((n) => {
      if (n.type.name === 'shape') r = [n.attrs.kind, n.textContent];
    });
    return r;
  });
  assert.deepEqual(out, ['textbox', 'Dentro del cuadro']);
  await shot('textbox');
});

await check('content controls: text placeholder is replaced by typing; checkbox toggles; dropdown picks', async () => {
  await newDoc();
  await tab('Programador');
  await page.getByRole('button', { name: 'Control de texto', exact: true }).click();
  await settle();
  assert.equal(await page.locator('.ProseMirror .nw-cc-text.nw-cc-empty').count(), 1);
  await page.locator('.ProseMirror .nw-cc-text').click();
  await page.keyboard.type('Ana');
  await settle(300);
  assert.equal(await page.locator('.ProseMirror .nw-cc-text.nw-cc-empty').count(), 0);
  assert.equal(await page.locator('.ProseMirror .nw-cc-text').innerText(), 'Ana');
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' ');
  await page.getByRole('button', { name: 'Casilla de verificación' }).click();
  await page.locator('.ProseMirror .nw-cc-checkbox').click();
  await settle(300);
  assert.equal(await page.locator('.ProseMirror .nw-cc-checkbox').innerText(), '☒');
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' ');
  await page.getByRole('button', { name: 'Lista desplegable' }).click();
  await page.locator('.ProseMirror .nw-cc-dropdown').click();
  await page.locator('.nw-ctl-popup').waitFor();
  await shot('dropdown-popup');
  await page.locator('.nw-ctl-item', { hasText: 'Elemento 2' }).click();
  await settle(300);
  assert.equal(await page.locator('.ProseMirror .nw-cc-dropdown').innerText(), 'Elemento 2');
});

await check('content controls: emptied control shows the placeholder again; properties dialog', async () => {
  const p = await findPos({ name: 'content_control', type: 'text' });
  await ev((pos) => {
    const v = window.__novaWriter.ctl.mainView;
    const n = v.state.doc.nodeAt(pos);
    v.dispatch(v.state.tr.delete(pos + 1, pos + 1 + n.content.size));
  }, p);
  await settle(300);
  assert.equal(await page.locator('.ProseMirror .nw-cc-text.nw-cc-empty').count(), 1);
  const d = await findPos({ name: 'content_control', type: 'dropdown' });
  await ev((pos) => window.__novaWriter.ctl.onDialog('control', { pos }), d);
  await page.locator('#nw-cc-title').fill('Elección');
  await page.locator('#nw-cc-items').fill('Rojo\nVerde=g');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await settle(300);
  const attrs = await ev(() => {
    let r;
    window.__novaWriter.ctl.mainView.state.doc.descendants((n) => {
      if (n.attrs.type === 'dropdown') r = n.attrs;
    });
    return r;
  });
  assert.equal(attrs.title, 'Elección');
  assert.deepEqual(attrs.items, [
    { label: 'Rojo', value: 'Rojo' },
    { label: 'Verde', value: 'g' },
  ]);
});

await check('forms protection: only the controls can be filled in', async () => {
  await newDoc();
  await page.keyboard.type('Nombre: ');
  await tab('Programador');
  await page.getByRole('button', { name: 'Control de texto', exact: true }).click();
  await ev(() => window.__novaWriter.ctl.setProtection({ mode: 'forms' }));
  await settle();
  await page.locator('.ProseMirror .nw-cc-text').click();
  await page.keyboard.type('Luis');
  await settle(300);
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('XXX');
  await settle(300);
  const txt = await ev(() => window.__novaWriter.ctl.mainView.state.doc.textContent);
  assert.match(txt, /Luis/);
  assert.doesNotMatch(txt, /XXX/);
  await ev(() => window.__novaWriter.ctl.setProtection(null));
});

await check('controls survive a docx round trip', async () => {
  await newDoc();
  await tab('Programador');
  await page.getByRole('button', { name: 'Selector de fecha' }).click();
  await page.keyboard.type(' ');
  await page.getByRole('button', { name: 'Casilla de verificación' }).click();
  const types = await ev(async () => {
    const { ctl, docx } = window.__novaWriter;
    const { data } = await docx.writeDocx(ctl.toWriterDoc());
    const { doc } = await docx.readDocx(data);
    const r = [];
    doc.body.descendants((n) => {
      if (n.type.name === 'content_control') r.push(n.attrs.type);
    });
    return r;
  });
  assert.deepEqual(types.sort(), ['checkbox', 'date']);
});

await check('no console errors', async () => {
  assert.deepEqual(errors, []);
});
for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
