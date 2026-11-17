import type { ChartSeries, ChartSpec } from '@suitenova/chart-core';
import './messages';

/*
 * «Cambiar colores» y «Estilos rápidos» de Office: juegos de colores para las series y aspectos completos del gráfico (fondo, bordes,
 * fuentes, cuadrícula, etiquetas). Son propios de Nova (no son los estilos de Microsoft): lo que se aplica se guarda como formato
 * normal del gráfico, así que se puede retocar después y Office lo lee tal cual.
 */

export interface ColorPalette {
  id: string;
  label: string;
  /** Los colores en orden; en las monocromáticas, el color base (se generan los tonos). */
  colors: string[];
  mono?: boolean;
}

const OFFICE = ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'];

export const COLOR_PALETTES: ColorPalette[] = [
  { id: 'colorful1', label: 'Colorido 1', colors: OFFICE },
  { id: 'colorful2', label: 'Colorido 2', colors: ['#ed7d31', '#ffc000', '#70ad47', '#4472c4', '#a5a5a5', '#5b9bd5'] },
  { id: 'colorful3', label: 'Colorido 3', colors: ['#a5a5a5', '#5b9bd5', '#4472c4', '#ed7d31', '#70ad47', '#ffc000'] },
  { id: 'colorful4', label: 'Colorido 4', colors: ['#5b9bd5', '#70ad47', '#ffc000', '#ed7d31', '#a5a5a5', '#4472c4'] },
  { id: 'mono1', label: 'Monocromático azul', colors: ['#4472c4'], mono: true },
  { id: 'mono2', label: 'Monocromático naranja', colors: ['#ed7d31'], mono: true },
  { id: 'mono3', label: 'Monocromático gris', colors: ['#7f7f7f'], mono: true },
  { id: 'mono4', label: 'Monocromático dorado', colors: ['#ffc000'], mono: true },
  { id: 'mono5', label: 'Monocromático azul claro', colors: ['#5b9bd5'], mono: true },
  { id: 'mono6', label: 'Monocromático verde', colors: ['#70ad47'], mono: true },
];

/** Tonos de un color, del más oscuro al más claro (n ≥ 1). */
function shades(base: string, n: number): string[] {
  const c = parseInt(base.slice(1), 16);
  const [r, g, b] = [c >> 16, (c >> 8) & 255, c & 255];
  const mix = (v: number, t: number) => Math.round(t < 0 ? v * (1 + t) : v + (255 - v) * t);
  return Array.from({ length: n }, (_x, i) => {
    const t = n === 1 ? 0 : -0.45 + (0.85 * i) / (n - 1);
    return `#${[mix(r, t), mix(g, t), mix(b, t)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  });
}

/** Los colores de un juego para `n` elementos (series o puntos). */
export function paletteColors(id: string, n: number): string[] {
  const p = COLOR_PALETTES.find((x) => x.id === id);
  if (!p) return [];
  if (p.mono) return shades(p.colors[0]!, Math.max(1, n));
  return Array.from({ length: n }, (_x, i) => p.colors[i % p.colors.length]!);
}

/** Qué juego de colores usan las series del gráfico, si es uno de los de la galería. */
export function paletteOf(c: ChartSpec, pointCount: number): string | null {
  const roundOrVary = c.type === 'pie' || c.type === 'doughnut' || (c.varyColors && c.series.length === 1);
  const have = roundOrVary ? Array.from({ length: pointCount }, (_x, i) => c.series[0]?.points?.find((p) => p.idx === i)?.color) : c.series.map((s) => s.color);
  if (!have.length || have.some((x) => !x)) return null;
  return COLOR_PALETTES.find((p) => paletteColors(p.id, have.length).every((col, i) => col === have[i]))?.id ?? null;
}

/** El gráfico con los colores de un juego: una por serie, o una por punto en circulares y en series únicas con «variar colores». */
export function applyPalette<T extends ChartSpec>(c: T, id: string, pointCount: number): T {
  const byPoint = c.type === 'pie' || c.type === 'doughnut' || (c.varyColors && c.series.length === 1);
  if (byPoint) {
    const cols = paletteColors(id, pointCount);
    const series = c.series.map((s, i): ChartSeries => (i === 0 ? { ...s, points: cols.map((color, idx) => ({ ...(s.points?.find((p) => p.idx === idx) ?? {}), idx, color })) } : s));
    return { ...c, series };
  }
  const cols = paletteColors(id, c.series.length);
  return { ...c, series: c.series.map((s, i) => ({ ...s, color: cols[i]!, marker: s.marker?.color ? { ...s.marker, color: undefined } : s.marker })) };
}

// ------------------------------------------------------------------------------------------------ estilos rápidos

export interface ChartStyle {
  id: string;
  label: string;
  description: string;
  /** El aspecto: lo que cambia respecto de un gráfico sin formato propio. */
  apply: (c: ChartSpec) => Partial<ChartSpec>;
}

const plainSeries = (s: ChartSeries): ChartSeries => {
  const { line: _l, transparency: _t, noFill: _n, ...rest } = s;
  return rest;
};
/** Quita el formato visual (áreas, fuentes, bordes y transparencias), conservando datos, tipo y etiquetas. */
const reset = (c: ChartSpec): Partial<ChartSpec> => ({ chartArea: undefined, plotArea: undefined, fonts: undefined, gapWidth: undefined, overlap: undefined, series: c.series.map(plainSeries) });

export const CHART_STYLES: ChartStyle[] = [
  { id: 'style1', label: 'Estilo 1', description: 'El aspecto de partida: fondo blanco, cuadrícula suave y colores del tema.', apply: (c) => reset(c) },
  {
    id: 'style2',
    label: 'Estilo 2',
    description: 'Etiquetas con el valor y sin cuadrícula.',
    apply: (c) => ({ ...reset(c), axisY: { ...c.axisY, gridlines: false }, series: c.series.map((s) => ({ ...plainSeries(s), labels: s.labels ?? { value: true } })) }),
  },
  {
    id: 'style3',
    label: 'Estilo 3',
    description: 'Fondo gris claro con borde y área de trazado blanca.',
    apply: (c) => ({ ...reset(c), chartArea: { fill: '#f2f2f2', line: { color: '#bfbfbf', width: 1 } }, plotArea: { fill: '#ffffff' } }),
  },
  {
    id: 'style4',
    label: 'Estilo 4',
    description: 'Columnas más anchas con borde blanco entre series.',
    apply: (c) => ({ ...reset(c), gapWidth: 50, series: c.series.map((s) => ({ ...plainSeries(s), line: { color: '#ffffff', width: 1.5 } })) }),
  },
  {
    id: 'style5',
    label: 'Estilo 5',
    description: 'Fondo oscuro con texto claro.',
    apply: (c) => ({ ...reset(c), chartArea: { fill: '#262626' }, fonts: { chart: { color: '#f2f2f2' } } }),
  },
  {
    id: 'style6',
    label: 'Estilo 6',
    description: 'Relleno suave con borde del mismo color.',
    apply: (c) => ({ ...reset(c), series: c.series.map((s, i) => ({ ...plainSeries(s), transparency: 30, line: { color: s.color ?? ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'][i % 6]!, width: 1.5 } })) }),
  },
  {
    id: 'style7',
    label: 'Estilo 7',
    description: 'Sin fondo ni borde, con letra con serifa.',
    apply: (c) => ({ ...reset(c), chartArea: { noFill: true, line: { none: true } }, fonts: { chart: { family: 'Georgia' }, title: { size: 16, bold: true } } }),
  },
  {
    id: 'style8',
    label: 'Estilo 8',
    description: 'Título grande, texto gris y área de trazado con borde.',
    apply: (c) => ({ ...reset(c), plotArea: { line: { color: '#a6a6a6', width: 1 } }, fonts: { chart: { color: '#595959' }, title: { size: 18, bold: true, color: '#262626' } } }),
  },
];

/** El gráfico con un estilo rápido aplicado. */
export function applyStyle<T extends ChartSpec>(c: T, id: string): T {
  const st = CHART_STYLES.find((s) => s.id === id);
  return st ? { ...c, ...st.apply(c) } : c;
}
