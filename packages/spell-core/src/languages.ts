export type SpellLang = 'es' | 'es-MX' | 'es-PE' | 'en';

export interface SpellLangInfo {
  id: SpellLang;
  /** Nombre para mostrar (en español; la interfaz lo traduce). */
  label: string;
  /** Etiqueta BCP 47 del idioma, la que llevan `lang` en HTML y `w:lang` en Word. */
  tag: string;
  /** Paquete npm del diccionario Hunspell. */
  dictionary: string;
}

export const SPELL_LANGS: SpellLangInfo[] = [
  { id: 'es', label: 'Español (España)', tag: 'es-ES', dictionary: 'dictionary-es' },
  { id: 'es-MX', label: 'Español (México)', tag: 'es-MX', dictionary: 'dictionary-es-mx' },
  { id: 'es-PE', label: 'Español (Perú)', tag: 'es-PE', dictionary: 'dictionary-es-pe' },
  { id: 'en', label: 'English', tag: 'en-US', dictionary: 'dictionary-en' },
];

export const isSpellLang = (x: unknown): x is SpellLang => typeof x === 'string' && SPELL_LANGS.some((l) => l.id === x);

/**
 * El idioma de revisión que corresponde a una etiqueta BCP 47 (`es-MX`, `es_PE`, `en-GB`, `es`): la variante exacta si existe y, si no,
 * la del mismo idioma (`es-AR` → español de España, el diccionario general; `en-GB` → English). `null` si no hay diccionario.
 */
export function langForTag(tag: string | null | undefined): SpellLang | null {
  if (!tag) return null;
  const t = tag.replace(/_/g, '-').toLowerCase();
  const exact = SPELL_LANGS.find((l) => l.tag.toLowerCase() === t);
  if (exact) return exact.id;
  const primary = t.split('-')[0];
  return SPELL_LANGS.find((l) => l.tag.toLowerCase().split('-')[0] === primary)?.id ?? null;
}

export const spellLangTag = (id: SpellLang): string => SPELL_LANGS.find((l) => l.id === id)!.tag;
