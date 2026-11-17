import { chartAreaCss, chartData, chartOption, chartSvg, chart3dFor, echarts, gridSource, is3D, type ChartGrid, type ChartPalette, type ChartSpec } from '@suitenova/chart-core';
import { useEffect, useMemo, useRef } from 'react';

/*
 * Un gráfico de Slides o de Writer dibujado con el motor compartido: como imagen vectorial (miniaturas, presentación, impresión) o
 * vivo (`live`), con la información emergente al pasar el ratón. `accents` son los colores del tema del documento: las series que no
 * traen color propio los usan en orden.
 */

interface Props {
  spec: ChartSpec;
  grid: ChartGrid;
  width: number;
  height: number;
  accents: string[];
  palette: ChartPalette;
  locale?: 'en' | 'es';
  label?: string;
  /** Dibujo vivo (canvas con información emergente) en lugar de imagen fija. */
  live?: boolean;
}

export function ChartPicture({ spec, grid, width, height, accents, palette, locale = 'es', label, live = false }: Props) {
  const w = Math.max(20, Math.round(width));
  const h = Math.max(20, Math.round(height));
  const key = accents.join(',') + palette.text + palette.grid + palette.bg;
  const colored = useMemo<ChartSpec>(() => ({ ...spec, series: spec.series.map((s, i) => ({ ...s, color: s.color ?? accents[i % accents.length] })) }), [spec, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const threeD = is3D(colored);
  const svg = useMemo(() => {
    if (live && !threeD) return '';
    try {
      const data = chartData(colored, gridSource(grid), locale);
      return live ? chart3dFor(colored, data, palette, w, h) : chartSvg(colored, data, locale, palette, w, h);
    } catch {
      return '';
    }
  }, [colored, grid, w, h, live, threeD, locale]); // eslint-disable-line react-hooks/exhaustive-deps

  const host = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    const el = host.current;
    if (!live || threeD || !el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas', width: w, height: h });
    inst.current = chart;
    return () => {
      chart.dispose();
      inst.current = null;
    };
  }, [live, threeD]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const chart = inst.current;
    if (!live || threeD || !chart) return;
    try {
      chart.resize({ width: w, height: h });
      chart.setOption(chartOption(colored, chartData(colored, gridSource(grid), locale), locale, palette), true);
    } catch {
      /* un gráfico que no se puede dibujar se queda en blanco */
    }
  }, [live, threeD, colored, grid, w, h, locale]); // eslint-disable-line react-hooks/exhaustive-deps

  const style = { width, height, lineHeight: 0, boxSizing: 'border-box' as const, ...chartAreaCss(spec) };
  if (live && !threeD) return <div ref={host} role="img" aria-label={label ?? spec.title ?? 'Gráfico'} style={style} />;
  return <div role="img" aria-label={label ?? spec.title ?? 'Gráfico'} style={{ width, height, lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
