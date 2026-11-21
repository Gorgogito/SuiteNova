import { Reader, type Block, type Snapshot, type Voice } from '@suitenova/speech-core';
import { speechAvailable, webSpeech } from './webSpeech';

/*
 * The reader of one product with the person's settings: the speed and the voice for each language are the same in every product (they are kept in the
 * browser's storage under one name), so what is chosen in Writer is what Mail and Slides use. The product gives the text (`load`) and shows the words
 * (`subscribe`/`snapshot`); the bar (`ReadAloudBar`) is the shared interface.
 */

const KEY = 'nova.voice';

interface Saved {
  rate?: number;
  voices?: Record<string, string>;
}

const load = (): Saved => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Saved;
    return { rate: typeof v.rate === 'number' ? v.rate : undefined, voices: v.voices && typeof v.voices === 'object' ? v.voices : undefined };
  } catch {
    return {};
  }
};
const save = (s: Saved): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento */
  }
};

export class VoiceController {
  readonly reader: Reader;
  /** Bumped at every change, for `useSyncExternalStore`. */
  version = 0;
  /** The bar is shown (from when reading starts until it is closed). */
  visible = false;
  private listeners = new Set<() => void>();

  constructor(lang = 'es-ES') {
    const s = load();
    // some engines hand over their voices only after they are asked once: ask now, so they are there when the bar is shown
    webSpeech.voices();
    this.reader = new Reader(webSpeech, { lang, rate: s.rate, voices: s.voices });
    this.reader.subscribe(() => this.changed());
  }

  readonly subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  readonly getVersion = (): number => this.version;
  private changed(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  get available(): boolean {
    return speechAvailable();
  }
  get snapshot(): Snapshot {
    return this.reader.snapshot;
  }
  voices(): Voice[] {
    return webSpeech.voices();
  }

  /** The language blocks without one are read in. */
  set lang(l: string) {
    this.reader.lang = l;
  }

  /** Gives the text and starts reading (at the beginning, or at a place: a block and an offset in it); the bar is shown. */
  start(blocks: Block[], at?: { block: number; offset: number }): void {
    this.reader.load(blocks);
    this.visible = true;
    this.changed();
    this.reader.play(at ? this.reader.indexAt(at.block, at.offset) : undefined);
  }

  /** Stops and hides the bar. */
  close(): void {
    this.reader.stop();
    this.reader.load([]);
    this.visible = false;
    this.changed();
  }

  setRate(rate: number): void {
    this.reader.setRate(rate);
    save({ ...load(), rate: this.reader.rate });
  }

  setVoice(lang: string, name: string): void {
    this.reader.setVoice(lang, name);
    save({ ...load(), voices: { ...this.reader.voices } });
  }
}
