import { customPaths } from './custom';
import { hasPreset, presetGeometry } from './preset';
import type { CustPath } from './types';

/*
 * What every product shows when the user opens the shape gallery, and how a shape of any product is drawn. A shape "kind" is the name of a
 * DrawingML preset (`rect`, `star5`, `wedgeRectCallout`…), plus `textbox` (a rectangle meant to hold text). Documents written by the first
 * versions of Nova Writer and Nova Calc used shorter names (`callout`, `rightTriangle`, `textBox`): `resolveKind` maps them.
 */

export interface ShapeCategory {
  id: string;
  title: string;
  shapes: string[];
}

export const SHAPE_CATEGORIES: ShapeCategory[] = [
  { id: 'lines', title: 'Líneas', shapes: ['line', 'straightConnector1', 'bentConnector3', 'curvedConnector3'] },
  { id: 'rects', title: 'Rectángulos', shapes: ['rect', 'roundRect', 'snip1Rect', 'snip2SameRect', 'snipRoundRect', 'round1Rect', 'round2SameRect'] },
  { id: 'basic', title: 'Formas básicas', shapes: ['ellipse', 'triangle', 'rtTriangle', 'diamond', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'heptagon', 'octagon', 'decagon', 'dodecagon', 'pie', 'chord', 'teardrop', 'frame', 'halfFrame', 'corner', 'diagStripe', 'plus', 'plaque', 'can', 'cube', 'bevel', 'donut', 'noSmoking', 'blockArc', 'foldedCorner', 'smileyFace', 'heart', 'lightningBolt', 'sun', 'moon', 'cloud', 'arc', 'bracketPair', 'bracePair', 'leftBracket', 'rightBracket', 'leftBrace', 'rightBrace'] },
  { id: 'arrows', title: 'Flechas de bloque', shapes: ['rightArrow', 'leftArrow', 'upArrow', 'downArrow', 'leftRightArrow', 'upDownArrow', 'quadArrow', 'leftRightUpArrow', 'bentArrow', 'uturnArrow', 'leftUpArrow', 'bentUpArrow', 'curvedRightArrow', 'curvedLeftArrow', 'curvedUpArrow', 'curvedDownArrow', 'stripedRightArrow', 'notchedRightArrow', 'homePlate', 'chevron', 'rightArrowCallout', 'leftArrowCallout', 'upArrowCallout', 'downArrowCallout', 'circularArrow'] },
  { id: 'math', title: 'Formas de ecuación', shapes: ['mathPlus', 'mathMinus', 'mathMultiply', 'mathDivide', 'mathEqual', 'mathNotEqual'] },
  { id: 'flow', title: 'Diagrama de flujo', shapes: ['flowChartProcess', 'flowChartAlternateProcess', 'flowChartDecision', 'flowChartInputOutput', 'flowChartPredefinedProcess', 'flowChartInternalStorage', 'flowChartDocument', 'flowChartMultidocument', 'flowChartTerminator', 'flowChartPreparation', 'flowChartManualInput', 'flowChartManualOperation', 'flowChartConnector', 'flowChartOffpageConnector', 'flowChartPunchedCard', 'flowChartPunchedTape', 'flowChartSummingJunction', 'flowChartOr', 'flowChartCollate', 'flowChartSort', 'flowChartExtract', 'flowChartMerge', 'flowChartOnlineStorage', 'flowChartDelay', 'flowChartMagneticTape', 'flowChartMagneticDisk', 'flowChartMagneticDrum', 'flowChartDisplay'] },
  { id: 'stars', title: 'Estrellas y cintas', shapes: ['star4', 'star5', 'star6', 'star7', 'star8', 'star10', 'star12', 'star16', 'star24', 'star32', 'irregularSeal1', 'irregularSeal2', 'ribbon', 'ribbon2', 'ellipseRibbon', 'ellipseRibbon2', 'verticalScroll', 'horizontalScroll', 'wave', 'doubleWave'] },
  { id: 'callouts', title: 'Llamadas', shapes: ['wedgeRectCallout', 'wedgeRoundRectCallout', 'wedgeEllipseCallout', 'cloudCallout', 'borderCallout1', 'borderCallout2', 'borderCallout3', 'accentCallout1', 'accentCallout2', 'accentCallout3', 'callout1', 'callout2', 'callout3', 'accentBorderCallout1'] },
  { id: 'actions', title: 'Botones de acción', shapes: ['actionButtonBackPrevious', 'actionButtonForwardNext', 'actionButtonBeginning', 'actionButtonEnd', 'actionButtonHome', 'actionButtonInformation', 'actionButtonReturn', 'actionButtonMovie', 'actionButtonDocument', 'actionButtonSound', 'actionButtonHelp', 'actionButtonBlank'] },
];

/** Spanish names of the shapes people look for by name (the others show their DrawingML name). */
export const SHAPE_LABELS: Record<string, string> = {
  line: 'Línea',
  straightConnector1: 'Conector recto',
  bentConnector3: 'Conector en ángulo',
  curvedConnector3: 'Conector curvo',
  rect: 'Rectángulo',
  textbox: 'Cuadro de texto',
  roundRect: 'Rectángulo redondeado',
  snip1Rect: 'Rectángulo con una esquina cortada',
  ellipse: 'Elipse',
  triangle: 'Triángulo',
  rtTriangle: 'Triángulo rectángulo',
  diamond: 'Rombo',
  parallelogram: 'Paralelogramo',
  trapezoid: 'Trapecio',
  pentagon: 'Pentágono',
  hexagon: 'Hexágono',
  heptagon: 'Heptágono',
  octagon: 'Octágono',
  decagon: 'Decágono',
  dodecagon: 'Dodecágono',
  plus: 'Cruz',
  frame: 'Marco',
  can: 'Cilindro',
  cube: 'Cubo',
  donut: 'Anillo',
  noSmoking: 'Prohibido',
  smileyFace: 'Cara sonriente',
  heart: 'Corazón',
  lightningBolt: 'Rayo',
  sun: 'Sol',
  moon: 'Luna',
  cloud: 'Nube',
  rightArrow: 'Flecha derecha',
  leftArrow: 'Flecha izquierda',
  upArrow: 'Flecha arriba',
  downArrow: 'Flecha abajo',
  leftRightArrow: 'Flecha izquierda y derecha',
  upDownArrow: 'Flecha arriba y abajo',
  chevron: 'Chevrón',
  homePlate: 'Pentágono (flecha)',
  star4: 'Estrella de 4 puntas',
  star5: 'Estrella de 5 puntas',
  star6: 'Estrella de 6 puntas',
  star8: 'Estrella de 8 puntas',
  wave: 'Onda',
  wedgeRectCallout: 'Llamada rectangular',
  wedgeRoundRectCallout: 'Llamada redondeada',
  wedgeEllipseCallout: 'Llamada ovalada',
  cloudCallout: 'Llamada de nube',
  flowChartProcess: 'Proceso',
  flowChartDecision: 'Decisión',
  flowChartTerminator: 'Terminador',
  flowChartDocument: 'Documento',
  flowChartInputOutput: 'Datos',
};

/** The label of a shape kind (the DrawingML name if it has no Spanish one). */
export const shapeLabel = (kind: string): string => SHAPE_LABELS[resolveKind(kind)] ?? kind;

/** Names the first versions of the editors used, and the preset each stands for. */
const LEGACY: Record<string, string> = { callout: 'wedgeRectCallout', rightTriangle: 'rtTriangle', textBox: 'textbox' };

/** The kind a document stored, as a current kind (`textbox` or the name of a preset). Unknown names are returned as they are. */
export const resolveKind = (kind: string): string => LEGACY[kind] ?? kind;

/** The DrawingML preset that draws a kind (`textbox` is a plain rectangle). Unknown kinds draw as a rectangle. */
export function presetOf(kind: string): string {
  const k = resolveKind(kind);
  if (k === 'textbox') return 'rect';
  return hasPreset(k) ? k : 'rect';
}

/** ¿Es un trazo (línea o conector) y no una figura cerrada? */
export const isLineKind = (kind: string): boolean => /^(line|lineInv|straightConnector1|bentConnector\d|curvedConnector\d)$/.test(resolveKind(kind));

export interface ShapeStyle {
  fill?: string | null;
  stroke?: string | null;
  strokeWidth?: number;
  adj?: Record<string, number>;
  /** A line goes from the top-right to the bottom-left corner instead of top-left to bottom-right. */
  flip?: boolean;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * The SVG paths (as markup, without the `<svg>` element) of a shape of w × h pixels; the drawing coordinates are pixels, so the `<svg>`
 * should have `viewBox="0 0 w h"`. Paths that DrawingML leaves unfilled stay unfilled and the shaded ones are drawn lighter or darker.
 */
export function shapeSvg(kind: string, w: number, h: number, style: ShapeStyle = {}): string {
  const geo = presetGeometry(presetOf(kind), w, h, style.adj ?? {});
  if (!geo) return '';
  const line = isLineKind(kind);
  const fill = line ? null : style.fill === undefined ? null : style.fill;
  const stroke = style.stroke === undefined ? null : style.stroke;
  const sw = style.strokeWidth ?? 1;
  const paths = geo.paths
    .map((p) => {
      const base = !fill || p.fill === 'none' ? 'none' : fill;
      const d = esc(p.d);
      const strokeAttr = stroke && sw > 0 && p.stroke !== false ? ` stroke="${esc(stroke)}" stroke-width="${sw}" stroke-linejoin="round"` : '';
      let out = `<path d="${d}" fill="${esc(base)}"${strokeAttr}/>`;
      if (base !== 'none' && (p.fill === 'lighten' || p.fill === 'lightenLess')) out = `<path d="${d}" fill="${esc(base)}"/><path d="${d}" fill="#fff" fill-opacity="${p.fill === 'lighten' ? 0.4 : 0.2}"${strokeAttr.replace(/stroke="[^"]*"/, 'stroke="none"')}/>`;
      else if (base !== 'none' && (p.fill === 'darken' || p.fill === 'darkenLess')) out = `<path d="${d}" fill="${esc(base)}"/><path d="${d}" fill="#000" fill-opacity="${p.fill === 'darken' ? 0.4 : 0.2}"/>`;
      return out;
    })
    .join('');
  return style.flip ? `<g transform="translate(${w} 0) scale(-1 1)">${paths}</g>` : paths;
}

/** The drawing (SVG paths, in pixels) of a freeform: custom geometry scaled to a shape of w × h. */
export function customShapeSvg(cust: CustPath[], w: number, h: number, style: ShapeStyle = {}): string {
  const fill = style.fill === undefined ? null : style.fill;
  const stroke = style.stroke === undefined ? null : style.stroke;
  const sw = style.strokeWidth ?? 1;
  return customPaths(cust, w, h)
    .map((p) => {
      const base = !fill || p.fill === 'none' ? 'none' : fill;
      const strokeAttr = stroke && sw > 0 && p.stroke !== false ? ` stroke="${esc(stroke)}" stroke-width="${sw}" stroke-linejoin="round"` : '';
      return `<path d="${esc(p.d)}" fill="${esc(base)}"${strokeAttr}/>`;
    })
    .join('');
}

/** The rectangle where a shape's text goes (in the same pixels as `shapeSvg`). */
export function shapeTextRect(kind: string, w: number, h: number, adj: Record<string, number> = {}): { l: number; t: number; r: number; b: number } {
  return presetGeometry(presetOf(kind), w, h, adj)?.textRect ?? { l: 0, t: 0, r: w, b: h };
}
