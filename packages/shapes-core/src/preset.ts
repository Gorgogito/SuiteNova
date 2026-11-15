import presetData from './presets.json';

/*
 * DrawingML preset shapes. The 187 definitions of ECMA-376 are compiled (scripts/build-presets.mjs) into presets.json; this module
 * evaluates their guide formulas for a given size and adjust values and produces SVG path data, the text rectangle, connection
 * sites and adjust handles. Angles inside formulas are in 60 000ths of a degree, like in the specification.
 */

interface PathDef {
  w?: number;
  h?: number;
  fill?: string;
  stroke?: false;
  cmds: (string | number)[][];
}
interface PresetDef {
  av: Record<string, string>;
  gd: [string, string][];
  ah: Record<string, string>[];
  cxn: { ang: string; x: string; y: string }[];
  rect: string[] | null;
  paths: PathDef[];
}

const PRESETS = presetData as unknown as Record<string, PresetDef>;

export const presetNames = (): string[] => Object.keys(PRESETS);
export const hasPreset = (name: string): boolean => name in PRESETS;

/** The default adjust values of a preset (`{ adj: 16667 }`). */
export function presetDefaults(name: string): Record<string, number> {
  const d = PRESETS[name];
  const out: Record<string, number> = {};
  if (!d) return out;
  for (const [k, v] of Object.entries(d.av)) out[k] = Number(/val\s+(-?\d+)/.exec(v)?.[1] ?? 0);
  return out;
}

const DEG = Math.PI / 180 / 60000;
const rad = (a: number) => a * DEG;

type Env = Map<string, number>;

function val(tok: string | undefined, env: Env): number {
  if (tok === undefined) return 0;
  const n = Number(tok);
  if (!Number.isNaN(n)) return n;
  const v = env.get(tok);
  if (v === undefined) return 0;
  return v;
}

function formula(fm: string, env: Env): number {
  const [op, ...rest] = fm.trim().split(/\s+/);
  const x = val(rest[0], env);
  const y = val(rest[1], env);
  const z = val(rest[2], env);
  switch (op) {
    case 'val':
      return x;
    case '*/':
      return z === 0 ? 0 : (x * y) / z;
    case '+-':
      return x + y - z;
    case '+/':
      return z === 0 ? 0 : (x + y) / z;
    case '?:':
      return x > 0 ? y : z;
    case 'abs':
      return Math.abs(x);
    case 'at2':
      return (Math.atan2(y, x) * 180 * 60000) / Math.PI;
    case 'cat2':
      return x * Math.cos(Math.atan2(z, y));
    case 'sat2':
      return x * Math.sin(Math.atan2(z, y));
    case 'cos':
      return x * Math.cos(rad(y));
    case 'sin':
      return x * Math.sin(rad(y));
    case 'tan':
      return x * Math.tan(rad(y));
    case 'max':
      return Math.max(x, y);
    case 'min':
      return Math.min(x, y);
    case 'mod':
      return Math.sqrt(x * x + y * y + z * z);
    case 'pin':
      return y < x ? x : y > z ? z : y;
    case 'sqrt':
      return Math.sqrt(Math.max(0, x));
    default:
      return 0;
  }
}

function baseEnv(w: number, h: number): Env {
  const e: Env = new Map();
  const ss = Math.min(w, h);
  const ls = Math.max(w, h);
  e.set('l', 0);
  e.set('t', 0);
  e.set('r', w);
  e.set('b', h);
  e.set('w', w);
  e.set('h', h);
  e.set('hc', w / 2);
  e.set('vc', h / 2);
  e.set('ss', ss);
  e.set('ls', ls);
  for (const d of [2, 3, 4, 5, 6, 8, 10, 12, 16, 32]) {
    e.set(`wd${d}`, w / d);
    e.set(`hd${d}`, h / d);
    e.set(`ssd${d}`, ss / d);
    e.set(`lsd${d}`, ls / d);
  }
  e.set('cd2', 10800000);
  e.set('cd4', 5400000);
  e.set('cd8', 2700000);
  e.set('3cd4', 16200000);
  e.set('3cd8', 8100000);
  e.set('5cd8', 13500000);
  e.set('7cd8', 18900000);
  return e;
}

export interface PresetHandle {
  kind: 'xy' | 'polar';
  x: number;
  y: number;
  /** Names of the adjust values this handle drives. */
  refX?: string;
  refY?: string;
  refR?: string;
  refAng?: string;
  min: number[];
  max: number[];
}

export interface PresetPath {
  d: string;
  fill: 'none' | 'norm' | 'lighten' | 'lightenLess' | 'darken' | 'darkenLess';
  stroke: boolean;
}

export interface PresetGeometry {
  paths: PresetPath[];
  /** Rectangle where the text goes (l, t, r, b). */
  textRect: { l: number; t: number; r: number; b: number };
  sites: { x: number; y: number; ang: number }[];
  handles: PresetHandle[];
}

const f = (n: number) => (Math.round(n * 1000) / 1000).toString();

/** Visual-angle point on an ellipse of radii (wr, hr), relative to its centre. */
function ellipsePoint(wr: number, hr: number, ang: number): [number, number] {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const d = Math.sqrt((hr * c) ** 2 + (wr * s) ** 2);
  if (d === 0) return [0, 0];
  const r = (wr * hr) / d;
  return [r * c, r * s];
}

/** SVG path commands for one arcTo given the current point. */
export function arcSegments(cx0: number, cy0: number, wr: number, hr: number, st: number, sw: number): { d: string; x: number; y: number } {
  const stR = rad(st);
  const [sx, sy] = ellipsePoint(wr, hr, stR);
  const ox = cx0 - sx;
  const oy = cy0 - sy;
  let d = '';
  let cur = stR;
  let remaining = rad(sw);
  let x = cx0;
  let y = cy0;
  const step = Math.PI * 0.999;
  // long arcs are split so that the large-arc flag stays unambiguous
  while (Math.abs(remaining) > 1e-9) {
    const part = Math.abs(remaining) > step ? Math.sign(remaining) * step : remaining;
    const end = cur + part;
    const [ex, ey] = ellipsePoint(wr, hr, end);
    x = ox + ex;
    y = oy + ey;
    d += `A${f(wr)} ${f(hr)} 0 0 ${part > 0 ? 1 : 0} ${f(x)} ${f(y)}`;
    cur = end;
    remaining -= part;
  }
  return { d, x, y };
}

export function presetGeometry(name: string, w: number, h: number, adj: Record<string, number> = {}): PresetGeometry | null {
  const def = PRESETS[name];
  if (!def) return null;
  const env = baseEnv(w, h);
  const defaults = presetDefaults(name);
  for (const k of Object.keys(def.av)) env.set(k, adj[k] ?? defaults[k] ?? 0);
  for (const [n, fm] of def.gd) env.set(n, formula(fm, env));
  const paths: PresetPath[] = [];
  for (const p of def.paths) {
    const sx = p.w ? w / p.w : 1;
    const sy = p.h ? h / p.h : 1;
    const px = (t: string | number) => val(String(t), env) * sx;
    const py = (t: string | number) => val(String(t), env) * sy;
    let d = '';
    let cx = 0;
    let cy = 0;
    for (const c of p.cmds) {
      const k = c[0];
      if (k === 'M') {
        cx = px(c[1]!);
        cy = py(c[2]!);
        d += `M${f(cx)} ${f(cy)}`;
      } else if (k === 'L') {
        cx = px(c[1]!);
        cy = py(c[2]!);
        d += `L${f(cx)} ${f(cy)}`;
      } else if (k === 'Q') {
        const x1 = px(c[1]!);
        const y1 = py(c[2]!);
        cx = px(c[3]!);
        cy = py(c[4]!);
        d += `Q${f(x1)} ${f(y1)} ${f(cx)} ${f(cy)}`;
      } else if (k === 'C') {
        const x1 = px(c[1]!);
        const y1 = py(c[2]!);
        const x2 = px(c[3]!);
        const y2 = py(c[4]!);
        cx = px(c[5]!);
        cy = py(c[6]!);
        d += `C${f(x1)} ${f(y1)} ${f(x2)} ${f(y2)} ${f(cx)} ${f(cy)}`;
      } else if (k === 'A') {
        const wr = val(String(c[1]), env) * sx;
        const hr = val(String(c[2]), env) * sy;
        const a = arcSegments(cx, cy, wr, hr, val(String(c[3]), env), val(String(c[4]), env));
        d += a.d;
        cx = a.x;
        cy = a.y;
      } else if (k === 'Z') d += 'Z';
    }
    paths.push({ d, fill: (p.fill as PresetPath['fill']) ?? 'norm', stroke: p.stroke !== false });
  }
  const r = def.rect ?? ['l', 't', 'r', 'b'];
  const textRect = { l: val(r[0], env), t: val(r[1], env), r: val(r[2], env), b: val(r[3], env) };
  const sites = def.cxn.map((c) => ({ x: val(c.x, env), y: val(c.y, env), ang: val(c.ang, env) / 60000 }));
  const handles: PresetHandle[] = def.ah.map((a) =>
    a.t === 'xy'
      ? { kind: 'xy', x: val(a.x, env), y: val(a.y, env), refX: a.rx, refY: a.ry, min: [val(a.minX, env), val(a.minY, env)], max: [val(a.maxX, env), val(a.maxY, env)] }
      : { kind: 'polar', x: val(a.x, env), y: val(a.y, env), refR: a.rr, refAng: a.ra, min: [val(a.minR, env), val(a.minA, env)], max: [val(a.maxR, env), val(a.maxA, env)] },
  );
  return { paths, textRect, sites, handles };
}

/**
 * New adjust values after dragging a handle to (x, y) of a shape of size w × h. The handle position is a function of the adjust
 * values, so it is inverted numerically (the functions are monotonic in the range the handle may take).
 */
export function dragHandle(name: string, w: number, h: number, adj: Record<string, number>, index: number, x: number, y: number): Record<string, number> {
  const base = { ...presetDefaults(name), ...adj };
  const g0 = presetGeometry(name, w, h, base);
  const hd = g0?.handles[index];
  if (!g0 || !hd) return adj;
  const out = { ...adj };
  const solve = (ref: string, target: number, axis: 'x' | 'y', lo: number, hi: number) => {
    let a = lo;
    let b = hi;
    const at = (v: number) => {
      const g = presetGeometry(name, w, h, { ...base, ...out, [ref]: v })!;
      return g.handles[index]![axis];
    };
    const inc = at(b) >= at(a);
    for (let i = 0; i < 40; i++) {
      const m = (a + b) / 2;
      const v = at(m);
      if (inc ? v < target : v > target) a = m;
      else b = m;
    }
    return Math.round((a + b) / 2);
  };
  if (hd.kind === 'xy') {
    if (hd.refX) out[hd.refX] = solve(hd.refX, x, 'x', hd.min[0]!, hd.max[0]!);
    if (hd.refY) out[hd.refY] = solve(hd.refY, y, 'y', hd.min[1]!, hd.max[1]!);
  } else {
    // polar: angle from the centre of the shape, then distance
    const cx = w / 2;
    const cy = h / 2;
    const ang = ((Math.atan2(y - cy, x - cx) * 180) / Math.PI) * 60000;
    if (hd.refAng) {
      let a = ang < 0 ? ang + 21600000 : ang;
      a = Math.min(Math.max(a, hd.min[1]!), hd.max[1]!);
      out[hd.refAng] = Math.round(a);
    }
    if (hd.refR) {
      const dist = Math.hypot(x - cx, y - cy);
      const ss = Math.min(w, h);
      out[hd.refR] = Math.round(Math.min(Math.max((dist / ss) * 100000, hd.min[0]!), hd.max[0]!));
    }
  }
  return out;
}
