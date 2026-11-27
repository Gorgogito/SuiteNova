import type { Contact } from '@suitenova/mail-core';

/** The longest side of the picture of a contact, in dots. */
const SIDE = 256;
/** A picture longer than this is made smaller when it comes in a file. */
const LARGE = 150_000;
const MAX_FILE = 20 * 1024 * 1024;

/** The picture of a contact made from an image: small enough to travel with the mailbox. */
export async function photoFrom(blob: Blob): Promise<string> {
  if (blob.size > MAX_FILE) throw new Error('La imagen es demasiado grande.');
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(blob);
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
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** Large pictures of imported contacts, made small. One that cannot be read is left as it came. */
export async function shrinkPhotos(contacts: Contact[]): Promise<Contact[]> {
  const out: Contact[] = [];
  for (const c of contacts) {
    if (!c.photo || c.photo.length <= LARGE) out.push(c);
    else {
      try {
        out.push({ ...c, photo: await photoFrom(await (await fetch(c.photo)).blob()) });
      } catch {
        out.push(c);
      }
    }
  }
  return out;
}
