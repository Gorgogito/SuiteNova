/** Formas y cuadros de texto de la hoja (`xdr:sp` y `xdr:cxnSp` del dibujo de SpreadsheetML). */
import { SHAPE_FILL, SHAPE_LINE, type SheetShape, type ShapeKind } from '@suitenova/calc-engine';
import { avLstXml, cleanAdjust, hasPreset, isLineKind, parseGuide, presetOf } from '@suitenova/shapes-core';
import { dmlTextFx, prstTxWarpXml, type FxColor, type FxFill, type WordArtFx } from '@suitenova/wordart-core';
import { resolveColor } from './colors';
import { asArray, attr, escapeXml, textOf, type XNode } from './xml';

const EMU = 9525;
const hex = (c: string) => c.replace('#', '').toUpperCase();

const fillXml = (fill: string | null | undefined): string => (fill === undefined ? '' : fill === null ? '<a:noFill/>' : `<a:solidFill><a:srgbClr val="${hex(fill)}"/></a:solidFill>`);
const lineXml = (line: SheetShape['line']): string =>
  line === undefined ? '' : line === null ? '<a:ln><a:noFill/></a:ln>' : `<a:ln w="${Math.round((line.width ?? 1) * EMU)}">${line.color ? `<a:solidFill><a:srgbClr val="${hex(line.color)}"/></a:solidFill>` : ''}</a:ln>`;

function textXml(s: SheetShape): string {
  const algn = { left: 'l', center: 'ctr', right: 'r' }[s.hAlign ?? (s.kind === 'textBox' ? 'left' : 'center')];
  const anchor = { top: 't', middle: 'ctr', bottom: 'b' }[s.vAlign ?? (s.kind === 'textBox' ? 'top' : 'middle')];
  // WordArt: el estilo va en `a:rPr` como en PowerPoint (contorno, relleno, efectos); si no, solo el color del texto
  const look = s.wordart ? dmlTextFx(s.wordart.fx) : s.textColor ? `<a:solidFill><a:srgbClr val="${hex(s.textColor)}"/></a:solidFill>` : '';
  const rPr = `<a:rPr lang="es-ES" sz="${Math.round((s.fontSize ?? 11) * 100)}"${s.bold ? ' b="1"' : ''}${s.italic ? ' i="1"' : ''}>${look}</a:rPr>`;
  const paras = (s.text ?? '')
    .split('\n')
    .map((line) => `<a:p><a:pPr algn="${algn}"/>${line ? `<a:r>${rPr}<a:t>${escapeXml(line)}</a:t></a:r>` : `<a:endParaRPr lang="es-ES" sz="${Math.round((s.fontSize ?? 11) * 100)}"/>`}</a:p>`)
    .join('');
  return `<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip" wrap="square" rtlCol="0" anchor="${anchor}">${s.wordart?.warp ? prstTxWarpXml(s.wordart.warp.prst, s.wordart.warp.adj) : ''}</a:bodyPr><a:lstStyle/>${paras}</xdr:txBody>`;
}

/** Cuerpo de un ancla de dibujo para una forma; `w` y `h` son el tamaño en píxeles. */
export function shapeBodyXml(s: SheetShape, id: number, at?: { x: number; y: number }): string {
  const name = escapeXml(s.name ?? `Forma ${id - 1}`);
  const xfrm = `<a:xfrm${s.rotation ? ` rot="${Math.round(s.rotation * 60000)}"` : ''}${s.flip ? ' flipH="1"' : ''}><a:off x="${at ? Math.round(at.x * EMU) : 0}" y="${at ? Math.round(at.y * EMU) : 0}"/><a:ext cx="${Math.round(s.width * EMU)}" cy="${Math.round(s.height * EMU)}"/></a:xfrm>`;
  const geom = `<a:prstGeom prst="${presetOf(s.kind)}">${avLstXml(s.adj)}</a:prstGeom>`;
  if (isLineKind(s.kind)) {
    return `<xdr:cxnSp macro=""><xdr:nvCxnSpPr><xdr:cNvPr id="${id}" name="${name}"${s.alt ? ` descr="${escapeXml(s.alt)}"` : ''}/><xdr:cNvCxnSpPr/></xdr:nvCxnSpPr><xdr:spPr>${xfrm}${geom}${lineXml(s.line === undefined ? { color: SHAPE_LINE, width: 2 } : s.line)}</xdr:spPr></xdr:cxnSp>`;
  }
  const hasText = !!s.text || s.kind === 'textBox' || !!s.wordart;
  return (
    `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="${name}"${s.alt ? ` descr="${escapeXml(s.alt)}"` : ''}/><xdr:cNvSpPr${s.kind === 'textBox' ? ' txBox="1"' : ''}/></xdr:nvSpPr>` +
    `<xdr:spPr>${xfrm}${geom}${fillXml(s.fill === undefined ? (s.kind === 'textBox' ? null : SHAPE_FILL) : s.fill)}${lineXml(s.line === undefined ? (s.kind === 'textBox' ? { color: '#7f7f7f', width: 1 } : { color: SHAPE_LINE, width: 1 }) : s.line)}</xdr:spPr>` +
    `${hasText ? textXml(s) : ''}</xdr:sp>`
  );
}

/**
 * Cuerpo de un ancla para un grupo de formas (`xdr:grpSp`). Los hijos usan las coordenadas absolutas de la hoja (el espacio del grupo es
 * el mismo que el de la hoja), así que no hace falta transformarlos.
 */
export function groupBodyXml(shapes: SheetShape[], id: number, name: string): string {
  const x1 = Math.min(...shapes.map((s) => s.x));
  const y1 = Math.min(...shapes.map((s) => s.y));
  const x2 = Math.max(...shapes.map((s) => s.x + s.width));
  const y2 = Math.max(...shapes.map((s) => s.y + s.height));
  const off = `<a:off x="${Math.round(x1 * EMU)}" y="${Math.round(y1 * EMU)}"/>`;
  const ext = `<a:ext cx="${Math.round((x2 - x1) * EMU)}" cy="${Math.round((y2 - y1) * EMU)}"/>`;
  const kids = shapes.map((s, i) => shapeBodyXml(s, 1000 * id + i + 1, { x: s.x, y: s.y })).join('');
  return `<xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr id="${id}" name="${escapeXml(name)}"/><xdr:cNvGrpSpPr/></xdr:nvGrpSpPr><xdr:grpSpPr><a:xfrm>${off}${ext}<a:chOff x="${Math.round(x1 * EMU)}" y="${Math.round(y1 * EMU)}"/><a:chExt cx="${Math.round((x2 - x1) * EMU)}" cy="${Math.round((y2 - y1) * EMU)}"/></a:xfrm></xdr:grpSpPr>${kids}</xdr:grpSp>`;
}

// ------------------------------------------------------------------------------------------------ reading
const num = (v: unknown): number => Number(v ?? 0) || 0;

export interface GroupedShape {
  shape: Omit<SheetShape, 'id' | 'x' | 'y' | 'width' | 'height'>;
  rect: { x: number; y: number; width: number; height: number };
  unsupported: boolean;
}

/**
 * Formas de un grupo (`xdr:grpSp`), con su rectángulo absoluto en la hoja. `frame` es el rectángulo (en píxeles) que ocupa el grupo; los
 * hijos se colocan según el espacio de coordenadas del grupo (`chOff`/`chExt`). Los grupos anidados se aplanan en uno solo.
 */
export function parseGroup(grp: XNode, frame: { x: number; y: number; width: number; height: number }, theme: string[]): GroupedShape[] {
  const xf = grp.grpSpPr?.xfrm;
  const chOff = xf?.chOff;
  const chExt = xf?.chExt;
  const cw = num(attr(chExt, 'cx')) / EMU;
  const ch = num(attr(chExt, 'cy')) / EMU;
  const sx = cw > 0 ? frame.width / cw : 1;
  const sy = ch > 0 ? frame.height / ch : 1;
  const ox = num(attr(chOff, 'x')) / EMU;
  const oy = num(attr(chOff, 'y')) / EMU;
  const rectOf = (x: XNode): { x: number; y: number; width: number; height: number } | null => {
    if (!x?.off || !x?.ext) return null;
    return {
      x: frame.x + (num(attr(x.off, 'x')) / EMU - ox) * sx,
      y: frame.y + (num(attr(x.off, 'y')) / EMU - oy) * sy,
      width: Math.max(1, (num(attr(x.ext, 'cx')) / EMU) * sx),
      height: Math.max(1, (num(attr(x.ext, 'cy')) / EMU) * sy),
    };
  };
  const out: GroupedShape[] = [];
  for (const [key, list] of [['sp', asArray(grp.sp)], ['cxnSp', asArray(grp.cxnSp)]] as const) {
    for (const child of list) {
      const parsed = parseShape({ [key]: child } as XNode, theme);
      const rect = rectOf(child.spPr?.xfrm);
      if (parsed && rect) out.push({ shape: parsed.shape, rect, unsupported: parsed.unsupported });
    }
  }
  for (const sub of asArray(grp.grpSp)) {
    const rect = rectOf(sub.grpSpPr?.xfrm);
    if (rect) out.push(...parseGroup(sub, rect, theme));
  }
  return out;
}

/** Forma leída de un ancla (`sp` o `cxnSp`); `null` si no es una forma. `unsupported` dice que la geometría se sustituyó por un rectángulo. */
export function parseShape(a: XNode, theme: string[]): { shape: Omit<SheetShape, 'id' | 'x' | 'y' | 'width' | 'height'>; unsupported: boolean } | null {
  const sp: XNode = a.sp ?? a.cxnSp;
  if (!sp) return null;
  const spPr = sp.spPr;
  const prst = attr(spPr?.prstGeom, 'prst') ?? 'rect';
  const isCxn = a.cxnSp !== undefined && a.sp === undefined;
  // las 187 geometrías de DrawingML se conservan por su nombre; un conector recto es una línea
  const known: ShapeKind | undefined = prst === 'straightConnector1' ? 'line' : hasPreset(prst) ? prst : undefined;
  const txBox = attr((sp.nvSpPr ?? {}).cNvSpPr, 'txBox') === '1';
  let kind: ShapeKind = known ?? (isCxn ? 'line' : 'rect');
  if (kind === 'rect' && txBox) kind = 'textBox';
  const color = (n: XNode): string | undefined => {
    if (!n) return undefined;
    if (n.srgbClr) return resolveColor({ rgb: attr(n.srgbClr, 'val') }, theme);
    if (n.schemeClr) {
      const idx: Record<string, number> = { lt1: 0, dk1: 1, lt2: 2, dk2: 3, accent1: 4, accent2: 5, accent3: 6, accent4: 7, accent5: 8, accent6: 9, bg1: 0, tx1: 1, bg2: 2, tx2: 3 };
      const i = idx[attr(n.schemeClr, 'val') ?? ''];
      return i === undefined ? undefined : resolveColor({ theme: String(i) }, theme);
    }
    return undefined;
  };
  const out: Omit<SheetShape, 'id' | 'x' | 'y' | 'width' | 'height'> = { kind };
  // relleno: explícito, sin relleno, o el del estilo por omisión de Excel
  if (spPr?.noFill !== undefined) out.fill = null;
  else if (spPr?.solidFill !== undefined) out.fill = color(spPr.solidFill) ?? SHAPE_FILL;
  else if (sp.style !== undefined && !isLineKind(kind) && kind !== 'textBox') out.fill = SHAPE_FILL;
  const ln = spPr?.ln;
  if (ln?.noFill !== undefined) out.line = null;
  else if (ln || sp.style !== undefined) {
    const w = ln ? num(attr(ln, 'w')) / EMU : 0;
    const c = color(ln?.solidFill) ?? (sp.style !== undefined ? SHAPE_LINE : undefined);
    out.line = { ...(c ? { color: c } : {}), ...(w > 0 ? { width: Math.round(w * 4) / 4 } : {}) };
  }
  if (attr(spPr?.xfrm, 'flipH') === '1' && isLineKind(kind)) out.flip = true;
  const rot = (((num(attr(spPr?.xfrm, 'rot')) / 60000) % 360) + 360) % 360;
  if (rot > 0.05) out.rotation = Math.round(rot * 10) / 10;
  const adj: Record<string, number> = {};
  for (const g of asArray(spPr?.prstGeom?.avLst?.gd)) {
    const p = parseGuide(attr(g, 'name'), attr(g, 'fmla'));
    if (p) adj[p[0]] = p[1];
  }
  const clean = known ? cleanAdjust(kind, adj) : undefined;
  if (clean) out.adj = clean;
  const nv = (sp.nvSpPr ?? sp.nvCxnSpPr)?.cNvPr;
  const name = attr(nv, 'name');
  if (name) out.name = name;
  const alt = attr(nv, 'descr');
  if (alt) out.alt = alt;
  // texto
  const paras = asArray(sp.txBody?.p);
  const lines = paras.map((p: XNode) => asArray(p.r).map((r: XNode) => textOf(r.t)).join(''));
  const text = lines.join('\n').replace(/\n+$/, '');
  if (text) {
    out.text = text;
    const first = asArray(paras[0]?.r)[0];
    const rp = first?.rPr;
    const sz = num(attr(rp, 'sz'));
    if (sz > 0) out.fontSize = sz / 100;
    if (attr(rp, 'b') === '1') out.bold = true;
    if (attr(rp, 'i') === '1') out.italic = true;
    const tc = color(rp?.solidFill);
    if (tc) out.textColor = tc;
    const wa = wordArtOf(sp.txBody?.bodyPr, rp, color);
    if (wa) out.wordart = wa;
    const algn = attr(paras[0]?.pPr, 'algn');
    if (algn === 'l' || algn === 'r' || algn === 'ctr') out.hAlign = algn === 'l' ? 'left' : algn === 'r' ? 'right' : 'center';
    const anchor = attr(sp.txBody?.bodyPr, 'anchor');
    if (anchor === 't' || anchor === 'b' || anchor === 'ctr') out.vAlign = anchor === 't' ? 'top' : anchor === 'b' ? 'bottom' : 'middle';
  }
  return { shape: out, unsupported: known === undefined };
}

const pct = (v: unknown): number => (Number(v ?? 100000) || 0) / 100000;

/**
 * WordArt de un cuadro: la transformación (`a:prstTxWarp` de `bodyPr`) y el estilo del texto (contorno, relleno y efectos de `a:rPr`).
 * `null` si no hay transformación ni nada más que un color liso: eso es solo texto con color.
 */
function wordArtOf(bodyPr: XNode, rp: XNode, color: (n: XNode) => string | undefined): SheetShape['wordart'] | null {
  const tw = bodyPr?.prstTxWarp;
  const prst = attr(tw, 'prst');
  let warp: { prst: string; adj?: Record<string, number> } | null = null;
  if (prst && prst !== 'textNoShape') {
    const adj: Record<string, number> = {};
    for (const g of asArray(tw.avLst?.gd)) {
      const p = parseGuide(attr(g, 'name'), attr(g, 'fmla'));
      if (p) adj[p[0]] = p[1];
    }
    warp = { prst, ...(Object.keys(adj).length ? { adj } : {}) };
  }
  const clr = (n: XNode): FxColor | null => {
    const c = color(n);
    if (!c) return null;
    const a = n?.srgbClr?.alpha;
    return { color: c.toLowerCase(), alpha: a ? pct(attr(a, 'val')) : 1 };
  };
  const ln = rp?.ln;
  const eff = rp?.effectLst;
  const grad = rp?.gradFill;
  if (!warp && !grad && !ln && !eff) return null;
  let fill: FxFill = { type: 'solid', color: '#000000' };
  if (rp?.noFill !== undefined) fill = { type: 'none' };
  else if (grad) {
    const stops = asArray(grad.gsLst?.gs).flatMap((g: XNode) => {
      const c = clr(g);
      return c ? [{ pos: pct(attr(g, 'pos')), ...c }] : [];
    });
    if (stops.length >= 2) fill = { type: 'gradient', angle: (Number(attr(grad.lin, 'ang') ?? 0) || 0) / 60000, stops };
  } else {
    const c = clr(rp?.solidFill);
    if (c) fill = { type: 'solid', ...c };
  }
  const fx: WordArtFx = { fill };
  const oc = ln && !ln.noFill ? clr(ln.solidFill) : null;
  if (ln && oc) fx.outline = { ...oc, width: Math.max(0.25, (Number(attr(ln, 'w') ?? EMU) || EMU) / EMU) };
  const gl = eff?.glow && clr(eff.glow);
  if (gl) fx.glow = { ...gl, radius: (Number(attr(eff.glow, 'rad') ?? 0) || 0) / EMU };
  const sh = eff?.outerShdw && clr(eff.outerShdw);
  if (sh) {
    const dist = (Number(attr(eff.outerShdw, 'dist') ?? 0) || 0) / EMU;
    const dir = ((Number(attr(eff.outerShdw, 'dir') ?? 0) || 0) / 60000 / 180) * Math.PI;
    fx.shadow = { ...sh, blur: (Number(attr(eff.outerShdw, 'blurRad') ?? 0) || 0) / EMU, dx: Math.round(dist * Math.cos(dir) * 1000) / 1000, dy: Math.round(dist * Math.sin(dir) * 1000) / 1000 };
  }
  if (eff?.reflection) {
    const r = eff.reflection;
    fx.reflection = { alpha: pct(attr(r, 'stA')), size: pct(attr(r, 'endPos')), gap: (Number(attr(r, 'dist') ?? 0) || 0) / EMU };
  }
  return { fx, warp };
}
