import { formatA1, type Rect, type Style } from '@suitenova/calc-engine';
import { rgbOf, vbString, type MacroRecorder } from '../macros/recorder';
import type { CalcDoc } from './doc';

const HALIGN: Record<string, string> = { left: 'xlLeft', center: 'xlCenter', right: 'xlRight', general: 'xlGeneral' };
const bool = (v: unknown) => (v ? 'True' : 'False');

/** The address of a rectangle of cells (`B2`, `A1:C3`). */
export function rectAddress(r: Rect): string {
  const a = formatA1(r.r1, r.c1);
  return r.r1 === r.r2 && r.c1 === r.c2 ? a : `${a}:${formatA1(r.r2, r.c2)}`;
}

/** The `Selection` lines that set one style property, or null when macros cannot set it. */
function styleLine(key: keyof Style, value: unknown): string | null {
  switch (key) {
    case 'bold':
      return `Selection.Font.Bold = ${bool(value)}`;
    case 'italic':
      return `Selection.Font.Italic = ${bool(value)}`;
    case 'underline':
      return `Selection.Font.Underline = ${bool(value)}`;
    case 'strike':
      return `Selection.Font.Strikethrough = ${bool(value)}`;
    case 'fontSize':
      return value === undefined ? null : `Selection.Font.Size = ${Number(value)}`;
    case 'fontName':
      return value === undefined ? null : `Selection.Font.Name = ${vbString(String(value))}`;
    case 'color':
      return value === undefined ? 'Selection.Font.Color = 0' : `Selection.Font.Color = ${rgbOf(String(value))}`;
    case 'bg':
      return value === undefined ? 'Selection.Interior.ColorIndex = xlNone' : `Selection.Interior.Color = ${rgbOf(String(value))}`;
    case 'numFmt':
      return `Selection.NumberFormat = ${vbString(value === undefined ? 'General' : String(value))}`;
    case 'hAlign':
      return HALIGN[String(value ?? 'general')] ? `Selection.HorizontalAlignment = ${HALIGN[String(value ?? 'general')]}` : null;
    case 'wrap':
      return `Selection.WrapText = ${bool(value)}`;
    default:
      return null;
  }
}

const STYLE_LABEL: Partial<Record<keyof Style, string>> = {
  vAlign: 'alineación vertical',
  indent: 'sangría',
  top: 'bordes',
  right: 'bordes',
  bottom: 'bordes',
  left: 'bordes',
  locked: 'bloqueo de celdas',
  hidden: 'ocultar fórmula',
};

/**
 * Records what the user does in a workbook as lines of Nova Basic with the Excel object model (`Range("B2").Select`, `Range("B2").Formula = …`,
 * `Selection.Font.Bold = True`…). It listens by wrapping the methods of the document that the commands call (and puts them back when it stops).
 * Selecting is written only when the next action needs it. What it cannot translate is written as a comment.
 */
export class CalcRecorder {
  private depth = 0;
  private undo: (() => void)[] = [];
  /** Where the selection is when the macro, replayed, reaches this point. */
  private sheet: number;
  private rect: Rect;

  constructor(
    private readonly rec: MacroRecorder,
    private readonly doc: CalcDoc,
  ) {
    this.sheet = doc.activeSheetId;
    this.rect = { ...doc.activeRange };
    this.install();
  }

  private get on(): boolean {
    return !this.rec.paused && !this.doc.macros.running;
  }

  /** Writes the lines that put the selection where the user has it. */
  private ensure(): void {
    const d = this.doc;
    if (d.activeSheetId !== this.sheet) {
      this.rec.add(`Worksheets(${vbString(d.wb.sheet(d.activeSheetId).name)}).Activate`);
      this.sheet = d.activeSheetId;
      this.rect = { r1: -1, c1: -1, r2: -1, c2: -1 };
    }
    const r = d.activeRange;
    if (r.r1 !== this.rect.r1 || r.c1 !== this.rect.c1 || r.r2 !== this.rect.r2 || r.c2 !== this.rect.c2) this.rec.add(`Range("${rectAddress(r)}").Select`);
    this.rect = { ...r };
  }

  /** Wraps `name` so that, when it is the outermost call, `emit` writes what it did. `before` runs first and hands its result to `emit`. */
  private hook<K extends keyof CalcDoc>(name: K, before: ((args: unknown[]) => unknown) | null, emit: (args: unknown[], result: unknown, ctx: unknown) => void): void {
    const doc = this.doc as unknown as Record<string, (...a: unknown[]) => unknown>;
    const orig = doc[name as string]!;
    doc[name as string] = (...args: unknown[]) => {
      if (this.depth > 0 || !this.on) return orig.apply(this.doc, args);
      const ctx = before?.(args);
      this.depth++;
      let result: unknown;
      try {
        result = orig.apply(this.doc, args);
      } finally {
        this.depth--;
      }
      if (this.on) emit(args, result, ctx);
      return result;
    };
    this.undo.push(() => {
      doc[name as string] = orig;
    });
  }

  private install(): void {
    const d = this.doc;
    // writing in a cell
    this.hook(
      'commitEdit',
      () => (d.edit ? { sheetId: d.edit.sheetId, row: d.edit.row, col: d.edit.col, text: d.edit.text } : null),
      (_a, result, ctx) => {
        const e = ctx as { sheetId: number; row: number; col: number; text: string } | null;
        if (!e || result !== null) return;
        if (e.sheetId !== this.sheet) {
          this.rec.add(`Worksheets(${vbString(d.wb.sheet(e.sheetId).name)}).Activate`);
          this.sheet = e.sheetId;
          this.rect = { r1: -1, c1: -1, r2: -1, c2: -1 };
        }
        // a formula starts with "="; the rest is read as typed (a number, a date, text), which is what `Value` does
        this.rec.add(`Range("${formatA1(e.row, e.col)}").${e.text.startsWith('=') ? 'Formula' : 'Value'} = ${vbString(e.text)}`);
      },
    );
    this.hook('applyStyle', null, (args) => {
      const patch = (args[0] ?? {}) as Partial<Record<keyof Style, unknown>>;
      this.ensure();
      for (const k of Object.keys(patch) as (keyof Style)[]) {
        const line = styleLine(k, patch[k]);
        if (line) this.rec.add(line);
        else this.rec.unsupported(`formato de celda (${STYLE_LABEL[k] ?? k})`);
      }
    });
    this.hook('toggleStyle', null, (args) => {
      const key = args[0] as 'bold' | 'italic' | 'underline' | 'strike' | 'wrap';
      this.ensure();
      this.rec.add(styleLine(key as keyof Style, d.currentStyle()[key])!);
    });
    this.hook('merge', null, (args) => {
      this.ensure();
      this.rec.add('Selection.Merge');
      if (args[0]) this.rec.add('Selection.HorizontalAlignment = xlCenter');
    });
    this.hook('unmerge', null, () => {
      this.ensure();
      this.rec.add('Selection.UnMerge');
    });
    const sel = (line: string) => () => {
      this.ensure();
      this.rec.add(line);
    };
    this.hook('clearContents', null, sel('Selection.ClearContents'));
    this.hook('clearAll', null, (args) => {
      this.ensure();
      this.rec.add(args[0] === 'formats' ? 'Selection.ClearFormats' : args[0] === 'contents' ? 'Selection.ClearContents' : 'Selection.Clear');
    });
    this.hook('insertRows', null, sel('Selection.EntireRow.Insert'));
    this.hook('deleteRows', null, sel('Selection.EntireRow.Delete'));
    this.hook('insertCols', null, sel('Selection.EntireColumn.Insert'));
    this.hook('deleteCols', null, sel('Selection.EntireColumn.Delete'));
    this.hook('addSheet', null, () => {
      this.rec.add('Worksheets.Add');
      // the new sheet is the active one, with its first cell selected
      this.sheet = d.activeSheetId;
      this.rect = { ...d.activeRange };
    });
    // everything else that changes the workbook is left as a comment
    this.hook('run', null, (args) => this.rec.unsupported(String(args[0] ?? 'cambio en el libro')));
  }

  /** Stops listening and puts the document back as it was. */
  stop(): void {
    for (const u of this.undo.reverse()) u();
    this.undo = [];
  }
}
