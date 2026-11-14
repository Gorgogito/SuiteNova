import { pointOnSegment, segmentCount, type Paths, type Pt, type SubPath } from './freeform';

/*
 * Merge shapes (union, combine, intersect, subtract, fragment). Every shape is flattened to polygons; all their edges are cut where they
 * cross, and each piece of edge is kept when the wanted region lies on one side of it and not on the other. The kept edges are joined
 * into rings (outer rings counter-clockwise, holes clockwise). Curves become polygons, so the result is made of straight segments.
 */

export type Ring = Pt[];
/** one shape: its closed rings, filled with the even-odd rule */
export type Region = Ring[];
export type MergeOp = 'union' | 'combine' | 'intersect' | 'subtract' | 'fragment';

const KEY = 1e4;
const key = (p: Pt) => `${Math.round(p.x * KEY)},${Math.round(p.y * KEY)}`;
const snap = (p: Pt): Pt => ({ x: Math.round(p.x * KEY) / KEY, y: Math.round(p.y * KEY) / KEY });

/** Closed subpaths as polygons (curves approximated by short segments). */
export function flattenPaths(paths: Paths): Region {
  const out: Region = [];
  for (const sp of paths) {
    if (!sp.closed || sp.nodes.length < 3) continue;
    const ring: Ring = [];
    for (let s = 0; s < segmentCount(sp); s++) {
      const a = sp.nodes[s]!;
      const b = sp.nodes[(s + 1) % sp.nodes.length]!;
      const curved = !!(a.hout || b.hin);
      ring.push({ x: a.x, y: a.y });
      if (curved) {
        const len = Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot((a.hout?.x ?? a.x) - a.x, (a.hout?.y ?? a.y) - a.y) + Math.hypot(b.x - (b.hin?.x ?? b.x), b.y - (b.hin?.y ?? b.y));
        const n = Math.max(8, Math.min(48, Math.ceil(len / 3)));
        for (let k = 1; k < n; k++) ring.push(pointOnSegment(sp, s, k / n));
      }
    }
    const clean = ring.filter((p, i) => i === 0 || key(p) !== key(ring[i - 1]!));
    if (clean.length > 2) out.push(clean);
  }
  return out;
}

const area = (r: Ring) => {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i]!;
    const q = r[(i + 1) % r.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
};

function inside(region: Region, p: Pt): boolean {
  let c = false;
  for (const r of region)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i]!;
      const b = r[j]!;
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
  return c;
}

interface Seg {
  a: Pt;
  b: Pt;
}

/** Cuts every segment where others cross or touch it. */
function node(segs: Seg[]): Seg[] {
  const cuts: number[][] = segs.map(() => []);
  const eps = 1e-9;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    const d = { x: s.b.x - s.a.x, y: s.b.y - s.a.y };
    const len2 = d.x * d.x + d.y * d.y;
    for (let j = i + 1; j < segs.length; j++) {
      const o = segs[j]!;
      const e = { x: o.b.x - o.a.x, y: o.b.y - o.a.y };
      const den = d.x * e.y - d.y * e.x;
      const w = { x: o.a.x - s.a.x, y: o.a.y - s.a.y };
      if (Math.abs(den) > 1e-12) {
        const t = (w.x * e.y - w.y * e.x) / den;
        const u = (w.x * d.y - w.y * d.x) / den;
        if (t > -eps && t < 1 + eps && u > -eps && u < 1 + eps) {
          if (t > eps && t < 1 - eps) cuts[i]!.push(t);
          if (u > eps && u < 1 - eps) cuts[j]!.push(u);
        }
      } else {
        // parallel: an endpoint of one lying on the other splits it
        const len2o = e.x * e.x + e.y * e.y;
        const on = (p: Pt, base: Seg, dd: { x: number; y: number }, l2: number) => {
          const cr = (p.x - base.a.x) * dd.y - (p.y - base.a.y) * dd.x;
          if (Math.abs(cr) / Math.sqrt(l2 || 1) > 1e-6) return -1;
          const t = ((p.x - base.a.x) * dd.x + (p.y - base.a.y) * dd.y) / (l2 || 1);
          return t > eps && t < 1 - eps ? t : -1;
        };
        for (const p of [o.a, o.b]) {
          const t = on(p, s, d, len2);
          if (t > 0) cuts[i]!.push(t);
        }
        for (const p of [s.a, s.b]) {
          const t = on(p, o, e, len2o);
          if (t > 0) cuts[j]!.push(t);
        }
      }
    }
  }
  const out: Seg[] = [];
  const seen = new Set<string>();
  segs.forEach((s, i) => {
    const ts = [0, ...cuts[i]!.sort((x, y) => x - y), 1];
    for (let k = 0; k < ts.length - 1; k++) {
      const a = snap({ x: s.a.x + (s.b.x - s.a.x) * ts[k]!, y: s.a.y + (s.b.y - s.a.y) * ts[k]! });
      const b = snap({ x: s.a.x + (s.b.x - s.a.x) * ts[k + 1]!, y: s.a.y + (s.b.y - s.a.y) * ts[k + 1]! });
      const ka = key(a);
      const kb = key(b);
      if (ka === kb) continue;
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ a, b });
    }
  });
  return out;
}

const wanted = (op: MergeOp, bits: boolean[]): boolean => {
  const n = bits.filter(Boolean).length;
  if (op === 'union' || op === 'fragment') return n > 0;
  if (op === 'combine') return n % 2 === 1;
  if (op === 'intersect') return n === bits.length;
  return !!bits[0] && n === 1; // subtract: the first, minus every other
};

/** Joins directed edges (region on their left) into rings. */
function stitch(edges: Seg[]): Ring[] {
  const outs = new Map<string, number[]>();
  edges.forEach((e, i) => {
    const k = key(e.a);
    (outs.get(k) ?? outs.set(k, []).get(k)!).push(i);
  });
  const used = new Array<boolean>(edges.length).fill(false);
  const rings: Ring[] = [];
  for (let s = 0; s < edges.length; s++) {
    if (used[s]) continue;
    const ring: Ring = [];
    let cur = s;
    for (let guard = 0; guard < edges.length + 2; guard++) {
      used[cur] = true;
      const e = edges[cur]!;
      ring.push(e.a);
      const cands = (outs.get(key(e.b)) ?? []).filter((i) => !used[i] || i === s);
      if (!cands.length) break;
      const din = { x: e.b.x - e.a.x, y: e.b.y - e.a.y };
      let best = cands[0]!;
      let bestA = -Infinity;
      for (const i of cands) {
        const f = edges[i]!;
        const dout = { x: f.b.x - f.a.x, y: f.b.y - f.a.y };
        const ang = Math.atan2(din.x * dout.y - din.y * dout.x, din.x * dout.x + din.y * dout.y);
        if (ang > bestA) ((bestA = ang), (best = i));
      }
      if (best === s) break;
      cur = best;
    }
    if (ring.length > 2) rings.push(simplifyRing(ring));
  }
  return rings.filter((r) => r.length > 2 && Math.abs(area(r)) > 1e-6);
}

/** Drops vertices that lie on a straight line between their neighbours. */
function simplifyRing(r: Ring): Ring {
  let pts = r;
  for (let pass = 0; pass < 3; pass++) {
    const next: Ring = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[(i + pts.length - 1) % pts.length]!;
      const c = pts[i]!;
      const n = pts[(i + 1) % pts.length]!;
      const cr = (c.x - p.x) * (n.y - c.y) - (c.y - p.y) * (n.x - c.x);
      const dot = (c.x - p.x) * (n.x - c.x) + (c.y - p.y) * (n.y - c.y);
      if (Math.abs(cr) < 1e-7 * (1 + Math.hypot(c.x - p.x, c.y - p.y) * Math.hypot(n.x - c.x, n.y - c.y)) && dot > 0) continue;
      next.push(c);
    }
    if (next.length === pts.length || next.length < 3) {
      pts = next.length < 3 ? pts : next;
      break;
    }
    pts = next;
  }
  return pts;
}

/** Splits rings in outer rings with the holes inside them. */
function pieces(rings: Ring[]): Region[] {
  const outers = rings.filter((r) => area(r) > 0);
  const holes = rings.filter((r) => area(r) < 0);
  const res: Region[] = outers.map((o) => [o]);
  for (const h of holes) {
    const probe = h[0]!;
    // the smallest outer ring that contains the hole
    let best = -1;
    outers.forEach((o, i) => {
      if (inside([o], probe) && (best < 0 || Math.abs(area(o)) < Math.abs(area(outers[best]!)))) best = i;
    });
    if (best >= 0) res[best]!.push(h);
  }
  return res;
}

/** The result of merging shapes. Fragment gives one piece per face; the other operations give one piece with all rings (or none). */
export function mergeRegions(regions: Region[], op: MergeOp): Region[] {
  if (regions.length < 2) return [];
  const segs: Seg[] = [];
  for (const reg of regions) for (const r of reg) for (let i = 0; i < r.length; i++) segs.push({ a: r[i]!, b: r[(i + 1) % r.length]! });
  const noded = node(segs);
  let size = 0;
  for (const s of noded) size = Math.max(size, Math.abs(s.a.x), Math.abs(s.a.y), Math.abs(s.b.x), Math.abs(s.b.y));
  const eps = Math.max(1e-3, size * 1e-6);
  const sig = (p: Pt) => regions.map((r) => inside(r, p));
  const edges: { seg: Seg; left: boolean[]; right: boolean[] }[] = noded.map((seg) => {
    const m = { x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 };
    const d = { x: seg.b.x - seg.a.x, y: seg.b.y - seg.a.y };
    const l = Math.hypot(d.x, d.y) || 1;
    const nx = -d.y / l;
    const ny = d.x / l;
    return { seg, left: sig({ x: m.x + nx * eps, y: m.y + ny * eps }), right: sig({ x: m.x - nx * eps, y: m.y - ny * eps }) };
  });
  const build = (isIn: (b: boolean[]) => boolean): Ring[] => {
    const dir: Seg[] = [];
    for (const e of edges) {
      const l = isIn(e.left);
      const r = isIn(e.right);
      if (l === r) continue;
      dir.push(l ? e.seg : { a: e.seg.b, b: e.seg.a });
    }
    return stitch(dir);
  };
  if (op !== 'fragment') {
    const rings = build((b) => wanted(op, b));
    return rings.length ? [rings] : [];
  }
  // one piece per distinct set of shapes covering the face
  const sigs = new Map<string, boolean[]>();
  for (const e of edges)
    for (const b of [e.left, e.right]) if (b.some(Boolean)) sigs.set(b.map((x) => (x ? 1 : 0)).join(''), b);
  const out: Region[] = [];
  for (const [k] of sigs) out.push(...pieces(build((b) => b.map((x) => (x ? 1 : 0)).join('') === k)));
  return out;
}

/** A region as paths (closed polygons, no handles). */
export const regionToPaths = (reg: Region): Paths => reg.map((r): SubPath => ({ nodes: r.map((p) => ({ x: p.x, y: p.y, kind: 'corner' as const })), closed: true }));
