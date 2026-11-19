// Contraste con Word real: lee scripts/word-compare/word-ac-out.json (generado por word-ac.ps1) y escribe informe-autocorreccion.txt. No afirma nada:
// Word es la referencia, no el criterio.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { autoCorrectTyped, loadAutoCorrectFrom } from './index';

const dir = fileURLToPath(new URL('../../../scripts/word-compare/', import.meta.url));
const file = dir + 'word-ac-out.json';

/** Lo que queda al teclear `text` carácter a carácter en un campo con la autocorrección de Nova (sin formato). */
function typeInNova(text: string, lang: 'es' | 'en'): string {
  const o = loadAutoCorrectFrom(null, lang);
  let cur = '';
  for (const ch of text) {
    const next = cur + ch;
    const r = autoCorrectTyped(cur, next, next.length, o);
    cur = r ? r.text : next;
  }
  return cur;
}

describe.skipIf(!fs.existsSync(file))('contraste de autocorrección con Word', () => {
  it('informe', () => {
    const d = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as {
      options: Record<string, boolean>;
      entries: { name: string; value: string }[];
      cases: { lang: 'es' | 'en'; typed: string; word: string }[];
    };
    const out: string[] = [];
    let same = 0;
    for (const c of d.cases) {
      const nova = typeInNova(c.typed, c.lang);
      const w = c.word.replace(/\r|\n/g, '');
      const ok = nova.trimEnd() === w.trimEnd();
      if (ok) same++;
      out.push(`${ok ? '=' : '≠'} ${c.lang} «${c.typed}»\n    Word: «${w}»${ok ? '' : `\n    Nova: «${nova}»`}`);
    }
    // entradas de Word (lista del idioma del teclado) frente a las de Nova (español)
    const es = loadAutoCorrectFrom(null, 'es').custom;
    const en = loadAutoCorrectFrom(null, 'en').custom;
    const simple = d.entries.filter((e) => !/[\s()]/.test(e.name) && /^[\p{L}']+$/u.test(e.name));
    const inNova = (e: { name: string; value: string }) => es[e.name] === e.value || en[e.name] === e.value;
    const both = simple.filter(inNova).length;
    const head = [
      `Casos tecleados: ${d.cases.length}; resultado idéntico en Word y Nova: ${same}.`,
      `Entradas de Word (lista del idioma del teclado): ${d.entries.length} (${simple.length} palabras sueltas); Nova trae ${Object.keys(es).length} en español y ${Object.keys(en).length} en inglés; coinciden exactamente: ${both}.`,
      `Casillas de Word al contrastar: ${Object.entries(d.options).map(([k, v]) => `${k}=${v}`).join(', ')}.`,
    ];
    fs.writeFileSync(dir + 'informe-autocorreccion.txt', `${head.join('\n')}\n\n${out.join('\n')}\n`);
  });
});
