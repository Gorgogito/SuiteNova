import type { SpellLang } from '../languages';
import { aAn, loneI } from './rules-en';
import { aNivelDe, agreement, deAcuerdoA, dequeismo, enBaseA, habianPlural, haberSi, heEcho, queismo } from './rules-es';
import { allCaps, capitalAfterPeriod, doubleSpace, longSentence, missingSpaceAfter, repeatedWord, spaceBeforePunctuation, spaceInsideBrackets, unmatchedPair } from './rules-common';
import type { Ctx, GrammarIssue, GrammarOptions, Rule, RuleInfo } from './types';

export * from './types';
export { isAbbreviationDot } from './rules-common';

interface Entry extends RuleInfo {
  run: Rule;
}

/** Cada regla puede producir varios identificadores (`habianPlural` da `haber-impersonal`): `id` es el que se activa y desactiva. */
const ENTRIES: Entry[] = [
  { id: 'repeated-word', category: 'grammar', label: 'Palabras repetidas', description: 'Una palabra escrita dos veces seguidas («el el»).', family: 'all', defaultOn: true, run: repeatedWord },
  { id: 'capital-after-period', category: 'grammar', label: 'Mayúscula inicial', description: 'La primera letra del texto y la que sigue a un punto, «?» o «!» va en mayúscula.', family: 'all', defaultOn: true, run: capitalAfterPeriod },
  { id: 'double-space', category: 'punctuation', label: 'Espacios dobles', description: 'Dos o más espacios seguidos entre palabras.', family: 'all', defaultOn: true, run: doubleSpace },
  { id: 'space-before-punctuation', category: 'punctuation', label: 'Espacio antes de la puntuación', description: 'Un espacio antes de coma, punto, punto y coma, dos puntos, «?» o «!».', family: 'all', defaultOn: true, run: spaceBeforePunctuation },
  { id: 'space-inside-brackets', category: 'punctuation', label: 'Espacio junto a paréntesis y signos de apertura', description: 'Un espacio después de «(», «¿» o «¡» o antes de «)».', family: 'all', defaultOn: true, run: spaceInsideBrackets },
  { id: 'missing-space-after', category: 'punctuation', label: 'Falta un espacio tras la puntuación', description: 'Coma, punto, punto y coma, dos puntos, «?» o «!» pegados a la palabra siguiente.', family: 'all', defaultOn: true, run: missingSpaceAfter },
  { id: 'unmatched-pair', category: 'punctuation', label: 'Signos sin pareja', description: 'Paréntesis, corchetes y comillas sin cerrar, y ¿ ? ¡ ! a los que les falta el de apertura o el de cierre.', family: 'all', defaultOn: true, run: unmatchedPair },
  { id: 'agreement', category: 'grammar', label: 'Concordancia', description: 'Género y número entre artículo, sustantivo y adjetivo («la canción bonito»). Solo con palabras de género seguro.', family: 'es', defaultOn: true, run: agreement },
  { id: 'dequeismo', category: 'grammar', label: 'Dequeísmo', description: '«pienso de que» en vez de «pienso que».', family: 'es', defaultOn: true, run: dequeismo },
  { id: 'queismo', category: 'grammar', label: 'Queísmo', description: '«me alegro que» en vez de «me alegro de que».', family: 'es', defaultOn: true, run: queismo },
  { id: 'haber-impersonal', category: 'grammar', label: '«Haber» impersonal', description: '«habían muchos» en vez de «había muchos».', family: 'es', defaultOn: true, run: habianPlural },
  { id: 'a-ver', category: 'grammar', label: '«A ver» y «haber»', description: '«haber si» en vez de «a ver si».', family: 'es', defaultOn: true, run: haberSi },
  { id: 'hecho', category: 'grammar', label: '«Hecho» y «echo»', description: '«ha echo» en vez de «ha hecho».', family: 'es', defaultOn: true, run: heEcho },
  { id: 'a-nivel-de', category: 'style', label: 'Muletilla «a nivel de»', description: 'Suele sobrar o puede sustituirse por «en».', family: 'es', defaultOn: true, run: aNivelDe },
  { id: 'en-base-a', category: 'style', label: '«En base a»', description: 'Se recomienda «con base en».', family: 'es', defaultOn: true, run: enBaseA },
  { id: 'de-acuerdo-a', category: 'style', label: '«De acuerdo a»', description: 'Se recomienda «de acuerdo con».', family: 'es', defaultOn: true, run: deAcuerdoA },
  { id: 'a-an', category: 'grammar', label: '«A» y «an»', description: 'La forma del artículo según el sonido de la palabra siguiente.', family: 'en', defaultOn: true, run: aAn },
  { id: 'lone-i', category: 'grammar', label: 'El pronombre «I»', description: '«i» suelto en vez de «I».', family: 'en', defaultOn: true, run: loneI },
  { id: 'long-sentence', category: 'style', label: 'Frases muy largas', description: 'Frases con más de 50 palabras (se puede cambiar el límite).', family: 'all', defaultOn: false, run: longSentence },
  { id: 'all-caps', category: 'style', label: 'Mayúsculas sostenidas', description: 'Cuatro o más palabras seguidas en mayúsculas.', family: 'all', defaultOn: false, run: allCaps },
];

/** El catálogo de reglas (para mostrarlas en las opciones). */
export const GRAMMAR_RULES: RuleInfo[] = ENTRIES.map(({ run: _run, ...info }) => info);

const familyOf = (lang: SpellLang): 'es' | 'en' => (lang.startsWith('es') ? 'es' : 'en');

/** Las reglas que se aplican por omisión a un idioma (no están las opcionales). */
export const defaultRules = (lang: SpellLang): string[] => GRAMMAR_RULES.filter((r) => r.defaultOn && (r.family === 'all' || r.family === familyOf(lang))).map((r) => r.id);

/**
 * Revisa la gramática, la puntuación y el estilo de un texto plano. No usa diccionario. Las reglas son del idioma (`es`, `es-MX`, `es-PE`
 * comparten las de español). Devuelve los problemas en orden, cada uno con su mensaje y sus correcciones.
 */
export function checkGrammar(text: string, options: GrammarOptions): GrammarIssue[] {
  const family = familyOf(options.lang);
  const ctx: Ctx = { text, family, startOfText: options.startOfText !== false, longSentenceWords: options.longSentenceWords ?? 50 };
  const off = new Set(options.disabled ?? []);
  const on = new Set(options.enabled ?? []);
  const out: GrammarIssue[] = [];
  for (const e of ENTRIES) {
    if (e.family !== 'all' && e.family !== family) continue;
    if (off.has(e.id) || !(e.defaultOn || on.has(e.id))) continue;
    e.run(ctx, out);
  }
  const kept = out;
  return kept.sort((a, b) => a.start - b.start || a.end - b.end);
}
