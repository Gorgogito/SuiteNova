import type { SeriesType } from './model';

export const CHART_COLORS = ['#3b82c4', '#e8833a', '#7a8b99', '#e0b030', '#4aa3a2', '#6aa84f', '#a463a0', '#d65a5a'];

/** Idioma de los textos que el gráfico escribe por su cuenta («Serie 1», nombres de las tendencias). */
export type ChartLocale = 'en' | 'es';

export interface ChartPalette {
  text: string;
  grid: string;
  bg: string;
}

export interface ChartSeriesData {
  name: string;
  /** Plotted numbers (null for blanks and text). */
  values: (number | null)[];
  /** X values for scatter charts. */
  x: (number | null)[];
  /** Category labels read for this series. */
  labels: string[];
  type: SeriesType;
  secondary: boolean;
  color: string;
  /** Cantidades de error por punto, ya calculadas (si la serie tiene barras de error). */
  errY?: { plus: (number | null)[]; minus: (number | null)[] };
  errX?: { plus: (number | null)[]; minus: (number | null)[] };
}

/** Los números y las etiquetas que hay detrás de un gráfico, ya leídos de donde estén. */
export interface ChartData {
  categories: string[];
  series: ChartSeriesData[];
}
