import { findWords } from '../words';
import { adjForm, adjInfo, detForm, detInfo, nounInfo, pluralOf, STRESSED_A, VERBISH } from './lexicon-es';
import { matchCase, type GrammarIssue, type Rule } from './types';

const push = (out: GrammarIssue[], i: GrammarIssue) => void out.push(i);
const SPACE = /^ $/;
const gname = (g: 'm' | 'f') => (g === 'm' ? 'masculino' : 'femenino');

// ---------------------------------------------------------------------------------------------------- concordancia

/** Determinante + sustantivo (género y número) y sustantivo + adjetivo, solo con palabras de género seguro. */
export const agreement: Rule = ({ text }, out) => {
  const words = findWords(text);
  const adjacent = (i: number) => i + 1 < words.length && SPACE.test(text.slice(words[i]!.end, words[i + 1]!.start));
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const d = detInfo(w.word);
    const n = words[i + 1];
    if (d && n && adjacent(i)) {
      const ni = nounInfo(n.word);
      if (ni && !(d.pronoun && VERBISH.has(ni.singular))) {
        const dl = w.word.toLowerCase();
        const stressed = ni.number === 's' && STRESSED_A.has(ni.singular);
        // el agua, un águila: con «a» tónica el singular femenino lleva «el»; «la agua» es el error
        const genderOk = d.gender === null || (stressed ? dl !== 'la' : d.gender === ni.gender);
        const numberOk = d.number === ni.number;
        if (!genderOk || !numberOk) {
          const fixes: GrammarIssue['fixes'] = [];
          const form = stressed && dl === 'la' ? 'el' : detForm(w.word, ni.gender, ni.number);
          if (form && form !== dl) fixes.push({ start: w.start, end: w.end, text: matchCase(w.word, form), label: `${matchCase(w.word, form)} ${n.word}` });
          if (genderOk && !numberOk) {
            const noun = d.number === 'p' ? pluralOf(ni.singular) : ni.singular;
            fixes.push({ start: n.start, end: n.end, text: matchCase(n.word, noun), label: `${w.word} ${matchCase(n.word, noun)}` });
          }
          if (!genderOk && !numberOk && d.gender !== null) {
            // género y número mal a la vez: se ofrece también cambiar las dos palabras («los mesa» → «las mesas»)
            const dform = stressed && dl === 'la' ? 'el' : detForm(w.word, ni.gender, d.number);
            const noun = d.number === 'p' ? pluralOf(ni.singular) : ni.singular;
            if (dform) fixes.push({ start: w.start, end: n.end, text: `${matchCase(w.word, dform)} ${matchCase(n.word, noun)}`, label: `${matchCase(w.word, dform)} ${matchCase(n.word, noun)}` });
          }
          const message = !genderOk
            ? `Concordancia de género: «${n.word}» es ${gname(ni.gender)}.`
            : `Concordancia de número entre «${w.word}» y «${n.word}».`;
          push(out, { rule: 'agreement', category: 'grammar', start: w.start, end: n.end, message, fixes });
        }
      }
    }
    // sustantivo + adjetivo («la canción bonito»)
    const ni = nounInfo(w.word);
    const a = words[i + 1];
    if (ni && a && adjacent(i)) {
      const prev = words[i - 1];
      const hasDet = !!prev && SPACE.test(text.slice(prev.end, w.start)) && !!detInfo(prev.word);
      if (VERBISH.has(ni.singular) && !hasDet) continue;
      const ai = adjInfo(a.word);
      if (ai && (ai.gender !== ni.gender || ai.number !== ni.number)) {
        const right = matchCase(a.word, adjForm(ai.stem, ni.gender, ni.number));
        push(out, { rule: 'agreement', category: 'grammar', start: w.start, end: a.end, message: `Concordancia: «${a.word}» no concuerda con «${w.word}» (${gname(ni.gender)}${ni.number === 'p' ? ' plural' : ''}).`, fixes: [{ start: a.start, end: a.end, text: right, label: `${w.word} ${right}` }] });
      }
    }
  }
};

// ---------------------------------------------------------------------------------------------------- errores frecuentes

const L = '(?<![\\p{L}])';
const E = '(?!\\p{L})';

/** El texto que precede a `idx` termina en una de estas palabras (para no corregir lo que es correcto). */
const prevWord = (text: string, idx: number): string => /(\p{L}+)\s+$/u.exec(text.slice(0, idx))?.[1]?.toLowerCase() ?? '';

export const dequeismo: Rule = ({ text }, out) => {
  const verbs =
    'pienso|piensas|piensa|pensamos|piensan|creo|crees|cree|creemos|creen|opino|opinas|opina|opinamos|opinan|dijo|dijeron|digo|dice|dicen|aseguró|aseguraron|afirmó|afirmaron|supongo|imagino|imaginó|noté|noto|comentó|comenta|explicó|explica';
  for (const m of text.matchAll(new RegExp(`${L}(${verbs}) (de) que${E}`, 'giu'))) {
    const de = m.index! + m[1]!.length + 1;
    push(out, { rule: 'dequeismo', category: 'grammar', start: de, end: de + 2, message: `Dequeísmo: «${m[1]} que» (sin «de»).`, fixes: [{ start: de - 1, end: de + 2, text: '', label: `${m[1]} que` }] });
  }
};

export const queismo: Rule = ({ text }, out) => {
  const re = new RegExp(`${L}(?:(?:me|te|nos) (?:alegro|alegras|alegramos|olvido|olvidas|olvidamos|acuerdo|acuerdas|acordamos|di cuenta|diste cuenta|dimos cuenta)|se (?:acuerda|acuerdan|dio cuenta|dieron cuenta)) (que)${E}`, 'giu');
  for (const m of text.matchAll(re)) {
    const q = m.index! + m[0].length - 3;
    push(out, { rule: 'queismo', category: 'grammar', start: q, end: q + 3, message: 'Queísmo: falta «de» antes de «que».', fixes: [{ start: q, end: q + 3, text: matchCase(m[1]!, 'de que'), label: 'de que' }] });
  }
};

const IMPERSONAL: Record<string, string> = { habían: 'había', habrán: 'habrá', habrían: 'habría', hubieron: 'hubo' };

export const habianPlural: Rule = ({ text }, out) => {
  const quant =
    'muchos|muchas|varios|varias|unos|unas|pocos|pocas|algunos|algunas|tantos|tantas|demasiados|demasiadas|bastantes|numerosos|numerosas|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|cientos|miles';
  for (const m of text.matchAll(new RegExp(`${L}(habían|habrán|habrían|hubieron)(?= (?:${quant})${E})`, 'giu'))) {
    const right = matchCase(m[1]!, IMPERSONAL[m[1]!.toLowerCase()]!);
    push(out, { rule: 'haber-impersonal', category: 'grammar', start: m.index!, end: m.index! + m[1]!.length, message: `«Haber» impersonal va en singular: «${right}».`, fixes: [{ start: m.index!, end: m.index! + m[1]!.length, text: right, label: right }] });
  }
};

const NOT_HABER_SI = new Set(['puede', 'pueden', 'debe', 'deben', 'debería', 'podría', 'va', 'vas', 'van', 'vaya', 'ha', 'he', 'hay', 'a', 'de', 'sin', 'para', 'al', 'por', 'que', 'ni', 'sé', 'poder', 'deber']);

export const haberSi: Rule = ({ text }, out) => {
  for (const m of text.matchAll(new RegExp(`${L}(haber) (si|qué|cómo|cuándo|quién|cuál|cuánto)${E}`, 'giu'))) {
    if (NOT_HABER_SI.has(prevWord(text, m.index!))) continue;
    const right = matchCase(m[1]!, 'a ver');
    push(out, { rule: 'a-ver', category: 'grammar', start: m.index!, end: m.index! + 5, message: 'Se escribe «a ver» (de «ver»), no «haber».', fixes: [{ start: m.index!, end: m.index! + 5, text: right, label: right }] });
  }
};

export const heEcho: Rule = ({ text }, out) => {
  const aux = 'he|has|ha|hemos|habéis|han|había|habías|habíamos|habían|hube|hubo|habré|habrá|habría|haya|hayan|habido';
  for (const m of text.matchAll(new RegExp(`${L}(?:${aux}) (echo)${E}`, 'giu'))) {
    const s = m.index! + m[0].length - 4;
    const right = matchCase(m[1]!, 'hecho');
    push(out, { rule: 'hecho', category: 'grammar', start: s, end: s + 4, message: 'Se escribe «hecho» (de «hacer»), no «echo».', fixes: [{ start: s, end: s + 4, text: right, label: right }] });
  }
};

// ---------------------------------------------------------------------------------------------------- estilo

const phrase = (id: string, re: string, message: string, fix?: string): Rule => ({ text }, out) => {
  for (const m of text.matchAll(new RegExp(`${L}(${re})${E}`, 'giu'))) {
    const s = m.index!;
    const e = s + m[1]!.length;
    push(out, { rule: id, category: 'style', start: s, end: e, message, fixes: fix ? [{ start: s, end: e, text: matchCase(m[1]!, fix), label: matchCase(m[1]!, fix) }] : [] });
  }
};

export const aNivelDe = phrase('a-nivel-de', 'a nivel de', 'Muletilla: «a nivel de» suele sobrar; prueba con «en» o «respecto de».');
export const enBaseA = phrase('en-base-a', 'en base a', 'Se recomienda «con base en» o «basándose en».', 'con base en');
export const deAcuerdoA = phrase('de-acuerdo-a', 'de acuerdo a', 'Se recomienda «de acuerdo con».', 'de acuerdo con');
