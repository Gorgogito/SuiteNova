import { describe, expect, it } from 'vitest';
import { chartData, chartExXml, chartXml, dmlParser, gridSource, parseChart, parseChartEx, parseRef, readChartCaches, patchGridWorkbook, readGridWorkbook, refOf, rewriteChartFromGrid, sampleGrid, specFromGrid, writeGridWorkbook, type ChartGrid } from './index';

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

describe('formato de serie y de punto en DrawingML', () => {
  const rt = (spec: ReturnType<typeof specFromGrid>) => {
    const g = sampleGrid();
    const back = parseChart(dmlParser.parse(chartXml(spec, gridSource(g))));
    if (!('def' in back)) throw new Error('skip');
    return back.def;
  };

  it('columnas: relleno con transparencia, borde, color por punto, hueco y superposición', () => {
    const spec = specFromGrid('column', sampleGrid(), {});
    spec.gapWidth = 80;
    spec.overlap = -20;
    spec.series[0]!.color = '#ff0000';
    spec.series[0]!.transparency = 40;
    spec.series[0]!.line = { color: '#00ff00', width: 2, dash: 'dash' };
    spec.series[0]!.points = [{ idx: 1, color: '#0000ff' }];
    spec.series[1]!.noFill = true;
    const back = rt(spec);
    expect(back.gapWidth).toBe(80);
    expect(back.overlap).toBe(-20);
    expect(back.series[0]).toMatchObject({ color: '#ff0000', transparency: 40, line: { color: '#00ff00', width: 2, dash: 'dash' }, points: [{ idx: 1, color: '#0000ff' }] });
    expect(back.series[1]!.noFill).toBe(true);
  });

  it('líneas y dispersión: grosor, guiones y marcadores', () => {
    const spec = specFromGrid('line', sampleGrid(), {});
    spec.series[0]!.color = '#123456';
    spec.series[0]!.line = { width: 4.5, dash: 'dot' };
    spec.series[0]!.marker = { symbol: 'diamond', size: 11, color: '#abcdef' };
    spec.series[1]!.line = { none: true };
    const back = rt(spec);
    expect(back.series[0]).toMatchObject({ color: '#123456', line: { width: 4.5, dash: 'dot' }, marker: { symbol: 'diamond', size: 11, color: '#abcdef' } });
    expect(back.series[1]!.line).toEqual({ none: true });
    const sc = specFromGrid('scatter', sampleGrid(), {});
    sc.series[0]!.color = '#336699';
    sc.series[0]!.marker = { symbol: 'star', size: 9 };
    expect(rt(sc).series[0]).toMatchObject({ color: '#336699', marker: { symbol: 'star', size: 9 } });
  });

  it('circular y anillo: sectores sacados, ángulo del primero y agujero', () => {
    const pie = specFromGrid('pie', sampleGrid(), {});
    pie.firstSliceAng = 90;
    pie.series[0]!.explosion = 10;
    pie.series[0]!.points = [{ idx: 2, color: '#ff00ff', explosion: 30 }];
    const back = rt(pie);
    expect(back.firstSliceAng).toBe(90);
    expect(back.series[0]).toMatchObject({ explosion: 10, points: [{ idx: 2, color: '#ff00ff', explosion: 30 }] });
    const ring = specFromGrid('doughnut', sampleGrid(), {});
    ring.holeSize = 70;
    expect(rt(ring).holeSize).toBe(70);
  });

  it('una serie sin formato no añade nada (el XML de siempre)', () => {
    const back = rt(specFromGrid('column', sampleGrid(), {}));
    expect(back.series[0]!.line).toBeUndefined();
    expect(back.series[0]!.points).toBeUndefined();
    expect(back.gapWidth).toBeUndefined();
  });
});

describe('área del gráfico, área de trazado y fuentes en DrawingML', () => {
  const g = sampleGrid();
  const make = () => {
    const spec = specFromGrid('column', g, { title: 'Ventas', legend: true });
    spec.chartArea = { fill: '#f2f2f2', line: { color: '#123456', width: 2, dash: 'dash' } };
    spec.plotArea = { fill: '#ffffff', transparency: 20 };
    spec.fonts = { chart: { family: 'Arial', size: 10, color: '#404040' }, title: { size: 18, bold: true, color: '#c00000' }, legend: { size: 9, italic: true }, axis: { size: 8 }, axisTitle: { bold: true }, labels: { size: 7, color: '#0000ff' } };
    spec.axisY = { title: 'Euros' };
    spec.series[0]!.labels = { value: true };
    return spec;
  };

  it('las áreas y las fuentes hacen la ida y la vuelta', () => {
    const xml = chartXml(make(), gridSource(g));
    const back = parseChart(dmlParser.parse(xml));
    if (!('def' in back)) throw new Error('skip');
    expect(back.def.chartArea).toMatchObject({ fill: '#f2f2f2', line: { color: '#123456', width: 2, dash: 'dash' } });
    expect(back.def.plotArea).toMatchObject({ fill: '#ffffff', transparency: 20 });
    expect(back.def.fonts?.chart).toEqual({ family: 'Arial', size: 10, color: '#404040' });
    expect(back.def.fonts?.title).toMatchObject({ size: 18, bold: true, color: '#c00000' });
    expect(back.def.fonts?.legend).toMatchObject({ size: 9, italic: true });
    expect(back.def.fonts?.axis).toMatchObject({ size: 8 });
    expect(back.def.fonts?.labels).toMatchObject({ size: 7, color: '#0000ff' });
  });

  it('un gráfico sin formato escribe el título en negrita como siempre y no inventa áreas', () => {
    const plain = chartXml(specFromGrid('column', g, { title: 'Ventas', legend: true }), gridSource(g));
    expect(plain).toContain('<a:defRPr b="1">');
    const back = parseChart(dmlParser.parse(plain));
    if (!('def' in back)) throw new Error('skip');
    expect(back.def.chartArea).toBeUndefined();
    expect(back.def.plotArea).toBeUndefined();
  });

  it('los colores del tema con luminosidad (los grises de Excel) se calculan', () => {
    const xml = chartXml(make(), gridSource(g)).replace('<a:srgbClr val="123456"></a:srgbClr>', '<a:schemeClr val="tx1"><a:lumMod val="15000"/><a:lumOff val="85000"/></a:schemeClr>');
    const back = parseChart(dmlParser.parse(xml));
    if (!('def' in back)) throw new Error('skip');
    expect(back.def.chartArea?.line?.color).toBe('#d9d9d9');
  });
});

describe('fusión con el original de otro programa', () => {
  const g = sampleGrid();
  const base = () => {
    const s = specFromGrid('column', g, { title: 'Ventas', legend: true });
    s.series[0]!.color = '#4472c4';
    return s;
  };
  /** Un original «de otro programa»: lo que Nova escribe más cosas que Nova no modela. */
  const foreign = () => {
    let xml = chartXml(base(), gridSource(g), 'rId1');
    xml = xml.replace('<c:roundedCorners val="0"/>', '<c:date1904 val="0"/><c:lang val="es-ES"/><c:roundedCorners val="0"/><c:style val="2"/>');
    xml = xml.replace('<c:plotArea><c:layout/>', '<c:plotArea><c:layout><c:manualLayout><c:x val="0.1"/><c:y val="0.2"/><c:w val="0.7"/><c:h val="0.6"/></c:manualLayout></c:layout>');
    xml = xml.replace('<c:invertIfNegative val="0"/>', '<c:invertIfNegative val="0"/><c:dPt><c:idx val="2"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/><c:spPr><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs></a:gsLst></a:gradFill></c:spPr></c:dPt>');
    xml = xml.replace('<c:spPr><a:solidFill><a:srgbClr val="4472C4"></a:srgbClr></a:solidFill></c:spPr>', '<c:spPr><a:solidFill><a:srgbClr val="4472C4"></a:srgbClr></a:solidFill><a:effectLst><a:outerShdw blurRad="50800"/></a:effectLst></c:spPr>');
    xml = xml.replace('</c:chartSpace>', '<c:printSettings><c:headerFooter/></c:printSettings><c:extLst><c:ext uri="{X}"/></c:extLst></c:chartSpace>');
    return xml;
  };

  it('sin cambios se escribe el original tal cual', () => {
    const o = foreign();
    expect(rewriteChartFromGrid(o, base(), g)).toBe(o);
  });

  it('con cambios se aplican y se conserva lo que Nova no modela', () => {
    const o = foreign();
    const edited = base();
    edited.legendPos = 'r';
    edited.series[0]!.color = '#ff0000';
    edited.title = 'Otro título';
    const xml = rewriteChartFromGrid(o, edited, g)!;
    expect(xml).toContain('<c:style val="2"/>');
    expect(xml).toContain('<c:manualLayout>');
    expect(xml).toContain('<a:gradFill>'); // el punto que Nova no entiende
    expect(xml).toContain('<c:printSettings>');
    expect(xml).toContain('<c:extLst>');
    expect(xml.indexOf('<c:extLst>')).toBeGreaterThan(xml.indexOf('<c:printSettings>'));
    expect(xml).toContain('<c:legendPos val="r"/>');
    expect(xml).toContain('Otro título');
    expect(xml).toContain('FF0000');
    expect(xml).not.toContain('4472C4"></a:srgbClr></a:solidFill><a:effectLst>'); // el color viejo cambió
    const back = parseChart(dmlParser.parse(xml));
    if (!('def' in back)) throw new Error('skip');
    expect(back.def.title).toBe('Otro título');
    expect(back.def.legendPos).toBe('r');
    expect(back.def.series[0]!.color).toBe('#ff0000');
  });

  it('lo que la persona quita desaparece y los datos nuevos salen en la caché', () => {
    const o = foreign();
    const edited = base();
    edited.title = undefined;
    const g2 = sampleGrid();
    g2[1]![1] = 99;
    const xml = rewriteChartFromGrid(o, edited, g2)!;
    expect(xml).not.toContain('Ventas');
    expect(xml).toContain('<c:v>99</c:v>');
    expect(xml).not.toContain('<c:v>4.3</c:v>');
    expect(xml).toContain('<c:manualLayout>');
  });
});

describe('libro incrustado original', () => {
  it('se parchean solo las celdas que cambian y se añaden las nuevas en su sitio', async () => {
    const before: ChartGrid = [['', 'A', 'B'], ['x', 1, 2], ['y', 3, 4]];
    const after: ChartGrid = [['', 'A', 'B'], ['x', 1, 20], ['y', 3, 4], ['z', 5, 'texto']];
    const book = await writeGridWorkbook(before);
    const patched = await patchGridWorkbook(book, before, after);
    const back = await readGridWorkbook(patched);
    expect(back[1]).toEqual(['x', 1, 20]);
    expect(back[2]).toEqual(['y', 3, 4]);
    expect(back[3]).toEqual(['z', 5, 'texto']);
    // sin cambios, los mismos bytes
    expect(await patchGridWorkbook(book, before, before)).toBe(book);
  });

  it('las referencias de la rejilla usan el nombre de hoja del original', () => {
    const s = specFromGrid('column', sampleGrid(), {}, 'Hoja1');
    expect(s.series[0]!.values).toBe('Hoja1!$B$2:$B$5');
    expect(s.series[0]!.nameRef).toBe('Hoja1!$B$1');
  });
});

describe('fusión: elementos de los que el esquema permite uno solo', () => {
  it('un color nuevo sustituye al del tema del original (no quedan dos colores en el relleno)', () => {
    const g = sampleGrid();
    const spec = specFromGrid('column', g, {});
    spec.series[0]!.color = '#4472c4';
    const o = chartXml(spec, gridSource(g), 'rId1').replace('<a:srgbClr val="4472C4"></a:srgbClr>', '<a:schemeClr val="accent1"/>');
    const edited = specFromGrid('column', g, {});
    edited.series[0]!.color = '#c00000';
    const xml = rewriteChartFromGrid(o, edited, g)!;
    expect(xml).toContain('C00000');
    expect(xml).not.toContain('accent1');
    expect(xml.match(/<a:solidFill>/g)!.length).toBe(o.match(/<a:solidFill>/g)!.length);
  });

  it('un degradado del original no se queda junto al relleno nuevo', () => {
    const g = sampleGrid();
    const spec = specFromGrid('column', g, {});
    const o = chartXml(spec, gridSource(g), 'rId1').replace('<c:invertIfNegative val="0"/>', '<c:spPr><a:gradFill><a:gsLst/></a:gradFill></c:spPr><c:invertIfNegative val="0"/>');
    const edited = specFromGrid('column', g, {});
    edited.series[0]!.color = '#00b050';
    const xml = rewriteChartFromGrid(o, edited, g)!;
    expect(xml).toContain('00B050');
    expect(xml).not.toContain('gradFill');
  });
});

describe('fusión: ejes con otros identificadores', () => {
  it('los ejes del original (con sus propios axId) se fusionan por posición y no se duplican', () => {
    const g = sampleGrid();
    const spec = specFromGrid('column', g, {});
    const o = chartXml(spec, gridSource(g), 'rId1').replace(/val="111"/g, 'val="500111"').replace(/val="222"/g, 'val="500222"');
    const edited = specFromGrid('column', g, {});
    edited.axisY = { title: 'Euros' };
    edited.legend = true;
    const xml = rewriteChartFromGrid(o, edited, g)!;
    expect(xml.match(/<c:catAx>/g)!.length).toBe(1);
    expect(xml.match(/<c:valAx>/g)!.length).toBe(1);
    expect(xml).toContain('Euros');
    expect(xml).toContain('500111');
    expect(xml).not.toContain('val="111"');
  });
});

describe('series sin nombre en el archivo', () => {
  it('reciben «Serie n» en la cabecera de su columna y la rejilla queda completa', async () => {
    const { readChartPart } = await import('./index');
    const g = sampleGrid();
    const spec = specFromGrid('column', g, {});
    for (const s of spec.series) delete s.nameRef;
    const read = readChartPart(chartXml(spec, gridSource(g)));
    if ('skip' in read) throw new Error('skip');
    expect(read.grid[0]!.slice(1)).toEqual(['Serie 1', 'Serie 2']);
    expect(read.spec.series[0]!.nameRef).toBe('Sheet1!$B$1');
  });
});
