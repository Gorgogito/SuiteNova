import { encodeBase64, imagePartKey, messageImages, rawOf, setImageReading, type MailRecord, type MessageImage } from '@suitenova/mail-core';
import type { StoredOcr } from '@suitenova/ocr-core';
import { ImageOcrDriver, type ScannedImage } from '../ocr/driver';
import type { MailCtl } from './ctl';

/*
 * The text of the pictures of messages (OCR). A message keeps the readings of its pictures (`MailRecord.ocr`) and a lower-case text of them that the
 * mailbox search also looks in, so searching finds what is written in a picture. Outlook does not search inside pictures; Nova does.
 *
 * Pictures are read in the background for the message that is open, as long as they are not big (a message with a lot of pictures is read when the
 * person asks); «Leer el texto de las imágenes del buzón» reads every message's pictures so that the whole mailbox can be searched. The reading
 * itself (one at a time, with progress, cancelling) is the shared `ImageOcrDriver`.
 */

/** A message whose pictures add up to more than this is not read by itself when it is opened. */
export const AUTO_BYTES = 2_000_000;

export const dataUriOf = (img: Pick<MessageImage, 'mime' | 'data'>): string => `data:${img.mime};base64,${encodeBase64(img.data)}`;

export class MailImageOcr extends ImageOcrDriver {
  private scope: 'selected' | 'all' = 'selected';
  private capped = true;
  private cache = new Map<string, { size: number; images: MessageImage[] }>();

  constructor(private ctl: MailCtl) {
    super('mail');
  }

  /** The pictures of a message (kept while the message does not change). */
  imagesOf(rec: MailRecord): MessageImage[] {
    const hit = this.cache.get(rec.id);
    if (hit && hit.size === rec.size) return hit.images;
    const images = rec.size > 0 ? messageImages(rawOf(rec)) : [];
    this.cache.set(rec.id, { size: rec.size, images });
    return images;
  }

  protected ready(): boolean {
    return true;
  }
  protected changed(): void {
    this.ctl.touch();
  }
  protected scan(): ScannedImage[] {
    const out: ScannedImage[] = [];
    const recs = this.scope === 'all' ? this.ctl.data.messages : this.ctl.selected ? [this.ctl.selected] : [];
    for (const rec of recs) {
      // a message with no attachments and no inline parts costs a parse only when all are asked for
      const imgs = this.imagesOf(rec);
      if (this.scope === 'selected' && this.capped && imgs.reduce((n, i) => n + i.data.length, 0) > AUTO_BYTES) continue;
      for (const i of imgs) out.push({ key: `${rec.id}|${i.key}`, read: !!rec.ocr?.[i.key] });
    }
    return out;
  }
  protected url(key: string): string {
    const [id, ...rest] = key.split('|');
    const rec = this.ctl.data.messages.find((m) => m.id === id);
    const img = rec && this.imagesOf(rec).find((i) => i.key === rest.join('|'));
    if (!img) throw new Error('No se encontró la imagen del mensaje.');
    return dataUriOf(img);
  }
  protected put(key: string, stored: StoredOcr): void {
    const [id, ...rest] = key.split('|');
    const rec = this.ctl.data.messages.find((m) => m.id === id);
    if (!rec) return;
    setImageReading(rec, rest.join('|'), stored);
    this.ctl.touch(true);
  }

  /** The open message: its pictures are read a moment after it is opened (not when it has a lot of picture data). */
  override schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.auto || this.state.running || !this.ctl.selected) return;
    this.scope = 'selected';
    this.capped = true;
    if (!this.sources(true).length) return;
    this.timer = setTimeout(() => void this.readNow('selected', true), 1500);
  }

  /** Reads the pictures of the open message (also a big one), or of every message. */
  async readNow(scope: 'selected' | 'all', capped = false): Promise<void> {
    this.scope = scope;
    this.capped = capped;
    try {
      await this.run(true);
    } finally {
      this.scope = 'selected';
      this.capped = true;
    }
  }

  /** How many pictures of the open message (or of all messages) have no reading yet. */
  unread(scope: 'selected' | 'all'): number {
    const was = [this.scope, this.capped] as const;
    this.scope = scope;
    this.capped = false;
    try {
      return this.counts().unread;
    } finally {
      [this.scope, this.capped] = was;
    }
  }
}

export { imagePartKey };
