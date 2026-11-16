import type { ChartAxis, ChartSpec, DataLabels, LabelPos, LegendPos } from '@suitenova/chart-core';
import './messages';

/*
 * «Agregar elemento de gráfico» de Office: cada elemento (títulos, ejes, cuadrículas, etiquetas de datos, leyenda, tabla de datos) es
 * una opción con su texto, si se puede usar con este gráfico, si está activa y qué cambia en el gráfico. Calc, Slides y Writer los
 * ofrecen con los mismos textos; cada uno aplica el cambio a su manera (`apply` devuelve lo que hay que cambiar).
 */

export interface ChartElement {
  id: string;
  /** El grupo del menú («Etiquetas de datos», «Leyenda»…). */
  group: string;
  label: string;
  enabled: (c: ChartSpec) => boolean;
  checked: (c: ChartSpec) => boolean;
  apply: (c: ChartSpec) => Partial<ChartSpec>;
}

const hasAxes = (c: ChartSpec) => !['pie', 'doughnut', 'radar', 'surface'].includes(c.type);
const horizontal = (c: ChartSpec) => c.type === 'bar';
const scatter = (c: ChartSpec) => c.type === 'scatter';
/** El eje de las categorías y el de los valores (en barras horizontales, el de categorías es el vertical). */
const catKey = 'axisX' as const;
const valKey = 'axisY' as const;
/** El eje cuyas líneas son horizontales y el de las verticales. */
const hKey = (c: ChartSpec) => (horizontal(c) ? catKey : valKey);
const vKey = (c: ChartSpec) => (horizontal(c) ? valKey : catKey);

const axisPatch = (c: ChartSpec, key: 'axisX' | 'axisY', patch: Partial<ChartAxis>): Partial<ChartSpec> => {
  const next: ChartAxis = { ...c[key], ...patch };
  for (const k of Object.keys(next) as (keyof ChartAxis)[]) if (next[k] === undefined) delete next[k];
  return { [key]: Object.keys(next).length ? next : undefined } as Partial<ChartSpec>;
};

const setLabels = (c: ChartSpec, fn: (l: DataLabels | undefined) => DataLabels | undefined): Partial<ChartSpec> => ({ series: c.series.map((s) => ({ ...s, labels: fn(s.labels) })) });
const labelsAre = (c: ChartSpec, fn: (l: DataLabels) => boolean): boolean => c.series.length > 0 && c.series.every((s) => !!s.labels && fn(s.labels));

/** Las posiciones de etiqueta que ofrece Office para cada tipo de gráfico. */
export function labelPositions(c: ChartSpec): LabelPos[] {
  if (c.threeD) return c.type === 'pie' ? ['bestFit', 'ctr', 'inEnd', 'outEnd'] : [];
  switch (c.type) {
    case 'column':
    case 'bar':
      return c.stacked ? ['ctr', 'inEnd', 'inBase'] : ['ctr', 'inEnd', 'inBase', 'outEnd'];
    case 'line':
    case 'scatter':
      return ['ctr', 'l', 'r', 't', 'b'];
    case 'pie':
      return ['bestFit', 'ctr', 'inEnd', 'outEnd'];
    default:
      return [];
  }
}

const POS_LABEL: Record<LabelPos, string> = { ctr: 'Centro', inEnd: 'Interior final', inBase: 'Base interior', outEnd: 'Exterior final', bestFit: 'Ajuste óptimo', t: 'Arriba', b: 'Abajo', l: 'Izquierda', r: 'Derecha' };
const POS_IDS: LabelPos[] = ['ctr', 'inEnd', 'inBase', 'outEnd', 'bestFit', 't', 'b', 'l', 'r'];
const LEGENDS: [string, LegendPos][] = [['Leyenda a la derecha', 'r'], ['Leyenda arriba', 't'], ['Leyenda a la izquierda', 'l'], ['Leyenda abajo', 'b']];

export const DEFAULT_AXIS_TITLE = 'Título del eje';
export const DEFAULT_CHART_TITLE = 'Título del gráfico';

const elements: ChartElement[] = [
  // títulos
  { id: 'title', group: 'Título del gráfico', label: 'Título del gráfico', enabled: () => true, checked: (c) => !!c.title, apply: (c) => ({ title: c.title ? undefined : DEFAULT_CHART_TITLE }) },
  { id: 'axisTitleH', group: 'Títulos de los ejes', label: 'Título del eje horizontal', enabled: hasAxes, checked: (c) => (horizontal(c) ? !!c.axisY?.title : !!c.axisX?.title), apply: (c) => axisPatch(c, horizontal(c) ? valKey : catKey, { title: (horizontal(c) ? c.axisY?.title : c.axisX?.title) ? undefined : DEFAULT_AXIS_TITLE }) },
  { id: 'axisTitleV', group: 'Títulos de los ejes', label: 'Título del eje vertical', enabled: hasAxes, checked: (c) => (horizontal(c) ? !!c.axisX?.title : !!c.axisY?.title), apply: (c) => axisPatch(c, horizontal(c) ? catKey : valKey, { title: (horizontal(c) ? c.axisX?.title : c.axisY?.title) ? undefined : DEFAULT_AXIS_TITLE }) },
  // ejes
  { id: 'axisH', group: 'Ejes', label: 'Eje horizontal', enabled: hasAxes, checked: (c) => !(horizontal(c) ? c.axisY : c.axisX)?.hidden, apply: (c) => axisPatch(c, horizontal(c) ? valKey : catKey, { hidden: (horizontal(c) ? c.axisY : c.axisX)?.hidden ? undefined : true }) },
  { id: 'axisV', group: 'Ejes', label: 'Eje vertical', enabled: hasAxes, checked: (c) => !(horizontal(c) ? c.axisX : c.axisY)?.hidden, apply: (c) => axisPatch(c, horizontal(c) ? catKey : valKey, { hidden: (horizontal(c) ? c.axisX : c.axisY)?.hidden ? undefined : true }) },
  // cuadrículas
  { id: 'gridMajorH', group: 'Cuadrícula', label: 'Cuadrícula principal horizontal', enabled: hasAxes, checked: (c) => c[hKey(c)]?.gridlines ?? hKey(c) === valKey, apply: (c) => axisPatch(c, hKey(c), { gridlines: !(c[hKey(c)]?.gridlines ?? hKey(c) === valKey) }) },
  { id: 'gridMajorV', group: 'Cuadrícula', label: 'Cuadrícula principal vertical', enabled: hasAxes, checked: (c) => c[vKey(c)]?.gridlines ?? vKey(c) === valKey, apply: (c) => axisPatch(c, vKey(c), { gridlines: !(c[vKey(c)]?.gridlines ?? vKey(c) === valKey) }) },
  { id: 'gridMinorH', group: 'Cuadrícula', label: 'Cuadrícula secundaria horizontal', enabled: (c) => hasAxes(c) && hKey(c) === valKey, checked: (c) => !!c[hKey(c)]?.minorGridlines, apply: (c) => axisPatch(c, hKey(c), { minorGridlines: c[hKey(c)]?.minorGridlines ? undefined : true }) },
  { id: 'gridMinorV', group: 'Cuadrícula', label: 'Cuadrícula secundaria vertical', enabled: (c) => hasAxes(c) && (scatter(c) || vKey(c) === valKey), checked: (c) => !!c[vKey(c)]?.minorGridlines, apply: (c) => axisPatch(c, vKey(c), { minorGridlines: c[vKey(c)]?.minorGridlines ? undefined : true }) },
  // etiquetas de datos
  { id: 'labelsNone', group: 'Etiquetas de datos', label: 'Sin etiquetas de datos', enabled: () => true, checked: (c) => !c.series.some((s) => s.labels), apply: (c) => setLabels(c, () => undefined) },
  { id: 'labelsShow', group: 'Etiquetas de datos', label: 'Mostrar etiquetas de datos', enabled: () => true, checked: (c) => labelsAre(c, (l) => !l.pos && !!l.value), apply: (c) => setLabels(c, () => ({ value: true })) },
  ...POS_IDS.map(
    (p): ChartElement => ({
      id: `labels.${p}`,
      group: 'Etiquetas de datos',
      label: `Etiquetas: ${POS_LABEL[p].toLowerCase()}`,
      enabled: (c) => labelPositions(c).includes(p),
      checked: (c) => labelsAre(c, (l) => l.pos === p),
      apply: (c) => setLabels(c, (l) => ({ ...(l && (l.value || l.category || l.series || l.percent) ? l : { value: true }), pos: p })),
    }),
  ),
  { id: 'labelsCategory', group: 'Etiquetas de datos', label: 'Etiquetas: nombre de la categoría', enabled: (c) => c.series.some((s) => s.labels), checked: (c) => labelsAre(c, (l) => !!l.category), apply: (c) => setLabels(c, (l) => (l ? { ...l, category: l.category ? undefined : true } : l)) },
  { id: 'labelsSeries', group: 'Etiquetas de datos', label: 'Etiquetas: nombre de la serie', enabled: (c) => c.series.some((s) => s.labels), checked: (c) => labelsAre(c, (l) => !!l.series), apply: (c) => setLabels(c, (l) => (l ? { ...l, series: l.series ? undefined : true } : l)) },
  { id: 'labelsValue', group: 'Etiquetas de datos', label: 'Etiquetas: valor', enabled: (c) => c.series.some((s) => s.labels), checked: (c) => labelsAre(c, (l) => !!l.value), apply: (c) => setLabels(c, (l) => (l ? { ...l, value: l.value ? undefined : true } : l)) },
  { id: 'labelsPercent', group: 'Etiquetas de datos', label: 'Etiquetas: porcentaje', enabled: (c) => (c.type === 'pie' || c.type === 'doughnut') && c.series.some((s) => s.labels), checked: (c) => labelsAre(c, (l) => !!l.percent), apply: (c) => setLabels(c, (l) => (l ? { ...l, percent: l.percent ? undefined : true } : l)) },
  // leyenda
  { id: 'legendNone', group: 'Leyenda', label: 'Sin leyenda', enabled: () => true, checked: (c) => !c.legend, apply: () => ({ legend: false, legendPos: undefined }) },
  ...LEGENDS.map(
    ([label, pos]): ChartElement => ({ id: `legend.${pos}`, group: 'Leyenda', label, enabled: () => true, checked: (c) => c.legend && (c.legendPos ?? 'b') === pos, apply: () => ({ legend: true, legendPos: pos === 'b' ? undefined : pos }) }),
  ),
  // tabla de datos
  { id: 'tableNone', group: 'Tabla de datos', label: 'Sin tabla de datos', enabled: (c) => ['column', 'line', 'area'].includes(c.type), checked: (c) => !c.dataTable, apply: () => ({ dataTable: undefined }) },
  { id: 'tableShow', group: 'Tabla de datos', label: 'Tabla de datos con claves de leyenda', enabled: (c) => ['column', 'line', 'area'].includes(c.type), checked: (c) => !!c.dataTable?.keys, apply: () => ({ dataTable: { keys: true } }) },
  { id: 'tablePlain', group: 'Tabla de datos', label: 'Tabla de datos sin claves de leyenda', enabled: (c) => ['column', 'line', 'area'].includes(c.type), checked: (c) => !!c.dataTable && !c.dataTable.keys, apply: () => ({ dataTable: {} }) },
];

export const CHART_ELEMENTS: ChartElement[] = elements;

/** Los grupos del menú, en orden. */
export const ELEMENT_GROUPS: string[] = [...new Set(elements.map((e) => e.group))];

/** El gráfico con un elemento aplicado. */
export function applyElement<T extends ChartSpec>(chart: T, id: string): T {
  const el = elements.find((e) => e.id === id);
  if (!el || !el.enabled(chart)) return chart;
  return { ...chart, ...el.apply(chart) };
}
