import { toSpeech, writtenRange, type Spoken } from './prepare';
import { pieces } from './sentences';
import { pickVoice, type Voice } from './voices';

/*
 * The reader: it takes the text a product wants read (as blocks: paragraphs, cells, notes, messages), cuts it into pieces, and has an engine speak them
 * one after another, with play, pause, continue, stop, next, previous, speed and voice, and tells the product which words are being read so that it
 * can show them. It knows nothing about any engine: it speaks through `Synth` (the browser's in the app, a fake one in the tests).
 */

/** What a product gives to read: a stretch of text and, when it matters to it, where it is (`ref`) and in what language it is written. */
export interface Block {
  text: string;
  lang?: string;
  ref?: unknown;
}

/** One piece to speak. */
export interface Unit {
  /** The block it is in and where, in the written text of the block. */
  block: number;
  start: number;
  end: number;
  lang: string;
  /** What is given to the voice and how it maps back to the written text. */
  spoken: Spoken;
}

export interface SpeakOptions {
  lang: string;
  voice: Voice | null;
  rate: number;
  volume: number;
}

export interface SpeakHandlers {
  onStart?(): void;
  /** The engine reached a word: where it starts (and, when it knows, its length) in the text it was given. */
  onWord?(charIndex: number, length?: number): void;
  onEnd(): void;
  onError(message: string, interrupted: boolean): void;
}

/** An engine that speaks one piece of text. `cancel` must end what is being said (it may or may not call `onEnd`/`onError`: the reader ignores that). */
export interface Synth {
  voices(): Voice[];
  speak(text: string, o: SpeakOptions, h: SpeakHandlers): void;
  cancel(): void;
  /** For engines that tell when the list of voices changes. */
  onVoicesChanged?(fn: () => void): () => void;
}

export type ReaderState = 'idle' | 'playing' | 'paused';

export interface Snapshot {
  state: ReaderState;
  /** The piece being read (or the one a pause is in), -1 when nothing is loaded or it is over. */
  index: number;
  count: number;
  /** Where the piece is, in the written text of its block. */
  block: number;
  piece: { start: number; end: number } | null;
  /** The word being read, in the written text of its block. */
  word: { start: number; end: number } | null;
  rate: number;
  error: string;
  /** No voice reads the language of the piece (the engine will use its own). */
  noVoice: boolean;
}

export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5] as const;

export interface ReaderOptions {
  /** The language of the blocks that do not say. */
  lang?: string;
  rate?: number;
  /** The name of the voice the person chose, by language (`es`, `en`). */
  voices?: Record<string, string>;
  /** Longest piece in characters before it is cut. */
  maxPiece?: number;
}

export class Reader {
  private blocks: Block[] = [];
  private units: Unit[] = [];
  private listeners = new Set<() => void>();
  private token = 0;
  private cur = -1;
  private state: ReaderState = 'idle';
  private word: { start: number; end: number } | null = null;
  /** Spoken offset within the current unit where the engine last was (to go on from there after a pause or a change of speed). */
  private at = 0;
  private error = '';
  private noVoice = false;
  rate: number;
  lang: string;
  voices: Record<string, string>;
  volume = 1;
  private maxPiece: number;

  constructor(private synth: Synth, o: ReaderOptions = {}) {
    this.rate = o.rate ?? 1;
    this.lang = o.lang ?? 'es';
    this.voices = { ...(o.voices ?? {}) };
    this.maxPiece = o.maxPiece ?? 220;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private emit(): void {
    for (const l of this.listeners) l();
  }

  get snapshot(): Snapshot {
    const u = this.units[this.cur];
    return {
      state: this.state,
      index: u ? this.cur : -1,
      count: this.units.length,
      block: u?.block ?? -1,
      piece: u ? { start: u.start, end: u.end } : null,
      word: this.state === 'idle' ? null : this.word,
      rate: this.rate,
      error: this.error,
      noVoice: this.noVoice,
    };
  }

  /** The block given for piece `i` (its `ref`, to show it). */
  blockOf(i: number): Block | null {
    const u = this.units[i];
    return u ? (this.blocks[u.block] ?? null) : null;
  }
  get pieces(): readonly Unit[] {
    return this.units;
  }

  /** Gives the text to read. Whatever was being read stops. */
  load(blocks: Block[]): void {
    this.stop();
    this.blocks = blocks;
    this.units = [];
    blocks.forEach((b, bi) => {
      const lang = b.lang ?? this.lang;
      for (const s of pieces(b.text, this.maxPiece)) this.units.push({ block: bi, start: s.start, end: s.end, lang, spoken: toSpeech(b.text.slice(s.start, s.end), lang) });
    });
    this.cur = this.units.length ? 0 : -1;
    this.emit();
  }

  /** The piece that has this place (a block and an offset in it), or the first one after it. */
  indexAt(block: number, offset: number): number {
    const i = this.units.findIndex((u) => u.block > block || (u.block === block && u.end > offset));
    return i < 0 ? this.units.length : i;
  }

  /** Starts reading at a piece (the one the person is at, else the first). */
  play(from?: number): void {
    if (!this.units.length) return;
    const i = from ?? (this.state === 'paused' ? this.cur : this.cur >= 0 && this.cur < this.units.length ? this.cur : 0);
    this.speakUnit(Math.max(0, Math.min(this.units.length - 1, i)), 0);
  }

  pause(): void {
    if (this.state !== 'playing') return;
    // cancelling and going on from the word is more reliable than the engines' own pause (which several of them lose)
    this.token++;
    this.synth.cancel();
    this.state = 'paused';
    this.emit();
  }

  resume(): void {
    if (this.state === 'paused') this.speakUnit(this.cur, this.at);
  }

  stop(): void {
    this.token++;
    this.synth.cancel();
    const was = this.state;
    this.state = 'idle';
    this.word = null;
    this.at = 0;
    if (was !== 'idle') this.emit();
  }

  next(): void {
    if (!this.units.length) return;
    const i = Math.min(this.units.length - 1, this.cur + 1);
    if (this.state === 'playing') this.speakUnit(i, 0);
    else this.moveTo(i);
  }

  previous(): void {
    if (!this.units.length) return;
    // pressing it a second after a piece began goes back to the one before; in the middle of one it goes to the start of this one
    const i = this.at > 0 && this.state === 'playing' ? this.cur : Math.max(0, this.cur - 1);
    if (this.state === 'playing') this.speakUnit(i, 0);
    else this.moveTo(i);
  }

  private moveTo(i: number): void {
    this.cur = i;
    this.at = 0;
    this.word = null;
    this.emit();
  }

  setRate(rate: number): void {
    this.rate = Math.max(0.5, Math.min(3, rate));
    // a speed change is heard at once: go on from the word being read at the new speed
    if (this.state === 'playing') this.speakUnit(this.cur, this.at);
    else this.emit();
  }

  /** The voice the person chooses for a language (`''` to leave it to the system). */
  setVoice(lang: string, name: string): void {
    const key = lang.toLowerCase().split(/[-_]/)[0]!;
    if (name) this.voices[key] = name;
    else delete this.voices[key];
    if (this.state === 'playing') this.speakUnit(this.cur, this.at);
    else this.emit();
  }

  private speakUnit(i: number, offset: number): void {
    const u = this.units[i];
    if (!u) {
      this.finish();
      return;
    }
    const token = ++this.token;
    this.synth.cancel();
    this.cur = i;
    this.at = offset;
    this.state = 'playing';
    this.error = '';
    this.word = null;
    const voice = pickVoice(this.synth.voices(), u.lang, this.voices[u.lang.toLowerCase().split(/[-_]/)[0]!]);
    this.noVoice = !voice;
    const text = u.spoken.text.slice(offset);
    this.emit();
    if (!text.trim()) {
      this.advance(token);
      return;
    }
    this.synth.speak(text, { lang: voice?.lang ?? u.lang, voice, rate: this.rate, volume: this.volume }, {
      onWord: (charIndex, length) => {
        if (token !== this.token) return;
        const s = offset + charIndex;
        const len = length || (/\S+/.exec(u.spoken.text.slice(s))?.[0].length ?? 1);
        this.at = s;
        const w = writtenRange(u.spoken, s, s + len);
        this.word = { start: u.start + w.start, end: u.start + w.end };
        this.emit();
      },
      onEnd: () => {
        if (token === this.token) this.advance(token);
      },
      onError: (message, interrupted) => {
        if (token !== this.token || interrupted) return;
        this.error = message;
        this.token++;
        this.state = 'idle';
        this.word = null;
        this.emit();
      },
    });
  }

  private advance(token: number): void {
    if (token !== this.token) return;
    if (this.cur + 1 < this.units.length) this.speakUnit(this.cur + 1, 0);
    else this.finish();
  }

  private finish(): void {
    this.token++;
    this.state = 'idle';
    this.word = null;
    this.at = 0;
    this.cur = this.units.length ? 0 : -1;
    this.emit();
  }
}
