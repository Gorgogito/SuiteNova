import type { WordArtFx } from './render';

/** Colores de acento del tema de Office por omisión: los estilos de la galería se muestran con ellos (cada producto puede resolverlos con su tema). */
export const ACCENTS = ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'] as const;

export interface WordArtStyle {
  id: string;
  name: string;
  fx: WordArtFx;
}

const solid = (color: string) => ({ type: 'solid' as const, color });
const grad = (angle: number, ...cols: string[]) => ({ type: 'gradient' as const, angle, stops: cols.map((color, i) => ({ pos: cols.length === 1 ? 0 : i / (cols.length - 1), color })) });
const shadow = { color: '#000000', alpha: 0.45, blur: 4, dx: 2.1, dy: 2.1 };
const reflection = { alpha: 0.5, size: 0.35, gap: 0 };

export const WORDART_STYLES: WordArtStyle[] = [
  { id: 'tx1', name: 'Relleno negro', fx: { fill: solid('#000000') } },
  ...ACCENTS.map((c, i): WordArtStyle => ({ id: `accent${i + 1}`, name: `Relleno, énfasis ${i + 1}`, fx: { fill: solid(c) } })),
  { id: 'out1', name: 'Contorno, énfasis 1', fx: { fill: { type: 'none' }, outline: { color: ACCENTS[0], width: 1.5 } } },
  { id: 'out2', name: 'Contorno, énfasis 2', fx: { fill: { type: 'none' }, outline: { color: ACCENTS[1], width: 1.5 } } },
  { id: 'sh1', name: 'Negro con sombra', fx: { fill: solid('#000000'), shadow } },
  { id: 'sh2', name: 'Énfasis 1 con sombra', fx: { fill: solid(ACCENTS[0]), shadow } },
  { id: 'sh3', name: 'Énfasis 2 con sombra', fx: { fill: solid(ACCENTS[1]), shadow } },
  { id: 'gr1', name: 'Degradado atardecer', fx: { fill: grad(90, '#ffd966', '#ed7d31', '#c00000') } },
  { id: 'gr2', name: 'Degradado metal', fx: { fill: grad(90, '#f2f2f2', '#a6a6a6', '#595959'), shadow } },
  { id: 'gr3', name: 'Degradado azul', fx: { fill: grad(90, '#9dc3e6', '#2f5597') } },
  { id: 'gr4', name: 'Degradado verde', fx: { fill: grad(90, '#c5e0b4', '#548235') } },
  { id: 'gl1', name: 'Resplandor, énfasis 1', fx: { fill: solid(ACCENTS[0]), glow: { color: ACCENTS[0], alpha: 0.6, radius: 9 } } },
  { id: 'gl2', name: 'Resplandor, énfasis 4', fx: { fill: solid(ACCENTS[3]), glow: { color: ACCENTS[3], alpha: 0.6, radius: 9 } } },
  { id: 'rf1', name: 'Reflejo, énfasis 1', fx: { fill: solid(ACCENTS[0]), reflection } },
  { id: 'rf2', name: 'Reflejo negro', fx: { fill: solid('#000000'), reflection } },
  { id: 'bold', name: 'Blanco con contorno y sombra', fx: { fill: solid('#ffffff'), outline: { color: '#203864', width: 1.25 }, shadow } },
  { id: '3d', name: 'Relieve degradado', fx: { fill: grad(90, '#ffffff', '#4472c4'), outline: { color: '#203864', width: 1 }, shadow } },
];

export const wordArtStyle = (id: string): WordArtStyle => WORDART_STYLES.find((s) => s.id === id) ?? WORDART_STYLES[0]!;

/** Nombres en español de las transformaciones (como los muestra Office en «Transformar»). */
export const WARP_NAMES: Record<string, string> = {
  textPlain: 'Normal',
  textStop: 'Detener',
  textTriangle: 'Triángulo hacia arriba',
  textTriangleInverted: 'Triángulo hacia abajo',
  textChevron: 'Cheurón hacia arriba',
  textChevronInverted: 'Cheurón hacia abajo',
  textRingInside: 'Anillo interior',
  textRingOutside: 'Anillo exterior',
  textArchUp: 'Arco hacia arriba',
  textArchDown: 'Arco hacia abajo',
  textCircle: 'Círculo',
  textButton: 'Botón',
  textArchUpPour: 'Arco hacia arriba (verter)',
  textArchDownPour: 'Arco hacia abajo (verter)',
  textCirclePour: 'Círculo (verter)',
  textButtonPour: 'Botón (verter)',
  textCurveUp: 'Curva hacia arriba',
  textCurveDown: 'Curva hacia abajo',
  textCanUp: 'Cilindro hacia arriba',
  textCanDown: 'Cilindro hacia abajo',
  textWave1: 'Onda 1',
  textWave2: 'Onda 2',
  textDoubleWave1: 'Doble onda 1',
  textWave4: 'Onda 4',
  textInflate: 'Inflar',
  textDeflate: 'Desinflar',
  textInflateBottom: 'Inflar abajo',
  textDeflateBottom: 'Desinflar abajo',
  textInflateTop: 'Inflar arriba',
  textDeflateTop: 'Desinflar arriba',
  textDeflateInflate: 'Desinflar e inflar',
  textDeflateInflateDeflate: 'Desinflar, inflar y desinflar',
  textFadeRight: 'Desvanecer a la derecha',
  textFadeLeft: 'Desvanecer a la izquierda',
  textFadeUp: 'Desvanecer hacia arriba',
  textFadeDown: 'Desvanecer hacia abajo',
  textSlantUp: 'Inclinar hacia arriba',
  textSlantDown: 'Inclinar hacia abajo',
  textCascadeUp: 'Cascada hacia arriba',
  textCascadeDown: 'Cascada hacia abajo',
};

export const warpName = (prst: string): string => WARP_NAMES[prst] ?? prst;
