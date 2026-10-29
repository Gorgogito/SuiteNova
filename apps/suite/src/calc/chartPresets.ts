import { DEFAULT_3D, STOCK_SERIES, type Chart3D, type ChartDef, type ChartType, type StockKind } from '@suitenova/calc-engine';

export interface ChartPreset {
  id: string;
  label: string;
  icon: string;
  /** The family of charts a new chart is first suggested as. */
  type: ChartType;
  group: 'column' | 'bar' | 'line' | 'area' | 'pie' | 'scatter' | 'radar' | 'stock' | 'surface' | 'combo';
  /** What to set on the chart (series types and the rest of the flags are reset first). */
  patch: (def: Pick<ChartDef, 'series'>) => Partial<ChartDef>;
  /** A reason why the data cannot make this chart, in Spanish, or null. */
  check?: (def: Pick<ChartDef, 'series'>) => string | null;
}

const d3 = (over: Partial<Chart3D> = {}): Chart3D => ({ ...DEFAULT_3D, ...over });
const stock = (kind: StockKind): Pick<ChartPreset, 'patch' | 'check'> => ({
  patch: () => ({ stock: { kind }, legend: true }),
  check: (def) => (def.series.length === STOCK_SERIES[kind].length ? null : `Este gráfico de cotizaciones necesita ${STOCK_SERIES[kind].length} series, en este orden: ${STOCK_SERIES[kind].map(stockLabel).join(', ')}.`),
});
function stockLabel(s: string): string {
  return { open: 'apertura', high: 'máximo', low: 'mínimo', close: 'cierre', volume: 'volumen' }[s] ?? s;
}
const needsTwo = (def: Pick<ChartDef, 'series'>) => (def.series.length >= 2 ? null : 'Un gráfico combinado necesita al menos dos series de datos.');
const surfaceNeeds = (def: Pick<ChartDef, 'series'>) => (def.series.length >= 2 ? null : 'Un gráfico de superficie necesita al menos dos series (columnas de números).');
const surface3d = (surface: ChartDef['surface']): Pick<ChartPreset, 'patch' | 'check'> => ({
  patch: () => ({ surface, threeD: d3({ rotX: 25, rotY: 30, rightAngle: false, perspective: 30, depth: 100 }), legend: true }),
  check: surfaceNeeds,
});

export const CHART_PRESETS: ChartPreset[] = [
  { id: 'column', label: 'Columnas agrupadas', icon: 'chartColumn', type: 'column', group: 'column', patch: () => ({}) },
  { id: 'columnStacked', label: 'Columnas apiladas', icon: 'chartColumn', type: 'column', group: 'column', patch: () => ({ stacked: true }) },
  { id: 'columnPercent', label: 'Columnas apiladas al 100 %', icon: 'chartColumn', type: 'column', group: 'column', patch: () => ({ stacked: true, percent: true }) },
  { id: 'column3d', label: 'Columnas 3D agrupadas', icon: 'chartColumn', type: 'column', group: 'column', patch: () => ({ threeD: d3() }) },
  { id: 'column3dDepth', label: 'Columnas 3D (series en profundidad)', icon: 'chartColumn', type: 'column', group: 'column', patch: () => ({ threeD: d3({ seriesDepth: true, rightAngle: false, rotX: 20, rotY: 30 }) }) },
  { id: 'bar', label: 'Barras agrupadas', icon: 'chartBar', type: 'bar', group: 'bar', patch: () => ({}) },
  { id: 'barStacked', label: 'Barras apiladas', icon: 'chartBar', type: 'bar', group: 'bar', patch: () => ({ stacked: true }) },
  { id: 'barPercent', label: 'Barras apiladas al 100 %', icon: 'chartBar', type: 'bar', group: 'bar', patch: () => ({ stacked: true, percent: true }) },
  { id: 'bar3d', label: 'Barras 3D agrupadas', icon: 'chartBar', type: 'bar', group: 'bar', patch: () => ({ threeD: d3() }) },
  { id: 'line', label: 'Líneas', icon: 'chartLine', type: 'line', group: 'line', patch: () => ({}) },
  { id: 'lineStacked', label: 'Líneas apiladas', icon: 'chartLine', type: 'line', group: 'line', patch: () => ({ stacked: true }) },
  { id: 'line3d', label: 'Líneas 3D', icon: 'chartLine', type: 'line', group: 'line', patch: () => ({ threeD: d3({ seriesDepth: true, rightAngle: false, rotX: 20, rotY: 30 }) }) },
  { id: 'area', label: 'Áreas', icon: 'chartArea', type: 'area', group: 'area', patch: () => ({}) },
  { id: 'areaStacked', label: 'Áreas apiladas', icon: 'chartArea', type: 'area', group: 'area', patch: () => ({ stacked: true }) },
  { id: 'areaPercent', label: 'Áreas apiladas al 100 %', icon: 'chartArea', type: 'area', group: 'area', patch: () => ({ stacked: true, percent: true }) },
  { id: 'area3d', label: 'Áreas 3D', icon: 'chartArea', type: 'area', group: 'area', patch: () => ({ threeD: d3({ seriesDepth: true, rightAngle: false, rotX: 20, rotY: 30 }) }) },
  { id: 'pie', label: 'Circular', icon: 'chartPie', type: 'pie', group: 'pie', patch: () => ({}) },
  { id: 'pie3d', label: 'Circular 3D', icon: 'chartPie', type: 'pie', group: 'pie', patch: () => ({ threeD: d3({ rotX: 40, rotY: 0, rightAngle: false, perspective: 0 }) }) },
  { id: 'doughnut', label: 'Anillos', icon: 'chartPie', type: 'doughnut', group: 'pie', patch: () => ({}) },
  { id: 'scatter', label: 'Dispersión (XY)', icon: 'chartScatter', type: 'scatter', group: 'scatter', patch: () => ({}) },
  { id: 'radar', label: 'Radar', icon: 'chartRadar', type: 'radar', group: 'radar', patch: () => ({ radar: {} }) },
  { id: 'radarMarkers', label: 'Radar con marcadores', icon: 'chartRadar', type: 'radar', group: 'radar', patch: () => ({ radar: { markers: true } }) },
  { id: 'radarFilled', label: 'Radar relleno', icon: 'chartRadar', type: 'radar', group: 'radar', patch: () => ({ radar: { filled: true } }) },
  { id: 'stockHLC', label: 'Máximos, mínimos y cierre', icon: 'chartStock', type: 'stock', group: 'stock', ...stock('hlc') },
  { id: 'stockOHLC', label: 'Apertura, máximos, mínimos y cierre', icon: 'chartStock', type: 'stock', group: 'stock', ...stock('ohlc') },
  { id: 'stockVHLC', label: 'Volumen, máximos, mínimos y cierre', icon: 'chartStock', type: 'stock', group: 'stock', ...stock('vhlc') },
  { id: 'stockVOHLC', label: 'Volumen, apertura, máximos, mínimos y cierre', icon: 'chartStock', type: 'stock', group: 'stock', ...stock('vohlc') },
  { id: 'surface3d', label: 'Superficie 3D', icon: 'chartSurface', type: 'surface', group: 'surface', ...surface3d({}) },
  { id: 'surfaceWire', label: 'Superficie 3D (estructura alámbrica)', icon: 'chartSurface', type: 'surface', group: 'surface', ...surface3d({ wireframe: true }) },
  { id: 'surfaceContour', label: 'Contorno', icon: 'chartSurface', type: 'surface', group: 'surface', ...surface3d({ contour: true }) },
  {
    id: 'combo',
    label: 'Columnas agrupadas y líneas en el eje secundario',
    icon: 'chartCombo',
    type: 'column',
    group: 'combo',
    check: needsTwo,
    patch: (def) => ({ series: def.series.map((s, i) => (i === 0 ? { ...s, type: 'column' as const } : { ...s, type: 'line' as const, secondary: true })), axisY2: {} }),
  },
  {
    id: 'comboLine',
    label: 'Columnas agrupadas y líneas',
    icon: 'chartCombo',
    type: 'column',
    group: 'combo',
    check: needsTwo,
    patch: (def) => ({ series: def.series.map((s, i) => (i === 0 ? { ...s, type: 'column' as const } : { ...s, type: 'line' as const })) }),
  },
  {
    id: 'comboArea',
    label: 'Áreas apiladas y columnas agrupadas',
    icon: 'chartCombo',
    type: 'column',
    group: 'combo',
    check: needsTwo,
    patch: (def) => ({ series: def.series.map((s, i) => (i === 0 ? { ...s, type: 'area' as const } : { ...s, type: 'column' as const })) }),
  },
];

export const presetById = (id: string): ChartPreset | undefined => CHART_PRESETS.find((p) => p.id === id);

/** A chart with the settings of a preset applied; series refs and layout are kept. Returns the reason when the data does not fit. */
export function applyPreset(def: ChartDef, preset: ChartPreset): ChartDef | string {
  const reason = preset.check?.(def);
  if (reason) return reason;
  // start from a clean slate: forget everything a previous type set
  const clean: ChartDef = {
    ...def,
    type: preset.type,
    stacked: undefined,
    percent: undefined,
    smooth: def.smooth,
    threeD: undefined,
    radar: undefined,
    stock: undefined,
    surface: undefined,
    series: def.series.map((s) => ({ ...s, type: undefined, secondary: undefined })),
    axisY2: undefined,
  };
  const patched = { ...clean, ...preset.patch(clean) };
  if (preset.type === 'pie' || preset.type === 'doughnut') patched.series = patched.series.slice(0, 1);
  // a combined chart that came out with the same type in every series is just that chart
  return patched;
}

/** Which preset describes a chart (for the "checked" state of the type menu). */
export function presetOf(def: ChartDef): string {
  const types = new Set(def.series.map((s) => s.type ?? ''));
  const combo = types.size > 1 || def.series.some((s) => s.secondary);
  if (combo) return def.series.some((s) => s.secondary) ? 'combo' : def.series.some((s) => s.type === 'area') ? 'comboArea' : 'comboLine';
  if (def.type === 'stock') return { hlc: 'stockHLC', ohlc: 'stockOHLC', vhlc: 'stockVHLC', vohlc: 'stockVOHLC' }[def.stock?.kind ?? 'hlc'];
  if (def.type === 'surface') return def.surface?.contour ? 'surfaceContour' : def.surface?.wireframe ? 'surfaceWire' : 'surface3d';
  if (def.type === 'radar') return def.radar?.filled ? 'radarFilled' : def.radar?.markers ? 'radarMarkers' : 'radar';
  const suffix = def.threeD ? (def.threeD.seriesDepth && def.type === 'column' ? '3dDepth' : '3d') : def.stacked ? (def.percent ? 'Percent' : 'Stacked') : '';
  return `${def.type}${suffix}`;
}
