/**
 * The key of a picture for the text read from it: its content, so the same picture in two places (or copied) is read once, and a picture that
 * is changed is read again. SHA-256 of the bytes, in hex.
 */
export async function imageKey(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The key of a reading: the picture, the language and the part read (the same picture read in another language is another reading). */
export const readingKey = (image: string, lang: string, zone?: { x: number; y: number; w: number; h: number }): string =>
  `${image}:${lang}${zone ? `:${Math.round(zone.x)},${Math.round(zone.y)},${Math.round(zone.w)},${Math.round(zone.h)}` : ''}`;
