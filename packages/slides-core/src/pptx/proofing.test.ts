import { describe, expect, it } from 'vitest';
import { newDeck } from '../defaults';
import { docNode, makeDoc } from '../text';
import type { RunProps, SlideElement } from '../types';
import { readPptx } from './read';
import { writePptx } from './write';

describe('pptx: idioma de revisión y «no revisar»', () => {
  it('lang y noProof de cada tramo sobreviven al guardar y abrir', async () => {
    const deck = newDeck();
    const sp = deck.slides[0]!.shapes[0] as Extract<SlideElement, { kind: 'shape' }>;
    sp.text = {
      body: {},
      doc: makeDoc([{ runs: [{ text: 'Hola ', r: { lang: 'es-MX' } }, { text: 'hello', r: { lang: 'en-US', noProof: true } }, { text: ' fin' }] }]).toJSON(),
    };
    const out = await writePptx(deck);
    const back = (await readPptx(out.data)).deck;
    const el = back.slides[0]!.shapes[0] as Extract<SlideElement, { kind: 'shape' }>;
    const runs: (RunProps | undefined)[] = [];
    docNode(el.text!.doc).descendants((n) => {
      if (n.isText) runs.push(n.marks.find((m) => m.type.name === 'run')?.attrs.r as RunProps | undefined);
      return true;
    });
    expect(runs[0]?.lang).toBe('es-MX');
    expect(runs[1]).toMatchObject({ lang: 'en-US', noProof: true });
    expect(runs[2]?.noProof).toBeUndefined();
  });
});
