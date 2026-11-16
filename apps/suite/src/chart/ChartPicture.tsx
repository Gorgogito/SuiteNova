import { chartData, chartSvg, gridSource, type ChartGrid, type ChartPalette, type ChartSpec } from '@suitenova/chart-core';
import { useMemo } from 'react';

/*
 * Un gráfico de Slides o de Writer dibujado con el motor compartido, como imagen vectorial. `accents` son los colores del tema del
 * documento: las series que no traen color propio los usan en orden.
 */

export function ChartPicture({ spec, grid, width, height, accents, palette, locale = 'es', label }: { spec: ChartSpec; grid: ChartGrid; width: number; height: number; accents: string[]; palette: ChartPalette; locale?: 'en' | 'es'; label?: string }) {
  const svg = useMemo(() => {
    const w = Math.max(20, Math.round(width));
    const h = Math.max(20, Math.round(height));
    try {
      const colored: ChartSpec = { ...spec, series: spec.series.map((s, i) => ({ ...s, color: s.color ?? accents[i % accents.length] })) };
      return chartSvg(colored, chartData(colored, gridSource(grid), locale), locale, palette, w, h);
    } catch {
      return '';
    }
  }, [spec, grid, Math.round(width), Math.round(height), accents.join(','), palette.text, palette.grid, palette.bg, locale]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div role="img" aria-label={label ?? spec.title ?? 'Gráfico'} style={{ width, height, lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
