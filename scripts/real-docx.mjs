// Opens real .docx files in Nova Writer (read-only) and reports structure, warnings, pages and round trip.
// Usage: node scripts/real-docx.mjs outdir file1.docx file2.docx ...
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const writerCore = '/@fs/' + path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../packages/writer-core/src/index.ts').replace(/\\/g, '/');

const [out, ...files] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
for (const f of files) {
  const page = await ctx.newPage();
  const dialogs = [];
  const errs = [];
  page.on('dialog', (d) => (dialogs.push(d.message()), d.dismiss()));
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:1420/?app=writer', { waitUntil: 'networkidle' });
  await page.waitForSelector('.nw-doc');
  const b64 = fs.readFileSync(f).toString('base64');
  const t0 = Date.now();
  await page.evaluate(([b, n]) => window.__novaWriter.load(b, n), [b64, path.basename(f)]);
  await page.waitForTimeout(1500);
  const info = await page.evaluate(async (writerCore) => {
    const { ctl } = window.__novaWriter;
    const q = (s) => document.querySelectorAll(`.nw-doc ${s}`).length;
    const doc = ctl.toWriterDoc();
    const w = await import(writerCore);
    const { data, warnings } = await w.writeDocx(doc);
    const back = await w.readDocx(data);
    return {
      pages: ctl.pages, words: ctl.words().total, paragraphs: q('p'), tables: q('table'), images: q('img'), lists: q('ul,ol'), links: q('a'), headings: q('p[class*="Heading"]'),
      header: !!ctl.header, footer: !!ctl.footer, pageSize: [Math.round(ctl.page.width), Math.round(ctl.page.height)], defaults: ctl.defaults,
      writeWarnings: warnings, sameTextAfterRoundTrip: back.doc.body.textContent === doc.body.textContent, bytes: data.length,
      overflowX: document.querySelector('.nw-scroll').scrollWidth > document.querySelector('.nw-scroll').clientWidth + 2,
    };
  }, writerCore);
  await page.screenshot();
  await page.screenshot({ path: path.join(out, path.basename(f) + '.png') });
  const html = await page.evaluate(() => window.__novaWriter.printHtml());
  const p2 = await ctx.newPage();
  await p2.setContent(html, { waitUntil: 'load' });
  await p2.waitForTimeout(800);
  const pdf = await p2.pdf({ preferCSSPageSize: true, printBackground: true });
  const pdfPages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  console.log(path.basename(f), JSON.stringify({ openMs: Date.now() - t0, ...info, pdfPages, warnings: dialogs, errors: errs }, null, 1));
  await p2.close();
  await page.close();
}
await browser.close();
