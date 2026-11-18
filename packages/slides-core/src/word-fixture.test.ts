// Genera scripts/word-compare/lang.pptx para abrirlo con PowerPoint real (word-lang.ps1). Solo con NOVA_WORD_FIXTURES=1.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { newDeck } from './defaults';
import { writePptx } from './pptx/write';
import { makeDoc } from './text';
import type { SlideElement } from './types';

describe.skipIf(!process.env.NOVA_WORD_FIXTURES)('fixture para PowerPoint', () => {
  it('lang.pptx', async () => {
    const deck = newDeck();
    const sp = deck.slides[0]!.shapes[0] as Extract<SlideElement, { kind: 'shape' }>;
    sp.text = { body: {}, doc: makeDoc([{ runs: [{ text: 'Una cassa ', r: { lang: 'es-MX' } }, { text: 'a dogg ', r: { lang: 'en-US' } }, { text: 'cassa sin revisar', r: { noProof: true } }] }]).toJSON() };
    const out = await writePptx(deck);
    fs.writeFileSync(fileURLToPath(new URL('../../../scripts/word-compare/lang.pptx', import.meta.url)), out.data);
  });
});
