import { formatChartNumber, specFromGrid, type ChartCell, type ChartGrid, type ChartSpec } from '@suitenova/chart-core';
import { applyPreset, presetById, presetOf } from './presets';

/*
 * El borrador de un gráfico de Slides o de Writer mientras se edita en el cuadro: el tipo (un ajuste de `presets`), el título, la
 * leyenda y la rejilla de datos como texto (lo que escribe la persona, sin interpretar). `buildChart` lo convierte en gráfico.
 */

export interface ChartDraft {
  preset: string;
  title: string;
  legend: boolean;
  cells: string[][];
}

const text = (v: ChartCell | undefined): string => (v === undefined || v === null ? '' : typeof v === 'number' ? formatChartNumber(v) : String(v));

/** El texto de una rejilla, con al menos una fila de datos y una serie. */
export function gridToCells(grid: ChartGrid): string[][] {
  const cols = Math.max(2, ...grid.map((r) => r.length));
  const rows = Math.max(2, grid.length);
  return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => text(grid[r]?.[c])));
}

/** La rejilla de un texto: la primera fila son nombres; en las demás, lo que parece un número es un número. */
export function cellsToGrid(cells: string[][]): ChartGrid {
  return cells.map((row, r) =>
    row.map((s): ChartCell => {
      const v = s.trim();
      if (v === '') return null;
      if (r === 0) return s;
      const n = Number(v.replace(',', '.'));
      return Number.isFinite(n) ? n : s;
    }),
  );
}

export function draftOf(spec: ChartSpec, grid: ChartGrid): ChartDraft {
  return { preset: presetOf(spec), title: spec.title ?? '', legend: !!spec.legend, cells: gridToCells(grid) };
}

/** El gráfico y la rejilla de un borrador (`base`: el gráfico que se edita, para conservar lo que el cuadro no toca), o el motivo de no poder hacerlo. */
export function buildChart(draft: ChartDraft, base?: ChartSpec): { spec: ChartSpec; grid: ChartGrid } | string {
  const preset = presetById(draft.preset);
  if (!preset) return 'Tipo de gráfico desconocido.';
  // las filas y las series vacías del final no son datos
  let cells = draft.cells.map((r) => [...r]);
  while (cells.length > 2 && cells[cells.length - 1]!.every((s) => s.trim() === '')) cells.pop();
  const cols = Math.max(2, ...cells.map((r) => r.length));
  let last = cols;
  while (last > 2 && cells.every((r) => (r[last - 1] ?? '').trim() === '')) last--;
  cells = cells.map((r) => Array.from({ length: last }, (_, c) => r[c] ?? ''));
  const grid = cellsToGrid(cells);
  const { series: old, ...rest } = base ?? { series: [] as ChartSpec['series'] };
  const made = specFromGrid(preset.type, grid, { ...rest, title: draft.title.trim() || undefined, legend: draft.legend });
  made.series = made.series.map((s, i) => ({ ...(old[i] ?? {}), ...s }));
  const out = applyPreset(made, preset);
  return typeof out === 'string' ? out : { spec: out, grid };
}
