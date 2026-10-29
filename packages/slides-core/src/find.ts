import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { slidesSchema, docNode } from './text';
import type { Deck, Slide, SlideElement, TextBody } from './types';

/*
 * Find and replace over the text of a deck. A match may span several runs (the replacement takes the formatting of the run where
 * the match starts); fields and line breaks are boundaries a match cannot cross.
 */

export interface FindOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
  /** also search the speaker notes */
  notes?: boolean;
}

export interface Hit {
  slideId: string;
  slideIndex: number;
  elementId: string | null;
  /** where in the slide: the object's text, a table cell, or the notes */
  where: 'shape' | 'cell' | 'notes';
  /** text of the paragraph, for the list of results */
  context: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function makeRegex(query: string, o: FindOptions = {}): RegExp | null {
  if (!query) return null;
  const body = escapeRe(query);
  return new RegExp(o.wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body, o.matchCase ? 'gu' : 'giu');
}

const BOUNDARY = '\u0001';

interface Piece {
  node: PMNode;
  text: string;
}

/** Replaces matches paragraph by paragraph; returns the new document and how many were replaced. `limit` stops after N. */
export function replaceInDoc(doc: unknown, re: RegExp, repl: string, limit = Infinity): { doc: unknown; count: number } {
  const root = docNode(doc);
  let count = 0;
  const paras: PMNode[] = [];
  root.forEach((para) => {
    if (count >= limit) return void paras.push(para);
    const pieces: Piece[] = [];
    para.forEach((c) => pieces.push({ node: c, text: c.type.name === 'text' ? c.text! : BOUNDARY }));
    const s = pieces.map((p) => p.text).join('');
    re.lastIndex = 0;
    const ms: { a: number; b: number }[] = [];
    for (let m = re.exec(s); m && count + ms.length < limit; m = re.exec(s)) {
      if (m[0] === '') break;
      ms.push({ a: m.index, b: m.index + m[0].length });
    }
    if (!ms.length) return void paras.push(para);
    count += ms.length;
    const owner: number[] = [];
    pieces.forEach((p, i) => {
      for (let k = 0; k < p.text.length; k++) owner.push(i);
    });
    const out = pieces.map(() => '');
    let mi = 0;
    for (let i = 0; i < s.length; ) {
      const m = ms[mi];
      if (m && i === m.a) {
        out[owner[i]!] += repl;
        i = m.b;
        mi++;
      } else {
        out[owner[i]!] += s[i]!;
        i++;
      }
    }
    const kids: PMNode[] = [];
    pieces.forEach((p, i) => {
      if (p.node.type.name !== 'text') kids.push(p.node);
      else if (out[i]) kids.push(slidesSchema.text(out[i]!, p.node.marks));
    });
    paras.push(para.copy(Fragment.fromArray(kids)));
  });
  return { doc: root.copy(Fragment.fromArray(paras)).toJSON(), count };
}

function countIn(doc: unknown, re: RegExp): { n: number; first: string } {
  let n = 0;
  let first = '';
  docNode(doc).forEach((para) => {
    let s = '';
    para.forEach((c) => (s += c.type.name === 'text' ? c.text! : BOUNDARY));
    re.lastIndex = 0;
    const m = s.match(re);
    if (m?.length) {
      n += m.length;
      first ||= s.replace(new RegExp(BOUNDARY, 'g'), ' ').trim();
    }
  });
  return { n, first };
}

function bodiesOf(el: SlideElement): { body: TextBody; where: 'shape' | 'cell' }[] {
  if (el.kind === 'shape' && el.text) return [{ body: el.text, where: 'shape' }];
  if (el.kind === 'table') return el.rows.flatMap((r) => r.cells.flatMap((c) => (c.text ? [{ body: c.text, where: 'cell' as const }] : [])));
  return [];
}

/** Every match in reading order (slide by slide, object by object, notes last). */
export function findAll(deck: Deck, query: string, o: FindOptions = {}): Hit[] {
  const re = makeRegex(query, o);
  if (!re) return [];
  const hits: Hit[] = [];
  const visit = (s: Slide, i: number, els: SlideElement[]) => {
    for (const el of els) {
      if (el.kind === 'group') {
        visit(s, i, el.children);
        continue;
      }
      for (const { body, where } of bodiesOf(el)) {
        const { n, first } = countIn(body.doc, re);
        for (let k = 0; k < n; k++) hits.push({ slideId: s.id, slideIndex: i, elementId: el.id, where, context: first });
      }
    }
  };
  deck.slides.forEach((s, i) => {
    visit(s, i, s.shapes);
    if (o.notes && s.notes) {
      const { n, first } = countIn(s.notes.doc, re);
      for (let k = 0; k < n; k++) hits.push({ slideId: s.id, slideIndex: i, elementId: null, where: 'notes', context: first });
    }
  });
  return hits;
}

/**
 * Replaces matches. With `only` just the first match of that object (or of the notes when `elementId` is null) is replaced;
 * without it, all of them.
 */
export function replaceAll(deck: Deck, query: string, repl: string, o: FindOptions = {}, only?: { slideId: string; elementId: string | null }): { deck: Deck; count: number } {
  const re = makeRegex(query, o);
  if (!re) return { deck, count: 0 };
  let count = 0;
  const limit = only ? 1 : Infinity;
  const body = (t: TextBody): TextBody => {
    if (count >= limit) return t;
    const r = replaceInDoc(t.doc, re, repl, limit - count);
    count += r.count;
    return r.count ? { ...t, doc: r.doc as never } : t;
  };
  const el = (e: SlideElement): SlideElement => {
    if (e.kind === 'group') {
      const kids = e.children.map(el);
      return kids.some((k, i) => k !== e.children[i]) ? { ...e, children: kids } : e;
    }
    if (only && e.id !== only.elementId) return e;
    if (e.kind === 'shape' && e.text) {
      const t = body(e.text);
      return t === e.text ? e : { ...e, text: t };
    }
    if (e.kind === 'table') return { ...e, rows: e.rows.map((r) => ({ ...r, cells: r.cells.map((c) => (c.text ? { ...c, text: body(c.text) } : c)) })) };
    return e;
  };
  const slides = deck.slides.map((s) => {
    if (only && s.id !== only.slideId) return s;
    const shapes = s.shapes.map(el);
    let notes = s.notes;
    if (o.notes && notes && (!only || only.elementId === null)) notes = body(notes);
    return shapes.every((x, i) => x === s.shapes[i]) && notes === s.notes ? s : { ...s, shapes, notes };
  });
  return { deck: count ? { ...deck, slides } : deck, count };
}

/** Every text body of the deck in reading order (objects, table cells, and the notes when asked). */
export function eachText(deck: Deck, notes = false): { slideId: string; slideIndex: number; elementId: string | null; body: TextBody }[] {
  const out: { slideId: string; slideIndex: number; elementId: string | null; body: TextBody }[] = [];
  const visit = (s: Slide, i: number, els: SlideElement[]) => {
    for (const el of els) {
      if (el.kind === 'group') visit(s, i, el.children);
      else for (const { body } of bodiesOf(el)) out.push({ slideId: s.id, slideIndex: i, elementId: el.id, body });
    }
  };
  deck.slides.forEach((s, i) => {
    visit(s, i, s.shapes);
    if (notes && s.notes) out.push({ slideId: s.id, slideIndex: i, elementId: null, body: s.notes });
  });
  return out;
}
