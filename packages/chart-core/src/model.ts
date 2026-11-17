import type { ErrorBars, Trendline } from './fit';

/*
 * El modelo de un gráfico, común a Calc, Slides y Writer: qué se dibuja y cómo, sin dónde está ni de dónde salen los datos (las series
 * llevan referencias de rango; cada producto las lee a su manera).
 */

export type ChartType = 'column' | 'bar' | 'line' | 'pie' | 'area' | 'scatter' | 'doughnut' | 'radar' | 'stock' | 'surface' | 'waterfall' | 'funnel' | 'histogram' | 'boxwhisker';

/** Types a series can take inside a combined chart. */
export type SeriesType = 'column' | 'line' | 'area' | 'scatter';

export const SERIES_TYPES: SeriesType[] = ['column', 'line', 'area', 'scatter'];

export interface ChartAxis {
  title?: string;
  min?: number;
  max?: number;
  log?: boolean;
  /** Number format of the tick labels; the cell format when empty. */
  format?: string;
  /** Draw the grid lines of this axis (the value axis draws them by default). */
  gridlines?: boolean;
  /** Show the largest values first. */
  reverse?: boolean;
  /** Draw the minor grid lines of this axis (Excel's "Minor gridlines"). */
  minorGridlines?: boolean;
  /** The axis is not shown (Excel's "Axes" element switched off); its scale still applies. */
  hidden?: boolean;
}

/** Dash pattern of a line or border (Excel's "Dash type"). */
export type DashStyle = 'solid' | 'dash' | 'dot' | 'dashDot' | 'longDash';

/** A line or a border (Excel's "Line" in "Format data series"): width in points. */
export interface StrokeFormat {
  /** "#rrggbb"; the series colour when empty (for lines) or none (for borders). */
  color?: string;
  width?: number;
  dash?: DashStyle;
  /** No line (or no border). */
  none?: boolean;
}

export type MarkerSymbol = 'circle' | 'square' | 'diamond' | 'triangle' | 'x' | 'star' | 'dot' | 'dash' | 'plus' | 'none';

/** The markers of a line, scatter or radar series (Excel's "Marker"). */
export interface MarkerFormat {
  symbol?: MarkerSymbol;
  /** Size in points (2 to 72). */
  size?: number;
  /** "#rrggbb"; the series colour when empty. */
  color?: string;
}

/** Format of one data point (a column, a slice): Excel's "Format data point". */
export interface PointFormat {
  idx: number;
  color?: string;
  /** Pie slice pulled out, in percent of the radius. */
  explosion?: number;
}

/** Text format of a part of the chart (Excel's "Font"): sizes in points. */
export interface TextFormat {
  family?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  /** "#rrggbb". */
  color?: string;
}

/** Format of the chart area or the plot area (Excel's "Format chart area" / "Format plot area"). */
export interface AreaFormat {
  /** "#rrggbb". */
  fill?: string;
  /** No fill: the page shows through. */
  noFill?: boolean;
  /** Fill transparency in percent. */
  transparency?: number;
  /** Border of the area. */
  line?: StrokeFormat;
}

/** Fonts of the chart: `chart` is the base the other parts start from. */
export interface ChartFonts {
  chart?: TextFormat;
  title?: TextFormat;
  legend?: TextFormat;
  /** Tick labels of the axes. */
  axis?: TextFormat;
  axisTitle?: TextFormat;
  /** Data labels. */
  labels?: TextFormat;
}

/** Where the legend goes (Excel's "Legend" element): bottom, top, left, right or top right. */
export type LegendPos = 'b' | 't' | 'l' | 'r' | 'tr';

/** Where a data label sits; the ones that apply depend on the kind of chart (Excel offers a different list for each). */
export type LabelPos = 'ctr' | 'inEnd' | 'inBase' | 'outEnd' | 't' | 'b' | 'l' | 'r' | 'bestFit';

/** Excel's "Data labels" of one series: what they say and where they go. */
export interface DataLabels {
  value?: boolean;
  category?: boolean;
  series?: boolean;
  /** Share of the whole; only in pie and doughnut charts. */
  percent?: boolean;
  pos?: LabelPos;
  /** Text between the parts of a label; ", " when empty. */
  separator?: string;
  /** Number format of the values; the data's own when empty. */
  format?: string;
}

/** The viewing position of a 3-D chart (Excel's "Format chart area > 3-D rotation"). */
export interface Chart3D {
  /** Elevation in degrees (-90 to 90). */
  rotX: number;
  /** Rotation around the vertical axis in degrees (0 to 360). */
  rotY: number;
  /** Perspective in degrees (0 to 100); ignored with right-angle axes. */
  perspective: number;
  /** Depth as a percentage of the width (20 to 2000). */
  depth: number;
  /** Right-angle axes: an oblique view in which the front of the chart is not rotated. */
  rightAngle: boolean;
  /** Series along a depth axis (Excel's plain "3-D Column") instead of side by side. */
  seriesDepth?: boolean;
}

export const DEFAULT_3D: Chart3D = { rotX: 15, rotY: 20, perspective: 30, depth: 100, rightAngle: true };

export type StockKind = 'hlc' | 'ohlc' | 'vhlc' | 'vohlc';

/** Names of the series a stock chart needs, in order. */
export const STOCK_SERIES: Record<StockKind, string[]> = {
  hlc: ['high', 'low', 'close'],
  ohlc: ['open', 'high', 'low', 'close'],
  vhlc: ['volume', 'high', 'low', 'close'],
  vohlc: ['volume', 'open', 'high', 'low', 'close'],
};

export interface ChartSeries {
  /** Literal name, or a reference such as "Hoja1!$B$1". */
  name?: string;
  nameRef?: string;
  /** Category labels (x axis), e.g. "Hoja1!$A$2:$A$5". For scatter charts these are the X values. */
  categories?: string;
  /** Plotted values, e.g. "Hoja1!$B$2:$B$5". */
  values: string;
  /** In a combined chart, how this series is drawn; the chart's type when empty. */
  type?: SeriesType;
  /** Plot against the secondary value axis (shown on the right). */
  secondary?: boolean;
  /** "#rrggbb"; the palette when empty. */
  color?: string;
  /** Trendlines fitted to this series (not for stacked, pie, radar, stock, surface or 3-D charts). */
  trendlines?: Trendline[];
  /** Data labels of this series (none when empty). */
  labels?: DataLabels;
  /** The line of a line, scatter or radar series, or the border of a column, area or slice. */
  line?: StrokeFormat;
  /** Markers of a line, scatter or radar series. */
  marker?: MarkerFormat;
  /** Fill transparency in percent (0 = opaque). */
  transparency?: number;
  /** No fill (columns, areas, slices). */
  noFill?: boolean;
  /** Pie: every slice pulled out, in percent of the radius. */
  explosion?: number;
  /** Format of single points; the rest follow the series. */
  points?: PointFormat[];
  /** Error bars along Y (and along X in scatter charts). */
  errY?: ErrorBars;
  errX?: ErrorBars;
}

export interface ChartSpec {
  type: ChartType;
  title?: string;
  legend: boolean;
  /** Where the legend goes; the bottom when empty. */
  legendPos?: LegendPos;
  /** Format of the whole chart area (fill and border). */
  chartArea?: AreaFormat;
  /** Format of the plot area (fill and border). */
  plotArea?: AreaFormat;
  /** Fonts of the title, legend, axes and data labels. */
  fonts?: ChartFonts;
  /** Columns and bars: space between categories as a percentage of the bar width (0 to 500; 150 in Excel). */
  gapWidth?: number;
  /** Columns and bars: how much the bars of one category overlap (-100 to 100; 0 clustered, 100 stacked). */
  overlap?: number;
  /** Doughnut: hole size in percent of the radius (10 to 90; 50 in Excel). */
  holeSize?: number;
  /** Pie and doughnut: angle of the first slice in degrees (0 to 360). */
  firstSliceAng?: number;
  /** One colour per point in a single-series chart ("Vary colours by point"). */
  varyColors?: boolean;
  /** Excel's "Data table" under the plot (column, bar-less category charts); `keys` shows the legend keys in it. */
  dataTable?: { keys?: boolean };
  stacked?: boolean;
  /** With `stacked`: every column adds up to 100%. */
  percent?: boolean;
  smooth?: boolean;
  /** Axis options: X (categories or scatter X), Y (primary values) and Y2 (secondary values). */
  axisX?: ChartAxis;
  axisY?: ChartAxis;
  axisY2?: ChartAxis;
  /** Present for the 3-D version of column, bar, line, area and pie charts; surface charts always are 3-D. */
  threeD?: Chart3D;
  radar?: { filled?: boolean; markers?: boolean };
  stock?: { kind: StockKind };
  surface?: { wireframe?: boolean; contour?: boolean };
  /** Waterfall: points shown as totals (from zero) by their index, and whether connector lines are drawn. */
  waterfall?: { totals?: number[]; connectors?: boolean };
  /** Histogram: how the classes are made (automatic Scott's rule when empty). */
  histogram?: { binWidth?: number; binCount?: number; overflow?: number; underflow?: number; closed?: 'right' | 'left' };
  /** Box and whisker: quartile method and what is drawn besides the box. */
  boxwhisker?: { inclusive?: boolean; mean?: boolean; outliers?: boolean; inner?: boolean };
  series: ChartSeries[];
}
