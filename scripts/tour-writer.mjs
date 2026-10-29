// Quick visual tour of Nova Writer: node scripts/tour-writer.mjs <outdir>
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const out = process.argv[2] ?? 'shots-writer';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const logs = [];
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(process.env.NOVA_URL ?? 'http://localhost:1420/?app=writer', { waitUntil: 'networkidle' });
await page.waitForSelector('.nw-doc');
await page.screenshot();
await page.click('.nw-doc');
const para = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. ';
await page.keyboard.type('Informe de prueba');
await page.evaluate(() => {
  const { ctl } = window.__novaWriter;
  const v = ctl.view;
  v.dispatch(v.state.tr.setNodeMarkup(0, undefined, { ...v.state.doc.child(0).attrs, style: 'Heading1' }));
});
for (let i = 0; i < 30; i++) {
  await page.keyboard.press('Enter');
  await page.keyboard.type(para.repeat(2), { delay: 0 });
}
await page.waitForTimeout(800);
console.log('pages', await page.evaluate(() => window.__novaWriter.ctl.pages));
await page.screenshot({ path: `${out}/01-long.png` });
await page.evaluate(() => document.querySelector('.nw-scroll').scrollTo(0, 1000));
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/02-scrolled.png` });
await browser.close();
console.log(logs.join('\n') || 'no console issues');
