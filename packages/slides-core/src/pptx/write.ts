import JSZip from 'jszip';
import { esc } from '@suitenova/writer-core';
import { DEFAULT_CLRMAP } from '../color';
import type { Background, ColorMap, Comment, Deck, Effects, Fill, Hyperlink, Layout, Ln, Master, Slide, SlideElement, TableStyleDef, TableStylePart, TextBody, Theme, Transition } from '../types';
import { bodyPrXml, clrXml, effectsXml, fillXml, listStyleXml, lnXml, txBodyXml, EMU, type WriteCtx } from './dmlw';
import { elementXml, spTreeHeader, type PartWriter } from './elementsw';
import { timingFor } from '../anim';
import { relsPathOf, resolvePath } from './read';

export interface WriteResult {
  data: Uint8Array;
  warnings: string[];
}

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"';
const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** A table style definition (`a:tblStyle`); the parts in the order the schema asks for. */
export function tableStyleXml(d: TableStyleDef, w: WriteCtx): string {
  const edge = { l: 'left', r: 'right', t: 'top', b: 'bottom', insideH: 'insideH', insideV: 'insideV' } as const;
  const part = (tag: string, p: TableStylePart | undefined): string => {
    if (!p) return '';
    const r = p.rPr;
    const tx = r ? `<a:tcTxStyle${r.b === true ? ' b="on"' : r.b === false ? ' b="off"' : ''}${r.i === true ? ' i="on"' : ''}><a:fontRef idx="minor"><a:prstClr val="black"/></a:fontRef>${r.color ? clrXml(r.color) : ''}</a:tcTxStyle>` : '';
    const bd = p.ln ? `<a:tcBdr>${(Object.keys(edge) as (keyof typeof edge)[]).map((k) => (p.ln![k] ? `<a:${edge[k]}>${lnXml(p.ln![k], w, 'a:ln')}</a:${edge[k]}>` : '')).join('')}</a:tcBdr>` : '';
    const fl = p.fill ? `<a:fill>${fillXml(p.fill, w)}</a:fill>` : '';
    return `<a:${tag}>${tx}<a:tcStyle>${bd}${fl}</a:tcStyle></a:${tag}>`;
  };
  const order = ['wholeTbl', 'band1H', 'band2H', 'band1V', 'band2V', 'lastCol', 'firstCol', 'lastRow', 'seCell', 'swCell', 'firstRow', 'neCell', 'nwCell'] as const;
  return `<a:tblStyle styleId="${esc(d.id)}" styleName="${esc(d.name)}">${order.map((k) => part(k, d[k])).join('')}</a:tblStyle>`;
}

const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/tiff': 'tiff', 'image/x-emf': 'emf', 'image/x-wmf': 'wmf', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/x-ms-wmv': 'wmv', 'video/webm': 'webm', 'video/x-msvideo': 'avi', 'video/mpeg': 'mpg', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/x-ms-wma': 'wma', 'audio/midi': 'mid' };
const EXT_MIME: Record<string, string> = Object.fromEntries(Object.entries(MIME_EXT).map(([m, e]) => [e, m]));
EXT_MIME.jpg = 'image/jpeg';

const TABLE_GUID: Record<string, string> = {
  accent1: '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}',
  accent2: '{21E4AEA4-8DFA-4A89-87EB-49C32662AFE0}',
  accent3: '{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}',
  accent4: '{00A15C55-8517-42AA-B614-E9B94910E393}',
  accent5: '{7DF18680-E054-41AD-8BC1-D1AEF772440D}',
  accent6: '{93296810-A885-4BE3-A3E7-6D5BEEA58F35}',
};

class Rels {
  private items: { id: string; type: string; target: string; external: boolean }[] = [];
  add(type: string, target: string, external = false): string {
    const hit = this.items.find((i) => i.type === type && i.target === target && i.external === external);
    if (hit) return hit.id;
    const id = `rId${this.items.length + 1}`;
    this.items.push({ id, type, target, external });
    return id;
  }
  get count(): number {
    return this.items.length;
  }
  xml(): string {
    return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${this.items.map((i) => `<Relationship Id="${i.id}" Type="${i.type}" Target="${esc(i.target)}"${i.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
  }
}

// ------------------------------------------------------------------------------------------------ theme

function themeXml(t: Theme, ctx: WriteCtx): string {
  const slot = (n: string, hex: string) => `<a:${n}><a:srgbClr val="${hex.replace('#', '').toUpperCase()}"/></a:${n}>`;
  const c = t.colors;
  const face = (k: 'major' | 'minor') => `<a:${k}Font><a:latin typeface="${esc(t.fonts[k].latin)}"/><a:ea typeface="${esc(t.fonts[k].ea ?? '')}"/><a:cs typeface="${esc(t.fonts[k].cs ?? '')}"/></a:${k}Font>`;
  const fills = t.fmt.fills.map((f) => fillXml(f, ctx)).join('');
  const bgs = t.fmt.bgFills.map((f) => fillXml(f, ctx)).join('');
  const lns = t.fmt.lns.map((l) => lnXml(l, ctx)).join('');
  const efs = t.fmt.effects.map((e) => `<a:effectStyle>${effectsXml(e) || '<a:effectLst/>'}</a:effectStyle>`).join('');
  return `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${esc(t.name)}"><a:themeElements><a:clrScheme name="${esc(t.name)}">${slot('dk1', c.dk1)}${slot('lt1', c.lt1)}${slot('dk2', c.dk2)}${slot('lt2', c.lt2)}${slot('accent1', c.accent1)}${slot('accent2', c.accent2)}${slot('accent3', c.accent3)}${slot('accent4', c.accent4)}${slot('accent5', c.accent5)}${slot('accent6', c.accent6)}${slot('hlink', c.hlink)}${slot('folHlink', c.folHlink)}</a:clrScheme><a:fontScheme name="${esc(t.name)}">${face('major')}${face('minor')}</a:fontScheme><a:fmtScheme name="${esc(t.name)}"><a:fillStyleLst>${fills}</a:fillStyleLst><a:lnStyleLst>${lns}</a:lnStyleLst><a:effectStyleLst>${efs}</a:effectStyleLst><a:bgFillStyleLst>${bgs}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

// ------------------------------------------------------------------------------------------------ the writer

export async function writePptx(deck: Deck, opts: { slideshow?: boolean; template?: boolean } = {}): Promise<WriteResult> {
  const zip = new JSZip();
  const warnings: string[] = [];
  const overrides: [string, string][] = [];
  const used = new Set<string>();
  const parts = new Map<string, Uint8Array | string>();
  const addPartRaw = (path: string, bytes: Uint8Array | string, ct?: string) => {
    parts.set(path, bytes);
    used.add(path);
    if (ct) overrides.push([path, ct]);
    return path;
  };
  const fresh = (dir: string, base: string, ext: string): string => {
    let n = 1;
    while (used.has(`${dir}/${base}${n}.${ext}`)) n++;
    used.add(`${dir}/${base}${n}.${ext}`);
    return `${dir}/${base}${n}.${ext}`;
  };

  // media (one part per asset)
  const mediaPath = new Map<string, { path: string; mime: string }>();
  const media = (id: string) => {
    const hit = mediaPath.get(id);
    if (hit) return hit;
    const a = deck.assets[id];
    if (!a) return undefined;
    const ext = MIME_EXT[a.mime] ?? (a.name?.split('.').pop()?.toLowerCase() || 'bin');
    const isMedia = /^(video|audio)\//.test(a.mime);
    const path = fresh('ppt/media', isMedia ? 'media' : 'image', ext);
    parts.set(path, a.data);
    const r = { path, mime: a.mime };
    mediaPath.set(id, r);
    return r;
  };

  const slidePaths = new Map<string, string>();
  deck.slides.forEach((s, i) => slidePaths.set(s.id, `ppt/slides/slide${i + 1}.xml`));
  const usedTableStyles = new Set<string>();

  /** Context of one part: its relationships and shape ids. */
  const makePart = (path: string): { w: PartWriter; rels: Rels } => {
    const rels = new Rels();
    const ids = new Map<string, number>();
    let next = 2;
    return {
      rels,
      w: {
        image: (assetId) => {
          const m = media(assetId);
          if (!m) return undefined;
          return rels.add(`${RT}/image`, relative(path, m.path));
        },
        link: (h: Hyperlink) => {
          if (h.url) return { rid: rels.add(`${RT}/hyperlink`, h.url, true) };
          if (h.slide) {
            const act = h.slide;
            if (act === 'next') return { rid: '', action: 'ppaction://hlinkshowjump?jump=nextslide' };
            if (act === 'prev') return { rid: '', action: 'ppaction://hlinkshowjump?jump=previousslide' };
            if (act === 'first') return { rid: '', action: 'ppaction://hlinkshowjump?jump=firstslide' };
            if (act === 'last') return { rid: '', action: 'ppaction://hlinkshowjump?jump=lastslide' };
            if (act === 'end') return { rid: '', action: 'ppaction://hlinkshowjump?jump=endshow' };
            const target = slidePaths.get(act);
            if (target) return { rid: rels.add(`${RT}/slide`, relative(path, target)), action: 'ppaction://hlinksldjump' };
          }
          return undefined;
        },
        shapeId: (el: SlideElement) => {
          const hit = ids.get(el.id);
          if (hit) return hit;
          let id = el.srcId;
          if (id === undefined || [...ids.values()].includes(id) || id < 2) id = next;
          next = Math.max(next, id + 1);
          ids.set(el.id, id);
          return id;
        },
        rel: (type, target, external) => rels.add(type, target, external),
        addPart: (p, bytes, ct) => addPartRaw(p, bytes, ct),
        freshPath: fresh,
        media,
        copyRaw: (raw) => copyRaw(raw),
        patchPart: (p, fn) => {
          const cur = parts.get(p);
          if (typeof cur === 'string') parts.set(p, fn(cur));
          else if (cur) parts.set(p, fn(new TextDecoder().decode(cur)));
        },
        slidePath: (id) => slidePaths.get(id),
        tableStyleGuid: (id) => {
          if (!id) return undefined;
          const m = /^medium2-(accent\d)$/.exec(id);
          const g = m ? TABLE_GUID[m[1]!] : id;
          if (g) usedTableStyles.add(g);
          return g;
        },
      },
    };
  };

  const rawNames = new Map<string, string>();
  const copyRaw = (raw: Record<string, Uint8Array>): Map<string, string> => {
    const map = new Map<string, string>();
    const bin: [string, Uint8Array][] = [];
    const relsFiles: [string, Uint8Array][] = [];
    for (const [p, b] of Object.entries(raw)) (p.endsWith('.rels') ? relsFiles : bin).push([p, b]);
    for (const [p] of bin) {
      const m = /^(.*)\/([^/]*?)(\d*)\.([^.]+)$/.exec(p);
      const np = m ? (used.has(p) ? fresh(m[1]!, m[2]!, m[4]!) : (used.add(p), p)) : (used.add(p), p);
      map.set(p, np);
      rawNames.set(p, np);
    }
    for (const [p, b] of bin) {
      const np = map.get(p)!;
      const ext = np.split('.').pop()?.toLowerCase() ?? '';
      const ct = /\.xml$/.test(np) ? contentTypeFor(np, raw[p]!) : undefined;
      parts.set(np, b);
      if (ct) overrides.push([np, ct]);
      else if (!defaultExt.has(ext)) defaultExt.set(ext, EXT_MIME[ext] ?? 'application/octet-stream');
    }
    for (const [rp, rb] of relsFiles) {
      const owner = rp.replace('_rels/', '').replace(/\.rels$/, '');
      const newOwner = map.get(owner);
      if (!newOwner) continue;
      let text = new TextDecoder().decode(rb);
      text = text.replace(/Target="([^"]+)"/g, (full, t: string) => {
        if (/^(https?:|mailto:)/.test(t)) return full;
        const abs = resolvePath(owner, t);
        const mapped = map.get(abs);
        if (!mapped) {
          // a target outside the group (a shared part): keep the path
          return `Target="${relative(newOwner, abs)}"`;
        }
        return `Target="${relative(newOwner, mapped)}"`;
      });
      parts.set(relsPathOf(newOwner), text);
    }
    return map;
  };
  const defaultExt = new Map<string, string>([['rels', 'application/vnd.openxmlformats-package.relationships+xml'], ['xml', 'application/xml']]);
  const contentTypeFor = (path: string, bytes: Uint8Array): string => {
    const head = new TextDecoder().decode(bytes.subarray(0, 400));
    if (/charts\/chart/.test(path)) return 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
    if (/charts\/style/.test(path)) return 'application/vnd.ms-office.chartstyle+xml';
    if (/charts\/colors/.test(path)) return 'application/vnd.ms-office.chartcolorstyle+xml';
    if (/diagrams\/data/.test(path)) return 'application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml';
    if (/diagrams\/layout/.test(path)) return 'application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml';
    if (/diagrams\/quickStyle/.test(path)) return 'application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml';
    if (/diagrams\/colors/.test(path)) return 'application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml';
    if (/diagrams\/drawing/.test(path)) return 'application/vnd.ms-office.drawingml.diagramDrawing+xml';
    void head;
    return 'application/xml';
  };

  // ---- themes, masters, layouts
  const presRels = new Rels();
  const themePath = new Map<string, string>();
  deck.themes.forEach((t, i) => themePath.set(t.id, `ppt/theme/theme${i + 1}.xml`));
  const layoutPath = new Map<string, string>();
  const masterPath = new Map<string, string>();
  let layoutCounter = 0;
  deck.masters.forEach((m, mi) => {
    masterPath.set(m.id, `ppt/slideMasters/slideMaster${mi + 1}.xml`);
    for (const lid of m.layoutIds) layoutPath.set(lid, `ppt/slideLayouts/slideLayout${++layoutCounter}.xml`);
  });
  for (const l of deck.layouts) if (!layoutPath.has(l.id)) layoutPath.set(l.id, `ppt/slideLayouts/slideLayout${++layoutCounter}.xml`);

  const themeCtx = makePart('ppt/theme/theme1.xml');
  for (const t of deck.themes) addPartRaw(themePath.get(t.id)!, themeXml(t, themeCtx.w), 'application/vnd.openxmlformats-officedocument.theme+xml');

  const bgXml = (b: Background | undefined, w: PartWriter): string => {
    if (!b) return '';
    if ('ref' in b) return `<p:bg><p:bgRef idx="${b.ref.idx}">${clrXml(b.ref.c ?? { scheme: 'bg1' })}</p:bgRef></p:bg>`;
    return `<p:bg><p:bgPr>${fillXml(b.fill, w) || '<a:noFill/>'}<a:effectLst/></p:bgPr></p:bg>`;
  };
  const clrMapXml = (m: ColorMap): string => `<p:clrMap ${(Object.keys(DEFAULT_CLRMAP) as (keyof ColorMap)[]).map((k) => `${k}="${m[k]}"`).join(' ')}/>`;
  const trXml = (t: Transition | undefined): string => (t ? transitionXml(t) : '');
  const hfXml = (h: { sldNum?: boolean; hdr?: boolean; ftr?: boolean; dt?: boolean } | undefined): string => (h ? `<p:hf${h.sldNum === false ? ' sldNum="0"' : ''}${h.hdr === false ? ' hdr="0"' : ''}${h.ftr === false ? ' ftr="0"' : ''}${h.dt === false ? ' dt="0"' : ''}/>` : '');
  const treeXml = (shapes: SlideElement[], w: PartWriter) => `<p:spTree>${spTreeHeader}${shapes.map((s) => elementXml(s, w)).join('')}</p:spTree>`;

  const layoutIdBase = 2147483649;
  let layoutIdCounter = 0;
  deck.masters.forEach((m, mi) => {
    const path = masterPath.get(m.id)!;
    const { w, rels } = makePart(path);
    const lids = m.layoutIds.filter((id) => layoutPath.has(id));
    const layoutRels = lids.map((id) => rels.add(`${RT}/slideLayout`, relative(path, layoutPath.get(id)!)));
    const themeRel = rels.add(`${RT}/theme`, relative(path, themePath.get(m.themeId) ?? themePath.get(deck.themes[0]!.id)!));
    void themeRel;
    const tx = m.txStyles;
    const style = (k: 'titleStyle' | 'bodyStyle' | 'otherStyle', ls: typeof tx.title) => listStyleXml(ls, w, `p:${k}`).replace(/<a:(defPPr|lvl\dpPr)/g, '<a:$1');
    const xml = `${XML}<p:sldMaster ${NS}><p:cSld>${bgXml(m.bg, w)}${treeXml(m.shapes, w)}</p:cSld>${clrMapXml(m.clrMap)}<p:sldLayoutIdLst>${lids.map((_, i) => `<p:sldLayoutId id="${layoutIdBase + layoutIdCounter++}" r:id="${layoutRels[i]}"/>`).join('')}</p:sldLayoutIdLst>${hfXml(m.hf)}<p:txStyles>${style('titleStyle', tx.title)}${style('bodyStyle', tx.body)}${style('otherStyle', tx.other)}</p:txStyles></p:sldMaster>`;
    addPartRaw(path, xml, 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml');
    addPartRaw(relsPathOf(path), rels.xml());
    presRels.add(`${RT}/slideMaster`, relative('ppt/presentation.xml', path));
    void mi;
  });

  const layouts: Layout[] = deck.layouts;
  layouts.forEach((l) => {
    const path = layoutPath.get(l.id)!;
    const { w, rels } = makePart(path);
    const master = deck.masters.find((m) => m.id === l.masterId) ?? deck.masters[0]!;
    rels.add(`${RT}/slideMaster`, relative(path, masterPath.get(master.id)!));
    const ov = l.clrMapOvr && Object.keys(l.clrMapOvr).length ? `<p:clrMapOvr><a:overrideClrMapping ${(Object.keys(DEFAULT_CLRMAP) as (keyof ColorMap)[]).map((k) => `${k}="${(l.clrMapOvr as ColorMap)[k] ?? master.clrMap[k]}"`).join(' ')}/></p:clrMapOvr>` : '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>';
    const xml = `${XML}<p:sldLayout ${NS}${l.type ? ` type="${l.type}"` : ''}${l.showMasterSp === false ? ' showMasterSp="0"' : ''}${l.userDrawn ? ' userDrawn="1"' : ''}${l.matchingName ? ` matchingName="${esc(l.matchingName)}"` : ''} preserve="1"><p:cSld name="${esc(l.name)}">${bgXml(l.bg, w)}${treeXml(l.shapes, w)}</p:cSld>${ov}${trXml(l.transition)}${hfXml(l.hf)}</p:sldLayout>`;
    addPartRaw(path, xml, 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml');
    addPartRaw(relsPathOf(path), rels.xml());
  });

  // ---- notes master (needed when any slide has notes)
  const anyNotes = deck.slides.some((s) => s.notes);
  let notesMasterPath: string | undefined;
  if (anyNotes) {
    notesMasterPath = 'ppt/notesMasters/notesMaster1.xml';
    const { w, rels } = makePart(notesMasterPath);
    const nmTheme = `ppt/theme/theme${deck.themes.length + 1}.xml`;
    addPartRaw(nmTheme, themeXml(deck.themes[0]!, themeCtx.w), 'application/vnd.openxmlformats-officedocument.theme+xml');
    rels.add(`${RT}/theme`, relative(notesMasterPath, nmTheme));
    const nm = deck.notesMaster;
    const shapes = nm?.shapes?.length
      ? treeXml(nm.shapes, w)
      : `<p:spTree>${spTreeHeader}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Marcador de imagen de diapositiva 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Marcador de notas 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="es-ES"/><a:t>Haga clic para modificar los estilos de texto del patrón</a:t></a:r></a:p></p:txBody></p:sp></p:spTree>`;
    const xml = `${XML}<p:notesMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${shapes}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>`;
    addPartRaw(notesMasterPath, xml, 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml');
    addPartRaw(relsPathOf(notesMasterPath), rels.xml());
    presRels.add(`${RT}/notesMaster`, relative('ppt/presentation.xml', notesMasterPath));
  }

  // ---- slides
  const authors = deck.commentAuthors;
  deck.slides.forEach((s, i) => {
    const path = slidePaths.get(s.id)!;
    const { w, rels } = makePart(path);
    rels.add(`${RT}/slideLayout`, relative(path, layoutPath.get(s.layoutId) ?? layoutPath.get(deck.layouts[0]!.id)!));
    const ov = s.clrMapOvr && Object.keys(s.clrMapOvr).length ? '' : '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>';
    const timing = timingFor(s);
    const xml = `${XML}<p:sld ${NS}${s.hidden ? ' show="0"' : ''}${s.showMasterSp === false ? ' showMasterSp="0"' : ''}><p:cSld>${bgXml(s.bg, w)}${treeXml(s.shapes, w)}</p:cSld>${ov}${trXml(s.transition)}${timing}</p:sld>`;
    addPartRaw(path, xml, 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml');
    if (s.notes && notesMasterPath) {
      const np = `ppt/notesSlides/notesSlide${i + 1}.xml`;
      const nctx = makePart(np);
      nctx.rels.add(`${RT}/notesMaster`, relative(np, notesMasterPath));
      nctx.rels.add(`${RT}/slide`, relative(np, path));
      const nx = `${XML}<p:notes ${NS}><p:cSld><p:spTree>${spTreeHeader}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Marcador de imagen de diapositiva 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Marcador de notas 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>${txBodyXml(s.notes as TextBody, nctx.w)}</p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
      addPartRaw(np, nx, 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml');
      addPartRaw(relsPathOf(np), nctx.rels.xml());
      rels.add(`${RT}/notesSlide`, relative(path, np));
    }
    if (s.comments?.length) {
      const cp = `ppt/comments/comment${i + 1}.xml`;
      const cx = `${XML}<p:cmLst ${NS}>${s.comments.map((c, k) => commentXml(c, k, authorIndex(authors, c))).join('')}</p:cmLst>`;
      addPartRaw(cp, cx, 'application/vnd.openxmlformats-officedocument.presentationml.comments+xml');
      rels.add(`${RT}/comments`, relative(path, cp));
    }
    addPartRaw(relsPathOf(path), rels.xml());
    presRels.add(`${RT}/slide`, relative('ppt/presentation.xml', path));
  });

  // comment authors
  const allAuthors = [...authors];
  for (const s of deck.slides) for (const c of s.comments ?? []) if (!allAuthors.some((a) => a.name === c.author)) allAuthors.push({ name: c.author, initials: c.initials ?? c.author.slice(0, 2).toUpperCase() });
  if (allAuthors.length && deck.slides.some((s) => s.comments?.length)) {
    addPartRaw('ppt/commentAuthors.xml', `${XML}<p:cmAuthorLst ${NS}>${allAuthors.map((a, i) => `<p:cmAuthor id="${i}" name="${esc(a.name)}" initials="${esc(a.initials)}" lastIdx="${deck.slides.reduce((n, s) => n + (s.comments?.length ?? 0), 0)}" clrIdx="${i % 8}"/>`).join('')}</p:cmAuthorLst>`, 'application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml');
    presRels.add(`${RT}/commentAuthors`, 'commentAuthors.xml');
  }

  // table styles, presProps, viewProps
  const defStyle = deck.defaultTableStyle ?? TABLE_GUID.accent1!;
  const styleDefs = (deck.tableStyles ?? []).filter((d) => usedTableStyles.has(d.id)).map((d) => tableStyleXml(d, makePart('ppt/tableStyles.xml').w)).join('');
  addPartRaw('ppt/tableStyles.xml', `${XML}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="${defStyle}">${styleDefs}</a:tblStyleLst>`, 'application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml');
  presRels.add(`${RT}/tableStyles`, 'tableStyles.xml');
  const show = deck.show;
  const custIdx = show.range && 'show' in show.range ? (show.customShows ?? []).findIndex((c) => c.name === (show.range as { show: string }).show) : -1;
  const showPr = `<p:showPr${show.loop ? ' loop="1"' : ''}${show.showNarration === false ? ' showNarration="0"' : ''}${show.showAnimation === false ? ' showAnimation="0"' : ''}${show.useTimings === false ? ' useTimings="0"' : ''}>${show.mode === 'kiosk' ? '<p:kiosk/>' : show.mode === 'browsed' ? '<p:browse/>' : '<p:present/>'}${show.range && 'from' in show.range ? `<p:sldRg st="${show.range.from}" end="${show.range.to}"/>` : custIdx >= 0 ? `<p:custShow id="${custIdx}"/>` : '<p:sldAll/>'}<p:penClr><a:prstClr val="red"/></p:penClr></p:showPr>`;
  addPartRaw('ppt/presProps.xml', `${XML}<p:presentationPr ${NS}>${showPr}</p:presentationPr>`, 'application/vnd.openxmlformats-officedocument.presentationml.presProps+xml');
  presRels.add(`${RT}/presProps`, 'presProps.xml');
  const guideXml = deck.guides?.length ? `<p:guideLst>${deck.guides.map((g) => `<p:guide${g.orient === 'h' ? ' orient="horz"' : ''} pos="${Math.round(g.pos * 8)}" userDrawn="1"/>`).join('')}</p:guideLst>` : '<p:guideLst/>';
  addPartRaw('ppt/viewProps.xml', `${XML}<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:slideViewPr><p:cSldViewPr><p:cViewPr varScale="1"><p:scale><a:sx n="100" d="100"/><a:sy n="100" d="100"/></p:scale><p:origin x="0" y="0"/></p:cViewPr>${guideXml}</p:cSldViewPr></p:slideViewPr><p:notesTextViewPr><p:cViewPr><p:scale><a:sx n="1" d="1"/><a:sy n="1" d="1"/></p:scale><p:origin x="0" y="0"/></p:cViewPr></p:notesTextViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`, 'application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml');
  presRels.add(`${RT}/viewProps`, 'viewProps.xml');
  presRels.add(`${RT}/theme`, relative('ppt/presentation.xml', themePath.get(deck.themes[0]!.id)!));

  // ---- presentation.xml
  const rmap = (presRels as unknown as { items: { id: string; type: string; target: string }[] }).items;
  const ridOf = (type: string, target: string) => rmap.find((r) => r.type === type && r.target === target)!.id;
  const masterIds = deck.masters.map((m, i) => `<p:sldMasterId id="${2147483648 + i * 100}" r:id="${ridOf(`${RT}/slideMaster`, relative('ppt/presentation.xml', masterPath.get(m.id)!))}"/>`).join('');
  // layout ids must differ from master ids: they were numbered from 2147483649 in order
  const slideIds = deck.slides.map((s, i) => `<p:sldId id="${256 + i}" r:id="${ridOf(`${RT}/slide`, relative('ppt/presentation.xml', slidePaths.get(s.id)!))}"/>`).join('');
  const sections = deck.sections.length
    ? `<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">${deck.sections.map((sec, i) => `<p14:section name="${esc(sec.name)}" id="{${guid(i)}}"><p14:sldIdLst>${sec.slideIds.map((id) => deck.slides.findIndex((s) => s.id === id)).filter((k) => k >= 0).map((k) => `<p14:sldId id="${256 + k}"/>`).join('')}</p14:sldIdLst></p14:section>`).join('')}</p14:sectionLst></p:ext></p:extLst>`
    : '';
  const notesMasterRef = notesMasterPath ? `<p:notesMasterIdLst><p:notesMasterId r:id="${ridOf(`${RT}/notesMaster`, relative('ppt/presentation.xml', notesMasterPath))}"/></p:notesMasterIdLst>` : '';
  const custShows = deck.show.customShows?.length
    ? `<p:custShowLst>${deck.show.customShows.map((c, i) => `<p:custShow name="${esc(c.name)}" id="${i}"><p:sldLst>${c.slideIds.filter((id) => slidePaths.has(id)).map((id) => `<p:sld r:id="${ridOf(`${RT}/slide`, relative('ppt/presentation.xml', slidePaths.get(id)!))}"/>`).join('')}</p:sldLst></p:custShow>`).join('')}</p:custShowLst>`
    : '';
  const dts = deck.defaultText ? listStyleXml(deck.defaultText, themeCtx.w, 'p:defaultTextStyle') : '';
  const presXml = `${XML}<p:presentation ${NS}${deck.firstSlideNum ? ` firstSlideNum="${deck.firstSlideNum}"` : ''} saveSubsetFonts="1"><p:sldMasterIdLst>${masterIds}</p:sldMasterIdLst>${notesMasterRef}<p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${Math.round(deck.size.w * EMU)}" cy="${Math.round(deck.size.h * EMU)}"${deck.size.type && deck.size.type !== 'custom' ? ` type="${deck.size.type}"` : ''}/><p:notesSz cx="6858000" cy="9144000"/>${custShows}${dts}${sections}</p:presentation>`;
  addPartRaw('ppt/presentation.xml', presXml, opts.slideshow ? 'application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml' : opts.template ? 'application/vnd.openxmlformats-officedocument.presentationml.template.main+xml' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml');
  addPartRaw('ppt/_rels/presentation.xml.rels', presRels.xml());

  // ---- docProps and package rels
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  addPartRaw('docProps/core.xml', `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(deck.props.title ?? '')}</dc:title><dc:creator>${esc(deck.props.author ?? '')}</dc:creator><cp:lastModifiedBy>${esc(deck.props.lastModifiedBy ?? 'Nova Slides')}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${deck.props.created ? new Date(deck.props.created).toISOString().replace(/\.\d+Z$/, 'Z') : now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`, 'application/vnd.openxmlformats-package.core-properties+xml');
  addPartRaw('docProps/app.xml', `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Nova Slides</Application><Slides>${deck.slides.length}</Slides></Properties>`, 'application/vnd.openxmlformats-officedocument.extended-properties+xml');
  addPartRaw('_rels/.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RT}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${RT}/extended-properties" Target="docProps/app.xml"/></Relationships>`);

  // content types
  for (const m of mediaPath.values()) {
    const ext = m.path.split('.').pop()!.toLowerCase();
    if (!defaultExt.has(ext)) defaultExt.set(ext, m.mime);
  }
  const ct = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${[...defaultExt].map(([e, t]) => `<Default Extension="${e}" ContentType="${t}"/>`).join('')}${overrides.map(([p, t]) => `<Override PartName="/${p}" ContentType="${t}"/>`).join('')}</Types>`;
  zip.file('[Content_Types].xml', ct);
  for (const [p, b] of parts) zip.file(p, b);
  void usedTableStyles;
  const data = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { data, warnings };
}

// ------------------------------------------------------------------------------------------------ helpers

/** Relative reference from the part `from` to the part `to` (both package paths). */
export function relative(from: string, to: string): string {
  const a = from.split('/').slice(0, -1);
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

function guid(i: number): string {
  const h = (n: number) => n.toString(16).toUpperCase().padStart(8, '0');
  return `${h(0x5a1e0000 + i)}-0000-4000-8000-${h(0x00ab0000 + i)}0000`.slice(0, 36);
}

function authorIndex(authors: { name: string }[], c: Comment): number {
  const all = [...authors];
  const i = all.findIndex((a) => a.name === c.author);
  return i >= 0 ? i : all.length;
}

function commentXml(c: Comment, i: number, authorId: number): string {
  return `<p:cm authorId="${authorId}" dt="${new Date(c.at || Date.now()).toISOString().replace('Z', '')}" idx="${i + 1}"><p:pos x="${Math.round((c.x / 72) * 576)}" y="${Math.round((c.y / 72) * 576)}"/><p:text>${esc(c.text)}</p:text></p:cm>`;
}

const P14_TRANSITIONS = new Set(['vortex', 'switch', 'flip', 'ripple', 'honeycomb', 'prism', 'doors', 'window', 'ferris', 'gallery', 'conveyor', 'pan', 'glitter', 'warp', 'flythrough', 'flash', 'shred', 'reveal', 'wheelReverse']);

export function transitionXml(t: Transition): string {
  if (t.rawXml) return t.rawXml;
  if (t.type === 'none') return '';
  const a = `${t.spd ? ` spd="${t.spd}"` : ''}${t.advClick === false ? ' advClick="0"' : ''}${t.advTm !== undefined ? ` advTm="${t.advTm}"` : ''}`;
  const el = `<p:${t.type}${t.dir ? ` dir="${t.dir}"` : ''}${t.orient ? ` orient="${t.orient}"` : ''}${t.spokes ? ` spokes="${t.spokes}"` : ''}${t.thruBlk ? ' thruBlk="1"' : ''}${t.pattern ? ` pattern="${t.pattern}"` : ''}/>`;
  if (P14_TRANSITIONS.has(t.type)) {
    const e14 = el.replace('<p:', '<p14:');
    return `<mc:AlternateContent><mc:Choice Requires="p14"><p:transition${a}${t.dur ? ` p14:dur="${t.dur}"` : ''}>${e14}</p:transition></mc:Choice><mc:Fallback><p:transition${a}><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>`;
  }
  const dur = t.dur ? `<mc:AlternateContent><mc:Choice Requires="p14"><p:transition${a} p14:dur="${t.dur}">${el}</p:transition></mc:Choice><mc:Fallback><p:transition${a}>${el}</p:transition></mc:Fallback></mc:AlternateContent>` : `<p:transition${a}>${el}</p:transition>`;
  return dur;
}

export type { Effects, Fill, Ln, Master, Slide };
export { bodyPrXml };
