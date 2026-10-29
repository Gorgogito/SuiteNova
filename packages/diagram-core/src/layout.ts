import { descendantsOf, settleContainers } from './container';
import { boundsOf, unionRects, type Rect } from './geometry';
import { topGroupId, groupMembers } from './groups';
import { isGlued, type Page } from './model';


/*
 * Automatic layout. Shapes are placed by an algorithm from the connectors between them. The unit that moves is a "node": a
 * shape, a whole group, or a container with everything inside it. Connectors are not moved (they follow their shapes).
 */

export type LayoutKind = 'layered' | 'tree' | 'radial' | 'circular' | 'grid' | 'organic';
export type LayoutDir = 'TB' | 'BT' | 'LR' | 'RL';

export interface LayoutOptions {
  kind: LayoutKind;
  /** Direction of the layers (layered, tree). */
  dir?: LayoutDir;
  /** Space between neighbours in a layer / ring. */
  gapX?: number;
  /** Space between layers. */
  gapY?: number;
  /** Only these shapes (with their groups and contents) are laid out; the whole page by default. */
  ids?: string[];
}

export const LAYOUT_KINDS: LayoutKind[] = ['layered', 'tree', 'radial', 'circular', 'grid', 'organic'];

interface Node {
  id: string;
  /** Shapes that move with the node. */
  members: string[];
  rect: Rect;
  edges: Set<string>;
}

/** The nodes of the page and the connectors between them. */
function graphOf(page: Page, ids?: string[]): { nodes: Node[]; edges: [string, string][] } {
  const wanted = ids ? new Set(ids) : null;
  const byId = new Map(page.shapes.map((s) => [s.id, s]));
  // the node a shape belongs to: its outermost container, or its outermost group, or itself
  const nodeOf = new Map<string, string>();
  const root = (id: string): string => {
    let cur = byId.get(id)!;
    for (let guard = 0; cur.parent && byId.has(cur.parent) && guard < 50; guard++) cur = byId.get(cur.parent)!;
    return cur.id;
  };
  const nodes = new Map<string, Node>();
  for (const s of page.shapes) {
    const top = byId.get(root(s.id))!;
    const g = topGroupId(page, top);
    const key = g ? `g:${g}` : top.id;
    nodeOf.set(s.id, key);
    if (!nodes.has(key)) nodes.set(key, { id: key, members: [], rect: { x: 0, y: 0, w: 0, h: 0 }, edges: new Set() });
    nodes.get(key)!.members.push(s.id);
  }
  for (const n of nodes.values()) {
    const ms = new Set<string>(n.members);
    // a group takes all its shapes, a container everything inside it
    if (n.id.startsWith('g:')) for (const m of groupMembers(page, n.id.slice(2))) ms.add(m.id);
    for (const m of [...ms]) if (byId.get(m)?.container) for (const d of descendantsOf(page, m)) ms.add(d.id);
    n.members = [...ms];
    n.rect = unionRects(n.members.map((m) => boundsOf(byId.get(m)!)))!;
  }
  let list = [...nodes.values()];
  if (wanted) list = list.filter((n) => n.members.some((m) => wanted.has(m)));
  const keep = new Set(list.map((n) => n.id));
  const edges: [string, string][] = [];
  for (const c of page.connectors) {
    if (!isGlued(c.from) || !isGlued(c.to)) continue;
    const a = nodeOf.get(c.from.shape);
    const b = nodeOf.get(c.to.shape);
    if (!a || !b || a === b || !keep.has(a) || !keep.has(b)) continue;
    edges.push([a, b]);
  }
  for (const [a, b] of edges) {
    nodes.get(a)!.edges.add(b);
    nodes.get(b)!.edges.add(a);
  }
  return { nodes: list, edges };
}

type Pos = Map<string, { x: number; y: number }>;

// ------------------------------------------------------------------------------------------------ layered

/** Layers by longest path from the sources, after cycles are broken by reversing the edges that close them. */
function ranks(nodes: Node[], edges: [string, string][]): { rank: Map<string, number>; dag: [string, string][] } {
  const out = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const [a, b] of edges) out.get(a)!.push(b);
  const state = new Map<string, 0 | 1 | 2>();
  const dag: [string, string][] = [];
  const visit = (u: string) => {
    state.set(u, 1);
    for (const v of out.get(u)!) {
      const st = state.get(v) ?? 0;
      if (st === 1) dag.push([v, u]);
      else {
        dag.push([u, v]);
        if (st === 0) visit(v);
      }
    }
    state.set(u, 2);
  };
  for (const n of nodes) if (!state.has(n.id)) visit(n.id);
  const rank = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const incoming = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const [a, b] of dag) incoming.get(b)!.push(a);
  const done = new Set<string>();
  const rk = (u: string): number => {
    if (done.has(u)) return rank.get(u)!;
    done.add(u);
    let r = 0;
    for (const p of incoming.get(u)!) r = Math.max(r, rk(p) + 1);
    rank.set(u, r);
    return r;
  };
  for (const n of nodes) rk(n.id);
  return { rank, dag };
}

function layered(nodes: Node[], edges: [string, string][], o: Required<Pick<LayoutOptions, 'dir' | 'gapX' | 'gapY'>>): Pos {
  const { rank, dag } = ranks(nodes, edges);
  const horizontal = o.dir === 'LR' || o.dir === 'RL';
  // sizes along and across the layers
  const across = (n: Node) => (horizontal ? n.rect.h : n.rect.w);
  const along = (n: Node) => (horizontal ? n.rect.w : n.rect.h);
  const layers: Node[][] = [];
  for (const n of nodes) (layers[rank.get(n.id)!] ??= []).push(n);
  const present = layers.map((l) => l ?? []);
  const cur = new Map<string, number>();
  // start from the order the shapes already have across the layers
  present.forEach((l) => {
    l.sort((a, b) => (horizontal ? a.rect.y - b.rect.y : a.rect.x - b.rect.x));
    l.forEach((n, i) => cur.set(n.id, i));
  });
  const up = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const down = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const [a, b] of dag) {
    down.get(a)!.push(b);
    up.get(b)!.push(a);
  }
  // barycentre sweeps to reduce crossings
  for (let sweep = 0; sweep < 8; sweep++) {
    const order = sweep % 2 === 0 ? present.map((_, i) => i) : present.map((_, i) => present.length - 1 - i);
    for (const li of order) {
      const l = present[li]!;
      const nb = sweep % 2 === 0 ? up : down;
      const bary = new Map<string, number>();
      for (const n of l) {
        const ns = nb.get(n.id)!;
        bary.set(n.id, ns.length ? ns.reduce((a, id) => a + cur.get(id)!, 0) / ns.length : cur.get(n.id)!);
      }
      l.sort((a, b) => bary.get(a.id)! - bary.get(b.id)! || cur.get(a.id)! - cur.get(b.id)!);
      l.forEach((n, i) => cur.set(n.id, i));
    }
  }
  // position across: pack each layer, then pull nodes toward the centre of their neighbours
  const pos = new Map<string, number>();
  const widths = present.map((l) => l.reduce((a, n) => a + across(n), 0) + Math.max(0, l.length - 1) * o.gapX);
  const widest = Math.max(0, ...widths);
  present.forEach((l, li) => {
    let p = (widest - widths[li]!) / 2;
    for (const n of l) {
      pos.set(n.id, p + across(n) / 2);
      p += across(n) + o.gapX;
    }
  });
  const centre = (ids: string[]) => ids.reduce((a, id) => a + pos.get(id)!, 0) / ids.length;
  for (let it = 0; it < 6; it++) {
    for (const li of it % 2 === 0 ? present.map((_, i) => i) : present.map((_, i) => present.length - 1 - i)) {
      const l = present[li]!;
      const want = l.map((n) => {
        const ns = it % 2 === 0 ? up.get(n.id)! : down.get(n.id)!;
        return ns.length ? centre(ns) : pos.get(n.id)!;
      });
      // keep the order and the gaps: place each node as close to what it wants as the previous one allows
      let min = -Infinity;
      l.forEach((n, i) => {
        const half = across(n) / 2;
        const p = Math.max(want[i]!, min + half);
        pos.set(n.id, p);
        min = p + half + o.gapX;
      });
      // and pull back from the right so a layer does not drift away
      let max = Infinity;
      for (let i = l.length - 1; i >= 0; i--) {
        const n = l[i]!;
        const half = across(n) / 2;
        const p = Math.min(pos.get(n.id)!, max - half);
        pos.set(n.id, p);
        max = p - half - o.gapX;
      }
    }
  }
  // positions along the layers
  const result: Pos = new Map();
  let at = 0;
  const extent = present.map((l) => Math.max(0, ...l.map(along)));
  present.forEach((l, li) => {
    for (const n of l) {
      const a = at + (extent[li]! - along(n)) / 2;
      const c = pos.get(n.id)! - across(n) / 2;
      result.set(n.id, horizontal ? { x: a, y: c } : { x: c, y: a });
    }
    at += extent[li]! + o.gapY;
  });
  // reversed directions
  if (o.dir === 'BT' || o.dir === 'RL') {
    const total = at - o.gapY;
    for (const n of nodes) {
      const p = result.get(n.id)!;
      result.set(n.id, o.dir === 'BT' ? { x: p.x, y: total - p.y - n.rect.h } : { x: total - p.x - n.rect.w, y: p.y });
    }
  }
  return result;
}

// ------------------------------------------------------------------------------------------------ trees

interface TreeNode {
  id: string;
  children: TreeNode[];
}

/** A spanning forest: roots are the nodes nothing points to (the most connected one when there are none); children in reading order. */
function forestOf(nodes: Node[], edges: [string, string][]): TreeNode[] {
  const out = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (const [a, b] of edges) {
    out.get(a)!.push(b);
    indeg.set(b, indeg.get(b)! + 1);
  }
  const by = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const build = (id: string): TreeNode => {
    seen.add(id);
    const kids = [...new Set(out.get(id)!)].filter((k) => !seen.has(k)).sort((a, b) => by.get(a)!.rect.x - by.get(b)!.rect.x || by.get(a)!.rect.y - by.get(b)!.rect.y);
    const node: TreeNode = { id, children: [] };
    for (const k of kids) if (!seen.has(k)) node.children.push(build(k));
    return node;
  };
  const roots: TreeNode[] = [];
  const order = [...nodes].sort((a, b) => indeg.get(a.id)! - indeg.get(b.id)! || b.edges.size - a.edges.size || a.rect.x - b.rect.x);
  for (const n of order) if (!seen.has(n.id) && indeg.get(n.id) === 0) roots.push(build(n.id));
  for (const n of order) if (!seen.has(n.id)) roots.push(build(n.id));
  return roots;
}

function tree(nodes: Node[], edges: [string, string][], o: Required<Pick<LayoutOptions, 'dir' | 'gapX' | 'gapY'>>): Pos {
  const horizontal = o.dir === 'LR' || o.dir === 'RL';
  const by = new Map(nodes.map((n) => [n.id, n]));
  const across = (id: string) => (horizontal ? by.get(id)!.rect.h : by.get(id)!.rect.w);
  const along = (id: string) => (horizontal ? by.get(id)!.rect.w : by.get(id)!.rect.h);
  const forest = forestOf(nodes, edges);
  const span = new Map<string, number>();
  const measure = (t: TreeNode): number => {
    const kids = t.children.map(measure);
    const w = kids.length ? kids.reduce((a, b) => a + b, 0) + (kids.length - 1) * o.gapX : 0;
    span.set(t.id, Math.max(across(t.id), w));
    return span.get(t.id)!;
  };
  forest.forEach(measure);
  const depthExtent: number[] = [];
  const depthOf = new Map<string, number>();
  const walk = (t: TreeNode, d: number) => {
    depthOf.set(t.id, d);
    depthExtent[d] = Math.max(depthExtent[d] ?? 0, along(t.id));
    t.children.forEach((c) => walk(c, d + 1));
  };
  forest.forEach((t) => walk(t, 0));
  const starts: number[] = [];
  let acc = 0;
  depthExtent.forEach((e, i) => {
    starts[i] = acc;
    acc += e + o.gapY;
  });
  const centreAcross = new Map<string, number>();
  const place = (t: TreeNode, left: number) => {
    const w = span.get(t.id)!;
    const kidsW = t.children.length ? t.children.reduce((a, c) => a + span.get(c.id)!, 0) + (t.children.length - 1) * o.gapX : 0;
    let p = left + (w - kidsW) / 2;
    for (const c of t.children) {
      place(c, p);
      p += span.get(c.id)! + o.gapX;
    }
    // a parent is centred between its first and last child (a leaf, in the middle of its own space)
    centreAcross.set(t.id, t.children.length ? (centreAcross.get(t.children[0]!.id)! + centreAcross.get(t.children[t.children.length - 1]!.id)!) / 2 : left + w / 2);
  };
  let offset = 0;
  for (const t of forest) {
    place(t, offset);
    offset += span.get(t.id)! + o.gapX * 2;
  }
  const result: Pos = new Map();
  const total = acc - o.gapY;
  for (const n of nodes) {
    const d = depthOf.get(n.id)!;
    const a = starts[d]! + (depthExtent[d]! - along(n.id)) / 2;
    const c = centreAcross.get(n.id)! - across(n.id) / 2;
    let x = horizontal ? a : c;
    let y = horizontal ? c : a;
    if (o.dir === 'BT') y = total - y - n.rect.h;
    if (o.dir === 'RL') x = total - x - n.rect.w;
    result.set(n.id, { x, y });
  }
  return result;
}

function radial(nodes: Node[], edges: [string, string][], o: Required<Pick<LayoutOptions, 'gapX' | 'gapY'>>): Pos {
  const by = new Map(nodes.map((n) => [n.id, n]));
  const forest = forestOf(nodes, edges);
  const leaves = new Map<string, number>();
  const count = (t: TreeNode): number => {
    const l = t.children.length ? t.children.reduce((a, c) => a + count(c), 0) : 1;
    leaves.set(t.id, l);
    return l;
  };
  forest.forEach(count);
  const size = Math.max(0, ...nodes.map((n) => Math.max(n.rect.w, n.rect.h)));
  const ring = size + o.gapY;
  const result: Pos = new Map();
  let cx = 0;
  for (const t of forest) {
    let depth = 0;
    const maxDepth = (x: TreeNode, d: number): number => Math.max(d, ...x.children.map((c) => maxDepth(c, d + 1)));
    depth = maxDepth(t, 0);
    const R = ring * depth + size;
    const place = (x: TreeNode, a0: number, a1: number, d: number) => {
      const a = (a0 + a1) / 2;
      const n = by.get(x.id)!;
      result.set(x.id, { x: cx + R + Math.cos(a) * ring * d - n.rect.w / 2, y: R + Math.sin(a) * ring * d - n.rect.h / 2 });
      let p = a0;
      for (const c of x.children) {
        const share = ((a1 - a0) * leaves.get(c.id)!) / leaves.get(x.id)!;
        place(c, p, p + share, d + 1);
        p += share;
      }
    };
    place(t, -Math.PI / 2, (3 * Math.PI) / 2, 0);
    cx += 2 * R + o.gapX;
  }
  return result;
}

// ------------------------------------------------------------------------------------------------ circle, grid, force

/** Breadth-first order from the most connected node, so that neighbours end up next to each other. */
function bfsOrder(nodes: Node[], edges: [string, string][]): Node[] {
  const adj = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const [a, b] of edges) {
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  const by = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const out: Node[] = [];
  for (const start of [...nodes].sort((a, b) => b.edges.size - a.edges.size || a.rect.x - b.rect.x)) {
    if (seen.has(start.id)) continue;
    const q = [start.id];
    seen.add(start.id);
    while (q.length) {
      const u = q.shift()!;
      out.push(by.get(u)!);
      for (const v of adj.get(u)!) if (!seen.has(v)) {
        seen.add(v);
        q.push(v);
      }
    }
  }
  return out;
}

function circular(nodes: Node[], edges: [string, string][], o: Required<Pick<LayoutOptions, 'gapX'>>): Pos {
  const list = bfsOrder(nodes, edges);
  const n = list.length;
  const perimeter = list.reduce((a, m) => a + Math.max(m.rect.w, m.rect.h) + o.gapX, 0);
  const R = Math.max(n > 1 ? perimeter / (2 * Math.PI) : 0, 40);
  const result: Pos = new Map();
  list.forEach((m, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    result.set(m.id, { x: R + Math.cos(a) * R - m.rect.w / 2, y: R + Math.sin(a) * R - m.rect.h / 2 });
  });
  return result;
}

function grid(nodes: Node[], o: Required<Pick<LayoutOptions, 'gapX' | 'gapY'>>): Pos {
  const list = [...nodes].sort((a, b) => Math.round(a.rect.y / 40) - Math.round(b.rect.y / 40) || a.rect.x - b.rect.x);
  const cols = Math.max(1, Math.ceil(Math.sqrt(list.length)));
  const cw = Math.max(0, ...list.map((n) => n.rect.w)) + o.gapX;
  const rh = Math.max(0, ...list.map((n) => n.rect.h)) + o.gapY;
  const result: Pos = new Map();
  list.forEach((n, i) => result.set(n.id, { x: (i % cols) * cw + (cw - o.gapX - n.rect.w) / 2, y: Math.floor(i / cols) * rh + (rh - o.gapY - n.rect.h) / 2 }));
  return result;
}

/** Force-directed placement (Fruchterman–Reingold): connected nodes attract, all repel; starts from where the shapes are, so it is repeatable. */
function organic(nodes: Node[], edges: [string, string][], o: Required<Pick<LayoutOptions, 'gapX' | 'gapY'>>): Pos {
  const n = nodes.length;
  const idx = new Map(nodes.map((m, i) => [m.id, i]));
  const px = nodes.map((m, i) => m.rect.x + m.rect.w / 2 + ((i * 37) % 11) * 0.7);
  const py = nodes.map((m, i) => m.rect.y + m.rect.h / 2 + ((i * 53) % 13) * 0.7);
  const size = Math.max(40, ...nodes.map((m) => Math.max(m.rect.w, m.rect.h)));
  const k = size + (o.gapX + o.gapY) / 2;
  const e = edges.map(([a, b]) => [idx.get(a)!, idx.get(b)!] as const);
  let temp = k * 2;
  for (let it = 0; it < 220; it++) {
    const dx = new Array<number>(n).fill(0);
    const dy = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let vx = px[i]! - px[j]!;
        let vy = py[i]! - py[j]!;
        let d = Math.hypot(vx, vy);
        if (d < 0.01) {
          vx = 0.5 + i * 0.01;
          vy = 0.5;
          d = Math.hypot(vx, vy);
        }
        const f = (k * k) / d;
        dx[i]! += (vx / d) * f;
        dy[i]! += (vy / d) * f;
        dx[j]! -= (vx / d) * f;
        dy[j]! -= (vy / d) * f;
      }
    }
    for (const [a, b] of e) {
      const vx = px[a]! - px[b]!;
      const vy = py[a]! - py[b]!;
      const d = Math.max(0.01, Math.hypot(vx, vy));
      const f = (d * d) / k;
      dx[a]! -= (vx / d) * f;
      dy[a]! -= (vy / d) * f;
      dx[b]! += (vx / d) * f;
      dy[b]! += (vy / d) * f;
    }
    for (let i = 0; i < n; i++) {
      const d = Math.max(0.01, Math.hypot(dx[i]!, dy[i]!));
      const m = Math.min(d, temp);
      px[i]! += (dx[i]! / d) * m;
      py[i]! += (dy[i]! / d) * m;
    }
    temp *= 0.97;
  }
  const result: Pos = new Map();
  nodes.forEach((m, i) => result.set(m.id, { x: px[i]! - m.rect.w / 2, y: py[i]! - m.rect.h / 2 }));
  return result;
}

// ------------------------------------------------------------------------------------------------ apply

/** Moves the shapes into their new places; the result is shifted so that its top left stays where the old drawing's was. */
export function autoLayout(page: Page, opts: LayoutOptions): Page {
  const o = { dir: opts.dir ?? 'TB', gapX: opts.gapX ?? 40, gapY: opts.gapY ?? 70 };
  const { nodes, edges } = graphOf(page, opts.ids);
  if (nodes.length < 2) return page;
  let pos: Pos;
  switch (opts.kind) {
    case 'layered': pos = layered(nodes, edges, o); break;
    case 'tree': pos = tree(nodes, edges, o); break;
    case 'radial': pos = radial(nodes, edges, o); break;
    case 'circular': pos = circular(nodes, edges, o); break;
    case 'grid': pos = grid(nodes, o); break;
    case 'organic': pos = organic(nodes, edges, o); break;
  }
  // components that are not connected to each other are placed side by side by the algorithms that do not do it themselves
  const old = unionRects(nodes.map((n) => n.rect))!;
  const placed = unionRects(nodes.map((n) => ({ ...pos.get(n.id)!, w: n.rect.w, h: n.rect.h })))!;
  const dx0 = old.x - placed.x;
  const dy0 = old.y - placed.y;
  const move = new Map<string, { dx: number; dy: number }>();
  for (const n of nodes) {
    const p = pos.get(n.id)!;
    const d = { dx: p.x + dx0 - n.rect.x, dy: p.y + dy0 - n.rect.y };
    for (const m of n.members) move.set(m, d);
  }
  const shapes = page.shapes.map((s) => {
    const d = move.get(s.id);
    return d && !s.locked ? { ...s, x: s.x + d.dx, y: s.y + d.dy } : s;
  });
  let q: Page = { ...page, shapes };
  q = settleContainers(q);
  // the drawing may now be larger than the page
  const all = unionRects(q.shapes.map(boundsOf));
  if (all && (all.x + all.w + 40 > q.width || all.y + all.h + 40 > q.height)) q = { ...q, width: Math.max(q.width, Math.ceil(all.x + all.w + 40)), height: Math.max(q.height, Math.ceil(all.y + all.h + 40)) };
  return q;
}

/** Lets glued connectors choose their connection points again (so that they leave and arrive on the sides that face each other). */
export function resetPorts(page: Page, ids?: string[]): Page {
  const set = ids ? new Set(ids) : null;
  return {
    ...page,
    connectors: page.connectors.map((c) => {
      if (!isGlued(c.from) && !isGlued(c.to)) return c;
      if (set && !((isGlued(c.from) && set.has(c.from.shape)) || (isGlued(c.to) && set.has(c.to.shape)))) return c;
      return { ...c, from: isGlued(c.from) ? { shape: c.from.shape, port: 'auto' as const } : c.from, to: isGlued(c.to) ? { shape: c.to.shape, port: 'auto' as const } : c.to };
    }),
  };
}
