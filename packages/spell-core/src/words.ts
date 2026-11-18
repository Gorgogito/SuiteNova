const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;

export interface Word {
  word: string;
  start: number;
  end: number;
}

/** Palabras de un texto con su posición. Las compuestas con guion se revisan por partes. */
export function findWords(text: string): Word[] {
  const out: Word[] = [];
  for (const m of text.matchAll(WORD)) out.push({ word: m[0], start: m.index!, end: m.index! + m[0].length });
  return out;
}

/** Si una palabra no se revisa: siglas, partes de direcciones de correo, rutas e identificadores con cifras. */
export function skipWord(text: string, w: Word): boolean {
  if (w.word.length < 2) return true;
  if (w.word === w.word.toUpperCase() && /\p{Lu}/u.test(w.word)) return true;
  const before = text[w.start - 1] ?? '';
  const after = text[w.end] ?? '';
  if (/[@/\_\d#]/.test(before) || /[@/\_\d]/.test(after)) return true;
  // direcciones de internet y nombres de archivo: un punto unido a letras por los dos lados
  if ((before === '.' && /[\p{L}\d]/u.test(text[w.start - 2] ?? '')) || (after === '.' && /[\p{L}\d]/u.test(text[w.end + 1] ?? ''))) return true;
  return false;
}
