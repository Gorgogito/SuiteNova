import { docNode, mapDoc, slidesSchema, textNodeTypes } from './text';
import type { Deck, Layout, ListStyle, Master, RunProps, ShapeEl, Slide, SlideElement, TableEl, TextBody } from './types';

/*
 * Whole-text operations: change case, find which fonts a presentation uses and replace one by another, and turn text into the
 * lines of a diagram.
 */

export type CaseMode = 'sentence' | 'lower' | 'upper' | 'title' | 'toggle';

/** Words that stay in lower case inside a title (Spanish and English). */
const SMALL = new Set(['a', 'al', 'an', 'and', 'as', 'at', 'but', 'by', 'con', 'de', 'del', 'el', 'en', 'for', 'la', 'las', 'lo', 'los', 'of', 'on', 'or', 'para', 'por', 'sin', 'the', 'to', 'un', 'una', 'y', 'e', 'o', 'u']);

export function changeCase(text: string, mode: CaseMode): string {
  switch (mode) {
    case 'lower':
      return text.toLowerCase();
    case 'upper':
      return text.toUpperCase();
    case 'toggle':
      return [...text].map((ch) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase())).join('');
    case 'sentence': {
      let start = true;
      let out = '';
      for (const ch of text.toLowerCase()) {
        if (start && /\p{L}/u.test(ch)) {
          out += ch.toUpperCase();
          start = false;
        } else {
          out += ch;
          if (/[.!?¿¡\n\v]/.test(ch)) start = true;
        }
      }
      return out;
    }
    case 'title': {
      let first = true;
      return text.toLowerCase().replace(/[\p{L}\p{N}'’]+/gu, (w) => {
        const keep = !first && SMALL.has(w);
        first = false;
        return keep ? w : w[0]!.toUpperCase() + w.slice(1);
      });
    }
  }
}

/** Case of several pieces of text that form one phrase (runs with different formats): the phrase is changed as a whole and cut again. */
export function caseParts(parts: string[], mode: CaseMode): string[] {
  const whole = changeCase(parts.join(''), mode);
  if (whole.length === parts.join('').length) {
    let at = 0;
    return parts.map((p) => whole.slice(at, (at += p.length)));
  }
  return parts.map((p) => changeCase(p, mode));
}

/** The same document with the case changed, paragraph by paragraph (so a sentence can span runs). */
export function mapDocCase(doc: unknown, mode: CaseMode): unknown {
  const n = docNode(doc);
  const paras: ReturnType<typeof textNodeTypes.paragraph.create>[] = [];
  n.forEach((para) => {
    const kids: unknown[] = [];
    const texts: string[] = [];
    para.forEach((c) => c.type.name === 'text' && texts.push(c.text!));
    const out = caseParts(texts, mode);
    let i = 0;
    para.forEach((c) => (c.type.name === 'text' ? kids.push(slidesSchema.text(out[i++]!, c.marks)) : kids.push(c)));
    paras.push(textNodeTypes.paragraph!.create(para.attrs, kids as never));
  });
  return textNodeTypes.doc!.create(null, paras).toJSON();
}

/** The same document with `fn` applied to the text of every text node. */
export function mapDocText(doc: unknown, fn: (s: string) => string): unknown {
  const n = docNode(doc);
  const paras = [] as ReturnType<typeof textNodeTypes.paragraph.create>[];
  n.forEach((para) => {
    const kids = [] as ReturnType<typeof slidesSchema.text>[] | never[];
    const list: unknown[] = kids;
    para.forEach((c) => (c.type.name === 'text' ? list.push(slidesSchema.text(fn(c.text!), c.marks)) : list.push(c)));
    paras.push(textNodeTypes.paragraph!.create(para.attrs, list as never));
  });
  return textNodeTypes.doc!.create(null, paras).toJSON();
}

// ------------------------------------------------------------------------------------------------ fonts

const bodiesOf = (el: SlideElement): TextBody[] => (el.kind === 'shape' ? (el.text ? [el.text] : []) : el.kind === 'table' ? el.rows.flatMap((r) => r.cells.map((c) => c.text)).filter((t): t is TextBody => !!t) : el.kind === 'group' ? el.children.flatMap(bodiesOf) : []);

/** The fonts used by runs, level styles and the theme, with the number of places that use each one. */
export function usedFonts(deck: Deck): Map<string, number> {
  const out = new Map<string, number>();
  const bump = (f?: string) => f && !f.startsWith('+') && out.set(f, (out.get(f) ?? 0) + 1);
  const run = (r?: RunProps) => r && (bump(r.latin), bump(r.ea), bump(r.cs));
  const body = (t: TextBody) => {
    docNode(t.doc).descendants((n) => {
      if (n.type.name === 'text') run(n.marks.find((m) => m.type.name === 'run')?.attrs.r as RunProps | undefined);
      else if (n.type.name === 'field') run(n.attrs.r as RunProps);
      return true;
    });
    for (const l of [t.lst?.def, ...(t.lst?.lvl ?? [])]) run(l?.rPr);
  };
  const shapes = (list: SlideElement[]) => list.forEach((e) => bodiesOf(e).forEach(body));
  for (const s of deck.slides) shapes(s.shapes);
  const styles = (ls?: ListStyle) => ls && [ls.def, ...(ls.lvl ?? [])].forEach((l) => run(l?.rPr));
  for (const m of deck.masters) {
    shapes(m.shapes);
    styles(m.txStyles.title);
    styles(m.txStyles.body);
    styles(m.txStyles.other);
  }
  for (const l of deck.layouts) shapes(l.shapes);
  styles(deck.defaultText);
  for (const th of deck.themes ?? []) {
    bump(th.fonts.major.latin);
    bump(th.fonts.minor.latin);
  }
  return out;
}

const swapRun = (from: string, to: string) => (r: RunProps): RunProps => ({ ...r, ...(r.latin === from ? { latin: to } : {}), ...(r.ea === from ? { ea: to } : {}), ...(r.cs === from ? { cs: to } : {}) });
const swapBody = (t: TextBody, from: string, to: string): TextBody => {
  const sr = swapRun(from, to);
  const lvl = t.lst?.lvl?.map((l) => (l?.rPr ? { ...l, rPr: sr(l.rPr) } : l));
  return { ...t, doc: mapDoc(t.doc, undefined, sr), ...(t.lst ? { lst: { ...t.lst, ...(t.lst.def?.rPr ? { def: { ...t.lst.def, rPr: sr(t.lst.def.rPr) } } : {}), ...(lvl ? { lvl } : {}) } } : {}) };
};
const swapStyle = (ls: ListStyle | undefined, from: string, to: string): ListStyle | undefined => {
  if (!ls) return ls;
  const sr = swapRun(from, to);
  const fix = (l: ListStyle['def']) => (l?.rPr ? { ...l, rPr: sr(l.rPr) } : l);
  return { ...ls, ...(ls.def ? { def: fix(ls.def) } : {}), ...(ls.lvl ? { lvl: ls.lvl.map(fix) } : {}) };
};
const swapEl = (e: SlideElement, from: string, to: string): SlideElement => {
  if (e.kind === 'shape') return e.text ? ({ ...e, text: swapBody(e.text, from, to) } as ShapeEl) : e;
  if (e.kind === 'table') return { ...e, rows: e.rows.map((r) => ({ ...r, cells: r.cells.map((c) => (c.text ? { ...c, text: swapBody(c.text, from, to) } : c)) })) } as TableEl;
  if (e.kind === 'group') return { ...e, children: e.children.map((c) => swapEl(c, from, to)) };
  return e;
};

/** Replaces a font everywhere: text, list styles, masters, layouts and the theme fonts. */
export function replaceFont(deck: Deck, from: string, to: string): Deck {
  if (from === to) return deck;
  const els = (l: SlideElement[]) => l.map((e) => swapEl(e, from, to));
  const f = (v: { latin: string }) => (v.latin === from ? { ...v, latin: to } : v);
  return {
    ...deck,
    slides: deck.slides.map((s): Slide => ({ ...s, shapes: els(s.shapes) })),
    masters: deck.masters.map((m): Master => ({ ...m, shapes: els(m.shapes), txStyles: { title: swapStyle(m.txStyles.title, from, to)!, body: swapStyle(m.txStyles.body, from, to)!, other: swapStyle(m.txStyles.other, from, to)! } })),
    layouts: deck.layouts.map((l): Layout => ({ ...l, shapes: els(l.shapes) })),
    ...(deck.defaultText ? { defaultText: swapStyle(deck.defaultText, from, to) } : {}),
    themes: (deck.themes ?? []).map((th) => ({ ...th, fonts: { ...th.fonts, major: f(th.fonts.major), minor: f(th.fonts.minor) } })),
  };
}

/** The text of a shape as the lines of a diagram: one line per paragraph, indented by level. */
export function docToDiagramText(doc: unknown): string {
  const n = docNode(doc);
  const lines: string[] = [];
  n.forEach((p) => {
    let s = '';
    p.forEach((c) => (s += c.type.name === 'field' ? c.attrs.text : c.type.name === 'text' ? c.text : ' '));
    if (s.trim()) lines.push('  '.repeat(Math.min(Number(p.attrs.lvl) || 0, 3)) + s.trim());
  });
  return lines.join('\n');
}
