import { attr, kid, kidsOf, num, parseXml, type El } from './xml';

/*
 * `dgm:styleDef` (estilo rápido) y `dgm:colorsDef` (colores): para cada «etiqueta de estilo» (`node0`, `node1`, `sibTrans2D1`…) dicen
 * cómo se dibujan las formas del diseño que la usan. Aquí solo se leen; el motor los aplica (fase 3).
 */

export interface Cat {
  type: string;
  pri: number;
}

export interface StyleLbl {
  name: string;
  scene3d?: El;
  sp3d?: El;
  txPr?: El;
  /** `dgm:style`: referencias a línea, relleno, efecto y fuente del tema (`a:lnRef`, `a:fillRef`, `a:effectRef`, `a:fontRef`). */
  style?: El;
}

export interface StyleDef {
  uniqueId: string;
  title: string;
  desc: string;
  cats: Cat[];
  scene3d?: El;
  styleLbls: StyleLbl[];
}

export type ColorMeth = 'span' | 'cycle' | 'repeat';

export interface ColorList {
  meth: ColorMeth;
  hueDir: 'cw' | 'ccw';
  /** Colores de DrawingML (`a:schemeClr`, `a:srgbClr`…) con sus transformaciones, sin interpretar. */
  colors: El[];
}

export interface ColorLbl {
  name: string;
  fill: ColorList;
  lin: ColorList;
  effect: ColorList;
  txLin: ColorList;
  txFill: ColorList;
  txEffect: ColorList;
}

export interface ColorsDef {
  uniqueId: string;
  title: string;
  desc: string;
  cats: Cat[];
  styleLbls: ColorLbl[];
}

const cats = (e: El): Cat[] => kidsOf(kid(e, 'catLst'), 'cat').map((c) => ({ type: attr(c, 'type') ?? '', pri: num(attr(c, 'pri'), 0) }));

export function parseStyleDef(xml: string): StyleDef {
  const root = parseXml(xml);
  const def: StyleDef = {
    uniqueId: attr(root, 'uniqueId') ?? '',
    title: attr(kid(root, 'title'), 'val') ?? '',
    desc: attr(kid(root, 'desc'), 'val') ?? '',
    cats: cats(root),
    styleLbls: kidsOf(root, 'styleLbl').map((s) => {
      const lbl: StyleLbl = { name: attr(s, 'name') ?? '' };
      const sc = kid(s, 'scene3d');
      if (sc) lbl.scene3d = sc;
      const sp = kid(s, 'sp3d');
      if (sp) lbl.sp3d = sp;
      const tx = kid(s, 'txPr');
      if (tx) lbl.txPr = tx;
      const st = kid(s, 'style');
      if (st) lbl.style = st;
      return lbl;
    }),
  };
  const sc = kid(root, 'scene3d');
  if (sc) def.scene3d = sc;
  return def;
}

const colorList = (e: El | undefined): ColorList => ({
  meth: (attr(e, 'meth') as ColorMeth | undefined) ?? 'span',
  hueDir: attr(e, 'hueDir') === 'ccw' ? 'ccw' : 'cw',
  colors: e ? e.kids : [],
});

export function parseColorsDef(xml: string): ColorsDef {
  const root = parseXml(xml);
  return {
    uniqueId: attr(root, 'uniqueId') ?? '',
    title: attr(kid(root, 'title'), 'val') ?? '',
    desc: attr(kid(root, 'desc'), 'val') ?? '',
    cats: cats(root),
    styleLbls: kidsOf(root, 'styleLbl').map((s) => ({
      name: attr(s, 'name') ?? '',
      fill: colorList(kid(s, 'fillClrLst')),
      lin: colorList(kid(s, 'linClrLst')),
      effect: colorList(kid(s, 'effectClrLst')),
      txLin: colorList(kid(s, 'txLinClrLst')),
      txFill: colorList(kid(s, 'txFillClrLst')),
      txEffect: colorList(kid(s, 'txEffectClrLst')),
    })),
  };
}

export const styleLabel = (def: StyleDef, name: string): StyleLbl | undefined => def.styleLbls.find((s) => s.name === name);
export const colorLabel = (def: ColorsDef, name: string): ColorLbl | undefined => def.styleLbls.find((s) => s.name === name);
