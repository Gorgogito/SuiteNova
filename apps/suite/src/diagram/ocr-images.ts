import { type StoredOcr } from '@suitenova/ocr-core';
import { ImageOcrDriver, isReadableUri, type ScannedImage } from '../ocr/driver';
import type { DiagramCtl } from './ctl';

/*
 * The text of the pictures of a diagram (OCR). Each shape with a picture keeps its reading in `image.ocr`; the .novadiagram saves it with the shape.
 * Visio has no place for it (and does not search inside pictures), so the .vsdx does not carry it: a diagram opened again from a .vsdx has its
 * pictures read again when the person asks. When and how it is read is the shared `ImageOcrDriver`.
 */
export class DiagramImageOcr extends ImageOcrDriver {
  constructor(private ctl: DiagramCtl) {
    super('diagram');
    // what the document has now is its own: only pictures put in from here on are read by themselves
    this.resetBaseline();
  }

  protected ready(): boolean {
    return !!this.ctl.diagram?.pages?.length;
  }
  protected changed(): void {
    this.ctl.touch();
  }
  protected url(key: string): string {
    return key;
  }
  protected scan(): ScannedImage[] {
    const out: ScannedImage[] = [];
    for (const p of this.ctl.diagram.pages) for (const s of p.shapes) if (s.image && isReadableUri(s.image.src)) out.push({ key: s.image.src, read: !!s.image.ocr });
    return out;
  }
  protected put(key: string, stored: StoredOcr): void {
    this.ctl.setImageOcr(key, stored);
  }
}
