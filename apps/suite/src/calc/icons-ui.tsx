import { parseIconSvg, restyleSvg, type GraphicFx, type IconLook } from '@suitenova/icon-core';
import type { SheetImage } from '@suitenova/calc-engine';
import { GraphicEffectsItems, GraphicFillItems, GraphicOutlineItems, GraphicStyleItems, type GraphicsHost } from '../icons/GraphicsMenus';
import { svgToPng, uriBytes } from '../icons/raster';
import { PicPopover } from '../images/PicPopover';
import type { CalcDoc } from './doc';
import { selectedPicture } from './pichost';

const dec = new TextDecoder();
const enc = new TextEncoder();

/** The selected picture when it is an icon (it has an SVG and its pixels were not edited). */
export const selectedIcon = (doc: CalcDoc): SheetImage | undefined => {
  const im = selectedPicture(doc);
  return im && im.svg && !im.edits && doc.wb.media.has(im.svg) ? im : undefined;
};

const svgOf = (doc: CalcDoc, im: SheetImage): string | null => {
  const m = im.svg ? doc.wb.media.get(im.svg) : undefined;
  return m ? dec.decode(m.data) : null;
};

/** What the picture becomes when it is painted another way: a new SVG and the PNG that goes with it. */
async function restylePatch(doc: CalcDoc, im: SheetImage, look: IconLook): Promise<Partial<SheetImage> | null> {
  const svg = svgOf(doc, im);
  const next = svg ? restyleSvg(svg, look) : null;
  if (!next) return null;
  const png = await svgToPng(next.replace(/width="\d+" height="\d+"/, 'width="256" height="256"'), 256);
  return { media: doc.wb.addMedia('image/png', uriBytes(png)), svg: doc.wb.addMedia('image/svg+xml', enc.encode(next)) };
}

const fxOfImage = (im: SheetImage): GraphicFx | null => (im.shadow ? { shadow: im.shadow } : null);

/** Calc's side of the graphics menus: the selected icon; its effect is the shadow of the picture (Excel pictures have no glow here). */
export function calcGraphicsHost(doc: CalcDoc): GraphicsHost {
  return {
    noGlow: true,
    look: () => {
      const im = selectedIcon(doc);
      const svg = im && svgOf(doc, im);
      const p = svg ? parseIconSvg(svg) : null;
      return p ? { fill: p.fill, opacity: p.opacity, stroke: p.stroke } : null;
    },
    setLook: async (look, label) => {
      const im = selectedIcon(doc);
      const patch = im && (await restylePatch(doc, im, look));
      if (im && patch) doc.x.updateImage(im.id, patch, label);
    },
    fx: () => {
      const im = selectedPicture(doc);
      return im ? fxOfImage(im) : null;
    },
    setFx: (fx, label) => {
      const im = selectedPicture(doc);
      if (im) doc.x.updateImage(im.id, { shadow: fx?.shadow }, label);
    },
    setStyle: async (look, fx, label) => {
      const im = selectedIcon(doc);
      const patch = im && (await restylePatch(doc, im, look));
      if (im && patch) doc.x.updateImage(im.id, { ...patch, shadow: fx?.shadow }, label);
    },
  };
}

/** The ribbon buttons of the Graphics group (Excel's «Formato de gráficos»): styles, fill, outline and the shadow. */
export const graphicsItems = (doc: CalcDoc) => {
  const off = () => !selectedIcon(doc);
  return [
    { kind: 'custom' as const, id: 'gfxStyles', label: 'Estilos de gráfico', keytip: 'GS', render: () => <PicPopover label="Estilos de gráfico" icon="sparkles" size="small" iconOnly disabled={off()}>{(close) => <GraphicStyleItems host={calcGraphicsHost(doc)} close={close} />}</PicPopover> },
    { kind: 'custom' as const, id: 'gfxFill', label: 'Relleno de gráfico', keytip: 'GF', render: () => <PicPopover label="Relleno de gráfico" icon="palette" size="small" iconOnly disabled={off()}>{(close) => <GraphicFillItems host={calcGraphicsHost(doc)} close={close} />}</PicPopover> },
    { kind: 'custom' as const, id: 'gfxOutline', label: 'Contorno de gráfico', keytip: 'GO', render: () => <PicPopover label="Contorno de gráfico" icon="pen" size="small" iconOnly disabled={off()}>{(close) => <GraphicOutlineItems host={calcGraphicsHost(doc)} close={close} />}</PicPopover> },
    { kind: 'custom' as const, id: 'gfxEffects', label: 'Efectos de gráfico', keytip: 'GE', render: () => <PicPopover label="Efectos de gráfico" icon="shadow" size="small" iconOnly disabled={off()}>{(close) => <GraphicEffectsItems host={calcGraphicsHost(doc)} close={close} />}</PicPopover> },
  ];
};
