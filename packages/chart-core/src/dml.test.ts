import { describe, expect, it } from 'vitest';
import { chartData, chartExXml, chartXml, dmlParser, gridSource, parseChart, parseChartEx, parseRef, readChartCaches, readGridWorkbook, refOf, sampleGrid, specFromGrid, writeGridWorkbook, type ChartGrid } from './index';

const grid: ChartGrid = sampleGrid();

describe('rejilla de datos', () => {
  it('lee y escribe referencias de rango', () => {
    expect(parseRef("Sheet1!$B$2:$B$5")).toEqual({ sheet: 'Sheet1', rect: { r1: 1, c1: 1, r2: 4, c2: 1 } });
    expect(parseRef("'Mi hoja'!A1")).toEqual({ sheet: 'Mi hoja', rect: { r1: 0, c1: 0, r2: 0, c2: 0 } });
    expect(parseRef('C3:D4')?.rect).toEqual({ r1: 2, c1: 2, r2: 3, c2: 3 });
    expect(parseRef('nada')).toBeNull();
    expect(refOf({ r1: 1, c1: 1, r2: 4, c2: 1 })).toBe('Sheet1!$B$2:$B$5');
    expect(refOf({ r1: 0, c1: 2, r2: 0, c2: 2 })).toBe('Sheet1!$C$1');
  });

  it('las series salen de las columnas y los datos de la rejilla', () => {
    const spec = specFromGrid('column', grid, { title: 'Prueba' });
    expect(spec.series).toHaveLength(2);
    expect(spec.series[0]).toMatchObject({ nameRef: 'Sheet1!$B$1', categories: 'Sheet1!$A$2:$A$5', values: 'Sheet1!$B$2:$B$5' });
    const d = chartData(spec, gridSource(grid), 'es');
    expect(d.categories).toEqual(['Categoría 1', 'Categoría 2', 'Categoría 3', 'Categoría 4']);
    expect(d.series.map((s) => s.name)).toEqual(['Serie 1', 'Serie 2']);
    expect(d.series[0]!.values).toEqual([4.3, 2.5, 3.5, 4.5]);
  });
});

describe('c:chartSpace con caché', () => {
  const spec = specFromGrid('line', grid, { title: 'Ventas', smooth: true });
  const xml = chartXml(spec, gridSource(grid));

  it('escribe las referencias y sus valores en caché', () => {
    expect(xml).toContain('<c:f>Sheet1!$B$2:$B$5</c:f>');
    expect(xml).toContain('<c:numCache>');
    expect(xml).toContain('<c:v>4.3</c:v>');
    expect(xml).toContain('<c:v>Categoría 2</c:v>');
  });

  it('vuelve a leerse con el mismo tipo, título y series', () => {
    const back = parseChart(dmlParser.parse(xml));
    expect('def' in back).toBe(true);
    if (!('def' in back)) return;
    expect(back.def).toMatchObject({ type: 'line', title: 'Ventas', smooth: true, legend: true });
    expect(back.def.series.map((s) => s.values)).toEqual(['Sheet1!$B$2:$B$5', 'Sheet1!$C$2:$C$5']);
  });

  it('la caché reconstruye los datos sin el libro', () => {
    const caches = readChartCaches(dmlParser.parse(xml).chartSpace);
    expect(caches.get('Sheet1!$B$2:$B$5')).toEqual([4.3, 2.5, 3.5, 4.5]);
    expect(caches.get('Sheet1!$A$2:$A$5')).toEqual(['Categoría 1', 'Categoría 2', 'Categoría 3', 'Categoría 4']);
    expect(caches.get('Sheet1!$C$1')).toEqual(['Serie 2']);
  });

  it('los gráficos de Office 2016 (cascada) también llevan su caché', () => {
    const wf = specFromGrid('waterfall', grid);
    const ex = chartExXml(wf, gridSource(grid));
    const doc = dmlParser.parse(ex);
    const back = parseChartEx(doc);
    expect('def' in back && back.def.type).toBe('waterfall');
    expect(readChartCaches(doc.chartSpace).get('Sheet1!$B$2:$B$5')).toEqual([4.3, 2.5, 3.5, 4.5]);
  });
});

describe('libro mínimo incrustado', () => {
  it('se escribe y se vuelve a leer igual', async () => {
    const g: ChartGrid = [['', 'A', 'B'], ['x', 1, 2.5], ['y & <z>', null, 'texto']];
    const back = await readGridWorkbook(await writeGridWorkbook(g));
    expect(back[0]).toEqual([null, 'A', 'B'].map((v) => v ?? '').map((v) => (v === '' ? null : v)));
    expect(back[1]).toEqual(['x', 1, 2.5]);
    expect(back[2]!.slice(0, 1)).toEqual(['y & <z>']);
    expect(back[2]![2]).toBe('texto');
  });
});
