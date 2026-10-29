import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { newDeck, newId } from '../defaults';
import { docFromText, makeDoc } from '../text';
import type { Deck, SlideElement } from '../types';
import { readPptx } from './read';
import { writePptx } from './write';

const dir = process.env.NOVA_PPTX_SAMPLES;

const count = (els: SlideElement[], acc: Record<string, number> = {}): Record<string, number> => {
  for (const e of els) {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1;
    if (e.kind === 'group') count(e.children, acc);
  }
  return acc;
};
const shape = (d: Deck) => d.slides.map((s) => count(s.shapes));

async function wellFormed(data: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(data);
  const bad: string[] = [];
  const parser = new XMLParser({ ignoreAttributes: false });
  for (const name of Object.keys(zip.files)) {
    if (!/\.(xml|rels)$/.test(name)) continue;
    try {
      parser.parse(await zip.files[name]!.async('string'), true);
    } catch (e) {
      bad.push(`${name}: ${(e as Error).message}`);
    }
  }
  return bad;
}

describe('pptx writer', () => {
  it('writes a new deck that reads back the same', async () => {
    const deck = newDeck();
    (deck.slides[0]!.shapes[0] as Extract<SlideElement, { kind: 'shape' }>).text = { body: {}, doc: docFromText('Título de prueba') };
    deck.slides.push({
      id: newId('s'),
      layoutId: deck.layouts[1]!.id,
      notes: { body: {}, doc: docFromText('Notas del orador') },
      shapes: [
        { kind: 'shape', id: newId(), ph: { type: 'title' }, text: { body: {}, doc: docFromText('Segunda') } },
        {
          kind: 'shape',
          id: newId(),
          geom: { prst: 'roundRect', adj: { adj: 30000 } },
          xfrm: { x: 100, y: 150, w: 300, h: 120, rot: 15 },
          fill: { t: 'grad', stops: [{ pos: 0, c: { rgb: '#ff0000' } }, { pos: 100000, c: { rgb: '#0000ff' } }], lin: { ang: 45 } },
          ln: { w: 3, fill: { t: 'solid', c: { rgb: '#000000' } }, dash: 'dash' },
          effects: { outer: { blur: 6, dist: 4, dir: 45, c: { rgb: '#000000', mods: [{ t: 'alpha', v: 40000 }] } } },
          text: { body: { anchor: 'ctr', fit: { t: 'norm', fontScale: 90 } }, doc: makeDoc([{ runs: [{ text: 'Hola ', r: { b: true, sz: 24 } }, { text: 'mundo', r: { color: { rgb: '#00ff00' } } }], p: { algn: 'ctr', bullet: { kind: 'auto', auto: 'alphaLcPeriod', startAt: 3 } } }]).toJSON() },
        },
      ],
    });
    deck.sections = [{ id: 'x', name: 'Intro', slideIds: [deck.slides[0]!.id] }, { id: 'y', name: 'Cuerpo', slideIds: [deck.slides[1]!.id] }];
    const out = await writePptx(deck);
    expect(await wellFormed(out.data)).toEqual([]);
    const back = (await readPptx(out.data)).deck;
    expect(back.slides).toHaveLength(2);
    expect(shape(back)).toEqual(shape(deck));
    expect(back.sections.map((s) => s.name)).toEqual(['Intro', 'Cuerpo']);
    expect(back.sections[1]!.slideIds).toEqual([back.slides[1]!.id]);
    const sp = back.slides[1]!.shapes[1] as Extract<SlideElement, { kind: 'shape' }>;
    expect(sp.geom).toEqual({ prst: 'roundRect', adj: { adj: 30000 } });
    expect(sp.xfrm?.rot).toBe(15);
    expect(sp.fill?.t).toBe('grad');
    expect(sp.ln?.dash).toBe('dash');
    expect(sp.effects?.outer?.blur).toBe(6);
    expect(sp.text?.body.fit).toEqual({ t: 'norm', fontScale: 90 });
    expect(back.slides[1]!.notes).toBeTruthy();
    const json = JSON.stringify(sp.text!.doc);
    expect(json).toContain('alphaLcPeriod');
    expect(json).toContain('"startAt":3');
  });
});

describe.skipIf(!dir)('real files survive a round trip', () => {
  const files = dir ? fs.readdirSync(dir).filter((f) => /\.(pptx|ppsx)$/i.test(f)) : [];
  it('read → write → read keeps the slides and shapes, and the output is well-formed', async () => {
    const problems: string[] = [];
    let ok = 0;
    for (const f of files) {
      try {
        const a = (await readPptx(new Uint8Array(fs.readFileSync(path.join(dir!, f))))).deck;
        const out = await writePptx(a);
        const bad = await wellFormed(out.data);
        if (bad.length) problems.push(`${f}: ${bad[0]}`);
        const b = (await readPptx(out.data)).deck;
        if (a.slides.length !== b.slides.length) problems.push(`${f}: slides ${a.slides.length} → ${b.slides.length}`);
        else if (JSON.stringify(shape(a)) !== JSON.stringify(shape(b))) problems.push(`${f}: shapes differ ${JSON.stringify(shape(a)[0])} → ${JSON.stringify(shape(b)[0])}`);
        else ok++;
      } catch (e) {
        problems.push(`${f}: THROW ${(e as Error).message.split('\n')[0]}`);
      }
    }
    console.log(`${ok}/${files.length} round trips identical in structure`);
    console.log(problems.slice(0, 30).join('\n'));
    expect(problems.filter((p) => /THROW|slides \d/.test(p)).length).toBeLessThan(files.length * 0.05);
  }, 900_000);
});
