import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import nspell from 'nspell';
import { SpellEngine } from './engine';
import type { SpellLang } from './languages';
import { SPELL_LANGS } from './languages';

/** Solo para pruebas (Node): el corrector de un idioma con el diccionario instalado. */
export function nodeEngine(lang: SpellLang, extra: string[] = []): SpellEngine {
  const dir = fileURLToPath(new URL(`../node_modules/${SPELL_LANGS.find((l) => l.id === lang)!.dictionary}/`, import.meta.url));
  return new SpellEngine(nspell(fs.readFileSync(dir + 'index.aff', 'utf8'), fs.readFileSync(dir + 'index.dic', 'utf8')), extra);
}
