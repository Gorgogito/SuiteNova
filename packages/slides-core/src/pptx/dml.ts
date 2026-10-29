import { attrOf, findKid, findKids, kidsOf, tagOf, textOfNode, type XNode } from '@suitenova/writer-core';
import { makeDoc, slidesSchema, type ParaSpec, type RunSpec } from '../text';
import type {
  Bullet,
  BodyProps,
  Clr,
  ClrMod,
  ClrModKind,
  CustPath,
  DashPreset,
  Effects,
  Fill,
  Geometry,
  GradStop,
  Hyperlink,
  LevelStyle,
  LineEnd,
  ListStyle,
  Ln,
  ParaProps,
  PathCmd,
  Rect4,
  Reflection,
  RunProps,
  Shadow,
  Spacing,
  Tab,
  TextBody,
  TextEffects,
  Xfrm,
} from '../types';

export const EMU = 12700;
export const emu = (v: string | undefined): number | undefined => {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n / EMU : undefined;
};
export const numAttr = (n: XNode | undefined, name: string): number | undefined => {
  const v = n ? attrOf(n, name) : undefined;
  if (v === undefined || v === '') return undefined;
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
};
export const boolAttr = (n: XNode | undefined, name: string): boolean | undefined => {
  const v = n ? attrOf(n, name) : undefined;
  if (v === undefined) return undefined;
  return v === '1' || v === 'true';
};
const ang = (n: XNode | undefined, name: string): number | undefined => {
  const v = numAttr(n, name);
  return v === undefined ? undefined : v / 60000;
};

export interface DmlCtx {
  /** resolves a relationship id of the part being read to an asset id (loading the bytes) */
  blip(relId: string | undefined): string | undefined;
  /** external or internal target of a relationship id */
  link(relId: string | undefined): { target: string; external: boolean; type: string } | undefined;
  warn(msg: string): void;
}

// ------------------------------------------------------------------------------------------------ colour

const CLR_TAGS = ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'hslClr', 'scrgbClr'];
const PRST_CLR: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080', darkBlue: '#00008b', darkCyan: '#008b8b', darkGray: '#a9a9a9', darkGreen: '#006400', darkMagenta: '#8b008b', darkRed: '#8b0000', darkYellow: '#808000', lightGray: '#d3d3d3', cyan: '#00ffff', magenta: '#ff00ff', orange: '#ffa500',
};

export function readClrNode(n: XNode): Clr {
  const t = tagOf(n);
  const c: Clr = {};
  if (t === 'srgbClr') c.rgb = '#' + (attrOf(n, 'val') ?? '000000').toLowerCase();
  else if (t === 'schemeClr') c.scheme = (attrOf(n, 'val') ?? 'tx1') as Clr['scheme'];
  else if (t === 'sysClr') c.rgb = '#' + (attrOf(n, 'lastClr') ?? (attrOf(n, 'val') === 'window' ? 'ffffff' : '000000')).toLowerCase();
  else if (t === 'prstClr') c.rgb = PRST_CLR[attrOf(n, 'val') ?? 'black'] ?? '#000000';
  else if (t === 'hslClr') {
    const h = (numAttr(n, 'hue') ?? 0) / 21600000;
    const s = (numAttr(n, 'sat') ?? 0) / 100000;
    const l = (numAttr(n, 'lum') ?? 0) / 100000;
    c.rgb = hslHex(h, s, l);
  } else if (t === 'scrgbClr') {
    const f = (k: string) => Math.round(((numAttr(n, k) ?? 0) / 100000) * 255);
    c.rgb = '#' + [f('r'), f('g'), f('b')].map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');
  }
  const mods: ClrMod[] = [];
  for (const k of kidsOf(n)) {
    const kt = tagOf(k);
    if (kt === '#text') continue;
    const v = numAttr(k, 'val');
    mods.push(v === undefined ? { t: kt as ClrModKind } : { t: kt as ClrModKind, v });
  }
  if (mods.length) c.mods = mods;
  return c;
}
function hslHex(h: number, s: number, l: number): string {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t0: number) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const x = s === 0 ? [l, l, l] : [f(h + 1 / 3), f(h), f(h - 1 / 3)];
  return '#' + x.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

/** The colour element among the children of `parent`, if any. */
export function readClr(parent: XNode | undefined): Clr | undefined {
  if (!parent) return undefined;
  const k = kidsOf(parent).find((x) => CLR_TAGS.includes(tagOf(x)));
  return k ? readClrNode(k) : undefined;
}

// ------------------------------------------------------------------------------------------------ fills

function readRect(n: XNode | undefined): Rect4 | undefined {
  if (!n) return undefined;
  return { l: numAttr(n, 'l') ?? 0, t: numAttr(n, 't') ?? 0, r: numAttr(n, 'r') ?? 0, b: numAttr(n, 'b') ?? 0 };
}

const FILL_TAGS = ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'];

export function readFillNode(n: XNode, ctx: DmlCtx): Fill {
  switch (tagOf(n)) {
    case 'noFill':
      return { t: 'none' };
    case 'grpFill':
      return { t: 'group' };
    case 'solidFill':
      return { t: 'solid', c: readClr(n) ?? { rgb: '#000000' } };
    case 'pattFill':
      return { t: 'patt', prst: attrOf(n, 'prst') ?? 'pct50', fg: readClr(findKid(n, 'fgClr')) ?? { rgb: '#000000' }, bg: readClr(findKid(n, 'bgClr')) ?? { rgb: '#ffffff' } };
    case 'gradFill': {
      const stops: GradStop[] = [];
      for (const gs of findKids(findKid(n, 'gsLst'), 'gs')) stops.push({ pos: numAttr(gs, 'pos') ?? 0, c: readClr(gs) ?? { rgb: '#000000' } });
      const lin = findKid(n, 'lin');
      const path = findKid(n, 'path');
      const f: Fill = { t: 'grad', stops, rotWithShape: boolAttr(n, 'rotWithShape') };
      if (lin) f.lin = { ang: (numAttr(lin, 'ang') ?? 0) / 60000, scaled: boolAttr(lin, 'scaled') };
      else if (path) f.path = { kind: (attrOf(path, 'path') ?? 'circle') as 'circle' | 'rect' | 'shape', rect: readRect(findKid(path, 'fillToRect')) };
      else f.lin = { ang: 0 };
      return f;
    }
    case 'blipFill': {
      const blip = findKid(n, 'blip');
      const src = ctx.blip(blip ? attrOf(blip, 'embed') : undefined);
      if (!src) return { t: 'none' };
      const f: Fill & { t: 'blip' } = { t: 'blip', src, rotWithShape: boolAttr(n, 'rotWithShape') };
      const sr = readRect(findKid(n, 'srcRect'));
      if (sr) f.srcRect = sr;
      const tile = findKid(n, 'tile');
      if (tile) f.tile = { tx: (numAttr(tile, 'tx') ?? 0) / EMU, ty: (numAttr(tile, 'ty') ?? 0) / EMU, sx: (numAttr(tile, 'sx') ?? 100000) / 1000, sy: (numAttr(tile, 'sy') ?? 100000) / 1000, flip: attrOf(tile, 'flip'), algn: attrOf(tile, 'algn') };
      else {
        const st = findKid(n, 'stretch');
        f.stretch = readRect(findKid(st, 'fillRect')) ?? true;
      }
      const am = blip && findKid(blip, 'alphaModFix');
      if (am) f.alpha = (numAttr(am, 'amt') ?? 100000) / 1000;
      const duo = blip && findKid(blip, 'duotone');
      if (duo) {
        const cs = kidsOf(duo).filter((k) => CLR_TAGS.includes(tagOf(k))).map(readClrNode);
        if (cs.length === 2) f.duotone = [cs[0]!, cs[1]!];
      }
      return f;
    }
  }
  return { t: 'none' };
}

/** The fill among the children of a shape-properties element, or undefined when it does not say. */
export function readFill(parent: XNode | undefined, ctx: DmlCtx): Fill | undefined {
  if (!parent) return undefined;
  const k = kidsOf(parent).find((x) => FILL_TAGS.includes(tagOf(x)));
  return k ? readFillNode(k, ctx) : undefined;
}

// ------------------------------------------------------------------------------------------------ lines

function readEnd(n: XNode | undefined): LineEnd | undefined {
  if (!n) return undefined;
  const type = (attrOf(n, 'type') ?? 'none') as LineEnd['type'];
  return { type, w: attrOf(n, 'w') as LineEnd['w'], len: attrOf(n, 'len') as LineEnd['len'] };
}

export function readLn(n: XNode | undefined, ctx: DmlCtx): Ln | undefined {
  if (!n) return undefined;
  const ln: Ln = {};
  const w = emu(attrOf(n, 'w'));
  if (w !== undefined) ln.w = w;
  const cap = attrOf(n, 'cap');
  if (cap) ln.cap = cap === 'rnd' ? 'rnd' : cap === 'sq' ? 'sq' : 'flat';
  const cmpd = attrOf(n, 'cmpd');
  if (cmpd) ln.cmpd = cmpd as Ln['cmpd'];
  const algn = attrOf(n, 'algn');
  if (algn) ln.algn = algn as Ln['algn'];
  const fill = readFill(n, ctx);
  if (fill) ln.fill = fill;
  const pd = findKid(n, 'prstDash');
  if (pd) ln.dash = (attrOf(pd, 'val') ?? 'solid') as DashPreset;
  const cd = findKid(n, 'custDash');
  if (cd) ln.custDash = findKids(cd, 'ds').flatMap((d) => [numAttr(d, 'd') ?? 100000, numAttr(d, 'sp') ?? 100000]);
  if (findKid(n, 'round')) ln.join = 'round';
  else if (findKid(n, 'bevel')) ln.join = 'bevel';
  else {
    const m = findKid(n, 'miter');
    if (m) {
      ln.join = 'miter';
      const lim = numAttr(m, 'lim');
      if (lim !== undefined) ln.miterLim = lim / 100000;
    }
  }
  const h = readEnd(findKid(n, 'headEnd'));
  if (h) ln.head = h;
  const t = readEnd(findKid(n, 'tailEnd'));
  if (t) ln.tail = t;
  return ln;
}

// ------------------------------------------------------------------------------------------------ effects

function readShadow(n: XNode): Shadow {
  return {
    blur: (numAttr(n, 'blurRad') ?? 0) / EMU,
    dist: (numAttr(n, 'dist') ?? 0) / EMU,
    dir: (numAttr(n, 'dir') ?? 0) / 60000,
    c: readClr(n) ?? { rgb: '#000000', mods: [{ t: 'alpha', v: 50000 }] },
    sx: numAttr(n, 'sx') !== undefined ? numAttr(n, 'sx')! / 1000 : undefined,
    sy: numAttr(n, 'sy') !== undefined ? numAttr(n, 'sy')! / 1000 : undefined,
    kx: ang(n, 'kx'),
    ky: ang(n, 'ky'),
    algn: attrOf(n, 'algn'),
    rotWithShape: boolAttr(n, 'rotWithShape'),
  };
}

export function readEffects(n: XNode | undefined): Effects | undefined {
  if (!n) return undefined;
  const e: Effects = {};
  const o = findKid(n, 'outerShdw');
  if (o) e.outer = readShadow(o);
  const i = findKid(n, 'innerShdw');
  if (i) e.inner = readShadow(i);
  const g = findKid(n, 'glow');
  if (g) e.glow = { rad: (numAttr(g, 'rad') ?? 0) / EMU, c: readClr(g) ?? { rgb: '#ffffff' } };
  const s = findKid(n, 'softEdge');
  if (s) e.softEdge = { rad: (numAttr(s, 'rad') ?? 0) / EMU };
  const r = findKid(n, 'reflection');
  if (r) {
    const ref: Reflection = {
      blur: (numAttr(r, 'blurRad') ?? 0) / EMU,
      stA: (numAttr(r, 'stA') ?? 100000) / 1000,
      stPos: (numAttr(r, 'stPos') ?? 0) / 1000,
      endA: (numAttr(r, 'endA') ?? 0) / 1000,
      endPos: (numAttr(r, 'endPos') ?? 100000) / 1000,
      dist: (numAttr(r, 'dist') ?? 0) / EMU,
      dir: (numAttr(r, 'dir') ?? 5400000) / 60000,
      fadeDir: (numAttr(r, 'fadeDir') ?? 5400000) / 60000,
      sx: (numAttr(r, 'sx') ?? 100000) / 1000,
      sy: (numAttr(r, 'sy') ?? 100000) / 1000,
      algn: attrOf(r, 'algn'),
      rotWithShape: boolAttr(r, 'rotWithShape'),
    };
    e.reflection = ref;
  }
  const b = findKid(n, 'blur');
  if (b) e.blur = { rad: (numAttr(b, 'rad') ?? 0) / EMU, grow: boolAttr(b, 'grow') };
  return Object.keys(e).length ? e : undefined;
}

// ------------------------------------------------------------------------------------------------ transform and geometry

export function readXfrm(n: XNode | undefined): Xfrm | undefined {
  if (!n) return undefined;
  const off = findKid(n, 'off');
  const ext = findKid(n, 'ext');
  if (!off && !ext) return undefined;
  const x: Xfrm = { x: (numAttr(off, 'x') ?? 0) / EMU, y: (numAttr(off, 'y') ?? 0) / EMU, w: (numAttr(ext, 'cx') ?? 0) / EMU, h: (numAttr(ext, 'cy') ?? 0) / EMU };
  const rot = ang(n, 'rot');
  if (rot) x.rot = rot;
  if (attrOf(n, 'flipH') === '1' || attrOf(n, 'flipH') === 'true') x.flipH = true;
  if (attrOf(n, 'flipV') === '1' || attrOf(n, 'flipV') === 'true') x.flipV = true;
  return x;
}

function readAdj(av: XNode | undefined): Record<string, number> | undefined {
  if (!av) return undefined;
  const out: Record<string, number> = {};
  for (const g of findKids(av, 'gd')) {
    const m = /^val\s+(-?\d+)/.exec(attrOf(g, 'fmla') ?? '');
    if (m) out[attrOf(g, 'name') ?? 'adj'] = Number(m[1]);
  }
  return Object.keys(out).length ? out : undefined;
}

function readPathCmds(p: XNode): PathCmd[] {
  const out: PathCmd[] = [];
  const pt = (n: XNode): [number, number] => [numAttr(n, 'x') ?? 0, numAttr(n, 'y') ?? 0];
  for (const c of kidsOf(p)) {
    const t = tagOf(c);
    const pts = findKids(c, 'pt').map(pt);
    if (t === 'moveTo' && pts[0]) out.push(['M', pts[0][0], pts[0][1]]);
    else if (t === 'lnTo' && pts[0]) out.push(['L', pts[0][0], pts[0][1]]);
    else if (t === 'cubicBezTo' && pts.length >= 3) out.push(['C', pts[0]![0], pts[0]![1], pts[1]![0], pts[1]![1], pts[2]![0], pts[2]![1]]);
    else if (t === 'quadBezTo' && pts.length >= 2) out.push(['Q', pts[0]![0], pts[0]![1], pts[1]![0], pts[1]![1]]);
    else if (t === 'arcTo') out.push(['A', numAttr(c, 'wR') ?? 0, numAttr(c, 'hR') ?? 0, (numAttr(c, 'stAng') ?? 0) / 60000, (numAttr(c, 'swAng') ?? 0) / 60000]);
    else if (t === 'close') out.push(['Z']);
  }
  return out;
}

export function readGeometry(spPr: XNode | undefined): Geometry | undefined {
  if (!spPr) return undefined;
  const pg = findKid(spPr, 'prstGeom');
  if (pg) {
    const adj = readAdj(findKid(pg, 'avLst'));
    return { prst: attrOf(pg, 'prst') ?? 'rect', ...(adj ? { adj } : {}) };
  }
  const cg = findKid(spPr, 'custGeom');
  if (cg) {
    const paths: CustPath[] = findKids(findKid(cg, 'pathLst'), 'path').map((p) => ({
      w: numAttr(p, 'w') ?? 0,
      h: numAttr(p, 'h') ?? 0,
      cmds: readPathCmds(p),
      fill: attrOf(p, 'fill') as CustPath['fill'],
      stroke: attrOf(p, 'stroke') === '0' || attrOf(p, 'stroke') === 'false' ? false : undefined,
    }));
    const r = findKid(cg, 'rect');
    return { cust: paths, ...(r ? { rect: { l: attrOf(r, 'l') ?? '0', t: attrOf(r, 't') ?? '0', r: attrOf(r, 'r') ?? 'r', b: attrOf(r, 'b') ?? 'b' } } : {}) };
  }
  return undefined;
}

// ------------------------------------------------------------------------------------------------ text

function readSpacing(n: XNode | undefined): Spacing | undefined {
  if (!n) return undefined;
  const pct = findKid(n, 'spcPct');
  if (pct) return { pct: numAttr(pct, 'val') ?? 100000 };
  const pts = findKid(n, 'spcPts');
  if (pts) return { pts: (numAttr(pts, 'val') ?? 0) / 100 };
  return undefined;
}

export function readHyperlink(n: XNode | undefined, ctx: DmlCtx): Hyperlink | undefined {
  if (!n) return undefined;
  const h: Hyperlink = {};
  const tip = attrOf(n, 'tooltip');
  if (tip) h.tooltip = tip;
  const action = attrOf(n, 'action');
  const rid = attrOf(n, 'id');
  const l = ctx.link(rid);
  if (action) h.action = action;
  if (l) {
    if (l.external) h.url = l.target;
    else h.slide = `part:${l.target}`;
  } else if (action) {
    const m = /jump=(\w+)/.exec(action);
    const j = m?.[1];
    if (j === 'nextslide') h.slide = 'next';
    else if (j === 'previousslide') h.slide = 'prev';
    else if (j === 'firstslide') h.slide = 'first';
    else if (j === 'lastslide') h.slide = 'last';
    else if (j === 'endshow') h.slide = 'end';
  }
  return Object.keys(h).length ? h : undefined;
}

export function readRunProps(n: XNode | undefined, ctx: DmlCtx): RunProps {
  const r: RunProps = {};
  if (!n) return r;
  const b = attrOf(n, 'b');
  if (b !== undefined) r.b = b === '1' || b === 'true';
  const i = attrOf(n, 'i');
  if (i !== undefined) r.i = i === '1' || i === 'true';
  const u = attrOf(n, 'u');
  if (u !== undefined) r.u = u;
  const st = attrOf(n, 'strike');
  if (st && st !== 'noStrike') r.strike = st as RunProps['strike'];
  const sz = numAttr(n, 'sz');
  if (sz !== undefined) r.sz = sz / 100;
  const bl = numAttr(n, 'baseline');
  if (bl) r.baseline = bl / 1000;
  const cap = attrOf(n, 'cap');
  if (cap) r.cap = cap as RunProps['cap'];
  const spc = numAttr(n, 'spc');
  if (spc !== undefined) r.spc = spc / 100;
  const kern = numAttr(n, 'kern');
  if (kern !== undefined) r.kern = kern / 100;
  const lang = attrOf(n, 'lang');
  if (lang) r.lang = lang;
  const latin = findKid(n, 'latin');
  if (latin) r.latin = attrOf(latin, 'typeface');
  const ea = findKid(n, 'ea');
  if (ea) r.ea = attrOf(ea, 'typeface');
  const cs = findKid(n, 'cs');
  if (cs) r.cs = attrOf(cs, 'typeface');
  const sym = findKid(n, 'sym');
  if (sym) r.sym = attrOf(sym, 'typeface');
  const fill = readFill(n, ctx);
  if (fill) {
    if (fill.t === 'solid') r.color = fill.c;
    else (r.fx ??= {}).fill = fill;
  }
  const ln = readLn(findKid(n, 'ln'), ctx);
  if (ln) (r.fx ??= {}).ln = ln;
  const ef = readEffects(findKid(n, 'effectLst'));
  if (ef) (r.fx ??= {}).effects = ef;
  const hl = findKid(n, 'highlight');
  if (hl) r.highlight = readClr(hl);
  const hlink = readHyperlink(findKid(n, 'hlinkClick'), ctx);
  if (hlink) r.hlink = hlink;
  return r;
}

export function readParaProps(n: XNode | undefined, ctx: DmlCtx): ParaProps {
  const p: ParaProps = {};
  if (!n) return p;
  const algn = attrOf(n, 'algn');
  if (algn) p.algn = algn as ParaProps['algn'];
  const marL = emu(attrOf(n, 'marL'));
  if (marL !== undefined) p.marL = marL;
  const ind = emu(attrOf(n, 'indent'));
  if (ind !== undefined) p.indent = ind;
  const rtl = attrOf(n, 'rtl');
  if (rtl !== undefined) p.rtl = rtl === '1' || rtl === 'true';
  const dts = emu(attrOf(n, 'defTabSz'));
  if (dts !== undefined) p.defTabSz = dts;
  const hp = attrOf(n, 'hangingPunct');
  if (hp !== undefined) p.hangingPunct = hp === '1' || hp === 'true';
  const ls = readSpacing(findKid(n, 'lnSpc'));
  if (ls) p.lnSpc = ls;
  const sb = readSpacing(findKid(n, 'spcBef'));
  if (sb) p.spcBef = sb;
  const sa = readSpacing(findKid(n, 'spcAft'));
  if (sa) p.spcAft = sa;
  // bullets
  let bullet: Bullet | undefined;
  if (findKid(n, 'buNone')) bullet = { kind: 'none' };
  const ch = findKid(n, 'buChar');
  if (ch) bullet = { kind: 'char', char: attrOf(ch, 'char') ?? '•' };
  const an = findKid(n, 'buAutoNum');
  if (an) bullet = { kind: 'auto', auto: attrOf(an, 'type') ?? 'arabicPeriod', ...(numAttr(an, 'startAt') !== undefined ? { startAt: numAttr(an, 'startAt') } : {}) };
  const bb = findKid(n, 'buBlip');
  if (bb) {
    const blip = findKid(bb, 'blip');
    const src = ctx.blip(blip ? attrOf(blip, 'embed') : undefined);
    if (src) bullet = { kind: 'blip', src };
  }
  const bf = findKid(n, 'buFont');
  const bc = findKid(n, 'buClr');
  const bsp = findKid(n, 'buSzPct');
  const bst = findKid(n, 'buSzPts');
  if (bf || bc || bsp || bst || findKid(n, 'buClrTx') || findKid(n, 'buFontTx')) {
    bullet ??= { kind: 'inherit' };
    if (bf) bullet.font = attrOf(bf, 'typeface');
    if (bc) bullet.clr = readClr(bc) ?? null;
    if (bsp) bullet.szPct = (numAttr(bsp, 'val') ?? 100000) / 1000;
    if (bst) bullet.szPts = (numAttr(bst, 'val') ?? 1000) / 100;
  }
  if (bullet) p.bullet = bullet;
  const tl = findKid(n, 'tabLst');
  if (tl) p.tabs = findKids(tl, 'tab').map((t): Tab => ({ pos: (numAttr(t, 'pos') ?? 0) / EMU, algn: (attrOf(t, 'algn') ?? 'l') as Tab['algn'] }));
  return p;
}

export function readListStyle(n: XNode | undefined, ctx: DmlCtx): ListStyle | undefined {
  if (!n) return undefined;
  const ls: ListStyle = { lvl: [] };
  const level = (k: XNode): LevelStyle => ({ pPr: readParaProps(k, ctx), rPr: readRunProps(findKid(k, 'defRPr'), ctx) });
  const def = findKid(n, 'defPPr');
  if (def) ls.def = level(def);
  for (let i = 1; i <= 9; i++) {
    const k = findKid(n, `lvl${i}pPr`);
    if (k) ls.lvl![i - 1] = level(k);
  }
  return ls.def || ls.lvl!.some(Boolean) ? ls : undefined;
}

export function readBodyProps(n: XNode | undefined, ctx: DmlCtx): BodyProps {
  const b: BodyProps = {};
  if (!n) return b;
  const a = attrOf(n, 'anchor');
  if (a) b.anchor = a as BodyProps['anchor'];
  if (boolAttr(n, 'anchorCtr')) b.anchorCtr = true;
  const wrap = attrOf(n, 'wrap');
  if (wrap) b.wrap = wrap as BodyProps['wrap'];
  for (const [k, key] of [['lIns', 'lIns'], ['tIns', 'tIns'], ['rIns', 'rIns'], ['bIns', 'bIns']] as const) {
    const v = emu(attrOf(n, k));
    if (v !== undefined) b[key] = v;
  }
  const vert = attrOf(n, 'vert');
  if (vert && vert !== 'horz') b.vert = vert as BodyProps['vert'];
  const rot = ang(n, 'rot');
  if (rot) b.rot = rot;
  const nc = numAttr(n, 'numCol');
  if (nc && nc > 1) b.numCol = nc;
  const sc = emu(attrOf(n, 'spcCol'));
  if (sc) b.spcCol = sc;
  if (boolAttr(n, 'rtlCol')) b.rtlCol = true;
  if (boolAttr(n, 'upright')) b.upright = true;
  if (findKid(n, 'noAutofit')) b.fit = { t: 'none' };
  else if (findKid(n, 'spAutoFit')) b.fit = { t: 'shape' };
  else {
    const na = findKid(n, 'normAutofit');
    if (na) b.fit = { t: 'norm', ...(numAttr(na, 'fontScale') !== undefined ? { fontScale: numAttr(na, 'fontScale')! / 1000 } : {}), ...(numAttr(na, 'lnSpcReduction') !== undefined ? { lnSpcReduction: numAttr(na, 'lnSpcReduction')! / 1000 } : {}) };
  }
  const pw = findKid(n, 'prstTxWarp');
  if (pw) {
    const adj = readAdj(findKid(pw, 'avLst'));
    b.warp = { prst: attrOf(pw, 'prst') ?? 'textNoShape', ...(adj ? { adj } : {}) };
  }
  void ctx;
  return b;
}

/** Reads an `a:p` into a paragraph specification. */
export function readParagraph(p: XNode, ctx: DmlCtx): ParaSpec {
  const pPr = findKid(p, 'pPr');
  const pp = readParaProps(pPr, ctx);
  const lvl = numAttr(pPr, 'lvl') ?? 0;
  const runs: RunSpec[] = [];
  for (const c of kidsOf(p)) {
    const t = tagOf(c);
    if (t === 'r') {
      const text = textOfNode(findKid(c, 't') ?? { '#text': '' });
      if (text !== '') runs.push({ text, r: readRunProps(findKid(c, 'rPr'), ctx) });
    } else if (t === 'br') runs.push({ br: true, r: readRunProps(findKid(c, 'rPr'), ctx) });
    else if (t === 'fld') runs.push({ field: { ftype: attrOf(c, 'type') ?? 'slidenum', text: textOfNode(findKid(c, 't') ?? { '#text': '' }) || undefined }, r: readRunProps(findKid(c, 'rPr'), ctx) });
  }
  return { runs, lvl, p: pp, end: readRunProps(findKid(p, 'endParaRPr'), ctx) };
}

export function readTextBody(tx: XNode | undefined, ctx: DmlCtx): TextBody | undefined {
  if (!tx) return undefined;
  const paras = findKids(tx, 'p').map((p) => readParagraph(p, ctx));
  const lst = readListStyle(findKid(tx, 'lstStyle'), ctx);
  return { body: readBodyProps(findKid(tx, 'bodyPr'), ctx), ...(lst ? { lst } : {}), doc: makeDoc(paras.length ? paras : [{}]).toJSON() };
}

/** Exposes the schema so that callers can validate documents. */
export const schema = slidesSchema;
export type { TextEffects };
