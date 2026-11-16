import { presetDefaults, presetGeometry } from '@suitenova/shapes-core';
import type { Constr } from '../layoutdef';
import { present, allNodes, type PNode } from './present';
import type { LayoutDef } from '../layoutdef';
import type { ColorsDef, StyleDef } from '../styles';
import type { SmartTree } from '../model';

/*
 * Colocación: aplica las restricciones del diseño (`constrLst`) a las propiedades de los nodos de presentación y ejecuta el algoritmo
 * de cada nodo para colocar a sus hijos (`composite`, `snake`, `lin`, `cycle`, `pyra`, `conn`, `sp`, `tx`). Todo en puntos; el origen
 * de un nodo es su esquina superior izquierda y la posición de sus hijos es relativa a ella. Después se ajusta el tamaño del texto.
 */

export interface TextMetrics {
  /** Ancho en puntos de `text` (una línea) con la letra de `size` puntos. */
  width(text: string, size: number, bold?: boolean): number;
}

/** Medidas aproximadas de una letra sin serifas de proporciones habituales (Calibri); sustituible por las de la fuente real. */
export const approxMetrics: TextMetrics = {
  width(text, size) {
    let w = 0;
    for (const ch of text) {
      if (ch === ' ') w += 0.226;
      else if ('iljtfI.,:;!\'|'.includes(ch)) w += 0.27;
      else if ('mwMW@%'.includes(ch)) w += 0.82;
      else if (/[A-ZÁÉÍÓÚÑ]/.test(ch)) w += 0.6;
      else if (/[0-9]/.test(ch)) w += 0.507;
      else w += 0.49;
    }
    return w * size;
  },
};

export interface EngineOptions {
  /** Tamaño del dibujo en puntos. */
  width: number;
  height: number;
  metrics?: TextMetrics;
  /** Variables de diseño que vienen de los datos (`dir`: `norm` o `rev`, `orgChart`, `chMax`…). */
  vars?: Record<string, string>;
  /** Estilo rápido y colores: con ellos las formas salen con su relleno, su línea y su `dsp:style`. */
  style?: StyleDef;
  colors?: ColorsDef;
}

interface Ctx {
  o: EngineOptions & { metrics: TextMetrics };
  /** Grupos de tamaño de letra iguales (`op="equ"`): los miembros acaban con el mismo tamaño. */
  groups: { prop: string; members: PNode[]; max: number }[];
}

const MARGINS = new Set(['lMarg', 'rMarg', 'tMarg', 'bMarg']);
const FONT_REFS = new Set(['primFontSz', 'secFontSz']);

// ---- propiedades y restricciones
const kindOf = (n: PNode) => n.ctx.kind;

function nodesFor(p: PNode, f: 'self' | 'ch' | 'des', name: string | undefined, pt: string): PNode[] {
  const ok = (n: PNode) => (!name || n.name === name) && (pt === 'all' || (pt === 'node' ? kindOf(n) === 'node' : pt === 'sibTrans' ? kindOf(n) === 'sibTrans' : pt === 'parTrans' ? kindOf(n) === 'parTrans' : pt === 'asst' ? kindOf(n) === 'asst' : true));
  if (f === 'self') return [p];
  if (f === 'ch') return p.children.filter(ok);
  return allNodes(p).slice(1).filter(ok);
}

const prop = (n: PNode, t: string): number | undefined => n.props.get(t);

function applyConstraints(p: PNode, ctx: Ctx, onlySelf: boolean): void {
  p.constrs.forEach((c) => {
    if (onlySelf && c.for !== 'self') return;
    // las referencias al tamaño de la letra (márgenes) se resuelven al ajustar el texto
    if (MARGINS.has(c.type) && FONT_REFS.has(c.refType)) return;
    const targets = nodesFor(p, c.for, c.forName, c.ptType);
    if (!targets.length) return;
    let v: number | undefined;
    if (c.refType !== 'none') {
      const ref = nodesFor(p, c.refFor, c.refForName, c.refPtType)[0];
      let base = ref ? prop(ref, c.refType) : undefined;
      // una longitud ligada al tamaño de letra (p. ej. la altura de una barra de texto) aún no conoce la letra: se supone la máxima
      // (65 pt) y el algoritmo de colocación reduce a escala si no cabe. El 3,6 es empírico (se ajustó a los diseños de Office).
      if (ref && base === undefined && FONT_REFS.has(c.refType)) base = 65 * (c.type === 'w' || c.type === 'h' ? 3.6 : 1);
      else if (ref && base !== undefined && FONT_REFS.has(c.refType) && (c.type === 'w' || c.type === 'h')) base *= 3.6;
      if (base !== undefined) v = base * c.fact;
    } else if (!(c.val === 0 && (c.op !== 'none' || c.type === 'connDist'))) v = c.val;
    if (c.op === 'equ' && FONT_REFS.has(c.type) && !onlySelf) ctx.groups.push({ prop: c.type, members: targets, max: v ?? 65 });
    if (v === undefined || Number.isNaN(v)) return;
    for (const t of targets) {
      if (c.op === 'lte' && prop(t, c.type) !== undefined) setProp(t, c.type, Math.min(prop(t, c.type)!, v));
      else if (c.op === 'gte' && prop(t, c.type) !== undefined) setProp(t, c.type, Math.max(prop(t, c.type)!, v));
      else setProp(t, c.type, v);
    }
  });
}

function setProp(n: PNode, t: string, v: number): void {
  if (n.locked?.has(t)) return;
  n.props.set(t, v);
}

const W = (n: PNode) => prop(n, 'w') ?? 0;
const H = (n: PNode) => prop(n, 'h') ?? 0;

// ---- algoritmos
const param = (p: PNode, name: string): string | undefined => p.alg?.params.find((x) => x.type === name)?.val;
const isGap = (c: PNode) => c.alg?.type === 'sp' && !c.shape?.type;

/** `composite`: cada hijo se coloca con sus restricciones `l`, `t`, `r`, `b`, `w`, `h`, `ctrX`, `ctrY` respecto del padre. */
/** La proporción `ar` de un `composite`: su caja se reduce, centrada, hasta tenerla. Va antes de las restricciones, que miden contra ella. */
function fitAspect(p: PNode): void {
  const ar = Number(param(p, 'ar') ?? 0);
  if (p.alg?.type !== 'composite' || !(ar > 0)) return;
  const w = W(p);
  const h = H(p);
  const nw = Math.min(w, h * ar);
  const nh = nw / ar;
  p.x += (w - nw) / 2;
  p.y += (h - nh) / 2;
  p.props.set('w', nw);
  p.props.set('h', nh);
}

function composite(p: PNode): void {
  for (const c of p.children) {
    const g = (t: string) => prop(c, t);
    let w = g('w');
    let h = g('h');
    const l = g('l');
    const r = g('r');
    const t = g('t');
    const b = g('b');
    if (w === undefined && l !== undefined && r !== undefined) w = r - l;
    if (h === undefined && t !== undefined && b !== undefined) h = b - t;
    w ??= 0;
    h ??= 0;
    c.props.set('w', w);
    c.props.set('h', h);
    c.x = l ?? (r !== undefined ? r - w : g('ctrX') !== undefined ? g('ctrX')! - w / 2 : 0);
    c.y = t ?? (b !== undefined ? b - h : g('ctrY') !== undefined ? g('ctrY')! - h / 2 : 0);
  }
  // el conjunto de hijas queda centrado en la caja (los círculos de un Venn no la llenan)
  const kids = p.children.filter((c) => W(c) > 0 && H(c) > 0);
  if (kids.length) {
    const x1 = Math.min(...kids.map((c) => c.x));
    const x2 = Math.max(...kids.map((c) => c.x + W(c)));
    const y1 = Math.min(...kids.map((c) => c.y));
    const y2 = Math.max(...kids.map((c) => c.y + H(c)));
    const dx = (W(p) - (x2 - x1)) / 2 - x1;
    const dy = (H(p) - (y2 - y1)) / 2 - y1;
    if (dx || dy) {
      for (const c of p.children) {
        c.x += dx;
        c.y += dy;
      }
    }
  }
}

/** `snake`: rejilla que se rompe en filas; elige las columnas que dejan los nodos más grandes y centra la fila incompleta. */
function snake(p: PNode): void {
  const items = p.children.filter((c) => !isGap(c));
  const gaps = p.children.filter(isGap);
  if (!items.length) return;
  const w0 = W(items[0]!);
  const h0 = H(items[0]!);
  const sp0 = gaps[0] ? W(gaps[0]) : (prop(p, 'sp') ?? 0);
  const n = items.length;
  const aw = W(p);
  const ah = H(p);
  let best = { cols: 1, s: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const needW = cols * w0 + (cols - 1) * sp0;
    const needH = rows * h0 + (rows - 1) * sp0;
    const s = Math.min(1, aw / needW, ah / needH);
    if (s > best.s + 1e-9) best = { cols, s };
  }
  const { cols, s } = best;
  const rows = Math.ceil(n / cols);
  const w = w0 * s;
  const h = h0 * s;
  const sp = sp0 * s;
  const rtl = param(p, 'grDir') === 'tR' || param(p, 'grDir') === 'bR';
  const bottomUp = param(p, 'grDir') === 'bL' || param(p, 'grDir') === 'bR';
  const totalH = rows * h + (rows - 1) * sp;
  const y0 = (ah - totalH) / 2;
  items.forEach((c, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const rowW = inRow * w + (inRow - 1) * sp;
    const x0 = (aw - rowW) / 2;
    let x = x0 + col * (w + sp);
    if (rtl) x = aw - x - w;
    c.props.set('w', w);
    c.props.set('h', h);
    c.x = x;
    c.y = bottomUp ? ah - (y0 + row * (h + sp)) - h : y0 + row * (h + sp);
  });
  for (const g of gaps) {
    g.props.set('w', sp);
    g.props.set('h', 0);
  }
}

/** `lin`: los hijos en fila (o columna) en el orden dado; si no caben se reducen a escala; el conjunto queda centrado. */
function lin(p: PNode, redo: (c: PNode) => void): void {
  const dir = param(p, 'linDir') ?? 'fromL';
  const horiz = dir === 'fromL' || dir === 'fromR';
  const main = (c: PNode) => (horiz ? W(c) : H(c));
  const cross = (c: PNode) => (horiz ? H(c) : W(c));
  const availMain = horiz ? W(p) : H(p);
  const availCross = horiz ? H(p) : W(p);
  const kids = p.children;
  const sum = kids.reduce((a, c) => a + main(c), 0);
  const s = sum > availMain && sum > 0 ? availMain / sum : 1;
  for (const c of kids) {
    c.props.set(horiz ? 'w' : 'h', main(c) * s);
    if (c.shape?.type === 'conn') c.props.set('connDist', main(c));
    redo(c);
  }
  const total = kids.reduce((a, c) => a + main(c), 0);
  let pos = (availMain - total) / 2;
  // en `fromR` y `fromB` el primer hijo queda en el extremo opuesto: se recorre en el mismo orden y se espeja la posición
  for (const c of kids) {
    const m = main(c);
    const align = param(p, 'vertAlign') ?? 'mid';
    const off = align === 't' ? 0 : align === 'b' ? availCross - cross(c) : (availCross - cross(c)) / 2;
    if (horiz) {
      c.x = dir === 'fromR' ? availMain - pos - m : pos;
      c.y = off;
    } else {
      c.y = dir === 'fromB' ? availMain - pos - m : pos;
      c.x = off;
    }
    pos += m;
  }
}

/** `cycle`: los nodos sobre una circunferencia; la separación entre ellos es `sibSp` y todo se reduce hasta caber. */
function cycle(p: PNode, redo: (c: PNode) => void): void {
  const nodes = p.children.filter((c) => !isGap(c) && c.shape && c.ctx.kind !== 'sibTrans');
  const trans = p.children.filter((c) => c.ctx.kind === 'sibTrans');
  const n = nodes.length;
  if (!n) return;
  const st = (Number(param(p, 'stAng') ?? 0) * Math.PI) / 180;
  const span = (Number(param(p, 'spanAng') ?? 360) * Math.PI) / 180;
  const d0 = W(nodes[0]!);
  const sibSp = prop(p, 'sibSp') ?? 0;
  // en unidades en que el nodo mide 1: la cuerda entre centros vale 1 + separación
  const gap = d0 > 0 ? sibSp / d0 : 0.5;
  const step = span / n;
  const R = n === 1 ? 0 : (1 + gap) / (2 * Math.sin(Math.min(Math.PI / 2, Math.abs(step) / 2)));
  const pts = nodes.map((_, i) => ({ x: R * Math.sin(st + i * step), y: -R * Math.cos(st + i * step) }));
  const minX = Math.min(...pts.map((q) => q.x)) - 0.5;
  const maxX = Math.max(...pts.map((q) => q.x)) + 0.5;
  const minY = Math.min(...pts.map((q) => q.y)) - 0.5;
  const maxY = Math.max(...pts.map((q) => q.y)) + 0.5;
  const s = Math.min(W(p) / (maxX - minX), H(p) / (maxY - minY), d0 || Infinity);
  const ox = (W(p) - (maxX - minX) * s) / 2 - minX * s;
  const oy = (H(p) - (maxY - minY) * s) / 2 - minY * s;
  nodes.forEach((c, i) => {
    c.props.set('w', s);
    c.props.set('h', s * (d0 > 0 ? H(c) / d0 : 1));
    c.x = ox + pts[i]!.x * s - W(c) / 2;
    c.y = oy + pts[i]!.y * s - H(c) / 2;
  });
  // las transiciones van en el punto medio de la cuerda entre un nodo y el siguiente, giradas según ella
  trans.forEach((t, i) => {
    const a = nodes[i % n]!;
    const b = nodes[(i + 1) % n]!;
    const ax = a.x + W(a) / 2;
    const ay = a.y + H(a) / 2;
    const bx = b.x + W(b) / 2;
    const by = b.y + H(b) / 2;
    const dist = Math.hypot(bx - ax, by - ay) - s;
    t.props.set('connDist', dist);
    // la transición se reduce igual que los nodos: su ancho (y lo que depende de él) sigue la escala
    if (d0 > 0) t.props.set('w', W(t) * (s / d0));
    redo(t);
    const tw = W(t);
    const th = prop(t, 'h') ?? 0;
    t.x = (ax + bx) / 2 - tw / 2;
    t.y = (ay + by) / 2 - th / 2;
    t.rot = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
  });
}

/** `pyra`: niveles apilados de la base hacia arriba, cada uno tan ancho como su posición en la pila. */
function pyra(p: PNode): void {
  const levels = p.children;
  const n = levels.length;
  if (!n) return;
  const w = W(p);
  const h = H(p);
  const lvl = param(p, 'pyraLvlNode') ?? 'level';
  levels.forEach((c, i) => {
    for (const k of c.children) {
      if (k.name !== lvl) continue;
      k.locked = new Set(['w', 'h', 'l', 't', 'ctrX', 'ctrY']);
      k.props.set('w', (w * (i + 1)) / n);
      k.props.set('h', h / n);
      k.props.set('l', 0);
      k.props.set('t', 0);
      k.props.set('ctrX', (w * (i + 1)) / n / 2);
      k.props.set('ctrY', h / n / 2);
    }
    c.props.set('w', (w * (i + 1)) / n);
    c.props.set('h', h / n);
    c.x = (w - W(c)) / 2;
    c.y = (h * i) / n;
  });
}

// ---- jerarquías (hierRoot / hierChild)
function hierAncestor(n: PNode): boolean {
  for (let q = n.parent; q; q = q.parent) if (q.alg?.type === 'hierRoot' || q.alg?.type === 'hierChild') return true;
  return false;
}

const isHier = (n: PNode) => n.alg?.type === 'hierRoot' || n.alg?.type === 'hierChild';
const isConn = (n: PNode) => n.shape?.type === 'conn' || n.alg?.type === 'conn';

interface HNat {
  /** Anchura y altura naturales (antes de reducir) del subárbol. */
  w: number;
  h: number;
  /** Centro horizontal de la caja del nodo dentro del subárbol (solo en un hierRoot). */
  cx: number;
  /** Colocación natural de cada nodo del subárbol respecto del subárbol. */
  place: Map<PNode, { x: number; y: number }>;
}

/** Tamaño natural y colocación de un subárbol: el nodo se centra entre el primer y el último de sus hijos, que van en fila. */
function hierNatural(p: PNode): HNat {
  const place = new Map<PNode, { x: number; y: number }>();
  if (p.alg?.type === 'hierChild') {
    const roots = p.children.filter((c) => !isConn(c) && c.alg?.type === 'hierRoot');
    const gap = prop(p, 'sibSp') ?? 0;
    let x = 0;
    let h = 0;
    let first = 0;
    let last = 0;
    roots.forEach((c, i) => {
      const nat = hierNatural(c);
      place.set(c, { x, y: 0 });
      for (const [k, v] of nat.place) place.set(k, { x: v.x + x, y: v.y });
      if (i === 0) first = x + nat.cx;
      last = x + nat.cx;
      x += nat.w + (i < roots.length - 1 ? gap : 0);
      h = Math.max(h, nat.h);
      c.props.set('w', nat.w);
      c.props.set('h', nat.h);
    });
    return { w: x, h, cx: (first + last) / 2, place };
  }
  const boxes = p.children.filter((c) => !isHier(c) && !isConn(c));
  const sub = p.children.find((c) => c.alg?.type === 'hierChild');
  const bw = Math.max(0, ...boxes.map(W));
  const bh = Math.max(0, ...boxes.map(H));
  const subNat: HNat = sub ? hierNatural(sub) : { w: 0, h: 0, cx: 0, place: new Map() };
  const hasSub = !!sub && subNat.w > 0;
  const cx = hasSub ? subNat.cx : bw / 2;
  // el nodo se centra sobre sus hijos; el subárbol y el nodo pueden sobresalir uno del otro
  const left = Math.min(0, cx - bw / 2);
  const right = Math.max(hasSub ? subNat.w : 0, cx + bw / 2);
  const sp = prop(p, 'sp') ?? 0;
  for (const b of boxes) place.set(b, { x: cx - bw / 2 - left + (bw - W(b)) / 2, y: 0 });
  if (sub && hasSub) {
    place.set(sub, { x: -left, y: bh + sp });
    for (const [k, v] of subNat.place) place.set(k, { x: v.x - left, y: v.y + bh + sp });
    sub.props.set('w', subNat.w);
    sub.props.set('h', subNat.h);
  }
  return { w: right - left, h: bh + (hasSub ? sp + subNat.h : 0), cx: cx - left, place };
}

/** La jerarquía completa: tamaño natural, reducción a escala para que quepa y centrado en el dibujo. */
function hier(p: PNode, ctx: Ctx): void {
  const nat = hierNatural(p);
  const s = Math.min(1, W(p) / (nat.w || 1), H(p) / (nat.h || 1));
  const ox = (W(p) - nat.w * s) / 2;
  const oy = (H(p) - nat.h * s) / 2;
  // tamaños finales
  const done = new Set<PNode>();
  const shrink = (n: PNode) => {
    if (done.has(n)) return;
    done.add(n);
    for (const k of ['w', 'h', 'sp', 'sibSp']) if (n.props.has(k)) n.props.set(k, n.props.get(k)! * s);
  };
  for (const n of nat.place.keys()) shrink(n);
  // posición de cada nodo respecto de su padre
  const rel = (n: PNode, ax: number, ay: number) => {
    for (const c of n.children) {
      const v = nat.place.get(c);
      if (!v) continue;
      const cx = ox + v.x * s;
      const cy = oy + v.y * s;
      c.x = cx - ax;
      c.y = cy - ay;
      rel(c, cx, cy);
    }
  };
  p.x = 0;
  p.y = 0;
  rel(p, 0, 0);
  // el interior de cada caja (fondo y texto) se coloca con sus propias restricciones, ya con el tamaño final
  const inside = (n: PNode) => {
    for (const c of n.children) {
      if (isConn(c)) continue;
      if (isHier(c)) inside(c);
      else layoutNode(c, ctx, true);
    }
  };
  inside(p);
}

/** Hace el propio trabajo de un nodo y el de sus hijos. */
function layoutNode(p: PNode, ctx: Ctx, inner = false): void {
  if (!inner) fitAspect(p);
  applyConstraints(p, ctx, false);
  const redo = (c: PNode) => applyConstraints(c, ctx, true);
  p.children.forEach(redo);
  // una jerarquía se coloca entera desde su nodo más externo
  if (!inner && p.alg?.type === 'hierChild' && !hierAncestor(p)) {
    hier(p, ctx);
    return;
  }
  switch (p.alg?.type) {
    case 'hierRoot':
    case 'hierChild':
      break;
    case 'composite':
      composite(p);
      break;
    case 'snake':
      snake(p);
      break;
    case 'lin':
      lin(p, redo);
      break;
    case 'cycle':
      cycle(p, redo);
      break;
    case 'pyra':
      pyra(p);
      break;
    default:
      // `sp`, `tx`, `conn`: no colocan hijos; lo que haya dentro se centra (el texto de un conector, por ejemplo)
      for (const c of p.children) {
        c.props.set('w', prop(c, 'w') ?? W(p));
        c.props.set('h', prop(c, 'h') ?? H(p));
        c.x = (W(p) - W(c)) / 2;
        c.y = (H(p) - H(c)) / 2;
      }
  }
  for (const c of p.children) layoutNode(c, ctx, inner);
}

export interface Laid {
  root: PNode;
  ctx: Ctx;
}

/** Ejecuta el diseño sobre los datos y coloca todo en un dibujo de `width` x `height` puntos. */
export function layout(def: LayoutDef, tree: SmartTree, o: EngineOptions): Laid {
  const root = present(def, tree, o.vars);
  const ctx: Ctx = { o: { metrics: approxMetrics, vars: {}, ...o }, groups: [] };
  root.props.set('w', o.width);
  root.props.set('h', o.height);
  layoutNode(root, ctx);
  return { root, ctx };
}

export { presetDefaults, presetGeometry };
export type { Constr };
