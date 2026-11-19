import type { SpellLang } from '@suitenova/spell-core';

/** Los tesauros disponibles. Las tres variantes del español comparten el mismo (no existe uno regional). */
export type ThesaurusLang = 'es' | 'en';

export interface ThesaurusLangInfo {
  id: ThesaurusLang;
  label: string;
  /** Nombre del archivo de datos (en `data/`, generado por `scripts/build-thesaurus.mjs`). */
  file: string;
}

export const THESAURUS_LANGS: ThesaurusLangInfo[] = [
  { id: 'es', label: 'Español', file: 'th-es.txt' },
  { id: 'en', label: 'English', file: 'th-en.txt' },
];

/** El tesauro que sirve a un idioma de revisión: es, es-MX y es-PE usan el español. */
export const thesaurusLangFor = (lang: SpellLang): ThesaurusLang => (lang === 'en' ? 'en' : 'es');
