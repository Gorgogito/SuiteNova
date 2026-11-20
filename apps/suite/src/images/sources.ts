// Where a picture can come from besides a file chosen on disk: the clipboard, a screenshot and the icon set.
// Every product turns what these return (a File) into its own picture, so the three behave the same everywhere.
import { t } from '@suitenova/core-ui';
import './messages';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'];

/** What a source reports when the person did not get a picture and a message is due ('' = cancelled, nothing to say). */
export class SourceError extends Error {}

/** The first picture on the system clipboard, or throws a SourceError saying why there is none. */
export async function clipboardImage(): Promise<File> {
  if (!navigator.clipboard?.read) throw new SourceError(t('Este sistema no permite leer el portapapeles desde el programa.'));
  let items: ClipboardItems;
  try {
    items = await navigator.clipboard.read();
  } catch {
    throw new SourceError(t('No se concedió permiso para leer el portapapeles.'));
  }
  for (const it of items) {
    const type = it.types.find((x) => IMAGE_TYPES.includes(x));
    if (type) {
      const blob = await it.getType(type);
      return new File([blob], `${t('Imagen pegada')}.${type === 'image/jpeg' ? 'jpg' : type.slice(6)}`, { type });
    }
  }
  throw new SourceError(t('No hay ninguna imagen en el portapapeles.'));
}

/** Asks which screen, window or tab to take and returns it as a PNG. Cancelling returns null. */
export async function screenshot(): Promise<File | null> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new SourceError(t('Este sistema no permite capturar la pantalla desde el programa.'));
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (e) {
    if ((e as Error).name === 'NotAllowedError' || (e as Error).name === 'AbortError') return null;
    throw new SourceError(t('No se pudo capturar la pantalla.'));
  }
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    await new Promise((r) => setTimeout(r, 250));
    const cv = document.createElement('canvas');
    cv.width = video.videoWidth;
    cv.height = video.videoHeight;
    cv.getContext('2d')!.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((ok) => cv.toBlob(ok, 'image/png'));
    if (!blob) throw new SourceError(t('No se pudo capturar la pantalla.'));
    return new File([blob], `${t('Captura de pantalla')}.png`, { type: 'image/png' });
  } finally {
    stream.getTracks().forEach((tr) => tr.stop());
  }
}

export type IconComponent = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

/** The whole Lucide set (loaded when first needed, since it is large). */
export async function iconSet(): Promise<Record<string, IconComponent>> {
  return (await import('lucide-react') as unknown as { icons: Record<string, IconComponent> }).icons;
}

/** Names of the icons that match a search ("arrow right" finds ArrowRight), at most `max`. */
export function findIcons(all: Record<string, IconComponent>, query: string, max = 150): string[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, '');
  return Object.keys(all).filter((n) => n.toLowerCase().includes(q)).slice(0, max);
}

/** An icon drawn to a square PNG file in the chosen colour. */
export async function iconFile(all: Record<string, IconComponent>, name: string, color: string, size = 512): Promise<File> {
  const svg = renderToStaticMarkup(createElement(all[name]!, { size, color, strokeWidth: 1.75 }));
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    cv.getContext('2d')!.drawImage(img, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((ok) => cv.toBlob(ok, 'image/png'));
    if (!blob) throw new SourceError(t('No se pudo crear el icono.'));
    return new File([blob], `${name.replace(/([a-z0-9])([A-Z])/g, '$1 $2')}.png`, { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
