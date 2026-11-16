import { presetDefaults, presetGeometry } from '@suitenova/shapes-core';
import type { DrawnShape } from '../drawing';
import type { LayoutDef } from '../layoutdef';
import type { SmartTree } from '../model';
import { el, txt, type El } from '../xml';
import type { DNode } from './data';
import { allNodes, type PNode } from './present';
import { layout, type EngineOptions, type TextMetrics } from './layout';

/*
 * De los nodos colocados a las formas dibujadas: posición absoluta en EMU, geometría (con los ajustes del diseño), giro y texto con el
 * tamaño de letra que cabe. Los nodos con `hideGeom` no dibujan forma: su texto y su rectángulo pasan a la forma del mismo dato.
 */

const EMU = 12700;
const MARGIN = ['lMarg', 'rMarg', 'tMarg', 'bMarg'] as const;
const param = (p: PNode, name: string): string | undefined => p.alg?.params.find((x) => x.type === name)?.val;

interface Para {
  text: string;
  level: number;
}

function textOf(p: PNode): Para[] {
  const out: Para[] = [];
  const pts = p.present.filter((d) => d.kind === 'node' || d.kind === 'asst');
  pts.forEach((d, i) => {
    const level = Math.max(0, d.depth - (pts[0]?.depth ?? d.depth));
    const text = d.node?.text ?? '';
    if (i === 0 && level === 0) {
      for (const line of text.split('\n')) out.push({ text: line, level: 0 });
    } else for (const line of text.split('\n')) out.push({ text: line, level: Math.max(1, level) });
  });
  return out;
}

/** El factor del margen de un nodo: `size * factor` puntos (0 si no tiene restricción de margen). */
function marginFactor(p: PNode, type: string): number {
  const c = p.constrs.find((x) => x.type === type && x.for === 'self');
  if (!c) return 0;
  if (c.refType === 'primFontSz' || c.refType === 'secFontSz') return c.fact;
  return 0;
}

function absolute(p: PNode): { x: number; y: number } {
  let x = p.x;
  let y = p.y;
  for (let q = p.parent; q; q = q.parent) {
    x += q.x;
    y += q.y;
  }
  return { x, y };
}

function textRect(p: PNode): { l: number; t: number; r: number; b: number } {
  const w = p.props.get('w') ?? 0;
  const h = p.props.get('h') ?? 0;
  const prst = p.shape?.type && p.shape.type !== 'conn' ? p.shape.type : p.shape?.type === 'conn' ? 'rightArrow' : 'rect';
  const adj = adjOf(prst, p);
  const g = presetGeometry(prst, w, h, adj);
  return g ? g.textRect : { l: 0, t: 0, r: w, b: h };
}

function adjOf(prst: string, p: PNode): Record<string, number> {
  const names = Object.keys(presetDefaults(prst));
  const out: Record<string, number> = {};
  for (const a of p.shape?.adj ?? []) {
    const n = names[a.idx - 1];
    if (n) out[n] = a.val * 100000;
  }
  return out;
}

function wrapLines(text: string, size: number, width: number, m: TextMetrics): { lines: number; widest: number } {
  let lines = 0;
  let widest = 0;
  for (const para of text.split('\n')) {
    let cur = '';
    let n = 1;
    for (const word of para.split(' ')) {
      widest = Math.max(widest, m.width(word, size));
      const next = cur ? `${cur} ${word}` : word;
      if (m.width(next, size) <= width || !cur) cur = next;
      else {
        n++;
        cur = word;
      }
    }
    lines += n;
  }
  return { lines, widest };
}

/** El mayor tamaño de letra (entero, hasta `max`) con que el texto cabe en el rectángulo del nodo. */
function fit(p: PNode, paras: Para[], max: number, min: number, m: TextMetrics): number {
  const tr = textRect(p);
  const text = paras.length ? paras.map((x) => x.text).join('\n') : '[Texto]';
  for (let size = Math.floor(max); size > min; size--) {
    const mg = (t: string) => marginFactor(p, t) * size;
    const iw = tr.r - tr.l - mg('lMarg') - mg('rMarg');
    const ih = tr.b - tr.t - mg('tMarg') - mg('bMarg');
    const { lines, widest } = wrapLines(text, size, Math.max(1, iw), m);
    if (widest <= iw && lines * size * 1.2 <= ih) return size;
  }
  return min;
}

function body(p: PNode, paras: Para[], size: number): El {
  const mg = (t: string) => Math.round(marginFactor(p, t) * size * EMU);
  const ps = (paras.length ? paras : [{ text: '', level: 0 }]).map((x) => {
    const ppr = x.level > 0 ? [el('a:pPr', { marL: String(114300 * x.level), lvl: String(x.level), indent: '-114300' }, [el('a:buChar', { char: '•' })])] : [el('a:pPr', { algn: 'ctr' })];
    if (x.text === '') return el('a:p', {}, [...ppr, el('a:endParaRPr', { lang: 'es-ES', sz: String(Math.round(size * 100)) })]);
    return el('a:p', {}, [...ppr, el('a:r', {}, [el('a:rPr', { lang: 'es-ES', sz: String(Math.round(size * 100)) }), el('a:t', {}, [txt(x.text)])])]);
  });
  return el('dsp:txBody', {}, [
    el('a:bodyPr', { spcFirstLastPara: '0', vert: 'horz', wrap: 'square', lIns: String(mg('lMarg')), tIns: String(mg('tMarg')), rIns: String(mg('rMarg')), bIns: String(mg('bMarg')), numCol: '1', spcCol: '1270', anchor: 'ctr', anchorCtr: '0' }, [el('a:noAutofit')]),
    el('a:lstStyle'),
    ...ps,
  ]);
}

/** Dibuja un diseño sobre unos datos: las formas del SmartArt en un dibujo de `o.width` x `o.height` puntos. */
export function render(def: LayoutDef, tree: SmartTree, o: EngineOptions): DrawnShape[] {
  const laid = layout(def, tree, o);
  const metrics = laid.ctx.o.metrics;
  const nodes = allNodes(laid.root);
  const sizeOf = new Map<PNode, number>();
  // grupos de letra igual: el menor de los tamaños que caben
  for (const g of laid.ctx.groups) {
    const members = g.members.filter((n) => n.alg?.type === 'tx' || n.present.length);
    const min = 5;
    const fits = members.map((n) => fit(n, textOf(n), g.max, min, metrics));
    const s = fits.length ? Math.min(...fits) : g.max;
    for (const n of members) sizeOf.set(n, Math.min(sizeOf.get(n) ?? Infinity, s));
  }
  const shapes: { s: DrawnShape; z: number; key: string }[] = [];
  const byData = new Map<string, DrawnShape>();
  for (const p of nodes) {
    if (!p.shape || !p.shape.type) continue;
    const w = p.props.get('w') ?? 0;
    const h = p.props.get('h') ?? 0;
    const a = absolute(p);
    const paras = textOf(p);
    const hasTx = p.alg?.type === 'tx' || paras.length > 0;
    const size = sizeOf.get(p) ?? (hasTx ? fit(p, paras, p.props.get('primFontSz') ?? 65, 5, metrics) : 0);
    const rot = (((p.shape.rot + p.rot) % 360) + 360) % 360;
    if (p.shape.type === 'conn' && p.shape.hideGeom) continue;
    const swap = rot === 90 || rot === 270;
    const prst = p.shape.type === 'conn' ? 'rightArrow' : p.shape.type;
    const key = p.present[0]?.id ?? p.id;
    if (p.shape.hideGeom) {
      // sin forma propia: su texto y su rectángulo van a la forma del mismo dato
      const host = byData.get(key);
      if (host && hasTx) {
        host.txBody = body(p, paras, size || 14);
        host.txXfrm = { x: Math.round(a.x * EMU), y: Math.round(a.y * EMU), w: Math.round(w * EMU), h: Math.round(h * EMU), rot: 0 };
      }
      continue;
    }
    // conector de una jerarquía: línea con codo del centro de abajo del padre al centro de arriba del hijo
    if (p.shape.type === 'conn' && param(p, 'connRout') === 'bend') {
      const child = (p.ctx as DNode).owner;
      const parentDn = child?.parent;
      const find = (dn: DNode | undefined) => nodes.find((n) => n.ctx === dn && n.name.startsWith('background'));
      const src = find(parentDn);
      const dst = find(child);
      if (src && dst) {
        const sa = absolute(src);
        const da = absolute(dst);
        const sx = sa.x + (src.props.get('w') ?? 0) / 2;
        const sy = sa.y + (src.props.get('h') ?? 0);
        const dx = da.x + (dst.props.get('w') ?? 0) / 2;
        const dy = da.y;
        // Office no dibuja un conector más estrecho que 7,2 pt: uno recto se queda en esa anchura, centrado
        const wide = Math.max(Math.abs(dx - sx), 7.2);
        const bw = wide * EMU;
        const bh = Math.max(0, dy - sy) * EMU;
        const path = el('a:path', { w: String(Math.round(bw)), h: String(Math.round(bh)), fill: 'none' }, [
          el('a:moveTo', {}, [el('a:pt', { x: '0', y: '0' })]),
          el('a:lnTo', {}, [el('a:pt', { x: '0', y: String(Math.round(bh / 2)) })]),
          el('a:lnTo', {}, [el('a:pt', { x: String(Math.round(bw)), y: String(Math.round(bh / 2)) })]),
          el('a:lnTo', {}, [el('a:pt', { x: String(Math.round(bw)), y: String(Math.round(bh)) })]),
        ]);
        const custGeom = el('a:custGeom', {}, [el('a:avLst'), el('a:gdLst'), el('a:ahLst'), el('a:cxnLst'), el('a:rect', { l: '0', t: '0', r: '0', b: '0' }), el('a:pathLst', {}, [path])]);
        shapes.push({ s: { modelId: p.id, x: Math.round(((sx + dx) / 2 - wide / 2) * EMU), y: Math.round(sy * EMU), w: Math.round(bw), h: Math.round(bh), rot: 0, flipH: dx < sx, flipV: false, adj: {}, custGeom, spPr: [] }, z: p.shape.zOrderOff, key: p.id });
      }
      continue;
    }
    let cx = a.x + w / 2;
    let cy = a.y + h / 2;
    let fw = swap ? h : w;
    const fh = swap ? w : h;
    if (p.shape.type === 'conn') {
      // un conector se dibuja en el hueco entre dos nodos, sin tocarlos: se descuentan los márgenes del principio y del final
      const dist = p.props.get('connDist') ?? w;
      if (!(dist > 0)) continue;
      const fact = (t: string, d: number) => {
        const c = p.constrs.find((x) => x.type === t && x.for === 'self');
        return c && c.refType === 'connDist' ? c.fact : d;
      };
      const beg = fact('begPad', 0.25) * dist;
      const end = fact('endPad', 0.22) * dist;
      const len = Math.max(0, dist - beg - end);
      const ang = (p.rot * Math.PI) / 180;
      const shift = (beg - end) / 2;
      cx += Math.cos(ang) * shift;
      cy += Math.sin(ang) * shift;
      fw = len;
    }
    const shape: DrawnShape = {
      modelId: p.id,
      x: Math.round((cx - fw / 2) * EMU),
      y: Math.round((cy - fh / 2) * EMU),
      w: Math.round(fw * EMU),
      h: Math.round(fh * EMU),
      rot: Math.round(rot * 60000),
      flipH: false,
      flipV: false,
      prst,
      adj: adjOf(prst, p),
      spPr: [],
    };
    if (hasTx) {
      shape.txBody = body(p, paras, size || 14);
      const tr = textRect(p);
      if (!swap) shape.txXfrm = { x: Math.round((a.x + tr.l) * EMU), y: Math.round((a.y + tr.t) * EMU), w: Math.round((tr.r - tr.l) * EMU), h: Math.round((tr.b - tr.t) * EMU), rot: 0 };
    }
    byData.set(key, shape);
    shapes.push({ s: shape, z: p.shape.zOrderOff, key });
  }
  return shapes
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => a.z - b.z || a.i - b.i)
    .map((x) => x.s);
}

void MARGIN;
