import type { AlgDef, Constr, IfBranch, LayoutDef, LayoutItem, LayoutNode, Rule, ShapeDef } from '../layoutdef';
import { layoutNodes } from '../layoutdef';
import type { SmartTree } from '../model';
import { buildGraph, maxDepthOf, select, type DNode } from './data';

/*
 * Ejecutar un diseño sobre los datos da el árbol de presentación: un `PNode` por cada nodo de diseño instanciado (los `forEach` se
 * repiten por cada punto de datos y los `choose` se resuelven con las condiciones), con el algoritmo, la forma, las restricciones y
 * las reglas que le tocan y los puntos de datos que presenta (`presOf`). Todavía sin tamaños: eso lo hace `layout.ts`.
 */

export interface PNode {
  /** Identificador estable de este nodo de presentación (`name` + punto de datos). */
  id: string;
  def: LayoutNode;
  name: string;
  styleLbl?: string;
  /** Punto de datos de contexto con el que se instanció. */
  ctx: DNode;
  /** Puntos de datos que presenta (`presOf`). */
  present: DNode[];
  vars: Record<string, string>;
  parent?: PNode;
  children: PNode[];
  alg?: AlgDef;
  shape?: ShapeDef;
  constrs: Constr[];
  rules: Rule[];
  /** Propiedades calculadas (`w`, `h`, `l`, `t`, márgenes, tamaños de letra…), en puntos. */
  props: Map<string, number>;
  /** Propiedades que un algoritmo fijó y las restricciones ya no cambian. */
  locked?: Set<string>;
  /** Posición del rectángulo respecto del nodo padre (o del dibujo, en la raíz) y giro propio en grados. */
  x: number;
  y: number;
  rot: number;
}

const DEFAULT_VARS: Record<string, string> = { dir: 'norm' };

/** El valor de una variable de diseño: la del nodo más cercano que la declara (los nodos heredan las de sus antecesores). */
export function varOf(p: PNode, name: string): string {
  for (let n: PNode | undefined = p; n; n = n.parent) {
    const v = n.vars[name];
    if (v !== undefined && v !== '') return v;
  }
  return DEFAULT_VARS[name] ?? '';
}

function evalIf(b: IfBranch, ctx: DNode, p: PNode): boolean {
  const cmp = (left: number | string, right: string): boolean => {
    const a = typeof left === 'number' ? left : Number.isNaN(Number(left)) ? left : Number(left);
    const r = typeof a === 'number' ? Number(right) : right;
    switch (b.op) {
      case 'equ':
        return a === r;
      case 'neq':
        return a !== r;
      case 'gt':
        return a > r;
      case 'lt':
        return a < r;
      case 'gte':
        return a >= r;
      case 'lte':
        return a <= r;
    }
  };
  switch (b.func) {
    case 'var':
      return cmp(varOf(p, b.arg), b.val);
    case 'cnt':
      return cmp(select(ctx, b).length, b.val);
    case 'pos':
    case 'posEven':
    case 'posOdd':
    case 'revPos': {
      const sibs = ctx.parent ? ctx.parent.children : [ctx];
      const pos = ctx.kind === 'doc' ? 1 : (ctx.kind === 'sibTrans' || ctx.kind === 'parTrans' ? ctx.owner!.index : ctx.index) + 1;
      if (b.func === 'pos') return cmp(pos, b.val);
      if (b.func === 'revPos') return cmp(sibs.length - pos + 1, b.val);
      return b.func === 'posEven' ? pos % 2 === 0 : pos % 2 === 1;
    }
    case 'depth':
      return cmp(ctx.depth, b.val);
    case 'maxDepth': {
      let m = 0;
      for (const d of select(ctx, b)) m = Math.max(m, maxDepthOf(d));
      return cmp(m, b.val);
    }
    default:
      return false;
  }
}

/** Instancia el diseño sobre un árbol de datos y devuelve la raíz del árbol de presentación. */
export function present(def: LayoutDef, tree: SmartTree, vars: Record<string, string> = {}): PNode {
  const graph = buildGraph(tree);
  const named = new Map<string, LayoutItem[]>();
  // los `forEach` con nombre se pueden repetir en otro sitio con `ref`
  const index = (list: LayoutItem[]) => {
    for (const it of list) {
      if (it.kind === 'forEach') {
        if (it.name && it.items.length) named.set(it.name, it.items);
        index(it.items);
      } else if (it.kind === 'choose') {
        it.ifs.forEach((i) => index(i.items));
        if (it.else) index(it.else);
      } else if (it.kind === 'layoutNode') index(it.items);
    }
  };
  index([def.root]);
  void layoutNodes;
  let seq = 0;
  const make = (ln: LayoutNode, ctx: DNode, parent?: PNode): PNode => {
    const p: PNode = { id: `${ln.name}#${++seq}`, def: ln, name: ln.name, ...(ln.styleLbl ? { styleLbl: ln.styleLbl } : {}), ctx, present: [], vars: {}, parent, children: [], constrs: [], rules: [], props: new Map(), x: 0, y: 0, rot: 0 };
    parent?.children.push(p);
    return p;
  };
  const run = (items: LayoutItem[], ctx: DNode, p: PNode) => {
    for (const it of items) {
      switch (it.kind) {
        case 'alg':
          p.alg = it;
          break;
        case 'shape':
          p.shape = it;
          break;
        case 'presOf':
          p.present = select(ctx, it);
          break;
        case 'constrLst':
          p.constrs.push(...it.items);
          break;
        case 'ruleLst':
          p.rules.push(...it.items);
          break;
        case 'varLst':
          // lo que viene de los datos (p. ej. `dir`) manda sobre el valor por omisión del diseño
          for (const [k, v] of Object.entries(it.vars)) if (p.vars[k] === undefined || p.vars[k] === '') p.vars[k] = v;
          break;
        case 'forEach': {
          const body = it.ref ? (named.get(it.ref) ?? []) : it.items;
          for (const pt of select(ctx, it)) run(body, pt, p);
          break;
        }
        case 'choose': {
          const hit = it.ifs.find((b) => evalIf(b, ctx, p));
          if (hit) run(hit.items, ctx, p);
          else if (it.else) run(it.else, ctx, p);
          break;
        }
        case 'layoutNode': {
          const child = make(it, ctx, p);
          run(it.items, ctx, child);
          break;
        }
      }
    }
  };
  const root = make(def.root, graph.doc);
  Object.assign(root.vars, vars);
  run(def.root.items, graph.doc, root);
  return root;
}

/** Todos los nodos del árbol de presentación en orden de recorrido (el padre antes que sus hijos). */
export function allNodes(root: PNode): PNode[] {
  const out: PNode[] = [];
  const walk = (n: PNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}
