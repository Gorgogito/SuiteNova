import { matchCase, type GrammarIssue, type Rule } from './types';

const push = (out: GrammarIssue[], i: GrammarIssue) => void out.push(i);

/** Palabras que empiezan con vocal pero suenan a consonante («a university») y al revés («an hour»). */
const VOWEL_LETTER_CONSONANT_SOUND = /^(one|once|u[bcfgklnrst]\w*|uni(?!mp|nt|nh|nd|nv|nf|nc|nm|nn|nl|ns|nw)\w*|eu\w*|ewe)$/i;
const CONSONANT_LETTER_VOWEL_SOUND = new Set(['hour', 'hours', 'honest', 'honor', 'honour', 'heir', 'heirs', 'herb', 'herbs']);

export const aAn: Rule = ({ text }, out) => {
  for (const m of text.matchAll(/(?<![\p{L}'’])(a|an)( +)(\p{L}[\p{L}'’-]*)/giu)) {
    const art = m[1]!;
    const next = m[3]!;
    if (next === next.toUpperCase() && next.length > 1) continue; // siglas: «an FBI agent»
    const lower = next.toLowerCase().split(/['’-]/)[0]!;
    const vowelSound = /^[aeiou]/.test(lower) ? !VOWEL_LETTER_CONSONANT_SOUND.test(lower) : CONSONANT_LETTER_VOWEL_SOUND.has(lower);
    const want = vowelSound ? 'an' : 'a';
    if (art.toLowerCase() === want) continue;
    push(out, { rule: 'a-an', category: 'grammar', start: m.index!, end: m.index! + art.length, message: `Use «${want}» before «${next}».`, fixes: [{ start: m.index!, end: m.index! + art.length, text: matchCase(art, want), label: matchCase(art, want) }] });
  }
};

export const loneI: Rule = ({ text }, out) => {
  for (const m of text.matchAll(/(?<![\p{L}\p{N}'’.-])i(?![\p{L}\p{N}'’.)-])/gu)) {
    push(out, { rule: 'lone-i', category: 'grammar', start: m.index!, end: m.index! + 1, message: 'The pronoun «I» is always capitalized.', fixes: [{ start: m.index!, end: m.index! + 1, text: 'I', label: 'I' }] });
  }
};
