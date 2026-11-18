import { SPELL_LANGS, UserDictionary, type SpellLang } from '@suitenova/spell-core';
import nspell from 'nspell';
import { DocSpellEngine } from './engine';

export { SPELL_LANGS, type SpellLang };

// Los diccionarios son archivos aparte (se piden al usarlos, no entran en el paquete de la aplicación)
const FILES: Record<SpellLang, { aff: URL; dic: URL }> = {
  es: { aff: new URL('../../node_modules/dictionary-es/index.aff', import.meta.url), dic: new URL('../../node_modules/dictionary-es/index.dic', import.meta.url) },
  'es-MX': { aff: new URL('../../node_modules/dictionary-es-mx/index.aff', import.meta.url), dic: new URL('../../node_modules/dictionary-es-mx/index.dic', import.meta.url) },
  'es-PE': { aff: new URL('../../node_modules/dictionary-es-pe/index.aff', import.meta.url), dic: new URL('../../node_modules/dictionary-es-pe/index.dic', import.meta.url) },
  en: { aff: new URL('../../node_modules/dictionary-en/index.aff', import.meta.url), dic: new URL('../../node_modules/dictionary-en/index.dic', import.meta.url) },
};

/** El diccionario personal: uno solo para todos los productos, documentos e idiomas. */
const userDict = new UserDictionary(
  (() => {
    try {
      return localStorage;
    } catch {
      return null;
    }
  })(),
);

const engines = new Map<SpellLang, Promise<DocSpellEngine>>();

/** Carga (una vez) el diccionario de un idioma. El análisis tarda un momento: se hace fuera del camino de la escritura. */
export function loadSpeller(lang: SpellLang): Promise<DocSpellEngine> {
  let p = engines.get(lang);
  if (!p) {
    p = (async () => {
      const [aff, dic] = await Promise.all([fetch(FILES[lang].aff).then((r) => r.text()), fetch(FILES[lang].dic).then((r) => r.text())]);
      await new Promise((r) => setTimeout(r, 0));
      return new DocSpellEngine(nspell(aff, dic), userDict.words());
    })();
    engines.set(lang, p);
    p.catch(() => engines.delete(lang));
  }
  return p;
}

/** Agrega una palabra al diccionario personal (y al motor ya cargado). */
export function addToUserDictionary(engine: DocSpellEngine, word: string): void {
  engine.add(word);
  userDict.add(word);
}

export const userDictionaryWords = (): string[] => userDict.words();
export const removeFromUserDictionary = (word: string): void => userDict.remove(word);
