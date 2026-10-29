import JSZip from 'jszip';
import { attrOf, findKid, findKids, kidsOf, parseXml, rootOf, tagOf, textOfNode, type XNode } from '@suitenova/writer-core';
import { DEFAULT_CLRMAP } from '../color';
import { newDeck, newId, officeTheme } from '../defaults';
import { mapDoc } from '../text';
import type { AnimEffect, Asset, Background, ColorMap, Comment, Deck, Hyperlink, Layout, ListStyle, Master, RunProps, SchemeSlot, Section, Slide, SlideElement, TextBody, Theme, Timing, Transition } from '../types';
import { EMU, boolAttr, numAttr, readClr, readEffects, readFill, readListStyle, readTextBody, type DmlCtx } from './dml';
import { readTree, type ElementCtx } from './elements';
import { readTableStyles, readTheme } from './themexml';

export interface ReadResult {
  deck: Deck;
  warnings: string[];
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/x-emf', wmf: 'image/x-wmf', mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mov: 'video/quicktime', wmv: 'video/x-ms-wmv', avi: 'video/x-msvideo', webm: 'video/webm', ogg: 'audio/ogg', mpg: 'video/mpeg', mpeg: 'video/mpeg', wma: 'audio/x-ms-wma', m4v: 'video/mp4' };

interface Rel {
  type: string;
  target: string;
  external: boolean;
}

function relsOf(xml: string | null): Map<string, Rel> {
  const m = new Map<string, Rel>();
  if (!xml) return m;
  for (const r of findKids(rootOf(parseXml(xml), 'Relationships'), 'Relationship')) {
    const id = attrOf(r, 'Id');
    if (id) m.set(id, { type: (attrOf(r, 'Type') ?? '').split('/').pop() ?? '', target: attrOf(r, 'Target') ?? '', external: attrOf(r, 'TargetMode') === 'External' });
  }
  return m;
}

export function resolvePath(owner: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = owner.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}
export const relsPathOf = (part: string): string => part.replace(/([^/]+)$/, '_rels/$1.rels');

/** Attributes of every `<tag …>` occurrence (the prefixes are kept, which the shared parser drops). */
function tagAttrs(xml: string, tag: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const re = new RegExp(`<${tag}\\b([^>]*?)/?>`, 'g');
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const a: Record<string, string> = {};
    for (const x of m[1]!.matchAll(/([\w:]+)="([^"]*)"/g)) a[x[1]!] = x[2]!;
    out.push(a);
  }
  return out;
}

/** The text of an element (with its children) as it is in the source, or undefined. */
export function sliceElement(xml: string, tag: string): string | undefined {
  const start = xml.indexOf(`<${tag}`);
  if (start < 0) return undefined;
  const open = /^<[\w:]+\b[^>]*?(\/?)>/.exec(xml.slice(start));
  if (!open) return undefined;
  if (open[1] === '/') return xml.slice(start, start + open[0].length);
  const end = xml.indexOf(`</${tag}>`, start);
  return end < 0 ? undefined : xml.slice(start, end + tag.length + 3);
}

const hasAttr = (a: Record<string, string>, name: string) => name in a;

// ------------------------------------------------------------------------------------------------ the package reader

export async function readPptx(data: Uint8Array): Promise<ReadResult> {
  const zip = await JSZip.loadAsync(data);
  const names = new Map<string, string>();
  zip.forEach((p) => names.set(p.toLowerCase(), p));
  const textCache = new Map<string, string | null>();
  const bytesCache = new Map<string, Uint8Array | null>();
  const texts = new Map<string, string>();
  const bin = new Map<string, Uint8Array>();
  const load = async (path: string) => {
    const real = names.get(path.toLowerCase());
    if (!real || textCache.has(real)) return;
    const f = zip.file(real);
    if (!f) return;
    const b = await f.async('uint8array');
    bin.set(real, b);
    bytesCache.set(real, b);
    if (/\.(xml|rels)$/i.test(real)) texts.set(real, new TextDecoder('utf-8').decode(b));
    textCache.set(real, null);
  };
  // load everything once (the packages are small compared with the work of parsing them)
  const all: string[] = [];
  zip.forEach((p, f) => {
    if (!f.dir) all.push(p);
  });
  for (const p of all) await load(p);

  const warnings: string[] = [];
  const warn = (m: string) => {
    if (!warnings.includes(m)) warnings.push(m);
  };
  const getText = (path: string): string | null => texts.get(names.get(path.toLowerCase()) ?? path) ?? null;
  const getBytes = (path: string): Uint8Array | null => bin.get(names.get(path.toLowerCase()) ?? path) ?? null;

  const deck = newDeck();
  deck.slides = [];
  deck.themes = [];
  deck.masters = [];
  deck.layouts = [];
  deck.sections = [];

  const assetByPath = new Map<string, string>();
  const asset = (path: string): string | undefined => {
    const hit = assetByPath.get(path);
    if (hit) return hit;
    const b = getBytes(path);
    if (!b) return undefined;
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const id = newId('a');
    deck.assets[id] = { id, mime: MIME[ext] ?? 'application/octet-stream', data: b, name: path.split('/').pop() } as Asset;
    assetByPath.set(path, id);
    return id;
  };

  const makeCtx = (path: string): ElementCtx => {
    let rels: Map<string, Rel> | undefined;
    const get = () => (rels ??= relsOf(getText(relsPathOf(path))));
    const ctx: ElementCtx = {
      path,
      blip: (rid) => {
        if (!rid) return undefined;
        const r = get().get(rid);
        if (!r || r.external) return undefined;
        const p = resolvePath(path, r.target);
        if (/\.(emf|wmf)$/i.test(p)) warn('Una imagen EMF/WMF no se puede mostrar.');
        return asset(p);
      },
      link: (rid) => {
        if (!rid) return undefined;
        const r = get().get(rid);
        return r ? { target: r.external ? r.target : resolvePath(path, r.target), external: r.external, type: r.type } : undefined;
      },
      warn,
      part: (p) => getText(p),
      bytes: (p) => getBytes(p),
      rels: get,
      resolve: (t) => resolvePath(path, t),
      forPart: (p) => makeCtx(p),
      asset,
    } as ElementCtx;
    return ctx;
  };

  // ---- presentation
  const presPath = ((): string => {
    const r = relsOf(getText('_rels/.rels'));
    for (const v of r.values()) if (v.type === 'officeDocument') return resolvePath('', v.target);
    return 'ppt/presentation.xml';
  })();
  const presXml = getText(presPath);
  if (!presXml) throw new Error('No es una presentación de PowerPoint (falta ppt/presentation.xml).');
  const presRoot = rootOf(parseXml(presXml), 'presentation');
  const presRels = relsOf(getText(relsPathOf(presPath)));
  const presCtx = makeCtx(presPath);

  const sz = findKid(presRoot, 'sldSz');
  if (sz) deck.size = { w: (numAttr(sz, 'cx') ?? 12192000) / EMU, h: (numAttr(sz, 'cy') ?? 6858000) / EMU, type: attrOf(sz, 'type') };
  const fsn = attrOf(presRoot ?? {}, 'firstSlideNum');
  if (fsn) deck.firstSlideNum = Number(fsn);
  deck.defaultText = readListStyle(findKid(presRoot, 'defaultTextStyle'), presCtx) ?? deck.defaultText;

  // themes and masters
  const themeIds = new Map<string, string>();
  const readThemeAt = (path: string): string => {
    const hit = themeIds.get(path);
    if (hit) return hit;
    const xml = getText(path);
    const id = `theme-${themeIds.size + 1}`;
    themeIds.set(path, id);
    deck.themes.push(xml ? readTheme(xml, id, makeCtx(path)) : { ...officeTheme(), id });
    return id;
  };

  const masterRids = tagAttrs(presXml, 'p:sldMasterId').map((a) => a['r:id']!);
  const layoutIdByPath = new Map<string, string>();
  const slideIdByPath = new Map<string, string>();

  for (const rid of masterRids) {
    const rel = presRels.get(rid);
    if (!rel) continue;
    const mPath = resolvePath(presPath, rel.target);
    const mXml = getText(mPath);
    if (!mXml) continue;
    const mCtx = makeCtx(mPath);
    const root = rootOf(parseXml(mXml), 'sldMaster');
    const mRels = mCtx.rels();
    let themePath: string | undefined;
    for (const r of mRels.values()) if (r.type === 'theme') themePath = resolvePath(mPath, r.target);
    const themeId = themePath ? readThemeAt(themePath) : (deck.themes[0]?.id ?? readThemeAt('ppt/theme/theme1.xml'));
    const cm = findKid(root, 'clrMap');
    const clrMap = { ...DEFAULT_CLRMAP } as ColorMap;
    if (cm) for (const k of Object.keys(clrMap)) {
      const v = attrOf(cm, k);
      if (v) (clrMap as unknown as Record<string, string>)[k] = v;
    }
    const ts = findKid(root, 'txStyles');
    const master: Master = {
      id: newId('m'),
      name: attrOf(findKid(root, 'cSld') ?? {}, 'name') || `Patrón ${deck.masters.length + 1}`,
      themeId,
      bg: readBackground(findKid(root, 'cSld'), mCtx),
      shapes: readTree(findKid(findKid(root, 'cSld'), 'spTree') ?? { x: [] }, mCtx),
      txStyles: {
        title: readListStyle(findKid(ts, 'titleStyle'), mCtx) ?? {},
        body: readListStyle(findKid(ts, 'bodyStyle'), mCtx) ?? {},
        other: readListStyle(findKid(ts, 'otherStyle'), mCtx) ?? {},
      },
      clrMap,
      layoutIds: [],
      hf: readHf(findKid(root, 'hf')),
    };
    deck.masters.push(master);
    // layouts
    for (const a of tagAttrs(mXml, 'p:sldLayoutId')) {
      const lrel = mRels.get(a['r:id']!);
      if (!lrel) continue;
      const lPath = resolvePath(mPath, lrel.target);
      const lXml = getText(lPath);
      if (!lXml) continue;
      const lCtx = makeCtx(lPath);
      const lr = rootOf(parseXml(lXml), 'sldLayout');
      const layout: Layout = {
        id: newId('l'),
        name: attrOf(findKid(lr, 'cSld') ?? {}, 'name') || 'Diseño',
        type: attrOf(lr ?? {}, 'type'),
        masterId: master.id,
        bg: readBackground(findKid(lr, 'cSld'), lCtx),
        shapes: readTree(findKid(findKid(lr, 'cSld'), 'spTree') ?? { x: [] }, lCtx),
        showMasterSp: attrOf(lr ?? {}, 'showMasterSp') !== '0',
        matchingName: attrOf(lr ?? {}, 'matchingName'),
        userDrawn: boolAttr(lr, 'userDrawn'),
        hf: readHf(findKid(lr, 'hf')),
      };
      const ov = findKid(findKid(lr, 'clrMapOvr'), 'overrideClrMapping');
      if (ov) {
        const m: Partial<ColorMap> = {};
        for (const k of Object.keys(DEFAULT_CLRMAP)) {
          const v = attrOf(ov, k);
          if (v) (m as Record<string, string>)[k] = v;
        }
        layout.clrMapOvr = m;
      }
      const tr = readTransition(lXml, lCtx);
      if (tr) layout.transition = tr;
      deck.layouts.push(layout);
      master.layoutIds.push(layout.id);
      layoutIdByPath.set(lPath, layout.id);
    }
  }
  if (!deck.masters.length) {
    const fresh = newDeck();
    deck.themes = fresh.themes;
    deck.masters = fresh.masters;
    deck.layouts = fresh.layouts;
    warn('La presentación no tiene patrón de diapositivas; se usó el predeterminado.');
  }

  // table styles
  const tsPath = ((): string | undefined => {
    for (const r of presRels.values()) if (r.type === 'tableStyles') return resolvePath(presPath, r.target);
    return undefined;
  })();
  const tsXml = tsPath ? getText(tsPath) : null;
  if (tsXml) {
    const t = readTableStyles(tsXml);
    deck.tableStyles = t.styles;
    deck.defaultTableStyle = t.def;
  }

  // guides drawn by the user (view properties; positions in 1/8 pt from the top/left)
  const vpPath = ((): string | undefined => {
    for (const r of presRels.values()) if (r.type === 'viewProps') return resolvePath(presPath, r.target);
    return undefined;
  })();
  const vpXml = vpPath ? getText(vpPath) : null;
  if (vpXml) {
    const gs = [...vpXml.matchAll(/<p:guide\b([^>]*?)\/?>/g)].map((m, i) => ({ id: `g${i + 1}`, orient: /orient="horz"/.test(m[1]!) ? ("h" as const) : ("v" as const), pos: Number(/pos="(-?\d+)"/.exec(m[1]!)?.[1] ?? 0) / 8 }));
    if (gs.length) deck.guides = gs;
  }

  // ---- slides
  const sldIds = tagAttrs(presXml, 'p:sldId');
  const numToSlide = new Map<string, string>();
  const ridToSlide = new Map<string, string>();
  const commentAuthors = readAuthors(presRels, presPath, getText);
  deck.commentAuthors = commentAuthors.map((a) => ({ name: a.name, initials: a.initials }));
  for (const a of sldIds) {
    const rel = presRels.get(a['r:id']!);
    if (!rel) continue;
    const sPath = resolvePath(presPath, rel.target);
    const sXml = getText(sPath);
    if (!sXml) continue;
    const sCtx = makeCtx(sPath);
    const root = rootOf(parseXml(sXml), 'sld');
    const sRels = sCtx.rels();
    let layoutId = deck.layouts[0]!.id;
    for (const r of sRels.values()) if (r.type === 'slideLayout') layoutId = layoutIdByPath.get(resolvePath(sPath, r.target)) ?? layoutId;
    const cSld = findKid(root, 'cSld');
    const slide: Slide = { id: newId('s'), layoutId, shapes: readTree(findKid(cSld, 'spTree') ?? { x: [] }, sCtx) };
    const bg = readBackground(cSld, sCtx);
    if (bg) slide.bg = bg;
    if (attrOf(root ?? {}, 'show') === '0') slide.hidden = true;
    if (attrOf(root ?? {}, 'showMasterSp') === '0') slide.showMasterSp = false;
    const tr = readTransition(sXml, sCtx);
    if (tr) slide.transition = tr;
    const timing = readTiming(sXml, findKid(root, 'timing'));
    if (timing) slide.timing = timing;
    // notes and comments
    for (const r of sRels.values()) {
      if (r.type === 'notesSlide') {
        const nPath = resolvePath(sPath, r.target);
        const nXml = getText(nPath);
        if (nXml) slide.notes = readNotes(nXml, makeCtx(nPath));
      } else if (r.type === 'comments') {
        const cx = getText(resolvePath(sPath, r.target));
        if (cx) slide.comments = [...(slide.comments ?? []), ...readLegacyComments(cx, commentAuthors)];
      } else if (r.type === 'slideComments') {
        const cx = getText(resolvePath(sPath, r.target));
        if (cx) slide.comments = [...(slide.comments ?? []), ...readModernComments(cx, getText, presRels, presPath)];
      }
    }
    deck.slides.push(slide);
    slideIdByPath.set(sPath, slide.id);
    numToSlide.set(a['id']!, slide.id);
    ridToSlide.set(a['r:id']!, slide.id);
  }
  if (!deck.slides.length) deck.slides.push(newDeck().slides[0]!);

  // custom shows
  const cs = sliceElement(presXml, 'p:custShowLst');
  if (cs) {
    deck.show.customShows = [];
    for (const part of cs.split('<p:custShow ').slice(1)) {
      const name = /name="([^"]*)"/.exec(part)?.[1] ?? 'Presentación personalizada';
      const ids = [...part.matchAll(/<p:sld r:id="([^"]+)"/g)].map((m) => ridToSlide.get(m[1]!)).filter((x): x is string => !!x);
      deck.show.customShows.push({ name: name.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'), slideIds: ids });
    }
  }

  // sections (p14:sectionLst)
  const secXml = sliceElement(presXml, 'p14:sectionLst');
  if (secXml) {
    for (const part of secXml.split('<p14:section ').slice(1)) {
      const name = /name="([^"]*)"/.exec(part)?.[1] ?? 'Sección';
      const ids = [...part.matchAll(/<p14:sldId id="(\d+)"/g)].map((m) => numToSlide.get(m[1]!)).filter((x): x is string => !!x);
      const sec: Section = { id: newId('sec'), name: name.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'), slideIds: ids };
      deck.sections.push(sec);
    }
  }

  // slide-show settings and properties
  for (const r of presRels.values()) {
    if (r.type === 'presProps') readPresProps(getText(resolvePath(presPath, r.target)), deck);
  }
  const core = getText('docProps/core.xml');
  if (core) {
    deck.props.title = /<dc:title>([^<]*)<\/dc:title>/.exec(core)?.[1];
    deck.props.author = /<dc:creator>([^<]*)<\/dc:creator>/.exec(core)?.[1];
  }

  // resolve hyperlinks to slides (they pointed at part paths) and animation targets
  const linkTarget = (h: Hyperlink | undefined): Hyperlink | undefined => {
    if (!h?.slide?.startsWith('part:')) return h;
    const id = slideIdByPath.get(h.slide.slice(5));
    const { slide: _s, ...rest } = h;
    void _s;
    return id ? { ...rest, slide: id } : rest;
  };
  const fixEl = (el: SlideElement) => {
    if (el.hlink) el.hlink = linkTarget(el.hlink);
    const fixText = (t: TextBody | null | undefined) => {
      if (t) t.doc = mapDoc(t.doc, undefined, (r: RunProps) => (r.hlink ? { ...r, hlink: linkTarget(r.hlink) } : r));
    };
    if (el.kind === 'shape') fixText(el.text);
    else if (el.kind === 'group') el.children.forEach(fixEl);
    else if (el.kind === 'table') for (const row of el.rows) for (const c of row.cells) fixText(c.text);
  };
  for (const s of deck.slides) {
    s.shapes.forEach(fixEl);
    if (s.timing) mapTimingTargets(s);
  }
  for (const l of deck.layouts) l.shapes.forEach(fixEl);
  for (const m of deck.masters) m.shapes.forEach(fixEl);

  // media bytes referenced by path
  for (const s of deck.slides) attachMedia(s.shapes, asset, getBytes);
  return { deck, warnings };
}

function attachMedia(shapes: SlideElement[], asset: (p: string) => string | undefined, bytes: (p: string) => Uint8Array | null): void {
  for (const el of shapes) {
    if (el.kind === 'group') attachMedia(el.children, asset, bytes);
    else if (el.kind === 'media') {
      const p = (el as { _path?: string })._path;
      delete (el as { _path?: string })._path;
      if (p && !el.linkUrl && bytes(p)) el.src = asset(p) ?? '';
    }
  }
}

// ------------------------------------------------------------------------------------------------ pieces

function readHf(n: XNode | undefined): { sldNum?: boolean; hdr?: boolean; ftr?: boolean; dt?: boolean } | undefined {
  if (!n) return undefined;
  const f = (k: string) => attrOf(n, k) !== '0' && attrOf(n, k) !== 'false';
  return { sldNum: f('sldNum'), hdr: f('hdr'), ftr: f('ftr'), dt: f('dt') };
}

function readBackground(cSld: XNode | undefined, ctx: DmlCtx): Background | undefined {
  const bg = findKid(cSld, 'bg');
  if (!bg) return undefined;
  const pr = findKid(bg, 'bgPr');
  if (pr) {
    const f = readFill(pr, ctx);
    if (f) return { fill: f };
  }
  const ref = findKid(bg, 'bgRef');
  if (ref) return { ref: { idx: numAttr(ref, 'idx') ?? 1001, c: readClr(ref) } };
  return undefined;
}

function readNotes(xml: string, ctx: ElementCtx): TextBody | undefined {
  const root = rootOf(parseXml(xml), 'notes');
  const tree = findKid(findKid(root, 'cSld'), 'spTree');
  for (const sp of findKids(tree, 'sp')) {
    const ph = findKid(findKid(findKid(sp, 'nvSpPr'), 'nvPr'), 'ph');
    if (ph && attrOf(ph, 'type') === 'body') return readTextBody(findKid(sp, 'txBody'), ctx);
  }
  return undefined;
}

// ---- transitions

const TRANSITION_TYPES = ['fade', 'push', 'wipe', 'split', 'cut', 'random', 'circle', 'dissolve', 'checker', 'blinds', 'comb', 'cover', 'pull', 'randomBar', 'strips', 'wedge', 'wheel', 'zoom', 'diamond', 'newsflash', 'plus', 'vortex', 'switch', 'flip', 'ripple', 'honeycomb', 'prism', 'doors', 'window', 'ferris', 'gallery', 'conveyor', 'pan', 'glitter', 'warp', 'flythrough', 'flash', 'shred', 'reveal', 'wheelReverse'];

function readTransition(xml: string, ctx: ElementCtx): Transition | undefined {
  const alt = sliceElement(xml, 'mc:AlternateContent');
  const withTransition = alt && alt.includes('<p:transition') ? alt : undefined;
  const raw = withTransition ?? sliceElement(xml, 'p:transition');
  if (!raw) return undefined;
  // parse the plain transition (inside the fallback when there is an alternate content, else the element itself)
  const plain = withTransition ? (sliceElement(withTransition.slice(withTransition.indexOf('<mc:Fallback')), 'p:transition') ?? sliceElement(withTransition, 'p:transition')) : raw;
  const choice = withTransition ? sliceElement(withTransition, 'p:transition') : undefined;
  const src = choice ?? plain;
  if (!src) return undefined;
  const root = rootOf(parseXml(src), 'transition');
  if (!root) return undefined;
  let type = 'none';
  let node: XNode | undefined;
  for (const k of kidsOf(root)) {
    const t = tagOf(k);
    if (TRANSITION_TYPES.includes(t)) {
      type = t;
      node = k;
      break;
    }
  }
  const tr: Transition = { type, rawXml: raw };
  const a = tagAttrs(src, 'p:transition')[0] ?? {};
  if (hasAttr(a, 'spd')) tr.spd = a['spd'] as Transition['spd'];
  if (hasAttr(a, 'p14:dur')) tr.dur = Number(a['p14:dur']);
  if (hasAttr(a, 'advClick')) tr.advClick = a['advClick'] !== '0';
  else tr.advClick = true;
  if (hasAttr(a, 'advTm')) tr.advTm = Number(a['advTm']);
  if (node) {
    const dir = attrOf(node, 'dir');
    if (dir) tr.dir = dir;
    const or = attrOf(node, 'orient');
    if (or) tr.orient = or as 'horz' | 'vert';
    const sp = attrOf(node, 'spokes');
    if (sp) tr.spokes = Number(sp);
    const th = attrOf(node, 'thruBlk');
    if (th) tr.thruBlk = th === '1';
    const pat = attrOf(node, 'pattern');
    if (pat) tr.pattern = pat;
  }
  const snd = findKid(findKid(root, 'sndAc'), 'stSnd');
  if (snd) {
    const s = findKid(snd, 'snd');
    const rid = s ? attrOf(s, 'embed') : undefined;
    const id = ctx.blip(rid);
    if (id) tr.sound = { src: id, name: s ? attrOf(s, 'name') : undefined, loop: boolAttr(snd, 'loop') };
  } else if (findKid(findKid(root, 'sndAc'), 'endSnd')) tr.sound = { stop: true };
  return tr;
}

// ---- animations

const NODE_TRIGGER: Record<string, AnimEffect['trigger']> = { clickEffect: 'onClick', withEffect: 'withPrev', afterEffect: 'afterPrev' };

function readTiming(xml: string, node: XNode | undefined): Timing | undefined {
  if (!node) return undefined;
  const raw = sliceElement(xml, 'p:timing');
  const effects: AnimEffect[] = [];
  const walk = (n: XNode) => {
    if (tagOf(n) === 'cTn' && attrOf(n, 'presetClass') !== undefined) {
      const cls = attrOf(n, 'presetClass') as AnimEffect['cls'];
      const spTgt = findSp(n);
      const trigger = NODE_TRIGGER[attrOf(n, 'nodeType') ?? 'clickEffect'] ?? 'onClick';
      const e: AnimEffect = {
        id: newId('an'),
        target: spTgt?.spid ?? '',
        cls,
        preset: numAttr(n, 'presetID') ?? 0,
        trigger,
      };
      const st = numAttr(n, 'presetSubtype');
      if (st !== undefined) e.subtype = st;
      if (spTgt?.para) e.para = spTgt.para;
      const delay = numAttr(findKid(findKid(n, 'stCondLst'), 'cond'), 'delay');
      if (delay !== undefined && delay >= 0) e.delay = delay;
      const dur = findDur(n);
      if (dur !== undefined) e.dur = dur;
      effects.push(e);
      return;
    }
    for (const k of kidsOf(n)) walk(k);
  };
  walk(node);
  return { effects, rawXml: raw };
}

function findSp(n: XNode): { spid: string; para?: [number, number] } | undefined {
  if (tagOf(n) === 'spTgt') {
    const pr = findKid(findKid(n, 'txEl'), 'pRg');
    return { spid: attrOf(n, 'spid') ?? '', ...(pr ? { para: [numAttr(pr, 'st') ?? 0, numAttr(pr, 'end') ?? 0] as [number, number] } : {}) };
  }
  for (const k of kidsOf(n)) {
    const r = findSp(k);
    if (r) return r;
  }
  return undefined;
}
function findDur(n: XNode): number | undefined {
  for (const k of kidsOf(n)) {
    if (tagOf(k) === 'cBhvr') {
      const d = numAttr(findKid(k, 'cTn'), 'dur');
      if (d !== undefined && d !== 1) return d;
    }
    const r = findDur(k);
    if (r !== undefined) return r;
  }
  return undefined;
}
function mapTimingTargets(s: Slide): void {
  const bySrc = new Map<string, string>();
  const visit = (els: SlideElement[]) => {
    for (const e of els) {
      if (e.srcId !== undefined) bySrc.set(String(e.srcId), e.id);
      if (e.kind === 'group') visit(e.children);
    }
  };
  visit(s.shapes);
  for (const e of s.timing?.effects ?? []) e.target = bySrc.get(e.target) ?? e.target;
}

// ---- comments

interface Author {
  id: string;
  name: string;
  initials: string;
}
function readAuthors(rels: Map<string, Rel>, base: string, get: (p: string) => string | null): Author[] {
  const out: Author[] = [];
  for (const r of rels.values()) {
    if (r.type === 'commentAuthors') {
      const xml = get(resolvePath(base, r.target));
      if (xml) for (const a of findKids(rootOf(parseXml(xml), 'cmAuthorLst'), 'cmAuthor')) out.push({ id: attrOf(a, 'id') ?? '', name: attrOf(a, 'name') ?? '', initials: attrOf(a, 'initials') ?? '' });
    } else if (r.type === 'authors') {
      const xml = get(resolvePath(base, r.target));
      if (xml) for (const a of findKids(rootOf(parseXml(xml), 'authorLst'), 'author')) out.push({ id: attrOf(a, 'id') ?? '', name: attrOf(a, 'name') ?? '', initials: attrOf(a, 'initials') ?? '' });
    }
  }
  return out;
}
function readLegacyComments(xml: string, authors: Author[]): Comment[] {
  const out: Comment[] = [];
  for (const c of findKids(rootOf(parseXml(xml), 'cmLst'), 'cm')) {
    const a = authors.find((x) => x.id === attrOf(c, 'authorId'));
    const pos = findKid(c, 'pos');
    out.push({
      id: newId('c'),
      author: a?.name ?? 'Autor',
      initials: a?.initials,
      text: textOfNode(findKid(c, 'text') ?? { '#text': '' }),
      at: Date.parse(attrOf(c, 'dt') ?? '') || 0,
      // legacy comment positions are in 1/576 inch
      x: ((numAttr(pos, 'x') ?? 0) / 576) * 72,
      y: ((numAttr(pos, 'y') ?? 0) / 576) * 72,
    });
  }
  return out;
}
function readModernComments(xml: string, get: (p: string) => string | null, presRels: Map<string, Rel>, presPath: string): Comment[] {
  const authors = readAuthors(presRels, presPath, get);
  const out: Comment[] = [];
  const walk = (list: XNode[], parent?: string) => {
    for (const c of list) {
      if (tagOf(c) !== 'cm') continue;
      const id = newId('c');
      const a = authors.find((x) => x.id === attrOf(c, 'authorId'));
      const body = findKid(c, 'txBody');
      const text = findKids(body, 'p').map((p) => textOfNode(p)).join('\n');
      out.push({ id, author: a?.name ?? 'Autor', initials: a?.initials, text, at: Date.parse(attrOf(c, 'created') ?? '') || 0, x: 0, y: 0, ...(attrOf(c, 'status') === 'resolved' ? { resolved: true } : {}), ...(parent ? { replyTo: parent } : {}) });
      walk(kidsOf(findKid(c, 'replyLst') ?? {}), id);
    }
  };
  walk(kidsOf(rootOf(parseXml(xml), 'cmLst') ?? {}));
  return out;
}

function readPresProps(xml: string | null, deck: Deck): void {
  if (!xml) return;
  const root = rootOf(parseXml(xml), 'presentationPr');
  const sp = findKid(root, 'showPr');
  if (sp) {
    deck.show.loop = boolAttr(sp, 'loop');
    deck.show.showNarration = boolAttr(sp, 'showNarration');
    if (attrOf(sp, 'showAnimation') === '0') deck.show.showAnimation = false;
    if (attrOf(sp, 'useTimings') === '0') deck.show.useTimings = false;
    if (findKid(sp, 'kiosk')) deck.show.mode = 'kiosk';
    else if (findKid(sp, 'browse')) deck.show.mode = 'browsed';
    else deck.show.mode = 'presenter';
    const rg = findKid(sp, 'sldRg');
    if (rg) deck.show.range = { from: numAttr(rg, 'st') ?? 1, to: numAttr(rg, 'end') ?? 1 };
    const cust = findKid(sp, 'custShow');
    const ci = cust ? Number(attrOf(cust, 'id')) : NaN;
    if (Number.isFinite(ci) && deck.show.customShows?.[ci]) deck.show.range = { show: deck.show.customShows[ci]!.name };
  }
}

export type { ListStyle, SchemeSlot, Theme };
export { readEffects };
