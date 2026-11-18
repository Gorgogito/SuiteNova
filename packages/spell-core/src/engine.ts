import { findWords, skipWord, type Word } from './words';

/** La parte de nspell que usa el corrector. */
export interface Speller {
  correct(word: string): boolean;
  suggest(word: string): string[];
  add(word: string): unknown;
}

/**
 * El corrector ortográfico de un idioma: un diccionario más las palabras que la persona omitió o agregó. Trabaja sobre texto plano; los
 * productos lo adaptan a su modelo de documento (ProseMirror, celdas, diapositivas).
 */
export class SpellEngine {
  private known = new Map<string, boolean>();
  /** Palabras omitidas (en esta sesión) o agregadas al diccionario, en minúsculas. */
  readonly ignored = new Set<string>();
  constructor(
    private speller: Speller,
    extra: Iterable<string> = [],
  ) {
    for (const w of extra) this.ignored.add(w.toLowerCase());
  }

  isCorrect(word: string): boolean {
    const w = word.replace(/’/g, "'");
    const hit = this.known.get(w);
    if (hit !== undefined) return hit;
    const lower = w.toLowerCase();
    let ok = this.ignored.has(lower) || this.speller.correct(w);
    // una palabra con mayúscula inicial al empezar una frase también es correcta en minúscula; las MAYÚSCULAS se omiten antes
    if (!ok && w !== lower) ok = this.speller.correct(lower) && /^\p{Lu}\p{Ll}+$/u.test(w);
    this.known.set(w, ok);
    return ok;
  }

  suggest(word: string): string[] {
    return this.speller.suggest(word.replace(/’/g, "'")).slice(0, 8);
  }

  /** Omite una palabra (por esta sesión). */
  ignore(word: string): void {
    this.ignored.add(word.toLowerCase());
    this.known.clear();
  }

  /** La agrega al diccionario del motor (guardarla para otras sesiones es cosa de `UserDictionary`). */
  add(word: string): void {
    this.speller.add(word);
    this.ignore(word);
  }

  /** Las palabras mal escritas de un texto plano, con su posición. */
  check(text: string): Word[] {
    return findWords(text).filter((w) => !skipWord(text, w) && !this.isCorrect(w.word));
  }
}
