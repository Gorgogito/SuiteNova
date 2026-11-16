import { CT_CHARTEX, chartParts as coreParts, readChartPart, type ChartGrid, type ChartSpec } from '@suitenova/chart-core';

/* Los gráficos de PowerPoint son los del motor compartido (chart-core): ver `chart-core/src/dml/part.ts`. */

export { CT_CHARTEX, readChartPart };
export const CT_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Las partes de un gráfico nuevo o editado, en la forma que entiende `copyRaw` (ruta → bytes). */
export const chartParts = (spec: ChartSpec, grid: ChartGrid, book: Uint8Array): Record<string, Uint8Array> => coreParts(spec, grid, book, 'ppt');
