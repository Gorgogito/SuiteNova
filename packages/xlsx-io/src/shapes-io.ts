/** Formas y cuadros de texto de la hoja (`xdr:sp` y `xdr:cxnSp` del dibujo de SpreadsheetML). */
import { SHAPE_FILL, SHAPE_LINE, type SheetShape, type ShapeKind } from '@suitenova/calc-engine';
import { avLstXml, cleanAdjust, hasPreset, isLineKind, parseGuide, presetOf } from '@suitenova/shapes-core';
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
  const rPr = `<a:rPr lang="es-ES" sz="${Math.round((s.fontSize ?? 11) * 100)}"${s.bold ? ' b="1"' : ''}${s.italic ? ' i="1"' : ''}>${s.textColor ? `<a:solidFill><a:srgbClr val="${hex(s.textColor)}"/></a:solidFill>` : ''}</a:rPr>`;
  const paras = (s.text ?? '')
    .split('\n')
    .map((line) => `<a:p><a:pPr algn="${algn}"/>${line ? `<a:r>${rPr}<a:t>${escapeXml(line)}</a:t></a:r>` : `<a:endParaRPr lang="es-ES" sz="${Math.round((s.fontSize ?? 11) * 100)}"/>`}</a:p>`)
    .join('');
  return `<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip" wrap="square" rtlCol="0" anchor="${anchor}"/><a:lstStyle/>${paras}</xdr:txBody>`;
}

/** Cuerpo de un ancla de dibujo para una forma; `w` y `h` son el tamaño en píxeles. */
export function shapeBodyXml(s: SheetShape, id: number): string {
  const name = escapeXml(s.name ?? `Forma ${id - 1}`);
  const xfrm = `<a:xfrm${s.rotation ? ` rot="${Math.round(s.rotation * 60000)}"` : ''}${s.flip ? ' flipH="1"' : ''}><a:off x="0" y="0"/><a:ext cx="${Math.round(s.width * EMU)}" cy="${Math.round(s.height * EMU)}"/></a:xfrm>`;
  const geom = `<a:prstGeom prst="${presetOf(s.kind)}">${avLstXml(s.adj)}</a:prstGeom>`;
  if (isLineKind(s.kind)) {
    return `<xdr:cxnSp macro=""><xdr:nvCxnSpPr><xdr:cNvPr id="${id}" name="${name}"${s.alt ? ` descr="${escapeXml(s.alt)}"` : ''}/><xdr:cNvCxnSpPr/></xdr:nvCxnSpPr><xdr:spPr>${xfrm}${geom}${lineXml(s.line === undefined ? { color: SHAPE_LINE, width: 2 } : s.line)}</xdr:spPr></xdr:cxnSp>`;
  }
  const hasText = !!s.text || s.kind === 'textBox';
  return (
    `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="${name}"${s.alt ? ` descr="${escapeXml(s.alt)}"` : ''}/><xdr:cNvSpPr${s.kind === 'textBox' ? ' txBox="1"' : ''}/></xdr:nvSpPr>` +
    `<xdr:spPr>${xfrm}${geom}${fillXml(s.fill === undefined ? (s.kind === 'textBox' ? null : SHAPE_FILL) : s.fill)}${lineXml(s.line === undefined ? (s.kind === 'textBox' ? { color: '#7f7f7f', width: 1 } : { color: SHAPE_LINE, width: 1 }) : s.line)}</xdr:spPr>` +
    `${hasText ? textXml(s) : ''}</xdr:sp>`
  );
}

// ------------------------------------------------------------------------------------------------ reading
const num = (v: unknown): number => Number(v ?? 0) || 0;

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
    const algn = attr(paras[0]?.pPr, 'algn');
    if (algn === 'l' || algn === 'r' || algn === 'ctr') out.hAlign = algn === 'l' ? 'left' : algn === 'r' ? 'right' : 'center';
    const anchor = attr(sp.txBody?.bodyPr, 'anchor');
    if (anchor === 't' || anchor === 'b' || anchor === 'ctr') out.vAlign = anchor === 't' ? 'top' : anchor === 'b' ? 'bottom' : 'middle';
  }
  return { shape: out, unsupported: known === undefined };
}
