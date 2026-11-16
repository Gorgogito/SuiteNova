import type { ElementType, Selector } from '../layoutdef';
import type { SmartNode, SmartTree } from '../model';

/*
 * El modelo de datos tal como lo ve un diseño: puntos con padre, hijos y transiciones. Cada nodo tiene una transición de padre
 * (`parTrans`, la que lo une a su padre) y una de hermano (`sibTrans`, la que lo une al siguiente). Los ejes (`ch`, `followSib`,
 * `desOrSelf`…) y los tipos de punto se evalúan desde un punto de contexto, como en ECMA-376 §21.4.7.
 */

export type DKind = 'doc' | 'node' | 'asst' | 'parTrans' | 'sibTrans';

export interface DNode {
  id: string;
  kind: DKind;
  /** El nodo del árbol de contenido (los puntos de transición no lo tienen). */
  node?: SmartNode;
  /** Nodo al que pertenece una transición. */
  owner?: DNode;
  parent?: DNode;
  /** Hijos (nodos y ayudantes) en orden. */
  children: DNode[];
  parTrans?: DNode;
  sibTrans?: DNode;
  /** Posición entre sus hermanos (0-based) y profundidad (el documento es 0, el primer nivel 1). */
  index: number;
  depth: number;
}

export interface DataGraph {
  doc: DNode;
}

export function buildGraph(tree: SmartTree): DataGraph {
  const doc: DNode = { id: tree.docId, kind: 'doc', children: [], index: 0, depth: 0 };
  const build = (parent: DNode, list: SmartNode[]) => {
    list.forEach((n, i) => {
      const d: DNode = { id: n.id, kind: n.type === 'asst' ? 'asst' : 'node', node: n, parent, children: [], index: i, depth: parent.depth + 1 };
      d.parTrans = { id: `${n.id}:par`, kind: 'parTrans', owner: d, parent, children: [], index: i, depth: d.depth };
      d.sibTrans = { id: `${n.id}:sib`, kind: 'sibTrans', owner: d, parent, children: [], index: i, depth: d.depth };
      parent.children.push(d);
      build(d, n.children);
    });
  };
  build(doc, tree.roots);
  return { doc };
}

const isContent = (d: DNode) => d.kind === 'node' || d.kind === 'asst';

/** ¿Cumple el punto el tipo de elemento pedido? */
export function matchesType(d: DNode, t: ElementType): boolean {
  switch (t) {
    case 'all':
      return true;
    case 'doc':
      return d.kind === 'doc';
    case 'node':
      return d.kind === 'node';
    case 'asst':
      return d.kind === 'asst';
    case 'norm':
      return isContent(d);
    case 'nonNorm':
      return !isContent(d);
    case 'nonAsst':
      return d.kind !== 'asst';
    case 'parTrans':
      return d.kind === 'parTrans';
    case 'sibTrans':
      return d.kind === 'sibTrans';
    case 'pres':
      return false;
  }
}

/** Para cada hijo, en orden: su transición de padre, él mismo y su transición de hermano (así recorre `ch` los tipos `all`). */
function withTrans(list: DNode[]): DNode[] {
  const out: DNode[] = [];
  for (const c of list) out.push(c.parTrans!, c, c.sibTrans!);
  return out;
}

function descendants(d: DNode): DNode[] {
  const out: DNode[] = [];
  const walk = (x: DNode) => {
    for (const c of x.children) {
      out.push(c);
      walk(c);
    }
  };
  walk(d);
  return out;
}

/** Los puntos de un eje a partir de `ctx`, ya filtrados por tipo. `hideLast` quita la transición de hermano del último nodo. */
export function axisPoints(ctx: DNode, axis: string, type: ElementType, hideLast: boolean): DNode[] {
  let pts: DNode[];
  switch (axis) {
    case 'self':
      pts = [ctx];
      break;
    case 'ch':
      pts = withTrans(ctx.children);
      break;
    case 'des':
      pts = withTrans(descendants(ctx));
      break;
    case 'desOrSelf':
      pts = [ctx, ...withTrans(descendants(ctx))];
      break;
    case 'par':
      pts = ctx.kind === 'parTrans' || ctx.kind === 'sibTrans' ? (ctx.parent ? [ctx.parent] : []) : ctx.parent ? [ctx.parent] : [];
      break;
    case 'root':
      pts = [rootOf(ctx)];
      break;
    case 'ancst': {
      pts = [];
      for (let p = ctx.parent; p; p = p.parent) pts.push(p);
      break;
    }
    case 'ancstOrSelf': {
      pts = [ctx];
      for (let p = ctx.parent; p; p = p.parent) pts.push(p);
      break;
    }
    case 'followSib': {
      const o = ctx.kind === 'sibTrans' || ctx.kind === 'parTrans' ? ctx.owner! : ctx;
      const after = o.parent ? o.parent.children.slice(o.index + 1) : [];
      // la transición de hermano del propio nodo es la primera de las que le siguen
      pts = type === 'sibTrans' ? [o.sibTrans!, ...after.map((s) => s.sibTrans!)] : type === 'parTrans' ? after.map((s) => s.parTrans!) : after;
      break;
    }
    case 'precedSib': {
      const o = ctx.kind === 'sibTrans' || ctx.kind === 'parTrans' ? ctx.owner! : ctx;
      pts = o.parent ? o.parent.children.slice(0, o.index).reverse() : [];
      break;
    }
    case 'follow':
    case 'preced': {
      const all = [rootOf(ctx), ...descendants(rootOf(ctx))];
      const i = all.indexOf(ctx);
      pts = axis === 'follow' ? all.slice(i + 1) : all.slice(0, i).reverse();
      break;
    }
    default:
      pts = [];
  }
  let out = pts.filter((p) => matchesType(p, type));
  if (hideLast) out = out.filter((p) => !(p.kind === 'sibTrans' && p.owner!.parent && p.owner!.index === p.owner!.parent.children.length - 1));
  return out;
}

export function rootOf(d: DNode): DNode {
  let x = d;
  while (x.parent) x = x.parent;
  return x;
}

/**
 * Aplica un selector (listas paralelas de eje, tipo, inicio, número y paso) desde `ctx`: cada paso parte de los resultados del anterior.
 * `st` empieza en 1 (0 y 1 significan «desde el primero»); `cnt` 0 significa «todos».
 */
export function select(ctx: DNode, s: Selector): DNode[] {
  let cur = [ctx];
  const steps = Math.max(s.axis.length, s.ptType.length);
  for (let i = 0; i < steps; i++) {
    const axis = s.axis[Math.min(i, s.axis.length - 1)]!;
    const type = s.ptType[Math.min(i, s.ptType.length - 1)]!;
    const hide = s.hideLastTrans[Math.min(i, s.hideLastTrans.length - 1)]!;
    const st = s.st[Math.min(i, s.st.length - 1)]!;
    const cnt = s.cnt[Math.min(i, s.cnt.length - 1)]!;
    const step = Math.max(1, s.step[Math.min(i, s.step.length - 1)]!);
    const next: DNode[] = [];
    for (const c of cur) {
      if (axis === 'none') continue;
      let pts = axisPoints(c, axis, type, hide);
      pts = pts.slice(Math.max(st, 1) - 1).filter((_, k) => k % step === 0);
      if (cnt > 0) pts = pts.slice(0, cnt);
      next.push(...pts);
    }
    cur = next;
  }
  return cur;
}

/** Profundidad máxima de los descendientes de `d` (contando desde el documento: el primer nivel es 1). */
export function maxDepthOf(d: DNode): number {
  let m = d.depth;
  for (const c of descendants(d)) m = Math.max(m, c.depth);
  return m;
}
