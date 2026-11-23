import { iconSvg, svgDataUri, type IconInfo, type IconStyle, type PathsFile, iconPaths } from '@suitenova/icon-core';

/** An icon chosen in the gallery, ready to insert: as SVG (what the document shows) and as PNG (the fallback that goes in the file next to it). */
export interface IconPick {
  id: string;
  /** Name shown to the person (it is the alternative text). */
  name: string;
  /** SVG data URI. */
  svg: string;
  /** PNG data URI of the same picture. */
  png: string;
  /** Side of the square in px when it is inserted. */
  size: number;
  color: string;
  style: IconStyle;
}

/** The SVG drawn to a square PNG (data URI) of `px` pixels, transparent background. */
export async function svgToPng(svg: string, px = 256): Promise<string> {
  const img = new Image();
  img.src = svgDataUri(svg);
  await img.decode();
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  cv.getContext('2d')!.drawImage(img, 0, 0, px, px);
  return cv.toDataURL('image/png');
}

/** The icon in the colour and style chosen, as the pair SVG + PNG. */
export async function makeIconPick(paths: PathsFile, info: IconInfo, name: string, style: IconStyle, color: string, size = 64): Promise<IconPick> {
  const got = iconPaths(paths, info, style);
  if (!got) throw new Error(`Icono desconocido: ${info.id}`);
  const svg = iconSvg(got.d, info.size, { color, px: size });
  return { id: info.id, name, svg: svgDataUri(svg), png: await svgToPng(iconSvg(got.d, info.size, { color, px: 256 }), 256), size, color, style: got.style };
}

/** The PNG of a pick as a file (for the products that still take pictures only). */
export async function pickFile(p: IconPick): Promise<File> {
  const blob = await (await fetch(p.png)).blob();
  return new File([blob], `${p.name}.png`, { type: 'image/png' });
}

/** The bytes of a base64 data URI. */
export function uriBytes(uri: string): Uint8Array {
  return Uint8Array.from(atob(uri.slice(uri.indexOf(',') + 1)), (c) => c.charCodeAt(0));
}
