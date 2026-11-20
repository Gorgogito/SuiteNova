import { type StoredOcr } from '@suitenova/ocr-core';
import type { MediaItem } from '@suitenova/calc-engine';
import { ImageOcrDriver, isReadableMime, type ScannedImage } from '../ocr/driver';
import type { CalcDoc } from './doc';

/*
 * The text of the pictures of a workbook (OCR). The reading is kept with the picture's content in the workbook's media store (`MediaItem.ocr`): the
 * same picture in two places is read once, and a picture that changes (effects, another image) is other content, so it is read again. Excel does not
 * search inside pictures (it has «Datos desde imagen» for tables instead); Nova also lets the person copy and find the text. When and how it is read is
 * the shared `ImageOcrDriver`.
 */
export class CalcImageOcr extends ImageOcrDriver {
  constructor(private doc: CalcDoc) {
    super('calc');
  }

  protected ready(): boolean {
    return this.doc.wb.sheets.length > 0;
  }
  protected changed(): void {
    this.doc.touch();
  }
  protected scan(): ScannedImage[] {
    const out: ScannedImage[] = [];
    for (const s of this.doc.wb.sheets)
      for (const im of s.images) {
        const m = this.doc.wb.media.get(im.media);
        if (m && !im.smartart && isReadableMime(m.mime)) out.push({ key: im.media, read: !!m.ocr });
      }
    return out;
  }
  protected url(key: string): string {
    return mediaDataUri(this.doc.wb.media.get(key)!);
  }
  protected put(key: string, stored: StoredOcr): void {
    this.doc.setImageOcr(key, stored);
  }
}

/** A picture of the media store as a `data:` address the reader can load. */
export function mediaDataUri(m: MediaItem): string {
  let bin = '';
  for (let i = 0; i < m.data.length; i += 0x8000) bin += String.fromCharCode(...m.data.subarray(i, i + 0x8000));
  return `data:${m.mime};base64,${btoa(bin)}`;
}
