// Contraste con Word real: lee scripts/word-compare/word-out.json (generado por word-check.ps1) y muestra las diferencias. No afirma nada: Word es la referencia, no el criterio.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { nodeEngine } from './dicts';
import { checkGrammar } from './grammar';

const file = fileURLToPath(new URL('../../../scripts/word-compare/word-out.json', import.meta.url));
describe.skipIf(!fs.existsSync(file))('contraste con Word', () => {
  it('informe', () => {
    const rows = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as { lang: 'es' | 'en'; text: string; spelling: string[]; grammar: string[] }[];
    const eng = { es: nodeEngine('es'), en: nodeEngine('en') };
    let spOk = 0, gOk = 0, anyOk = 0, wordFlags = 0, wordGram = 0;
    const lines: string[] = [];
    for (const r of rows) {
      const ours = eng[r.lang].check(r.text).map((m: { word?: string; text?: string }) => m.word ?? m.text ?? '');
      const g = checkGrammar(r.text, { lang: r.lang });
      const gOurs = g.map((i) => r.text.slice(i.start, i.end));
      const sameSp = JSON.stringify(ours) === JSON.stringify(r.spelling);
      const gW = r.grammar.length > 0, gU = gOurs.length > 0;
      const anyW = r.spelling.length + r.grammar.length > 0, anyU = ours.length + gOurs.length > 0;
      if (anyW === anyU) anyOk++;
      if (anyW) wordFlags++;
      wordGram += r.grammar.length;
      if (sameSp) spOk++;
      if (gW === gU) gOk++;
      if (!sameSp || gW !== gU) lines.push(`${r.lang} «${r.text}»\n   ortografía Word=${JSON.stringify(r.spelling)} Nova=${JSON.stringify(ours)}\n   gramática  Word=${JSON.stringify(r.grammar)} Nova=${JSON.stringify(g.map((i) => i.rule + ':' + r.text.slice(i.start, i.end)))}`);
    }
    fs.writeFileSync(file.replace('word-out.json', 'informe.txt'), `Frases: ${rows.length}. Word marcó algo en ${wordFlags}; errores de GrammarErrors en total: ${wordGram}.\nOrtografía idéntica: ${spOk}/${rows.length}\nGramática (marca o no) coincide: ${gOk}/${rows.length}\nTodo junto (alguna marca) coincide: ${anyOk}/${rows.length}\n\n${lines.join('\n')}\n`);
  });
});
