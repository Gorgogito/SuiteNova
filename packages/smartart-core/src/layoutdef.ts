import { attr, bool, kid, kidsOf, local, num, parseXml, type El } from './xml';

/*
 * `dgm:layoutDef` (ECMA-376 §21.4.2): el «programa» de un diseño de SmartArt. Un diseño es un árbol de nodos de diseño
 * (`layoutNode`); cada uno dice qué algoritmo coloca a sus hijos (`alg`), qué forma dibuja (`shape`), qué puntos de datos le
 * corresponden (`presOf`), qué restricciones y reglas se aplican, y cómo se repite o se bifurca según los datos (`forEach`, `choose`).
 * Aquí solo se lee a un árbol tipado; lo ejecuta el motor (`engine`).
 */

export type AxisType = 'self' | 'ch' | 'des' | 'desOrSelf' | 'par' | 'ancst' | 'ancstOrSelf' | 'followSib' | 'precedSib' | 'follow' | 'preced' | 'root' | 'none';
export type ElementType = 'all' | 'doc' | 'node' | 'norm' | 'nonNorm' | 'asst' | 'nonAsst' | 'parTrans' | 'pres' | 'sibTrans';

/** Los atributos `axis`, `ptType`, `hideLastTrans`, `st`, `cnt` y `step`, que son listas separadas por espacios y comparten forma. */
export interface Selector {
  axis: AxisType[];
  ptType: ElementType[];
  hideLastTrans: boolean[];
  st: number[];
  cnt: number[];
  step: number[];
}

export interface AlgDef {
  kind: 'alg';
  type: string;
  rev?: number;
  params: { type: string; val: string }[];
}

export interface ShapeDef {
  kind: 'shape';
  /** Geometría prestablecida (`rect`, `roundRect`…); vacío si el nodo no dibuja forma propia. */
  type?: string;
  rot: number;
  zOrderOff: number;
  hideGeom: boolean;
  lkTxEntry: boolean;
  blipPhldr: boolean;
  /** Ajustes de la geometría (`dgm:adj`): índice y valor. */
  adj: { idx: number; val: number }[];
}

export interface PresOfDef extends Selector {
  kind: 'presOf';
}

export interface Constr {
  type: string;
  for: 'self' | 'ch' | 'des';
  forName?: string;
  ptType: ElementType;
  refType: string;
  refFor: 'self' | 'ch' | 'des';
  refForName?: string;
  refPtType: ElementType;
  op: 'none' | 'equ' | 'gte' | 'lte';
  val: number;
  fact: number;
}

export interface Rule {
  type: string;
  for: 'self' | 'ch' | 'des';
  forName?: string;
  ptType: ElementType;
  val: number;
  fact: number;
  max: number;
}

export interface ConstrListDef {
  kind: 'constrLst';
  items: Constr[];
}
export interface RuleListDef {
  kind: 'ruleLst';
  items: Rule[];
}
export interface VarListDef {
  kind: 'varLst';
  /** `dir`, `orgChart`, `chMax`, `chPref`, `bulletEnabled`, `hierBranch`, `animOne`, `animLvl`, `resizeHandles`. */
  vars: Record<string, string>;
}

export interface ForEachDef extends Selector {
  kind: 'forEach';
  name?: string;
  /** Nombre de otro `forEach` que se repite aquí (en lugar de tener contenido propio). */
  ref?: string;
  items: LayoutItem[];
}

export interface IfBranch extends Selector {
  name?: string;
  func: string;
  arg: string;
  op: 'equ' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte';
  val: string;
  items: LayoutItem[];
}

export interface ChooseDef {
  kind: 'choose';
  name?: string;
  ifs: IfBranch[];
  else?: LayoutItem[];
}

export interface LayoutNode {
  kind: 'layoutNode';
  name: string;
  styleLbl?: string;
  chOrder: 'b' | 't';
  moveWith?: string;
  items: LayoutItem[];
}

export type LayoutItem = AlgDef | ShapeDef | PresOfDef | ConstrListDef | RuleListDef | VarListDef | ForEachDef | ChooseDef | LayoutNode;

export interface LayoutDef {
  uniqueId: string;
  minVer?: string;
  defStyle?: string;
  title: string;
  desc: string;
  cats: { type: string; pri: number }[];
  /** Datos de ejemplo para la galería (`dgm:sampData`), tal cual. */
  sampData?: El;
  styleData?: El;
  clrData?: El;
  root: LayoutNode;
}

const words = (v: string | undefined): string[] => (v === undefined || v.trim() === '' ? [] : v.trim().split(/\s+/));

function selector(e: El): Selector {
  const axis = words(attr(e, 'axis')) as AxisType[];
  const ptType = words(attr(e, 'ptType')) as ElementType[];
  return {
    axis: axis.length ? axis : ['none'],
    ptType: ptType.length ? ptType : ['all'],
    hideLastTrans: words(attr(e, 'hideLastTrans')).length ? words(attr(e, 'hideLastTrans')).map((v) => v === '1' || v === 'true') : [true],
    st: words(attr(e, 'st')).length ? words(attr(e, 'st')).map(Number) : [0],
    cnt: words(attr(e, 'cnt')).length ? words(attr(e, 'cnt')).map(Number) : [0],
    step: words(attr(e, 'step')).length ? words(attr(e, 'step')).map(Number) : [1],
  };
}

const forOf = (v: string | undefined): 'self' | 'ch' | 'des' => (v === 'ch' || v === 'des' ? v : 'self');

function items(e: El): LayoutItem[] {
  const out: LayoutItem[] = [];
  for (const k of e.kids) {
    const it = item(k);
    if (it) out.push(it);
  }
  return out;
}

function item(e: El): LayoutItem | null {
  switch (local(e.name)) {
    case 'alg':
      return { kind: 'alg', type: attr(e, 'type') ?? 'composite', ...(attr(e, 'rev') !== undefined ? { rev: num(attr(e, 'rev'), 0) } : {}), params: kidsOf(e, 'param').map((p) => ({ type: attr(p, 'type') ?? '', val: attr(p, 'val') ?? '' })) };
    case 'shape':
      return {
        kind: 'shape',
        ...(attr(e, 'type') ? { type: attr(e, 'type') } : {}),
        rot: num(attr(e, 'rot'), 0),
        zOrderOff: num(attr(e, 'zOrderOff'), 0),
        hideGeom: bool(attr(e, 'hideGeom'), false),
        lkTxEntry: bool(attr(e, 'lkTxEntry'), false),
        blipPhldr: bool(attr(e, 'blipPhldr'), false),
        adj: kidsOf(kid(e, 'adjLst'), 'adj').map((a) => ({ idx: num(attr(a, 'idx'), 1), val: num(attr(a, 'val'), 0) })),
      };
    case 'presOf':
      return { kind: 'presOf', ...selector(e) };
    case 'constrLst':
      return {
        kind: 'constrLst',
        items: kidsOf(e, 'constr').map((c) => ({
          type: attr(c, 'type') ?? 'none',
          for: forOf(attr(c, 'for')),
          ...(attr(c, 'forName') ? { forName: attr(c, 'forName') } : {}),
          ptType: (attr(c, 'ptType') as ElementType | undefined) ?? 'all',
          refType: attr(c, 'refType') ?? 'none',
          refFor: forOf(attr(c, 'refFor')),
          ...(attr(c, 'refForName') ? { refForName: attr(c, 'refForName') } : {}),
          refPtType: (attr(c, 'refPtType') as ElementType | undefined) ?? 'all',
          op: (attr(c, 'op') as Constr['op'] | undefined) ?? 'none',
          val: num(attr(c, 'val'), 0),
          fact: num(attr(c, 'fact'), 1),
        })),
      };
    case 'ruleLst':
      return {
        kind: 'ruleLst',
        items: kidsOf(e, 'rule').map((r) => ({
          type: attr(r, 'type') ?? 'none',
          for: forOf(attr(r, 'for')),
          ...(attr(r, 'forName') ? { forName: attr(r, 'forName') } : {}),
          ptType: (attr(r, 'ptType') as ElementType | undefined) ?? 'all',
          val: num(attr(r, 'val'), 0),
          fact: num(attr(r, 'fact'), Number.NaN),
          max: num(attr(r, 'max'), Number.NaN),
        })),
      };
    case 'varLst': {
      const vars: Record<string, string> = {};
      for (const k of e.kids) vars[local(k.name)] = attr(k, 'val') ?? '';
      return { kind: 'varLst', vars };
    }
    case 'forEach':
      return { kind: 'forEach', ...(attr(e, 'name') ? { name: attr(e, 'name') } : {}), ...(attr(e, 'ref') ? { ref: attr(e, 'ref') } : {}), ...selector(e), items: items(e) };
    case 'choose': {
      const ifs: IfBranch[] = kidsOf(e, 'if').map((i) => ({
        ...(attr(i, 'name') ? { name: attr(i, 'name') } : {}),
        ...selector(i),
        func: attr(i, 'func') ?? 'var',
        arg: attr(i, 'arg') ?? 'none',
        op: (attr(i, 'op') as IfBranch['op'] | undefined) ?? 'equ',
        val: attr(i, 'val') ?? '',
        items: items(i),
      }));
      const els = kid(e, 'else');
      return { kind: 'choose', ...(attr(e, 'name') ? { name: attr(e, 'name') } : {}), ifs, ...(els ? { else: items(els) } : {}) };
    }
    case 'layoutNode':
      return layoutNode(e);
    default:
      return null; // `extLst` y lo que no se conoce
  }
}

function layoutNode(e: El): LayoutNode {
  return {
    kind: 'layoutNode',
    name: attr(e, 'name') ?? '',
    ...(attr(e, 'styleLbl') ? { styleLbl: attr(e, 'styleLbl') } : {}),
    chOrder: attr(e, 'chOrder') === 't' ? 't' : 'b',
    ...(attr(e, 'moveWith') ? { moveWith: attr(e, 'moveWith') } : {}),
    items: items(e),
  };
}

export function parseLayoutDef(xml: string): LayoutDef {
  const root = parseXml(xml);
  const t = kid(root, 'title');
  const d = kid(root, 'desc');
  const rootNode = kid(root, 'layoutNode');
  if (!rootNode) throw new Error('El diseño no tiene un nodo raíz (layoutNode).');
  const def: LayoutDef = {
    uniqueId: attr(root, 'uniqueId') ?? '',
    title: attr(t, 'val') ?? '',
    desc: attr(d, 'val') ?? '',
    cats: kidsOf(kid(root, 'catLst'), 'cat').map((c) => ({ type: attr(c, 'type') ?? '', pri: num(attr(c, 'pri'), 0) })),
    root: layoutNode(rootNode),
  };
  if (attr(root, 'minVer')) def.minVer = attr(root, 'minVer');
  if (attr(root, 'defStyle')) def.defStyle = attr(root, 'defStyle');
  const sd = kid(root, 'sampData');
  if (sd) def.sampData = sd;
  const st = kid(root, 'styleData');
  if (st) def.styleData = st;
  const cd = kid(root, 'clrData');
  if (cd) def.clrData = cd;
  return def;
}

/** Recorre todos los nodos de diseño con nombre (los de dentro de `forEach` y `choose` también). */
export function layoutNodes(def: LayoutDef): LayoutNode[] {
  const out: LayoutNode[] = [];
  const walk = (list: LayoutItem[]) => {
    for (const it of list) {
      if (it.kind === 'layoutNode') {
        out.push(it);
        walk(it.items);
      } else if (it.kind === 'forEach') walk(it.items);
      else if (it.kind === 'choose') {
        for (const i of it.ifs) walk(i.items);
        if (it.else) walk(it.else);
      }
    }
  };
  out.push(def.root);
  walk(def.root.items);
  return out;
}
