// Imports real .xlsx files into Nova Base (read-only) and reports what became of them.
// Usage: node scripts/real-xlsx-base.mjs file1.xlsx file2.xlsx ...
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import path from 'node:path';

const files = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
for (const f of files) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const dialogs = [];
  const errs = [];
  page.on('dialog', (d) => (dialogs.push(d.message()), d.dismiss()));
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:1420/?app=base', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__novaBase?.ctl.loading === false);
  await page.getByRole('tab', { name: 'Datos externos' }).click();
  const t0 = Date.now();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Importar libro de Excel…' }).click()]);
  await chooser.setFiles(f);
  await page.waitForFunction(() => window.__novaBase.ctl.db.tableNames().length > 0 || false, null, { timeout: 120000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const d = window.__novaBase.ctl.db;
    return d.tables().map((t) => ({ table: t.name, rows: t.rowCount, columns: t.columns.length, types: [...new Set(t.columns.map((c) => c.type))].join('/') }));
  });
  console.log(path.basename(f), JSON.stringify({ importMs: Date.now() - t0, tables: info, dialogs, errors: errs }));
  await page.screenshot();
  await page.close();
}
await browser.close();
