import { colAtPx, colOffsetPx, rowAtPx, rowOffsetPx, type Sheet } from '@suitenova/calc-engine';
import { DIAGRAM_URI } from '@suitenova/smartart-core';
import { NS_A, NS_C } from '@suitenova/chart-core';
import { NS_CX } from '@suitenova/chart-core';
import { groupBodyXml, shapeBodyXml } from './shapes-io';
import { escapeXml, attr, type XNode } from './xml';

const EMU = 9525;
export { NS_A, NS_C };
export const NS_XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
export const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// ------------------------------------------------------------------------------------------------ drawings
export interface DrawingItem {
  kind: 'chart' | 'pic' | 'shape' | 'group' | 'smartart';
  /** Para un SmartArt: los identificadores de relación de sus cuatro partes. */
  dgm?: { dm: string; lo: string; qs: string; cs: string };
  /** For shapes: the shape itself. */
  shape?: import('@suitenova/calc-engine').SheetShape;
  /** For groups: the shapes of the group. */
  group?: import('@suitenova/calc-engine').SheetShape[];
  /** The chart is an Excel 2016 chart (chartex): the anchor carries a fallback for older versions. */
  ex?: boolean;
  /** Relationship id of the chart or image part. */
  rId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  alt?: string;
  /** For pictures: the picture itself (crop, shape, outline, shadow, rotation, how it follows the cells). */
  img?: import('@suitenova/calc-engine').SheetImage;
}

const hex6 = (c: string): string => c.replace('#', '').toUpperCase();
const DASH: Record<string, string> = { dash: 'dash', dot: 'sysDot', dashdot: 'dashDot' };

/**
 * The box a rotated picture covers on the sheet. Excel anchors a rotated picture by this box (what the person sees), while `a:xfrm` keeps the
 * box before turning: writing the unturned box as the anchor makes Excel swap width and height of a picture turned a quarter.
 */
export function rotatedBounds(x: number, y: number, w: number, h: number, deg: number): { x: number; y: number; width: number; height: number } {
  const r = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const bw = w * c + h * s;
  const bh = w * s + h * c;
  return { x: x + w / 2 - bw / 2, y: y + h / 2 - bh / 2, width: bw, height: bh };
}

/** The `xdr:pic` of a picture: the picture as it shows, cut with `srcRect`, with the shape, outline, shadow, rotation and flips of the frame. */
function picBodyXml(c: DrawingItem, id: number): string {
  const im = c.img;
  const crop = im?.crop;
  const rot = im?.rotation ? ` rot="${Math.round((((im.rotation % 360) + 360) % 360) * 60000)}"` : '';
  const flips = `${im?.flipH ? ' flipH="1"' : ''}${im?.flipV ? ' flipV="1"' : ''}`;
  const b = im?.border;
  const ln = b ? `<a:ln w="${Math.round(b.width * 12700)}"><a:solidFill><a:srgbClr val="${hex6(b.color)}"/></a:solidFill>${b.dash && DASH[b.dash] ? `<a:prstDash val="${DASH[b.dash]}"/>` : ''}</a:ln>` : '';
  const sh = im?.shadow;
  const fx = sh ? `<a:effectLst><a:outerShdw blurRad="${Math.round(sh.blur * 12700)}" dist="${Math.round(sh.dist * 12700)}" dir="${Math.round((((sh.angle % 360) + 360) % 360) * 60000)}" algn="ctr" rotWithShape="0"><a:srgbClr val="${hex6(sh.color)}"><a:alpha val="${Math.round(sh.alpha * 100000)}"/></a:srgbClr></a:outerShdw></a:effectLst>` : '';
  return `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="${escapeXml(c.name)}"${c.alt ? ` descr="${escapeXml(c.alt)}"` : ''}/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
    `<xdr:blipFill><a:blip xmlns:r="${NS_R}" r:embed="${c.rId}"/>${crop ? `<a:srcRect l="${Math.round(crop.l)}" t="${Math.round(crop.t)}" r="${Math.round(crop.r)}" b="${Math.round(crop.b)}"/>` : ''}<a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
    `<xdr:spPr><a:xfrm${rot}${flips}><a:off x="${Math.round(c.x * EMU)}" y="${Math.round(c.y * EMU)}"/><a:ext cx="${Math.round(c.width * EMU)}" cy="${Math.round(c.height * EMU)}"/></a:xfrm><a:prstGeom prst="${im?.shape || 'rect'}"><a:avLst/></a:prstGeom>${ln}${fx}</xdr:spPr></xdr:pic>`;
}

/** Drawing part with one two-cell anchor per object. */
export function drawingXml(sheet: Sheet, items: DrawingItem[]): string {
  const anchors = items
    .map((c, i) => {
      const box = c.kind === 'pic' && c.img?.rotation ? rotatedBounds(c.x, c.y, c.width, c.height, c.img.rotation) : { x: c.x, y: c.y, width: c.width, height: c.height };
      const from = { col: colAtPx(sheet, box.x), row: rowAtPx(sheet, box.y) };
      const to = { col: colAtPx(sheet, box.x + box.width), row: rowAtPx(sheet, box.y + box.height) };
      const pt = (p: { col: { col: number; offset: number }; row: { row: number; offset: number } }) =>
        `<xdr:col>${p.col.col}</xdr:col><xdr:colOff>${Math.round(p.col.offset * EMU)}</xdr:colOff><xdr:row>${p.row.row}</xdr:row><xdr:rowOff>${Math.round(p.row.offset * EMU)}</xdr:rowOff>`;
      const id = i + 2;
      const body =
        c.kind === 'smartart'
          ? `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="${escapeXml(c.name)}"${c.alt ? ` descr="${escapeXml(c.alt)}"` : ''}/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
            `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${DIAGRAM_URI}"><dgm:relIds xmlns:dgm="${DIAGRAM_URI}" r:dm="${c.dgm!.dm}" r:lo="${c.dgm!.lo}" r:qs="${c.dgm!.qs}" r:cs="${c.dgm!.cs}"/></a:graphicData></a:graphic></xdr:graphicFrame>`
          : c.kind === 'group'
          ? groupBodyXml(c.group!, id, c.name)
          : c.kind === 'shape'
          ? shapeBodyXml(c.shape!, id, undefined, c.rId || undefined)
          : c.kind === 'chart' && c.ex
          ? `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:cx1="http://schemas.microsoft.com/office/drawing/2015/9/8/chartex" Requires="cx1">` +
            `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="${escapeXml(c.name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
            `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS_CX}"><cx:chart xmlns:cx="${NS_CX}" r:id="${c.rId}"/></a:graphicData></a:graphic></xdr:graphicFrame></mc:Choice>` +
            `<mc:Fallback><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="0" name=""/><xdr:cNvSpPr><a:spLocks noTextEdit="1"/></xdr:cNvSpPr></xdr:nvSpPr>` +
            `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(c.width * EMU)}" cy="${Math.round(c.height * EMU)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:prstClr val="white"/></a:solidFill></xdr:spPr>` +
            `<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip"/><a:lstStyle/><a:p><a:r><a:rPr lang="es-ES"/><a:t>Este gráfico no está disponible en esta versión de Excel.</a:t></a:r></a:p></xdr:txBody></xdr:sp></mc:Fallback></mc:AlternateContent>`
          : c.kind === 'chart'
          ? `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="${escapeXml(c.name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
            `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" r:id="${c.rId}"/></a:graphicData></a:graphic></xdr:graphicFrame>`
          : picBodyXml(c, id);
      // twoCell is the default of the format; a picture without a choice is written as it behaves, moving without resizing
      const edit = c.kind === 'pic' && c.img?.anchor ? (c.img.anchor === 'twoCell' ? '' : ` editAs="${c.img.anchor === 'absolute' ? 'absolute' : 'oneCell'}"`) : c.kind === 'pic' || c.kind === 'shape' || c.kind === 'group' || c.kind === 'smartart' ? ' editAs="oneCell"' : '';
      return `<xdr:twoCellAnchor${edit}><xdr:from>${pt(from)}</xdr:from><xdr:to>${pt(to)}</xdr:to>${body}<xdr:clientData/></xdr:twoCellAnchor>`;
    })
    .join('');
  void colOffsetPx;
  void rowOffsetPx;
  return `${HEAD}<xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}" xmlns:r="${NS_R}">${anchors}</xdr:wsDr>`;
}


/** Anchor of a drawing object in sheet pixels. */
export function anchorToRect(sheet: Sheet, anchor: XNode): { x: number; y: number; width: number; height: number } | null {
  // row/col are array-typed tags elsewhere in the parser configuration, so unwrap single-item arrays
  const num = (n: XNode): number => {
    const v = Array.isArray(n) ? n[0] : n;
    return Number(typeof v === 'object' && v !== null ? (v['#text'] ?? 0) : (v ?? 0));
  };
  const from = anchor.from;
  if (from) {
    const x = colOffsetPx(sheet, num(from.col)) + num(from.colOff) / EMU;
    const y = rowOffsetPx(sheet, num(from.row)) + num(from.rowOff) / EMU;
    if (anchor.to) {
      const x2 = colOffsetPx(sheet, num(anchor.to.col)) + num(anchor.to.colOff) / EMU;
      const y2 = rowOffsetPx(sheet, num(anchor.to.row)) + num(anchor.to.rowOff) / EMU;
      return { x, y, width: Math.max(10, x2 - x), height: Math.max(10, y2 - y) };
    }
    const ext = anchor.ext;
    return { x, y, width: Math.max(10, num(attr(ext, 'cx')) / EMU), height: Math.max(10, num(attr(ext, 'cy')) / EMU) };
  }
  const pos = anchor.pos;
  const ext = anchor.ext;
  if (pos && ext) return { x: Number(attr(pos, 'x') ?? 0) / EMU, y: Number(attr(pos, 'y') ?? 0) / EMU, width: Number(attr(ext, 'cx') ?? 0) / EMU, height: Number(attr(ext, 'cy') ?? 0) / EMU };
  return null;
}

