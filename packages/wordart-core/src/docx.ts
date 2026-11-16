import { avLstXml } from '@suitenova/shapes-core';
import type { FxColor, FxFill, WordArtFx } from './render';

/*
 * Marcado de Word (DOCX) para WordArt. La transformación es la misma de DrawingML (`a:prstTxWarp` dentro de `wps:bodyPr`), pero el estilo
 * del texto (relleno, contorno, sombra, resplandor, reflejo) lo guarda Word en **extensiones de Word 2010** (`w14:*`) dentro de `w:rPr`
 * de cada letra, no con `a:solidFill`/`a:ln` como PowerPoint. Las unidades del estilo son píxeles; en el archivo, EMU (9525 por píxel).
 */

const EMU = 9525;
const hex2 = (n: number) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, '0');

/** Un color css (`#rgb`, `#rrggbb` o `rgb()/rgba()`) como `RRGGBB` y opacidad de 0 a 1. */
export function parseCssColor(css: string, alpha = 1): { hex: string; alpha: number } {
  const s = css.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return { hex: m[1]!.toUpperCase(), alpha };
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m) return { hex: `${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toUpperCase(), alpha };
  m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)$/i.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { hex: `${hex2(+m[1]!)}${hex2(+m[2]!)}${hex2(+m[3]!)}`.toUpperCase(), alpha: alpha * a };
  }
  return { hex: '000000', alpha };
}

const clr = (c: FxColor): string => {
  const { hex, alpha } = parseCssColor(c.color, c.alpha ?? 1);
  return alpha < 0.999 ? `<w14:srgbClr w14:val="${hex}"><w14:alpha w14:val="${Math.round(alpha * 100000)}"/></w14:srgbClr>` : `<w14:srgbClr w14:val="${hex}"/>`;
};

const fillXml = (f: FxFill): string => {
  if (f.type === 'none') return '<w14:noFill/>';
  if (f.type === 'solid') return `<w14:solidFill>${clr(f)}</w14:solidFill>`;
  return `<w14:gradFill><w14:gsLst>${f.stops.map((s) => `<w14:gs w14:pos="${Math.round(s.pos * 100000)}">${clr(s)}</w14:gs>`).join('')}</w14:gsLst><w14:lin w14:ang="${Math.round(f.angle * 60000)}" w14:scaled="0"/></w14:gradFill>`;
};

/** Los elementos `w14:*` del estilo, en el orden del esquema (resplandor, sombra, reflejo, contorno, relleno), para ir al final de `w:rPr`. */
export function w14Fx(fx: WordArtFx): string {
  let out = '';
  if (fx.glow) out += `<w14:glow w14:rad="${Math.round(fx.glow.radius * EMU)}">${clr(fx.glow)}</w14:glow>`;
  if (fx.shadow) {
    const s = fx.shadow;
    const dist = Math.hypot(s.dx, s.dy);
    const dir = ((Math.atan2(s.dy, s.dx) * 180) / Math.PI + 360) % 360;
    out += `<w14:shadow w14:blurRad="${Math.round(s.blur * EMU)}" w14:dist="${Math.round(dist * EMU)}" w14:dir="${Math.round(dir * 60000)}" w14:sx="100000" w14:sy="100000" w14:kx="0" w14:ky="0" w14:algn="tl">${clr(s)}</w14:shadow>`;
  }
  if (fx.reflection) {
    const r = fx.reflection;
    out += `<w14:reflection w14:blurRad="6350" w14:stA="${Math.round(r.alpha * 100000)}" w14:stPos="0" w14:endA="300" w14:endPos="${Math.round(r.size * 100000)}" w14:dist="${Math.round(r.gap * EMU)}" w14:dir="5400000" w14:fadeDir="5400000" w14:sx="100000" w14:sy="-100000" w14:kx="0" w14:ky="0" w14:algn="bl"/>`;
  }
  if (fx.outline) out += `<w14:textOutline w14:w="${Math.round(fx.outline.width * EMU)}" w14:cap="flat" w14:cmpd="sng" w14:algn="ctr"><w14:solidFill>${clr(fx.outline)}</w14:solidFill><w14:prstDash w14:val="solid"/><w14:round/></w14:textOutline>`;
  out += `<w14:textFill>${fillXml(fx.fill)}</w14:textFill>`;
  return out;
}

/** `<a:prstTxWarp>` de `wps:bodyPr` (va antes del autoajuste). */
export function prstTxWarpXml(prst: string, adj?: Record<string, number>): string {
  return `<a:prstTxWarp prst="${prst}">${avLstXml(adj)}</a:prstTxWarp>`;
}

/** Los valores de un `w14:*` a unidades del estilo. */
export const emuToPx = (emu: number): number => emu / EMU;
