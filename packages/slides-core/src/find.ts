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
  /** also search the text read from pictures (OCR) */
  pictures?: boolean;
  /** A compiled search (wildcards, regular expression…) that takes the place of the plain text and the two options above. */
  regex?: RegExp;
  /** The text is compared without accents (the pattern in `regex` was made for that); the offsets do not change. */
  fold?: boolean;
  /** What a match is replaced with, when it depends on the match (groups, `^&`). */
  expand?: (m: { text: string; groups: string[] }) => string;
}

export interface Hit {
  slideId: string;
  slideIndex: number;
  elementId: string | null;
  /** where in the slide: the object's text, a table cell, or the notes */
  where: 'shape' | 'cell' | 'notes' | 'picture';
  /** text of the paragraph, for the list of results */
  context: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function makeRegex(query: string, o: FindOptions = {}): RegExp | null {
  if (o.regex) return new RegExp(o.regex.source, o.regex.flags.includes('g') ? o.regex.flags : `${o.regex.flags}g`);
  if (!query) return null;
  const body = escapeRe(query);
  return new RegExp(o.wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body, o.matchCase ? 'gu' : 'giu');
}

const BOUNDARY = '\u0001';

/** The same text without accents, letter by letter so that it keeps its length. */
function foldText(s: string): string {
  let out = '';
  for (const ch of s) {
    const d = ch.normalize('NFD');
    out += d.length > 1 && /^\P{M}\p{M}+$/u.test(d) ? d[0] : ch;
  }
  return out;
}

interface Piece {
  node: PMNode;
  text: string;
}

/** Replaces matches paragraph by paragraph; returns the new document and how many were replaced. `limit` stops after N. */
export function replaceInDoc(doc: unknown, re: RegExp, repl: string | ((m: { text: string; groups: string[] }) => string), limit = Infinity, fold = false): { doc: unknown; count: number } {
  const root = docNode(doc);
  let count = 0;
  const paras: PMNode[] = [];
  root.forEach((para) => {
    if (count >= limit) return void paras.push(para);
    const pieces: Piece[] = [];
    para.forEach((c) => pieces.push({ node: c, text: c.type.name === 'text' ? c.text! : BOUNDARY }));
    const s = pieces.map((p) => p.text).join('');
    const hay = fold ? foldText(s) : s;
    re.lastIndex = 0;
    const ms: { a: number; b: number; r: string }[] = [];
    for (let m = re.exec(hay); m && count + ms.length < limit; m = re.exec(hay)) {
      if (m[0] === '') break;
      const a = m.index;
      const b = a + m[0].length;
      ms.push({ a, b, r: typeof repl === 'string' ? repl : repl({ text: s.slice(a, b), groups: m.slice(1).map((g) => g ?? '') }) });
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
        out[owner[i]!] += m.r;
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

function countIn(doc: unknown, re: RegExp, fold = false): { n: number; first: string } {
  let n = 0;
  let first = '';
  docNode(doc).forEach((para) => {
    let s = '';
    para.forEach((c) => (s += c.type.name === 'text' ? c.text! : BOUNDARY));
    re.lastIndex = 0;
    const m = (fold ? foldText(s) : s).match(re);
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
        const { n, first } = countIn(body.doc, re, o.fold);
        for (let k = 0; k < n; k++) hits.push({ slideId: s.id, slideIndex: i, elementId: el.id, where, context: first });
      }
      // the text of a picture is found, not replaced: one hit for each picture
      if (o.pictures && el.kind === 'pic') {
        const text = (deck.assets[el.src]?.ocr as { text?: unknown } | undefined)?.text;
        const line = typeof text === 'string' ? text.split('\n').find((l) => new RegExp(re.source, re.flags.replace('g', '')).test(l)) : undefined;
        if (line !== undefined) hits.push({ slideId: s.id, slideIndex: i, elementId: el.id, where: 'picture', context: line.trim() });
      }
    }
  };
  deck.slides.forEach((s, i) => {
    visit(s, i, s.shapes);
    if (o.notes && s.notes) {
      const { n, first } = countIn(s.notes.doc, re, o.fold);
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
    const r = replaceInDoc(t.doc, re, o.expand ?? repl, limit - count, o.fold);
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
