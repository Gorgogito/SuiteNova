import { esc } from '@suitenova/writer-core';
import { docNode } from '../text';
import type { BodyProps, Bullet, Clr, Effects, Fill, Geometry, Hyperlink, LevelStyle, LineEnd, ListStyle, Ln, ParaProps, Rect4, RunProps, Shadow, Spacing, TextBody, Xfrm } from '../types';

export const EMU = 12700;
export const emu = (pt: number): number => Math.round(pt * EMU);
const ang = (deg: number): number => Math.round(deg * 60000);

/** What the writers need from the package being built. */
export interface WriteCtx {
  /** relationship id of an image asset (registers it as a media part of the current part) */
  image(assetId: string): string | undefined;
  /** relationship id of a hyperlink; `slide` targets a slide part */
  link(h: Hyperlink): { rid: string; action?: string } | undefined;
}

const attr = (k: string, v: string | number | boolean | undefined): string => (v === undefined || v === '' ? '' : ` ${k}="${typeof v === 'boolean' ? (v ? 1 : 0) : esc(String(v))}"`);

// ------------------------------------------------------------------------------------------------ colour and fills

export function clrXml(c: Clr | undefined): string {
  if (!c) return '<a:srgbClr val="000000"/>';
  const mods = (c.mods ?? []).map((m) => `<a:${m.t}${m.v !== undefined ? ` val="${Math.round(m.v)}"` : ''}/>`).join('');
  if (c.scheme) return `<a:schemeClr val="${c.scheme}">${mods}</a:schemeClr>`;
  const hex = (c.rgb ?? '#000000').replace('#', '').toUpperCase().padStart(6, '0').slice(0, 6);
  return mods ? `<a:srgbClr val="${hex}">${mods}</a:srgbClr>` : `<a:srgbClr val="${hex}"/>`;
}

const rect4 = (tag: string, r: Rect4 | undefined): string => (r ? `<a:${tag} l="${Math.round(r.l)}" t="${Math.round(r.t)}" r="${Math.round(r.r)}" b="${Math.round(r.b)}"/>` : '');

export function fillXml(f: Fill | undefined, ctx: WriteCtx): string {
  if (!f || f.t === 'inherit') return '';
  switch (f.t) {
    case 'none':
      return '<a:noFill/>';
    case 'group':
      return '<a:grpFill/>';
    case 'solid':
      return `<a:solidFill>${clrXml(f.c)}</a:solidFill>`;
    case 'patt':
      return `<a:pattFill prst="${f.prst}"><a:fgClr>${clrXml(f.fg)}</a:fgClr><a:bgClr>${clrXml(f.bg)}</a:bgClr></a:pattFill>`;
    case 'grad': {
      const stops = f.stops.map((s) => `<a:gs pos="${Math.round(s.pos)}">${clrXml(s.c)}</a:gs>`).join('');
      const dir = f.path ? `<a:path path="${f.path.kind}">${rect4('fillToRect', f.path.rect ?? { l: 50000, t: 50000, r: 50000, b: 50000 })}</a:path>` : `<a:lin ang="${ang(f.lin?.ang ?? 0)}"${attr('scaled', f.lin?.scaled)}/>`;
      return `<a:gradFill${attr('rotWithShape', f.rotWithShape)}><a:gsLst>${stops}</a:gsLst>${dir}</a:gradFill>`;
    }
    case 'blip': {
      const rid = ctx.image(f.src);
      if (!rid) return '<a:noFill/>';
      const extra = f.alpha !== undefined && f.alpha < 100 ? `<a:alphaModFix amt="${Math.round(f.alpha * 1000)}"/>` : '';
      const duo = f.duotone ? `<a:duotone>${clrXml(f.duotone[0])}${clrXml(f.duotone[1])}</a:duotone>` : '';
      const tile = f.tile ? `<a:tile tx="${emu(f.tile.tx)}" ty="${emu(f.tile.ty)}" sx="${Math.round(f.tile.sx * 1000)}" sy="${Math.round(f.tile.sy * 1000)}"${attr('flip', f.tile.flip)}${attr('algn', f.tile.algn)}/>` : `<a:stretch>${f.stretch && f.stretch !== true ? rect4('fillRect', f.stretch) : '<a:fillRect/>'}</a:stretch>`;
      return `<a:blipFill${attr('rotWithShape', f.rotWithShape)}><a:blip r:embed="${rid}">${extra}${duo}</a:blip>${rect4('srcRect', f.srcRect)}${tile}</a:blipFill>`;
    }
  }
}

function endXml(tag: string, e: LineEnd | undefined): string {
  return e ? `<a:${tag} type="${e.type}"${attr('w', e.w)}${attr('len', e.len)}/>` : '';
}

export function lnXml(ln: Ln | undefined, ctx: WriteCtx, tag = 'a:ln'): string {
  if (!ln) return '';
  const a = `${ln.w !== undefined ? attr('w', emu(ln.w)) : ''}${attr('cap', ln.cap)}${attr('cmpd', ln.cmpd)}${attr('algn', ln.algn)}`;
  const dash = ln.custDash ? `<a:custDash>${ln.custDash.map((v, i) => (i % 2 === 0 ? `<a:ds d="${Math.round(v)}"` : ` sp="${Math.round(v)}"/>`)).join('')}${ln.custDash.length % 2 ? '/>' : ''}</a:custDash>` : ln.dash ? `<a:prstDash val="${ln.dash}"/>` : '';
  const join = ln.join === 'round' ? '<a:round/>' : ln.join === 'bevel' ? '<a:bevel/>' : ln.join === 'miter' ? `<a:miter${ln.miterLim ? ` lim="${Math.round(ln.miterLim * 100000)}"` : ''}/>` : '';
  return `<${tag}${a}>${fillXml(ln.fill, ctx)}${dash}${join}${endXml('headEnd', ln.head)}${endXml('tailEnd', ln.tail)}</${tag}>`;
}

// ------------------------------------------------------------------------------------------------ effects

function shadowXml(tag: string, s: Shadow): string {
  return `<a:${tag} blurRad="${emu(s.blur)}" dist="${emu(s.dist)}" dir="${ang(s.dir)}"${s.sx !== undefined ? attr('sx', Math.round(s.sx * 1000)) : ''}${s.sy !== undefined ? attr('sy', Math.round(s.sy * 1000)) : ''}${s.kx !== undefined ? attr('kx', ang(s.kx)) : ''}${s.ky !== undefined ? attr('ky', ang(s.ky)) : ''}${attr('algn', s.algn)}${attr('rotWithShape', s.rotWithShape)}>${clrXml(s.c)}</a:${tag}>`;
}

export function effectsXml(e: Effects | undefined): string {
  if (!e || !Object.keys(e).length) return '';
  let s = '';
  if (e.blur) s += `<a:blur rad="${emu(e.blur.rad)}"${attr('grow', e.blur.grow)}/>`;
  if (e.glow) s += `<a:glow rad="${emu(e.glow.rad)}">${clrXml(e.glow.c)}</a:glow>`;
  if (e.inner) s += shadowXml('innerShdw', e.inner);
  if (e.outer) s += shadowXml('outerShdw', e.outer);
  if (e.reflection) {
    const r = e.reflection;
    s += `<a:reflection blurRad="${emu(r.blur)}" stA="${Math.round(r.stA * 1000)}" stPos="${Math.round(r.stPos * 1000)}" endA="${Math.round(r.endA * 1000)}" endPos="${Math.round(r.endPos * 1000)}" dist="${emu(r.dist)}" dir="${ang(r.dir)}" fadeDir="${ang(r.fadeDir)}" sx="${Math.round(r.sx * 1000)}" sy="${Math.round(r.sy * 1000)}"${attr('algn', r.algn)}${attr('rotWithShape', r.rotWithShape)}/>`;
  }
  if (e.softEdge) s += `<a:softEdge rad="${emu(e.softEdge.rad)}"/>`;
  return `<a:effectLst>${s}</a:effectLst>`;
}

// ------------------------------------------------------------------------------------------------ transform and geometry

export function xfrmXml(x: Xfrm | undefined, tag = 'a:xfrm'): string {
  if (!x) return '';
  const a = `${x.rot ? attr('rot', ang(x.rot)) : ''}${x.flipH ? ' flipH="1"' : ''}${x.flipV ? ' flipV="1"' : ''}`;
  return `<${tag}${a}><a:off x="${emu(x.x)}" y="${emu(x.y)}"/><a:ext cx="${emu(x.w)}" cy="${emu(x.h)}"/></${tag}>`;
}

export function geomXml(g: Geometry | undefined): string {
  if (!g) return '';
  if ('prst' in g) {
    const av = g.adj && Object.keys(g.adj).length ? `<a:avLst>${Object.entries(g.adj).map(([k, v]) => `<a:gd name="${k}" fmla="val ${Math.round(v)}"/>`).join('')}</a:avLst>` : '<a:avLst/>';
    return `<a:prstGeom prst="${g.prst}">${av}</a:prstGeom>`;
  }
  const pt = (x: number, y: number) => `<a:pt x="${Math.round(x)}" y="${Math.round(y)}"/>`;
  const paths = g.cust
    .map((p) => {
      const cmds = p.cmds
        .map((c) => {
          if (c[0] === 'M') return `<a:moveTo>${pt(c[1], c[2])}</a:moveTo>`;
          if (c[0] === 'L') return `<a:lnTo>${pt(c[1], c[2])}</a:lnTo>`;
          if (c[0] === 'C') return `<a:cubicBezTo>${pt(c[1], c[2])}${pt(c[3], c[4])}${pt(c[5], c[6])}</a:cubicBezTo>`;
          if (c[0] === 'Q') return `<a:quadBezTo>${pt(c[1], c[2])}${pt(c[3], c[4])}</a:quadBezTo>`;
          if (c[0] === 'A') return `<a:arcTo wR="${Math.round(c[1])}" hR="${Math.round(c[2])}" stAng="${ang(c[3])}" swAng="${ang(c[4])}"/>`;
          return '<a:close/>';
        })
        .join('');
      return `<a:path w="${Math.round(p.w)}" h="${Math.round(p.h)}"${attr('fill', p.fill && p.fill !== 'norm' ? p.fill : undefined)}${p.stroke === false ? ' stroke="0"' : ''}>${cmds}</a:path>`;
    })
    .join('');
  const r = g.rect ?? { l: 'l', t: 't', r: 'r', b: 'b' };
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="${r.l === '0' ? 'l' : r.l}" t="${r.t === '0' ? 't' : r.t}" r="${r.r}" b="${r.b}"/><a:pathLst>${paths}</a:pathLst></a:custGeom>`;
}

// ------------------------------------------------------------------------------------------------ text

function spcXml(tag: string, s: Spacing | undefined): string {
  if (!s) return '';
  return `<a:${tag}>${'pct' in s ? `<a:spcPct val="${Math.round(s.pct)}"/>` : `<a:spcPts val="${Math.round(s.pts * 100)}"/>`}</a:${tag}>`;
}

function bulletXml(b: Bullet | undefined, ctx: WriteCtx): string {
  if (!b) return '';
  let s = '';
  if (b.clr) s += `<a:buClr>${clrXml(b.clr)}</a:buClr>`;
  else if (b.clr === null) s += '<a:buClrTx/>';
  if (b.szPct !== undefined) s += `<a:buSzPct val="${Math.round(b.szPct * 1000)}"/>`;
  else if (b.szPts !== undefined) s += `<a:buSzPts val="${Math.round(b.szPts * 100)}"/>`;
  if (b.font) s += `<a:buFont typeface="${esc(b.font)}"/>`;
  if (b.kind === 'none') s += '<a:buNone/>';
  else if (b.kind === 'char') s += `<a:buChar char="${esc(b.char ?? '•')}"/>`;
  else if (b.kind === 'auto') s += `<a:buAutoNum type="${b.auto ?? 'arabicPeriod'}"${b.startAt !== undefined && b.startAt !== 1 ? ` startAt="${b.startAt}"` : ''}/>`;
  else if (b.kind === 'blip' && b.src) {
    const rid = ctx.image(b.src);
    if (rid) s += `<a:buBlip><a:blip r:embed="${rid}"/></a:buBlip>`;
  }
  return s;
}

export function paraPropsXml(p: ParaProps, lvl: number | undefined, ctx: WriteCtx, tag = 'a:pPr', extra = ''): string {
  const a = `${lvl ? attr('lvl', lvl) : ''}${p.marL !== undefined ? attr('marL', emu(p.marL)) : ''}${p.indent !== undefined ? attr('indent', emu(p.indent)) : ''}${attr('algn', p.algn)}${p.defTabSz !== undefined ? attr('defTabSz', emu(p.defTabSz)) : ''}${p.rtl !== undefined ? attr('rtl', p.rtl) : ''}${p.hangingPunct !== undefined ? attr('hangingPunct', p.hangingPunct) : ''}`;
  const tabs = p.tabs?.length ? `<a:tabLst>${p.tabs.map((t) => `<a:tab pos="${emu(t.pos)}" algn="${t.algn}"/>`).join('')}</a:tabLst>` : '';
  const inner = `${spcXml('lnSpc', p.lnSpc)}${spcXml('spcBef', p.spcBef)}${spcXml('spcAft', p.spcAft)}${bulletXml(p.bullet, ctx)}${tabs}${extra}`;
  return inner || a ? (inner ? `<${tag}${a}>${inner}</${tag}>` : `<${tag}${a}/>`) : '';
}

function hlinkXml(h: Hyperlink | undefined, ctx: WriteCtx, tag = 'a:hlinkClick'): string {
  if (!h) return '';
  const l = ctx.link(h);
  if (l) return `<a:${tag.replace('a:', '')} r:id="${l.rid}"${attr('action', l.action)}${attr('tooltip', h.tooltip)}/>`;
  if (h.action) return `<a:${tag.replace('a:', '')} r:id=""${attr('action', h.action)}${attr('tooltip', h.tooltip)}/>`;
  return '';
}

export function runPropsXml(r: RunProps, ctx: WriteCtx, tag = 'a:rPr', lang = true): string {
  const a = `${lang && r.lang ? attr('lang', r.lang) : ''}${r.sz !== undefined ? attr('sz', Math.round(r.sz * 100)) : ''}${r.b !== undefined ? attr('b', r.b) : ''}${r.i !== undefined ? attr('i', r.i) : ''}${attr('u', r.u)}${r.strike ? attr('strike', r.strike) : ''}${r.kern !== undefined ? attr('kern', Math.round(r.kern * 100)) : ''}${attr('cap', r.cap)}${r.spc !== undefined ? attr('spc', Math.round(r.spc * 100)) : ''}${r.baseline ? attr('baseline', Math.round(r.baseline * 1000)) : ''}`;
  const color = r.color ? `<a:solidFill>${clrXml(r.color)}</a:solidFill>` : '';
  const fxFill = r.fx?.fill ? fillXml(r.fx.fill, ctx) : '';
  const ln = r.fx?.ln ? lnXml(r.fx.ln, ctx) : '';
  const ef = r.fx?.effects ? effectsXml(r.fx.effects) : '';
  const hl = r.highlight ? `<a:highlight>${clrXml(r.highlight)}</a:highlight>` : '';
  const face = `${r.latin ? `<a:latin typeface="${esc(r.latin)}"/>` : ''}${r.ea ? `<a:ea typeface="${esc(r.ea)}"/>` : ''}${r.cs ? `<a:cs typeface="${esc(r.cs)}"/>` : ''}${r.sym ? `<a:sym typeface="${esc(r.sym)}"/>` : ''}`;
  const link = hlinkXml(r.hlink, ctx);
  const inner = `${ln}${fxFill || color}${ef}${hl}${face}${link}`;
  return inner ? `<${tag}${a}>${inner}</${tag}>` : `<${tag}${a}/>`;
}

export function listStyleXml(ls: ListStyle | undefined, ctx: WriteCtx, tag = 'a:lstStyle'): string {
  if (!ls) return `<${tag}/>`;
  const lvl = (l: LevelStyle | undefined, name: string, n: number | undefined) => {
    if (!l) return '';
    const rp = l.rPr && Object.keys(l.rPr).length ? runPropsXml(l.rPr, ctx, 'a:defRPr', false) : '';
    return paraPropsXml(l.pPr ?? {}, undefined, ctx, `a:${name}`, rp) || (rp ? `<a:${name}>${rp}</a:${name}>` : '') || (n === undefined ? '' : '');
  };
  let s = lvl(ls.def, 'defPPr', undefined);
  for (let i = 0; i < 9; i++) s += lvl(ls.lvl?.[i], `lvl${i + 1}pPr`, i);
  return s ? `<${tag}>${s}</${tag}>` : `<${tag}/>`;
}

export function bodyPrXml(b: BodyProps | undefined, tag = 'a:bodyPr'): string {
  b = b ?? {};
  const a = `${b.rot ? attr('rot', ang(b.rot)) : ''}${attr('vert', b.vert)}${attr('wrap', b.wrap)}${b.lIns !== undefined ? attr('lIns', emu(b.lIns)) : ''}${b.tIns !== undefined ? attr('tIns', emu(b.tIns)) : ''}${b.rIns !== undefined ? attr('rIns', emu(b.rIns)) : ''}${b.bIns !== undefined ? attr('bIns', emu(b.bIns)) : ''}${b.numCol ? attr('numCol', b.numCol) : ''}${b.spcCol !== undefined ? attr('spcCol', emu(b.spcCol)) : ''}${b.rtlCol ? attr('rtlCol', true) : ''}${attr('anchor', b.anchor)}${b.anchorCtr ? attr('anchorCtr', true) : ''}${b.upright ? attr('upright', true) : ''}`;
  const warp = b.warp ? `<a:prstTxWarp prst="${b.warp.prst}">${b.warp.adj ? `<a:avLst>${Object.entries(b.warp.adj).map(([k, v]) => `<a:gd name="${k}" fmla="val ${Math.round(v)}"/>`).join('')}</a:avLst>` : '<a:avLst/>'}</a:prstTxWarp>` : '';
  let fit = '';
  if (b.fit?.t === 'none') fit = '<a:noAutofit/>';
  else if (b.fit?.t === 'shape') fit = '<a:spAutoFit/>';
  else if (b.fit?.t === 'norm') fit = `<a:normAutofit${b.fit.fontScale !== undefined ? attr('fontScale', Math.round(b.fit.fontScale * 1000)) : ''}${b.fit.lnSpcReduction !== undefined ? attr('lnSpcReduction', Math.round(b.fit.lnSpcReduction * 1000)) : ''}/>`;
  const inner = warp + fit;
  return inner ? `<${tag}${a}>${inner}</${tag}>` : `<${tag}${a}/>`;
}

const FIELD_ID = '{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}';

export function paragraphsXml(doc: unknown, ctx: WriteCtx): string {
  const root = docNode(doc);
  let out = '';
  root.forEach((para) => {
    let runs = '';
    para.forEach((c) => {
      const rp = (c.type.name === 'text' ? (c.marks.find((m) => m.type.name === 'run')?.attrs.r as RunProps | undefined) : (c.attrs.r as RunProps | undefined)) ?? {};
      if (c.type.name === 'text') runs += `<a:r>${runPropsXml({ lang: 'es-ES', ...rp }, ctx)}<a:t>${esc(c.text ?? '')}</a:t></a:r>`;
      else if (c.type.name === 'hard_break') runs += `<a:br>${runPropsXml(rp, ctx)}</a:br>`;
      else if (c.type.name === 'field') runs += `<a:fld id="${FIELD_ID}" type="${c.attrs.ftype}">${runPropsXml({ lang: 'es-ES', ...rp }, ctx)}<a:t>${esc(String(c.attrs.text))}</a:t></a:fld>`;
    });
    const end = para.attrs.end as RunProps;
    const endXml = end && Object.keys(end).length ? runPropsXml(end, ctx, 'a:endParaRPr') : '';
    out += `<a:p>${paraPropsXml(para.attrs.p as ParaProps, para.attrs.lvl as number, ctx)}${runs}${endXml}</a:p>`;
  });
  return out;
}

export function txBodyXml(tb: TextBody | undefined, ctx: WriteCtx, tag = 'p:txBody'): string {
  if (!tb) return '';
  return `<${tag}>${bodyPrXml(tb.body)}${listStyleXml(tb.lst, ctx)}${paragraphsXml(tb.doc, ctx)}</${tag}>`;
}
