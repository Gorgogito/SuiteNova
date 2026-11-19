import type { Mark, Node as PMNode } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from 'prosemirror-transform';
import { rgbOf, type MacroRecorder } from '../macros/recorder';
import { STYLE_LABEL } from './macros';
import { blocksIn, buildStory, posToOffset, type Story } from './story';

const ALIGN = ['wdAlignParagraphLeft', 'wdAlignParagraphCenter', 'wdAlignParagraphRight', 'wdAlignParagraphJustify'];
const ALIGN_ATTR = ['left', 'center', 'right', 'justify'];

/** Paragraph attributes a macro can set, with the `ParagraphFormat` property that sets them and what a missing value means. */
const PARA: Record<string, { prop: string; def: number | boolean; kind: 'num' | 'bool' }> = {
  indentLeft: { prop: 'LeftIndent', def: 0, kind: 'num' },
  indentRight: { prop: 'RightIndent', def: 0, kind: 'num' },
  indentFirst: { prop: 'FirstLineIndent', def: 0, kind: 'num' },
  spaceBefore: { prop: 'SpaceBefore', def: 0, kind: 'num' },
  spaceAfter: { prop: 'SpaceAfter', def: 8, kind: 'num' },
  keepNext: { prop: 'KeepWithNext', def: false, kind: 'bool' },
  pageBreakBefore: { prop: 'PageBreakBefore', def: false, kind: 'bool' },
};

const bool = (on: boolean) => (on ? 'True' : 'False');

/** The `Selection.Font` line that sets a mark on (`on`) or off, or null when macros cannot set that mark. */
function fontLine(mark: Mark, on: boolean): string | null {
  switch (mark.type.name) {
    case 'strong':
      return `Selection.Font.Bold = ${bool(on)}`;
    case 'em':
      return `Selection.Font.Italic = ${bool(on)}`;
    case 'underline':
      return `Selection.Font.Underline = ${on ? 'wdUnderlineSingle' : 'wdUnderlineNone'}`;
    case 'strike':
      return `Selection.Font.Strikethrough = ${bool(on)}`;
    case 'superscript':
      return `Selection.Font.Superscript = ${bool(on)}`;
    case 'subscript':
      return `Selection.Font.Subscript = ${bool(on)}`;
    case 'fontSize':
      return on ? `Selection.Font.Size = ${mark.attrs.value}` : null;
    case 'fontFamily':
      return on ? `Selection.Font.Name = "${String(mark.attrs.value).replace(/"/g, '""')}"` : null;
    case 'color':
      return on ? `Selection.Font.Color = ${rgbOf(String(mark.attrs.value))}` : 'Selection.Font.Color = wdColorAutomatic';
    default:
      return null;
  }
}

/**
 * Turns what the user does in the document into lines of Nova Basic with the Word object model (`Selection.TypeText`, `Selection.Font.Bold`,
 * `Selection.ParagraphFormat.Alignment`…). Moving the selection is written only when the next action needs it (`Selection.SetRange`), so the
 * macro does not fill up with every click. Whatever it cannot translate is written as a comment.
 */
export class WriterRecorder {
  /** Where the selection is when the macro, replayed, reaches this point (offsets of the story). */
  private sel: { a: number; b: number };
  private stories = new WeakMap<PMNode, Story>();

  constructor(
    readonly rec: MacroRecorder,
    state: EditorState,
  ) {
    this.sel = this.selOffsets(state.doc, state.selection.from, state.selection.to);
  }

  private story(doc: PMNode): Story {
    let s = this.stories.get(doc);
    if (!s) this.stories.set(doc, (s = buildStory(doc)));
    return s;
  }
  private off(doc: PMNode, pos: number): number {
    return posToOffset(this.story(doc), pos);
  }
  private selOffsets(doc: PMNode, from: number, to: number): { a: number; b: number } {
    return { a: this.off(doc, from), b: this.off(doc, to) };
  }

  /** Writes `Selection.SetRange` unless the selection already is where the macro needs it. */
  private ensure(a: number, b: number): void {
    if (this.sel.a !== a || this.sel.b !== b) this.rec.add(`Selection.SetRange Start:=${a}, End:=${b}`);
    this.sel = { a, b };
  }

  /** Called with every transaction of the document view, after it was applied. */
  observe(tr: Transaction, before: EditorState, after: EditorState): void {
    if (this.rec.paused) {
      // while paused the selection is not followed: the macro continues from where the user is when recording resumes
      this.sel = this.selOffsets(after.doc, after.selection.from, after.selection.to);
      return;
    }
    if (tr.getMeta('nw-load') || !tr.docChanged) return;
    const steps = tr.steps;
    let structural = false;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const docBefore = tr.docs[i]!;
      const docAfter = i + 1 < tr.docs.length ? tr.docs[i + 1]! : tr.doc;
      if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
        // contiguous steps of the same mark over the same selection are one line
        let from = step.from;
        let to = step.to;
        let j = i;
        while (j + 1 < steps.length) {
          const nx = steps[j + 1]!;
          if ((nx instanceof AddMarkStep || nx instanceof RemoveMarkStep) && nx.constructor === step.constructor && nx.mark.eq(step.mark)) {
            from = Math.min(from, nx.from);
            to = Math.max(to, nx.to);
            j++;
          } else break;
        }
        i = j;
        const line = fontLine(step.mark, step instanceof AddMarkStep);
        if (line) {
          this.ensure(this.off(docAfter, from), this.off(docAfter, to));
          this.rec.add(line);
        } else this.rec.unsupported(`formato de texto (${step.mark.type.name})`);
        continue;
      }
      if (step instanceof ReplaceStep) {
        if (!this.replace(step, docBefore, docAfter)) structural = true;
        continue;
      }
      structural = true;
    }
    if (structural) this.paragraphs(before, after);
    // whatever the macro leaves selected is what the user left
    this.sel = this.selOffsets(after.doc, after.selection.from, after.selection.to);
  }

  /** A text insertion, a deletion or a paragraph split. Returns false when it is something else. */
  private replace(step: ReplaceStep, docBefore: PMNode, docAfter: PMNode): boolean {
    const { from, to, slice } = step;
    const content = slice.content;
    const offFrom = this.off(docBefore, from);
    const offTo = this.off(docBefore, to);
    // Enter
    if (content.childCount === 2 && slice.openStart >= 1 && slice.openEnd >= 1) {
      this.ensure(offFrom, offTo);
      if (to > from) this.rec.add('Selection.Delete'); // Enter over a selection replaces it
      this.rec.add('Selection.TypeParagraph');
      this.sel = { a: offFrom + 1, b: offFrom + 1 };
      return true;
    }
    let text = '';
    let plain = true;
    const marks: Mark[] = [];
    content.forEach((n) => {
      if (!n.isText) plain = false;
      else {
        text += n.text;
        for (const m of n.marks) if (!marks.some((x) => x.eq(m))) marks.push(m);
      }
    });
    if (!plain || slice.openStart || slice.openEnd) {
      this.rec.unsupported(content.size ? 'insertar un objeto o pegar con formato' : 'cambio en el documento');
      return true; // handled (as a comment): nothing else to look at
    }
    if (!text) {
      if (to === from) return true;
      // a deletion: Backspace has the caret right after what it removes
      if (offTo === offFrom + 1 && this.sel.a === offTo && this.sel.b === offTo) {
        this.rec.add('Selection.TypeBackspace');
      } else {
        this.ensure(offFrom, offTo);
        this.rec.add('Selection.Delete');
      }
      this.sel = { a: offFrom, b: offFrom };
      return true;
    }
    // formatting that differs from what the text inherits (typing after bold text is bold without asking for it)
    const inherited = docBefore.resolve(from).marks();
    const lines: string[] = [];
    for (const m of marks) if (!inherited.some((i) => i.eq(m))) (fontLine(m, true) ? lines.push(fontLine(m, true)!) : this.rec.unsupported(`formato de texto (${m.type.name})`));
    for (const i of inherited) if (!marks.some((m) => m.eq(i))) (fontLine(i, false) ? lines.push(fontLine(i, false)!) : this.rec.unsupported(`formato de texto (${i.type.name})`));
    const end = offFrom + text.length;
    if (from === to) {
      // at the insertion point: the format is set there, and then the text is typed
      this.ensure(offFrom, offFrom);
      for (const l of lines) this.rec.add(l);
      this.rec.type(text);
    } else {
      // over a selection: the text replaces it, and the format is applied to what was typed
      this.ensure(offFrom, offTo);
      this.rec.type(text);
      if (lines.length) {
        this.rec.add(`Selection.SetRange Start:=${offFrom}, End:=${end}`);
        for (const l of lines) this.rec.add(l);
        this.rec.add(`Selection.SetRange Start:=${end}, End:=${end}`);
      }
    }
    this.sel = { a: end, b: end };
    void docAfter;
    return true;
  }

  /** The paragraph formats that changed in the paragraphs of the selection (the document text is the same). */
  private paragraphs(before: EditorState, after: EditorState): void {
    const sb = this.story(before.doc);
    const sa = this.story(after.doc);
    if (sb.text !== sa.text || sb.blocks.length !== sa.blocks.length) {
      this.rec.unsupported('cambio de estructura del documento (tablas, listas, objetos…)');
      return;
    }
    const a = this.off(before.doc, before.selection.from);
    const b = this.off(before.doc, before.selection.to);
    const hit = blocksIn(sb, a, b);
    let any = false;
    const lines: string[] = [];
    const notes: string[] = [];
    for (const blk of hit) {
      const i = sb.blocks.indexOf(blk);
      const x = blk.node;
      const y = sa.blocks[i]!.node;
      if (x.type !== y.type) notes.push('tipo de párrafo');
      const keys = new Set([...Object.keys(x.attrs), ...Object.keys(y.attrs)]);
      for (const k of keys) {
        const vx = x.attrs[k] ?? null;
        const vy = y.attrs[k] ?? null;
        if (JSON.stringify(vx) === JSON.stringify(vy)) continue;
        any = true;
        if (k === 'align') {
          const idx = ALIGN_ATTR.indexOf((vy as string | null) ?? 'left');
          lines.push(idx >= 0 ? `Selection.ParagraphFormat.Alignment = ${ALIGN[idx]}` : '');
        } else if (k === 'style') {
          const label = STYLE_LABEL[(vy as string | null) ?? 'Normal'];
          lines.push(label ? `Selection.Style = "${label}"` : '');
        } else if (PARA[k]) {
          const p = PARA[k]!;
          const v = vy ?? p.def;
          lines.push(`Selection.ParagraphFormat.${p.prop} = ${p.kind === 'bool' ? bool(Boolean(v)) : Number(v)}`);
        } else lines.push('');
        if (lines[lines.length - 1] === '') notes.push(`formato de párrafo (${k})`);
      }
    }
    const unique = [...new Set(lines.filter(Boolean))];
    if (unique.length) {
      this.ensure(a, b);
      for (const l of unique) this.rec.add(l);
    }
    for (const n of new Set(notes)) this.rec.unsupported(n);
    if (!any && !notes.length) this.rec.unsupported('cambio de formato de párrafo');
  }
}
