// Search cases compared with the real Word: `node scripts/office-find/cases.mjs write <dir>` writes casos.json; Word answers with word-find.ps1
// (resultados.json); `node scripts/office-find/cases.mjs compare <dir>` runs the same cases with find-core and lists the differences.
import fs from 'node:fs';
import path from 'node:path';

const [mode, dir] = process.argv.slice(2);
// [name, text, query, {wild, matchCase, whole}]
const C = (name, text, query, o = {}) => ({ name, text, query, wild: !!o.wild, matchCase: !!o.matchCase, whole: !!o.whole });
const CASES = [
  C('mayusculas no', 'Casa casa CASA', 'casa'),
  C('mayusculas si', 'Casa casa CASA', 'casa', { matchCase: true }),
  C('palabra completa', 'casa casas encasa casa.', 'casa', { whole: true }),
  C('interrogacion es texto', 'a?b axb', 'a?b'),
  C('punto es texto', 'a.b axb', 'a.b'),
  C('especial ^t', 'a\tb a b', 'a^tb'),
  C('especial ^# digito', 'v1 v22 vx', 'v^#'),
  C('especial ^$ letra', 'a1 b2 33', '^$^#'),
  C('especial ^w blancos', 'a  b a b ab', 'a^wb'),
  C('caracter ^97', 'ab cb', '^97b'),
  C('comodin ?', 'gato pato rato ato', '?ato', { wild: true }),
  C('comodin * perezoso', 'abcabc', 'a*c', { wild: true }),
  C('comodin * entre palabras', 'el gato come pan', 'gato*pan', { wild: true }),
  C('conjunto', 'bat cat hat', '[bc]at', { wild: true }),
  C('rango', 'a1 a2 aX', 'a[0-9]', { wild: true }),
  C('negacion', 'bat cat hat', '[!bc]at', { wild: true }),
  C('principio y fin de palabra', 'uno unos desuno', '<uno>', { wild: true }),
  C('principio de palabra', 'casa casita acasa', '<ca*>', { wild: true }),
  C('repeticion {2;3}', 'a aa aaa aaaa', '<a{2;3}>', { wild: true }),
  C('repeticion sin tope', 'a aa aaa aaaa', 'a{2;}', { wild: true }),
  C('arroba tras un grupo', 'abbb', '(b)@', { wild: true }),
  C('arroba con fin de palabra', 'ab abb abbb a', 'ab@>', { wild: true }),
  C('repeticion {4}', '12 3456', '[0-9]{4}', { wild: true }),
  C('arroba una o mas', 'ab abb abbb a', 'ab@', { wild: true }),
  C('escape', 'a*b a-b', 'a\\*b', { wild: true }),
  C('mas es texto', 'x+y', 'x+y', { wild: true }),
  C('punto es texto con comodines', 'p.q pxq', 'p.q', { wild: true }),
  C('mayusculas con comodines', 'Gato gato', '?ato', { wild: true, matchCase: true }),
  C('grupo', 'Juan Lopez', '(<[A-Za-z]@>) (<[A-Za-z]@>)', { wild: true }),
  C('acentos distintos', 'canción cancion', 'cancion'),
];


// Replacements: [name, text, query, replacement, {wild, matchCase}]. In the text a paragraph is «\n» (Word says «\r»).
// `endMark`: «^p» also finds the last paragraph mark of the document in Word (it becomes the replacement, here a space); the text of a document here has none.
const R = (name, text, query, rep, o = {}) => ({ name, text, query, rep, wild: !!o.wild, matchCase: !!o.matchCase, endMark: !!o.endMark });
const REPLACES = [
  R('texto simple', 'gato perro gato', 'gato', 'pez'),
  R('mayusculas', 'Gato gato', 'gato', 'pez', { matchCase: true }),
  R('^& lo encontrado', 'a b', 'a', '[^&]'),
  R('grupos invertidos', 'Juan Lopez', '(<[A-Za-z]@>) (<[A-Za-z]@>)', '\\2, \\1', { wild: true }),
  R('^p a la salida', 'uno dos', ' ', '^p'),
  R('^p a la entrada', 'uno\ndos', '^p', ' ', { endMark: true }),
  R('^t', 'a b', ' ', '^t'),
  R('comodin ?', 'gato pato', '?ato', 'X', { wild: true }),
  R('comodin *', 'a1b a22b', 'a*b', 'Z', { wild: true }),
  R('repeticion', 'aaa aa a', '<a{2;}>', 'Y', { wild: true }),
  R('vacio borra', 'uno dos', 'uno ', ''),
  R('grupos numero y letras', 'ab12', '([a-z]@)([0-9]@)', '\\2\\1', { wild: true }),
  R('dos grupos con texto', 'x=1 y=22', '([a-z])=([0-9]@)', '\\1:\\2', { wild: true }),
];

if (mode === 'write') {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'casos.json'), JSON.stringify(CASES));
  fs.writeFileSync(path.join(dir, 'casos-reemplazo.json'), JSON.stringify(REPLACES.map((r) => ({ ...r, text: r.text.replace(/\n/g, '\r') }))));
  console.log('casos:', CASES.length, 'reemplazos:', REPLACES.length);
} else if (mode === 'compare' || mode === 'compare-replace') {
  // find-core is TypeScript: it is read through the Vite of `pnpm dev` (:1420), like the formula comparison
  const { chromium } = await import('../../apps/suite/node_modules/playwright-core/index.mjs');
  const rep = mode === 'compare-replace';
  const list = rep ? REPLACES : CASES;
  const word = JSON.parse(fs.readFileSync(path.join(dir, rep ? 'resultados-reemplazo.json' : 'resultados.json'), 'utf8').replace(/^﻿/, ''));
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
  const page = await (await browser.newContext()).newPage();
  await page.goto('http://localhost:1420/?app=writer', { waitUntil: 'load' });
  await page.waitForSelector('.ProseMirror');
  const all = await page.evaluate(
    async ({ cases, rep }) => {
      const F = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/find-core/src/index.ts');
      return cases.map((c) => {
        const r = F.compileQuery(c.query, { mode: c.wild ? 'wildcards' : 'normal', matchCase: c.matchCase, wholeWord: c.whole });
        if (!r.ok) return ['<error>'];
        return rep ? [F.replaceAllInText(r.query, c.text, c.rep).text] : F.findInText(r.query, c.text).map((m) => m.text);
      });
    },
    { cases: list, rep },
  );
  await browser.close();
  let same = 0;
  const diffs = [];
  list.forEach((c, i) => {
    const ours = all[i];
    const w = rep ? [String(word.results[i].text).replace(/\r/g, '\n').replace(c.endMark ? / $/ : /(?!)/, '')] : [].concat(word.results[i].found ?? []);
    if (JSON.stringify(ours) === JSON.stringify(w)) same++;
    else diffs.push(`${c.name}: «${c.query}» en «${c.text}» → Word ${JSON.stringify(w)}, nosotros ${JSON.stringify(ours)}`);
  });
  console.log(`casos iguales: ${same} de ${list.length}`);
  diffs.forEach((d) => console.log('  ✘', d));
  process.exit(diffs.length ? 1 : 0);
}
