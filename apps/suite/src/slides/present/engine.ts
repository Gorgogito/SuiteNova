import { presetInfo, type AnimEffect, type Deck, type Slide } from '@suitenova/slides-core';

/*
 * The logic of a slide show, independent of the screen: which slides are shown, how animations split a slide into steps ("builds"),
 * and the timings recorded while rehearsing. The windows that show it (audience, presenter) only draw its state.
 */

export interface Build {
  /** effects that start automatically when the step begins (sub-groups with their offsets) */
  groups: AnimEffect[][];
}

/** The click groups of a slide: group 0 runs when the slide appears (effects before the first click), then one per click. */
export function clickGroups(slide: Slide): AnimEffect[][] {
  const effects = slide.timing?.effects ?? [];
  const groups: AnimEffect[][] = [[]];
  for (const e of effects) {
    if (e.trigger === 'onClick') groups.push([e]);
    else groups[groups.length - 1]!.push(e);
  }
  return groups;
}

/** How many clicks a slide takes before the next slide (the number of click groups). */
export const clickCount = (slide: Slide): number => Math.max(0, clickGroups(slide).length - 1);

/** Ids of elements that start hidden: the targets of entrance effects (until their effect has played). */
export function initiallyHidden(slide: Slide, playedUpTo: number): Set<string> {
  const hidden = new Set<string>();
  const groups = clickGroups(slide);
  groups.forEach((g, gi) => {
    for (const e of g) {
      if (e.para) continue;
      if (e.cls === 'entr') {
        if (gi > playedUpTo) hidden.add(e.target);
        else hidden.delete(e.target);
      } else if (e.cls === 'exit') {
        if (gi <= playedUpTo) hidden.add(e.target);
        else hidden.delete(e.target);
      }
    }
  });
  return hidden;
}

/** Timeline of a group: the start offset of each effect in ms from the beginning of the group. */
export function timeline(group: AnimEffect[]): { e: AnimEffect; start: number; dur: number }[] {
  const out: { e: AnimEffect; start: number; dur: number }[] = [];
  let prevEnd = 0;
  let prevStart = 0;
  group.forEach((e, i) => {
    const dur = e.dur ?? 500;
    let start: number;
    if (i === 0 || e.trigger === 'onClick') start = e.delay ?? 0;
    else if (e.trigger === 'afterPrev') start = prevEnd + (e.delay ?? 0);
    else start = prevStart + (e.delay ?? 0);
    out.push({ e, start, dur });
    prevStart = start;
    prevEnd = Math.max(prevEnd, start + dur);
  });
  return out;
}

export interface ShowSettings {
  loop?: boolean;
  mode?: 'presenter' | 'browsed' | 'kiosk';
  useTimings?: boolean;
  range?: { from: number; to: number };
  customShow?: string[];
}

/** The slides shown (indexes into `deck.slides`): hidden ones are skipped; a range or a custom show limits them. */
export function slideOrder(deck: Deck, s: ShowSettings = {}): number[] {
  let idx = deck.slides.map((_, i) => i);
  if (s.customShow) idx = s.customShow.map((id) => deck.slides.findIndex((x) => x.id === id)).filter((i) => i >= 0);
  else if (s.range) idx = idx.filter((i) => i + 1 >= s.range!.from && i + 1 <= s.range!.to);
  const visible = idx.filter((i) => !deck.slides[i]!.hidden);
  return visible.length ? visible : idx.slice(0, 1);
}

export interface ShowState {
  /** position in the order */
  pos: number;
  /** click groups played on the current slide */
  build: number;
  blank: null | 'black' | 'white';
  /** ms since the show started */
  elapsed: number;
  /** ms since the current slide appeared */
  slideElapsed: number;
}

/** What each message between the windows of a show carries. */
export type ShowMessage =
  | { type: 'hello'; from: 'audience' | 'presenter' }
  | { type: 'deck'; deck: Deck; settings: ShowSettings; startPos: number }
  | { type: 'state'; state: ShowState }
  | { type: 'cmd'; cmd: 'next' | 'prev' | 'goto' | 'blank' | 'end' | 'first' | 'last'; arg?: number | string }
  | { type: 'ink'; ink: { pts: number[]; color: string; w: number }[] }
  | { type: 'bye' };

export class Show {
  state: ShowState = { pos: 0, build: 0, blank: null, elapsed: 0, slideElapsed: 0 };
  /** recorded time on each slide, ms (rehearsal) */
  times = new Map<number, number>();
  private startAt = Date.now();
  private slideAt = Date.now();
  private listeners = new Set<() => void>();
  readonly order: number[];

  constructor(
    readonly deck: Deck,
    readonly settings: ShowSettings = {},
    startSlide = 0,
  ) {
    this.order = slideOrder(deck, settings);
    const p = this.order.indexOf(startSlide);
    this.state.pos = p >= 0 ? p : 0;
  }

  get slide(): Slide {
    return this.deck.slides[this.order[this.state.pos]!]!;
  }
  get slideIndex(): number {
    return this.order[this.state.pos]!;
  }
  get clicks(): number {
    return clickCount(this.slide);
  }
  get atEnd(): boolean {
    return this.state.pos >= this.order.length - 1 && this.state.build >= this.clicks;
  }
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private emit() {
    this.tick();
    this.listeners.forEach((l) => l());
  }
  tick(): void {
    const now = Date.now();
    this.state = { ...this.state, elapsed: now - this.startAt, slideElapsed: now - this.slideAt };
  }

  /** Next click: the next animation step, else the next slide. Returns false at the end of the show. */
  next(): boolean {
    if (this.state.blank) {
      this.state = { ...this.state, blank: null };
      this.emit();
      return true;
    }
    if (this.state.build < this.clicks) {
      this.state = { ...this.state, build: this.state.build + 1 };
      this.emit();
      return true;
    }
    return this.advanceSlide();
  }
  /** Skips animations: the next slide. */
  advanceSlide(): boolean {
    this.recordTime();
    if (this.state.pos < this.order.length - 1) {
      this.goPos(this.state.pos + 1);
      return true;
    }
    if (this.settings.loop) {
      this.goPos(0);
      return true;
    }
    return false;
  }
  prev(): void {
    if (this.state.build > 0) {
      this.state = { ...this.state, build: this.state.build - 1 };
      this.emit();
    } else if (this.state.pos > 0) this.goPos(this.state.pos - 1, true);
  }
  goPos(pos: number, atEnd = false): void {
    const p = Math.max(0, Math.min(this.order.length - 1, pos));
    this.slideAt = Date.now();
    this.state = { ...this.state, pos: p, build: atEnd ? clickCount(this.deck.slides[this.order[p]!]!) : 0, blank: null };
    this.emit();
  }
  /** Jumps to a slide of the deck by its index (a hyperlink or "go to slide"). */
  goToSlide(deckIndex: number): void {
    const p = this.order.indexOf(deckIndex);
    if (p >= 0) this.goPos(p);
    else {
      // a hidden slide can still be reached by a link: shown in place
      this.slideAt = Date.now();
      this.order.push(deckIndex);
      this.goPos(this.order.length - 1);
    }
  }
  blank(kind: 'black' | 'white'): void {
    this.state = { ...this.state, blank: this.state.blank === kind ? null : kind };
    this.emit();
  }
  recordTime(): void {
    const t = Date.now() - this.slideAt;
    this.times.set(this.slideIndex, (this.times.get(this.slideIndex) ?? 0) + t);
  }
  /** Applies a state received from another window. */
  apply(s: ShowState): void {
    this.state = { ...s };
    this.slideAt = Date.now() - s.slideElapsed;
    this.startAt = Date.now() - s.elapsed;
    this.listeners.forEach((l) => l());
  }
  /** Time on a slide in seconds as it would be recorded (rounded), for "use timings". */
  get recorded(): { index: number; ms: number }[] {
    return [...this.times].map(([index, ms]) => ({ index, ms }));
  }
}

/** The animation presets that need the element's rectangle to build their keyframes. */
export const needsGeometry = (e: AnimEffect): boolean => presetInfo(e.cls, e.preset)?.kind === 'fly';
