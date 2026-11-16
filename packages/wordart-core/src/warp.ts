import { Curve, subdivide } from './geometry';
import type { TextBlock } from './layout';
import { warpGeometry } from './warpdefs';
import type { Contour, Pt } from './types';

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Orienta la curva de izquierda a derecha (las definiciones no siempre la dibujan en ese sentido). */
function leftToRight(c: Curve): Curve {
  const a = c.pts[0]!;
  const b = c.pts[c.pts.length - 1]!;
  return a.x > b.x + 1e-6 ? c.reversed() : c;
}

/**
 * Deforma el texto compuesto según una transformación de Office, para una forma de `w` x `h` px.
 * - **Envolvente** (la mayoría): el bloque de texto se estira entre la curva superior y la inferior (como WordArt: llena la forma).
 * - **Trayectoria** (arco arriba/abajo, círculo, botón): el texto recorre la curva a lo ancho de su longitud, con las letras sobre
 *   la línea base y giradas con la curva.
 * Devuelve los contornos deformados (polígonos) en las coordenadas de la forma, o `null` si la transformación no existe.
 */
export function warpText(block: TextBlock, prst: string, w: number, h: number, adj: Record<string, number> = {}): Contour[] | null {
  const g = warpGeometry(prst, w, h, adj);
  if (!g || !g.curves.length) return null;
  const bw = Math.max(1e-6, block.width);
  const bh = Math.max(1e-6, block.height);
  // los lados largos se parten: una recta del dibujo de la letra debe curvarse con la deformación
  const flat = block.contours.map((c) => subdivide(c, Math.max(1.5, bh / 40)));
  if (g.mode === 'path') {
    const curve = leftToRight(g.curves[0]!);
    const base = block.lines[0]?.baseline ?? bh;
    const hang = prst !== 'textArchDown';
    return flat.map((c) =>
      c.map((p): Pt => {
        const t = p.x / bw;
        const o = curve.atExtended(t);
        const tg = curve.tangent(clamp01(t));
        // la normal «hacia arriba» de la letra: la dirección de la curva girada un cuarto de vuelta (y hacia abajo en pantalla)
        // arco hacia abajo: la línea base va sobre la curva y las letras suben hacia el centro; en las demás (arco hacia arriba, círculo,
        // botón) la curva es el borde de arriba de las letras, que cuelgan hacia dentro y así el texto queda dentro de la forma
        const d = hang ? -p.y : base - p.y;
        return { x: o.x + tg.y * d, y: o.y - tg.x * d };
      }),
    );
  }
  let top = leftToRight(g.curves[0]!);
  let bottom = g.curves[1] ?? top;
  // la curva inferior se orienta como la superior (por los extremos más cercanos)
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  const same = dist(top.pts[0]!, bottom.pts[0]!) + dist(top.pts[top.pts.length - 1]!, bottom.pts[bottom.pts.length - 1]!);
  const rev = dist(top.pts[0]!, bottom.pts[bottom.pts.length - 1]!) + dist(top.pts[top.pts.length - 1]!, bottom.pts[0]!);
  if (rev < same) bottom = bottom.reversed();
  // el texto no debe salir reflejado: de la curva superior a la inferior hay que ir «hacia abajo» respecto de la marcha del texto
  {
    const m = 0.5;
    const tg = top.tangent(m);
    const a = top.at(m);
    const b = bottom.at(m);
    if (tg.x * (b.y - a.y) - tg.y * (b.x - a.x) < 0) [bottom, top] = [top, bottom];
  }
  return flat.map((c) =>
    c.map((p): Pt => {
      const t = p.x / bw;
      const v = p.y / bh;
      const a = top.atExtended(t);
      const b = bottom.atExtended(t);
      return { x: a.x + (b.x - a.x) * v, y: a.y + (b.y - a.y) * v };
    }),
  );
}

/**
 * Coloca el texto compuesto en una forma de `w` x `h` px **sin deformarlo**: centrado en vertical y, en horizontal, según la
 * alineación (el bloque ya trae cada línea alineada dentro de su ancho).
 */
export function placeText(block: TextBlock, w: number, h: number, align: 'left' | 'center' | 'right' = 'center'): Contour[] {
  const dx = align === 'left' ? 0 : align === 'right' ? w - block.width : (w - block.width) / 2;
  const dy = (h - block.height) / 2;
  return block.contours.map((c) => c.map((p): Pt => ({ x: p.x + dx, y: p.y + dy })));
}
