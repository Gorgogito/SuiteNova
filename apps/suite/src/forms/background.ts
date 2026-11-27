import { isSafeImage } from '@suitenova/forms-core';

/** The longest side of a background picture, in dots. */
const SIDE = 1600;
const MAX_FILE = 20 * 1024 * 1024;

/** A background made from an image: small enough to travel inside every page of the form. */
export async function backgroundFrom(file: Blob): Promise<string> {
  if (file.size > MAX_FILE) throw new Error('La imagen es demasiado grande.');
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new Error('El archivo no es una imagen que se pueda usar.');
  }
  const scale = Math.min(1, SIDE / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const g = canvas.getContext('2d')!;
  // what is transparent would turn black in a JPEG
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  for (const quality of [0.82, 0.65, 0.45]) {
    const out = canvas.toDataURL('image/jpeg', quality);
    if (isSafeImage(out)) return out;
  }
  throw new Error('La imagen es demasiado grande.');
}
