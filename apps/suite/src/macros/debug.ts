import { basic } from '@suitenova/base-core';

type BVal = basic.BVal;

export interface MacroRun {
  ok: boolean;
  error?: string;
  at?: { module: string; line: number };
  value?: BVal;
}

export interface MacroModule {
  name: string;
  code: string;
}

export interface SyntaxProblem {
  line: number;
  message: string;
}

/** What a macro run reports for whatever stopped it. */
export function reportError(e: unknown): MacroRun {
  if (e instanceof basic.BasicError) return { ok: false, error: e.full, at: e.module && e.line ? { module: e.module, line: e.line } : undefined };
  if (e instanceof basic.AbortRun) return { ok: false, error: e.message };
  if (e instanceof basic.BasicSyntaxError) return { ok: false, error: `Error de sintaxis, línea ${e.line}: ${e.message}`, at: { module: 'Inmediato', line: e.line } };
  return { ok: false, error: (e as Error).message };
}

/**
 * A run under the debugger. It is stopped at a statement until `step` is called; each piece of the run is guarded like a normal run (what it
 * changes in the document is one undo step per piece).
 */
export interface RunGuard {
  lastAt: { module: string; line: number } | undefined;
  /** Runs a piece of a debug session under the product's guard. */
  guardedStep(fn: () => void): void;
}

export class DebugRun {
  constructor(
    private readonly rt: RunGuard,
    private readonly s: basic.DebugSession,
  ) {}
  get state(): 'paused' | 'done' | 'error' {
    return this.s.state;
  }
  get pause(): basic.DebugPause | null {
    return this.s.pause;
  }
  /** How the run ended (state `done` or `error`). */
  get result(): MacroRun {
    if (this.s.state === 'error') return reportError(this.s.error);
    return { ok: true, value: this.s.value };
  }
  step(mode: basic.DebugStep): void {
    this.rt.guardedStep(() => this.s.step(mode));
    if (this.s.state === 'error') this.rt.lastAt = reportError(this.s.error).at;
  }
  stack() {
    return this.s.stack();
  }
  locals(frame = 0) {
    return this.s.locals(frame);
  }
  /** Runs an instruction or evaluates an expression where it is stopped; the text of the value, or the error. */
  evaluate(src: string, frame = 0): { ok: boolean; text: string } {
    let out = { ok: true, text: '' };
    this.rt.guardedStep(() => {
      try {
        out = { ok: true, text: this.s.evaluate(src, frame) };
      } catch (e) {
        out = { ok: false, text: reportError(e).error ?? '' };
      }
    });
    return out;
  }
  setBreakpoints(list: Iterable<string>): void {
    this.s.setBreakpoints(list);
  }
  stop(): void {
    this.rt.guardedStep(() => this.s.stop());
  }
}

