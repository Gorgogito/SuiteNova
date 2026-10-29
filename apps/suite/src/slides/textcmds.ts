import { cellsOf, docNode, levelStyle, mapDoc, mergeR, textContext, updateElement, type CellRange, type ParaProps, type RunProps, type ShapeEl, type SlideElement, type TableEl, type TextBody } from '@suitenova/slides-core';
import type { SlidesCtl } from './ctl';
import { currentRun, setPara, setRun, type EditContext } from './edit/pm';
import { shapeLayout, type CanvasCtx } from './render/SlideCanvas';
import { tableLook } from './render/table';

/*
 * Text formatting commands. While a shape's text is being edited they act on the selection of the editor; otherwise on all the text
 * of the selected shapes (and table cells), as one undo step.
 */

function textBodies(el: SlideElement): TextBody[] {
  if (el.kind === 'shape') return el.text ? [el.text] : [];
  if (el.kind === 'table') return el.rows.flatMap((r) => r.cells.map((c) => c.text)).filter((t): t is TextBody => !!t);
  return [];
}

function mapBodies(el: SlideElement, fn: (t: TextBody) => TextBody, range?: CellRange | null): SlideElement {
  if (el.kind === 'shape') {
    const base: TextBody = el.text ?? { body: {}, doc: docNode(null).toJSON() };
    return { ...el, text: fn(base) };
  }
  if (el.kind === 'table') {
    const only = range ? new Set(cellsOf(el, range).map((x) => `${x.r},${x.c}`)) : null;
    return { ...el, rows: el.rows.map((r, i) => ({ ...r, cells: r.cells.map((c, j) => (c.text && (!only || only.has(`${i},${j}`)) ? { ...c, text: fn(c.text) } : c)) })) } as TableEl;
  }
  return el;
}

/*
 * In master view the text of a placeholder is formatted through its list style (what the slides inherit), not through runs.
 */
const isPhShape = (el: SlideElement | null | undefined): el is ShapeEl => !!el && el.kind === 'shape' && !!el.ph;

function masterLevels(ctl: SlidesCtl): number[] {
  if (!ctl.editor) return [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const st = ctl.editor.state;
  const set = new Set<number>();
  st.doc.nodesBetween(st.selection.from, st.selection.to, (n) => {
    if (n.type.name === 'paragraph') set.add(n.attrs.lvl as number);
  });
  return set.size ? [...set] : [0];
}

function withList(el: ShapeEl, levels: number[], fr?: (r: RunProps) => RunProps, fp?: (p: ParaProps, lvl: number) => ParaProps | undefined): ShapeEl {
  const base: TextBody = el.text ?? { body: {}, doc: docNode(null).toJSON() };
  const lvl = [...(base.lst?.lvl ?? [])];
  for (const L of levels) {
    const cur = lvl[L] ?? {};
    const rPr = fr ? fr(cur.rPr ?? {}) : cur.rPr;
    const pPr = fp ? (fp(cur.pPr ?? {}, L) ?? cur.pPr) : cur.pPr;
    lvl[L] = { ...(pPr ? { pPr } : {}), ...(rPr ? { rPr } : {}) };
  }
  return { ...el, text: { ...base, lst: { ...base.lst, lvl } } };
}

/** Formats placeholders of the master or layout being edited. Returns true when it handled the command. */
function masterList(ctl: SlidesCtl, label: string, fr?: (r: RunProps) => RunProps, fp?: (p: ParaProps, lvl: number) => ParaProps | undefined): boolean {
  if (!ctl.inMaster) return false;
  if (ctl.editing) {
    const id = ctl.editing;
    if (!isPhShape(ctl.element(id))) return false;
    const levels = masterLevels(ctl);
    ctl.liveDeck((d) => updateElement(d, ctl.slide.id, id, (el) => withList(el as ShapeEl, levels, fr, fp)));
    ctl.editor?.focus();
    return true;
  }
  const ids = ctl.selected.filter(isPhShape).map((e) => e.id);
  if (!ids.length) return false;
  ctl.patch(ids, label, (el) => withList(el as ShapeEl, masterLevels(ctl), fr, fp));
  return true;
}

export function canFormatText(ctl: SlidesCtl): boolean {
  return !!ctl.editor || ctl.selected.some((e) => e.kind === 'shape' || e.kind === 'table');
}

export function applyRun(ctl: SlidesCtl, fn: (r: RunProps) => RunProps, label = 'Formato de texto'): void {
  if (masterList(ctl, label, fn)) return;
  if (ctl.editor) {
    setRun(fn)(ctl.editor.state, ctl.editor.dispatch);
    ctl.editor.focus();
    return;
  }
  ctl.patchSelected(label, (el) => mapBodies(el, (t) => ({ ...t, doc: mapDoc(t.doc, undefined, fn) }), ctl.cellSelection?.range));
}

export function applyPara(ctl: SlidesCtl, fn: (p: ParaProps, lvl: number) => { p?: ParaProps; lvl?: number }, label = 'Formato de párrafo'): void {
  if (masterList(ctl, label, undefined, (p, l) => fn(p, l).p)) return;
  if (ctl.editor) {
    setPara(fn)(ctl.editor.state, ctl.editor.dispatch);
    ctl.editor.focus();
    return;
  }
  ctl.patchSelected(label, (el) =>
    mapBodies(el, (t) => ({
      ...t,
      doc: mapDoc(t.doc, (a) => {
        const r = fn(a.p, a.lvl);
        return { lvl: r.lvl ?? a.lvl, p: r.p ?? a.p, end: a.end };
      }),
    }), ctl.cellSelection?.range),
  );
}

/** The properties of the run at the selection (or of the first selected shape), with the level style underneath. */
export function currentRunProps(ctl: SlidesCtl, ctx: CanvasCtx | null): RunProps {
  if (ctl.editor && ctx) {
    const el = ctl.element(ctl.editing ?? '') as ShapeEl | TableEl | null;
    const cell = ctl.editingCell;
    if (el?.kind === 'table' && cell) {
      const ec: EditContext = { tc: tableLook(ctx, el)(cell.r, cell.c).tc, env: ctx.env };
      return currentRun(ctl.editor.state, ec);
    }
    if (el && el.kind === 'shape') {
      const { tc, look } = shapeLayout(ctx, el);
      const ec: EditContext = { tc, env: ctx.env, ph: look.fillClr };
      return currentRun(ctl.editor.state, ec);
    }
  }
  const el = ctl.selected[0];
  if (!el || !ctx) return {};
  if (el.kind === 'shape') {
    const tc = textContext(ctx.deck, ctx.chain, el, true);
    const doc = docNode(el.text?.doc);
    const para = doc.firstChild;
    const ls = levelStyle(tc, (para?.attrs.lvl as number) ?? 0);
    let r = ls.rPr;
    para?.firstChild && (r = mergeR(r, para.firstChild.marks.find((m) => m.type.name === 'run')?.attrs.r as RunProps | undefined));
    return r;
  }
  return {};
}

export function currentParaProps(ctl: SlidesCtl, ctx: CanvasCtx | null): ParaProps & { lvl: number } {
  if (!ctx) return { lvl: 0 };
  const id = ctl.editing ?? ctl.selection[0];
  const el = id ? (ctl.element(id) as SlideElement | null) : null;
  const cell = ctl.editingCell;
  if (el?.kind === 'table' && cell && ctl.editor) {
    const $f = ctl.editor.state.selection.$from;
    const para = $f.depth >= 1 ? $f.node(1) : ctl.editor.state.doc.firstChild;
    const lvl = (para?.attrs.lvl as number) ?? 0;
    return { ...levelStyle(tableLook(ctx, el)(cell.r, cell.c).tc, lvl).pPr, ...((para?.attrs.p as ParaProps) ?? {}), lvl };
  }
  if (!el || el.kind !== 'shape') return { lvl: 0 };
  const tc = textContext(ctx.deck, ctx.chain, el, true);
  const doc = ctl.editor ? ctl.editor.state.doc : docNode(el.text?.doc);
  let para = doc.firstChild;
  if (ctl.editor) {
    const $f = ctl.editor.state.selection.$from;
    para = $f.depth >= 1 ? $f.node(1) : doc.firstChild;
  }
  const lvl = (para?.attrs.lvl as number) ?? 0;
  const ls = levelStyle(tc, lvl);
  return { ...ls.pPr, ...((para?.attrs.p as ParaProps) ?? {}), lvl };
}

export { textBodies };

/** The text formatting a format painter carries: the run and paragraph properties at the cursor (or of the first paragraph). */
export interface TextFormat {
  r: RunProps;
  p: ParaProps;
}

/** Applies painted text formatting to all the text of some objects, as one undo step. */
export function applyTextFormat(ctl: SlidesCtl, ids: string[], f: TextFormat, label = 'Copiar formato'): void {
  const r = { ...f.r };
  delete r.hlink;
  ctl.patch(ids, label, (el) =>
    mapBodies(el, (t) => ({
      ...t,
      doc: mapDoc(
        t.doc,
        (a) => ({ lvl: a.lvl, p: { ...a.p, ...f.p }, end: { ...a.end, ...r } }),
        (run) => ({ ...run, ...r }),
      ),
    })),
  );
}
