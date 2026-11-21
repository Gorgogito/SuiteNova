/*
 * What is given to the voice is not always what is written: a web address spelled out letter by letter is not worth hearing, the marks that only draw
 * (bullets, zero-width characters) are noise. The text is turned into what is spoken, and a map says, for each character spoken, which character of the
 * written text it comes from, so that the word being spoken can be shown where it is written.
 */

export interface Spoken {
  /** What the voice is given. */
  text: string;
  /** For each index of `text`, the index in the written text it comes from (and one more for the end). */
  map: number[];
  /** For each index of `text`, where in the written text what it stands for ends (exclusive): a whole address for the word that replaces it. */
  ends: number[];
}

/** The range of the written text that the range [`start`, `end`) of the spoken text stands for. */
export function writtenRange(sp: Spoken, start: number, end: number): { start: number; end: number } {
  const a = sp.map[Math.max(0, Math.min(start, sp.text.length))]!;
  const last = Math.max(start, Math.min(end, sp.text.length) - 1);
  const b = sp.ends[Math.max(0, Math.min(last, sp.text.length - 1))] ?? a;
  return { start: a, end: Math.max(a, b) };
}

type Rule = { re: RegExp; to: (m: RegExpExecArray) => string };

const RULES = (lang: string): Rule[] => {
  const en = /^en/i.test(lang);
  return [
    // addresses are said as one word, not spelled out
    { re: /\bhttps?:\/\/[^\s<>"')\]]+/gi, to: () => (en ? 'link' : 'vínculo') },
    { re: /\bwww\.[^\s<>"')\]]+/gi, to: () => (en ? 'link' : 'vínculo') },
    { re: /\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, to: () => (en ? 'email address' : 'dirección de correo') },
    // marks that only draw
    { re: /[​-‏⁠﻿­]/g, to: () => '' },
    { re: /[•·▪■□◦●○▶►✓✔→]/g, to: () => ' ' },
    // several marks in a row (a line of dashes, a row of dots) are not read
    { re: /([-_=*#~.])\1{3,}/g, to: () => ' ' },
  ];
};

/** The text a voice is given, and where each character of it comes from. */
export function toSpeech(text: string, lang = 'es'): Spoken {
  // each rule works on the result of the one before, keeping the map from spoken text back to the written one
  let cur = text;
  let map = Array.from({ length: text.length + 1 }, (_v, i) => i);
  let ends = Array.from({ length: text.length }, (_v, i) => i + 1);
  for (const rule of RULES(lang)) {
    let out = '';
    const nmap: number[] = [];
    const nend: number[] = [];
    let last = 0;
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(cur))) {
      if (m[0] === '') {
        rule.re.lastIndex++;
        continue;
      }
      for (let i = last; i < m.index; i++) {
        out += cur[i];
        nmap.push(map[i]!);
        nend.push(ends[i]!);
      }
      const to = rule.to(m);
      for (let i = 0; i < to.length; i++) {
        out += to[i];
        nmap.push(map[m.index]!);
        nend.push(ends[m.index + m[0].length - 1]!);
      }
      last = m.index + m[0].length;
    }
    for (let i = last; i < cur.length; i++) {
      out += cur[i];
      nmap.push(map[i]!);
      nend.push(ends[i]!);
    }
    nmap.push(map[cur.length]!);
    cur = out;
    map = nmap;
    ends = nend;
  }
  return { text: cur, map, ends };
}
