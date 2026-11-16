import { NS } from './datamodel';
import { attr, el, kid, kidsOf, local, num, parseXml, xmlDocument, type El } from './xml';

/*
 * `dsp:drawing`: el dibujo ya calculado de un SmartArt (Office 2010 y posteriores lo guarda al lado de los datos). Es una lista de
 * formas con su posición, geometría, relleno, línea y texto. Sirve para mostrar un archivo sin ejecutar el diseño y es lo que
 * produce el motor para que otros programas vean el SmartArt igual.
 */

export interface DrawnShape {
  /** El punto de presentación (`pres`) que la dibujó. */
  modelId: string;
  /** Posición y tamaño en EMU, en el espacio del SmartArt. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Giro en 60 000.os de grado. */
  rot: number;
  flipH: boolean;
  flipV: boolean;
  /** Geometría prestablecida y sus ajustes; `custGeom` si es una geometría propia. */
  prst?: string;
  adj: Record<string, number>;
  custGeom?: El;
  /** Relleno, línea, efectos… (`dsp:spPr` menos `a:xfrm` y la geometría), sin interpretar. */
  spPr: El[];
  /** `dsp:style` (referencias al tema). */
  style?: El;
  /** `dsp:txBody` (`a:bodyPr`, `a:lstStyle`, `a:p`). */
  txBody?: El;
  /** Rectángulo del texto, si no es el de la forma. */
  txXfrm?: { x: number; y: number; w: number; h: number; rot: number };
}

const xfrmOf = (x: El | undefined) => {
  const off = kid(x, 'off');
  const ext = kid(x, 'ext');
  return { x: num(attr(off, 'x'), 0), y: num(attr(off, 'y'), 0), w: num(attr(ext, 'cx'), 0), h: num(attr(ext, 'cy'), 0), rot: num(attr(x, 'rot'), 0), flipH: attr(x, 'flipH') === '1', flipV: attr(x, 'flipV') === '1' };
};

export function parseDrawing(xml: string): DrawnShape[] {
  const root = parseXml(xml);
  const out: DrawnShape[] = [];
  for (const sp of kidsOf(kid(root, 'spTree'), 'sp')) {
    const pr = kid(sp, 'spPr');
    const xf = xfrmOf(kid(pr, 'xfrm'));
    const geom = kid(pr, 'prstGeom');
    const cust = kid(pr, 'custGeom');
    const adj: Record<string, number> = {};
    for (const g of kidsOf(kid(geom, 'avLst'), 'gd')) {
      const m = /^val\s+(-?\d+)/.exec(attr(g, 'fmla') ?? '');
      if (m) adj[attr(g, 'name') ?? 'adj'] = Number(m[1]);
    }
    const shape: DrawnShape = {
      modelId: attr(sp, 'modelId') ?? '',
      x: xf.x,
      y: xf.y,
      w: xf.w,
      h: xf.h,
      rot: xf.rot,
      flipH: xf.flipH,
      flipV: xf.flipV,
      adj,
      spPr: (pr?.kids ?? []).filter((k) => local(k.name) !== 'xfrm' && local(k.name) !== 'prstGeom' && local(k.name) !== 'custGeom'),
    };
    if (geom) shape.prst = attr(geom, 'prst') ?? 'rect';
    if (cust) shape.custGeom = cust;
    const st = kid(sp, 'style');
    if (st) shape.style = st;
    const tb = kid(sp, 'txBody');
    if (tb) shape.txBody = tb;
    const tx = kid(sp, 'txXfrm');
    if (tx) {
      const t = xfrmOf(tx);
      shape.txXfrm = { x: t.x, y: t.y, w: t.w, h: t.h, rot: t.rot };
    }
    out.push(shape);
  }
  return out;
}

const off = (x: number, y: number) => el('a:off', { x: String(Math.round(x)), y: String(Math.round(y)) });
const ext = (w: number, h: number) => el('a:ext', { cx: String(Math.round(w)), cy: String(Math.round(h)) });

export function drawingEl(shapes: DrawnShape[]): El {
  const sps = shapes.map((s) => {
    const xattrs: Record<string, string> = {};
    if (s.rot) xattrs.rot = String(Math.round(s.rot));
    if (s.flipH) xattrs.flipH = '1';
    if (s.flipV) xattrs.flipV = '1';
    const geom = s.custGeom
      ? [s.custGeom]
      : [el('a:prstGeom', { prst: s.prst ?? 'rect' }, [el('a:avLst', {}, Object.entries(s.adj).map(([n, v]) => el('a:gd', { name: n, fmla: `val ${Math.round(v)}` })))])];
    const kids: El[] = [
      el('dsp:nvSpPr', {}, [el('dsp:cNvPr', { id: '0', name: '' }), el('dsp:cNvSpPr')]),
      el('dsp:spPr', {}, [el('a:xfrm', xattrs, [off(s.x, s.y), ext(s.w, s.h)]), ...geom, ...s.spPr]),
    ];
    if (s.style) kids.push(s.style);
    if (s.txBody) kids.push(s.txBody);
    if (s.txXfrm) {
      const a: Record<string, string> = {};
      if (s.txXfrm.rot) a.rot = String(Math.round(s.txXfrm.rot));
      kids.push(el('dsp:txXfrm', a, [off(s.txXfrm.x, s.txXfrm.y), ext(s.txXfrm.w, s.txXfrm.h)]));
    }
    return el('dsp:sp', { modelId: s.modelId }, kids);
  });
  return el('dsp:drawing', { 'xmlns:dgm': NS.dgm, 'xmlns:dsp': NS.dsp, 'xmlns:a': NS.a }, [
    el('dsp:spTree', {}, [el('dsp:nvGrpSpPr', {}, [el('dsp:cNvPr', { id: '0', name: '' }), el('dsp:cNvGrpSpPr')]), el('dsp:grpSpPr'), ...sps]),
  ]);
}

export const writeDrawing = (shapes: DrawnShape[]): string => xmlDocument(drawingEl(shapes));
