import type { ThesaurusLang } from './languages';

/** Terminaciones verbales regulares y los infinitivos a los que podrían llevar (gerundio, participio y los tiempos más comunes). */
const ES_VERB: [string, string[]][] = [
  ['ando', ['ar']], ['iendo', ['er', 'ir']], ['yendo', ['er', 'ir']],
  ['ado', ['ar']], ['ada', ['ar']], ['ados', ['ar']], ['adas', ['ar']],
  ['ido', ['er', 'ir']], ['ida', ['er', 'ir']], ['idos', ['er', 'ir']], ['idas', ['er', 'ir']],
  ['aron', ['ar']], ['aste', ['ar']], ['asteis', ['ar']], ['amos', ['ar']], ['áis', ['ar']],
  ['aban', ['ar']], ['abas', ['ar']], ['aba', ['ar']], ['ábamos', ['ar']], ['abais', ['ar']],
  ['an', ['ar']], ['as', ['ar']], ['a', ['ar']], ['é', ['ar']], ['ó', ['ar']], ['o', ['ar', 'er', 'ir']],
  ['ieron', ['er', 'ir']], ['iste', ['er', 'ir']], ['imos', ['er', 'ir']], ['ían', ['er', 'ir']], ['ías', ['er', 'ir']], ['ía', ['er', 'ir']],
  ['emos', ['er']], ['en', ['er']], ['es', ['er', 'ar']], ['e', ['er']], ['ió', ['er', 'ir']],
  ['ará', ['ar']], ['erá', ['er']], ['irá', ['ir']], ['aría', ['ar']], ['ería', ['er']], ['iría', ['ir']],
];

const EN_IRREGULAR: Record<string, string> = {
  was: 'be', were: 'be', is: 'be', are: 'be', been: 'be', am: 'be', has: 'have', had: 'have', did: 'do', done: 'do', does: 'do',
  went: 'go', gone: 'go', saw: 'see', seen: 'see', took: 'take', taken: 'take', made: 'make', better: 'good', best: 'good',
  worse: 'bad', worst: 'bad', children: 'child', men: 'man', women: 'woman', people: 'person', feet: 'foot', teeth: 'tooth', mice: 'mouse',
};

/**
 * Las formas de base que podría tener una palabra flexionada, de la más a la menos probable (la propia palabra va aparte): singular,
 * masculino, infinitivo. Son candidatas: quien llama comprueba cuál existe en el tesauro.
 */
export function lemmaCandidates(word: string, lang: ThesaurusLang): string[] {
  const w = word.toLowerCase();
  const out: string[] = [];
  const add = (x: string): void => {
    if (x.length >= 2 && x !== w && !out.includes(x)) out.push(x);
  };
  if (lang === 'es') {
    if (w.endsWith('ces')) add(w.slice(0, -3) + 'z');
    if (w.endsWith('es')) add(w.slice(0, -2));
    if (w.endsWith('s')) add(w.slice(0, -1));
    const sing = w.endsWith('s') ? w.slice(0, -1) : w;
    if (sing.endsWith('a')) add(sing.slice(0, -1) + 'o');
    if (sing.endsWith('ora')) add(sing.slice(0, -1));
    if (sing.endsWith('isima') || sing.endsWith('isimo')) add(sing.slice(0, -5));
    if (sing.endsWith('mente')) add(sing.slice(0, -5));
    for (const [end, inf] of ES_VERB) {
      if (!w.endsWith(end) || w.length - end.length < 2) continue;
      const stem = w.slice(0, -end.length);
      for (const i of inf) add(stem + i);
    }
  } else {
    const irr = EN_IRREGULAR[w];
    if (irr) add(irr);
    if (w.endsWith('ies')) add(w.slice(0, -3) + 'y');
    if (w.endsWith('ves')) {
      add(w.slice(0, -3) + 'f');
      add(w.slice(0, -3) + 'fe');
    }
    if (w.endsWith('es')) add(w.slice(0, -2));
    if (w.endsWith('s')) add(w.slice(0, -1));
    const undouble = (s: string): string | null => (/([^aeiou])\1$/.test(s) ? s.slice(0, -1) : null);
    const strip = (end: string): void => {
      const stem = w.slice(0, -end.length);
      add(stem);
      add(stem + 'e');
      const u = undouble(stem);
      if (u) add(u);
      if (stem.endsWith('i')) add(stem.slice(0, -1) + 'y');
    };
    for (const end of ['ing', 'ed', 'est', 'er']) if (w.endsWith(end)) strip(end);
    for (const end of ['iest', 'ier']) if (w.endsWith(end)) add(w.slice(0, -end.length) + 'y');
    if (w.endsWith('ily')) add(w.slice(0, -3) + 'y');
    if (w.endsWith('ly')) add(w.slice(0, -2));
  }
  return out;
}

/** Pasa la mayúscula inicial o las mayúsculas sostenidas de la palabra escrita a su sustituta, para que el reemplazo no cambie el aspecto. */
export function matchCase(typed: string, candidate: string): string {
  if (!candidate) return candidate;
  const letters = typed.replace(/[^\p{L}]/gu, '');
  if (letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return candidate.toUpperCase();
  const rest = letters.slice(1);
  if (letters.length > 0 && letters[0] !== letters[0]!.toLowerCase() && rest === rest.toLowerCase()) return candidate.charAt(0).toUpperCase() + candidate.slice(1);
  return candidate;
}
