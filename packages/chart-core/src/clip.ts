import type { ChartData } from './data';
import { formatChartNumber } from './format';
import { GRID_SHEET, specFromGrid, type ChartGrid } from './grid';
import type { ChartSpec } from './model';

/*
 * Un gráfico en el portapapeles: lo comparten Calc, Slides y Writer. Va como HTML con el gráfico y su rejilla en el atributo
 * `data-nova-chart` (JSON codificado) y una tabla con los datos, de modo que otro programa (Word, Excel, un correo) pega la tabla y
 * Nova pega el gráfico entero, con su formato.
 */

export interface ChartClip {
  chart: ChartSpec;
  grid: ChartGrid;
}

export const CLIP_ATTR = 'data-nova-chart';

/** Los campos de un gráfico de Calc que no son del gráfico (posición, identificador, XML original). */
const NOT_CHART = new Set(['id', 'x', 'y', 'width', 'height', 'rawXml', 'raw']);

export function encodeChartClip(c: ChartClip): string {
  const chart = Object.fromEntries(Object.entries(c.chart).filter(([k]) => !NOT_CHART.has(k)));
  return encodeURIComponent(JSON.stringify({ v: 1, chart, grid: c.grid }));
}

export function decodeChartClip(value: string): ChartClip | null {
  try {
    const o = JSON.parse(decodeURIComponent(value)) as { v?: number; chart?: ChartSpec; grid?: ChartGrid };
    return o && o.v === 1 && o.chart && Array.isArray(o.chart.series) && Array.isArray(o.grid) ? { chart: o.chart, grid: o.grid } : null;
  } catch {
    return null;
  }
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cell = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'number' ? formatChartNumber(v) : String(v));

/** La rejilla como texto con tabuladores (lo que pega una hoja de cálculo). */
export const gridToTsv = (grid: ChartGrid): string => grid.map((row) => row.map(cell).join('\t')).join('\n');

/** El HTML del portapapeles: una tabla con los datos y, en ella, el gráfico para Nova. */
export function chartClipHtml(c: ChartClip): string {
  const rows = c.grid.map((row) => `<tr>${row.map((v) => `<td>${esc(cell(v))}</td>`).join('')}</tr>`).join('');
  return `<table ${CLIP_ATTR}="${encodeChartClip(c)}"><tbody>${rows}</tbody></table>`;
}

/** El gráfico que lleva un trozo de HTML del portapapeles, si lleva uno. */
export function chartFromHtml(html: string | undefined | null): ChartClip | null {
  if (!html) return null;
  const m = new RegExp(`${CLIP_ATTR}=["']([^"']+)["']`).exec(html);
  return m ? decodeChartClip(m[1]!) : null;
}

/**
 * Un gráfico con sus datos propios, para llevarlo a otro documento: la rejilla (categorías en la primera columna, una serie por
 * columna, nombres en la primera fila) con lo que el gráfico dibuja ahora, y el gráfico apuntando a ella. Se conserva el formato.
 */
export function standaloneChart(def: ChartSpec, data: ChartData): ChartClip {
  const rows = Math.max(data.categories.length, ...data.series.map((s) => s.values.length), 0);
  const scatter = def.type === 'scatter';
  const grid: ChartGrid = [['', ...data.series.map((s) => s.name)]];
  for (let i = 0; i < rows; i++) {
    const first = scatter ? (data.series[0]?.x[i] ?? null) : (data.categories[i] ?? '');
    grid.push([first, ...data.series.map((s) => s.values[i] ?? null)]);
  }
  const { series: old, ...all } = def;
  const rest = Object.fromEntries(Object.entries(all).filter(([k]) => !NOT_CHART.has(k)));
  const made = specFromGrid(def.type, grid, rest, GRID_SHEET);
  made.series = made.series.map((s, i) => {
    const { values: _v, categories: _c, nameRef: _n, name: _nm, ...fmt } = old[i] ?? ({ values: '' } as ChartSpec['series'][number]);
    return { ...fmt, ...s };
  });
  return { chart: made, grid };
}
