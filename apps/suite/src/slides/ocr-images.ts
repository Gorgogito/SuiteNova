import { type StoredOcr } from '@suitenova/ocr-core';
import type { SlideElement } from '@suitenova/slides-core';
import { ImageOcrDriver, isReadableMime, type ScannedImage } from '../ocr/driver';
import type { SlidesCtl } from './ctl';

/*
 * The text of the pictures of a presentation (OCR). The reading is kept in the picture's asset (`Asset.ocr`): a picture that changes (effects,
 * another image) gets another asset, so it is read again, and two pictures that show the same asset share the reading. PowerPoint does not search
 * inside pictures; Nova does, and the person can copy the text. When and how it is read is the shared `ImageOcrDriver`.
 */
export class SlidesImageOcr extends ImageOcrDriver {
  constructor(private ctl: SlidesCtl) {
    super('slides');
    // what the document has now is its own: only pictures put in from here on are read by themselves
    this.resetBaseline();
  }

  protected ready(): boolean {
    return !!this.ctl.realDeck?.slides?.length;
  }
  protected changed(): void {
    this.ctl.touch();
  }
  protected url(key: string): string {
    return this.ctl.urls.url(key);
  }
  protected scan(): ScannedImage[] {
    const deck = this.ctl.realDeck;
    const out: ScannedImage[] = [];
    const walk = (els: SlideElement[]) => {
      for (const e of els) {
        if (e.kind === 'group') walk(e.children);
        else if (e.kind === 'pic') {
          const a = deck.assets[e.src];
          if (a && isReadableMime(a.mime)) out.push({ key: e.src, read: !!a.ocr });
        }
      }
    };
    for (const s of deck.slides) walk(s.shapes);
    return out;
  }
  protected put(key: string, stored: StoredOcr): void {
    this.ctl.setAssetOcr(key, stored);
  }
}
