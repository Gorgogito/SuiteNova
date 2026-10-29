import { newId } from './defaults';
import { makeDoc } from './text';
import type { Clr, Effects, Fill, Ln, RunProps, ShapeEl, TextEffects, TextWarp } from './types';

/*
 * NovaArt: the WordArt of Nova Slides. A style is a text fill, outline and effects (the run's `fx`); a "transform" is the warp of the
 * text box. Both are what PowerPoint writes for WordArt, so a file keeps looking the same in both programs.
 */

const sc = (scheme: NonNullable<Clr['scheme']>, mods?: Clr['mods']): Clr => ({ scheme, ...(mods ? { mods } : {}) });
const solid = (c: Clr): Fill => ({ t: 'solid', c });
const line = (c: Clr, w: number): Ln => ({ w, fill: solid(c), cap: 'flat', join: 'round' });
const shadow: Effects = { outer: { blur: 4, dist: 3, dir: 45, c: { rgb: '#000000', mods: [{ t: 'alpha', v: 45000 }] }, algn: 'tl', rotWithShape: false } };
const glow = (c: Clr): Effects => ({ glow: { rad: 9, c: { ...c, mods: [...(c.mods ?? []), { t: 'alpha', v: 60000 }] } } });
const reflection: Effects = { reflection: { blur: 0.5, stA: 50, stPos: 0, endA: 0, endPos: 35, dist: 0, dir: 90, fadeDir: 90, sx: 100, sy: -100, algn: 'bl', rotWithShape: false } };
const grad = (ang: number, ...cols: string[]): Fill => ({ t: 'grad', lin: { ang, scaled: false }, stops: cols.map((c, i) => ({ pos: Math.round((i * 100000) / (cols.length - 1)), c: { rgb: c } })) });

export interface NovaArtStyle {
  id: string;
  name: string;
  fx: TextEffects;
}

const ACC = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const;

export const NOVAART_STYLES: NovaArtStyle[] = [
  { id: 'tx1', name: 'Relleno negro', fx: { fill: solid(sc('tx1')) } },
  ...ACC.map((a, i): NovaArtStyle => ({ id: a, name: `Relleno, énfasis ${i + 1}`, fx: { fill: solid(sc(a)) } })),
  { id: 'out1', name: 'Contorno, énfasis 1', fx: { fill: { t: 'none' }, ln: line(sc('accent1'), 1.5) } },
  { id: 'out2', name: 'Contorno, énfasis 2', fx: { fill: { t: 'none' }, ln: line(sc('accent2'), 1.5) } },
  { id: 'sh1', name: 'Negro con sombra', fx: { fill: solid(sc('tx1')), effects: shadow } },
  { id: 'sh2', name: 'Énfasis 1 con sombra', fx: { fill: solid(sc('accent1')), effects: shadow } },
  { id: 'sh3', name: 'Énfasis 2 con sombra', fx: { fill: solid(sc('accent2')), effects: shadow } },
  { id: 'gr1', name: 'Degradado atardecer', fx: { fill: grad(90, '#ffd966', '#ed7d31', '#c00000') } },
  { id: 'gr2', name: 'Degradado metal', fx: { fill: grad(90, '#f2f2f2', '#a6a6a6', '#595959'), effects: shadow } },
  { id: 'gr3', name: 'Degradado azul', fx: { fill: grad(90, '#9dc3e6', '#2f5597') } },
  { id: 'gr4', name: 'Degradado verde', fx: { fill: grad(90, '#c5e0b4', '#548235') } },
  { id: 'gl1', name: 'Resplandor, énfasis 1', fx: { fill: solid(sc('accent1')), effects: glow(sc('accent1')) } },
  { id: 'gl2', name: 'Resplandor, énfasis 4', fx: { fill: solid(sc('accent4')), effects: glow(sc('accent4')) } },
  { id: 'rf1', name: 'Reflejo, énfasis 1', fx: { fill: solid(sc('accent1')), effects: reflection } },
  { id: 'rf2', name: 'Reflejo negro', fx: { fill: solid(sc('tx1')), effects: reflection } },
  { id: 'bold', name: 'Blanco con contorno y sombra', fx: { fill: solid(sc('bg1')), ln: line(sc('accent1', [{ t: 'shade', v: 50000 }]), 1.25), effects: shadow } },
  { id: '3d', name: 'Relieve degradado', fx: { fill: grad(90, '#ffffff', '#4472c4'), ln: line(sc('accent1', [{ t: 'shade', v: 50000 }]), 1), effects: shadow } },
];

export interface NovaArtWarp {
  prst: string;
  name: string;
}
/** The transforms Nova Slides draws; the file may hold others (they are kept and shown unwarped). */
export const NOVAART_WARPS: NovaArtWarp[] = [
  { prst: 'textPlain', name: 'Sin transformación' },
  { prst: 'textArchUp', name: 'Arco hacia arriba' },
  { prst: 'textArchDown', name: 'Arco hacia abajo' },
  { prst: 'textCircle', name: 'Círculo' },
  { prst: 'textButton', name: 'Botón' },
  { prst: 'textCurveUp', name: 'Curva hacia arriba' },
  { prst: 'textCurveDown', name: 'Curva hacia abajo' },
  { prst: 'textWave1', name: 'Onda' },
  { prst: 'textSlantUp', name: 'Inclinar hacia arriba' },
  { prst: 'textSlantDown', name: 'Inclinar hacia abajo' },
];

export const novaArtStyle = (id: string): NovaArtStyle => NOVAART_STYLES.find((s) => s.id === id) ?? NOVAART_STYLES[0]!;

/** The run properties of a NovaArt style at a size. */
export const novaArtRun = (styleId: string, sz = 54): RunProps => ({ sz, b: true, fx: structuredClone(novaArtStyle(styleId).fx) });

export const warpOf = (prst: string): TextWarp | undefined => (prst === 'textPlain' ? undefined : { prst });

/** A new WordArt shape centred on the slide. */
export function newNovaArt(styleId: string, text: string, prst: string, slide: { w: number; h: number }): ShapeEl {
  const round = prst === 'textCircle' || prst === 'textButton';
  const w = round ? 300 : Math.min(640, slide.w * 0.7);
  const h = round ? 300 : prst === 'textPlain' ? 100 : 170;
  const r = novaArtRun(styleId);
  return {
    kind: 'shape',
    id: newId(),
    name: 'NovaArt',
    isTextBox: true,
    geom: { prst: 'rect' },
    xfrm: { x: (slide.w - w) / 2, y: (slide.h - h) / 2, w, h },
    fill: { t: 'none' },
    text: {
      body: { wrap: 'none', anchor: 'ctr', fit: { t: 'none' }, ...(warpOf(prst) ? { warp: warpOf(prst) } : {}) },
      doc: makeDoc([{ p: { algn: 'ctr' }, runs: [{ text: text || 'NovaArt', r }], end: r }]).toJSON(),
    },
  };
}
