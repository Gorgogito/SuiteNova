import { describe, expect, it } from 'vitest';
import { caseParts, changeCase, docToDiagramText, mapDocCase, mapDocText, replaceFont, usedFonts } from './textops';
import { makeDoc, docText } from './text';
import { newDeck } from './defaults';
import { newShape } from './factory';
import type { ShapeEl } from './types';

describe('change case', () => {
  it('sentence, lower, upper, title, toggle', () => {
    expect(changeCase('hOLA mundo. ¿qué tal? bien', 'sentence')).toBe('Hola mundo. ¿Qué tal? Bien');
    expect(changeCase('Hola', 'lower')).toBe('hola');
    expect(changeCase('Hola', 'upper')).toBe('HOLA');
    expect(changeCase('el señor de los anillos', 'title')).toBe('El Señor de los Anillos');
    expect(changeCase('Hola', 'toggle')).toBe('hOLA');
  });
  it('maps the text of a document keeping paragraphs', () => {
    const doc = makeDoc([{ runs: [{ text: 'uno ', r: { b: true } }, { text: 'dos' }] }, { text: 'tres' }]).toJSON();
    expect(docText(mapDocText(doc, (s) => s.toUpperCase()))).toBe('UNO DOS\nTRES');
  });
});

describe('case across runs', () => {
  it('a sentence spans formatted runs', () => {
    expect(caseParts(['hola ', 'MUNDO'], 'sentence')).toEqual(['Hola ', 'mundo']);
    const doc = makeDoc([{ runs: [{ text: 'hola ', r: { b: true } }, { text: 'MUNDO' }] }]).toJSON();
    expect(docText(mapDocCase(doc, 'sentence'))).toBe('Hola mundo');
  });
});

describe('fonts', () => {
  const deckWith = (font: string) => {
    const d = newDeck();
    const s = newShape('rect', 10, 10, 100, 50) as ShapeEl;
    s.text = { body: {}, doc: makeDoc([{ runs: [{ text: 'a', r: { latin: font } }, { text: 'b', r: { latin: 'Arial' } }] }]).toJSON() };
    d.slides[0]!.shapes.push(s);
    return d;
  };
  it('lists and replaces fonts', () => {
    const d = deckWith('Georgia');
    const used = usedFonts(d);
    expect(used.get('Georgia')).toBe(1);
    expect(used.get('Arial')).toBeGreaterThanOrEqual(1);
    const r = replaceFont(d, 'Georgia', 'Verdana');
    expect(usedFonts(r).has('Georgia')).toBe(false);
    expect(usedFonts(r).get('Verdana')).toBe(1);
    expect(usedFonts(r).get('Arial')).toBe(usedFonts(d).get('Arial'));
  });
  it('a text as the lines of a diagram', () => {
    const doc = makeDoc([{ text: 'Uno' }, { text: 'Sub', lvl: 1 }, { text: '' }, { text: 'Dos' }]).toJSON();
    expect(docToDiagramText(doc)).toBe('Uno\n  Sub\nDos');
  });
});
