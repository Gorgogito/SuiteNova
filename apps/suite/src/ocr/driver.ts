import { packResult, textResult, type OcrResult, type StoredOcr } from '@suitenova/ocr-core';
import { readImage } from './read';

/*
 * The background reading of the pictures of a document, the same in every product. A product says which pictures it has (`scan`), how to read
 * one (`url`) and where a reading is kept (`put`); this class decides when: one picture at a time, a moment after the person stops, only the
 * pictures put in the document in this session (what a file already had when it was opened is read when asked, so that opening a file does not
 * start a long reading nobody asked for), with the option of switching it off, and with a failed picture marked as without text so that it
 * is not tried again and again.
 */

export interface ImageOcrState {
  running: boolean;
  done: number;
  total: number;
  error: string;
}

export interface ScannedImage {
  /** What the product calls the picture's content: two pictures with the same key are the same picture and get the same reading. */
  key: string;
  /** Whether it already has a reading. */
  read: boolean;
}

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

/** A picture the engine can read (not a vector drawing). */
export const isReadableUri = (src: unknown): src is string => typeof src === 'string' && /^data:image\/(png|jpe?g|gif|webp|bmp)/i.test(src);
export const isReadableMime = (mime: string): boolean => /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(mime);

export abstract class ImageOcrDriver {
  state: ImageOcrState = { running: false, done: 0, total: 0, error: '' };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private runId = 0;
  private abort: AbortController | null = null;
  private baseline = new Set<string>();
  private baselinePending = true;

  /** `prefix` names the product in the settings (`nova.<prefix>.ocrAuto`). */
  constructor(private prefix: string) {}

  /** Every picture of the document (readable ones only). */
  protected abstract scan(): ScannedImage[];
  /** Whether the document is open (the first look at it after a file is opened takes what it has as its own). */
  protected abstract ready(): boolean;
  /** An address `readImage` can load. */
  protected abstract url(key: string): string | Promise<string>;
  /** Keeps a reading in every picture with this key that has none. */
  protected abstract put(key: string, stored: StoredOcr): void;
  /** Tells the product that the state changed (progress, a reading). */
  protected abstract changed(): void;

  get auto(): boolean {
    return load(`nova.${this.prefix}.ocrAuto`) !== '0';
  }
  set auto(v: boolean) {
    store(`nova.${this.prefix}.ocrAuto`, v ? '1' : '0');
    if (v) this.schedule();
    this.changed();
  }
  get lang(): string {
    return load(`nova.${this.prefix}.ocrLang`) || 'spa+eng';
  }
  set lang(v: string) {
    if (v === this.lang) return;
    store(`nova.${this.prefix}.ocrLang`, v);
    this.changed();
  }

  /** The pictures of the document as they are now: from here on, only new ones are read by themselves. Call it after a file is opened. */
  resetBaseline(): void {
    this.stop();
    this.baseline = new Set();
    this.baselinePending = !this.ready();
    if (!this.baselinePending) for (const i of this.scan()) this.baseline.add(i.key);
  }

  /** The distinct pictures that have no reading yet (`all`: also those the document had when it was opened). */
  sources(all = false): string[] {
    const list = this.scan();
    if (this.baselinePending && this.ready()) {
      this.baselinePending = false;
      this.baseline = new Set(list.map((i) => i.key));
    }
    const out = new Set<string>();
    for (const i of list) if (!i.read && (all || !this.baseline.has(i.key))) out.add(i.key);
    return [...out];
  }

  /** How many distinct pictures have a reading and how many have none. */
  counts(): { read: number; unread: number } {
    const read = new Set<string>();
    const unread = new Set<string>();
    for (const i of this.scan()) (i.read ? read : unread).add(i.key);
    return { read: read.size, unread: unread.size };
  }

  /** Call after every change of the document: reads the new pictures a moment after the person stops. */
  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.auto || this.state.running || !this.ready()) return;
    if (!this.sources().length) return;
    this.timer = setTimeout(() => void this.run(false), 1500);
  }

  /** Reads the pictures that have no reading. `all`: also those the document had when it was opened. */
  async run(all: boolean): Promise<void> {
    if (this.state.running) return;
    const list = this.sources(all);
    if (!list.length) return;
    const id = ++this.runId;
    const abort = new AbortController();
    this.abort = abort;
    this.state = { running: true, done: 0, total: list.length, error: '' };
    this.changed();
    const lang = this.lang;
    for (const key of list) {
      if (id !== this.runId) return;
      try {
        const r = await readImage(await this.url(key), lang, { signal: abort.signal });
        if (id !== this.runId) return;
        this.put(key, packResult({ ...r, text: r.text.trim() }));
      } catch (e) {
        if (id !== this.runId) return;
        this.state = { ...this.state, error: (e as Error).message };
        this.put(key, packResult(textResult('', lang)));
      }
      this.state = { ...this.state, done: this.state.done + 1 };
      this.changed();
    }
    this.state = { ...this.state, running: false };
    this.changed();
  }

  stop(): void {
    this.runId++;
    this.abort?.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.state.running) this.state = { ...this.state, running: false };
  }
}

/** The text a stored reading holds (empty when there is none). */
export const storedText = (s: unknown): string => (s && typeof (s as { text?: unknown }).text === 'string' ? (s as { text: string }).text : '');
export type { OcrResult, StoredOcr };
