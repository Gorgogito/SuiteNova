import { compileQuery } from '@suitenova/find-core';
import { describe, expect, it } from 'vitest';
import { docFromText } from '@suitenova/writer-core';
import { findRanges } from '../find/pm-text';

const q = (text: string, o = {}) => {
  const c = compileQuery(text, o);
  if (!c.ok) throw new Error(c.message);
  return c.query;
};

describe('Writer search over the document text', () => {
  const doc = docFromText('Hola mundo\nHola de nuevo\nAdiós');

  it('finds across the paragraph mark (^p)', () => {
    const ms = findRanges(doc, q('mundo^pHola'));
    expect(ms).toHaveLength(1);
    expect(doc.textBetween(ms[0]!.from, ms[0]!.to, '|')).toBe('mundo|Hola');
  });

  it('maps wildcard matches to positions in the right paragraph', () => {
    const ms = findRanges(doc, q('<H???>', { mode: 'wildcards' }));
    expect(ms.map((m) => doc.textBetween(m.from, m.to))).toEqual(['Hola', 'Hola']);
    expect(ms[1]!.from).toBeGreaterThan(ms[0]!.to);
  });

  it('does not let * run over a paragraph', () => {
    expect(findRanges(doc, q('mundo*nuevo', { mode: 'wildcards' }))).toHaveLength(0);
  });

  it('ignores accents with the original text kept', () => {
    const ms = findRanges(doc, q('adios', { ignoreAccents: true }));
    expect(ms.map((m) => doc.textBetween(m.from, m.to))).toEqual(['Adiós']);
  });

  it('keeps the groups for the replacement', () => {
    const ms = findRanges(doc, q('(H)ola', { mode: 'wildcards' }));
    expect(ms[0]!.match.groups).toEqual(['H']);
  });
});
