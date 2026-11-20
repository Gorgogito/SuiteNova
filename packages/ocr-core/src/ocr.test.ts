import { describe, expect, it } from 'vitest';
import {
  OcrQueue, buildResult, cellValue, hasPositions, imageKey, invertIfDark, joinLines, memoryCache, packResult, prepare, readingKey, recognize, rotate90, searchMany, searchResult, stretchContrast,
  tableFromWords, textResult, toGrey, unmapBox, unpackResult, type Box, type OcrEngine, type OcrResult, type RawOcr, type Transform,
} from './index';

const px = (w: number, h: number, v = 255) => ({ w, h, data: new Uint8ClampedArray(w * h * 4).fill(v) });
const word = (text: string, x: number, y: number, w = 40, h = 12, confidence = 90) => ({ text, box: { x, y, w, h }, confidence });
const t0: Transform = { crop: { x: 0, y: 0 }, turns: 0, w: 1000, h: 1000, scale: 1 };

/** An engine that gives what it is told and remembers what it was given. */
function fake(answer: RawOcr | ((image: { w: number; h: number }) => RawOcr)) {
  const calls: { w: number; h: number; lang: string }[] = [];
  const engine: OcrEngine = {
    async recognize(image, o) {
      calls.push({ w: image.w, h: image.h, lang: o.lang });
      if (o.signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      return typeof answer === 'function' ? answer(image) : answer;
    },
  };
  return { engine, calls };
}

describe('preparing a picture', () => {
  it('greys, stretches the contrast and inverts light-on-dark', () => {
    const p = { w: 2, h: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]) };
    const g = toGrey(p);
    expect([g[0], g[1]]).toEqual([76, 255]); // red is darker than white; the transparent pixel counts as white
    const faded = new Uint8ClampedArray(1000).map((_, i) => (i < 500 ? 100 : 150));
    const s = stretchContrast(faded);
    expect([Math.min(...s), Math.max(...s)]).toEqual([0, 255]);
    expect(stretchContrast(new Uint8ClampedArray(100).fill(128))).toEqual(new Uint8ClampedArray(100).fill(128));
    expect(invertIfDark(new Uint8ClampedArray(10).fill(20))).toMatchObject({ inverted: true });
    expect(invertIfDark(new Uint8ClampedArray(10).fill(200))).toMatchObject({ inverted: false });
  });

  it('turns a quarter at a time and four turns give the picture back', () => {
    const p = { w: 3, h: 2, data: new Uint8ClampedArray(24).map((_, i) => i) };
    const r = rotate90(p, 1);
    expect([r.w, r.h]).toEqual([2, 3]);
    // the top-left pixel goes to the top-right
    expect(r.data[(0 * 2 + 1) * 4]).toBe(0);
    expect(rotate90(rotate90(rotate90(rotate90(p, 1), 1), 1), 1).data).toEqual(p.data);
    expect(rotate90(p, 2).data[0]).toBe(p.data[(2 * 3 - 1) * 4]);
    expect(rotate90(p, 0)).toBe(p);
  });

  it('enlarges small pictures, reduces huge ones and cuts the part asked', () => {
    expect(prepare(px(100, 50)).transform.scale).toBe(3);
    expect(prepare(px(600, 400)).transform.scale).toBe(2);
    expect(prepare(px(6000, 1000)).transform.scale).toBe(0.5);
    expect(prepare(px(1500, 1500)).transform.scale).toBe(1);
    const z = prepare(px(2000, 1000), { zone: { x: 100, y: 50, w: 400, h: 300 } });
    expect(z.transform).toMatchObject({ crop: { x: 100, y: 50 }, w: 400, h: 300 });
    expect(z.pixels.w).toBe(Math.round(400 * z.transform.scale));
  });

  it('puts a box of the prepared picture back where it was in the original, for every turn, scale and crop', () => {
    const orig: Box = { x: 120, y: 70, w: 90, h: 30 };
    const zone = { x: 100, y: 50, w: 400, h: 300 };
    for (const turns of [0, 1, 2, 3] as const) {
      const { transform } = prepare(px(800, 600), { zone, turns });
      // forward: original → part → turned → scaled
      const bx = orig.x - zone.x;
      const by = orig.y - zone.y;
      const pts: [number, number][] = [[bx, by], [bx + orig.w, by + orig.h]];
      const turned = pts.map(([x, y]): [number, number] => (turns === 1 ? [transform.h - y, x] : turns === 2 ? [transform.w - x, transform.h - y] : turns === 3 ? [y, transform.w - x] : [x, y]));
      const fx = Math.min(turned[0]![0], turned[1]![0]) * transform.scale;
      const fy = Math.min(turned[0]![1], turned[1]![1]) * transform.scale;
      const fw = Math.abs(turned[1]![0] - turned[0]![0]) * transform.scale;
      const fh = Math.abs(turned[1]![1] - turned[0]![1]) * transform.scale;
      const back = unmapBox({ x: fx, y: fy, w: fw, h: fh }, transform);
      expect([back.x, back.y, back.w, back.h].map(Math.round)).toEqual([orig.x, orig.y, orig.w, orig.h]);
    }
  });
});

describe('building a reading', () => {
  it('orders lines, joins words, drops specks, separates paragraphs and averages the confidence', () => {
    const raw: RawOcr = {
      lines: [
        { words: [word('Segunda', 10, 100), word('línea', 60, 100)] },
        { words: [word('Primera', 10, 10), word('basura', 100, 10, 30, 12, 5), word('línea', 60, 10, 40, 12, 70)] },
        { words: [word('Otro', 10, 200), word('párrafo', 60, 200)] },
      ],
    };
    const r = buildResult(raw, t0, { w: 300, h: 300 }, 'spa', 0, undefined, 5);
    expect(r.text).toBe('Primera línea\n\nSegunda línea\n\nOtro párrafo'.replace('línea\n\nSegunda', 'línea\n\nSegunda'));
    expect(r.lines.map((l) => l.text)).toEqual(['Primera línea', 'Segunda línea', 'Otro párrafo']);
    expect(r.lines[0]!.box).toEqual({ x: 10, y: 10, w: 90, h: 12 });
    expect(r.confidence).toBe(Math.round((70 + 90 + 90 + 90 + 90 + 90) / 6));
    expect(r.at).toBe(5);
    expect(hasPositions(r)).toBe(true);
  });
  it('joins close lines with a line break and far ones with a blank line', () => {
    const l = (y: number, text: string) => ({ text, box: { x: 0, y, w: 10, h: 10 }, words: [] });
    expect(joinLines([l(0, 'a'), l(12, 'b'), l(40, 'c')])).toBe('a\nb\n\nc');
  });
  it('a text that already was text (PDF) has no positions and full confidence', () => {
    const r = textResult(' Hola\r\nmundo ');
    expect([r.text, r.lang, r.confidence, hasPositions(r)]).toEqual(['Hola\nmundo', 'pdf', 100, false]);
  });
});

describe('recognizing', () => {
  it('prepares the picture, passes the language and gives the boxes in the original pixels', async () => {
    const { engine, calls } = fake({ lines: [{ words: [word('Hola', 30, 30, 60, 20)] }] });
    const r = await recognize(engine, px(600, 400), { lang: 'spa+eng' });
    expect(calls).toEqual([{ w: 1200, h: 800, lang: 'spa+eng' }]);
    expect(r.lines[0]!.words[0]!.box).toEqual({ x: 15, y: 15, w: 30, h: 10 });
    expect([r.width, r.height, r.lang, r.rotation]).toEqual([600, 400, 'spa+eng', 0]);
  });

  it('with the turn on «auto» keeps the turn that reads best, and only tries others when the first read badly', async () => {
    // a picture that is only readable when it is wider than tall: it comes turned a quarter
    const { engine, calls } = fake((image) => (image.w > image.h ? { lines: [{ words: [word('uno', 5, 5), word('dos', 60, 5), word('tres', 120, 5)] }] } : { lines: [{ words: [word('x', 5, 5, 10, 10, 30)] }] }));
    const r = await recognize(engine, px(100, 800), { lang: 'spa', turns: 'auto' });
    expect(r.rotation === 90 || r.rotation === 270).toBe(true);
    expect(r.text).toBe('uno dos tres');
    expect(calls.length).toBeGreaterThan(1);
    const good = fake({ lines: [{ words: [word('bien', 5, 5), word('leído', 60, 5)] }] });
    await recognize(good.engine, px(100, 800), { lang: 'spa', turns: 'auto' });
    expect(good.calls).toHaveLength(1);
  });

  it('is cancelled by its signal', async () => {
    const c = new AbortController();
    c.abort();
    await expect(recognize(fake({ lines: [] }).engine, px(10, 10), { lang: 'spa', signal: c.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('keys', () => {
  it('the same bytes give the same key and other bytes another', async () => {
    const a = await imageKey(new Uint8Array([1, 2, 3]));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await imageKey(new Uint8Array([1, 2, 3]))).toBe(a);
    expect(await imageKey(new Uint8Array([1, 2, 4]))).not.toBe(a);
    expect(readingKey('abc', 'spa')).not.toBe(readingKey('abc', 'eng'));
    expect(readingKey('abc', 'spa', { x: 1.4, y: 2, w: 3, h: 4 })).toBe('abc:spa:1,2,3,4');
  });
});

describe('the queue', () => {
  const job = (id: string, key = id, extra = {}) => ({ id, key, lang: 'spa', load: async () => px(50, 50), ...extra });
  const ans: RawOcr = { lines: [{ words: [word('texto', 5, 5)] }] };

  it('reads one at a time, in the order they came, higher priority first, and reports progress', async () => {
    const order: string[] = [];
    const engine: OcrEngine = { async recognize() { order.push('r'); await new Promise((r) => setTimeout(r, 5)); return ans; } };
    const q = new OcrQueue(engine);
    const seen: number[] = [];
    q.subscribe(() => seen.push(q.state.done));
    const loaded: string[] = [];
    const j = (id: string, p = 0) => job(id, id, { priority: p, load: async () => (loaded.push(id), px(50, 50)) });
    const all = [q.add(j('a')), q.add(j('b')), q.add(j('c')), q.add(j('d', 5))];
    expect(q.state.total).toBe(4);
    await Promise.all(all);
    expect(loaded).toEqual(['a', 'd', 'b', 'c']);
    expect(q.state).toMatchObject({ running: false, done: 0, total: 0, current: null });
    expect(Math.max(...seen)).toBeGreaterThanOrEqual(3);
  });

  it('answers from the cache at once and reads the same reading only once', async () => {
    const { engine, calls } = fake(ans);
    const cache = memoryCache();
    const q = new OcrQueue(engine, cache);
    const [a, b] = await Promise.all([q.add(job('x', 'K')), q.add(job('y', 'K'))]);
    expect(a).toBe(b);
    expect(calls).toHaveLength(1);
    expect(await q.add(job('z', 'K'))).toBe(a);
    expect(calls).toHaveLength(1);
    expect(cache.get('K')).toBe(a);
  });

  it('cancels a waiting job, the one being read and everything', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const engine: OcrEngine = { async recognize(_i, o) { await gate; if (o.signal?.aborted) throw new DOMException('Cancelado', 'AbortError'); return ans; } };
    const q = new OcrQueue(engine);
    const a = q.add(job('a'));
    const b = q.add(job('b'));
    const c = q.add(job('c'));
    const rb = expect(b).rejects.toMatchObject({ name: 'AbortError' });
    q.cancel('b');
    await rb;
    expect(q.pending).toBe(2);
    const ra = expect(a).rejects.toMatchObject({ name: 'AbortError' });
    const rc = expect(c).rejects.toMatchObject({ name: 'AbortError' });
    q.cancelAll();
    release();
    await Promise.all([ra, rc]);
    expect(q.pending).toBe(0);
    expect(q.state.running).toBe(false);
  });

  it('an error in one picture is reported and the next is still read', async () => {
    let n = 0;
    const engine: OcrEngine = { async recognize() { if (n++ === 0) throw new Error('no se pudo'); return ans; } };
    const q = new OcrQueue(engine);
    const a = q.add(job('a'));
    const b = q.add(job('b'));
    await expect(a).rejects.toThrow('no se pudo');
    expect((await b).text).toBe('texto');
  });

  it('prioritize moves a waiting picture to the front', async () => {
    const loaded: string[] = [];
    const q = new OcrQueue(fake(ans).engine);
    const j = (id: string) => job(id, id, { load: async () => (loaded.push(id), px(50, 50)) });
    const all = [q.add(j('a')), q.add(j('b')), q.add(j('c'))];
    q.prioritize('c');
    await Promise.all(all);
    expect(loaded).toEqual(['a', 'c', 'b']);
  });
});

describe('searching', () => {
  const r: OcrResult = buildResult(
    { lines: [{ words: [word('Factura', 10, 10, 70), word('número', 90, 10, 60), word('1.234', 160, 10, 50)] }, { words: [word('Total', 10, 60, 40), word('a', 60, 60, 10), word('pagar', 80, 60, 50)] }] },
    t0, { w: 300, h: 100 }, 'spa', 0,
  );
  it('finds a text with the box of the words it covers, ignoring case and accents', () => {
    const m = searchResult(r, 'NUMERO');
    expect(m).toHaveLength(1);
    expect(m[0]!.text).toBe('número');
    expect(m[0]!.boxes).toEqual([{ x: 90, y: 10, w: 60, h: 12 }]);
    const two = searchResult(r, 'factura numero');
    expect(two[0]!.boxes).toEqual([{ x: 10, y: 10, w: 140, h: 12 }]);
    const part = searchResult(r, 'ag');
    expect(part[0]!.boxes).toEqual([{ x: 80, y: 60, w: 50, h: 12 }]);
    expect(searchResult(r, 'total')[0]!.line).toBe('Total a pagar');
  });
  it('can be case sensitive, accent sensitive and whole-word', () => {
    expect(searchResult(r, 'factura', { caseSensitive: true })).toHaveLength(0);
    expect(searchResult(r, 'numero', { ignoreAccents: false })).toHaveLength(0);
    expect(searchResult(r, 'pag', { wholeWord: true })).toHaveLength(0);
    expect(searchResult(r, 'pagar', { wholeWord: true })).toHaveLength(1);
    expect(searchResult(r, '  ')).toEqual([]);
  });
  it('finds more than one match and the offset in the text', () => {
    const m = searchResult(r, 'a');
    // «Factura número 1.234», a blank line (the lines are far apart), «Total a pagar»
    expect(m.map((x) => x.index)).toEqual([1, 6, 25, 28, 31, 33]);
    expect(r.text.slice(25, 26)).toBe('a');
  });
  it('searches a text without positions (a PDF) and gives no boxes', () => {
    const m = searchResult(textResult('Primera línea\nsegunda LÍNEA'), 'linea');
    expect(m).toHaveLength(2);
    expect(m.every((x) => x.boxes.length === 0)).toBe(true);
  });
  it('searchMany lists the readings that match', () => {
    const found = searchMany(new Map([['a', r], ['b', textResult('nada')]]), 'total');
    expect(found.map((f) => f.id)).toEqual(['a']);
  });
});

describe('a table from the words', () => {
  const row = (y: number, cells: [string, number, number][]) => ({ words: cells.map(([t, x, w]) => word(t, x, y, w, 12)) });
  it('finds rows and columns by the white space, and joins the words of a cell', () => {
    const r = buildResult(
      {
        lines: [
          row(10, [['Producto', 10, 70], ['Unidades', 200, 70], ['Precio', 330, 50]]),
          row(40, [['Café', 10, 35], ['molido', 50, 55], ['12', 200, 20], ['3,50', 330, 30]]),
          row(70, [['Té', 10, 20], ['30', 200, 20], ['1.200,00', 330, 70]]),
        ],
      },
      t0, { w: 500, h: 100 }, 'spa', 0,
    );
    const t = tableFromWords(r);
    expect(t.columns).toBe(3);
    expect(t.rows).toEqual([['Producto', 'Unidades', 'Precio'], ['Café molido', '12', '3,50'], ['Té', '30', '1.200,00']]);
  });
  it('a row that lacks a cell leaves it empty, and nothing gives nothing', () => {
    const r = buildResult({ lines: [row(10, [['A', 10, 20], ['B', 200, 20]]), row(40, [['x', 10, 20]])] }, t0, { w: 300, h: 80 }, 'spa', 0);
    expect(tableFromWords(r).rows).toEqual([['A', 'B'], ['x', '']]);
    expect(tableFromWords(textResult('solo texto'))).toEqual({ rows: [], columns: 0 });
  });
  it('reads numbers as the language writes them', () => {
    expect(cellValue('1.234,56')).toBe(1234.56);
    expect(cellValue('1,234.56', 'en')).toBe(1234.56);
    expect(cellValue('3,50')).toBe(3.5);
    expect(cellValue('1.200')).toBe(1200);
    expect(cellValue('45 %')).toBe(0.45);
    expect(cellValue('€ 3,50')).toBe(3.5);
    expect(cellValue('$12')).toBe(12);
    expect(cellValue('-7')).toBe(-7);
    expect(cellValue('1.2.3')).toBe('1.2.3');
    expect(cellValue('Café')).toBe('Café');
    expect(cellValue('12 kg')).toBe('12 kg');
    expect(cellValue('')).toBe('');
  });
});

describe('keeping a reading in a file', () => {
  const r = buildResult({ lines: [{ words: [word('Hola', 10.04, 10, 40, 12), word('mundo', 60, 10, 50, 12, 80)] }] }, t0, { w: 200, h: 50 }, 'spa+eng', 0, { x: 0, y: 0, w: 200, h: 50 }, 1000);
  it('goes there and back', () => {
    const back = unpackResult(JSON.parse(JSON.stringify(packResult(r))))!;
    expect(back.text).toBe('Hola mundo');
    expect(back.lines[0]!.words.map((w) => [w.text, w.box.x, w.confidence])).toEqual([['Hola', 10, 90], ['mundo', 60, 80]]);
    expect([back.width, back.height, back.lang, back.at, back.confidence, back.rotation]).toEqual([200, 50, 'spa+eng', 1000, 85, 0]);
    expect(back.zone).toEqual({ x: 0, y: 0, w: 200, h: 50 });
  });
  it('is much smaller than the plain objects', () => {
    expect(JSON.stringify(packResult(r)).length).toBeLessThan(JSON.stringify(r).length / 2);
  });
  it('reads what older versions kept ({ text, lang, at }) as a reading without positions', () => {
    const old = unpackResult({ text: 'Texto viejo', lang: 'spa', at: 5 })!;
    expect([old.text, old.lang, old.at, old.lines, hasPositions(old), old.confidence]).toEqual(['Texto viejo', 'spa', 5, [], false, 100]);
    const pdf = unpackResult({ text: 'del pdf', lang: 'pdf', at: 1 })!;
    expect(pdf.lang).toBe('pdf');
  });
  it('drops what is damaged and is not fooled by what is not a reading', () => {
    expect(unpackResult(null)).toBeNull();
    expect(unpackResult('texto')).toBeNull();
    expect(unpackResult({ lang: 'spa' })).toBeNull();
    const d = unpackResult({ text: 'a', lang: 'spa', at: 'ayer', size: ['x', 1], lines: [5, [1, 2, 3, 4, [['ok', 1, 2, 3, 4, 150], ['mal', 'x', 2, 3, 4, 9], 7]], [1, 2, 3, 4, []]], rotation: 45, zone: [1, 2, 'x', 4] })!;
    expect(d.at).toBe(0);
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]!.words.map((w) => [w.text, w.confidence])).toEqual([['ok', 100]]);
    expect([d.rotation, d.width, d.zone]).toEqual([0, 0, undefined]);
  });
});
