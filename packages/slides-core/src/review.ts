import { contrastRatio, similarity } from '@suitenova/writer-core';
import { chainFor, colorContext } from './resolve';
import { resolveClr } from './color';
import { newId } from './defaults';
import { outlineBody, outlineTitle } from './outline';
import { docNode, docText } from './text';
import type { Deck, Layout, RunProps, ShapeEl, Slide, SlideElement, TextBody } from './types';

/*
 * Review tools: accessibility checker, comparison of two presentations and reusing slides from another file.
 */

// ------------------------------------------------------------------------------------------------ text of a slide

const bodiesOf = (e: SlideElement): TextBody[] => (e.kind === 'shape' ? (e.text ? [e.text] : []) : e.kind === 'table' ? e.rows.flatMap((r) => r.cells.map((c) => c.text)).filter((t): t is TextBody => !!t) : e.kind === 'group' ? e.children.flatMap(bodiesOf) : []);

/** All the text of a slide (title first), one line per paragraph. */
export function slideText(s: Slide): string {
  const title = outlineTitle(s);
  const lines: string[] = [];
  if (title?.text) lines.push(docText(title.text.doc));
  for (const e of s.shapes) if (e !== title) for (const b of bodiesOf(e)) lines.push(docText(b.doc));
  return lines.map((l) => l.replace(/\v/g, ' ').trim()).filter(Boolean).join('\n');
}

export const slideTitle = (s: Slide): string => {
  const t = outlineTitle(s);
  return t?.text ? docText(t.text.doc).replace(/\v/g, ' ').trim() : '';
};

// ------------------------------------------------------------------------------------------------ accessibility

export type A11yKind = 'noTitle' | 'dupTitle' | 'imageAlt' | 'mediaAlt' | 'tableHeader' | 'mergedCells' | 'smallText' | 'contrast' | 'readingOrder' | 'linkText' | 'noDocTitle';
export interface A11yIssue {
  kind: A11yKind;
  severity: 'error' | 'warning' | 'tip';
  /** null for problems of the whole presentation */
  slideId: string | null;
  elId?: string;
}

const GENERIC_LINK = /^(aqu[ií]|click here|here|link|enlace|v[ée]ase|m[aá]s|read more|more|este enlace|this link)\.?$/i;
const hex = (c: { r: number; g: number; b: number }) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

export function checkSlidesAccessibility(deck: Deck): A11yIssue[] {
  const out: A11yIssue[] = [];
  const seen = new Map<string, number>();
  if (!deck.props.title?.trim()) out.push({ kind: 'noDocTitle', severity: 'tip', slideId: null });
  for (const s of deck.slides) {
    const title = slideTitle(s);
    if (!title) out.push({ kind: 'noTitle', severity: 'error', slideId: s.id });
    else {
      const k = title.toLowerCase();
      seen.set(k, (seen.get(k) ?? 0) + 1);
      if (seen.get(k)! > 1) out.push({ kind: 'dupTitle', severity: 'warning', slideId: s.id });
    }
    const ttl = outlineTitle(s);
    if (ttl && s.shapes.indexOf(ttl) > 0 && s.shapes.slice(0, s.shapes.indexOf(ttl)).some((e) => !(e.kind === 'shape' && e.ph && ['dt', 'ftr', 'sldNum'].includes(e.ph.type)))) out.push({ kind: 'readingOrder', severity: 'tip', slideId: s.id, elId: ttl.id });
    const ctx = colorContext(chainFor(deck, s));
    const bg = hex(resolveClr({ scheme: 'bg1' }, ctx));
    const walk = (els: SlideElement[]) => {
      for (const e of els) {
        if (e.hidden) continue;
        if ((e.kind === 'pic' || e.kind === 'chart' || e.kind === 'ole' || (e.kind === 'group' && e.smartart)) && !e.descr?.trim() && !('poster' in e && e.poster)) out.push({ kind: 'imageAlt', severity: 'error', slideId: s.id, elId: e.id });
        if (e.kind === 'media' && !e.descr?.trim()) out.push({ kind: 'mediaAlt', severity: 'warning', slideId: s.id, elId: e.id });
        if (e.kind === 'table') {
          if (!e.firstRow) out.push({ kind: 'tableHeader', severity: 'warning', slideId: s.id, elId: e.id });
          if (e.rows.some((r) => r.cells.some((c) => (c.gridSpan ?? 1) > 1 || (c.rowSpan ?? 1) > 1))) out.push({ kind: 'mergedCells', severity: 'tip', slideId: s.id, elId: e.id });
        }
        if (e.kind === 'group') walk(e.children);
        const fillBg = e.kind === 'shape' && e.fill?.t === 'solid' ? hex(resolveClr(e.fill.c, ctx)) : bg;
        let small = false;
        let low = false;
        let link = false;
        for (const b of bodiesOf(e)) {
          docNode(b.doc).descendants((n) => {
            if (n.type.name !== 'text' || !n.text?.trim()) return true;
            const r = (n.marks.find((m) => m.type.name === 'run')?.attrs.r ?? {}) as RunProps;
            if (r.sz !== undefined && r.sz < 12) small = true;
            if (r.color) {
              const ratio = contrastRatio(hex(resolveClr(r.color, ctx)), fillBg);
              const large = (r.sz ?? 18) >= 24 || ((r.sz ?? 18) >= 18.66 && r.b);
              if (ratio < (large ? 3 : 4.5)) low = true;
            }
            if (r.hlink && GENERIC_LINK.test(n.text.trim())) link = true;
            return true;
          });
        }
        if (small) out.push({ kind: 'smallText', severity: 'tip', slideId: s.id, elId: e.id });
        if (low) out.push({ kind: 'contrast', severity: 'warning', slideId: s.id, elId: e.id });
        if (link) out.push({ kind: 'linkText', severity: 'warning', slideId: s.id, elId: e.id });
      }
    };
    walk(s.shapes);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ compare

export interface SlideDiff {
  kind: 'same' | 'changed' | 'added' | 'removed';
  /** index in the first (current) presentation */
  a?: number;
  /** index in the second (the file) */
  b?: number;
  textA: string;
  textB: string;
}

/** Aligns the slides of two presentations by text (exact matches first, then similar ones) and tells what changed. */
export function compareDecks(a: Deck, b: Deck): SlideDiff[] {
  const sa = a.slides.map(slideText);
  const sb = b.slides.map(slideText);
  const n = sa.length;
  const m = sb.length;
  // longest common subsequence of identical slides
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = sa[i] === sb[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: SlideDiff[] = [];
  let i = 0;
  let j = 0;
  const gap = (i2: number, j2: number) => {
    // inside a gap, slides in the same order that are alike count as changed
    const ia = Array.from({ length: i2 - i }, (_x, k) => i + k);
    const jb = Array.from({ length: j2 - j }, (_x, k) => j + k);
    let jj = 0;
    const paired = new Map<number, number>();
    for (const x of ia) {
      for (let y = jj; y < jb.length; y++) {
        if (similarity(sa[x]!, sb[jb[y]!]!) >= 0.4) {
          paired.set(x, jb[y]!);
          jj = y + 1;
          break;
        }
      }
    }
    let nextB = j;
    for (const x of ia) {
      const y = paired.get(x);
      if (y === undefined) continue;
      for (let k = nextB; k < y; k++) out.push({ kind: 'added', b: k, textA: '', textB: sb[k]! });
      out.push({ kind: 'changed', a: x, b: y, textA: sa[x]!, textB: sb[y]! });
      nextB = y + 1;
    }
    // slides without a partner: removed ones in their place, new ones at the end of the gap
    const rest: SlideDiff[] = [];
    for (const x of ia) if (!paired.has(x)) rest.push({ kind: 'removed', a: x, textA: sa[x]!, textB: '' });
    for (let k = nextB; k < j2; k++) rest.push({ kind: 'added', b: k, textA: '', textB: sb[k]! });
    out.push(...rest);
  };
  while (i < n || j < m) {
    if (i < n && j < m && sa[i] === sb[j]) {
      out.push({ kind: 'same', a: i, b: j, textA: sa[i]!, textB: sb[j]! });
      i++;
      j++;
      continue;
    }
    // the next common slide ends the gap
    let ni = n;
    let nj = m;
    for (let x = i; x < n && ni === n; x++) for (let y = j; y < m; y++) if (sa[x] === sb[y] && dp[x]![y] === dp[i]![j]!) ((ni = x), (nj = y), (y = m));
    gap(ni, nj);
    i = ni;
    j = nj;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ reuse slides

const remapAssets = (v: unknown, map: Map<string, string>): unknown => {
  if (typeof v === 'string') return map.get(v) ?? v;
  if (Array.isArray(v)) return v.map((x) => remapAssets(x, map));
  if (v && typeof v === 'object' && !(v instanceof Uint8Array)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remapAssets(x, map)]));
  return v;
};

/** The layout of the destination that best matches the one a slide used in its own presentation. */
export function matchLayout(dest: Deck, from: Layout | undefined): Layout {
  return dest.layouts.find((l) => from?.type && l.type === from.type) ?? dest.layouts.find((l) => from && l.name === from.name) ?? dest.layouts[0]!;
}

/**
 * Copies slides of another presentation after `afterIndex`, with the theme of this one: each slide takes the layout that matches its
 * own, and pictures and media come along under new names.
 */
export function importSlides(dest: Deck, source: Deck, indexes: number[], afterIndex: number): { deck: Deck; ids: string[] } {
  const picked = indexes.map((i) => source.slides[i]).filter((s): s is Slide => !!s);
  const map = new Map<string, string>();
  const assets: Deck['assets'] = {};
  for (const [id, a] of Object.entries(source.assets)) {
    const nid = newId('a');
    map.set(id, nid);
    assets[nid] = { ...a, id: nid };
  }
  const copies = picked.map((s): Slide => {
    const layout = matchLayout(dest, source.layouts.find((l) => l.id === s.layoutId));
    const copy = remapAssets(structuredClone({ ...s, comments: undefined }), map) as Slide;
    return { ...copy, id: newId('s'), layoutId: layout.id, hidden: s.hidden };
  });
  const slides = [...dest.slides];
  slides.splice(afterIndex + 1, 0, ...copies);
  const json = JSON.stringify(copies);
  const kept = Object.fromEntries(Object.entries(assets).filter(([id]) => json.includes(id)));
  return { deck: { ...dest, slides, assets: { ...dest.assets, ...kept } }, ids: copies.map((c) => c.id) };
}

export const shapeOfSlideBody = (s: Slide): ShapeEl | undefined => outlineBody(s);
