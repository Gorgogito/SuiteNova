import { esc } from '@suitenova/writer-core';
import type { ChartEl, ConnEl, GroupEl, MediaEl, OleEl, PicEl, ShapeEl, SlideElement, StyleRef, TableCell, TableEl, TableStyleDef } from '../types';
import { clrXml, effectsXml, fillXml, geomXml, lnXml, txBodyXml, xfrmXml, EMU, type WriteCtx } from './dmlw';
import { chartXml } from './chartw';

export interface PartWriter extends WriteCtx {
  /** numeric shape id for an element (kept from the original file when there is one) */
  shapeId(el: SlideElement): number;
  /** adds a relationship of the current part; returns its id */
  rel(type: string, target: string, external?: boolean): string;
  /** registers a part of the package and returns its path */
  addPart(path: string, bytes: Uint8Array | string, contentType?: string): string;
  /** a fresh, unused path like `ppt/charts/chart3.xml` */
  freshPath(dir: string, base: string, ext: string): string;
  /** the media path of an asset (registers it) */
  media(assetId: string): { path: string; mime: string } | undefined;
  /** copies raw parts under fresh names (rewriting their relationships); returns the new path of each */
  copyRaw(raw: Record<string, Uint8Array>): Map<string, string>;
  /** rewrites the text of a part already added */
  patchPart(path: string, fn: (text: string) => string): void;
  slidePath(slideId: string): string | undefined;
  /** table style GUID to write for a style id of the model */
  tableStyleGuid(id: string | undefined): string | undefined;
}

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const attr = (k: string, v: string | number | boolean | undefined): string => (v === undefined || v === '' ? '' : ` ${k}="${typeof v === 'boolean' ? (v ? 1 : 0) : esc(String(v))}"`);

function cNvPr(el: SlideElement, w: PartWriter, extra = ''): string {
  const id = w.shapeId(el);
  const link = el.hlink ? hl(el.hlink, w) : '';
  return `<p:cNvPr id="${id}" name="${esc(el.name ?? `Objeto ${id}`)}"${attr('descr', el.descr)}${attr('title', el.title)}${el.hidden ? ' hidden="1"' : ''}${extra}>${link}</p:cNvPr>`;
}
function hl(h: NonNullable<SlideElement['hlink']>, w: PartWriter): string {
  const l = w.link(h);
  return l ? `<a:hlinkClick r:id="${l.rid}"${attr('action', l.action)}${attr('tooltip', h.tooltip)}/>` : '';
}

function phXml(ph: ShapeEl['ph']): string {
  if (!ph) return '';
  return `<p:ph${ph.type !== 'obj' ? attr('type', ph.type) : ''}${ph.orient && ph.orient !== 'horz' ? attr('orient', ph.orient) : ''}${attr('sz', ph.sz)}${ph.idx !== undefined ? attr('idx', ph.idx) : ''}${ph.hasCustomPrompt ? ' hasCustomPrompt="1"' : ''}/>`;
}

export function styleXml(s: StyleRef | undefined): string {
  if (!s) return '';
  const ref = (tag: string, r: { idx: number; c?: import('../types').Clr } | undefined) => (r ? `<a:${tag} idx="${r.idx}">${clrXml(r.c ?? { scheme: 'accent1' })}</a:${tag}>` : `<a:${tag} idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:${tag}>`);
  const font = s.font ? `<a:fontRef idx="${s.font.idx}">${s.font.c ? clrXml(s.font.c) : ''}</a:fontRef>` : '<a:fontRef idx="minor"/>';
  return `<p:style>${ref('lnRef', s.ln)}${ref('fillRef', s.fill)}${ref('effectRef', s.effect)}${font}</p:style>`;
}

function spPr(el: { xfrm?: ShapeEl['xfrm']; geom?: ShapeEl['geom']; fill?: ShapeEl['fill']; ln?: ShapeEl['ln']; effects?: ShapeEl['effects'] }, w: PartWriter, noGeom = false): string {
  const inner = `${xfrmXml(el.xfrm)}${noGeom ? '' : geomXml(el.geom)}${fillXml(el.fill, w)}${lnXml(el.ln, w)}${effectsXml(el.effects)}`;
  return inner ? `<p:spPr>${inner}</p:spPr>` : '<p:spPr/>';
}

// ------------------------------------------------------------------------------------------------ elements

function shapeXml(el: ShapeEl, w: PartWriter): string {
  const hasGeomNeeded = !el.ph || el.geom;
  return `<p:sp><p:nvSpPr>${cNvPr(el, w)}<p:cNvSpPr${el.isTextBox ? ' txBox="1"' : ''}>${el.ph ? '<a:spLocks noGrp="1"/>' : ''}</p:cNvSpPr><p:nvPr>${phXml(el.ph)}</p:nvPr></p:nvSpPr>${spPr({ ...el, geom: el.geom ?? (hasGeomNeeded ? { prst: 'rect' } : undefined) }, w)}${styleXml(el.style)}${txBodyXml(el.text ?? (el.ph || el.isTextBox ? undefined : undefined), w)}</p:sp>`;
}

function cxnXml(el: ConnEl, w: PartWriter): string {
  const st = el.start ? `<a:stCxn id="${el.start.id}" idx="${el.start.idx}"/>` : '';
  const en = el.end ? `<a:endCxn id="${el.end.id}" idx="${el.end.idx}"/>` : '';
  return `<p:cxnSp><p:nvCxnSpPr>${cNvPr(el, w)}<p:cNvCxnSpPr>${st}${en}</p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr>${spPr(el, w)}${styleXml(el.style)}</p:cxnSp>`;
}

function picAdjust(el: PicEl): string {
  const a = el.adjust;
  if (!a) return '';
  let s = '';
  if (a.bright !== undefined || a.contrast !== undefined) s += `<a:lum bright="${Math.round((a.bright ?? 0) * 1000)}" contrast="${Math.round((a.contrast ?? 0) * 1000)}"/>`;
  if (a.alpha !== undefined && a.alpha < 100) s += `<a:alphaModFix amt="${Math.round(a.alpha * 1000)}"/>`;
  if (a.gray) s += '<a:grayscl/>';
  if (a.biLevel !== undefined) s += `<a:biLevel thresh="${Math.round(a.biLevel * 1000)}"/>`;
  if (a.duotone) s += `<a:duotone>${clrXml(a.duotone[0])}${clrXml(a.duotone[1])}</a:duotone>`;
  return s;
}

function picXml(el: PicEl, w: PartWriter): string {
  const rid = w.image(el.src);
  const sr = el.srcRect ? `<a:srcRect l="${Math.round(el.srcRect.l)}" t="${Math.round(el.srcRect.t)}" r="${Math.round(el.srcRect.r)}" b="${Math.round(el.srcRect.b)}"/>` : '';
  return `<p:pic><p:nvPicPr>${cNvPr(el, w)}<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr>${phXml(el.ph)}</p:nvPr></p:nvPicPr><p:blipFill><a:blip${rid ? ` r:embed="${rid}"` : ''}>${picAdjust(el)}</a:blip>${sr}<a:stretch><a:fillRect/></a:stretch></p:blipFill>${spPr({ ...el, geom: el.geom ?? { prst: 'rect' } }, w)}</p:pic>`;
}

const PNG_1x1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

function mediaXml(el: MediaEl, w: PartWriter): string {
  let poster = el.poster ? w.image(el.poster) : undefined;
  if (!poster) {
    const p = w.addPart(w.freshPath('ppt/media', 'poster', 'png'), PNG_1x1, 'image/png');
    poster = w.rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', `../media/${p.split('/').pop()}`);
  }
  let nv = '';
  if (el.linkUrl) {
    const rid = w.rel(`http://schemas.openxmlformats.org/officeDocument/2006/relationships/${el.media}`, el.linkUrl, true);
    nv = `<a:${el.media}File r:link="${rid}"/>`;
  } else {
    const m = w.media(el.src);
    if (m) {
      const target = `../media/${m.path.split('/').pop()}`;
      const link = w.rel(`http://schemas.openxmlformats.org/officeDocument/2006/relationships/${el.media}`, target);
      const embed = w.rel('http://schemas.microsoft.com/office/2007/relationships/media', target);
      nv = `<a:${el.media}File r:link="${link}"/><p:extLst><p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}"><p14:media xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" r:embed="${embed}"/></p:ext></p:extLst>`;
    }
  }
  return `<p:pic><p:nvPicPr>${cNvPr(el, w)}<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr>${nv}</p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="${poster}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrmXml(el.xfrm)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

function oleXml(el: OleEl, w: PartWriter): string {
  // the embedded object itself is not kept: the picture it showed stays as a picture
  const pic: PicEl = { kind: 'pic', id: el.id, name: el.name, xfrm: el.xfrm, src: el.poster ?? '' };
  return picXml(pic, w);
}

function groupXml(el: GroupEl, w: PartWriter): string {
  if (el.rawDiagram && Object.keys(el.rawDiagram).length) return smartArtXml(el, w);
  const x = el.xfrm ?? { x: 0, y: 0, w: el.chExt.w, h: el.chExt.h };
  const base = xfrmXml(x, 'a:xfrm').replace('</a:xfrm>', `<a:chOff x="${Math.round(el.chOff.x * EMU)}" y="${Math.round(el.chOff.y * EMU)}"/><a:chExt cx="${Math.round(el.chExt.w * EMU)}" cy="${Math.round(el.chExt.h * EMU)}"/></a:xfrm>`);
  const fx = `${fillXml(el.fill, w)}${effectsXml(el.effects)}`;
  return `<p:grpSp><p:nvGrpSpPr>${cNvPr(el, w)}<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>${base}${fx}</p:grpSpPr>${el.children.map((c) => elementXml(c, w)).join('')}</p:grpSp>`;
}

function smartArtXml(el: GroupEl, w: PartWriter): string {
  const raw = el.rawDiagram!;
  const types: Record<string, string> = JSON.parse(new TextDecoder().decode(raw['__types'] ?? new TextEncoder().encode('{}')));
  const parts: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(raw)) if (k !== '__types') parts[k] = v;
  const map = w.copyRaw(parts);
  const ids: Record<string, string> = {};
  const slots: [string, RegExp][] = [['dm', /diagramData$/], ['lo', /diagramLayout$/], ['qs', /diagramQuickStyle$/], ['cs', /diagramColors$/]];
  let drawing: { old: string; rid: string } | undefined;
  for (const [oldPath, newPath] of map) {
    const type = types[oldPath] ?? '';
    const target = newPath.replace(/^ppt\//, '../');
    const rid = w.rel(type || 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData', target);
    for (const [slot, re] of slots) if (re.test(type)) ids[slot] = rid;
    if (/diagramDrawing$/.test(type)) drawing = { old: oldPath, rid };
  }
  if (drawing) {
    const rid = drawing.rid;
    const newData = [...map.entries()].find(([o]) => /diagramData$/.test(types[o] ?? ''))?.[1];
    if (newData) w.patchPart(newData, (t) => t.replace(/(relId=")[^"]*(")/, `$1${rid}$2`));
  }
  const x = xfrmXml(el.xfrm, 'p:xfrm');
  return `<p:graphicFrame><p:nvGraphicFramePr>${cNvPr(el, w)}<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>${x}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="${ids.dm ?? ''}" r:lo="${ids.lo ?? ''}" r:qs="${ids.qs ?? ''}" r:cs="${ids.cs ?? ''}"/></a:graphicData></a:graphic></p:graphicFrame>`;
}

// ---- tables

function cellXml(c: TableCell, w: PartWriter): string {
  const a = `${c.gridSpan ? attr('gridSpan', c.gridSpan) : ''}${c.rowSpan ? attr('rowSpan', c.rowSpan) : ''}${c.hMerge ? ' hMerge="1"' : ''}${c.vMerge ? ' vMerge="1"' : ''}`;
  const pr = `${c.lnL ? lnXml(c.lnL, w, 'a:lnL') : ''}${c.lnR ? lnXml(c.lnR, w, 'a:lnR') : ''}${c.lnT ? lnXml(c.lnT, w, 'a:lnT') : ''}${c.lnB ? lnXml(c.lnB, w, 'a:lnB') : ''}${fillXml(c.fill, w)}`;
  const pa = `${c.marL !== undefined ? attr('marL', Math.round(c.marL * EMU)) : ''}${c.marR !== undefined ? attr('marR', Math.round(c.marR * EMU)) : ''}${c.marT !== undefined ? attr('marT', Math.round(c.marT * EMU)) : ''}${c.marB !== undefined ? attr('marB', Math.round(c.marB * EMU)) : ''}${attr('anchor', c.anchor)}${attr('vert', c.vert)}`;
  const tx = c.text ? txBodyXml(c.text, w, 'a:txBody') : '<a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="es-ES"/></a:p></a:txBody>';
  return `<a:tc${a}>${tx}<a:tcPr${pa}>${pr}</a:tcPr></a:tc>`;
}

function tableXml(el: TableEl, w: PartWriter): string {
  const guid = w.tableStyleGuid(el.styleId);
  const flags = `${el.firstRow ? ' firstRow="1"' : ''}${el.firstCol ? ' firstCol="1"' : ''}${el.lastRow ? ' lastRow="1"' : ''}${el.lastCol ? ' lastCol="1"' : ''}${el.bandRow ? ' bandRow="1"' : ''}${el.bandCol ? ' bandCol="1"' : ''}`;
  const rows = el.rows.map((r) => `<a:tr h="${Math.round(r.h * EMU)}">${r.cells.map((c) => cellXml(c, w)).join('')}</a:tr>`).join('');
  return `<p:graphicFrame><p:nvGraphicFramePr>${cNvPr(el, w)}<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>${xfrmXml(el.xfrm, 'p:xfrm')}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr${flags}>${guid ? `<a:tableStyleId>${guid}</a:tableStyleId>` : ''}</a:tblPr><a:tblGrid>${el.cols.map((c) => `<a:gridCol w="${Math.round(c * EMU)}"/>`).join('')}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

// ---- charts

function chartFrameXml(el: ChartEl, w: PartWriter): string {
  let path: string;
  if (el.raw && Object.keys(el.raw).length) {
    const map = w.copyRaw(el.raw);
    const main = [...map.keys()].find((k) => /charts\/chart\d*\.xml$/.test(k)) ?? [...map.keys()][0]!;
    path = map.get(main)!;
  } else {
    path = w.addPart(w.freshPath('ppt/charts', 'chart', 'xml'), chartXml(el.chart), 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml');
  }
  const rid = w.rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart', `../charts/${path.split('/').pop()}`);
  return `<p:graphicFrame><p:nvGraphicFramePr>${cNvPr(el, w)}<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>${xfrmXml(el.xfrm, 'p:xfrm')}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`;
}

export function elementXml(el: SlideElement, w: PartWriter): string {
  switch (el.kind) {
    case 'shape':
      return shapeXml(el, w);
    case 'cxn':
      return cxnXml(el, w);
    case 'pic':
      return picXml(el, w);
    case 'group':
      return groupXml(el, w);
    case 'table':
      return tableXml(el, w);
    case 'chart':
      return chartFrameXml(el, w);
    case 'media':
      return mediaXml(el, w);
    case 'ole':
      return oleXml(el, w);
  }
}

export const spTreeHeader = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
export { NS_A };
export type { TableStyleDef };
