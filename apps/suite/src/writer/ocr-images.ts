import { hasPositions, packResult, searchResult, textResult, unpackResult, type OcrResult } from '@suitenova/ocr-core';
import type { Node as PMNode } from 'prosemirror-model';
import { readImage } from '../ocr/read';
import type { WriterCtl } from './doc';

/*
 * The text of the pictures of a document (OCR). Each `image` node keeps its reading in the `ocr` attribute (`StoredOcr` of ocr-core), so it travels with
 * the picture (copy, undo, the .docx). Word and PowerPoint do not search inside pictures; Nova does, and the person can copy the text.
 * Readings are made one picture at a time in the background, for the pictures put in the document in this session (the ones a file already had are
 * read when the person asks, so that opening a file does not start a long reading nobody asked for).
 */

const AUTO_KEY = 'nova.writer.ocrAuto';
const LANG_KEY = 'nova.writer.ocrLang';

const store = (k: string, v: string): void => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sin almacenamiento */
  }
};
const load = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

export const isReadable = (src: unknown): src is string => typeof src === 'string' && /^data:image\/(png|jpe?g|gif|webp|bmp)/i.test(src);

/** The reading a picture node keeps, or null. */
export const readingOf = (node: PMNode): OcrResult | null => (node.attrs.ocr ? unpackResult(node.attrs.ocr) : null);

export interface ImageOcrState {
  running: boolean;
  done: number;
  total: number;
  error: string;
}

export class ImageOcr {
  state: ImageOcrState = { running: false, done: 0, total: 0, error: '' };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private run_ = 0;
  private abort: AbortController | null = null;
  /** Pictures the document had when it was opened: they are not read by themselves. */
  private baseline = new Set<string>();

  constructor(private ctl: WriterCtl) {}

  get auto(): boolean {
    return load(AUTO_KEY) !== '0';
  }
  set auto(v: boolean) {
    store(AUTO_KEY, v ? '1' : '0');
    if (v) this.schedule();
    this.ctl.touch();
  }
  get lang(): string {
    return load(LANG_KEY) || 'spa+eng';
  }
  set lang(v: string) {
    store(LANG_KEY, v);
    this.ctl.touch();
  }

  /** The pictures of the document as they are now: from here on, only new ones are read by themselves. */
  resetBaseline(): void {
    this.stop();
    this.baseline = new Set();
    // without a view yet the first look takes it (see `sources`)
    const doc = this.ctl.mainState?.doc;
    this.baselinePending = !doc;
    doc?.descendants((n) => {
      if (n.type.name === 'image' && isReadable(n.attrs.src)) this.baseline.add(n.attrs.src);
      return true;
    });
  }
  private baselinePending = true;

  /** The distinct pictures that have no reading yet (`all`: also those the document had when it was opened). */
  sources(all = false): string[] {
    const doc = this.ctl.mainState?.doc;
    if (this.baselinePending && doc) {
      // the first look after a file is opened: what it has is its own
      this.baselinePending = false;
      this.baseline = new Set();
      doc.descendants((n) => {
        if (n.type.name === 'image' && isReadable(n.attrs.src)) this.baseline.add(n.attrs.src);
        return true;
      });
    }
    const out = new Set<string>();
    doc?.descendants((n) => {
      if (n.type.name === 'image' && !n.attrs.ocr && isReadable(n.attrs.src) && (all || !this.baseline.has(n.attrs.src))) out.add(n.attrs.src);
      return true;
    });
    return [...out];
  }

  /** How many pictures have a reading and how many have none. */
  counts(): { read: number; unread: number } {
    let read = 0;
    let unread = 0;
    this.ctl.mainState?.doc.descendants((n) => {
      if (n.type.name === 'image' && isReadable(n.attrs.src)) n.attrs.ocr ? read++ : unread++;
      return true;
    });
    return { read, unread };
  }

  /** Called after every change: reads the new pictures a moment after the person stops. */
  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.auto || this.state.running || !this.ctl.mainView) return;
    if (!this.sources().length) return;
    this.timer = setTimeout(() => void this.run(false), 1500);
  }

  /** Puts a reading in every picture with this source that has none (not an undoable step: it is derived data). */
  private apply(src: string, r: OcrResult): void {
    const v = this.ctl.mainView;
    if (!v) return;
    const stored = packResult({ ...r, text: r.text.trim() });
    let tr = v.state.tr;
    v.state.doc.descendants((n, pos) => {
      if (n.type.name === 'image' && n.attrs.src === src && !n.attrs.ocr) tr = tr.setNodeAttribute(pos, 'ocr', stored);
      return true;
    });
    if (tr.docChanged) v.dispatch(tr.setMeta('addToHistory', false).setMeta('nw-load', true));
  }

  /** Reads the pictures that have no reading. `all`: also those the document had when it was opened. */
  async run(all: boolean): Promise<void> {
    if (this.state.running) return;
    const list = this.sources(all);
    if (!list.length) return;
    const id = ++this.run_;
    const abort = new AbortController();
    this.abort = abort;
    this.state = { running: true, done: 0, total: list.length, error: '' };
    this.ctl.touch();
    const lang = this.lang;
    for (const src of list) {
      if (id !== this.run_) return;
      try {
        this.apply(src, await readImage(src, lang, { signal: abort.signal }));
      } catch (e) {
        if (id !== this.run_) return;
        this.state = { ...this.state, error: (e as Error).message };
        // a picture that fails is marked as without text so that it is not tried again and again
        this.apply(src, textResult('', lang));
      }
      this.state = { ...this.state, done: this.state.done + 1 };
      this.ctl.touch();
    }
    this.state = { ...this.state, running: false };
    this.ctl.touch();
  }

  stop(): void {
    this.run_++;
    this.abort?.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.state.running) this.state = { ...this.state, running: false };
  }

  /** Reads one picture again (other language, a zone, a turn) and keeps the new reading in it. */
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
