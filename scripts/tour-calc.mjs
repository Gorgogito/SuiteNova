// Takes a visual tour of Nova Calc (dark theme, dialogs, menus) for manual review. Needs `pnpm dev` on :1420.
// Usage: node scripts/tour-calc.mjs <outDir>
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const out = process.argv[2] ?? 'tour';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
const page = await ctx.newPage();
page.on('dialog', (d) => d.dismiss());
await page.goto('http://localhost:1420/?app=calc', { waitUntil: 'load' });
await page.waitForSelector('.calc-grid__scroller');
await page.screenshot();
await page.waitForTimeout(300);
const gb = await page.locator('.calc-grid__scroller').boundingBox();
const at = (c, r) => [gb.x + 40 + c * 64 + 32, gb.y + 22 + r * 20 + 10];
let n = 0;
const shot = async (name) => {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-${name}.png` });
};

// sample data
await page.mouse.click(...at(0, 0));
const rows = [
  ['Región', 'Q1', 'Q2', 'Q3', 'Q4', 'Total'],
  ['Norte', '120', '135', '150', '170', '=SUMA(B2:E2)'],
  ['Sur', '90', '95', '110', '105', '=SUMA(B3:E3)'],
  ['Este', '150', '160', '155', '180', '=SUMA(B4:E4)'],
  ['Oeste', '70', '85', '90', '120', '=SUMA(B5:E5)'],
  ['Total', '=SUMA(B2:B5)', '=SUMA(C2:C5)', '=SUMA(D2:D5)', '=SUMA(E2:E5)', '=SUMA(F2:F5)'],
];
for (const row of rows) {
  for (const v of row) {
    await page.keyboard.type(v);
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Enter');
}
// header styling
await page.mouse.click(...at(0, 0));
await page.keyboard.down('Shift');
await page.mouse.click(...at(5, 0));
await page.keyboard.up('Shift');
await page.keyboard.press('Control+b');
await page.click('[data-nv-item="calc.alignCenter"]');
await shot('data-light');

// chart from the data
await page.mouse.click(...at(0, 0));
await page.keyboard.down('Shift');
await page.mouse.click(...at(4, 4));
await page.keyboard.up('Shift');
await page.getByRole('tab', { name: 'Insertar' }).click();
await page.click('[data-nv-item="chartMenu:primary"]');
await shot('chart');
await page.getByRole('tab', { name: 'Inicio' }).click();

// context menu
await page.mouse.click(...at(2, 2), { button: 'right' });
await shot('context-menu');
await page.keyboard.press('Escape');

// format cells dialog
await page.mouse.click(...at(1, 1));
await page.keyboard.press('Control+1');
await shot('format-dialog');
await page.keyboard.press('Escape');

// backstage
await page.getByRole('button', { name: 'Archivo' }).click();
await shot('backstage');
await page.keyboard.press('Escape');

// number format dropdown & borders menu
await page.click('[data-nv-item="borders"]');
await shot('borders-menu');
await page.keyboard.press('Escape');

// dark theme
await page.emulateMedia({ colorScheme: 'dark' });
await page.getByRole('tab', { name: 'Vista' }).click();
await page.click('[data-nv-item="themeMenu"]');
await page.getByRole('menuitem', { name: 'Tema oscuro' }).click();
await page.getByRole('tab', { name: 'Inicio' }).click();
await shot('dark');

// frozen panes + zoom
await page.getByRole('tab', { name: 'Vista' }).click();
await page.mouse.click(...at(1, 1));
await page.click('[data-nv-item="freezeMenu"]');
await page.getByRole('menuitem', { name: 'Inmovilizar paneles' }).click();
await shot('dark-frozen');
await browser.close();
console.log('saved to', out);
