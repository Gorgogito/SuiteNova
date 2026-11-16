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

describe('gráficos de Office 2016 sin fórmulas (PowerPoint y Word)', () => {
  it('los datos guardados dentro del gráfico reciben referencias propias y salen como rejilla', () => {
    const xml = '<cx:chartSpace xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex"><cx:chartData><cx:data id="0"><cx:strDim type="cat"><cx:lvl ptCount="3"><cx:pt idx="0">a</cx:pt><cx:pt idx="1">b</cx:pt><cx:pt idx="2">c</cx:pt></cx:lvl></cx:strDim><cx:numDim type="val"><cx:lvl ptCount="3" formatCode="General"><cx:pt idx="0">5</cx:pt><cx:pt idx="1">-2</cx:pt><cx:pt idx="2">7</cx:pt></cx:lvl></cx:numDim></cx:data></cx:chartData><cx:chart><cx:plotArea><cx:plotAreaRegion><cx:series layoutId="waterfall"><cx:dataId val="0"/></cx:series></cx:plotAreaRegion></cx:plotArea></cx:chart></cx:chartSpace>';
    const doc = dmlParser.parse(xml);
    const r = parseChartEx(doc);
    if (!('def' in r)) throw new Error('skip');
    expect(r.def.series[0]!.values).toBe('Sheet1!$B$2:$B$4');
    expect(r.literals?.get('Sheet1!$B$2:$B$4')).toEqual([5, -2, 7]);
    expect(r.literals?.get('Sheet1!$A$2:$A$4')).toEqual(['a', 'b', 'c']);
  });
});

describe('elementos del gráfico en DrawingML', () => {
  it('leyenda, etiquetas, cuadrículas menores, ejes ocultos y tabla de datos hacen la ida y la vuelta', () => {
    const g = sampleGrid();
    const base = specFromGrid('column', g, { title: 'Ventas' });
    base.legendPos = 'r';
    base.axisY = { title: 'Euros', minorGridlines: true, gridlines: true };
    base.axisX = { title: 'Mes', hidden: true };
    base.dataTable = { keys: true };
    base.series[0]!.labels = { value: true, category: true, pos: 'inEnd', separator: ' / ', format: '0.0' };
    base.series[1]!.labels = { value: true };
    const xml = chartXml(base, gridSource(g));
    expect(xml).toContain('<c:legendPos val="r"/>');
    expect(xml).toContain('<c:minorGridlines>');
    expect(xml).toContain('<c:dTable>');
    expect(xml).toContain('<c:dLblPos val="inEnd"/>');
    const back = parseChart(dmlParser.parse(xml));
    if (!('def' in back)) throw new Error('skip');
    expect(back.def.legendPos).toBe('r');
    expect(back.def.dataTable).toEqual({ keys: true });
    expect(back.def.axisY).toMatchObject({ title: 'Euros', minorGridlines: true, gridlines: true });
    expect(back.def.axisX).toMatchObject({ title: 'Mes', hidden: true });
    expect(back.def.series[0]!.labels).toEqual({ value: true, category: true, pos: 'inEnd', separator: ' / ', format: '0.0' });
    expect(back.def.series[1]!.labels).toEqual({ value: true });
  });

  it('una posición de etiqueta que Excel no admite se omite (si no, Excel rechaza el archivo)', () => {
    const g = sampleGrid();
    const area = specFromGrid('area', g, {});
    area.series[0]!.labels = { value: true, pos: 'outEnd' };
    expect(chartXml(area, gridSource(g))).not.toContain('<c:dLblPos');
    const stacked = specFromGrid('column', g, { stacked: true });
    stacked.series[0]!.labels = { value: true, pos: 'outEnd' };
    expect(chartXml(stacked, gridSource(g))).not.toContain('<c:dLblPos');
  });
});
