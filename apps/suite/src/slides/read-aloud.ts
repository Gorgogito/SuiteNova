import { getLocale } from '@suitenova/core-ui';
import { docNode, type Deck, type SlideElement, type TextBody } from '@suitenova/slides-core';
import type { Block } from '@suitenova/speech-core';
import { VoiceController } from '../voice/controller';
import type { SlidesCtl } from './ctl';

/*
 * Read Aloud in Slides: from the slide that is open to the last one, each slide is announced («Diapositiva 3») and read: the title first, then the
 * rest of its text in the order of the slide (shapes, groups, table cells), and optionally its speaker notes; or only the notes. While it reads,
 * the slide that is being read is shown and the object that holds the text is selected, and the bar shows the sentence with the word marked.
 */

/** Where a piece of text is: its slide and the object that holds it (null for the slide's notes). */
export interface SlideRef {
  slide: number;
  element: string | null;
  notes?: boolean;
}

const TITLES = new Set(['title', 'ctrTitle']);

const paragraphs = (body: TextBody | null | undefined): string[] => {
  if (!body) return [];
  const out: string[] = [];
  docNode(body.doc).forEach((p) => {
    const t = p.textBetween(0, p.content.size, '\n', ' ').trim();
    if (t) out.push(t);
  });
  return out;
};

/** The text of the objects of a slide in reading order: the title first, then the others as they are in the slide. */
function elementTexts(shapes: SlideElement[]): { id: string; text: string }[] {
  const flat: { id: string; text: string; title: boolean }[] = [];
  const walk = (els: SlideElement[]) => {
    for (const e of els) {
      if (e.kind === 'group') walk(e.children);
      else if (e.kind === 'shape') {
        const title = !!e.ph && TITLES.has(e.ph.type);
        for (const t of paragraphs(e.text)) flat.push({ id: e.id, text: t, title });
      } else if (e.kind === 'table') {
        for (const row of e.rows) for (const cell of row.cells) for (const t of paragraphs(cell.text)) flat.push({ id: e.id, text: t, title: false });
      }
    }
  };
  walk(shapes);
  return [...flat.filter((x) => x.title), ...flat.filter((x) => !x.title)];
}

export interface SlideBlock extends Block {
  ref: SlideRef;
}

/** The blocks to read from slide `from` on (or only the one slide when `only`), with the notes or only the notes. */
export function collectSlideBlocks(deck: Deck, from: number, lang: string, o: { notes: boolean; onlyNotes?: boolean; only?: boolean } = { notes: false }): SlideBlock[] {
  const en = lang.startsWith('en');
  const out: SlideBlock[] = [];
  const to = o.only ? from + 1 : deck.slides.length;
  for (let i = from; i < to && i < deck.slides.length; i++) {
    const s = deck.slides[i]!;
    const start = out.length;
    if (!o.onlyNotes) {
      out.push({ text: en ? `Slide ${i + 1}.` : `Diapositiva ${i + 1}.`, lang, ref: { slide: i, element: null } });
      for (const t of elementTexts(s.shapes)) out.push({ text: t.text, lang, ref: { slide: i, element: t.id } });
    }
    if (o.notes || o.onlyNotes) {
      const notes = paragraphs(s.notes);
      if (notes.length) {
        if (!o.onlyNotes) out.push({ text: en ? 'Notes.' : 'Notas.', lang, ref: { slide: i, element: null, notes: true } });
        else out.push({ text: en ? `Notes of slide ${i + 1}.` : `Notas de la diapositiva ${i + 1}.`, lang, ref: { slide: i, element: null, notes: true } });
        for (const t of notes) out.push({ text: t, lang, ref: { slide: i, element: null, notes: true } });
      }
    }
    // a slide with nothing to say but its number is not announced
    if (out.length - start === 1 && !o.onlyNotes) out.pop();
  }
  return out;
}

const NOTES_KEY = 'nova.slides.readNotes';

export class SlidesReader {
  readonly voice = new VoiceController();
  private blocks: SlideBlock[] = [];
  private deck: Deck | null = null;
  private mode: { notes: boolean; onlyNotes: boolean } = { notes: false, onlyNotes: false };
  private shown = -1;

  constructor(private ctl: SlidesCtl) {
    this.voice.reader.subscribe(() => this.follow());
    ctl.subscribe(() => this.check());
  }

  get visible(): boolean {
    return this.voice.visible;
  }

  /** Whether the notes are read after the text of each slide. */
  get withNotes(): boolean {
    try {
      return localStorage.getItem(NOTES_KEY) === '1';
    } catch {
      return false;
    }
  }
  set withNotes(v: boolean) {
    try {
      localStorage.setItem(NOTES_KEY, v ? '1' : '0');
    } catch {
      /* sin almacenamiento */
    }
    this.ctl.touch();
  }

  /** Reads from the open slide on: its text (and the notes, if that is on), or only the notes. */
  start(onlyNotes = false): void {
    const lang = getLocale() === 'en' ? 'en-US' : 'es-ES';
    this.mode = { notes: this.withNotes, onlyNotes };
    this.deck = this.ctl.realDeck;
    this.blocks = collectSlideBlocks(this.deck, this.ctl.index, lang, this.mode);
    this.shown = -1;
    this.voice.lang = lang;
    this.voice.start(this.blocks);
    this.ctl.touch();
  }

  stop(): void {
    if (!this.voice.visible) return;
    this.voice.close();
    this.shown = -1;
    this.ctl.touch();
  }

  /** The slide being read is shown and the object that holds the text is selected. */
  private follow(): void {
    const s = this.voice.snapshot;
    if (s.state === 'idle' || s.block < 0 || s.block === this.shown) return;
    this.shown = s.block;
    const ref = this.blocks[s.block]?.ref;
    if (!ref) return;
    if (this.ctl.index !== ref.slide) this.ctl.goTo(ref.slide);
    if (ref.notes) {
      if (!this.ctl.showNotes) {
        this.ctl.showNotes = true;
        this.ctl.touch();
      }
    } else this.ctl.select(ref.element ? [ref.element] : []);
  }

  /** If the text changes while it is read, the reading stops. */
  private check(): void {
    if (!this.voice.visible || this.ctl.realDeck === this.deck) return;
    this.deck = this.ctl.realDeck;
    const lang = this.blocks[0]?.lang ?? 'es-ES';
    const first = this.blocks[0]?.ref.slide ?? 0;
    const next = collectSlideBlocks(this.deck, first, lang, this.mode);
    const same = (a: SlideBlock[]) => a.map((b) => `${b.ref.slide}:${b.text}`).join('\n');
    if (same(next) !== same(this.blocks)) this.stop();
  }
}
