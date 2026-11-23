import type { OutgoingAttachment } from '@suitenova/mail-core';
import { applyPixelEdits, cropPixels, isCropped, normalizePixelEdits, visibleRect, type Crop, type FrameEdits, type PixelEdits, type Pixels } from '@suitenova/image-core';
import { canvasFromPixels, decodePixels, encode } from '../images/canvas';
import type { PictureHost } from '../images/host';
import { tableHtml, usedTables, type ComposeTable } from './tables';

/*
 * Pictures in the body of a message. The body stays plain text (what everything that reads mail can show); a picture is a token in it,
 * `[Imagen: nombre]`, and goes as an inline image of the HTML part (`cid:`). Mail programs do not draw crops, shapes or effects, so what is
 * sent is the picture with its edits and crop already made; the original and the edits stay in the message being written, where they can
 * be changed or taken off. A saved draft keeps the picture as it was sent (no original).
 */

export interface ComposePicture {
  /** Content-ID of the inline image. */
  id: string;
  /** The name in the body token and the file name. */
  name: string;
  /** The original, as it was added. */
  orig: { mime: string; data: Uint8Array };
  edits?: PixelEdits;
  crop?: Crop;
  /** What is sent: the original with the edits and the crop made (the original itself without them). */
  sent: { mime: string; data: Uint8Array };
  /** Displayed width in px; the height follows the picture. */
  width: number;
  alt: string;
  /** The text read from the original (OCR, `StoredOcr` of the shared OCR, opaque here): only for the person writing, it does not travel in the message. */
  ocr?: unknown;
}

export const tokenOf = (name: string): string => `[Imagen: ${name}]`;
const TOKEN = /\[Imagen: ([^\]\n]+)\]/g;

/** A name for a new picture that no other picture of the message has. */
export function uniqueName(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) if (!taken.includes(`${base} (${i})${ext}`)) return `${base} (${i})${ext}`;
}

/** The picture as it is sent, made from the original. */
export async function makeSent(p: Pick<ComposePicture, 'orig' | 'edits' | 'crop'>): Promise<ComposePicture['sent']> {
  const edits = normalizePixelEdits(p.edits);
  const crop = isCropped(p.crop) ? p.crop : undefined;
  if (!edits && !crop) return p.orig;
  let px: Pixels = await decodePixels(p.orig.data, p.orig.mime);
  if (edits) px = applyPixelEdits(px, edits);
  if (crop) px = cropPixels(px, visibleRect(px.w, px.h, crop));
  return { mime: 'image/png', data: await encode(canvasFromPixels(px), 'image/png') };
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The pictures the body still mentions, in the order it mentions them. */
export const usedPictures = (body: string, pictures: ComposePicture[]): ComposePicture[] => {
  const out: ComposePicture[] = [];
  for (const m of body.matchAll(TOKEN)) {
    const p = pictures.find((x) => x.name === m[1]);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
};

/** The HTML part: the text with its line breaks, every picture token turned into its inline image and every table token into its table; null when none is used. */
export function htmlBody(body: string, pictures: ComposePicture[], tables: ComposeTable[] = [], decimal?: '.' | ','): { html: string; inline: OutgoingAttachment[] } | null {
  const used = usedPictures(body, pictures);
  if (!used.length && !usedTables(body, tables).length) return null;
  let html = '';
  let last = 0;
  const br = (s: string): string => esc(s).replace(/\r?\n/g, '<br>\n');
  for (const m of body.matchAll(/\[(Imagen|Tabla): ([^\]\n]+)\]/g)) {
    html += br(body.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] === 'Imagen') {
      const p = pictures.find((x) => x.name === m[2]);
      html += p ? `<img src="cid:${p.id}" alt="${esc(p.alt)}" width="${Math.round(p.width)}" style="max-width:100%;height:auto">` : esc(m[0]);
    } else {
      const t = tables.find((x) => x.name === m[2]);
      html += t ? tableHtml(t, decimal) : esc(m[0]);
    }
  }
  html += br(body.slice(last));
  const inline = used.map((p) => ({ filename: p.name, contentType: p.sent.mime, data: p.sent.data, contentId: p.id }));
  return { html: `<div>${html}</div>`, inline };
}

/**
 * Pictures of a draft that is opened again: its inline images become pictures (as they were sent, with no original) and the tokens of
 * the text point to them by name.
 */
export function picturesOfDraft(html: string | null, inline: { cid?: string; filename: string; contentType: string; data: Uint8Array }[]): ComposePicture[] {
  if (!html) return [];
  const out: ComposePicture[] = [];
  for (const a of inline) {
    if (!a.cid || !html.includes(`cid:${a.cid}`)) continue;
    const tag = new RegExp(`<img[^>]*cid:${a.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^>]*>`, 'i').exec(html)?.[0] ?? '';
    const width = Number(/width="?(\d+)/i.exec(tag)?.[1]) || 320;
    const alt = /alt="([^"]*)"/i.exec(tag)?.[1] ?? '';
    const sent = { mime: a.contentType, data: a.data };
    out.push({ id: a.cid, name: a.filename, orig: sent, sent, width, alt: alt.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') });
  }
  return out;
}

/** The picture tools' view of a picture being written; `get` reads the picture as it is now and `set` replaces it. */
export function mailPictureHost(get: () => ComposePicture | undefined, set: (p: ComposePicture) => void): PictureHost {
  const origPixels = async (): Promise<Pixels | null> => {
    const p = get();
    return p ? decodePixels(p.orig.data, p.orig.mime) : null;
  };
  return {
    count: () => (get() ? 1 : 0),
    pixelEdits: () => get()?.edits ?? {},
    setPixelEdits: async (next) => {
      const p = get();
      if (!p) return;
      const edits = normalizePixelEdits(next);
      const made: ComposePicture = { ...p, edits };
      made.sent = await makeSent(made);
      // the picture may have been taken off or changed while it was being made
      if (get()?.id === p.id) set(made);
    },
    frame: () => {
      const p = get();
      const f: FrameEdits = {};
      if (p?.crop) f.crop = p.crop;
      return f;
    },
    setFrame: async (next) => {
      const p = get();
      if (!p) return;
      const made: ComposePicture = { ...p, crop: isCropped(next.crop) ? next.crop : undefined };
      made.sent = await makeSent(made);
      if (get()?.id === p.id) set(made);
    },
    original: origPixels,
    naturalSize: async () => {
      const px = await origPixels();
      return px ? { w: px.w, h: px.h } : null;
    },
    accent: () => '#4472c4',
  };
}
