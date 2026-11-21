import type { Block } from '@suitenova/speech-core';
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { VoiceController } from '../voice/controller';
import type { WriterCtl } from './doc';

/*
 * Read Aloud in Writer. The text of the document is given to the shared reader paragraph by paragraph (headings, list items and table cells are
 * paragraphs too), each with the place of every character in the document, so that the sentence and the word being read are shown where they are.
 * It starts at the cursor (or reads what is selected), and stops by itself if the text changes.
 */

interface Range {
  from: number;
  to: number;
}
interface ReadState {
  piece: Range | null;
  word: Range | null;
}

export const readKey = new PluginKey<ReadState>('read');

/** The sentence and the word being read, drawn over the document. */
export function readPlugin(): Plugin<ReadState> {
  return new Plugin<ReadState>({
    key: readKey,
    state: {
      init: () => ({ piece: null, word: null }),
      apply(tr, value) {
        const meta = tr.getMeta(readKey) as ReadState | undefined;
        if (meta) return meta;
        if (!tr.docChanged || (!value.piece && !value.word)) return value;
        const map = (r: Range | null): Range | null => (r ? { from: tr.mapping.map(r.from), to: tr.mapping.map(r.to) } : null);
        return { piece: map(value.piece), word: map(value.word) };
      },
    },
    props: {
      decorations(state) {
        const s = readKey.getState(state);
        if (!s || (!s.piece && !s.word)) return null;
        const size = state.doc.content.size;
        const ok = (r: Range | null): r is Range => !!r && r.from < r.to && r.from >= 0 && r.to <= size;
        const list: Decoration[] = [];
        if (ok(s.piece)) list.push(Decoration.inline(s.piece.from, s.piece.to, { class: 'nw-reading-piece' }));
        if (ok(s.word)) list.push(Decoration.inline(s.word.from, s.word.to, { class: 'nw-reading' }));
        return list.length ? DecorationSet.create(state.doc, list) : null;
      },
    },
  });
}

/** A paragraph to read: its text and, for each character, where it is in the document. */
export interface ReadBlock extends Block {
  pos: number[];
}

/** The paragraphs of the document (or of a part of it), with what is deleted by a tracked change left out. */
export function collectBlocks(doc: PMNode, lang: string, range?: Range): ReadBlock[] {
  const out: ReadBlock[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const at: number[] = [];
    node.forEach((child, offset) => {
      const cpos = pos + 1 + offset;
      if (child.isText) {
        if (child.marks.some((m) => m.type.name === 'del')) return;
        for (let k = 0; k < child.text!.length; k++) {
          const p = cpos + k;
          if (range && (p < range.from || p >= range.to)) continue;
          text += child.text![k];
          at.push(p);
        }
      } else if (child.type.name === 'hard_break' && (!range || (cpos >= range.from && cpos < range.to))) {
        text += '\n';
        at.push(cpos);
      }
    });
    if (text.trim()) out.push({ text, lang, pos: at });
    return false;
  });
  return out;
}

const readLang = (l: string): string => (l === 'off' || l === 'es' ? 'es-ES' : l === 'en' ? 'en-US' : l);

export class WriterReader {
  readonly voice = new VoiceController();
  private blocks: ReadBlock[] = [];
  private doc: PMNode | null = null;
  private lastWord = '';
  private selected = false;

  constructor(private ctl: WriterCtl) {
    this.voice.reader.subscribe(() => this.show());
    ctl.subscribe(() => this.check());
  }

  get visible(): boolean {
    return this.voice.visible;
  }

  /** Starts reading: what is selected, or the document from the cursor. */
  start(): void {
    const v = this.ctl.mainView;
    if (!v) return;
    const sel = v.state.selection;
    const lang = readLang(this.ctl.spellLang);
    this.voice.lang = lang;
    this.doc = v.state.doc;
    const selected = !sel.empty && sel.from !== sel.to;
    this.selected = selected;
    this.blocks = collectBlocks(v.state.doc, lang, selected ? { from: sel.from, to: sel.to } : undefined);
    if (!this.blocks.length) {
      this.voice.start([]);
      this.ctl.touch();
      return;
    }
    let locate: { block: number; offset: number } | undefined;
    if (!selected) {
      const bi = this.blocks.findIndex((b) => b.pos[b.pos.length - 1]! >= sel.from);
      if (bi >= 0) {
        const b = this.blocks[bi]!;
        locate = { block: bi, offset: Math.max(0, b.pos.findIndex((p) => p >= sel.from)) };
      }
    }
    this.voice.start(this.blocks, locate);
    this.ctl.touch();
  }

  stop(): void {
    if (!this.voice.visible) return;
    this.voice.close();
    this.clear();
    this.ctl.touch();
  }

  /** What the voice is reading is shown in the document. */
  private show(): void {
    const v = this.ctl.mainView;
    if (!v) return;
    const s = this.voice.snapshot;
    const b = s.block >= 0 ? this.blocks[s.block] : undefined;
    let state: ReadState = { piece: null, word: null };
    if (b && s.state !== 'idle' && s.piece) {
      const rng = (a: number, e: number): Range | null => (b.pos[a] !== undefined && b.pos[Math.max(a, e - 1)] !== undefined ? { from: b.pos[a]!, to: b.pos[Math.max(a, e - 1)]! + 1 } : null);
      state = { piece: rng(s.piece.start, s.piece.end), word: s.word ? rng(s.word.start, s.word.end) : null };
    }
    const cur = readKey.getState(v.state);
    if (cur && JSON.stringify(cur) === JSON.stringify(state)) return;
    v.dispatch(v.state.tr.setMeta(readKey, state).setMeta('addToHistory', false));
    // the word is kept in view
    const key = state.word ? `${state.word.from}` : '';
    if (key && key !== this.lastWord) {
      this.lastWord = key;
      requestAnimationFrame(() => v.dom.querySelector('.nw-reading')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    }
  }

  private clear(): void {
    const v = this.ctl.mainView;
    this.lastWord = '';
    if (v && readKey.getState(v.state)?.piece) v.dispatch(v.state.tr.setMeta(readKey, { piece: null, word: null }).setMeta('addToHistory', false));
  }

  /** If the text changes while it is read, the reading stops (what is shown would not be what is heard). */
  private check(): void {
    const v = this.ctl.mainView;
    if (!v || !this.voice.visible || v.state.doc === this.doc) return;
    this.doc = v.state.doc;
    // a selection that was being read is not looked for again: any change stops it
    if (this.selected) return this.stop();
    const next = collectBlocks(v.state.doc, this.blocks[0]?.lang ?? 'es-ES');
    const text = (a: ReadBlock[]) => a.map((b) => b.text).join('\n');
    // the same text with other positions (a picture read, a style) goes on; other text stops
    if (next.length !== this.blocks.length || text(next) !== text(this.blocks)) this.stop();
    else this.blocks.forEach((b, i) => (b.pos = next[i]!.pos));
  }
}
