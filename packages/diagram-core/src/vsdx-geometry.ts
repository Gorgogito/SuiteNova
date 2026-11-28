/*
 * The geometry rows of a Visio shape as polylines, in the local units of the shape (inches, y upwards). Curves are
 * sampled; arcs and NURBS are followed exactly, only the old splines are reduced to their points.
 */

export type Pt = [number, number];

export interface GeoRow {
  type: string;
  /** Cell values as numbers; `text` keeps the formulas of polylines and NURBS. */
  v: (name: string) => number;
  has: (name: string) => boolean;
  text: (name: string) => string;
}

export interface Path {
  pts: Pt[];
  closed: boolean;
}

const STEPS = 14;

function bezier(from: Pt, ctrl: Pt[], out: Pt[]): void {
  const all = [from, ...ctrl];
  for (let k = 1; k <= STEPS; k++) {
    const t = k / STEPS;
    let pts = all;
    while (pts.length > 1) pts = pts.slice(1).map((p, i) => [pts[i]![0] + (p[0] - pts[i]![0]) * t, pts[i]![1] + (p[1] - pts[i]![1]) * t] as Pt);
    out.push(pts[0]!);
  }
}

/** The circular arc from `a` to `b` that goes through `m`. */
export function arcThrough(a: Pt, m: Pt, b: Pt): Pt[] {
  const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
  const size = Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(m[0] - a[0], m[1] - a[1]);
  if (Math.abs(d) < 1e-9 * size * size || !size) return [m, b];
  const sq = (p: Pt) => p[0] * p[0] + p[1] * p[1];
  const cx = (sq(a) * (m[1] - b[1]) + sq(m) * (b[1] - a[1]) + sq(b) * (a[1] - m[1])) / d;
  const cy = (sq(a) * (b[0] - m[0]) + sq(m) * (a[0] - b[0]) + sq(b) * (m[0] - a[0])) / d;
  const r = Math.hypot(a[0] - cx, a[1] - cy);
  const ang = (p: Pt) => Math.atan2(p[1] - cy, p[0] - cx);
  const turn = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const a0 = ang(a);
  const toM = turn(ang(m) - a0);
  const toB = turn(ang(b) - a0);
  // counter-clockwise when the middle point comes before the end that way round
  const sweep = toM <= toB ? toB : toB - 2 * Math.PI;
  const n = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 18)));
  const out: Pt[] = [];
  for (let k = 1; k <= n; k++) out.push([cx + r * Math.cos(a0 + (sweep * k) / n), cy + r * Math.sin(a0 + (sweep * k) / n)]);
  out[out.length - 1] = b;
  return out;
}

/** An elliptical arc through `m`, of an ellipse turned `angle` whose axes are in the ratio `ratio`: a circle once undone. */
export function ellipticalArc(a: Pt, m: Pt, b: Pt, angle: number, ratio: number): Pt[] {
  const k = ratio > 1e-6 ? ratio : 1;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const to = ([x, y]: Pt): Pt => [x * cos + y * sin, (-x * sin + y * cos) * k];
  const back = ([x, y]: Pt): Pt => [x * cos - (y / k) * sin, x * sin + (y / k) * cos];
  return arcThrough(to(a), to(m), to(b)).map(back);
}

/** A rational B-spline sampled along its knots; null when the data does not make one. */
export function nurbs(points: Pt[], weights: number[], knots: number[], degree: number): Pt[] | null {
  const n = points.length;
  if (degree < 1 || n <= degree) return null;
  const U = knots.slice();
  while (U.length < n + degree + 1) U.push(U[U.length - 1] ?? 0);
  const lo = U[degree]!;
  const hi = U[n]!;
  if (!(hi > lo)) return null;
  const out: Pt[] = [];
  const steps = Math.min(400, 12 * n);
  for (let s = 1; s <= steps; s++) {
    const t = s === steps ? hi - (hi - lo) * 1e-9 : lo + ((hi - lo) * s) / steps;
    let k = degree;
    while (k < n - 1 && t >= U[k + 1]!) k++;
    const d = Array.from({ length: degree + 1 }, (_, j) => {
      const i = k - degree + j;
      const w = weights[i] ?? 1;
      return [points[i]![0] * w, points[i]![1] * w, w] as [number, number, number];
    });
    for (let r = 1; r <= degree; r++) {
      for (let j = degree; j >= r; j--) {
        const i = k - degree + j;
        const den = U[i + degree - r + 1]! - U[i]!;
        const al = den ? (t - U[i]!) / den : 0;
        d[j] = [0, 1, 2].map((c) => d[j - 1]![c]! * (1 - al) + d[j]![c]! * al) as [number, number, number];
      }
    }
    const [x, y, w] = d[degree]!;
    if (!w) return null;
    out.push([x / w, y / w]);
  }
  return out;
}

/** `NURBS(…)` and `POLYLINE(…)` as Visio writes them. */
const args = (formula: string): number[] => formula.slice(formula.indexOf('(') + 1, formula.lastIndexOf(')')).split(',').map(Number);

export function geometryPaths(rows: GeoRow[], W: number, H: number): { paths: Path[]; approximated: boolean } {
  const paths: Path[] = [];
  let approximated = false;
  let cur: Pt[] = [];
  let pos: Pt = [0, 0];
  const flush = () => {
    if (cur.length > 1) {
      const a = cur[0]!;
      const b = cur[cur.length - 1]!;
      // Visio rounds its formulas: ends a thousandth of the shape apart are the same point
      const closed = cur.length > 2 && Math.hypot(a[0] - b[0], a[1] - b[1]) <= Math.max(1e-4, 0.001 * Math.max(Math.abs(W), Math.abs(H)));
      paths.push({ pts: closed ? cur.slice(0, -1) : cur, closed });
    }
    cur = [];
  };
  const start = (p: Pt) => {
    flush();
    pos = p;
    cur = [p];
  };
  const add = (pts: Pt[]) => {
    if (!cur.length) cur = [pos];
    cur.push(...pts);
    pos = cur[cur.length - 1]!;
  };
  for (const row of rows) {
    const v = row.v;
    const end: Pt = [v('X'), v('Y')];
    const rel = (x: string, y: string): Pt => [v(x) * W, v(y) * H];
    switch (row.type) {
      case 'MoveTo': start(end); break;
      case 'RelMoveTo': start(rel('X', 'Y')); break;
      case 'LineTo': add([end]); break;
      case 'RelLineTo': add([rel('X', 'Y')]); break;
      case 'ArcTo': {
        // A is the height of the arc over its chord
        const bow = v('A');
        const dx = end[0] - pos[0];
        const dy = end[1] - pos[1];
        const len = Math.hypot(dx, dy);
        if (!len || Math.abs(bow) < 1e-9) add([end]);
        else add(arcThrough(pos, [(pos[0] + end[0]) / 2 + (dy / len) * bow, (pos[1] + end[1]) / 2 - (dx / len) * bow], end));
        break;
      }
      case 'EllipticalArcTo': add(ellipticalArc(pos, [v('A'), v('B')], end, v('C'), v('D'))); break;
      case 'RelEllipticalArcTo': add(ellipticalArc(pos, rel('A', 'B'), rel('X', 'Y'), v('C'), v('D'))); break;
      case 'QuadBezTo': { const o: Pt[] = []; bezier(pos, [[v('A'), v('B')], end], o); add(o); break; }
      case 'RelQuadBezTo': { const o: Pt[] = []; bezier(pos, [rel('A', 'B'), rel('X', 'Y')], o); add(o); break; }
      case 'CubBezTo': { const o: Pt[] = []; bezier(pos, [[v('A'), v('B')], [v('C'), v('D')], end], o); add(o); break; }
      case 'RelCubBezTo': { const o: Pt[] = []; bezier(pos, [rel('A', 'B'), rel('C', 'D'), rel('X', 'Y')], o); add(o); break; }
      case 'Ellipse': {
        // centre X,Y; A,B a point at the end of one axis; C,D at the end of the other
        const ax = v('A') - end[0];
        const ay = v('B') - end[1];
        const rx = Math.hypot(ax, ay);
        const ry = Math.hypot(v('C') - end[0], v('D') - end[1]);
        const rot = Math.atan2(ay, ax);
        const pts: Pt[] = [];
        for (let k = 0; k <= 48; k++) {
          const a = ((k % 48) * 2 * Math.PI) / 48;
          pts.push([end[0] + rx * Math.cos(a) * Math.cos(rot) - ry * Math.sin(a) * Math.sin(rot), end[1] + rx * Math.cos(a) * Math.sin(rot) + ry * Math.sin(a) * Math.cos(rot)]);
        }
        flush();
        cur = pts;
        flush();
        break;
      }
      case 'PolylineTo': {
        const [xt, yt, ...xy] = args(row.text('A'));
        const pts: Pt[] = [];
        for (let i = 0; i + 1 < xy.length; i += 2) pts.push([xt ? xy[i]! : xy[i]! * W, yt ? xy[i + 1]! : xy[i + 1]! * H]);
        add([...pts.filter((p) => p.every(Number.isFinite)), end]);
        break;
      }
      case 'NURBSTo': {
        const [lastKnot, degree, xt, yt, ...q] = args(row.text('E'));
        const points: Pt[] = [pos];
        const weights = [v('D') || 1];
        const knots = [v('C')];
        for (let i = 0; i + 3 < q.length; i += 4) {
          points.push([xt ? q[i]! : q[i]! * W, yt ? q[i + 1]! : q[i + 1]! * H]);
          knots.push(q[i + 2]!);
          weights.push(q[i + 3]!);
        }
        points.push(end);
        weights.push(v('B') || 1);
        knots.push(v('A'), lastKnot!);
        const curve = nurbs(points, weights, knots, degree ?? 3);
        if (curve?.every((p) => p.every(Number.isFinite))) add([...curve.slice(0, -1), end]);
        else {
          add([end]);
          approximated = true;
        }
        break;
      }
      case 'InfiniteLine': break;
      default:
        // old splines (SplineStart, SplineKnot): their points
        if (row.has('X') && row.has('Y')) {
          add([end]);
          approximated = true;
        }
    }
  }
  flush();
  return { paths, approximated };
}
