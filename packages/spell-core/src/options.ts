import { GRAMMAR_RULES, defaultRules, type GrammarOptions } from './grammar';
import type { SpellLang } from './languages';
import type { KeyValueStore } from './userdict';
import type { Word } from './words';

/** Las opciones de revisión («Revisión» de Office): son una sola para todos los productos. */
export interface ReviewOptions {
  /** No revisar palabras en MAYÚSCULAS (siglas). */
  ignoreUppercase: boolean;
  /** No revisar palabras con cifras o pegadas a ellas (`abc123`, `x2`). */
  ignoreNumbers: boolean;
  /** No revisar direcciones de internet, de correo ni rutas. */
  ignoreInternet: boolean;
  /** Revisar también la gramática, la puntuación y el estilo. */
  grammar: boolean;
  /** Reglas que la persona activó o desactivó a mano (`id` → activa); las demás siguen el valor por omisión. */
  rules: Record<string, boolean>;
  /** A partir de cuántas palabras una frase es «muy larga». */
  longSentenceWords: number;
}

export const DEFAULT_REVIEW_OPTIONS: ReviewOptions = {
  ignoreUppercase: true,
  ignoreNumbers: true,
  ignoreInternet: true,
  grammar: true,
  rules: {},
  longSentenceWords: 50,
};

export const REVIEW_OPTIONS_KEY = 'nova.review.options';

/** Lee las opciones guardadas (lo que falta o no es válido toma el valor por omisión). */
export function loadReviewOptions(store: Pick<KeyValueStore, 'getItem'> | null): ReviewOptions {
  try {
    const raw = store?.getItem(REVIEW_OPTIONS_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<ReviewOptions>) : {};
    const known = new Set(GRAMMAR_RULES.map((r) => r.id));
    const rules: Record<string, boolean> = {};
    for (const [k, on] of Object.entries(v.rules ?? {})) if (known.has(k) && typeof on === 'boolean') rules[k] = on;
    const flag = (x: unknown, d: boolean) => (typeof x === 'boolean' ? x : d);
    const n = Number(v.longSentenceWords);
    return {
      ignoreUppercase: flag(v.ignoreUppercase, true),
      ignoreNumbers: flag(v.ignoreNumbers, true),
      ignoreInternet: flag(v.ignoreInternet, true),
      grammar: flag(v.grammar, true),
      rules,
      longSentenceWords: Number.isFinite(n) && n >= 10 && n <= 200 ? Math.round(n) : 50,
    };
  } catch {
    return { ...DEFAULT_REVIEW_OPTIONS, rules: {} };
  }
}

export function saveReviewOptions(store: Pick<KeyValueStore, 'setItem'> | null, o: ReviewOptions): void {
  try {
    store?.setItem(REVIEW_OPTIONS_KEY, JSON.stringify(o));
  } catch {
    /* sin almacenamiento: valen en esta sesión */
  }
}

/** Si una regla está activa con estas opciones. */
export function ruleOn(o: ReviewOptions, id: string, lang: SpellLang): boolean {
  if (!o.grammar) return false;
  const forced = o.rules[id];
  if (forced !== undefined) return forced;
  return defaultRules(lang).includes(id);
}

/** Las opciones de la gramática que corresponden a las de revisión. */
export function grammarOptionsOf(o: ReviewOptions, lang: SpellLang, startOfText = true): GrammarOptions {
  const disabled = Object.entries(o.rules).filter(([, on]) => !on).map(([id]) => id);
  const enabled = Object.entries(o.rules).filter(([, on]) => on).map(([id]) => id);
  return { lang, disabled, enabled, startOfText, longSentenceWords: o.longSentenceWords };
}

/** Si una palabra no se revisa con estas opciones: siglas, cifras y direcciones (según lo que se haya pedido). */
export function skipWordWith(text: string, w: Word, o: Pick<ReviewOptions, 'ignoreUppercase' | 'ignoreNumbers' | 'ignoreInternet'>): boolean {
  if (w.word.length < 2) return true;
  if (o.ignoreUppercase && w.word === w.word.toUpperCase() && /\p{Lu}/u.test(w.word)) return true;
  const before = text[w.start - 1] ?? '';
  const after = text[w.end] ?? '';
  if (o.ignoreNumbers && (/\d/.test(before) || /\d/.test(after))) return true;
  if (o.ignoreInternet) {
    if (/[@/\\_#]/.test(before) || /[@/\\_]/.test(after)) return true;
    if ((before === '.' && /[\p{L}\d]/u.test(text[w.start - 2] ?? '')) || (after === '.' && /[\p{L}\d]/u.test(text[w.end + 1] ?? ''))) return true;
  }
  return false;
}
