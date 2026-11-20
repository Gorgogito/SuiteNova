import { hasPositions, packResult, searchResult, unpackResult, type OcrResult, type StoredOcr } from '@suitenova/ocr-core';
import type { Node as PMNode } from 'prosemirror-model';
import { ImageOcrDriver, isReadableUri, type ScannedImage } from '../ocr/driver';
import type { WriterCtl } from './doc';

/*
 * The text of the pictures of a document (OCR). Each `image` node keeps its reading in the `ocr` attribute (`StoredOcr` of ocr-core), so it travels with
 * the picture (copy, undo, the .docx). Word and PowerPoint do not search inside pictures; Nova does, and the person can copy the text. The reading
 * itself (when, one at a time, only new pictures) is the shared `ImageOcrDriver`.
 */

export const isReadable = isReadableUri;

/** The reading a picture node keeps, or null. */
export const readingOf = (node: PMNode): OcrResult | null => (node.attrs.ocr ? unpackResult(node.attrs.ocr) : null);

export type { ImageOcrState } from '../ocr/driver';

export class ImageOcr extends ImageOcrDriver {
  constructor(private ctl: WriterCtl) {
    super('writer');
  }

  protected ready(): boolean {
    return !!this.ctl.mainView;
  }
  protected changed(): void {
    this.ctl.touch();
  }
  protected url(key: string): string {
    return key;
  }
  protected scan(): ScannedImage[] {
    const out: ScannedImage[] = [];
    this.ctl.mainState?.doc.descendants((n) => {
      if (n.type.name === 'image' && isReadable(n.attrs.src)) out.push({ key: n.attrs.src, read: !!n.attrs.ocr });
      return true;
    });
    return out;
  }

  /** Puts a reading in every picture with this source that has none (not an undoable step: it is derived data). */
  protected put(src: string, stored: StoredOcr): void {
    const v = this.ctl.mainView;
    if (!v) return;
    let tr = v.state.tr;
    v.state.doc.descendants((n, pos) => {
      if (n.type.name === 'image' && n.attrs.src === src && !n.attrs.ocr) tr = tr.setNodeAttribute(pos, 'ocr', stored);
      return true;
    });
    if (tr.docChanged) v.dispatch(tr.setMeta('addToHistory', false).setMeta('nw-load', true));
  }

  /** Keeps a new reading of one picture (other language, a zone, a turn). */
  setReading(pos: number, r: OcrResult | null): void {
    const v = this.ctl.mainView;
    const n = v?.state.doc.nodeAt(pos);
    if (!v || !n || n.type.name !== 'image') return;
    v.dispatch(v.state.tr.setNodeAttribute(pos, 'ocr', r ? packResult({ ...r, text: r.text.trim() }) : null).setMeta('addToHistory', false));
  }
}

/** The pictures of the document that have this text in their reading: where (node position) and the boxes of what matched. */
export function searchImages(doc: PMNode, query: string, o: { matchCase?: boolean; wholeWord?: boolean }): { pos: number; boxes: ReturnType<typeof searchResult>[number]['boxes'] }[] {
  const out: { pos: number; boxes: ReturnType<typeof searchResult>[number]['boxes'] }[] = [];
  if (!query.trim()) return out;
  doc.descendants((n, pos) => {
    if (n.type.name !== 'image' || !n.attrs.ocr) return true;
    const r = unpackResult(n.attrs.ocr);
    if (!r || !r.text) return true;
    const m = searchResult(r, query, { caseSensitive: o.matchCase, wholeWord: o.wholeWord });
    if (m.length) out.push({ pos, boxes: hasPositions(r) ? m.flatMap((x) => x.boxes) : [] });
    return true;
  });
  return out;
}
