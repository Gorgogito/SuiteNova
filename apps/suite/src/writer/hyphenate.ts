import type { Command } from 'prosemirror-state';

const SOFT = '­';
const STRONG = 'aeoáéóàèò';
const WEAK_PLAIN = 'iuïü';
const WEAK_ACCENT = 'íú';
const isVowel = (c: string) => (STRONG + WEAK_PLAIN + WEAK_ACCENT).includes(c);
/** Consonant groups that start a syllable together (muta + líquida). */
const LIQUID = new Set(['pl', 'pr', 'bl', 'br', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'kl', 'kr', 'tr', 'tl']);

/** Split a Spanish word into syllables (rule based; good enough to place optional hyphens). */
export function syllables(word: string): string[] {
  const w = word.toLowerCase();
  const letters = [...word];
  // classify every letter: 'v' vowel, 'c' consonant (a silent «u» after q / gue gui, and «y» before a vowel, are consonants)
  const kind: ('v' | 'c')[] = letters.map((_ch, i) => {
    const c = w[i]!;
    if (c === 'y') return i === w.length - 1 ? 'v' : 'c';
    if (!isVowel(c)) return 'c';
    if (c === 'u' && i > 0 && (w[i - 1] === 'q' || (w[i - 1] === 'g' && i + 1 < w.length && 'eiéí'.includes(w[i + 1]!)))) return 'c';
    return 'v';
  });
  // units: digraphs ch, ll, rr count as one consonant
  type Unit = { text: string; v: boolean };
  const units: Unit[] = [];
  for (let i = 0; i < letters.length; i++) {
    const pair = w.slice(i, i + 2);
    if (kind[i] === 'c' && (pair === 'ch' || pair === 'll' || pair === 'rr') && kind[i + 1] === 'c') {
      units.push({ text: letters[i]! + letters[i + 1]!, v: false });
      i++;
    } else units.push({ text: letters[i]!, v: kind[i] === 'v' });
  }
  // vowel nuclei: adjacent vowels stay together unless both are strong or one is an accented weak one
  const together = (a: string, b: string) => {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    if (WEAK_ACCENT.includes(x) || WEAK_ACCENT.includes(y)) return false;
    return !(STRONG.includes(x) && STRONG.includes(y));
  };
  const cuts: number[] = []; // unit indexes where a syllable starts
  const nuclei: [number, number][] = [];
  for (let i = 0; i < units.length; i++) {
    if (!units[i]!.v) continue;
    let j = i;
    while (j + 1 < units.length && units[j + 1]!.v && together(units[j]!.text, units[j + 1]!.text)) j++;
    nuclei.push([i, j]);
    i = j;
  }
  for (let n = 0; n + 1 < nuclei.length; n++) {
    const end = nuclei[n]![1];
    const next = nuclei[n + 1]![0];
    const cons = units.slice(end + 1, next).map((u) => u.text.toLowerCase());
    const count = cons.length;
    let cut = next; // default: all consonants go with the next syllable
    if (count === 0) cut = next;
    else if (count === 1) cut = next - 1;
    else if (count === 2) cut = LIQUID.has(cons.join('')) ? next - 2 : next - 1;
    else cut = LIQUID.has(cons.slice(-2).join('')) ? next - 2 : next - 1;
    cuts.push(cut);
  }
  const out: string[] = [];
  let from = 0;
  for (const c of [...cuts, units.length]) {
    out.push(units.slice(from, c).map((u) => u.text).join(''));
    from = c;
  }
  return out.filter(Boolean);
}

/** Put optional hyphens (U+00AD) between the syllables of every long word of a text; words that already have one are left alone. */
export function hyphenateText(text: string, minLeft = 2, minRight = 2, minWord = 6): string {
  return text.replace(/[\p{L}­]+/gu, (word) => {
    if (word.includes(SOFT) || word.length < minWord || /[A-ZÁÉÍÓÚÑ]{2,}/.test(word)) return word;
    const parts = syllables(word);
    let out = '';
    let len = 0;
    parts.forEach((s, i) => {
      out += s;
      len += s.length;
      if (i < parts.length - 1 && len >= minLeft && word.length - len >= minRight) out += SOFT;
    });
    return out;
  });
}

export const stripOptionalHyphens = (text: string): string => text.split(SOFT).join('');

function mapText(fn: (s: string) => string): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    const a = empty ? 0 : from;
    const b = empty ? state.doc.content.size : to;
    const edits: { pos: number; end: number; text: string; marks: readonly import('prosemirror-model').Mark[] }[] = [];
    state.doc.nodesBetween(a, b, (n, pos) => {
      if (!n.isText) return true;
      const s = Math.max(a, pos) - pos;
      const e = Math.min(b, pos + n.nodeSize) - pos;
      const old = n.text!.slice(s, e);
      const next = fn(old);
      if (next !== old) edits.push({ pos: pos + s, end: pos + e, text: next, marks: n.marks });
      return false;
    });
    if (!edits.length) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const ed of edits.reverse()) {
        tr.replaceWith(ed.pos, ed.end, state.schema.text(ed.text, ed.marks));
      }
      dispatch(tr);
    }
    return true;
  };
}

/** Optional hyphens in the selected text, or in the whole document when nothing is selected. */
export const insertOptionalHyphens: Command = mapText((s) => hyphenateText(s));
export const removeOptionalHyphens: Command = mapText(stripOptionalHyphens);
