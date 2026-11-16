import { docNode, levelStyle, mergeR, themeFont, clrCss, type RunProps, type TextBody, type TextContext, type TextWarp } from '@suitenova/slides-core';
import { LocalFontSource, hasWarp, layoutText, warpText, wordArtSvg, type FontLike, type FxColor, type FxFill, type WordArtFx } from '@suitenova/wordart-core';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { TextEnv } from './TextView';

/*
 * Text with a "transform" (WordArt): the text runs along a curve. Arcs, circles, waves and curves are drawn with SVG text on a
 * path; slants are drawn with a skew. The remaining warp presets draw the text unwarped.
 */


export function warpPath(prst: string, w: number, h: number, adj: Record<string, number> | undefined): { d: string; up: boolean } | null {
  const a = (adj?.adj ?? 10800000) / 60000;
  switch (prst) {
    case 'textArchUp':
    case 'textArchUpPour': {
      const r = Math.min(w, h * 2) / 2;
      return { d: `M${w / 2 - r} ${h}A${r} ${r} 0 0 1 ${w / 2 + r} ${h}`, up: true };
    }
    case 'textArchDown':
    case 'textArchDownPour': {
      const r = Math.min(w, h * 2) / 2;
      return { d: `M${w / 2 - r} 0A${r} ${r} 0 0 0 ${w / 2 + r} 0`, up: false };
    }
    case 'textCircle':
    case 'textCirclePour':
    case 'textButton':
    case 'textButtonPour': {
      const r = Math.min(w, h) / 2;
      void a;
      return { d: `M${w / 2 - r} ${h / 2}A${r} ${r} 0 1 1 ${w / 2 + r} ${h / 2}A${r} ${r} 0 1 1 ${w / 2 - r} ${h / 2}`, up: true };
    }
    case 'textWave1':
    case 'textWave2':
    case 'textDoubleWave1':
      return { d: `M0 ${h / 2}C${w / 4} ${h * 0.1} ${w / 4} ${h * 0.1} ${w / 2} ${h / 2}S${(w * 3) / 4} ${h * 0.9} ${w} ${h / 2}`, up: true };
    case 'textCurveUp':
    case 'textCanUp':
      return { d: `M0 ${h * 0.8}Q${w / 2} ${h * 0.1} ${w} ${h * 0.8}`, up: true };
    case 'textCurveDown':
    case 'textCanDown':
      return { d: `M0 ${h * 0.2}Q${w / 2} ${h * 0.9} ${w} ${h * 0.2}`, up: true };
    default:
      return null;
  }
}

/** Las fuentes del sistema se piden una sola vez por página; si el navegador no las deja leer, se dibuja con trayectorias (más abajo). */
const fonts = new LocalFontSource();

/** El texto de un cuadro con transformación, por párrafos, con las propiedades de la primera letra de cada uno. */
function warpLines(text: TextBody | undefined, tc: TextContext): { text: string; r: RunProps }[] {
  const doc = docNode(text?.doc);
  const lines: { text: string; r: RunProps }[] = [];
  doc.forEach((para) => {
    const ls = levelStyle(tc, para.attrs.lvl);
    let t = '';
    let r: RunProps = ls.rPr;
    para.forEach((c) => {
      if (c.type.name === 'text') {
        t += c.text;
        const m = c.marks.find((x) => x.type.name === 'run')?.attrs.r as RunProps | undefined;
        r = mergeR(r, m);
      }
    });
    lines.push({ text: t, r });
  });
  return lines;
}

/** El estilo de texto de una letra de Slides (relleno, contorno y efectos) en el modelo neutral del motor. */
function toFx(r: RunProps, env: TextEnv): WordArtFx {
  const fx = r.fx;
  const col = (c: Parameters<typeof clrCss>[0]): FxColor => ({ color: clrCss(c, env.cc), alpha: 1 });
  let fill: FxFill;
  if (fx?.fill?.t === 'none') fill = { type: 'none' };
  else if (fx?.fill?.t === 'grad') fill = { type: 'gradient', angle: fx.fill.lin?.ang ?? 90, stops: [...fx.fill.stops].sort((a, b) => a.pos - b.pos).map((s) => ({ pos: s.pos / 100000, ...col(s.c) })) };
  else if (fx?.fill?.t === 'solid') fill = { type: 'solid', ...col(fx.fill.c) };
  else fill = { type: 'solid', ...(r.color ? col(r.color) : { color: '#000000' }) };
  const out: WordArtFx = { fill };
  if (fx?.ln?.fill?.t === 'solid' && (fx.ln.w ?? 0) > 0) out.outline = { ...col(fx.ln.fill.c), width: fx.ln.w ?? 1 };
  const e = fx?.effects;
  if (e?.outer) out.shadow = { ...col(e.outer.c), blur: e.outer.blur, dx: e.outer.dist * Math.cos((e.outer.dir * Math.PI) / 180), dy: e.outer.dist * Math.sin((e.outer.dir * Math.PI) / 180) };
  if (e?.glow) out.glow = { ...col(e.glow.c), radius: e.glow.rad };
  if (e?.reflection) out.reflection = { alpha: e.reflection.stA / 100 || 0.5, size: Math.max(0.05, e.reflection.endPos / 100), gap: e.reflection.dist };
  return out;
}

/**
 * Texto con transformación. Con la fuente del sistema disponible se deforman **los contornos de las letras** (como Office, motor
 * `wordart-core`); si no, o si la transformación no está en la norma, se dibuja con texto sobre trayectoria (`PathWarpedText`).
 */
export function WarpedText(props: { warp: TextWarp; width: number; height: number; text: TextBody | undefined; tc: TextContext; env: TextEnv }): ReactNode {
  const { warp, width, height, text, tc, env } = props;
  const lines = warpLines(text, tc);
  const first = lines[0]?.r;
  const family = themeFont(env.chain.theme, first?.latin) ?? 'Calibri';
  const bold = !!first?.b;
  const italic = !!first?.i;
  const engine = hasWarp(warp.prst);
  const [font, setFont] = useState<FontLike | null>(null);
  useEffect(() => {
    let live = true;
    if (!engine) return;
    void fonts.load(family, bold, italic).then((f) => live && setFont(f));
    return () => {
      live = false;
    };
  }, [engine, family, bold, italic]);
  const joined = lines.map((l) => l.text).join('\n');
  const size = Math.max(...lines.map((l) => l.r.sz ?? 18), 10);
  const adjKey = JSON.stringify(warp.adj ?? {});
  const svg = useMemo(() => {
    if (!font || !engine || !joined.trim() || width < 4 || height < 4) return null;
    const block = layoutText(joined, font, { size, align: 'center' });
    const out = warpText(block, warp.prst, width, height, warp.adj);
    return out && first ? wordArtSvg(out, toFx(first, env), `wa${Math.abs(hash(joined + warp.prst + adjKey))}`) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [font, engine, joined, size, width, height, warp.prst, adjKey, first, env]);
  if (svg) return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible', display: 'block' }} dangerouslySetInnerHTML={{ __html: svg }} />;
  return <PathWarpedText {...props} />;
}

/** Respaldo: el texto recorre una curva (aproximado: no deforma las letras). */
export function PathWarpedText({ warp, width, height, text, tc, env }: { warp: TextWarp; width: number; height: number; text: TextBody | undefined; tc: TextContext; env: TextEnv }): ReactNode {
  const doc = docNode(text?.doc);
  const lines: { text: string; r: RunProps }[] = [];
  doc.forEach((para) => {
    const ls = levelStyle(tc, para.attrs.lvl);
    let t = '';
    let r: RunProps = ls.rPr;
    para.forEach((c) => {
      if (c.type.name === 'text') {
        t += c.text;
        const m = c.marks.find((x) => x.type.name === 'run')?.attrs.r as RunProps | undefined;
        r = mergeR(r, m);
      }
    });
    lines.push({ text: t, r });
  });
  const p = warpPath(warp.prst, width, height, warp.adj);
  const uid = `wp${Math.abs(hash(JSON.stringify(warp) + lines.map((l) => l.text).join('|')))}`;
  const size = Math.max(...lines.map((l) => l.r.sz ?? 18), 10);
  const slant = warp.prst === 'textSlantUp' ? -12 : warp.prst === 'textSlantDown' ? 12 : 0;
  const first = lines[0]?.r;
  const fxs = first?.fx;
  const gradFill = fxs?.fill?.t === 'grad' ? fxs.fill : undefined;
  const gid = `${uid}g`;
  const mid = `${uid}m`;
  const eff = fxs?.effects;
  const filters: string[] = [];
  if (eff?.outer) {
    const o = eff.outer;
    filters.push(`drop-shadow(${(o.dist * Math.cos((o.dir * Math.PI) / 180)).toFixed(2)}px ${(o.dist * Math.sin((o.dir * Math.PI) / 180)).toFixed(2)}px ${(o.blur / 2).toFixed(2)}px ${clrCss(o.c, env.cc)})`);
  }
  if (eff?.glow) filters.push(`drop-shadow(0 0 ${eff.glow.rad / 2}px ${clrCss(eff.glow.c, env.cc)})`);
  const refl = eff?.reflection;
  const rows = (flip: boolean) =>
    lines.map((l, i) => {
      const style = {
        fontFamily: `"${themeFont(env.chain.theme, l.r.latin) ?? 'Calibri'}", sans-serif`,
        fontSize: l.r.sz ?? 18,
        fontWeight: l.r.b ? 700 : 400,
        fontStyle: l.r.i ? ('italic' as const) : ('normal' as const),
      };
      const f = l.r.fx?.fill;
      const fill = f?.t === 'none' ? 'none' : gradFill && i >= 0 ? `url(#${gid})` : f?.t === 'solid' ? clrCss(f.c, env.cc) : l.r.color ? clrCss(l.r.color, env.cc) : '#000';
      const ln = l.r.fx?.ln;
      const stroke = ln?.fill?.t === 'solid' ? clrCss(ln.fill.c, env.cc) : undefined;
      const common = { ...style, fill, stroke, strokeWidth: ln?.w, textAnchor: 'middle' as const };
      if (p)
        return (
          <text key={`${flip}${i}`} {...common} dy={i * size * 1.2}>
            <textPath href={`#${uid}`} startOffset="50%">
              {l.text}
            </textPath>
          </text>
        );
      return (
        <text key={`${flip}${i}`} {...common} x={width / 2} y={size + i * size * 1.2} transform={slant ? `skewY(${slant})` : undefined}>
          {l.text}
        </text>
      );
    });
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible', display: 'block', filter: filters.length ? filters.join(' ') : undefined }}>
      <defs>
        {p && <path id={uid} d={p.d} />}
        {gradFill && (
          <linearGradient id={gid} gradientTransform={`rotate(${gradFill.lin?.ang ?? 90} .5 .5)`}>
            {[...gradFill.stops].sort((a, b) => a.pos - b.pos).map((s, i) => <stop key={i} offset={`${s.pos / 1000}%`} stopColor={clrCss(s.c, env.cc)} />)}
          </linearGradient>
        )}
        {refl && (
          <>
            <linearGradient id={`${mid}g`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity={refl.stA / 100 || 0.5} />
              <stop offset={`${Math.max(5, refl.endPos)}%`} stopColor="#fff" stopOpacity={0} />
            </linearGradient>
            <mask id={mid} maskUnits="userSpaceOnUse" x={-width} y={0} width={width * 3} height={height * 2}>
              <rect x={-width} y={0} width={width * 3} height={height} fill={`url(#${mid}g)`} />
            </mask>
          </>
        )}
      </defs>
      {rows(false)}
      {refl && (
        <g mask={`url(#${mid})`} transform={`translate(0 ${height * 2}) scale(1 -1)`}>
          {rows(true)}
        </g>
      )}
    </svg>
  );
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
