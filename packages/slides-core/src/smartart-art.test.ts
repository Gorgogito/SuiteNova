import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { LAYOUT_CATALOG } from '@suitenova/smartart-core';
import { newDeck } from './defaults';
import { addElements } from './ops';
import { readPptx } from './pptx/read';
import { writePptx } from './pptx/write';
import { changeSmartArt, isLiveSmartArt, newSmartArtGroup, partsOf, reflowSmartArt, setSmartArtText, smartArtIds, smartArtNodeCount, smartArtOf, smartArtText } from './smartart-art';
import type { GroupEl } from './types';

const frame = { x: 100, y: 120, w: 640, h: 380 };
const L = (name: string) => LAYOUT_CATALOG.find((l) => l.id.endsWith('/' + name))!.id;
const make = (layout = 'process', text = 'Uno\nDos\nTres') => newSmartArtGroup({ layout: L(layout), text }, frame);

describe('SmartArt vinculado en Slides', () => {
  it('un SmartArt nuevo es un grupo con las formas del dibujo y las cinco partes guardadas', () => {
    const g = make();
    expect(g.smartart).toBe(true);
    expect(g.xfrm).toEqual(frame);
    expect(g.children).toHaveLength(5); // 3 nodos y 2 flechas
    expect(g.children.map((c) => (c.kind === 'shape' ? c.geom : null))).toBeTruthy();
    const parts = partsOf(g)!;
    expect(Object.keys(parts).sort()).toEqual(['colors', 'data', 'drawing', 'layout', 'style']);
    expect(isLiveSmartArt(g)).toBe(true);
    expect(smartArtText(g)).toBe('Uno\nDos\nTres');
    expect(smartArtNodeCount(g)).toBe(3);
    expect(smartArtIds(g)!.layout).toBe(L('process'));
  });

  it('cambiar el texto vuelve a calcular el dibujo y conserva la identidad del grupo', () => {
    const g = make();
    const g2 = setSmartArtText({ ...g, alt: 'Mi proceso', name: 'Proceso' } as GroupEl, 'Uno\nDos\nTres\nCuatro')!;
    expect(g2.id).toBe(g.id);
    expect((g2 as { alt?: string }).alt).toBe('Mi proceso');
    expect(g2.children).toHaveLength(7);
    expect(smartArtText(g2)).toBe('Uno\nDos\nTres\nCuatro');
    expect(g2.xfrm).toEqual(frame);
  });

  it('cambiar diseño, estilo y colores conserva el texto', () => {
    const g = make('process', 'A\nB\nC');
    const c = changeSmartArt(g, { layout: L('blocklist'), style: 'urn:suitenova/quickStyle/flat', colors: 'urn:suitenova/colors/accent3' })!;
    expect(smartArtText(c)).toBe('A\nB\nC');
    expect(smartArtIds(c)).toEqual({ layout: L('blocklist'), style: 'urn:suitenova/quickStyle/flat', colors: 'urn:suitenova/colors/accent3' });
    expect(c.children).toHaveLength(3);
    expect(changeSmartArt({ ...g, rawDiagram: undefined } as GroupEl, { layout: L('venn') })).toBeNull();
  });

  it('al cambiar el tamaño del grupo, reflow rehace el dibujo con el tamaño nuevo', () => {
    const g = make('blocklist', 'A\nB\nC');
    const small = reflowSmartArt({ ...g, xfrm: { ...frame, w: 320, h: 190 } })!;
    const w = (e: GroupEl) => (e.children[0] as { xfrm?: { w: number } }).xfrm!.w;
    expect(w(small)).toBeLessThan(w(g));
    expect(small.chExt).toEqual({ w: 320, h: 190 });
  });

  it('se guarda en .pptx con las cinco partes y se vuelve a leer: mismo texto, diseño y dibujo', async () => {
    let deck = newDeck();
    const g = make('hierarchy', 'Jefe\n\tUno\n\tDos');
    deck = addElements(deck, deck.slides[0]!.id, [g]);
    const bytes = (await writePptx(deck)).data;
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);
    for (const p of ['data', 'layout', 'quickStyle', 'colors', 'drawing']) expect(names.some((n) => new RegExp(`ppt/diagrams/${p}\\d*\\.xml$`).test(n)), p).toBe(true);
    const ct = await zip.file('[Content_Types].xml')!.async('string');
    expect(ct).toContain('diagramData+xml');
    expect(ct).toContain('diagramDrawing+xml');
    const data = names.find((n) => /diagrams\/data\d*\.xml$/.test(n))!;
    const dataXml = await zip.file(data)!.async('string');
    expect(dataXml).toMatch(/relId="rId\d+"/);
    const back = (await readPptx(bytes)).deck;
    const gb = back.slides[0]!.shapes.find((e) => e.kind === 'group' && e.smartart) as GroupEl;
    expect(gb).toBeDefined();
    expect(smartArtText(gb)).toBe('Jefe\n\tUno\n\tDos');
    expect(smartArtIds(gb)!.layout).toBe(L('hierarchy'));
    expect(gb.children.length).toBe(g.children.length);
    // se puede seguir editando lo que se ha leído
    expect(setSmartArtText(gb, 'Jefe\n\tUno\n\tDos\n\tTres')!.children.length).toBeGreaterThan(gb.children.length);
    expect(smartArtOf(gb)!.drawing).not.toBeNull();
  });

  it('dos SmartArt en la misma diapositiva no se pisan al guardar', async () => {
    let deck = newDeck();
    deck = addElements(deck, deck.slides[0]!.id, [make('process', 'A\nB'), make('blocklist', 'X\nY\nZ')]);
    const back = (await readPptx((await writePptx(deck)).data)).deck;
    const arts = back.slides[0]!.shapes.filter((e) => e.kind === 'group' && e.smartart) as GroupEl[];
    expect(arts.map(smartArtText)).toEqual(['A\nB', 'X\nY\nZ']);
  });
});
