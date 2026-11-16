// Comprueba en la app Tauri real (WebView2) que el WordArt se dibuja con las fuentes del sistema (comandos `system_fonts` y
// `system_font_bytes`; `queryLocalFonts()` no responde en WebView2). Hay que lanzar antes el ejecutable con
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333   (y `pnpm dev` en :1420 si es una compilación de depuración)
// Uso: node scripts/probe-tauri-fonts.mjs
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:1420/?app=writer', { waitUntil: 'load' });
await page.setViewportSize({ width: 1600, height: 900 });
await page.waitForSelector('.ProseMirror');
const info = await page.evaluate(async () => {
  const { invoke } = await import('/node_modules/.vite/deps/@tauri-apps_api_core.js').catch(() => ({}));
  const t0 = performance.now();
  const list = invoke ? await invoke('system_fonts') : null;
  return { tauri: !!window.__TAURI_INTERNALS__, fonts: list?.length ?? null, calibri: list?.filter((f) => f.family === 'Calibri').map((f) => f.style) ?? null, ms: Math.round(performance.now() - t0) };
});
console.log('fuentes del sistema:', JSON.stringify(info));
await page.locator('.ProseMirror').first().click();
await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
await page.getByRole('button', { name: 'WordArt', exact: true }).first().click();
await page.locator('[data-wordart-style="gr3"]').click();
await page.waitForTimeout(2500);
const drawn = await page.evaluate(() => {
  const p = document.querySelector('.ProseMirror .nw-shape[data-wordart] svg.nw-wordart path[d]');
  return p ? (p.getAttribute('d').match(/L/g) ?? []).length : 0;
});
console.log('segmentos dibujados:', drawn);
assert.ok(info.tauri, 'es la app Tauri');
assert.ok(drawn > 100, 'el WordArt se dibuja con letras reales dentro de Tauri');
assert.deepEqual(errors, []);
console.log('OK');
await browser.close();
