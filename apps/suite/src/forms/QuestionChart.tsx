/* The charts of the summary, drawn by the chart engine the other programs use. */
import { chartSvg, type ChartPalette, type ChartSpec } from '@suitenova/chart-core';
import { SETTING_THEME, t, useSetting } from '@suitenova/core-ui';
import type { ChartKind, QSummary } from '@suitenova/forms-core';
import { useEffect, useMemo, useRef, useState } from 'react';

const WIDTH = 520;
const HEIGHT = 260;
/** On paper. */
export const PRINT_COLORS: ChartPalette = { text: '#1b1b1b', grid: '#d6d6d6', bg: '#ffffff' };

/** The chart of a question as SVG text; empty if there is nothing to draw. */
export function questionSvg(s: QSummary, kind: ChartKind, palette: ChartPalette, language: 'es' | 'en', otherLabel: string): string {
  if ((s.kind !== 'counts' && s.kind !== 'rating' && s.kind !== 'nps') || !s.answered) return '';
  const categories = s.items.map((i) => (s.kind === 'counts' && i.label === 'Otras respuestas' ? otherLabel : i.label));
  const values = s.items.map((i) => i.count);
  const spec: ChartSpec = { type: kind, legend: kind !== 'column', legendPos: 'r', series: [{ values: '', labels: kind === 'column' ? { value: true } : { percent: true } }] };
  return chartSvg(spec, { categories, series: [{ name: otherLabel, values, x: [], labels: categories, type: 'column', secondary: false, color: '#0f6cbd' }] }, language, palette, WIDTH, HEIGHT);
}

export function QuestionChart({ s, kind, language }: { s: QSummary; kind: ChartKind; language: 'es' | 'en' }) {
  const box = useRef<HTMLDivElement>(null);
  // drawn again with the colours of the theme of the moment
  useSetting<string>(SETTING_THEME, 'system');
  const [palette, setPalette] = useState<ChartPalette>(PRINT_COLORS);
  useEffect(() => {
    const el = box.current;
    const card = el?.closest('.fm-card');
    if (!el || !card) return;
    const text = getComputedStyle(el).color;
    const bg = getComputedStyle(card).backgroundColor;
    if (text !== palette.text || bg !== palette.bg) setPalette({ text, bg, grid: `color-mix(in srgb, ${text} 22%, ${bg})` });
  });
  const other = t('Otras respuestas');
  const svg = useMemo(() => questionSvg(s, kind, palette, language, other), [s, kind, palette, language, other]);
  return (
    <div ref={box} className="fm-chart">
      {svg && <img alt={t('Gráfico: {question}', { question: s.question.title })} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} width={WIDTH} height={HEIGHT} />}
    </div>
  );
}
