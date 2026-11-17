import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { newDeck } from './defaults';
import { newLine, newPicture, newShape, newTable, newTextBox } from './factory';
import { readOdp, writeOdp } from './odp';
import { addElements, updateSlide } from './ops';
import { docFromText, docText } from './text';
import type { Deck, PicEl, ShapeEl, TableEl } from './types';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

describe('odp', () => {
  it('writes and reads text, shapes, lines, pictures, tables, notes and hidden slides', async () => {
    let d: Deck = newDeck();
    const sid = d.slides[0]!.id;
    const tb = newTextBox(40, 30, 300, 60);
    tb.text = { body: tb.text!.body, doc: docFromText('Hola mundo', undefined, { b: true, sz: 28, color: { rgb: '#c00000' } }) };
    const sh = newShape('ellipse', 100, 150, 120, 80);
    sh.fill = { t: 'solid', c: { rgb: '#4472c4' } };
    sh.xfrm = { ...sh.xfrm!, rot: 30 };
    sh.text = { body: { anchor: 'ctr' }, doc: docFromText('Dentro') };
    const ln = newLine('line', 300, 100, 500, 200);
    d.assets.pic = { id: 'pic', mime: 'image/png', data: PNG, name: 'p.png' };
    const pic = newPicture('pic', 400, 250, 100, 50, 'una imagen');
    const tbl = newTable(2, 2, 40, 300, 300);
    tbl.rows[0]!.cells[0]!.text = { body: {}, doc: docFromText('A1') };
    d = addElements(d, sid, [tb, sh, ln, pic, tbl]);
    d = updateSlide(d, sid, (s) => ({ ...s, hidden: true, notes: { body: {}, doc: docFromText('nota del orador') } }));
    const w = await writeOdp(d);
    const back = (await readOdp(w.data)).deck;
    expect(back.slides.length).toBe(1);
    const s = back.slides[0]!;
    expect(s.hidden).toBe(true);
    expect(docText(s.notes!.doc)).toBe('nota del orador');
    expect(Math.round(back.size.w)).toBe(Math.round(d.size.w));
    const texts = s.shapes.filter((e): e is ShapeEl => e.kind === 'shape');
    const hola = texts.find((e) => docText(e.text!.doc) === 'Hola mundo')!;
    expect(hola).toBeTruthy();
    expect(Math.round(hola.xfrm!.x)).toBe(40);
    expect(JSON.stringify(hola.text!.doc)).toMatch(/"b":true/);
    expect(JSON.stringify(hola.text!.doc)).toMatch(/"sz":28/);
    const el = texts.find((e) => docText(e.text!.doc) === 'Dentro')!;
    expect('prst' in el.geom! && el.geom.prst).toBe('ellipse');
    expect(el.fill).toEqual({ t: 'solid', c: { rgb: '#4472c4' } });
    expect(el.xfrm!.rot).toBeCloseTo(30, 0);
    expect(el.xfrm!.x).toBeCloseTo(100, 0);
    expect(el.xfrm!.y).toBeCloseTo(150, 0);
    expect(s.shapes.some((e) => e.kind === 'cxn')).toBe(true);
    const p = s.shapes.find((e): e is PicEl => e.kind === 'pic')!;
    expect(back.assets[p.src]!.data.length).toBe(PNG.length);
    expect(p.descr).toBe('una imagen');
    const t = s.shapes.find((e): e is TableEl => e.kind === 'table')!;
    expect(t.rows.length).toBe(2);
    expect(docText(t.rows[0]!.cells[0]!.text!.doc)).toBe('A1');
  });
});

describe('gráficos en .odp', () => {
  it('un gráfico se guarda como objeto de OpenDocument con su imagen de respaldo y se vuelve a leer con sus datos y su formato', async () => {
    const { sampleGrid, specFromGrid } = await import('@suitenova/chart-core');
    const { newChart } = await import('./factory');
    const grid = sampleGrid();
    const spec = specFromGrid('column', grid, { title: 'Ventas', legend: true, legendPos: 'r' });
    spec.series[0]!.color = '#c00000';
    const d0 = newDeck();
    const d = addElements(d0, d0.slides[0]!.id, [newChart(spec, grid, 100, 100, 600, 400)]);
    const out = await writeOdp(d);
    const zip = await JSZip.loadAsync(out.data);
    expect(zip.file('Object 1/content.xml')).toBeTruthy();
    expect(await zip.file('META-INF/manifest.xml')!.async('string')).toContain('application/vnd.oasis.opendocument.chart');
    expect(zip.file('Pictures/chart1.svg')).toBeTruthy();
    const content = await zip.file('content.xml')!.async('string');
    expect(content).toContain('<draw:object xlink:href="./Object 1"');
    expect(out.warnings.join(' ')).not.toContain('Los gráficos no se guardan');
    const back = (await readOdp(out.data)).deck.slides[0]!.shapes.filter((e) => e.kind === 'chart');
    expect(back.length).toBe(1);
    const c = back[0] as import('./types').ChartEl;
    expect(c.chart.type).toBe('column');
    expect(c.chart.title).toBe('Ventas');
    expect(c.chart.legendPos).toBe('r');
    expect(c.chart.series[0]!.color).toBe('#c00000');
    expect(c.grid[1]![1]).toBe(4.3);
    // el respaldo no se importa además como imagen
    expect((await readOdp(out.data)).deck.slides[0]!.shapes.filter((e) => e.kind === 'pic').length).toBe(0);
  });

  it('un gráfico que OpenDocument no tiene (cascada) se guarda como imagen y avisa', async () => {
    const { sampleGrid, specFromGrid } = await import('@suitenova/chart-core');
    const { newChart } = await import('./factory');
    const grid = sampleGrid();
    const d0 = newDeck();
    const d = addElements(d0, d0.slides[0]!.id, [newChart(specFromGrid('waterfall', grid, {}), grid, 0, 0, 400, 300)]);
    const out = await writeOdp(d);
    const zip = await JSZip.loadAsync(out.data);
    expect(zip.file('Object 1/content.xml')).toBeNull();
    expect(zip.file('Pictures/chart1.svg')).toBeTruthy();
    expect(out.warnings.join(' ')).toContain('se guardan como imagen');
  });
});
