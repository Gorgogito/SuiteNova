import { describe, expect, it } from 'vitest';
import { odfChartXml, odfSupports, parseOdfChart, sampleGrid, specFromGrid, type ChartGrid, type ChartSpec } from './index';

const roundTrip = (spec: ChartSpec, grid: ChartGrid = sampleGrid()) => {
  const xml = odfChartXml(spec, grid, { w: 480, h: 288 });
  if (!xml) throw new Error('no se puede guardar');
  const back = parseOdfChart(xml);
  if (!('spec' in back)) throw new Error(back.skip);
  return { xml, ...back };
};

describe('gráficos de OpenDocument', () => {
  it('columnas con título, leyenda, ejes, cuadrícula y datos hacen la ida y la vuelta', () => {
    const g = sampleGrid();
    const spec = specFromGrid('column', g, { title: 'Ventas', legend: true, legendPos: 'r' });
    spec.axisY = { title: 'Euros', gridlines: true, minorGridlines: true };
    spec.axisX = { title: 'Mes' };
    spec.stacked = true;
    spec.gapWidth = 80;
    const { xml, spec: back, grid } = roundTrip(spec, g);
    expect(xml).toContain('chart:class="chart:bar"');
    expect(xml).toContain('<table:table table:name="local-table">');
    expect(back.type).toBe('column');
    expect(back.title).toBe('Ventas');
    expect(back.legendPos).toBe('r');
    expect(back.stacked).toBe(true);
    expect(back.gapWidth).toBe(80);
    expect(back.axisY).toMatchObject({ title: 'Euros', gridlines: true, minorGridlines: true });
    expect(back.axisX).toMatchObject({ title: 'Mes' });
    expect(back.series.length).toBe(2);
    expect(grid[1]).toEqual(['Categoría 1', 4.3, 2.4]);
    expect(back.series[0]!.values).toBe('Sheet1!$B$2:$B$5');
    expect(back.series[0]!.categories).toBe('Sheet1!$A$2:$A$5');
    expect(back.series[0]!.nameRef).toBe('Sheet1!$B$1');
  });

  it('formato de serie: relleno, transparencia, borde, etiquetas y color de un punto', () => {
    const spec = specFromGrid('column', sampleGrid(), { legend: true });
    spec.series[0]!.color = '#c00000';
    spec.series[0]!.transparency = 30;
    spec.series[0]!.line = { color: '#002060', width: 2 };
    spec.series[0]!.labels = { value: true, category: true };
    spec.series[0]!.points = [{ idx: 2, color: '#00b050' }];
    spec.chartArea = { fill: '#f2f2f2', line: { color: '#123456', width: 1.5 } };
    spec.plotArea = { fill: '#ffffcc' };
    spec.fonts = { chart: { size: 10, color: '#404040' }, title: { size: 18, bold: true } };
    spec.title = 'T';
    const { spec: back } = roundTrip(spec);
    expect(back.series[0]).toMatchObject({ color: '#c00000', transparency: 30, line: { color: '#002060', width: 2 }, labels: { value: true, category: true }, points: [{ idx: 2, color: '#00b050' }] });
    expect(back.chartArea).toMatchObject({ fill: '#f2f2f2', line: { color: '#123456', width: 1.5 } });
    expect(back.plotArea).toMatchObject({ fill: '#ffffcc' });
    expect(back.fonts?.chart).toMatchObject({ size: 10, color: '#404040' });
    expect(back.fonts?.title).toMatchObject({ size: 18, bold: true });
  });

  it('líneas con marcadores, circular con sectores, dispersión, áreas, radar y barras horizontales', () => {
    const line = specFromGrid('line', sampleGrid(), { smooth: true });
    line.series[0]!.color = '#123456';
    line.series[0]!.marker = { symbol: 'diamond', size: 10 };
    const l = roundTrip(line).spec;
    expect(l.type).toBe('line');
    expect(l.smooth).toBe(true);
    expect(l.series[0]).toMatchObject({ color: '#123456', marker: { symbol: 'diamond', size: 10 } });

    const pie = specFromGrid('pie', sampleGrid(), { legend: true, firstSliceAng: 90 });
    pie.series = [{ ...pie.series[0]!, points: [{ idx: 1, color: '#ffc000', explosion: 25 }], labels: { percent: true } }];
    const p = roundTrip(pie).spec;
    expect(p.type).toBe('pie');
    expect(p.firstSliceAng).toBe(90);
    expect(p.series[0]).toMatchObject({ points: [{ idx: 1, color: '#ffc000', explosion: 25 }], labels: { percent: true } });
    expect(roundTrip(specFromGrid('doughnut', sampleGrid(), {})).spec.type).toBe('doughnut');

    const grid: ChartGrid = [['x', 'y'], [1, 2], [2, 4], [3, 5]];
    const sc = roundTrip(specFromGrid('scatter', grid, {}), grid);
    expect(sc.spec.type).toBe('scatter');
    expect(sc.spec.series[0]!.categories).toBe('Sheet1!$A$2:$A$4');

    expect(roundTrip(specFromGrid('area', sampleGrid(), {})).spec.type).toBe('area');
    expect(roundTrip(specFromGrid('radar', sampleGrid(), {})).spec.type).toBe('radar');
    expect(roundTrip(specFromGrid('bar', sampleGrid(), {})).spec.type).toBe('bar');
  });

  it('lo que OpenDocument no tiene se guarda como imagen (no hay objeto)', () => {
    expect(odfSupports(specFromGrid('waterfall', sampleGrid(), {}))).toBe(false);
    expect(odfChartXml(specFromGrid('waterfall', sampleGrid(), {}), sampleGrid(), { w: 100, h: 100 })).toBeNull();
    expect(odfSupports({ ...specFromGrid('column', sampleGrid(), {}), threeD: { rotX: 15, rotY: 20, perspective: 30, depth: 100, rightAngle: true } })).toBe(false);
    expect(parseOdfChart('<a/>')).toMatchObject({ skip: expect.any(String) });
  });
});

describe('ODF: XML bien formado', () => {
  it('todos los tipos que se guardan dan un XML válido, con los espacios de nombres declarados y sin atributos repetidos', async () => {
    const { XMLValidator } = await import('fast-xml-parser');
    const specs: ChartSpec[] = [
      { ...specFromGrid('column', sampleGrid(), { title: 'A & B <c>', legend: true }), stacked: true },
      specFromGrid('bar', sampleGrid(), {}),
      specFromGrid('line', sampleGrid(), { smooth: true }),
      specFromGrid('area', sampleGrid(), {}),
      specFromGrid('pie', sampleGrid(), {}),
      specFromGrid('doughnut', sampleGrid(), {}),
      specFromGrid('radar', sampleGrid(), {}),
    ];
    for (const s of specs) {
      s.series[0]!.labels = { value: true };
      s.series[0]!.points = [{ idx: 0, color: '#ff0000' }, { idx: 2, color: '#00ff00' }];
      const xml = odfChartXml(s, sampleGrid(), { w: 400, h: 300 })!;
      expect(XMLValidator.validate(xml), s.type).toBe(true);
      for (const prefix of ['office', 'style', 'text', 'table', 'draw', 'fo', 'xlink', 'chart', 'svg']) {
        if (new RegExp(`[<\\s/]${prefix}:`).test(xml)) expect(xml, `${s.type} ${prefix}`).toContain(`xmlns:${prefix}=`);
      }
      // los estilos que se usan existen
      for (const m of xml.matchAll(/(?:chart|draw):style-name="([^"]+)"/g)) expect(xml, s.type).toContain(`style:name="${m[1]}"`);
    }
  });
});
