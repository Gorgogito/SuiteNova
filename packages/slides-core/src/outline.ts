import { addSlide, deleteSlides, updateSlide } from './ops';
import { docNode, docText, makeDoc, type ParaSpec } from './text';
import type { Deck, ShapeEl, Slide, SlideElement, TextBody } from './types';

/*
 * Outline view. A presentation is read as a list of rows: the title of each slide (level 0) and the paragraphs of its body placeholder
 * (level 1…). Editing the rows (typing, Enter, Tab, Shift+Tab) and writing them back with `outlineToDeck` keeps the formatting of the
 * paragraphs whose text did not change; shapes that are not text placeholders are left untouched.
 */

export interface OutlineRow {
  /** the slide the row belongs to (a title row starts it) */
  sid: string;
  kind: 'title' | 'body';
  /** body paragraph level (0 for the first level) */
  lvl: number;
  text: string;
}

const isTitle = (e: SlideElement): e is ShapeEl => e.kind === 'shape' && (e.ph?.type === 'title' || e.ph?.type === 'ctrTitle');
const isBody = (e: SlideElement): e is ShapeEl => e.kind === 'shape' && !!e.text && (e.ph?.type === 'body' || e.ph?.type === 'obj' || e.ph?.type === 'subTitle');

export const outlineTitle = (s: Slide): ShapeEl | undefined => s.shapes.find(isTitle);
export const outlineBody = (s: Slide): ShapeEl | undefined => s.shapes.find(isBody);

const oneLine = (t: string) => t.replace(/\v/g, ' ');

/** The rows of a presentation. A slide without a title or body placeholder still has its title row (empty). */
export function outlineOf(deck: Deck, keepEmpty?: string): OutlineRow[] {
  const rows: OutlineRow[] = [];
  for (const s of deck.slides) {
    const title = outlineTitle(s);
    rows.push({ sid: s.id, kind: 'title', lvl: 0, text: title?.text ? oneLine(docText(title.text.doc)) : '' });
    const body = outlineBody(s);
    if (!body?.text) continue;
    const doc = docNode(body.text.doc);
    const paras: OutlineRow[] = [];
    doc.forEach((p) => {
      let t = '';
      p.forEach((c) => {
        t += c.type.name === 'hard_break' ? ' ' : c.type.name === 'field' ? (c.attrs.text as string) : (c.text ?? '');
      });
      paras.push({ sid: s.id, kind: 'body', lvl: Math.max(0, Math.min(8, (p.attrs.lvl as number) ?? 0)), text: t });
    });
    // an untouched empty body is not a row
    if (paras.length === 1 && !paras[0]!.text && s.id !== keepEmpty) continue;
    rows.push(...paras);
  }
  return rows;
}

/** Can the slide hold body rows? (Otherwise they would be lost.) */
export const canHoldBody = (s: Slide | undefined): boolean => !!s && !!outlineBody(s);

function withText(old: TextBody | undefined, lines: { text: string; lvl: number }[]): TextBody {
  const prev = old ? docNode(old.doc) : null;
  const specs: ParaSpec[] = lines.map((l, i) => {
    const p = prev && i < prev.childCount ? prev.child(i) : null;
    let r: Record<string, unknown> | undefined;
    p?.forEach((c) => {
      if (!r) r = (c.marks.find((m) => m.type.name === 'run')?.attrs.r as Record<string, unknown> | undefined) ?? undefined;
    });
    const same = !!p && oneLine(textOfPara(p)) === l.text;
    // unchanged paragraphs keep their runs exactly
    if (p && same) return { runs: paraRuns(p), lvl: l.lvl, p: p.attrs.p as object, end: p.attrs.end as object } as ParaSpec;
    return { runs: l.text ? [{ text: l.text, r: r as never }] : [], lvl: l.lvl, p: (p?.attrs.p as object | undefined) ?? undefined, end: (p?.attrs.end as object | undefined) ?? undefined } as ParaSpec;
  });
  return { body: old?.body ?? {}, lst: old?.lst, doc: makeDoc(specs.length ? specs : [{}]).toJSON() };
}

type PNode = ReturnType<typeof docNode>['firstChild'] & object;

function textOfPara(p: PNode): string {
  let t = '';
  p.forEach((c) => {
    t += c.type.name === 'hard_break' ? '\v' : c.type.name === 'field' ? (c.attrs.text as string) : (c.text ?? '');
  });
  return t;
}

function paraRuns(p: PNode): NonNullable<ParaSpec['runs']> {
  const out: NonNullable<ParaSpec['runs']> = [];
  p.forEach((c) => {
    const r = c.marks.find((m) => m.type.name === 'run')?.attrs.r as never;
    if (c.type.name === 'hard_break') out.push({ br: true, r });
    else if (c.type.name === 'field') out.push({ field: { ftype: c.attrs.ftype as string, text: c.attrs.text as string }, r: c.attrs.r as never });
    else if (c.text) out.push({ text: c.text, r });
  });
  return out;
}

/** Slides of a row list, in order. */
function groups(rows: OutlineRow[]): { sid: string; title: OutlineRow; body: OutlineRow[] }[] {
  const out: { sid: string; title: OutlineRow; body: OutlineRow[] }[] = [];
  for (const r of rows) {
    if (r.kind === 'title') out.push({ sid: r.sid, title: r, body: [] });
    else out[out.length - 1]?.body.push(r);
  }
  return out;
}

/** Writes the rows back: new slides for new title rows, deleted slides for removed ones, new text for the changed ones. */
export function outlineToDeck(deck: Deck, rows: OutlineRow[]): Deck {
  const gs = groups(rows);
  if (!gs.length) return deck;
  const keep = new Set(gs.map((g) => g.sid));
  let d = deck;
  const gone = deck.slides.filter((s) => !keep.has(s.id)).map((s) => s.id);
  if (gone.length) d = deleteSlides(d, gone);
  let prev: string | undefined;
  for (const g of gs) {
    if (!d.slides.some((s) => s.id === g.sid)) {
      const at = prev ? d.slides.findIndex((s) => s.id === prev) : -1;
      const before = d.slides[Math.max(0, at)] ?? d.slides[0]!;
      const lay = d.layouts.find((l) => l.id === before.layoutId);
      const use = lay?.type === 'title' ? (d.layouts.find((l) => l.type === 'obj')?.id ?? before.layoutId) : before.layoutId;
      const r = addSlide(d, use, at);
      // the slide takes the id of its row, so the rows keep referring to it
      d = {
        ...r.deck,
        slides: r.deck.slides.map((s) => (s.id === r.slide.id ? { ...s, id: g.sid } : s)),
        sections: r.deck.sections.map((sec) => ({ ...sec, slideIds: sec.slideIds.map((x) => (x === r.slide.id ? g.sid : x)) })),
      };
    }
    prev = g.sid;
    d = updateSlide(d, g.sid, (s) => {
      let shapes = s.shapes;
      const t = outlineTitle(s);
      if (t) {
        const cur = t.text ? oneLine(docText(t.text.doc)) : '';
        if (cur !== g.title.text) shapes = shapes.map((e) => (e.id === t.id ? ({ ...t, text: withText(t.text, [{ text: g.title.text, lvl: 0 }]) } as ShapeEl) : e));
      }
      const b = outlineBody(s);
      if (b?.text) {
        const cur = outlineRowsOfBody(b);
        const next = g.body.length ? g.body.map((r) => ({ text: r.text, lvl: r.lvl })) : [{ text: '', lvl: 0 }];
        if (JSON.stringify(cur) !== JSON.stringify(next)) shapes = shapes.map((e) => (e.id === b.id ? ({ ...b, text: withText(b.text, next) } as ShapeEl) : e));
      }
      return shapes === s.shapes ? s : { ...s, shapes };
    });
  }
  return d;
}

function outlineRowsOfBody(b: ShapeEl): { text: string; lvl: number }[] {
  const out: { text: string; lvl: number }[] = [];
  docNode(b.text!.doc).forEach((p) => out.push({ text: oneLine(textOfPara(p as PNode)), lvl: Math.max(0, Math.min(8, (p.attrs.lvl as number) ?? 0)) }));
  return out;
}
