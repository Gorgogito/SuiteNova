import { isSummary, type LinkType, type Project } from './model';
import type { Schedule } from './schedule';

export interface NetNode {
  id: string;
  index: number;
  col: number;
  row: number;
  x: number;
  y: number;
  w: number;
  h: number;
  critical: boolean;
  milestone: boolean;
}

export interface NetEdge {
  from: string;
  to: string;
  type: LinkType;
  critical: boolean;
  points: { x: number; y: number }[];
}

export interface NetLayout {
  nodes: NetNode[];
  edges: NetEdge[];
  width: number;
  height: number;
}

export interface NetOptions {
  nodeW?: number;
  nodeH?: number;
  gapX?: number;
  gapY?: number;
}

/**
 * Precedence diagram (PERT): a box per task, in columns by the longest chain of predecessors, links drawn as orthogonal
 * lines. Summary tasks are not drawn (they are not linked). Within a column the order follows the predecessors.
 */
export function networkLayout(p: Project, s: Schedule, opts: NetOptions = {}): NetLayout {
  const W = opts.nodeW ?? 176;
  const H = opts.nodeH ?? 78;
  const GX = opts.gapX ?? 56;
  const GY = opts.gapY ?? 22;
  const ids = p.tasks.map((t) => t.id);
  const idx = new Map(ids.map((id, i) => [id, i]));
  const leaf = p.tasks.map((_, i) => !isSummary(p.tasks, i));
  const preds: number[][] = p.tasks.map(() => []);
  p.tasks.forEach((t, j) => {
    if (!leaf[j]) return;
    for (const l of t.links) {
      const i = idx.get(l.task);
      if (i !== undefined && leaf[i] && i !== j) preds[j]!.push(i);
    }
  });

  // level = longest chain of predecessors (a cycle is cut where it is found)
  const level = new Array<number>(p.tasks.length).fill(-1);
  const visiting = new Set<number>();
  const lv = (i: number): number => {
    if (level[i]! >= 0) return level[i]!;
    if (visiting.has(i)) return 0;
    visiting.add(i);
    let m = 0;
    for (const a of preds[i]!) m = Math.max(m, lv(a) + 1);
    visiting.delete(i);
    level[i] = m;
    return m;
  };
  const rows = p.tasks.map((_, i) => i).filter((i) => leaf[i]);
  for (const i of rows) lv(i);
  const cols: number[][] = [];
  for (const i of rows) (cols[level[i]!] ??= []).push(i);
  const rowOf = new Map<number, number>();
  cols.forEach((c) => c?.sort((a, b) => s.tasks[a]!.start - s.tasks[b]!.start || a - b));
  // a few sweeps to put each task near the average position of its predecessors
  for (let sweep = 0; sweep < 3; sweep++) {
    cols.forEach((c, ci) => {
      if (!c) return;
      if (ci > 0) {
        const bary = (i: number) => {
          const ps = preds[i]!.filter((a) => rowOf.has(a));
          return ps.length ? ps.reduce((a, x) => a + rowOf.get(x)!, 0) / ps.length : Infinity;
        };
        c.sort((a, b) => {
          const x = bary(a);
          const y = bary(b);
          return (Number.isFinite(x) ? x : 1e9) - (Number.isFinite(y) ? y : 1e9) || s.tasks[a]!.start - s.tasks[b]!.start || a - b;
        });
      }
      c.forEach((i, r) => rowOf.set(i, r));
    });
  }

  const nodes: NetNode[] = [];
  const pos = new Map<number, NetNode>();
  cols.forEach((c, ci) => {
    if (!c) return;
    c.forEach((i, r) => {
      const st = s.tasks[i]!;
      const node: NetNode = { id: ids[i]!, index: i, col: ci, row: r, x: ci * (W + GX), y: r * (H + GY), w: W, h: H, critical: st.critical, milestone: st.milestone };
      nodes.push(node);
      pos.set(i, node);
    });
  });

  const edges: NetEdge[] = [];
  p.tasks.forEach((t, j) => {
    const b = pos.get(j);
    if (!b) return;
    t.links.forEach((l, k) => {
      const i = idx.get(l.task);
      const a = i === undefined ? undefined : pos.get(i);
      if (!a || i === undefined) return;
      const fromEnd = l.type === 'FS' || l.type === 'FF';
      const toStart = l.type === 'FS' || l.type === 'SS';
      const x1 = fromEnd ? a.x + a.w : a.x;
      const y1 = a.y + a.h / 2;
      const x2 = toStart ? b.x : b.x + b.w;
      const y2 = b.y + b.h / 2;
      // the vertical segment sits in the gap before the target column, shifted a little per link so they do not overlap
      const gapStart = b.x - GX;
      const xm = toStart ? Math.max(x1 + 8, gapStart + 10 + ((k * 7) % (GX - 20))) : Math.max(x1, x2) + 14;
      const pts = [{ x: x1, y: y1 }, { x: fromEnd ? Math.max(x1 + 10, Math.min(xm, x2 - 10)) : x1 - 10, y: y1 }];
      pts.push({ x: pts[1]!.x, y: y2 });
      pts.push({ x: x2, y: y2 });
      edges.push({ from: ids[i]!, to: t.id, type: l.type, critical: s.tasks[i]!.critical && s.tasks[j]!.critical, points: pts });
    });
  });

  const width = nodes.length ? Math.max(...nodes.map((n) => n.x + n.w)) + 20 : 0;
  const height = nodes.length ? Math.max(...nodes.map((n) => n.y + n.h)) + 20 : 0;
  return { nodes, edges, width, height };
}
