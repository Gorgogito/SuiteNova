import { getLocale } from '@suitenova/core-ui';
import { formatAddress, parseMessage, rawOf } from '@suitenova/mail-core';
import type { Block } from '@suitenova/speech-core';
import { VoiceController } from '../voice/controller';
import { speechLang } from '../voice/lang';
import type { MailCtl } from './ctl';

/*
 * Read Aloud in Mail (as in Outlook): the open message is read, first who it is from and the subject, then the body as it is shown. The body is in a
 * frame, so its text is taken from the frame's own page (paragraph by paragraph, with the place of every character) and the sentence and the word
 * being read are drawn on it with the browser's text highlights. When the message that is open changes, the reading stops.
 */

const BLOCKS = 'p,div,li,h1,h2,h3,h4,h5,h6,td,th,pre,blockquote,dd,dt,figcaption,caption';
const SKIP = 'script,style,noscript,template,head,[hidden],[aria-hidden="true"]';

interface Spot {
  node: Text;
  offset: number;
}
export interface DomBlock extends Block {
  /** For each character of the text, where it is in the page of the frame. */
  spots: Spot[];
}

/** The paragraphs of a page: the text nodes grouped by the block that holds them, with white space collapsed (as it is shown). */
export function domBlocks(doc: Document, lang: string): DomBlock[] {
  const out: DomBlock[] = [];
  if (!doc.body) return out;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let cur: { el: Element; text: string; spots: Spot[]; lang: string } | null = null;
  const flush = () => {
    if (cur && cur.text.trim()) out.push({ text: cur.text, lang: cur.lang, spots: cur.spots });
    cur = null;
  };
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const parent = n.parentElement;
    if (!parent || parent.closest(SKIP)) continue;
    const el = parent.closest(BLOCKS) ?? doc.body;
    if (!cur || cur.el !== el) {
      flush();
      // a block (or a part of the message) that says what language it is in is read in it
      cur = { el, text: '', spots: [], lang: speechLang(el.closest('[lang]')?.getAttribute('lang'), lang) };
    }
    const s = n.data;
    for (let i = 0; i < s.length; i++) {
      const c = /\s/.test(s[i]!) ? ' ' : s[i]!;
      if (c === ' ' && (cur.text === '' || cur.text.endsWith(' '))) continue;
      cur.text += c;
      cur.spots.push({ node: n, offset: i });
    }
  }
  flush();
  return out;
}

export class MailReader {
  readonly voice = new VoiceController();
  private blocks: (Block & { spots?: Spot[] })[] = [];
  private id: string | null = null;
  private doc: Document | null = null;

  constructor(private ctl: MailCtl) {
    this.voice.reader.subscribe(() => this.show());
    ctl.subscribe(() => this.check());
  }

  get visible(): boolean {
    return this.voice.visible;
  }

  /** The frame that shows the open message. */
  private frame(): HTMLIFrameElement | null {
    return document.querySelector<HTMLIFrameElement>('iframe.ml-frame');
  }

  /** Reads the open message: who sent it, the subject and the body. */
  start(): void {
    const rec = this.ctl.selected;
    if (!rec) return;
    const m = parseMessage(rawOf(rec));
    // the language the message says it is in (Content-Language), else the one of the interface
    const header = m.headers.find(([n]) => n.toLowerCase() === 'content-language')?.[1]?.split(',')[0]?.trim();
    const lang = speechLang(header, getLocale() === 'en' ? 'en-US' : 'es-ES');
    const en = lang.toLowerCase().startsWith('en');
    const from = m.from[0] ? m.from[0].name || formatAddress(m.from[0]) : '';
    const head: Block[] = [];
    if (from) head.push({ text: en ? `Message from ${from}.` : `Mensaje de ${from}.`, lang });
    if (m.subject.trim()) head.push({ text: en ? `Subject: ${m.subject.trim()}.` : `Asunto: ${m.subject.trim()}.`, lang });
    this.doc = this.frame()?.contentDocument ?? null;
    const body = this.doc ? domBlocks(this.doc, lang) : [];
    this.blocks = [...head, ...body];
    this.id = rec.id;
    this.voice.lang = lang;
    this.voice.start(this.blocks);
    this.ctl.touch();
  }

  stop(): void {
    if (!this.voice.visible) return;
    this.voice.close();
    this.clear();
    this.id = null;
    this.ctl.touch();
  }

  private clear(): void {
    const w = this.doc?.defaultView as (Window & { CSS?: { highlights?: Map<string, unknown> } }) | null | undefined;
    w?.CSS?.highlights?.delete('nv-piece');
    w?.CSS?.highlights?.delete('nv-word');
  }

  /** The sentence and the word being read are drawn on the message. */
  private show(): void {
    const doc = this.doc;
    const w = doc?.defaultView as (Window & { CSS?: { highlights?: Map<string, unknown> }; Highlight?: new (...r: Range[]) => unknown }) | null | undefined;
    if (!doc || !w?.CSS?.highlights || !w.Highlight) return;
    if (!doc.getElementById('nv-read-style')) {
      const st = doc.createElement('style');
      st.id = 'nv-read-style';
      st.textContent = '::highlight(nv-piece){background:rgba(60,140,255,.18)}::highlight(nv-word){background:#ffd54a;color:#000}';
      doc.head.appendChild(st);
    }
    const s = this.voice.snapshot;
    const b = s.block >= 0 ? this.blocks[s.block] : undefined;
    const spots = b?.spots;
    const range = (a: number, e: number): Range | null => {
      if (!spots || !spots[a] || !spots[Math.max(a, e - 1)]) return null;
      const r = doc.createRange();
      const first = spots[a]!;
      const last = spots[Math.max(a, e - 1)]!;
      r.setStart(first.node, first.offset);
      r.setEnd(last.node, last.offset + 1);
      return r;
    };
    this.clear();
    if (s.state === 'idle' || !s.piece) return;
    const piece = range(s.piece.start, s.piece.end);
    const word = s.word ? range(s.word.start, s.word.end) : null;
    if (piece) w.CSS.highlights.set('nv-piece', new w.Highlight(piece));
    if (word) {
      w.CSS.highlights.set('nv-word', new w.Highlight(word));
      word.startContainer.parentElement?.scrollIntoView?.({ block: 'nearest' });
    }
  }

  /** Reading stops when another message is opened (or this one goes away). */
  private check(): void {
    if (!this.voice.visible) return;
    if (this.ctl.selected?.id !== this.id) this.stop();
  }
}
