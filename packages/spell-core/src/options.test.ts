import { describe, expect, it } from 'vitest';
import { DEFAULT_REVIEW_OPTIONS, REVIEW_OPTIONS_KEY, grammarOptionsOf, loadReviewOptions, ruleOn, saveReviewOptions, skipWordWith } from './options';
import { checkGrammar } from './grammar';
import { findWords } from './words';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const skipped = (text: string, o: Partial<typeof DEFAULT_REVIEW_OPTIONS>) => findWords(text).filter((w) => skipWordWith(text, w, { ...DEFAULT_REVIEW_OPTIONS, ...o })).map((w) => w.word);

describe('opciones de revisión', () => {
  it('sin nada guardado dan los valores por omisión', () => {
    expect(loadReviewOptions(null)).toEqual(DEFAULT_REVIEW_OPTIONS);
    expect(loadReviewOptions(mem())).toEqual(DEFAULT_REVIEW_OPTIONS);
  });
  it('se guardan y se leen; lo inválido se descarta', () => {
    const s = mem();
    saveReviewOptions(s, { ...DEFAULT_REVIEW_OPTIONS, ignoreUppercase: false, rules: { 'long-sentence': true, 'no-existe': true }, longSentenceWords: 30 });
    const o = loadReviewOptions(s);
    expect(o.ignoreUppercase).toBe(false);
    expect(o.rules).toEqual({ 'long-sentence': true });
    expect(o.longSentenceWords).toBe(30);
    s.m.set(REVIEW_OPTIONS_KEY, '{no es json');
    expect(loadReviewOptions(s)).toEqual(DEFAULT_REVIEW_OPTIONS);
    s.m.set(REVIEW_OPTIONS_KEY, JSON.stringify({ longSentenceWords: 5, grammar: 'sí' }));
    expect(loadReviewOptions(s).longSentenceWords).toBe(50);
    expect(loadReviewOptions(s).grammar).toBe(true);
  });
  it('cada casilla de palabras que se omiten funciona por separado', () => {
    expect(skipped('La NASA vuela', { ignoreUppercase: true })).toContain('NASA');
    expect(skipped('La NASA vuela', { ignoreUppercase: false })).not.toContain('NASA');
    expect(skipped('el modelo ab2 y', { ignoreNumbers: true })).toContain('ab');
    expect(skipped('el modelo ab2 y', { ignoreNumbers: false })).not.toContain('ab');
    expect(skipped('escribe a pepe@correo.com ya', { ignoreInternet: true })).toEqual(expect.arrayContaining(['pepe', 'correo', 'com']));
    expect(skipped('escribe a pepe@correo.com ya', { ignoreInternet: false })).not.toContain('pepe');
  });
  it('las reglas siguen el valor por omisión salvo lo que la persona cambió', () => {
    expect(ruleOn(DEFAULT_REVIEW_OPTIONS, 'double-space', 'es')).toBe(true);
    expect(ruleOn(DEFAULT_REVIEW_OPTIONS, 'long-sentence', 'es')).toBe(false);
    expect(ruleOn(DEFAULT_REVIEW_OPTIONS, 'a-an', 'es')).toBe(false);
    expect(ruleOn({ ...DEFAULT_REVIEW_OPTIONS, rules: { 'long-sentence': true } }, 'long-sentence', 'es')).toBe(true);
    expect(ruleOn({ ...DEFAULT_REVIEW_OPTIONS, rules: { 'double-space': false } }, 'double-space', 'es')).toBe(false);
    expect(ruleOn({ ...DEFAULT_REVIEW_OPTIONS, grammar: false }, 'double-space', 'es')).toBe(false);
  });
  it('se traducen a las opciones de la gramática', () => {
    const o = { ...DEFAULT_REVIEW_OPTIONS, rules: { 'double-space': false, 'all-caps': true }, longSentenceWords: 20 };
    const g = grammarOptionsOf(o, 'es-MX');
    expect(checkGrammar('Hola  mundo', g).some((i) => i.rule === 'double-space')).toBe(false);
    expect(checkGrammar('UNO DOS TRES CUATRO aquí', g).some((i) => i.rule === 'all-caps')).toBe(true);
    expect(g.longSentenceWords).toBe(20);
  });
});
