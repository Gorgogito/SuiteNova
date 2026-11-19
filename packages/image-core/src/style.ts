import type { FrameEdits } from './edits';

/** The gallery of «Estilos de imagen»: the frame edits (shape, border, effects) that give each look. The picture's crop is never part of a style. */
export interface PictureStyle {
  id: string;
  name: string;
  frame: Pick<FrameEdits, 'shape' | 'border' | 'fx'>;
}

const shadow = { color: '#000000', blur: 5, dist: 3, angle: 45, alpha: 0.4 };

export const PICTURE_STYLES: PictureStyle[] = [
  { id: 'plain', name: 'Sin estilo', frame: {} },
  { id: 'simple-white', name: 'Marco blanco sencillo', frame: { border: { color: '#ffffff', width: 7.5 }, fx: { shadow } } },
  { id: 'simple-black', name: 'Marco negro sencillo', frame: { border: { color: '#000000', width: 6 } } },
  { id: 'thin', name: 'Marco fino', frame: { border: { color: '#595959', width: 1 } } },
  { id: 'shadow', name: 'Rectángulo con sombra', frame: { fx: { shadow: { ...shadow, blur: 8, dist: 5 } } } },
  { id: 'rounded', name: 'Rectángulo redondeado', frame: { shape: 'roundRect' } },
  { id: 'rounded-white', name: 'Redondeado con marco blanco', frame: { shape: 'roundRect', border: { color: '#ffffff', width: 6 }, fx: { shadow } } },
  { id: 'oval', name: 'Óvalo con borde', frame: { shape: 'ellipse', border: { color: '#ffffff', width: 5 }, fx: { shadow } } },
  { id: 'reflected', name: 'Reflejado', frame: { fx: { reflection: { size: 50, alpha: 0.5, dist: 0 } } } },
  { id: 'reflected-rounded', name: 'Redondeado y reflejado', frame: { shape: 'roundRect', fx: { reflection: { size: 50, alpha: 0.5, dist: 0 } } } },
  { id: 'soft-edge', name: 'Bordes suaves', frame: { fx: { softEdge: 10 } } },
  { id: 'glow', name: 'Resplandor', frame: { fx: { glow: { color: '#4472c4', radius: 10, alpha: 0.6 } } } },
  { id: 'dashed', name: 'Borde de guiones', frame: { border: { color: '#4472c4', width: 3, dash: 'dash' } } },
];

export const styleById = (id: string): PictureStyle | undefined => PICTURE_STYLES.find((s) => s.id === id);

/** Frame edits with the style on: shape, border and effects are the style's (what the style leaves out is cleared); the crop stays. */
export function applyStyle(frame: FrameEdits | undefined, style: PictureStyle): FrameEdits {
  return { ...(frame?.crop ? { crop: frame.crop } : {}), ...style.frame };
}
