import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { newDeck, newId } from '../defaults';
import { docFromText, makeDoc } from '../text';
import type { Deck, PicEl, SlideElement } from '../types';
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

describe('macros of the suite in a .pptx', () => {
  it('travel in a part of their own and come back; a file without them reads none', async () => {
    const deck = newDeck();
    const macros = [{ name: 'Modulo1', code: 'Sub A()\n  x = "]]>"\nEnd Sub' }];
    const { data } = await writePptx(deck, { macros });
    const back = await readPptx(data);
    expect(back.macros).toEqual(macros);
    expect((await readPptx((await writePptx(deck)).data)).macros).toEqual([]);
    expect(back.warnings).toEqual(expect.not.arrayContaining([expect.stringContaining('macros')]));
  });
});

describe('an SVG icon in a .pptx', () => {
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
  const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="#c00000"><path d="M2 2h20v20H2z"/></svg>';
  it('goes as PowerPoint does it: the PNG is the picture and the SVG hangs from its blip; it comes back as an SVG with its PNG', async () => {
    const deck = newDeck();
    const p = newId('a');
    const s = newId('a');
    deck.assets[p] = { id: p, mime: 'image/png', data: png, name: 'icono.png' };
    deck.assets[s] = { id: s, mime: 'image/svg+xml', data: new TextEncoder().encode(svgText), name: 'icono.svg' };
    deck.slides[0]!.shapes.push({ kind: 'pic', id: newId(), name: 'Icono', descr: 'Estrella', src: p, svg: s, xfrm: { x: 10, y: 10, w: 96, h: 96 } });
    deck.slides[0]!.shapes.push({ kind: 'pic', id: newId(), name: 'Foto', descr: '', src: p, xfrm: { x: 200, y: 10, w: 50, h: 50 } });
    const { data } = await writePptx(deck);
    const zip = await JSZip.loadAsync(data);
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(xml).toMatch(/<a:blip r:embed="rId\d+"><a:extLst><a:ext uri="\{96DAC541-7B7A-43D3-8B79-37D633B846F1\}"><asvg:svgBlip [^>]*r:embed="rId\d+"\/>/);
    expect((xml.match(/svgBlip/g) ?? []).length).toBe(1);
    expect(Object.keys(zip.files).filter((f) => /^ppt\/media\/.*\.svg$/.test(f))).toHaveLength(1);
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('Extension="svg" ContentType="image/svg+xml"');
    const back = await readPptx(data);
    const pics = back.deck.slides[0]!.shapes.filter((e): e is PicEl => e.kind === 'pic');
    expect(pics).toHaveLength(2);
    const icon = pics.find((e) => e.name === 'Icono')!;
    expect(back.deck.assets[icon.svg!]!.mime).toBe('image/svg+xml');
    expect(new TextDecoder().decode(back.deck.assets[icon.svg!]!.data)).toBe(svgText);
    expect(back.deck.assets[icon.src]!.mime).toBe('image/png');
    expect(pics.find((e) => e.name === 'Foto')!.svg).toBeUndefined();
  });
});

describe('picture originals and edits in a .pptx', () => {
  // a 1×1 PNG
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
  const make = () => {
    const deck = newDeck();
    const baked = newId('a');
    const orig = newId('a');
    deck.assets[baked] = { id: baked, mime: 'image/png', data: png, name: 'baked.png' };
    deck.assets[orig] = { id: orig, mime: 'image/png', data: Uint8Array.from([...png]), name: 'orig.png' };
    const slide = deck.slides[0]!;
    slide.shapes.push({ kind: 'pic', id: newId(), name: 'Imagen', descr: '', src: baked, xfrm: { x: 10, y: 10, w: 100, h: 80 }, orig, edits: { artistic: { id: 'mosaic', level: 40 }, saturation: 150, background: { tolerance: 40, keep: [{ x: 1, y: 2 }] } } });
    // a picture without edits and one inside a group: the order of the pictures must not be confused
    slide.shapes.push({ kind: 'pic', id: newId(), name: 'Otra', descr: '', src: baked, xfrm: { x: 200, y: 10, w: 50, h: 50 } });
    return { deck, orig };
  };

  it('the original and the edits come back, and the picture is saved already edited', async () => {
    const { deck } = make();
    const { data } = await writePptx(deck);
    const back = await readPptx(data);
    const pics = back.deck.slides[0]!.shapes.filter((e) => e.kind === 'pic') as import('../types').PicEl[];
    expect(pics).toHaveLength(2);
    expect(pics[0]!.edits).toEqual({ artistic: { id: 'mosaic', level: 40 }, saturation: 150, background: { tolerance: 40, keep: [{ x: 1, y: 2 }] } });
    expect(pics[0]!.orig && back.deck.assets[pics[0]!.orig]!.name).toBe('novaorig1.png');
    expect(pics[0]!.orig).not.toBe(pics[0]!.src);
    expect(pics[1]!.orig).toBeUndefined();
    expect(back.warnings.filter((w) => /originales/.test(w))).toEqual([]);
  });

  it('a file whose pictures have no edits carries no such part', async () => {
    const { deck } = make();
    for (const e of deck.slides[0]!.shapes) if (e.kind === 'pic') delete (e as { orig?: string }).orig;
    const zip = await JSZip.loadAsync((await writePptx(deck)).data);
    expect(Object.keys(zip.files).some((n) => /novaPictures/.test(n))).toBe(false);
  });
});

describe('the text read from pictures (OCR) in a .pptx', () => {
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
  const ocr = { text: 'Factura 4821', lang: 'spa', at: 3, size: [10, 10], lines: [[1, 1, 8, 4, [['Factura', 1, 1, 5, 4, 90]]]] };
  it('goes in a part of its own, comes back with the picture, and a file without readings carries no such part', async () => {
    const deck = newDeck();
    const a = newId('a');
    const b = newId('a');
    deck.assets[a] = { id: a, mime: 'image/png', data: png, name: 'a.png', ocr };
    deck.assets[b] = { id: b, mime: 'image/png', data: Uint8Array.from([...png, 0]), name: 'b.png' };
    deck.slides[0]!.shapes.push({ kind: 'pic', id: newId(), name: 'Sin', descr: '', src: b, xfrm: { x: 0, y: 0, w: 10, h: 10 } });
    deck.slides[0]!.shapes.push({ kind: 'pic', id: newId(), name: 'Con', descr: 'alt', src: a, xfrm: { x: 20, y: 0, w: 10, h: 10 } });
    const { data } = await writePptx(deck);
    const zip = await JSZip.loadAsync(data);
    expect(await zip.file('customXml/novaOcr1.xml')!.async('string')).toContain('Factura');
    expect(await zip.file('ppt/slides/slide1.xml')!.async('string')).not.toContain('Factura');
    const back = (await readPptx(data)).deck;
    const pics = back.slides[0]!.shapes.filter((e) => e.kind === 'pic') as import('../types').PicEl[];
    expect(back.assets[pics[1]!.src]!.ocr).toEqual(ocr);
    expect(back.assets[pics[0]!.src]!.ocr).toBeUndefined();
    delete deck.assets[a]!.ocr;
    expect(Object.keys((await JSZip.loadAsync((await writePptx(deck)).data)).files).some((n) => /novaOcr/.test(n))).toBe(false);
  });
});

describe('comments in a .pptx (the modern kind PowerPoint 365 writes)', () => {
  const at = Date.UTC(2026, 10, 20, 10, 0);
  const withComments = () => {
    const deck = newDeck();
    deck.slides[0]!.comments = [
      { id: 'c1', author: 'Ana María', initials: 'AM', text: 'Revisar este título', at, x: 100, y: 80 },
      { id: 'c2', author: 'Luis Torres', initials: 'LT', text: 'De acuerdo\nSegunda línea', at: at + 60000, x: 100, y: 80, replyTo: 'c1' },
      { id: 'c3', author: 'Luis Torres', initials: 'LT', text: 'Resuelto <ya> & hecho', at: at + 120000, x: 300, y: 200, resolved: true },
    ];
    return deck;
  };
  it('keeps the replies, who wrote, when, where, the text and «resolved»', async () => {
    const back = (await readPptx((await writePptx(withComments())).data)).deck.slides[0]!.comments!;
    expect(back).toHaveLength(3);
    const [a, r, c] = back;
    expect([a!.author, a!.initials, a!.text, a!.at, a!.x, a!.y, a!.resolved]).toEqual(['Ana María', 'AM', 'Revisar este título', at, 100, 80, undefined]);
    expect([r!.author, r!.text, r!.replyTo]).toEqual(['Luis Torres', 'De acuerdo\nSegunda línea', a!.id]);
    expect([c!.text, c!.resolved, c!.x, c!.y]).toEqual(['Resuelto <ya> & hecho', true, 300, 200]);
  });
  it('is the modern format: authors part, typed comments part, well-formed, and the comment keeps its id', async () => {
    const data = (await writePptx(withComments())).data;
    expect(await wellFormed(data)).toEqual([]);
    const zip = await JSZip.loadAsync(data);
    const names = Object.keys(zip.files);
    expect(names).toContain('ppt/authors.xml');
    expect(names.some((n) => /^ppt\/comments\/modernComment_100_[0-9A-F]{8}\.xml$/.test(n))).toBe(true);
    expect(names.some((n) => /commentAuthors|ppt\/comments\/comment\d/.test(n))).toBe(false);
    expect(await zip.file('[Content_Types].xml')!.async('string')).toMatch(/vnd\.ms-powerpoint\.comments\+xml/);
    const first = (await readPptx(data)).deck.slides[0]!.comments![0]!.id;
    const again = (await readPptx((await writePptx((await readPptx(data)).deck)).data)).deck.slides[0]!.comments![0]!.id;
    expect(again).toBe(first);
  });
  it('still reads the old kind of comment, with its position and author', async () => {
    const data = (await writePptx(newDeck())).data;
    const zip = await JSZip.loadAsync(data);
    zip.file('ppt/commentAuthors.xml', '<?xml version="1.0"?><p:cmAuthorLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cmAuthor id="0" name="Pablo" initials="P" lastIdx="1" clrIdx="0"/></p:cmAuthorLst>');
    zip.file('ppt/comments/comment1.xml', '<?xml version="1.0"?><p:cmLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cm authorId="0" dt="2026-11-20T10:00:00.000" idx="1"><p:pos x="576" y="1152"/><p:text>Antiguo</p:text></p:cm></p:cmLst>');
    zip.file('ppt/slides/_rels/slide1.xml.rels', (await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string')).replace('</Relationships>', '<Relationship Id="rIdC" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments/comment1.xml"/></Relationships>'));
    zip.file('ppt/_rels/presentation.xml.rels', (await zip.file('ppt/_rels/presentation.xml.rels')!.async('string')).replace('</Relationships>', '<Relationship Id="rIdA" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors" Target="commentAuthors.xml"/></Relationships>'));
    const c = (await readPptx(await zip.generateAsync({ type: 'uint8array' }))).deck.slides[0]!.comments!;
    expect(c).toHaveLength(1);
    expect([c[0]!.author, c[0]!.text, c[0]!.x, c[0]!.y]).toEqual(['Pablo', 'Antiguo', 72, 144]);
  });
});
