import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { sampleGrid, specFromGrid, type ChartType } from '@suitenova/chart-core';
import { newDeck } from './defaults';
import { newChart } from './factory';
import { addElements } from './ops';
import { readPptx } from './pptx/read';
import { writePptx } from './pptx/write';
import type { ChartEl } from './types';

const roundTrip = async (type: ChartType, extra = {}) => {
  const grid = sampleGrid();
  const el = newChart(specFromGrid(type, grid, { title: 'Ventas', ...extra }), grid, 100, 100, 600, 400);
  const d0 = newDeck();
  const d = addElements(d0, d0.slides[0]!.id, [el]);
  const data = (await writePptx(d)).data;
  const back = await readPptx(data);
  return { data, chart: back.deck.slides[0]!.shapes.find((e): e is ChartEl => e.kind === 'chart')!, warnings: back.warnings };
};

describe('charts in .pptx', () => {
  it('a new chart is saved with its cache and its embedded workbook, and read back with the same grid', async () => {
    const { data, chart } = await roundTrip('column');
    expect(chart.chart.type).toBe('column');
    expect(chart.chart.title).toBe('Ventas');
    expect(chart.chart.series.length).toBe(2);
    expect(chart.grid[1]![0]).toBe('Categoría 1');
    expect(chart.grid[1]![1]).toBe(4.3);
    const zip = await JSZip.loadAsync(data);
    expect(Object.keys(zip.files).some((f) => /^ppt\/embeddings\/.+\.xlsx$/.test(f))).toBe(true);
    const types = await zip.file('[Content_Types].xml')!.async('string');
    expect(types).toContain('Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"');
    const rels = Object.keys(zip.files).find((f) => /charts\/_rels\/chart\d+\.xml\.rels$/.test(f))!;
    expect(await zip.file(rels)!.async('string')).toContain('relationships/package');
    const xml = await zip.file(Object.keys(zip.files).find((f) => /charts\/chart\d+\.xml$/.test(f))!)!.async('string');
    expect(xml).toContain('<c:externalData');
  });

  it('every type of the shared engine survives a save', async () => {
    for (const t of ['bar', 'line', 'area', 'pie', 'doughnut', 'radar', 'scatter'] as ChartType[]) {
      const { chart } = await roundTrip(t);
      expect(chart.chart.type, t).toBe(t);
      expect(chart.chart.series.length, t).toBeGreaterThan(0);
    }
  });

  it('Office 2016 charts (waterfall) are written with style, colors and a fallback, and read back', async () => {
    const { data, chart } = await roundTrip('waterfall');
    expect(chart.chart.type).toBe('waterfall');
    expect(chart.grid[2]![1]).toBe(2.5);
    const zip = await JSZip.loadAsync(data);
    const names = Object.keys(zip.files);
    expect(names.some((f) => /charts\/chartEx\d*\.xml$/.test(f))).toBe(true);
    expect(names.some((f) => /charts\/style\d*\.xml$/.test(f))).toBe(true);
    expect(names.some((f) => /charts\/colors\d*\.xml$/.test(f))).toBe(true);
    const types = await zip.file('[Content_Types].xml')!.async('string');
    expect(types).toContain('application/vnd.ms-office.chartex+xml');
    const slide = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(slide).toContain('mc:Fallback');
  });

  it('a chart that was read is written back untouched until it is edited', async () => {
    const { data } = await roundTrip('column');
    const once = (await readPptx(data)).deck;
    const again = await JSZip.loadAsync((await writePptx(once)).data);
    const a = await (await JSZip.loadAsync(data)).file(Object.keys((await JSZip.loadAsync(data)).files).find((f) => /charts\/chart\d+\.xml$/.test(f))!)!.async('string');
    const b = await again.file(Object.keys(again.files).find((f) => /charts\/chart\d+\.xml$/.test(f))!)!.async('string');
    expect(b).toBe(a);
  });
});
