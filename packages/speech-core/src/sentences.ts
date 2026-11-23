/*
 * Cutting a text into what is spoken one piece at a time. A voice reads best (and can be paused, skipped and followed) by sentence: very long pieces
 * are cut by some engines, and «next» and «previous» need something to jump to. Offsets are always into the text given, so a product can highlight
 * what is being read.
 */

export interface Span {
  /** Offset in the text where it starts and where it ends (exclusive). */
  start: number;
  end: number;
}

/** Titles and the like: whatever follows them goes on the same sentence («Sr. Pérez»). */
const TITLES = new Set([
  'sr', 'sra', 'srta', 'sres', 'srs', 'dr', 'dra', 'drs', 'lic', 'ing', 'arq', 'prof', 'profa', 'ud', 'uds', 'vd', 'vds', 'pág', 'págs', 'pag', 'pp', 'núm', 'num', 'art', 'arts', 'cap', 'caps', 'vol', 'tel', 'av', 'avda', 'dpto', 'depto', 'admón', 'aprox', 'fdo', 'ej', 'sta', 'sto', 'excmo', 'excma', 'ilmo', 'ilma', 'atte', 'cf', 'cfr', 'op', 'ed', 'eds', 'trad', 'vs',
  'mr', 'mrs', 'ms', 'st', 'jr', 'fig', 'eq', 'dept', 'est', 'approx', 'e.g', 'i.e',
]);

// Abbreviations that can end a sentence («…a las 5 p.m. Luego…», «…etc. Después…») are not in the list: with a capital after them, the stop ends it.

const OPEN = /^[¿¡"'“‘«(\[]*[\p{Lu}\p{N}¿¡]/u;

/** Is the stop at `i` (a «.», «!» or «?» run ending at `end`) really the end of a sentence? */
function endsSentence(text: string, stopAt: number, end: number): boolean {
  const next = text.slice(end);
  // the end of the text or a line break always ends it
  if (!next.trim() || /^[ \t]*\n/.test(next)) return true;
  // it has to be followed by a space and then something that starts a sentence
  if (!/^[\s"'”’»)\]]+/.test(next)) return false;
  const after = next.replace(/^[\s"'”’»)\]]+/, '');
  if (!OPEN.test(after)) return false;
  const ch = text[stopAt]!;
  if (ch === '.') {
    // a word before the stop: an abbreviation («Sr.», «etc.») or an initial («J. Pérez») does not end it
    const before = text.slice(0, stopAt);
    const raw = /([\p{L}\p{N}.]+)$/u.exec(before)?.[1] ?? '';
    const word = raw.toLowerCase();
    const bare = word.replace(/\.$/, '');
    // a number and a stop at the start of a line is a list item («3. Punto»), not the end of a sentence; after other words it is («desde 2010. Antes»)
    if (/^\d+$/.test(word)) return !/(^|\n)[ \t]*\d+$/.test(before);
    // the unit of a temperature («25 °C. Mañana») is not an initial
    if (word.length === 1 && /°\s?$/.test(before.slice(0, before.length - 1))) return true;
    if (word.length === 1 || TITLES.has(word) || TITLES.has(bare)) return false;
  }
  return true;
}

/** The sentences of a text (and the lines: a line break always ends one), skipping the white space between them. */
export function sentences(text: string): Span[] {
  const out: Span[] = [];
  let from = 0;
  const push = (a: number, b: number) => {
    while (a < b && /\s/.test(text[a]!)) a++;
    while (b > a && /\s/.test(text[b - 1]!)) b--;
    if (b > a) out.push({ start: a, end: b });
  };
  // the stop and the closing quotes and brackets that go with it («…tarde.»)
  const re = /[.!?…]+["'”’»)\]]*|\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    if (m[0] === '\n') {
      push(from, m.index);
      from = end;
    } else if (endsSentence(text, m.index, end)) {
      push(from, end);
      from = end;
    }
  }
  push(from, text.length);
  return out;
}

/**
 * A piece longer than `max` characters is cut where a pause would be (after a comma, a semicolon or a colon, then a space), as near as possible to
 * the middle of what is left; with none, at a space. Short pieces come back as they are.
 */
export function cutLong(text: string, span: Span, max = 220): Span[] {
  if (span.end - span.start <= max) return [span];
  const out: Span[] = [];
  let a = span.start;
  while (span.end - a > max) {
    const window = text.slice(a, a + max);
    let cut = -1;
    for (const re of [/[,;:–—)]\s/g, /\s/g]) {
      let m: RegExpExecArray | null;
      let best = -1;
      while ((m = re.exec(window))) if (m.index > max * 0.35) best = m.index + 1;
      if (best > 0) {
        cut = a + best;
        break;
      }
    }
    if (cut < 0) cut = a + max;
    out.push({ start: a, end: cut });
    a = cut;
    while (a < span.end && /\s/.test(text[a]!)) a++;
  }
  if (a < span.end) out.push({ start: a, end: span.end });
  return out.map((s) => {
    let b = s.end;
    while (b > s.start && /\s/.test(text[b - 1]!)) b--;
    return { start: s.start, end: b };
  });
}

/** The pieces to speak of a text: sentences, with the long ones cut. */
export function pieces(text: string, max = 220): Span[] {
  return sentences(text).flatMap((s) => cutLong(text, s, max));
}
