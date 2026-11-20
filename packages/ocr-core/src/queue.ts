import type { Pixels } from '@suitenova/image-core';
import type { Box, OcrEngine, OcrResult } from './model';
import { recognize } from './recognize';

export interface OcrJob {
  /** What the product calls the picture (to cancel it, or to move it up the queue). */
  id: string;
  /** What the reading is kept under (`readingKey`): a job whose key has a result is answered at once and one whose key is being read waits for it. */
  key: string;
  load(): Promise<Pixels>;
  lang: string;
  zone?: Box;
  turns?: 0 | 1 | 2 | 3 | 'auto';
  /** Higher goes first (the picture the person is looking at); equal ones go in the order they came. */
  priority?: number;
}

/** Where readings are kept while the program runs (the product also saves them in its file). */
export interface OcrCache {
  get(key: string): OcrResult | undefined;
  set(key: string, result: OcrResult): void;
}

export const memoryCache = (): OcrCache => {
  const m = new Map<string, OcrResult>();
  return { get: (k) => m.get(k), set: (k, r) => void m.set(k, r) };
};

export interface QueueState {
  running: boolean;
  /** Pictures read since the queue was idle, and how many were added in that time. */
  done: number;
  total: number;
  /** The id being read. */
  current: string | null;
  /** The last error, in words. */
  error: string;
}

interface Waiting {
  job: OcrJob;
  seq: number;
  resolve(r: OcrResult): void;
  reject(e: unknown): void;
  controller: AbortController;
  /** Other jobs for the same reading. */
  alike: { resolve(r: OcrResult): void; reject(e: unknown): void }[];
}

/**
 * Reads pictures one at a time (an engine uses all the processor it gets), with progress, cancelling and a cache. The same reading asked twice is
 * done once.
 */
export class OcrQueue {
  private waiting: Waiting[] = [];
  private active: Waiting | null = null;
  private seq = 0;
  private listeners = new Set<() => void>();
  state: QueueState = { running: false, done: 0, total: 0, current: null, error: '' };

  constructor(
    private engine: OcrEngine,
    private cache: OcrCache = memoryCache(),
  ) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private set(patch: Partial<QueueState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** Ask for a reading. The promise is the result, or rejects with an `AbortError` if the job is cancelled. */
  add(job: OcrJob): Promise<OcrResult> {
    const hit = this.cache.get(job.key);
    if (hit) return Promise.resolve(hit);
    return new Promise<OcrResult>((resolve, reject) => {
      const same = this.waiting.find((w) => w.job.key === job.key) ?? (this.active?.job.key === job.key ? this.active : undefined);
      if (same) {
        same.alike.push({ resolve, reject });
        if (same !== this.active && (job.priority ?? 0) > (same.job.priority ?? 0)) same.job.priority = job.priority;
        return;
      }
      this.waiting.push({ job, seq: this.seq++, resolve, reject, controller: new AbortController(), alike: [] });
      this.set({ total: this.state.total + 1 });
      void this.pump();
    });
  }

  /** The picture with this id goes to the front of the line. */
  prioritize(id: string): void {
    const w = this.waiting.find((x) => x.job.id === id);
    if (w) w.job.priority = Math.max(0, ...this.waiting.map((x) => x.job.priority ?? 0)) + 1;
  }

  cancel(id: string): void {
    const abort = (w: Waiting) => {
      const e = new DOMException('Cancelado', 'AbortError');
      w.reject(e);
      for (const a of w.alike) a.reject(e);
    };
    const i = this.waiting.findIndex((w) => w.job.id === id);
    if (i >= 0) {
      const [w] = this.waiting.splice(i, 1);
      abort(w!);
      this.set({ total: Math.max(this.state.done, this.state.total - 1) });
    } else if (this.active?.job.id === id) this.active.controller.abort();
    if (!this.waiting.length && !this.active) this.set({ running: false, done: 0, total: 0, current: null });
  }

  cancelAll(): void {
    for (const w of [...this.waiting]) this.cancel(w.job.id);
    if (this.active) this.active.controller.abort();
  }

  get pending(): number {
    return this.waiting.length + (this.active ? 1 : 0);
  }

  private async pump(): Promise<void> {
    if (this.active) return;
    const next = [...this.waiting].sort((a, b) => (b.job.priority ?? 0) - (a.job.priority ?? 0) || a.seq - b.seq)[0];
    if (!next) {
      this.set({ running: false, current: null, done: 0, total: 0 });
      return;
    }
    this.waiting.splice(this.waiting.indexOf(next), 1);
    this.active = next;
    this.set({ running: true, current: next.job.id, error: '' });
    try {
      const pixels = await next.job.load();
      const result = await recognize(this.engine, pixels, { lang: next.job.lang, zone: next.job.zone, turns: next.job.turns, signal: next.controller.signal });
      if (next.controller.signal.aborted) throw new DOMException('Cancelado', 'AbortError');
      this.cache.set(next.job.key, result);
      next.resolve(result);
      for (const a of next.alike) a.resolve(result);
    } catch (e) {
      const aborted = (e as { name?: string })?.name === 'AbortError' || next.controller.signal.aborted;
      if (!aborted) this.set({ error: (e as Error)?.message || 'No se pudo leer el texto de la imagen.' });
      next.reject(e);
      for (const a of next.alike) a.reject(e);
    } finally {
      this.active = null;
      this.set({ done: this.state.done + 1 });
      void this.pump();
    }
  }
}
