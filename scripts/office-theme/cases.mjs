// Themes compared with the real Office: `node scripts/office-theme/cases.mjs write <dir>` writes one .thmx per theme and the expectations
// (casos.json); `office-theme.ps1 -Dir <dir>` makes Word, Excel and PowerPoint apply them and read back colours, fonts and tints (resultados.json);
// `node scripts/office-theme/cases.mjs compare <dir>` lists what differs. theme-core is TypeScript: it is read through the Vite of `pnpm dev` (:1420).
import fs from 'node:fs';
import path from 'node:path';

const [mode, dir] = process.argv.slice(2);
const T = '/@fs/D:/ProjectsIA/SuiteNova/packages/theme-core/src/index.ts';

if (mode === 'write') {
  const { chromium } = await import('../../apps/suite/node_modules/playwright-core/index.mjs');
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
  const page = await (await browser.newContext()).newPage();
  await page.goto('http://localhost:1420/?app=writer', { waitUntil: 'load' });
  await page.waitForSelector('.ProseMirror');
  fs.mkdirSync(dir, { recursive: true });
  const out = await page.evaluate(async (T) => {
    const F = await import(T);
    const themes = F.themeCatalog().map((t, i) => {
      // vary fonts and effects too, so that every kind of part is checked
      const fonts = F.FONT_SCHEMES[i % F.FONT_SCHEMES.length];
      const fx = F.EFFECT_SCHEMES[i % F.EFFECT_SCHEMES.length];
      return F.withEffects(F.withFonts(t, fonts.fonts, fonts.name), fx.fmtXml, fx.name);
    });
    const files = [];
    for (let i = 0; i < themes.length; i++) {
      const bytes = await F.writeThmx(themes[i]);
      let s = '';
      for (const b of bytes) s += String.fromCharCode(b);
      files.push({ name: `tema${i}.thmx`, colorsXml: F.writeColorSchemeXml(themes[i].colorsName, themes[i].colors), fontsXml: F.writeFontSchemeXml(themes[i].fontsName, themes[i].fonts), b64: btoa(s), theme: { name: themes[i].name, colors: themes[i].colors, fonts: themes[i].fonts, effectsName: themes[i].effectsName }, gallery: F.themeGallery(themes[i]).map((c) => c.colors) });
    }
    return { files };
  }, T);
  await browser.close();
  for (const f of out.files) {
    fs.writeFileSync(path.join(dir, f.name), Buffer.from(f.b64, 'base64'));
    fs.writeFileSync(path.join(dir, f.name.replace('.thmx', '-colores.xml')), f.colorsXml);
    fs.writeFileSync(path.join(dir, f.name.replace('.thmx', '-fuentes.xml')), f.fontsXml);
  }
  fs.writeFileSync(path.join(dir, 'casos.json'), JSON.stringify({ themes: out.files.map(({ name, theme, gallery }) => ({ file: name, theme, gallery })) }));
  console.log('temas:', out.files.length);
} else if (mode === 'compare') {
  const res = JSON.parse(fs.readFileSync(path.join(dir, 'resultados.json'), 'utf8').replace(/^﻿/, ''));
  const cases = JSON.parse(fs.readFileSync(path.join(dir, 'casos.json'), 'utf8'));
  const SLOT = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const near = (a, b, tol) => rgb(a).every((v, i) => Math.abs(v - rgb(b)[i]) <= tol);
  let ok = 0;
  let total = 0;
  const bad = [];
  const check = (name, cond, detail) => {
    total++;
    if (cond) ok++;
    else bad.push(`${name}: ${detail}`);
  };
  cases.themes.forEach((c, i) => {
    const r = res.themes[i];
    for (const app of ['word', 'excel', 'ppt']) {
      const a = r[app];
      if (!a || a.error) {
        check(`${c.file} ${app}`, false, a?.error ?? 'sin resultado');
        continue;
      }
      check(`${c.file} ${app} colores`, SLOT.every((s, k) => a.colors[k].toLowerCase() === c.theme.colors[s].toLowerCase()), `${a.colors.join(',')} ≠ ${SLOT.map((s) => c.theme.colors[s]).join(',')}`);
      check(`${c.file} ${app} fuentes`, a.major === c.theme.fonts.major.latin && a.minor === c.theme.fonts.minor.latin, `${a.major}/${a.minor} ≠ ${c.theme.fonts.major.latin}/${c.theme.fonts.minor.latin}`);
    }
    if (r.excel?.tints) {
      const bad2 = [];
      c.gallery.forEach((col, ci) => col.forEach((h, ri) => !near(r.excel.tints[ci][ri], h, 2) && bad2.push(`col ${ci} fila ${ri}: Excel ${r.excel.tints[ci][ri]}, nosotros ${h}`)));
      check(`${c.file} excel matices`, !bad2.length, bad2.slice(0, 3).join(' | '));
    }
    if (r.word?.saved) {
      const s = r.word.saved;
      check(`${c.file} word guarda`, SLOT.every((k, n) => s.colors[n].toLowerCase() === c.theme.colors[k].toLowerCase()) && s.effects === c.theme.effectsName, `${s.colors.join(',')} / ${s.effects} ≠ ${c.theme.effectsName}`);
    }
  });
  console.log(`comprobaciones iguales: ${ok} de ${total}`);
  bad.forEach((d) => console.log('  ✘', d));
  process.exit(bad.length ? 1 : 0);
}
