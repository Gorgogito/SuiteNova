import { formatChartNumber } from './format';
import type { ChartSpec, ChartType } from './model';
import type { ChartCell, ChartSource, RangeRead } from './source';

/*
 * La rejilla de datos de un gráfico de Slides o de Writer: una hoja pequeña («Hoja1») con las categorías en la primera columna, los
 * nombres de las series en la primera fila y los valores debajo, como la hoja que Office incrusta en esos gráficos.
 */

export type ChartGrid = ChartCell[][];

export const GRID_SHEET = 'Sheet1';

const colName = (c: number): string => {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const colIndex = (name: string): number => [...name].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export interface CellRect {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/** «Hoja1!$B$2:$B$5» o «B2:B5» (sin hoja) como rectángulo y nombre de hoja. */
export function parseRef(ref: string): { sheet?: string; rect: CellRect } | null {
  const m = /^(?:'((?:[^']|'')+)'|([^'!]+))?!?\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(ref.trim().replace(/^=/, '').replace(/^(?=[^!]*$)/, '!'));
  if (!m) return null;
  const sheet = (m[1] ?? m[2])?.replace(/''/g, "'");
  const c1 = colIndex(m[3]!.toUpperCase());
  const r1 = Number(m[4]) - 1;
  const c2 = m[5] ? colIndex(m[5].toUpperCase()) : c1;
  const r2 = m[6] ? Number(m[6]) - 1 : r1;
  return { sheet: sheet || undefined, rect: { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) } };
}

/** La referencia de un rectángulo de la rejilla: «Sheet1!$B$2:$B$5». */
export function refOf(r: CellRect, sheet = GRID_SHEET): string {
  const a = `$${colName(r.c1)}$${r.r1 + 1}`;
  const b = `$${colName(r.c2)}$${r.r2 + 1}`;
  return `${sheet}!${a === b ? a : `${a}:${b}`}`;
}

const text = (v: ChartCell | undefined): string => (v === undefined || v === null ? '' : typeof v === 'number' ? formatChartNumber(v) : String(v));

/** La fuente de datos de una rejilla (el nombre de la hoja de la referencia no se comprueba: el gráfico solo tiene una). */
export function gridSource(grid: ChartGrid): ChartSource {
  return {
    range(ref: string | undefined): RangeRead {
      const p = ref ? parseRef(ref) : null;
      if (!p) return { values: [], labels: [] };
      const values: ChartCell[] = [];
      const labels: string[] = [];
      for (let r = p.rect.r1; r <= p.rect.r2; r++)
        for (let c = p.rect.c1; c <= p.rect.c2; c++) {
          const v = grid[r]?.[c] ?? null;
          values.push(v);
          labels.push(text(v));
        }
      return { values, labels };
    },
  };
}

/** Una rejilla de ejemplo (3 categorías, 2 series) para un gráfico nuevo. */
export const sampleGrid = (): ChartGrid => [
  ['', 'Serie 1', 'Serie 2'],
  ['Categoría 1', 4.3, 2.4],
  ['Categoría 2', 2.5, 4.4],
  ['Categoría 3', 3.5, 1.8],
  ['Categoría 4', 4.5, 2.8],
];

/**
 * Las series de un gráfico a partir de su rejilla: una por columna (desde la segunda), con su nombre en la primera fila y las
 * categorías en la primera columna. En dispersión, la primera columna son los valores X.
 */
export function specFromGrid(type: ChartType, grid: ChartGrid, base: Partial<ChartSpec> = {}): ChartSpec {
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  const series: ChartSpec['series'] = [];
  for (let c = 1; c < cols; c++) {
    series.push({
      nameRef: refOf({ r1: 0, c1: c, r2: 0, c2: c }),
      categories: rows > 1 ? refOf({ r1: 1, c1: 0, r2: rows - 1, c2: 0 }) : undefined,
      values: refOf({ r1: 1, c1: c, r2: Math.max(1, rows - 1), c2: c }),
    });
  }
  return { legend: true, ...base, type, series };
}
