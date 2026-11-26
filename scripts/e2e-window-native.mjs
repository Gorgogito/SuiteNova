// Checks the single title bar in the COMPILED desktop app (Tauri + WebView2): no title bar of Windows, the window buttons,
// double click, resizing borders, and the question before closing with unsaved changes. It starts the app with its own
// WebView2 profile (the settings of the person are not touched) and a remote debugging port, and drives it from Playwright.
// Windows appear on screen while it runs. Windows only.
// Build first: pnpm tauri build --no-bundle   Usage: node scripts/e2e-window-native.mjs [--exe path] [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const shotsDir = arg('--shots');
const exe = arg('--exe') ?? path.resolve('apps/suite/src-tauri/target/release/suitenova.exe');
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
assert.ok(fs.existsSync(exe), `no existe ${exe}: compila con pnpm tauri build --no-bundle`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-window-'));
const doc = path.join(dir, 'prueba.txt');
fs.writeFileSync(doc, 'Texto de prueba.\n');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const results = [];
const check = async (name, fn) => {
  try {
    let timer;
    await Promise.race([fn(), new Promise((_, rej) => (timer = setTimeout(() => rej(new Error('sin respuesta en 60 s')), 60000)))]).finally(() => clearTimeout(timer));
    results.push(['ok', name]);
    console.log(`  ✔ ${name}`);
  } catch (e) {
    results.push(['FAIL', name]);
    console.log(`  ✘ ${name}\n      ${e.message.split('\n').filter(Boolean).slice(0, 10).join(' | ')}`);
  }
};

let running = null;
/** Starts the app (optionally with a file) and connects to its windows. */
const start = async (port, args = []) => {
  const proc = spawn(exe, args, {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, WEBVIEW2_USER_DATA_FOLDER: path.join(dir, 'perfil') },
    stdio: 'ignore',
  });
  let browser;
  for (let i = 0; i < 60 && !browser; i++) browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => sleep(1000).then(() => null));
  assert.ok(browser, 'no se pudo conectar con la aplicación');
  const pages = () => browser.contexts().flatMap((c) => c.pages());
  const dialogs = [];
  /** The window whose address matches, ready to be used. Its questions are kept in `dialogs` for the check to answer. */
  const window_ = async (match, ready = '.nv-titlebar') => {
    let page;
    for (let i = 0; i < 60 && !page; i++) {
      page = pages().find((p) => match(new URL(p.url())));
      if (!page) await sleep(500);
    }
    assert.ok(page, 'no apareció la ventana');
    page.setDefaultTimeout(15000);
    if (!page.__watched) {
      page.__watched = true;
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy/.test(m.text()) && errors.push(m.text()));
      page.on('dialog', (d) => dialogs.push(d));
    }
    await page.waitForSelector(ready);
    await sleep(1200);
    return page;
  };
  running = { proc, browser, pages, dialogs, window: window_ };
  return running;
};
const stop = async () => {
  await running?.browser.close().catch(() => {});
  running?.proc.kill();
  running = null;
  await sleep(1500);
};

/** A command of the window plugin of Tauri, asked from the page about its own window. */
const ask = (page, command) =>
  page.evaluate((c) => window.__TAURI_INTERNALS__.invoke(`plugin:window|${c}`, { label: window.__TAURI_INTERNALS__.metadata.currentWindow.label }), command);
const until = async (fn, message) => {
  for (let i = 0; i < 40; i++) {
    if (await fn()) return;
    await sleep(150);
  }
  assert.fail(message);
};
const nextDialog = async () => {
  await until(() => running.dialogs.length > 0, 'no preguntó nada');
  return running.dialogs.shift();
};
const button = (page, name) => page.getByRole('group', { name: 'Ventana' }).getByRole('button', { name, exact: true });

/** Windows' own view of the window of a process: run PowerShell with the Win32 functions it needs. */
const win32 = (pid, body) => {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class W {
  public delegate bool Proc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(Proc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, Proc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  public static List<IntPtr> Tops(uint want) { var r = new List<IntPtr>(); EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == want && IsWindowVisible(h)) r.Add(h); return true; }, IntPtr.Zero); return r; }
  public static List<IntPtr> Children(IntPtr of) { var r = new List<IntPtr>(); EnumChildWindows(of, (h, l) => { r.Add(h); return true; }, IntPtr.Zero); return r; }
  public static string Class(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  public static string Title(IntPtr h) { var s = new StringBuilder(256); GetWindowText(h, s, 256); return s.ToString(); }
}
"@
[void][W]::SetProcessDPIAware()
$tops = @([W]::Tops(${pid}) | Where-Object { [W]::Class($_) -eq 'Tauri Window' })
${body}`;
  return execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim();
};

try {
  // ---------------------------------------------------------------- a document opened from outside
  let app = await start(9351, [doc]);
  let page = await app.window((u) => u.searchParams.get('app') === 'writer', '.ProseMirror');
  const editor = () => page.locator('.ProseMirror').first();

  await check('la ventana no tiene la barra de título de Windows, está a la vista y lleva sus tres botones', async () => {
    assert.equal(await ask(page, 'is_decorated'), false);
    assert.equal(await ask(page, 'is_visible'), true);
    const outer = await ask(page, 'outer_position');
    const inner = await ask(page, 'inner_position');
    assert.ok(inner.y - outer.y <= 2, `hay ${inner.y - outer.y} px sobre la página`);
    for (const n of ['Minimizar', 'Maximizar', 'Cerrar ventana']) await button(page, n).waitFor();
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/nativa-writer.png` });
  });

  await check('window.confirm es la de WebView2: la pregunta detiene la acción', async () => {
    assert.match(await page.evaluate(() => String(window.confirm)), /native code/);
  });

  await check('maximizar y restaurar con el botón, sin tapar la barra de tareas', async () => {
    await button(page, 'Maximizar').click();
    await until(() => ask(page, 'is_maximized'), 'no se maximizó');
    await button(page, 'Restaurar').waitFor();
    await sleep(600);
    const monitor = await ask(page, 'current_monitor');
    const at = await ask(page, 'inner_position');
    const size = await ask(page, 'inner_size');
    const area = monitor.workArea;
    assert.ok(Math.abs(at.x - area.position.x) <= 2 && Math.abs(at.y - area.position.y) <= 2, `origen ${at.x},${at.y}; área ${area.position.x},${area.position.y}`);
    assert.ok(size.width <= area.size.width + 2 && size.height <= area.size.height + 2, `tamaño ${size.width}x${size.height}; área ${area.size.width}x${area.size.height}`);
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/nativa-maximizada.png` });
    await button(page, 'Restaurar').click();
    await until(async () => !(await ask(page, 'is_maximized')), 'no se restauró');
    await button(page, 'Maximizar').waitFor();
  });

  await check('doble clic en la barra de título maximiza y vuelve (el del arrastre de Tauri)', async () => {
    // a second click made by the page itself: a real first click would start moving the window under the mouse
    const double = () => page.evaluate(() => document.querySelector('.nv-title').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true, button: 0, detail: 2 })));
    await double();
    await until(() => ask(page, 'is_maximized'), 'el doble clic no maximizó');
    await double();
    await until(async () => !(await ask(page, 'is_maximized')), 'el doble clic no restauró');
  });

  await check('minimizar con el botón', async () => {
    await button(page, 'Minimizar').click();
    await until(() => ask(page, 'is_minimized'), 'no se minimizó');
    win32(app.proc.pid, '[void][W]::ShowWindow($tops[0], 9)');
    await until(async () => !(await ask(page, 'is_minimized')), 'no volvió');
    await sleep(800);
  });

  await check('los bordes siguen sirviendo para cambiar el tamaño', async () => {
    const at = await ask(page, 'outer_position');
    const size = await ask(page, 'outer_size');
    const midX = at.x + Math.floor(size.width / 2);
    const midY = at.y + Math.floor(size.height / 2);
    // Windows asks each window what is under a point: 10 left, 11 right, 12 top, 15 bottom, 17 bottom right
    const probes = [[10, at.x + 2, midY], [11, at.x + size.width - 3, midY], [12, midX, at.y + 1], [15, midX, at.y + size.height - 3], [17, at.x + size.width - 3, at.y + size.height - 3]];
    const out = win32(
      app.proc.pid,
      `$all = @($tops[0]) + @([W]::Children($tops[0]))
foreach ($p in @(${probes.map(([, x, y]) => `@(${x},${y})`).join(',')})) {
  $l = [IntPtr](($p[1] -shl 16) -bor ($p[0] -band 0xFFFF))
  ($all | ForEach-Object { [long][W]::SendMessage($_, 0x84, [IntPtr]::Zero, $l) }) -join ' '
}`,
    );
    const lines = out.split(/\r?\n/);
    probes.forEach(([want], i) => assert.ok(lines[i].split(' ').map(Number).includes(want), `punto ${i}: se esperaba ${want} y respondió ${lines[i]}`));
  });

  await check('cerrar con cambios sin guardar pregunta una vez; «Cancelar» deja la ventana', async () => {
    await editor().click();
    await page.keyboard.type('Cambio sin guardar. ');
    await sleep(500);
    await button(page, 'Cerrar ventana').click({ noWaitAfter: true });
    const d = await nextDialog();
    assert.equal(d.type(), 'confirm');
    assert.match(d.message(), /cambios sin guardar/);
    await d.dismiss();
    await sleep(1500);
    assert.equal(app.dialogs.length, 0, 'preguntó dos veces');
    assert.ok(!page.isClosed(), 'se cerró a pesar de cancelar');
    assert.match(await editor().innerText(), /Cambio sin guardar/);
  });

  await check('cerrar desde Windows (Alt+F4, barra de tareas) también pregunta', async () => {
    win32(app.proc.pid, '[void][W]::PostMessage($tops[0], 0x10, [IntPtr]::Zero, [IntPtr]::Zero)');
    const d = await nextDialog();
    assert.match(d.message(), /cambios sin guardar/);
    await d.dismiss();
    await sleep(1000);
    assert.ok(!page.isClosed());
  });

  await check('Archivo › Cerrar pregunta una sola vez', async () => {
    await page.getByRole('button', { name: 'Archivo', exact: true }).click();
    await page.locator('.nv-backstage__item', { hasText: 'Cerrar' }).click({ noWaitAfter: true });
    const d = await nextDialog();
    await d.dismiss();
    await sleep(1500);
    assert.equal(app.dialogs.length, 0, 'preguntó dos veces');
    assert.ok(!page.isClosed());
  });

  await check('«Aceptar» descarta los cambios y cierra', async () => {
    await button(page, 'Cerrar ventana').click({ noWaitAfter: true });
    await (await nextDialog()).accept();
    await until(() => page.isClosed(), 'la ventana sigue abierta');
  });
  await stop();

  // ---------------------------------------------------------------- the start window and the ones it opens
  app = await start(9352);
  const hub = await app.window((u) => !u.searchParams.get('app'));

  await check('la ventana de inicio tampoco tiene barra de Windows', async () => {
    assert.equal(await ask(hub, 'is_decorated'), false);
    assert.equal(await ask(hub, 'is_visible'), true);
    await button(hub, 'Cerrar ventana').waitFor();
  });

  await check('una aplicación abierta en tema negro: sin barra de Windows, visible y con el fondo del tema', async () => {
    await hub.evaluate(() => localStorage.setItem('suitenova.theme', JSON.stringify('black')));
    await hub.locator('.hub__card[data-app="calc"]').click();
    page = await app.window((u) => u.searchParams.get('app') === 'calc');
    assert.equal(await ask(page, 'is_decorated'), false);
    assert.equal(await ask(page, 'is_visible'), true);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgb(26, 26, 26)');
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/nativa-calc-negro.png` });
  });

  await check('borrar una hoja pregunta y «Cancelar» la conserva', async () => {
    await page.getByRole('button', { name: 'Hoja nueva', exact: true }).click();
    const tabs = page.locator('.calc-tab');
    await until(async () => (await tabs.count()) === 2, 'no se agregó la hoja');
    // the question stops the page, so the click only finishes once it is answered
    const remove = async (answer) => {
      await tabs.nth(1).click({ button: 'right' });
      const click = page.locator('.calc-menu [role="menuitem"]', { hasText: 'Eliminar' }).click();
      const d = await nextDialog();
      assert.match(d.message(), /Eliminar la hoja/);
      await d[answer]();
      await click;
    };
    await remove('dismiss');
    await sleep(800);
    assert.equal(await tabs.count(), 2, 'la borró a pesar de cancelar');
    await remove('accept');
    await until(async () => (await tabs.count()) === 1, 'no la borró al aceptar');
  });

  await check('sin cambios, la ventana de inicio se cierra sin preguntar y las demás siguen', async () => {
    await button(hub, 'Cerrar ventana').click({ noWaitAfter: true });
    await until(() => hub.isClosed(), 'la ventana de inicio sigue abierta');
    assert.equal(app.dialogs.length, 0);
    assert.ok(!page.isClosed());
  });

  await check('la vista de moderador conserva la barra de Windows', async () => {
    // opened the same way as the show does it
    await page.evaluate(() => {
      const label = `slides-prueba`;
      return window.__TAURI_INTERNALS__.invoke('plugin:webview|create_webview_window', { options: { label, url: 'index.html?app=slides', title: 'Slides' } });
    });
    const slides = await app.window((u) => u.searchParams.get('app') === 'slides');
    await sleep(500);
    // through the command search: the ribbon button may sit inside a collapsed group at this width
    await slides.locator('#nv-tellme').fill('Vista de moderador');
    await slides.keyboard.press('Enter');
    const presenter = await app.window((u) => u.searchParams.get('role') === 'presenter', 'body');
    assert.equal(await ask(presenter, 'is_decorated'), true);
    assert.equal(await presenter.locator('.nv-wincontrols').count(), 0);
    await slides.keyboard.press('Escape');
  });
} finally {
  await stop();
}

const failed = results.filter((r) => r[0] !== 'ok').length;
if (errors.length) console.log('Console errors:', errors.slice(0, 8));
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed || errors.length ? 1 : 0);
