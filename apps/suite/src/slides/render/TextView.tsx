import { clrCss, levelStyle, mergeR, themeFont, type Chain, type Clr, type Deck, type Fill, type ParaProps, type RunProps, type Spacing, type TextBody, type TextContext } from '@suitenova/slides-core';
import type { Node as PMNode } from 'prosemirror-model';
import type { CSSProperties, ReactNode } from 'react';
import type { RenderEnv } from './paint';
import { withPh } from './paint';

/*
 * Text of a shape as HTML. Units are the model's points, drawn as CSS pixels and scaled as a whole by the stage. Font sizes go
 * through the CSS variable --sl-fs (autofit), line spacing through --sl-ln.
 */

export interface TextEnv extends RenderEnv {
  deck: Deck;
  chain: Chain;
  slideNumber: number;
  /** show prompts of empty placeholders */
  prompts: boolean;
  onLink?: (link: NonNullable<RunProps['hlink']>) => void;
}

const LINE = 1.2;
const fs = (px: number): string => `calc(${px}px * var(--sl-fs, 1))`;
const spacingPx = (s: Spacing | undefined, size: number): number | undefined => (s ? ('pts' in s ? s.pts : (s.pct / 100000) * size * LINE) : undefined);

// ------------------------------------------------------------------------------------------------ numbering

const ROMAN: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
function roman(n: number): string {
  let r = '';
  let x = n;
  for (const [v, s] of ROMAN) while (x >= v) ((r += s), (x -= v));
  return r;
}
function alpha(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    x--;
    s = String.fromCharCode(97 + (x % 26)) + s;
    x = Math.floor(x / 26);
  }
  return s;
}
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

export function formatAuto(type: string, n: number): string {
  const wrap = (core: string) => (/ParenBoth$/.test(type) ? `(${core})` : /ParenR$/.test(type) ? `${core})` : /Period$/.test(type) ? `${core}.` : core);
  if (/^arabic/.test(type)) return wrap(String(n));
  if (/^alphaLc/.test(type)) return wrap(alpha(n));
  if (/^alphaUc/.test(type)) return wrap(alpha(n).toUpperCase());
  if (/^romanLc/.test(type)) return wrap(roman(n));
  if (/^romanUc/.test(type)) return wrap(roman(n).toUpperCase());
  if (/^circleNum/.test(type)) return CIRCLED[n - 1] ?? String(n);
  return wrap(String(n));
}

/** The effective paragraph properties of a paragraph node (level style then the paragraph's own). */
export function effectiveParaProps(tc: TextContext, para: PMNode): { lvl: number; pp: ParaProps; baseR: RunProps } {
  const lvl = Math.min(8, Math.max(0, para.attrs.lvl as number));
  const ls = levelStyle(tc, lvl);
  const own = para.attrs.p as ParaProps;
  const pp: ParaProps = { ...ls.pPr, ...own };
  // a bullet that only changes colour or size keeps the kind of the level style
  if (own.bullet && ls.pPr.bullet && own.bullet.kind === 'inherit') pp.bullet = { ...ls.pPr.bullet, ...own.bullet, kind: ls.pPr.bullet.kind };
  return { lvl, pp, baseR: ls.rPr };
}

/** The number each auto-numbered paragraph shows (undefined for the others). */
export function numberParas(doc: PMNode, tc: TextContext): (number | undefined)[] {
  const counters: { key: string; n: number }[] = [];
  const out: (number | undefined)[] = [];
  doc.forEach((para) => {
    const { lvl, pp } = effectiveParaProps(tc, para);
    const b = pp.bullet;
    if (b && b.kind === 'auto') {
      const key = `${b.auto}:${b.startAt ?? 1}`;
      counters.length = lvl + 1;
      const cur = counters[lvl];
      if (cur && cur.key === key) cur.n++;
      else counters[lvl] = { key, n: b.startAt ?? 1 };
      out.push(counters[lvl]!.n);
    } else {
      counters.length = Math.min(counters.length, lvl);
      out.push(undefined);
    }
  });
  return out;
}

// ------------------------------------------------------------------------------------------------ run styling

function fxFill(fill: Fill | undefined, env: RenderEnv, ph?: { c?: Clr }): CSSProperties {
  const cc = withPh(env.cc, ph);
  if (!fill) return {};
  if (fill.t === 'grad') {
    const stops = [...fill.stops].sort((a, b) => a.pos - b.pos).map((s) => `${clrCss(s.c, cc)} ${s.pos / 1000}%`).join(',');
    const bg = fill.path ? `radial-gradient(circle,${[...fill.stops].sort((a, b) => b.pos - a.pos).map((s) => `${clrCss(s.c, cc)} ${(100000 - s.pos) / 1000}%`).join(',')})` : `linear-gradient(${(fill.lin?.ang ?? 0) + 90}deg,${stops})`;
    return { backgroundImage: bg, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent' };
  }
  if (fill.t === 'blip') {
    const url = env.assetUrl(fill.src);
    return url ? { backgroundImage: `url(${url})`, backgroundSize: 'cover', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent' } : {};
  }
  if (fill.t === 'solid') return { color: clrCss(fill.c, cc) };
  if (fill.t === 'none') return { color: 'transparent', WebkitTextFillColor: 'transparent' };
  return {};
}

export function runStyle(r: RunProps, env: TextEnv, scale: number, ph?: { c?: Clr }): CSSProperties {
  const cc = withPh(env.cc, ph);
  const st: CSSProperties = {};
  const font = themeFont(env.chain.theme, r.latin);
  if (font) st.fontFamily = `"${font}", sans-serif`;
  if (r.sz !== undefined) st.fontSize = fs(r.sz * scale);
  if (r.b) st.fontWeight = 700;
  if (r.i) st.fontStyle = 'italic';
  const deco: string[] = [];
  if (r.u && r.u !== 'none') deco.push('underline');
  if (r.strike) deco.push('line-through');
  if (deco.length) st.textDecoration = deco.join(' ');
  if (r.u === 'dbl') st.textDecorationStyle = 'double';
  else if (r.u && /wavy/.test(r.u)) st.textDecorationStyle = 'wavy';
  else if (r.u && /dash/i.test(r.u)) st.textDecorationStyle = 'dashed';
  else if (r.u && /dott/i.test(r.u)) st.textDecorationStyle = 'dotted';
  if (r.color) st.color = clrCss(r.color, cc);
  if (r.highlight) st.backgroundColor = clrCss(r.highlight, cc);
  if (r.baseline) {
    st.verticalAlign = r.baseline > 0 ? 'super' : 'sub';
    st.fontSize = fs((r.sz ?? 18) * scale * 0.65);
  }
  if (r.cap === 'all') st.textTransform = 'uppercase';
  else if (r.cap === 'small') st.fontVariant = 'small-caps';
  if (r.spc) st.letterSpacing = r.spc;
  if (r.fx) {
    Object.assign(st, fxFill(r.fx.fill, env, ph));
    const ln = r.fx.ln;
    if (ln && ln.fill && ln.fill.t === 'solid') {
      st.WebkitTextStroke = `${ln.w ?? 0.75}px ${clrCss(ln.fill.c, cc)}`;
      st.paintOrder = 'stroke fill';
    }
    const e = r.fx.effects;
    const shadows: string[] = [];
    if (e?.outer) {
      const o = e.outer;
      shadows.push(`${o.dist * Math.cos((o.dir * Math.PI) / 180)}px ${o.dist * Math.sin((o.dir * Math.PI) / 180)}px ${o.blur}px ${clrCss(o.c, cc)}`);
    }
    if (e?.glow) shadows.push(`0 0 ${e.glow.rad}px ${clrCss(e.glow.c, cc)}`);
    if (shadows.length) st.textShadow = shadows.join(',');
    if (e?.reflection) {
      st.display = 'inline-block';
      (st as Record<string, unknown>).WebkitBoxReflect = `below ${e.reflection.dist}px linear-gradient(transparent ${100 - Math.max(10, e.reflection.endPos)}%, rgba(255,255,255,${(e.reflection.stA / 100 || 0.5).toFixed(2)}))`;
    }
  }
  return st;
}

/** CSS declarations of a style object, as text (for decorations). */
export function cssText(st: CSSProperties): string {
  return Object.entries(st)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k.replace(/^(Webkit|Moz)/, (m) => `-${m.toLowerCase()}`).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${typeof v === 'number' && !/^(fontWeight|lineHeight|opacity|zIndex|flex|order)$/.test(k) ? `${v}px` : v}`)
    .join(';');
}

// ------------------------------------------------------------------------------------------------ paragraph layout

export interface ParaInfo {
  style: CSSProperties;
  bullet?: { text: string; style: CSSProperties };
  size: number;
}

/** Layout of one paragraph: its CSS, and its bullet. `first` suppresses the space before the first paragraph of the box. */
export function paraInfo(pp: ParaProps, baseR: RunProps, para: PMNode, first: boolean, num: number | undefined, env: TextEnv, scale: number, ph?: { c?: Clr }, showEmptyBullet = false): ParaInfo {
  const empty = para.content.size === 0;
  const endR = mergeR(baseR, para.attrs.end as RunProps);
  let size = baseR.sz ?? 18;
  para.forEach((c) => {
    const r = c.type.name === 'text' ? (c.marks.find((m) => m.type.name === 'run')?.attrs.r as RunProps | undefined) : (c.attrs.r as RunProps | undefined);
    if (r?.sz) size = Math.max(size, r.sz);
  });
  if (empty && endR.sz) size = endR.sz;
  const px = size * scale;
  const marL = pp.marL ?? 0;
  const indent = pp.indent ?? 0;
  const b = pp.bullet;
  let text: string | undefined;
  if (b && b.kind === 'char') text = b.char ?? '•';
  else if (b && b.kind === 'auto') text = formatAuto(b.auto ?? 'arabicPeriod', num ?? b.startAt ?? 1);
  const align = pp.algn === 'just' || pp.algn === 'dist' || pp.algn === 'justLow' ? 'justify' : pp.algn === 'ctr' ? 'center' : pp.algn === 'r' ? 'right' : 'left';
  const lnPct = pp.lnSpc && 'pct' in pp.lnSpc ? Math.max(20, pp.lnSpc.pct / 1000) : undefined;
  const sb = spacingPx(pp.spcBef, px);
  const sa = spacingPx(pp.spcAft, px);
  const style: CSSProperties = {
    textAlign: align,
    paddingLeft: pp.rtl ? undefined : marL,
    paddingRight: pp.rtl ? marL : undefined,
    textIndent: text !== undefined ? 0 : indent,
    direction: pp.rtl ? 'rtl' : undefined,
    lineHeight: pp.lnSpc ? ('pts' in pp.lnSpc ? fs(pp.lnSpc.pts * scale) : `calc(${(lnPct! / 100) * LINE} * var(--sl-ln, 1))`) : `calc(${LINE} * var(--sl-ln, 1))`,
    marginTop: first || sb === undefined ? 0 : fs(sb),
    marginBottom: sa === undefined ? undefined : fs(sa),
    minHeight: fs(px * LINE),
    position: 'relative',
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
  };
  let bullet: ParaInfo['bullet'];
  if (text !== undefined && b && (!empty || showEmptyBullet)) {
    const bsize = b.szPts !== undefined ? b.szPts * scale : px * ((b.szPct ?? 100) / 100);
    const hang = Math.max(0, -indent);
    bullet = {
      text,
      style: {
        display: 'inline-block',
        minWidth: hang || undefined,
        marginLeft: indent < 0 ? indent : 0,
        fontSize: fs(bsize),
        fontFamily: b.font && !b.font.startsWith('+') ? `"${b.font}", Arial, sans-serif` : undefined,
        color: b.clr ? clrCss(b.clr, withPh(env.cc, ph)) : undefined,
        textIndent: 0,
        lineHeight: 1,
      },
    };
  }
  return { style, bullet, size: px };
}

// ------------------------------------------------------------------------------------------------ the view

export interface TextViewProps {
  tb: TextBody | undefined;
  tc: TextContext;
  env: TextEnv;
  scale?: number;
  prompt?: PMNode | null;
  ph?: { c?: Clr };
  fallbackColor?: Clr;
}

/** Width of a tab character: the distance to the next tab stop of the paragraph. */
function tabWidth(pp: ParaProps, marL: number, indent: number): number {
  const tabs = [...(pp.tabs ?? [])].sort((a, b) => a.pos - b.pos);
  const start = marL + Math.max(0, indent);
  const next = tabs.find((t) => t.pos > start + 1);
  return next ? next.pos - start : (pp.defTabSz ?? 72);
}

export function TextView({ tb, tc, env, scale = 1, prompt, ph, fallbackColor }: TextViewProps): ReactNode {
  const doc = prompt ?? docNode0(tb?.doc);
  const nums = numberParas(doc, tc);
  const paras: ReactNode[] = [];
  let first = true;
  doc.forEach((para, _off, pi) => {
    const { lvl, pp, baseR } = effectiveParaProps(tc, para);
    const info = paraInfo(pp, baseR, para, first, nums[pi], env, scale, ph, !!prompt);
    first = false;
    const kids: ReactNode[] = [];
    if (info.bullet) kids.push(<span key="b" className="sl-bullet" style={info.bullet.style}>{info.bullet.text}</span>);
    let ki = 0;
    para.forEach((c) => {
      const key = ki++;
      if (c.type.name === 'hard_break') {
        kids.push(<br key={key} />);
        return;
      }
      const raw = c.type.name === 'text' ? (c.marks.find((m) => m.type.name === 'run')?.attrs.r as RunProps | undefined) : (c.attrs.r as RunProps | undefined);
      const r = mergeR(baseR, raw);
      if (fallbackColor && !r.color) r.color = fallbackColor;
      const st = runStyle(r, env, scale, ph);
      if (c.type.name === 'field') {
        const t = c.attrs.ftype as string;
        const text = t === 'slidenum' ? String(env.slideNumber) : /^datetime/.test(t) ? new Date().toLocaleDateString(undefined, t === 'datetime1' ? undefined : { dateStyle: 'long' }) : (c.attrs.text as string);
        kids.push(<span key={key} style={st}>{text}</span>);
        return;
      }
      const pieces = (c.text ?? '').split('\t');
      const content: ReactNode[] = [];
      pieces.forEach((pc, i) => {
        if (i > 0) content.push(<span key={`t${i}`} className="sl-tab" style={{ display: 'inline-block', whiteSpace: 'pre', width: tabWidth(pp, pp.marL ?? 0, pp.indent ?? 0) }} />);
        if (pc) content.push(pc);
      });
      const link = r.hlink;
      if (link) {
        const hl = env.chain.theme.colors.hlink;
        kids.push(
          <a key={key} style={{ ...st, color: st.color ?? hl, textDecoration: 'underline', cursor: 'pointer' }} href={link.url ?? '#'} onClick={(e) => (e.preventDefault(), env.onLink?.(link))} title={link.tooltip}>
            {content}
          </a>,
        );
      } else kids.push(<span key={key} style={st}>{content}</span>);
    });
    if (para.content.size === 0) kids.push(<span key="e" style={{ fontSize: fs(info.size) }}>{'​'}</span>);
    paras.push(
      <div key={pi} className="sl-p" data-lvl={lvl} style={info.style}>
        {kids}
      </div>,
    );
  });
  return paras;
}

import { docNode as docNode0 } from '@suitenova/slides-core';
