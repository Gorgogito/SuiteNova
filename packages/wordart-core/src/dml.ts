import type { FxColor, FxFill, WordArtFx } from './render';
import { parseCssColor } from './docx';

/*
 * Marcado de DrawingML (PowerPoint y Excel) para el estilo de un WordArt. Aquí el estilo va en `a:rPr` de cada letra con los elementos
 * normales (`a:ln`, relleno, `a:effectLst`), a diferencia de Word, que usa extensiones `w14:*` (ver `docx.ts`). Unidades del estilo:
 * píxeles; en el archivo, EMU (9525 por píxel).
 */

const EMU = 9525;

const clr = (c: FxColor): string => {
  const { hex, alpha } = parseCssColor(c.color, c.alpha ?? 1);
  return alpha < 0.999 ? `<a:srgbClr val="${hex}"><a:alpha val="${Math.round(alpha * 100000)}"/></a:srgbClr>` : `<a:srgbClr val="${hex}"/>`;
};

/** El relleno como hijo de `a:rPr` (o de `a:ln`). */
export function dmlFill(f: FxFill): string {
  if (f.type === 'none') return '<a:noFill/>';
  if (f.type === 'solid') return `<a:solidFill>${clr(f)}</a:solidFill>`;
  return `<a:gradFill rotWithShape="1"><a:gsLst>${f.stops.map((s) => `<a:gs pos="${Math.round(s.pos * 100000)}">${clr(s)}</a:gs>`).join('')}</a:gsLst><a:lin ang="${Math.round(f.angle * 60000)}" scaled="0"/></a:gradFill>`;
}

/**
 * Los hijos de `a:rPr` del estilo, en el orden del esquema: contorno (`a:ln`), relleno y efectos (`a:effectLst`: resplandor, sombra,
 * reflejo). Solo el contorno, el relleno y los efectos; el tipo de letra y el tamaño los pone quien llama.
 */
export function dmlTextFx(fx: WordArtFx): string {
  let out = '';
  if (fx.outline) out += `<a:ln w="${Math.round(fx.outline.width * EMU)}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill>${clr(fx.outline)}</a:solidFill><a:prstDash val="solid"/><a:round/></a:ln>`;
  out += dmlFill(fx.fill);
  let eff = '';
  if (fx.glow) eff += `<a:glow rad="${Math.round(fx.glow.radius * EMU)}">${clr(fx.glow)}</a:glow>`;
  if (fx.shadow) {
    const s = fx.shadow;
    const dist = Math.hypot(s.dx, s.dy);
    const dir = ((Math.atan2(s.dy, s.dx) * 180) / Math.PI + 360) % 360;
    eff += `<a:outerShdw blurRad="${Math.round(s.blur * EMU)}" dist="${Math.round(dist * EMU)}" dir="${Math.round(dir * 60000)}" algn="tl" rotWithShape="0">${clr(s)}</a:outerShdw>`;
  }
  if (fx.reflection) {
    const r = fx.reflection;
    eff += `<a:reflection blurRad="6350" stA="${Math.round(r.alpha * 100000)}" stPos="0" endA="300" endPos="${Math.round(r.size * 100000)}" dist="${Math.round(r.gap * EMU)}" dir="5400000" sy="-100000" algn="bl" rotWithShape="0"/>`;
  }
  if (eff) out += `<a:effectLst>${eff}</a:effectLst>`;
  return out;
}
