import { describe, expect, it } from 'vitest';
import { sampleGrid, specFromGrid, type ChartSpec } from '@suitenova/chart-core';
import { CHART_ELEMENTS, ELEMENT_GROUPS, applyElement } from './elements';

const col = (): ChartSpec => specFromGrid('column', sampleGrid(), { title: 'Ventas', legend: true });
const by = (c: ChartSpec, id: string) => CHART_ELEMENTS.find((e) => e.id === id)!.checked(c);

describe('elementos del gráfico', () => {
  it('el menú tiene los mismos grupos que Office', () => {
    expect(ELEMENT_GROUPS).toEqual(['Título del gráfico', 'Títulos de los ejes', 'Ejes', 'Cuadrícula', 'Etiquetas de datos', 'Leyenda', 'Tabla de datos']);
  });

  it('títulos de ejes y ejes: se activan y se desactivan', () => {
    let c = applyElement(col(), 'axisTitleV');
    expect(c.axisY?.title).toBe('Título del eje');
    expect(by(c, 'axisTitleV')).toBe(true);
    c = applyElement(c, 'axisTitleV');
    expect(c.axisY).toBeUndefined();
    c = applyElement(col(), 'axisH');
    expect(c.axisX?.hidden).toBe(true);
    expect(by(c, 'axisH')).toBe(false);
  });

  it('en barras horizontales «horizontal» es el eje de valores', () => {
    const bar = specFromGrid('bar', sampleGrid(), { legend: true });
    const c = applyElement(bar, 'axisTitleH');
    expect(c.axisY?.title).toBe('Título del eje');
    expect(applyElement(bar, 'gridMajorH').axisX?.gridlines).toBe(true);
  });

  it('cuadrículas: la principal horizontal está activa de partida y la secundaria no', () => {
    const c = col();
    expect(by(c, 'gridMajorH')).toBe(true);
    expect(by(c, 'gridMajorV')).toBe(false);
    expect(applyElement(c, 'gridMajorH').axisY?.gridlines).toBe(false);
    expect(applyElement(c, 'gridMinorH').axisY?.minorGridlines).toBe(true);
  });

  it('etiquetas de datos: mostrar, posición, nombre de categoría; solo las posiciones que admite el tipo', () => {
    let c = applyElement(col(), 'labelsShow');
    expect(c.series.every((s) => s.labels?.value)).toBe(true);
    c = applyElement(c, 'labels.outEnd');
    expect(c.series[0]!.labels).toEqual({ value: true, pos: 'outEnd' });
    c = applyElement(c, 'labelsCategory');
    expect(c.series[1]!.labels?.category).toBe(true);
    expect(by(c, 'labels.outEnd')).toBe(true);
    // apiladas: no hay «exterior final»; líneas: arriba, abajo, izquierda y derecha
    const stacked = { ...col(), stacked: true };
    expect(applyElement(stacked, 'labels.outEnd')).toBe(stacked);
    expect(applyElement(specFromGrid('line', sampleGrid(), { legend: true }), 'labels.t').series[0]!.labels?.pos).toBe('t');
    expect(applyElement(c, 'labelsNone').series.some((s) => s.labels)).toBe(false);
    const pie = specFromGrid('pie', sampleGrid(), { legend: true });
    expect(applyElement(applyElement(pie, 'labelsShow'), 'labelsPercent').series[0]!.labels?.percent).toBe(true);
    expect(applyElement(col(), 'labelsPercent').series[0]!.labels).toBeUndefined();
  });

  it('leyenda en cuatro sitios, y ninguna', () => {
    expect(applyElement(col(), 'legend.r')).toMatchObject({ legend: true, legendPos: 'r' });
    expect(applyElement(applyElement(col(), 'legend.r'), 'legend.b').legendPos).toBeUndefined();
    expect(applyElement(col(), 'legendNone').legend).toBe(false);
  });

  it('la tabla de datos solo en columnas, líneas y áreas', () => {
    expect(applyElement(col(), 'tableShow').dataTable).toEqual({ keys: true });
    expect(applyElement(col(), 'tablePlain').dataTable).toEqual({});
    const pie = specFromGrid('pie', sampleGrid(), { legend: true });
    expect(applyElement(pie, 'tableShow')).toBe(pie);
  });
});
