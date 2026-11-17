import katex from 'katex';
import { EQUATION_SIZE } from './render/mathbox';

export { EQUATION_SIZE };

/*
 * Equations. An equation is a box whose content is the formula (`ShapeEl.math`, PowerPoint's `a14:m`), drawn by the engine's own MathML
 * support. The picture made here is only its fallback for programs that do not know equations, and it gives the box its natural size.
 */

export const EQUATION_NAME = 'Ecuación';

const FONT = "'Cambria Math','STIX Two Math','Latin Modern Math',serif";
const SIZE = 32;

/** The MathML of a formula; throws with KaTeX's message when it cannot be read. */
export function mathml(latex: string): string {
  const html = katex.renderToString(latex, { output: 'mathml', displayMode: true, throwOnError: true, strict: 'ignore' });
  const m = /<math[\s\S]*<\/math>/.exec(html);
  if (!m) throw new Error('La fórmula está vacía.');
  return m[0].replace('<math', '<math xmlns="http://www.w3.org/1998/Math/MathML"').replace('xmlns="http://www.w3.org/1998/Math/MathML" xmlns="http://www.w3.org/1998/Math/MathML"', 'xmlns="http://www.w3.org/1998/Math/MathML"');
}

/** Draws the formula to a transparent PNG; `w` and `h` are the size in points the formula takes at `size` pt. */
export async function renderEquation(latex: string, color = '#000000', size = EQUATION_SIZE): Promise<{ bytes: Uint8Array; w: number; h: number }> {
  const ml = mathml(latex);
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-9999px;top:0;font:${SIZE}px ${FONT};display:inline-block;padding:6px;color:${color}`;
  host.innerHTML = ml;
  document.body.appendChild(host);
  await document.fonts?.ready;
  const r = host.getBoundingClientRect();
  const w = Math.ceil(r.width);
  const h = Math.ceil(r.height);
  host.remove();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="font:${SIZE}px ${FONT};display:inline-block;padding:6px;color:${color}">${ml}</div></foreignObject></svg>`;
  const img = new Image();
  const loaded = new Promise<void>((ok, bad) => {
    img.onload = () => ok();
    img.onerror = () => bad(new Error('No se pudo dibujar la fórmula.'));
  });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;
  const k = 3;
  const canvas = document.createElement('canvas');
  canvas.width = w * k;
  canvas.height = h * k;
  const g = canvas.getContext('2d')!;
  g.scale(k, k);
  g.drawImage(img, 0, 0, w, h);
  const blob: Blob = await new Promise((ok, bad) => canvas.toBlob((b) => (b ? ok(b) : bad(new Error('No se pudo crear la imagen.'))), 'image/png'));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: (w * size) / SIZE, h: (h * size) / SIZE };
}

export const EQUATION_EXAMPLES: { name: string; latex: string }[] = [
  { name: 'Fracción', latex: '\\frac{a+b}{c}' },
  { name: 'Raíz', latex: '\\sqrt{x^2+y^2}' },
  { name: 'Fórmula cuadrática', latex: 'x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}' },
  { name: 'Suma', latex: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}' },
  { name: 'Integral', latex: '\\int_{0}^{\\infty} e^{-x^2}\\,dx=\\frac{\\sqrt{\\pi}}{2}' },
  { name: 'Límite', latex: '\\lim_{x\\to 0}\\frac{\\sin x}{x}=1' },
  { name: 'Matriz', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
  { name: 'Teorema de Pitágoras', latex: 'a^2+b^2=c^2' },
];
