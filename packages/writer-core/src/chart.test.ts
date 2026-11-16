import JSZip from 'jszip';
import type { Node as PMNode } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { sampleGrid, specFromGrid, type ChartType } from '@suitenova/chart-core';
import { DEFAULT_DOC_DEFAULTS, defaultSection, emptyWriterDoc, makeSection, nodeTypes, readDocx, writeDocx, writerSchema, type WriterDoc } from './index';

const t = (text: string) => writerSchema.text(text);
const chart = (type: ChartType, extra: Record<string, unknown> = {}): PMNode => {
  const grid = sampleGrid();
  return nodeTypes.chart!.create({ width: 480, height: 288, chart: specFromGrid(type, grid, { title: 'Ventas' }), grid, ...extra });
};
const doc = (...kids: PMNode[]): WriterDoc => ({
  ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }),
  body: nodeTypes.doc!.create(null, [makeSection([nodeTypes.paragraph!.create(null, [t('Antes '), ...kids, t(' después')])], defaultSection())]),
});
const charts = (d: PMNode): PMNode[] => {
  const out: PMNode[] = [];
  d.descendants((n) => void (n.type.name === 'chart' && out.push(n)));
  return out;
};
const write = async (d: WriterDoc) => ((await writeDocx(d)) as { data: Uint8Array }).data;

describe('gráficos en Writer', () => {
  it('es un átomo en línea con el dibujo como imagen', () => {
    const n = chart('column');
    expect(n.isAtom).toBe(true);
    const dom = writerSchema.nodes.chart!.spec.toDOM!(n) as unknown as [string, Record<string, string>, [string, Record<string, string>]];
    expect(dom[1].class).toBe('nw-chart');
    expect(dom[2][1].src?.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('se guarda con la parte, el libro incrustado y las relaciones, y se vuelve a leer con su rejilla', async () => {
    const zip = await JSZip.loadAsync(await write(doc(chart('column'))));
    expect(zip.file('word/charts/chart1.xml')).toBeTruthy();
    expect(zip.file('word/embeddings/Microsoft_Excel_Sheet1.xlsx')).toBeTruthy();
    expect(await zip.file('word/charts/_rels/chart1.xml.rels')!.async('string')).toContain('relationships/package');
    expect(await zip.file('word/charts/chart1.xml')!.async('string')).toContain('<c:externalData');
    const types = await zip.file('[Content_Types].xml')!.async('string');
    expect(types).toContain('drawingml.chart+xml');
    expect(types).toContain('Extension="xlsx"');
    expect(await zip.file('word/_rels/document.xml.rels')!.async('string')).toContain('relationships/chart"');
    expect(await zip.file('word/document.xml')!.async('string')).toMatch(/<c:chart [^>]*r:id="rId\d+"/);
    const back = charts((await readDocx(await write(doc(chart('column'))))).doc.body);
    expect(back.length).toBe(1);
    expect(back[0]!.attrs.chart.type).toBe('column');
    expect(back[0]!.attrs.chart.title).toBe('Ventas');
    expect(back[0]!.attrs.grid[1][1]).toBe(4.3);
  });

  it('cada tipo clásico sobrevive, también con ajuste de texto, y dos gráficos no se pisan', async () => {
    for (const ty of ['bar', 'line', 'pie', 'scatter', 'radar'] as ChartType[]) {
      const back = charts((await readDocx(await write(doc(chart(ty, { wrap: 'right' }))))).doc.body);
      expect(back[0]!.attrs.chart.type, ty).toBe(ty);
      expect(back[0]!.attrs.wrap, ty).toBe('right');
    }
    const two = charts((await readDocx(await write(doc(chart('column'), chart('pie'))))).doc.body);
    expect(two.map((n) => n.attrs.chart.type)).toEqual(['column', 'pie']);
  });

  it('un gráfico de Office 2016 (cascada) lleva estilo, colores y alternativa', async () => {
    const data = await write(doc(chart('waterfall')));
    const zip = await JSZip.loadAsync(data);
    for (const f of ['chartEx1', 'style1', 'colors1']) expect(zip.file(`word/charts/${f}.xml`), f).toBeTruthy();
    const body = await zip.file('word/document.xml')!.async('string');
    expect(body).toContain('mc:AlternateContent');
    expect(body).toContain('xmlns:cx1=');
    const back = charts((await readDocx(data)).doc.body);
    expect(back[0]!.attrs.chart.type).toBe('waterfall');
    expect(back[0]!.attrs.grid[2][1]).toBe(2.5);
  });
});
