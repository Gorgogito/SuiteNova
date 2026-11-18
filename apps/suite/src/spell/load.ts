import { SPELL_LANGS, SpellEngine, UserDictionary, type SpellLang } from '@suitenova/spell-core';
import nspell from 'nspell';
import { DocSpellEngine } from './engine';
import { notifyReview } from './options';

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

/** Los motores ya cargados (una palabra agregada o quitada vale en todos). */
const loaded = new Set<DocSpellEngine>();
const resolved = new Map<SpellLang, DocSpellEngine>();
const engines = new Map<SpellLang, Promise<DocSpellEngine>>();

/** Carga (una vez) el diccionario de un idioma. El análisis tarda un momento: se hace fuera del camino de la escritura. */
export function loadSpeller(lang: SpellLang): Promise<DocSpellEngine> {
  let p = engines.get(lang);
  if (!p) {
    p = (async () => {
      const [aff, dic] = await Promise.all([fetch(FILES[lang].aff).then((r) => r.text()), fetch(FILES[lang].dic).then((r) => r.text())]);
      await new Promise((r) => setTimeout(r, 0));
      const e = new DocSpellEngine(nspell(aff, dic), userDict.words());
      loaded.add(e);
      resolved.set(lang, e);
      return e;
    })();
    engines.set(lang, p);
    p.catch(() => engines.delete(lang));
  }
  return p;
}

/** Agrega una palabra al diccionario personal (y a los motores ya cargados, de cualquier idioma). */
export function addToUserDictionary(_engine: DocSpellEngine | null, word: string): void {
  userDict.add(word);
  for (const e of loaded) e.add(word);
  notifyReview();
}

export const userDictionaryWords = (): string[] => userDict.words();

/** Quita una palabra del diccionario personal; deja de aceptarse al momento. */
export function removeFromUserDictionary(word: string): void {
  userDict.remove(word);
  for (const e of loaded) e.remove(word);
  notifyReview();
}

/** Omite una palabra (por esta sesión) y avisa para volver a subrayar. */
export function ignoreWord(engine: DocSpellEngine, word: string): void {
  engine.ignore(word);
  notifyReview();
}

/** El motor de un idioma si ya está cargado (sin esperar). */
export const loadedEngine = (lang: SpellLang): DocSpellEngine | null => resolved.get(lang) ?? null;

/** Cambia cuando se carga un diccionario o se omite, agrega o quita una palabra: las comprobaciones guardadas dejan de valer. */
export const engineEpoch = (): number => loaded.size * 1_000_000 + SpellEngine.version;
