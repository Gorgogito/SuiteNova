import { getLocale } from '@suitenova/core-ui';
import { formatA1, isRowHidden, normRect } from '@suitenova/calc-engine';
import type { Block } from '@suitenova/speech-core';
import { VoiceController } from '../voice/controller';
import type { CalcDoc } from './doc';

/*
 * «Hablar celdas» in Calc (as in Excel): the selected cells are read one by one, by rows or by columns, saying what each cell shows (not its formula);
 * it can also say each cell as it is entered. The selection is left as it is (the bar shows which cell is being read).
 */

export interface CellRef {
  sheetId: number;
  row: number;
  col: number;
  address: string;
}
export interface CellBlock extends Block {
  ref: CellRef;
}

const ORDER_KEY = 'nova.calc.speakOrder';
const ENTER_KEY = 'nova.calc.speakEnter';
/** More cells than this are not read (a whole column would be a million). */
const MAX_CELLS = 5000;

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

export class CalcReader {
  readonly voice = new VoiceController();
  private blocks: CellBlock[] = [];

  constructor(private doc: CalcDoc) {
    // a cell that is entered is said when «al pulsar Intro» is on
    doc.onCommitted = (sheetId, row, col) => {
      if (!this.speakOnEnter || this.voice.visible) return;
      const text = doc.display(sheetId, row, col).text.trim();
      if (!text) return;
      const lang = getLocale() === 'en' ? 'en-US' : 'es-ES';
      this.voice.lang = lang;
      this.voice.reader.load([{ text, lang }]);
      this.voice.reader.play();
    };
  }

  get visible(): boolean {
    return this.voice.visible;
  }

  /** By rows (left to right, then down) or by columns (top to bottom, then right). */
  get byColumns(): boolean {
    return load(ORDER_KEY) === 'columns';
  }
  set byColumns(v: boolean) {
    store(ORDER_KEY, v ? 'columns' : 'rows');
    this.doc.touch();
  }
  get speakOnEnter(): boolean {
    return load(ENTER_KEY) === '1';
  }
  set speakOnEnter(v: boolean) {
    store(ENTER_KEY, v ? '1' : '0');
    if (!v) this.voice.reader.stop();
    this.doc.touch();
  }

  /** The cells of the selection that have something to say, in the order chosen. */
  collect(): CellBlock[] {
    const d = this.doc;
    const lang = getLocale() === 'en' ? 'en-US' : 'es-ES';
    const out: CellBlock[] = [];
    const sheet = d.sheet;
    for (const r of d.sel.ranges) {
      const n = normRect(r);
      const single = n.r1 === n.r2 && n.c1 === n.c2;
      const cells: [number, number][] = [];
      if (this.byColumns) for (let c = n.c1; c <= n.c2; c++) for (let row = n.r1; row <= n.r2; row++) cells.push([row, c]);
      else for (let row = n.r1; row <= n.r2; row++) for (let c = n.c1; c <= n.c2; c++) cells.push([row, c]);
      for (const [row, c] of cells) {
        if (out.length >= MAX_CELLS) break;
        // hidden rows and columns are not read (unless it is the one cell the person is on)
        if (!single && (isRowHidden(sheet, row) || sheet.hiddenCols.has(c))) continue;
        const text = d.display(d.activeSheetId, row, c).text.trim();
        if (text) out.push({ text, lang, ref: { sheetId: d.activeSheetId, row, col: c, address: formatA1(row, c) } });
      }
    }
    return out;
  }

  /** Reads the selected cells (or the one cell). */
  start(): void {
    const lang = getLocale() === 'en' ? 'en-US' : 'es-ES';
    this.blocks = this.collect();
    this.voice.lang = lang;
    this.voice.start(this.blocks);
    this.doc.touch();
  }

  stop(): void {
    this.voice.reader.stop();
    if (!this.voice.visible) return;
    this.voice.close();
    this.doc.touch();
  }

  /** What is shown before the sentence in the bar: the address of the cell being read. */
  label(block: number): string {
    const b = this.blocks[block];
    return b ? `${b.ref.address}: ` : '';
  }
}
