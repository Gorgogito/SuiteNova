import { attrOf, findKid, findKids, kidsOf, parseXml, rootOf, tagOf, type XNode } from '@suitenova/writer-core';
import { newId } from '../defaults';
import type { ChartEl, ConnEl, GroupEl, MediaEl, OleEl, PicEl, Placeholder, ShapeEl, SlideElement, StyleRef, TableCell, TableEl, Xfrm } from '../types';
import { readChartXml } from './chartxml';
import { EMU, boolAttr, numAttr, readClr, readEffects, readFill, readGeometry, readHyperlink, readLn, readTextBody, readXfrm, type DmlCtx } from './dml';

export interface ElementCtx extends DmlCtx {
  /** text of a package part (for charts and SmartArt) */
  part(path: string): string | null;
  bytes(path: string): Uint8Array | null;
  /** relationships of the part being read, as a map */
  rels(): Map<string, { type: string; target: string; external: boolean }>;
  /** resolves a target relative to the part being read */
  resolve(target: string): string;
  /** reads the relationships of another part; returns a context bound to it */
  forPart(path: string): ElementCtx;
  path: string;
  /** registers a package part as an asset and returns its id */
  asset(path: string): string | undefined;
}

const nv = (n: XNode, group: string): XNode | undefined => findKid(n, group);

function commonOf(n: XNode, nvTag: string, cNv: string, ctx: ElementCtx) {
  const g = nv(n, nvTag);
  const c = findKid(g, cNv);
  const srcId = numAttr(c, 'id');
  return {
    id: newId(),
    ...(srcId !== undefined ? { srcId } : {}),
    ...(attrOf(c ?? {}, 'name') ? { name: attrOf(c!, 'name') } : {}),
    ...(attrOf(c ?? {}, 'descr') ? { descr: attrOf(c!, 'descr') } : {}),
    ...(attrOf(c ?? {}, 'title') ? { title: attrOf(c!, 'title') } : {}),
    ...(attrOf(c ?? {}, 'hidden') === '1' ? { hidden: true } : {}),
    ...(readHyperlink(findKid(c, 'hlinkClick'), ctx) ? { hlink: readHyperlink(findKid(c, 'hlinkClick'), ctx) } : {}),
  };
}

function readPh(nvPr: XNode | undefined): Placeholder | undefined {
  const ph = findKid(nvPr, 'ph');
  if (!ph) return undefined;
  const out: Placeholder = { type: (attrOf(ph, 'type') ?? 'obj') as Placeholder['type'] };
  const idx = numAttr(ph, 'idx');
  if (idx !== undefined) out.idx = idx;
  const sz = attrOf(ph, 'sz');
  if (sz) out.sz = sz as Placeholder['sz'];
  const or = attrOf(ph, 'orient');
  if (or) out.orient = or as Placeholder['orient'];
  if (boolAttr(ph, 'hasCustomPrompt')) out.hasCustomPrompt = true;
  return out;
}

function readStyle(n: XNode | undefined): StyleRef | undefined {
  if (!n) return undefined;
  const s: StyleRef = {};
  const ref = (k: string) => {
    const r = findKid(n, k);
    return r ? { idx: numAttr(r, 'idx') ?? 0, c: readClr(r) } : undefined;
  };
  const ln = ref('lnRef');
  if (ln) s.ln = ln;
  const fill = ref('fillRef');
  if (fill) s.fill = fill;
  const ef = ref('effectRef');
  if (ef) s.effect = ef;
  const f = findKid(n, 'fontRef');
  if (f) s.font = { idx: (attrOf(f, 'idx') ?? 'minor') as 'major' | 'minor' | 'none', c: readClr(f) };
  return s;
}

function geomAndLook(spPr: XNode | undefined, ctx: ElementCtx) {
  const out: { xfrm?: Xfrm; geom?: ShapeEl['geom']; fill?: ShapeEl['fill']; ln?: ShapeEl['ln']; effects?: ShapeEl['effects']; has3d?: boolean } = {};
  if (!spPr) return out;
  const x = readXfrm(findKid(spPr, 'xfrm'));
  if (x) out.xfrm = x;
  const g = readGeometry(spPr);
  if (g) out.geom = g;
  const f = readFill(spPr, ctx);
  if (f) out.fill = f;
  const ln = readLn(findKid(spPr, 'ln'), ctx);
  if (ln) out.ln = ln;
  const ef = readEffects(findKid(spPr, 'effectLst'));
  if (ef) out.effects = ef;
  if (findKid(spPr, 'scene3d') || findKid(spPr, 'sp3d')) out.has3d = true;
  return out;
}

// ------------------------------------------------------------------------------------------------ shapes

function readSp(n: XNode, ctx: ElementCtx): ShapeEl {
  const nvPr = findKid(findKid(n, 'nvSpPr'), 'nvPr');
  const cNvSpPr = findKid(findKid(n, 'nvSpPr'), 'cNvSpPr');
  const el: ShapeEl = { kind: 'shape', ...commonOf(n, 'nvSpPr', 'cNvPr', ctx), ...geomAndLook(findKid(n, 'spPr'), ctx) };
  const ph = readPh(nvPr);
  if (ph) el.ph = ph;
  if (boolAttr(cNvSpPr, 'txBox')) el.isTextBox = true;
  const style = readStyle(findKid(n, 'style'));
  if (style) el.style = style;
  const text = readTextBody(findKid(n, 'txBody'), ctx);
  if (text) el.text = text;
  const fr = findKid(n, 'style');
  void fr;
  return el;
}

function mediaRel(ctx: ElementCtx, nvPr: XNode | undefined): { path: string; kind: 'video' | 'audio' } | undefined {
  const v = findKid(nvPr, 'videoFile');
  const a = findKid(nvPr, 'audioFile');
  const rid = attrOf((v ?? a) ?? {}, 'link');
  if (!rid) return undefined;
  const rel = ctx.rels().get(rid);
  if (!rel) return undefined;
  // the p14:media extension names the embedded part
  const ext = findKid(nvPr, 'extLst');
  let embedded: string | undefined;
  for (const e of findKids(ext, 'ext')) {
    const m = findKid(e, 'media');
    const emb = m ? attrOf(m, 'embed') : undefined;
    if (emb) embedded = ctx.rels().get(emb)?.target;
  }
  const target = embedded ?? rel.target;
  return { path: rel.external && !embedded ? target : ctx.resolve(target), kind: v ? 'video' : 'audio' };
}

const MEDIA_MIME: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', wmv: 'video/x-ms-wmv', avi: 'video/x-msvideo', mpg: 'video/mpeg', mpeg: 'video/mpeg', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', wma: 'audio/x-ms-wma', ogg: 'audio/ogg', mid: 'audio/midi' };

function readPic(n: XNode, ctx: ElementCtx): PicEl | MediaEl {
  const nvPr = findKid(findKid(n, 'nvPicPr'), 'nvPr');
  const common = commonOf(n, 'nvPicPr', 'cNvPr', ctx);
  const bf = findKid(n, 'blipFill');
  const blip = findKid(bf, 'blip');
  const src = ctx.blip(blip ? attrOf(blip, 'embed') : undefined) ?? '';
  const look = geomAndLook(findKid(n, 'spPr'), ctx);
  const media = mediaRel(ctx, nvPr);
  if (media) {
    const ext = media.path.split('.').pop()?.toLowerCase() ?? '';
    const external = !ctx.bytes(media.path);
    const m: MediaEl = { kind: 'media', ...common, ...(look.xfrm ? { xfrm: look.xfrm } : {}), media: media.kind, src: '', mime: MEDIA_MIME[ext] };
    if (src) m.poster = src;
    if (external) m.linkUrl = media.path;
    else m.src = ctx.asset(media.path) ?? '';
    return m;
  }
  const pic: PicEl = { kind: 'pic', ...common, src, ...look };
  const sr = findKid(bf, 'srcRect');
  if (sr) pic.srcRect = { l: numAttr(sr, 'l') ?? 0, t: numAttr(sr, 't') ?? 0, r: numAttr(sr, 'r') ?? 0, b: numAttr(sr, 'b') ?? 0 };
  const ph = readPh(nvPr);
  if (ph) pic.ph = ph;
  if (blip) {
    const adj: NonNullable<PicEl['adjust']> = {};
    const lum = findKid(blip, 'lum');
    if (lum) {
      adj.bright = (numAttr(lum, 'bright') ?? 0) / 1000;
      adj.contrast = (numAttr(lum, 'contrast') ?? 0) / 1000;
    }
    const am = findKid(blip, 'alphaModFix');
    if (am) adj.alpha = (numAttr(am, 'amt') ?? 100000) / 1000;
    if (findKid(blip, 'grayscl')) adj.gray = true;
    const bl = findKid(blip, 'biLevel');
    if (bl) adj.biLevel = (numAttr(bl, 'thresh') ?? 50000) / 1000;
    const duo = findKid(blip, 'duotone');
    if (duo) {
      const cs = kidsOf(duo).filter((k) => /Clr$/.test(tagOf(k)));
      if (cs.length === 2) adj.duotone = [readClr({ x: [cs[0]!] } as unknown as XNode)!, readClr({ x: [cs[1]!] } as unknown as XNode)!];
    }
    if (Object.keys(adj).length) pic.adjust = adj;
  }
  return pic;
}

function readCxn(n: XNode, ctx: ElementCtx): ConnEl {
  const c = findKid(findKid(n, 'nvCxnSpPr'), 'cNvCxnSpPr');
  const st = findKid(c, 'stCxn');
  const en = findKid(c, 'endCxn');
  const look = geomAndLook(findKid(n, 'spPr'), ctx);
  const el: ConnEl = { kind: 'cxn', ...commonOf(n, 'nvCxnSpPr', 'cNvPr', ctx), geom: look.geom ?? { prst: 'line' }, ...(look.xfrm ? { xfrm: look.xfrm } : {}), ...(look.ln ? { ln: look.ln } : {}), ...(look.effects ? { effects: look.effects } : {}) };
  const style = readStyle(findKid(n, 'style'));
  if (style) el.style = style;
  if (st) el.start = { id: numAttr(st, 'id') ?? 0, idx: numAttr(st, 'idx') ?? 0 };
  if (en) el.end = { id: numAttr(en, 'id') ?? 0, idx: numAttr(en, 'idx') ?? 0 };
  return el;
}

function readGrp(n: XNode, ctx: ElementCtx): GroupEl {
  const spPr = findKid(n, 'grpSpPr');
  const xf = findKid(spPr, 'xfrm');
  const off = findKid(xf, 'off');
  const ext = findKid(xf, 'ext');
  const choff = findKid(xf, 'chOff');
  const chext = findKid(xf, 'chExt');
  const base = readXfrm(xf) ?? { x: 0, y: 0, w: 0, h: 0 };
  void off;
  void ext;
  const g: GroupEl = {
    kind: 'group',
    ...commonOf(n, 'nvGrpSpPr', 'cNvPr', ctx),
    xfrm: base,
    chOff: { x: (numAttr(choff, 'x') ?? 0) / EMU, y: (numAttr(choff, 'y') ?? 0) / EMU },
    chExt: { w: (numAttr(chext, 'cx') ?? 0) / EMU || base.w, h: (numAttr(chext, 'cy') ?? 0) / EMU || base.h },
    children: readTree(n, ctx),
  };
  const f = readFill(spPr, ctx);
  if (f) g.fill = f;
  const ef = readEffects(findKid(spPr, 'effectLst'));
  if (ef) g.effects = ef;
  return g;
}

// ------------------------------------------------------------------------------------------------ tables

function readTable(gf: XNode, tbl: XNode, ctx: ElementCtx): TableEl {
  const pr = findKid(tbl, 'tblPr');
  const xf = findKid(gf, 'xfrm');
  const t: TableEl = {
    kind: 'table',
    ...commonOf(gf, 'nvGraphicFramePr', 'cNvPr', ctx),
    ...(readXfrm(xf) ? { xfrm: readXfrm(xf) } : {}),
    cols: findKids(findKid(tbl, 'tblGrid'), 'gridCol').map((c) => (numAttr(c, 'w') ?? 0) / EMU),
    rows: [],
    firstRow: boolAttr(pr, 'firstRow'),
    firstCol: boolAttr(pr, 'firstCol'),
    lastRow: boolAttr(pr, 'lastRow'),
    lastCol: boolAttr(pr, 'lastCol'),
    bandRow: boolAttr(pr, 'bandRow'),
    bandCol: boolAttr(pr, 'bandCol'),
  };
  const sid = findKid(pr, 'tableStyleId');
  if (sid) t.styleId = (kidsOf(sid)[0]?.['#text'] as string | undefined)?.trim();
  for (const tr of findKids(tbl, 'tr')) {
    const cells: TableCell[] = [];
    for (const tc of findKids(tr, 'tc')) {
      const tcPr = findKid(tc, 'tcPr');
      const cell: TableCell = { text: readTextBody(findKid(tc, 'txBody'), ctx) ?? null };
      const gs = numAttr(tc, 'gridSpan');
      if (gs && gs > 1) cell.gridSpan = gs;
      const rs = numAttr(tc, 'rowSpan');
      if (rs && rs > 1) cell.rowSpan = rs;
      if (boolAttr(tc, 'hMerge')) cell.hMerge = true;
      if (boolAttr(tc, 'vMerge')) cell.vMerge = true;
      if (tcPr) {
        const f = readFill(tcPr, ctx);
        if (f) cell.fill = f;
        for (const [k, key] of [['lnL', 'lnL'], ['lnR', 'lnR'], ['lnT', 'lnT'], ['lnB', 'lnB']] as const) {
          const l = readLn(findKid(tcPr, k), ctx);
          if (l) cell[key] = l;
        }
        for (const [k, key] of [['marL', 'marL'], ['marR', 'marR'], ['marT', 'marT'], ['marB', 'marB']] as const) {
          const v = numAttr(tcPr, k);
          if (v !== undefined) cell[key] = v / EMU;
        }
        const a = attrOf(tcPr, 'anchor');
        if (a) cell.anchor = a as TableCell['anchor'];
        const vt = attrOf(tcPr, 'vert');
        if (vt && vt !== 'horz') cell.vert = vt;
      }
      cells.push(cell);
    }
    t.rows.push({ h: (numAttr(tr, 'h') ?? 0) / EMU, cells });
  }
  return t;
}

// ------------------------------------------------------------------------------------------------ graphic frames

function readSmartArtDrawing(gf: XNode, dgm: XNode, ctx: ElementCtx): GroupEl | undefined {
  const rels = ctx.rels();
  const dmId = attrOf(dgm, 'dm');
  const dmPath = dmId ? rels.get(dmId)?.target : undefined;
  if (!dmPath) return undefined;
  const dmFull = ctx.resolve(dmPath);
  const dmXml = ctx.part(dmFull);
  if (!dmXml) return undefined;
  // the pre-rendered drawing is named by an extension of the data model
  let drawingRel: string | undefined;
  const m = /<dsp:dataModelExt[^>]*relId="([^"]+)"/.exec(dmXml);
  if (m) drawingRel = m[1];
  let drawingPath: string | undefined;
  if (drawingRel) drawingPath = rels.get(drawingRel)?.target;
  if (!drawingPath) {
    for (const r of rels.values()) if (/diagramDrawing/.test(r.type)) drawingPath = r.target;
  }
  if (!drawingPath) return undefined;
  const full = ctx.resolve(drawingPath);
  const xml = ctx.part(full);
  if (!xml) return undefined;
  const sub = ctx.forPart(full);
  const root = rootOf(parseXml(xml), 'drawing');
  const tree = findKid(root, 'spTree');
  if (!tree) return undefined;
  const xf = readXfrm(findKid(gf, 'xfrm')) ?? { x: 0, y: 0, w: 100, h: 100 };
  const children: SlideElement[] = [];
  for (const sp of findKids(tree, 'sp')) {
    // drawing shapes carry their own text transform; the text box is the shape itself
    const s = readSp(sp, sub);
    const txx = findKid(sp, 'txXfrm');
    void txx;
    children.push(s);
  }
  const g: GroupEl = { kind: 'group', ...commonOf(gf, 'nvGraphicFramePr', 'cNvPr', ctx), xfrm: xf, chOff: { x: 0, y: 0 }, chExt: { w: xf.w, h: xf.h }, children, smartart: true };
  // keep the data model, layout, style and colours so the SmartArt can be written back untouched
  const raw: Record<string, Uint8Array> = {};
  const types: Record<string, string> = {};
  const fullType = (t: string) => (t === 'diagramDrawing' ? 'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing' : `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${t}`);
  for (const idAttr of ['dm', 'lo', 'qs', 'cs']) {
    const rid = attrOf(dgm, idAttr);
    const rel = rid ? rels.get(rid) : undefined;
    if (rel) {
      const p = ctx.resolve(rel.target);
      const b = ctx.bytes(p);
      if (b) {
        raw[p] = b;
        types[p] = fullType(rel.type);
      }
    }
  }
  const db = ctx.bytes(full);
  if (db) {
    raw[full] = db;
    types[full] = fullType('diagramDrawing');
  }
  raw['__types'] = new TextEncoder().encode(JSON.stringify(types));
  g.rawDiagram = raw;
  return g;
}

function readGraphicFrame(n: XNode, ctx: ElementCtx): SlideElement | undefined {
  const graphic = findKid(n, 'graphic');
  const data = findKid(graphic, 'graphicData');
  const uri = attrOf(data ?? {}, 'uri') ?? '';
  const common = commonOf(n, 'nvGraphicFramePr', 'cNvPr', ctx);
  const xfrm = readXfrm(findKid(n, 'xfrm'));
  if (/\/table$/.test(uri)) {
    const tbl = findKid(data, 'tbl');
    return tbl ? readTable(n, tbl, ctx) : undefined;
  }
  if (/\/chart$/.test(uri)) {
    const ch = findKid(data, 'chart');
    const rid = ch ? attrOf(ch, 'id') : undefined;
    const rel = rid ? ctx.rels().get(rid) : undefined;
    if (!rel) return undefined;
    const path = ctx.resolve(rel.target);
    const xml = ctx.part(path);
    if (!xml) return undefined;
    const model = readChartXml(xml);
    const el: ChartEl = { kind: 'chart', ...common, ...(xfrm ? { xfrm } : {}), chart: model.chart };
    // keep chart part, its rels and the embedded workbook untouched
    const raw: Record<string, Uint8Array> = {};
    const b = ctx.bytes(path);
    if (b) raw[path] = b;
    const sub = ctx.forPart(path);
    for (const r of sub.rels().values()) {
      if (r.external) continue;
      const p = sub.resolve(r.target);
      const bb = ctx.bytes(p);
      if (bb) raw[p] = bb;
    }
    const relsPath = path.replace(/([^/]+)$/, '_rels/$1.rels');
    const rb = ctx.bytes(relsPath);
    if (rb) raw[relsPath] = rb;
    el.raw = raw;
    return el;
  }
  if (/\/diagram$/.test(uri)) {
    const dgm = findKid(data, 'relIds');
    if (dgm) {
      const g = readSmartArtDrawing(n, dgm, ctx);
      if (g) return g;
    }
    ctx.warn('Un SmartArt no tiene dibujo guardado y no se pudo mostrar.');
    return undefined;
  }
  if (/\/ole$/.test(uri) || findKid(data, 'oleObj')) {
    const ole = findKid(data, 'oleObj');
    const el: OleEl = { kind: 'ole', ...common, ...(xfrm ? { xfrm } : {}), progId: ole ? attrOf(ole, 'progId') : undefined };
    const pic = findKid(ole, 'pic');
    if (pic) {
      const bf = findKid(pic, 'blipFill');
      const blip = findKid(bf, 'blip');
      const s = ctx.blip(blip ? attrOf(blip, 'embed') : undefined);
      if (s) el.poster = s;
    }
    ctx.warn('Un objeto incrustado (OLE) se muestra como imagen y no se puede editar.');
    return el;
  }
  ctx.warn(`Un objeto de tipo desconocido (${uri.split('/').pop() || 'gráfico'}) se omitió.`);
  return undefined;
}

// ------------------------------------------------------------------------------------------------ tree

const KNOWN_REQUIRES = new Set(['p14', 'a14', 'p15', 'p16', 'adec', 'cx', 'cx1', 'a16', 'ahyp']);

/** Reads the shapes under a shape tree (or group) node. */
export function readTree(tree: XNode, ctx: ElementCtx): SlideElement[] {
  const out: SlideElement[] = [];
  const handle = (n: XNode) => {
    const t = tagOf(n);
    try {
      if (t === 'sp') out.push(readSp(n, ctx));
      else if (t === 'pic') out.push(readPic(n, ctx));
      else if (t === 'cxnSp') out.push(readCxn(n, ctx));
      else if (t === 'grpSp') out.push(readGrp(n, ctx));
      else if (t === 'graphicFrame') {
        const g = readGraphicFrame(n, ctx);
        if (g) out.push(g);
      } else if (t === 'AlternateContent') {
        const fb = findKid(n, 'Fallback');
        const ch = findKid(n, 'Choice');
        const req = attrOf(ch ?? {}, 'Requires') ?? '';
        // prefer the fallback (plain old elements); the choice is used when there is no fallback
        const src = fb ?? (KNOWN_REQUIRES.has(req) ? ch : undefined);
        if (src) for (const k of kidsOf(src)) handle(k);
      } else if (t === 'contentPart') ctx.warn('Se omitió un objeto de tinta o de contenido externo.');
    } catch (e) {
      ctx.warn(`No se pudo leer un objeto (${t}): ${(e as Error).message}`);
    }
  };
  for (const k of kidsOf(tree)) handle(k);
  return out;
}
