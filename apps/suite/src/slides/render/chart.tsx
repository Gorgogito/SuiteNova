import { clrCss, resolveClr, toCss, type ChartEl } from '@suitenova/slides-core';
import { useMemo, type ReactNode } from 'react';
import { ChartPicture } from '../../chart/ChartPicture';
import { xfOf, type CanvasCtx } from './SlideCanvas';

/*
 * Los gráficos de una diapositiva: el motor compartido (`chart-core`) los dibuja con los colores del tema.
 */

const ACCENTS = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const;

export function ChartView({ el, ctx }: { el: ChartEl; ctx: CanvasCtx }): ReactNode {
  const x = xfOf(ctx, el);
  const cc = ctx.env.cc;
  const accents = useMemo(() => ACCENTS.map((k) => clrCss({ scheme: k }, cc)), [cc]);
  const palette = useMemo(
    () => ({
      text: toCss(resolveClr({ scheme: 'tx1', mods: [{ t: 'lumMod', v: 65000 }, { t: 'lumOff', v: 35000 }] }, cc)),
      grid: toCss(resolveClr({ scheme: 'tx1', mods: [{ t: 'lumMod', v: 15000 }, { t: 'lumOff', v: 85000 }] }, cc)),
      bg: 'transparent',
    }),
    [cc],
  );
  if (!el.chart.series.length) return <div style={{ width: x.w, height: x.h, display: 'grid', placeItems: 'center', font: '14px sans-serif', color: palette.text }}>Gráfico sin datos</div>;
  return <ChartPicture spec={el.chart} grid={el.grid} width={x.w} height={x.h} accents={accents} palette={palette} label={el.descr ?? el.chart.title} />;
}
