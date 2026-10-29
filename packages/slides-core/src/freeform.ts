import { newId } from './defaults';
import { SHAPE_STYLE } from './factory';
import { geometryOf } from './geometry/custom';
import type { CustPath, Geometry, ShapeEl, Xfrm } from './types';

/*
 * Freeform shapes and edit points. A path is edited as subpaths of nodes, each with optional Bézier handles (absolute positions in
 * the shape's own coordinates, in points). Any geometry (preset or custom) can be turned into nodes; nodes are written back as a
 * custom geometry (`a:custGeom`), which is what PowerPoint stores for freeforms.
 */

export interface Pt {
  x: number;
  y: number;
}
export type NodeKind = 'corner' | 'smooth' | 'symmetric';
export interface PathNode extends Pt {
  hin?: Pt;
  hout?: Pt;
  kind?: NodeKind;
}
export interface SubPath {
  nodes: PathNode[];
  closed: boolean;
}
export type Paths = SubPath[];

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const round = (n: number) => Math.round(n * 1000) / 1000;

// ------------------------------------------------------------------------------------------------ SVG path data → nodes

function arcToCubics(x1: number, y1: number, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean, x2: number, y2: number): [Pt, Pt, Pt][] {
  if ((x1 === x2 && y1 === y2) || rx === 0 || ry === 0) return [[{ x: x1, y: y1 }, { x: x2, y: y2 }, { x: x2, y: y2 }]];
  const phi = (phiDeg * Math.PI) / 180;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy;
  const y1p = -sp * dx + cp * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / (den || 1)));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2;
  const cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  else if (sweep && dth < 0) dth += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9));
  const step = dth / n;
  const out: [Pt, Pt, Pt][] = [];
  const k = (4 / 3) * Math.tan(step / 4);
  const at = (t: number): { p: Pt; d: Pt } => {
    const c = Math.cos(t);
    const s = Math.sin(t);
    return { p: { x: cx + rx * c * cp - ry * s * sp, y: cy + rx * c * sp + ry * s * cp }, d: { x: -rx * s * cp - ry * c * sp, y: -rx * s * sp + ry * c * cp } };
  };
  for (let i = 0; i < n; i++) {
    const a = at(th1 + i * step);
    const b = at(th1 + (i + 1) * step);
    out.push([add(a.p, mul(a.d, k)), sub(b.p, mul(b.d, k)), i === n - 1 ? { x: x2, y: y2 } : b.p]);
  }
  return out;
}

/** Parses the absolute SVG path data the renderer produces (M L H V C Q A Z) into nodes. */
export function svgToPaths(d: string): Paths {
  const tok = d.match(/[MLHVCQAZmlhvcqaz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const out: Paths = [];
  let cur = null as SubPath | null;
  let i = 0;
  let cmd = '';
  let px = 0;
  let py = 0;
  const num = () => Number(tok[i++]);
  const startNode = (x: number, y: number) => {
    cur = { nodes: [{ x, y }], closed: false };
    out.push(cur);
  };
  const last = () => cur!.nodes[cur!.nodes.length - 1]!;
  const curveTo = (c1: Pt, c2: Pt, p: Pt) => {
    last().hout = c1;
    cur!.nodes.push({ x: p.x, y: p.y, hin: c2 });
  };
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i]!)) cmd = tok[i++]!;
    switch (cmd) {
      case 'M': {
        px = num();
        py = num();
        startNode(px, py);
        cmd = 'L';
        break;
      }
      case 'L': {
        px = num();
        py = num();
        if (!cur) startNode(px, py);
        else cur.nodes.push({ x: px, y: py });
        break;
      }
      case 'H':
        px = num();
        cur?.nodes.push({ x: px, y: py });
        break;
      case 'V':
        py = num();
        cur?.nodes.push({ x: px, y: py });
        break;
      case 'C': {
        const c1 = { x: num(), y: num() };
        const c2 = { x: num(), y: num() };
        const p = { x: num(), y: num() };
        if (!cur) startNode(px, py);
        curveTo(c1, c2, p);
        px = p.x;
        py = p.y;
        break;
      }
      case 'Q': {
        const q = { x: num(), y: num() };
        const p = { x: num(), y: num() };
        if (!cur) startNode(px, py);
        const s = { x: px, y: py };
        curveTo(add(s, mul(sub(q, s), 2 / 3)), add(p, mul(sub(q, p), 2 / 3)), p);
        px = p.x;
        py = p.y;
        break;
      }
      case 'A': {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = num() !== 0;
        const sweep = num() !== 0;
        const p = { x: num(), y: num() };
        if (!cur) startNode(px, py);
        for (const [c1, c2, e] of arcToCubics(px, py, rx, ry, rot, large, sweep, p.x, p.y)) curveTo(c1, c2, e);
        px = p.x;
        py = p.y;
        break;
      }
      case 'Z':
      case 'z': {
        if (cur) {
          const a = cur.nodes[0]!;
          const b = last();
          if (cur.nodes.length > 1 && dist(a, b) < 1e-6) {
            if (b.hin) a.hin = b.hin;
            cur.nodes.pop();
          }
          cur.closed = true;
          px = a.x;
          py = a.y;
        }
        cur = null;
        break;
      }
      default:
        i++;
    }
  }
  return out.filter((p) => p.nodes.length > 1);
}

/** The nodes of any geometry, for a shape of w × h points. */
export function geometryToPaths(g: Geometry | undefined, w: number, h: number): Paths {
  const geo = geometryOf(g, w, h);
  const out: Paths = [];
  for (const p of geo.paths) if (p.stroke || p.fill !== 'none') out.push(...svgToPaths(p.d));
  return out.map((sp) => ({ ...sp, nodes: sp.nodes.map((n) => inferKind(n)) }));
}

function inferKind(n: PathNode): PathNode {
  if (n.hin && n.hout) {
    const a = sub(n, n.hin);
    const b = sub(n.hout, n);
    const cross = a.x * b.y - a.y * b.x;
    const la = Math.hypot(a.x, a.y);
    const lb = Math.hypot(b.x, b.y);
    if (la > 1e-6 && lb > 1e-6 && Math.abs(cross) / (la * lb) < 0.02 && a.x * b.x + a.y * b.y > 0) return { ...n, kind: Math.abs(la - lb) < 0.5 ? 'symmetric' : 'smooth' };
  }
  return { ...n, kind: 'corner' };
}

// ------------------------------------------------------------------------------------------------ nodes → custom geometry

/** Writes nodes back as a custom path whose coordinate space is the shape box (w × h points). */
export function pathsToCust(paths: Paths, w: number, h: number): CustPath {
  const cmds: CustPath['cmds'] = [];
  for (const sp of paths) {
    const n = sp.nodes;
    if (!n.length) continue;
    cmds.push(['M', round(n[0]!.x), round(n[0]!.y)]);
    const seg = (a: PathNode, b: PathNode) => {
      if (!a.hout && !b.hin) cmds.push(['L', round(b.x), round(b.y)]);
      else {
        const c1 = a.hout ?? a;
        const c2 = b.hin ?? b;
        cmds.push(['C', round(c1.x), round(c1.y), round(c2.x), round(c2.y), round(b.x), round(b.y)]);
      }
    };
    for (let i = 0; i < n.length - 1; i++) seg(n[i]!, n[i + 1]!);
    if (sp.closed) {
      const a = n[n.length - 1]!;
      const b = n[0]!;
      if (a.hout || b.hin) seg(a, b);
      cmds.push(['Z']);
    }
  }
  const anyClosed = paths.some((p) => p.closed);
  return { w: round(w), h: round(h), cmds, fill: anyClosed ? 'norm' : 'none', stroke: true };
}

// ------------------------------------------------------------------------------------------------ geometry helpers

const bez = (a: Pt, c1: Pt, c2: Pt, b: Pt, t: number): Pt => {
  const u = 1 - t;
  return { x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y };
};

export function segmentCount(sp: SubPath): number {
  return sp.closed ? sp.nodes.length : sp.nodes.length - 1;
}
const segNodes = (sp: SubPath, i: number): [PathNode, PathNode] => [sp.nodes[i]!, sp.nodes[(i + 1) % sp.nodes.length]!];
const isCurve = (a: PathNode, b: PathNode) => !!(a.hout || b.hin);

export function pointOnSegment(sp: SubPath, seg: number, t: number): Pt {
  const [a, b] = segNodes(sp, seg);
  return isCurve(a, b) ? bez(a, a.hout ?? a, b.hin ?? b, b, t) : lerp(a, b, t);
}

export function boundsOfPaths(paths: Paths): { x: number; y: number; w: number; h: number } {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  const see = (p: Pt) => {
    x1 = Math.min(x1, p.x);
    y1 = Math.min(y1, p.y);
    x2 = Math.max(x2, p.x);
    y2 = Math.max(y2, p.y);
  };
  for (const sp of paths) {
    sp.nodes.forEach(see);
    for (let s = 0; s < segmentCount(sp); s++) {
      const [a, b] = segNodes(sp, s);
      if (isCurve(a, b)) for (let k = 1; k < 32; k++) see(pointOnSegment(sp, s, k / 32));
    }
  }
  if (!isFinite(x1)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** The point of the path nearest to `p` (to add a node or hit a segment). */
export function nearestOnPaths(paths: Paths, p: Pt): { si: number; seg: number; t: number; d: number } | null {
  let best: { si: number; seg: number; t: number; d: number } | null = null;
  paths.forEach((sp, si) => {
    for (let seg = 0; seg < segmentCount(sp); seg++) {
      const steps = 40;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const d = dist(pointOnSegment(sp, seg, t), p);
        if (!best || d < best.d) best = { si, seg, t, d };
      }
    }
  });
  return best;
}

// ------------------------------------------------------------------------------------------------ editing

const replaceSub = (paths: Paths, si: number, fn: (sp: SubPath) => SubPath): Paths => paths.map((sp, i) => (i === si ? fn(sp) : sp));
const replaceNode = (sp: SubPath, ni: number, fn: (n: PathNode) => PathNode): SubPath => ({ ...sp, nodes: sp.nodes.map((n, i) => (i === ni ? fn(n) : n)) });

export function moveNode(paths: Paths, si: number, ni: number, p: Pt): Paths {
  return replaceSub(paths, si, (sp) =>
    replaceNode(sp, ni, (n) => {
      const d = sub(p, n);
      return { ...n, x: p.x, y: p.y, ...(n.hin ? { hin: add(n.hin, d) } : {}), ...(n.hout ? { hout: add(n.hout, d) } : {}) };
    }),
  );
}

/** Moves a handle; the opposite one follows when the node is smooth (same line) or symmetric (same line and length). */
export function moveHandle(paths: Paths, si: number, ni: number, which: 'hin' | 'hout', p: Pt): Paths {
  return replaceSub(paths, si, (sp) =>
    replaceNode(sp, ni, (n) => {
      const other = which === 'hin' ? 'hout' : 'hin';
      const next: PathNode = { ...n, [which]: p };
      const o = n[other];
      if (o && n.kind && n.kind !== 'corner') {
        const v = sub(p, n);
        const len = Math.hypot(v.x, v.y) || 1;
        const ol = n.kind === 'symmetric' ? len : Math.hypot(o.x - n.x, o.y - n.y);
        next[other] = { x: n.x - (v.x / len) * ol, y: n.y - (v.y / len) * ol };
      }
      return next;
    }),
  );
}

export function setNodeKind(paths: Paths, si: number, ni: number, kind: NodeKind): Paths {
  return replaceSub(paths, si, (sp) =>
    replaceNode(sp, ni, (n) => {
      if (kind === 'corner') return { ...n, kind };
      // a node without handles gets them along the line of its neighbours
      const k = sp.nodes.length;
      const prev = sp.nodes[(ni - 1 + k) % k]!;
      const next = sp.nodes[(ni + 1) % k]!;
      let out: PathNode = { ...n, kind };
      const hasPrev = sp.closed || ni > 0;
      const hasNext = sp.closed || ni < k - 1;
      if (!out.hin && !out.hout && hasPrev && hasNext) {
        const dir = sub(next, prev);
        const l = Math.hypot(dir.x, dir.y) || 1;
        const u = mul(dir, 1 / l);
        out = { ...out, hin: sub(n, mul(u, dist(n, prev) / 3)), hout: add(n, mul(u, dist(n, next) / 3)) };
      } else if (out.hin && out.hout) {
        const v = sub(out.hout, out.hin);
        const l = Math.hypot(v.x, v.y) || 1;
        const u = mul(v, 1 / l);
        const li = dist(out.hin, n);
        const lo = dist(out.hout, n);
        const m = kind === 'symmetric' ? (li + lo) / 2 : 0;
        out = { ...out, hin: sub(n, mul(u, kind === 'symmetric' ? m : li)), hout: add(n, mul(u, kind === 'symmetric' ? m : lo)) };
      }
      return out;
    }),
  );
}

/** Inserts a node on a segment at parameter t (the curve is split, so the shape does not change). */
export function addNodeAt(paths: Paths, si: number, seg: number, t: number): { paths: Paths; index: number } {
  let index = seg + 1;
  const out = replaceSub(paths, si, (sp) => {
    const [a, b] = segNodes(sp, seg);
    const nodes = [...sp.nodes];
    if (!isCurve(a, b)) {
      nodes.splice(seg + 1, 0, { ...lerp(a, b, t), kind: 'corner' });
    } else {
      const c1 = a.hout ?? a;
      const c2 = b.hin ?? b;
      const p01 = lerp(a, c1, t);
      const p12 = lerp(c1, c2, t);
      const p23 = lerp(c2, b, t);
      const p012 = lerp(p01, p12, t);
      const p123 = lerp(p12, p23, t);
      const m = lerp(p012, p123, t);
      const ai = seg;
      const bi = (seg + 1) % sp.nodes.length;
      nodes[ai] = { ...a, hout: p01 };
      nodes[bi] = { ...b, hin: p23 };
      nodes.splice(seg + 1, 0, { ...m, hin: p012, hout: p123, kind: 'smooth' });
    }
    return { ...sp, nodes };
  });
  if (out[si] && seg + 1 > out[si]!.nodes.length - 1) index = out[si]!.nodes.length - 1;
  return { paths: out, index };
}

/** Removes a node, keeping the path closed over its neighbours; a path of fewer than two nodes disappears. */
export function deleteNode(paths: Paths, si: number, ni: number): Paths {
  const out = paths
    .map((sp, i) => {
      if (i !== si) return sp;
      const nodes = sp.nodes.filter((_, k) => k !== ni);
      return { ...sp, nodes };
    })
    .filter((sp) => sp.nodes.length >= 2);
  return out;
}

/** Makes a segment straight (drops the handles on it) or curved (gives it handles at a third of its length). */
export function setSegmentKind(paths: Paths, si: number, seg: number, kind: 'line' | 'curve'): Paths {
  return replaceSub(paths, si, (sp) => {
    const k = sp.nodes.length;
    const ai = seg;
    const bi = (seg + 1) % k;
    const a = sp.nodes[ai]!;
    const b = sp.nodes[bi]!;
    const nodes = [...sp.nodes];
    if (kind === 'line') {
      const { hout: _o, ...na } = a;
      const { hin: _i, ...nb } = b;
      void _o;
      void _i;
      nodes[ai] = na;
      nodes[bi] = nb;
    } else if (!isCurve(a, b)) {
      nodes[ai] = { ...a, hout: lerp(a, b, 1 / 3) };
      nodes[bi] = { ...b, hin: lerp(a, b, 2 / 3) };
    }
    return { ...sp, nodes };
  });
}

export const toggleClosed = (paths: Paths, si: number): Paths => replaceSub(paths, si, (sp) => ({ ...sp, closed: !sp.closed }));

// ------------------------------------------------------------------------------------------------ shapes

/** Moves the nodes so the path starts at the origin of the shape box and returns the new box, in the same place on the slide. */
export function normalizePaths(paths: Paths, x: Xfrm): { paths: Paths; xfrm: Xfrm } {
  const b = boundsOfPaths(paths);
  const w = Math.max(b.w, 0.01);
  const h = Math.max(b.h, 0.01);
  const shift = (p: Pt): Pt => ({ x: p.x - b.x, y: p.y - b.y });
  const np = paths.map((sp) => ({ ...sp, nodes: sp.nodes.map((n) => ({ ...n, ...shift(n), ...(n.hin ? { hin: shift(n.hin) } : {}), ...(n.hout ? { hout: shift(n.hout) } : {}) })) }));
  // the old box's centre is the pivot of rotation and flip; keep every point where it was on the slide
  const oc = { x: x.w / 2, y: x.h / 2 };
  const toSlide = (p: Pt): Pt => {
    let q = { x: x.flipH ? x.w - p.x : p.x, y: x.flipV ? x.h - p.y : p.y };
    if (x.rot) {
      const a = (x.rot * Math.PI) / 180;
      const dx = q.x - oc.x;
      const dy = q.y - oc.y;
      q = { x: oc.x + dx * Math.cos(a) - dy * Math.sin(a), y: oc.y + dx * Math.sin(a) + dy * Math.cos(a) };
    }
    return { x: x.x + q.x, y: x.y + q.y };
  };
  const newCentre = toSlide({ x: b.x + w / 2, y: b.y + h / 2 });
  return { paths: np, xfrm: { ...x, x: newCentre.x - w / 2, y: newCentre.y - h / 2, w, h } };
}

/** Local (shape) coordinates of a slide point, undoing rotation and flips. */
export function slideToLocal(p: Pt, x: Xfrm): Pt {
  let q = { x: p.x - x.x, y: p.y - x.y };
  if (x.rot) {
    const a = (-x.rot * Math.PI) / 180;
    const dx = q.x - x.w / 2;
    const dy = q.y - x.h / 2;
    q = { x: x.w / 2 + dx * Math.cos(a) - dy * Math.sin(a), y: x.h / 2 + dx * Math.sin(a) + dy * Math.cos(a) };
  }
  return { x: x.flipH ? x.w - q.x : q.x, y: x.flipV ? x.h - q.y : q.y };
}
export function localToSlide(p: Pt, x: Xfrm): Pt {
  let q = { x: x.flipH ? x.w - p.x : p.x, y: x.flipV ? x.h - p.y : p.y };
  if (x.rot) {
    const a = (x.rot * Math.PI) / 180;
    const dx = q.x - x.w / 2;
    const dy = q.y - x.h / 2;
    q = { x: x.w / 2 + dx * Math.cos(a) - dy * Math.sin(a), y: x.h / 2 + dx * Math.sin(a) + dy * Math.cos(a) };
  }
  return { x: x.x + q.x, y: x.y + q.y };
}

/** Smooth nodes through the points (Catmull-Rom turned into Bézier handles). */
export function curveThrough(points: Pt[], closed = false): SubPath {
  const n = points.length;
  const nodes: PathNode[] = points.map((p) => ({ ...p, kind: 'smooth' as const }));
  if (n < 3) return { nodes: nodes.map((p) => ({ x: p.x, y: p.y, kind: 'corner' as const })), closed };
  for (let i = 0; i < n; i++) {
    const prev = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)]!;
    const next = points[closed ? (i + 1) % n : Math.min(n - 1, i + 1)]!;
    const v = mul(sub(next, prev), 1 / 6);
    const node = nodes[i]!;
    if (closed || i > 0) node.hin = sub(node, v);
    if (closed || i < n - 1) node.hout = add(node, v);
  }
  return { nodes, closed };
}

/** Ramer–Douglas–Peucker: the points of a scribble that matter. */
export function simplify(points: Pt[], tol: number): Pt[] {
  if (points.length < 3) return points;
  const a = points[0]!;
  const b = points[points.length - 1]!;
  let worst = 0;
  let wi = 0;
  const l = dist(a, b) || 1;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const d = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / l;
    if (d > worst) {
      worst = d;
      wi = i;
    }
  }
  if (worst <= tol) return [a, b];
  return [...simplify(points.slice(0, wi + 1), tol).slice(0, -1), ...simplify(points.slice(wi), tol)];
}

/** A new freeform shape from paths in slide coordinates. Open paths have no fill. */
export function newFreeform(paths: Paths, name = 'Forma libre'): ShapeEl {
  const b = boundsOfPaths(paths);
  const { paths: np } = normalizePaths(paths, { x: 0, y: 0, w: 1, h: 1 });
  const w = Math.max(b.w, 1);
  const h = Math.max(b.h, 1);
  const closed = paths.every((p) => p.closed);
  return {
    kind: 'shape',
    id: newId(),
    name,
    geom: { cust: [pathsToCust(np, w, h)] },
    xfrm: { x: b.x, y: b.y, w, h },
    style: SHAPE_STYLE,
    ...(closed ? {} : { fill: { t: 'none' as const } }),
    text: { body: { anchor: 'ctr' }, doc: { type: 'doc', content: [{ type: 'paragraph', attrs: { lvl: 0, p: { algn: 'ctr' }, end: {} } }] } },
  };
}

/** SVG path data of nodes (for previews and overlays). */
export function pathsToSvg(paths: Paths): string {
  const c = pathsToCust(paths, 1, 1);
  return c.cmds.map((m) => m[0] + (m.slice(1) as number[]).join(' ')).join('');
}
