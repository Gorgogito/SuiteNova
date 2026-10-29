import {
  buildBibliographyContent,
  buildIndexContent,
  buildTocContent,
  buildTofContent,
  collectBookmarks,
  collectCaptions,
  collectHeadings,
  collectIndexEntries,
  computeFieldResults,
  defaultTocOptions,
  formatPageNumber,
  markTypes,
  nodeTypes,
  plainOf,
  tocInstr,
  tocOptionsOf,
  uniqueBookmark,
  type CaptionEntry,
  type HeadingEntry,
  type RefContext,
  type TocOptions,
} from '@suitenova/writer-core';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import type { WriterCtl } from './doc';
import { ptToPx } from '@suitenova/writer-core';

const FRAMES = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 120))));

/** Page label (as printed) of the page that holds a document position; null outside the print layout. */
export function pageLabelOfPos(ctl: WriterCtl, pos: number): string | null {
  const v = ctl.mainView;
  if (!v || ctl.viewMode !== 'print' || !ctl.host) return null;
  try {
    const rects = ctl.pageRects();
    const sheet = ctl.host.getBoundingClientRect();
    const s = ctl.host.offsetWidth ? sheet.width / ctl.host.offsetWidth || 1 : 1;
    const c = v.coordsAtPos(Math.max(1, Math.min(pos + 1, v.state.doc.content.size)));
    const y = (c.top - sheet.top) / s + 2;
    for (let i = 0; i < rects.length; i++) {
      if (y < rects[i]!.top + rects[i]!.height + 10) {
        const spec = ctl.pageSpecs[i]!;
        const sec = ctl.sections()[spec.section];
        return formatPageNumber(spec.number, sec?.props.pgNumFmt ?? 'decimal');
      }
    }
  } catch {
    // the position is not drawn
  }
  return null;
}

export function refContext(ctl: WriterCtl): RefContext {
  const sec = ctl.currentSection().props.page;
  const notes = ctl.notes();
  return {
    pageOf: (pos) => pageLabelOfPos(ctl, pos),
    textWidthPt: sec.width - sec.marginLeft - sec.marginRight,
    sources: ctl.sources,
    citeStyle: ctl.citeStyle,
    noteLabel: (id) => notes.find((n) => n.id === id)?.label ?? null,
  };
}

const run = (ctl: WriterCtl, fn: (tr: ReturnType<NonNullable<WriterCtl['mainView']>['state']['tr']['setMeta']>) => void) => {
  const v = ctl.mainView;
  if (!v) return;
  const tr = v.state.tr;
  fn(tr as never);
  if (tr.docChanged) v.dispatch(tr.setMeta('nw-no-track', true).setMeta('nw-allow', true));
};

/** Make sure each position has a bookmark at its start; returns the names in the same order. */
function ensureBookmarks(ctl: WriterCtl, targets: { pos: number; bookmark: string | null }[], prefix: string): string[] {
  const v = ctl.mainView;
  if (!v) return [];
  const taken = new Set(collectBookmarks(v.state.doc).keys());
  const names = targets.map((t) => t.bookmark ?? uniqueBookmark(prefix, taken));
  names.forEach((n) => taken.add(n));
  const tr = v.state.tr;
  const adds = targets.map((t, i) => ({ pos: t.pos, name: names[i]!, existing: t.bookmark })).filter((a) => !a.existing);
  // from the end so that the positions stay valid
  for (const a of adds.sort((x, y) => y.pos - x.pos)) tr.insert(a.pos + 1, nodeTypes.bookmark!.create({ name: a.name }));
  if (tr.docChanged) v.dispatch(tr.setMeta('nw-no-track', true).setMeta('nw-allow', true));
  return names;
}

// ------------------------------------------------------------------------------------------------ fields

/** Recompute the result text of sequence numbers, cross references, page references and citations. */
export function updateFields(ctl: WriterCtl): number {
  const v = ctl.mainView;
  if (!v) return 0;
  const results = computeFieldResults(v.state.doc, refContext(ctl));
  const tr = v.state.tr;
  let changed = 0;
  v.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'field') return true;
    const r = results.get(pos);
    if (r !== undefined && r !== node.attrs.result) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, result: r }, node.marks);
      changed++;
    }
    return true;
  });
  if (changed) v.dispatch(tr.setMeta('nw-no-track', true).setMeta('nw-allow', true));
  return changed;
}

/** Rebuild tables of contents, of figures, bibliographies and indexes from the document. */
export async function updateGenerated(ctl: WriterCtl, passes = 2): Promise<number> {
  const v = ctl.mainView;
  if (!v) return 0;
  let count = 0;
  for (let pass = 0; pass < passes; pass++) {
    // 1) bookmarks that the entries need
    const blocks: { pos: number; node: PMNode }[] = [];
    v.state.doc.descendants((n, pos) => {
      if (n.type.name === 'generated') blocks.push({ pos, node: n });
      return n.type.name !== 'generated';
    });
    count = blocks.length;
    if (!blocks.length) return 0;
    const wantHeadings: HeadingEntry[] = [];
    const wantCaptions: CaptionEntry[] = [];
    for (const b of blocks) {
      if (b.node.attrs.kind === 'toc') {
        const o = tocOptionsOf(b.node.attrs);
        wantHeadings.push(...collectHeadings(v.state.doc, o.minLevel, o.maxLevel));
      } else if (b.node.attrs.kind === 'tof') {
        wantCaptions.push(...collectCaptions(v.state.doc, (b.node.attrs.opts as { label?: string } | null)?.label));
      }
    }
    const targets = [...new Map([...wantHeadings, ...wantCaptions].map((t) => [t.pos, { pos: t.pos, bookmark: t.bookmark }])).values()];
    ensureBookmarks(ctl, targets, '_Toc');
    // the inserted bookmarks moved everything: read the document again
    const doc = v.state.doc;
    const ctx = refContext(ctl);
    const tr = v.state.tr;
    const replacements: { from: number; to: number; content: PMNode[] }[] = [];
    doc.descendants((n, pos) => {
      if (n.type.name !== 'generated') return true;
      const kind = n.attrs.kind as string;
      let content: PMNode[] = [];
      if (kind === 'toc') {
        const o = tocOptionsOf(n.attrs);
        const entries = collectHeadings(doc, o.minLevel, o.maxLevel).map((h) => ({ ...h, bookmark: h.bookmark ?? '_Toc0' }));
        content = buildTocContent(entries, o, ctx);
      } else if (kind === 'tof') {
        const o = { ...defaultTocOptions(), ...((n.attrs.opts ?? {}) as Partial<TocOptions>) };
        const entries = collectCaptions(doc, (n.attrs.opts as { label?: string } | null)?.label).map((c) => ({ ...c, bookmark: c.bookmark ?? '_Toc0' }));
        content = buildTofContent(entries, o, ctx);
      } else if (kind === 'bibliography') content = buildBibliographyContent(doc, ctx);
      else if (kind === 'index') content = buildIndexContent(collectIndexEntries(doc), ctx);
      if (content.length) replacements.push({ from: pos + 1, to: pos + n.nodeSize - 1, content });
      return false;
    });
    for (const r of replacements.sort((a, b) => b.from - a.from)) tr.replaceWith(r.from, r.to, Fragment.fromArray(r.content));
    if (tr.docChanged) v.dispatch(tr.setMeta('nw-no-track', true).setMeta('nw-allow', true));
    // the page numbers depend on the layout that the new entries produce: measure again
    await FRAMES();
    updateFields(ctl);
  }
  return count;
}

/** Insert a generated block (table of contents, figures, bibliography, index) after the block at the caret. */
export async function insertGenerated(ctl: WriterCtl, kind: 'toc' | 'tof' | 'bibliography' | 'index', opts: Record<string, unknown> | null): Promise<void> {
  const v = ctl.mainView;
  if (!v || ctl.readOnly) return;
  const placeholder = nodeTypes.paragraph!.create({ style: kind === 'toc' || kind === 'tof' ? 'Normal' : 'Normal' }, [nodeTypes.paragraph!.schema.text(' ')]);
  const node = nodeTypes.generated!.create({ kind, opts }, [placeholder]);
  const { $from } = v.state.selection;
  // before the block of the caret when it is empty, else after it
  let d = $from.depth;
  while (d > 1 && $from.node(d - 1).type.name !== 'section') d--;
  const empty = $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0 && $from.depth === d;
  const at = empty ? $from.before(d) : $from.after(d);
  const tr = v.state.tr;
  if (empty) tr.replaceWith($from.before(d), $from.after(d), node);
  else tr.insert(at, node);
  v.dispatch(tr.scrollIntoView().setMeta('nw-no-track', true).setMeta('nw-allow', true));
  await updateGenerated(ctl);
}

export function removeGenerated(ctl: WriterCtl, kind: string): void {
  const v = ctl.mainView;
  if (!v) return;
  const { $from } = v.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'generated' && (!kind || n.attrs.kind === kind)) {
      v.dispatch(v.state.tr.delete($from.before(d), $from.after(d)).setMeta('nw-no-track', true).setMeta('nw-allow', true));
      return;
    }
  }
  // else the first one of the kind
  let found: { pos: number; size: number } | null = null;
  v.state.doc.descendants((n, pos) => {
    if (!found && n.type.name === 'generated' && n.attrs.kind === kind) found = { pos, size: n.nodeSize };
    return !found;
  });
  const f = found as { pos: number; size: number } | null;
  if (f) v.dispatch(v.state.tr.delete(f.pos, f.pos + f.size).setMeta('nw-no-track', true).setMeta('nw-allow', true));
}

export function generatedKindsIn(ctl: WriterCtl): Set<string> {
  const out = new Set<string>();
  ctl.body.descendants((n) => {
    if (n.type.name === 'generated') out.add(n.attrs.kind);
    return n.type.name !== 'generated';
  });
  return out;
}

// ------------------------------------------------------------------------------------------------ captions, bookmarks, cross references

/** Insert a caption ("Figura 1: text") for the selected object, table or paragraph. */
export function insertCaption(ctl: WriterCtl, label: string, text: string, where: 'above' | 'below', withLabel = true): void {
  const v = ctl.mainView;
  if (!v || ctl.readOnly) return;
  const { selection } = v.state;
  const S = nodeTypes.paragraph!.schema;
  const kids: PMNode[] = [];
  if (withLabel) kids.push(S.text(`${label} `));
  kids.push(nodeTypes.field!.create({ kind: 'seq', arg: label, result: '1' }));
  if (text.trim()) kids.push(S.text(`: ${text.trim()}`));
  const cap = nodeTypes.paragraph!.create({ style: 'Caption', keepNext: where === 'above' }, kids);
  // the block that holds the selection, directly under the section
  const $f = selection.$from;
  let d = $f.depth;
  while (d > 1 && $f.node(d - 1).type.name !== 'section') d--;
  const at = where === 'above' ? $f.before(d) : $f.after(d);
  const tr = v.state.tr.insert(at, cap);
  tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
  v.dispatch(tr.scrollIntoView().setMeta('nw-no-track', true).setMeta('nw-allow', true));
  updateFields(ctl);
}

export const validBookmark = (name: string): boolean => /^[\p{L}_][\p{L}\p{N}_]{0,39}$/u.test(name);

export function listBookmarks(ctl: WriterCtl, hidden = false): { name: string; pos: number; text: string }[] {
  return [...collectBookmarks(ctl.body).values()].filter((b) => hidden || !b.name.startsWith('_')).map((b) => ({ name: b.name, pos: b.pos, text: b.text }));
}

export function addBookmark(ctl: WriterCtl, name: string): string | null {
  const v = ctl.mainView;
  if (!v) return 'No hay documento.';
  if (!validBookmark(name)) return 'El nombre del marcador debe empezar por una letra y contener solo letras, números o guion bajo (sin espacios).';
  const existing = collectBookmarks(v.state.doc).get(name);
  const tr = v.state.tr;
  if (existing) tr.delete(existing.pos, existing.pos + 1);
  const at = existing && existing.pos < v.state.selection.from ? tr.mapping.map(v.state.selection.from) : v.state.selection.from;
  tr.insert(at, nodeTypes.bookmark!.create({ name }));
  v.dispatch(tr.setMeta('nw-no-track', true).setMeta('nw-allow', true));
  return null;
}

export function deleteBookmark(ctl: WriterCtl, name: string): void {
  const v = ctl.mainView;
  const b = v && collectBookmarks(v.state.doc).get(name);
  if (v && b) v.dispatch(v.state.tr.delete(b.pos, b.pos + 1).setMeta('nw-no-track', true).setMeta('nw-allow', true));
}

export function goToBookmark(ctl: WriterCtl, name: string): void {
  const v = ctl.mainView;
  const b = v && collectBookmarks(v.state.doc).get(name);
  if (v && b) {
    v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(b.pos))).scrollIntoView());
    v.focus();
  }
}

export type XRefKind = 'heading' | 'caption' | 'bookmark' | 'footnote' | 'endnote';
export type XRefWhat = 'text' | 'label' | 'page' | 'position' | 'number';

export interface XRefTarget {
  label: string;
  /** Paragraph position (headings, captions) or bookmark/note data. */
  pos: number;
  bookmark: string | null;
  noteId?: string;
}

export function xrefTargets(ctl: WriterCtl, kind: XRefKind, label?: string): XRefTarget[] {
  const doc = ctl.body;
  switch (kind) {
    case 'heading':
      return collectHeadings(doc, 1, 9).map((h) => ({ label: `${'  '.repeat(h.level - 1)}${h.text}`, pos: h.pos, bookmark: h.bookmark }));
    case 'caption':
      return collectCaptions(doc, label).map((c) => ({ label: c.text, pos: c.pos, bookmark: c.bookmark }));
    case 'bookmark':
      return listBookmarks(ctl).map((b) => ({ label: b.name, pos: b.pos, bookmark: b.name }));
    default:
      return ctl
        .notes()
        .filter((n) => n.kind === kind)
        .map((n) => ({ label: `${n.label}  ${plainText(n.node)}`, pos: n.pos, bookmark: null, noteId: n.id }));
  }
}

function plainText(note: PMNode): string {
  const b = note.attrs.body as { content?: { content?: { text?: string }[] }[] } | null;
  return (b?.content ?? []).map((p) => (p.content ?? []).map((t) => t.text ?? '').join('')).join(' ').slice(0, 60);
}

/** Insert a cross reference to a heading, caption, bookmark or note. */
export function insertCrossReference(ctl: WriterCtl, kind: XRefKind, target: XRefTarget, what: XRefWhat, hyperlink: boolean): string | null {
  const v = ctl.mainView;
  if (!v || ctl.readOnly) return 'No hay documento.';
  let name = target.bookmark;
  if (!name) {
    if (kind === 'footnote' || kind === 'endnote') {
      // a bookmark right before the note reference
      const taken = new Set(collectBookmarks(v.state.doc).keys());
      name = uniqueBookmark('_RefN', taken);
      v.dispatch(v.state.tr.insert(target.pos, nodeTypes.bookmark!.create({ name })).setMeta('nw-no-track', true).setMeta('nw-allow', true));
    } else name = ensureBookmarks(ctl, [{ pos: target.pos, bookmark: null }], '_Ref')[0]!;
  }
  let fieldAttrs: Record<string, unknown>;
  if (what === 'page') fieldAttrs = { kind: 'pageref', arg: name };
  else if (what === 'position') fieldAttrs = { kind: 'ref', arg: name, switches: '\\p \\h' };
  else if (kind === 'footnote' || kind === 'endnote') fieldAttrs = { kind: 'noteref', arg: name };
  else if (what === 'label' && kind === 'caption') fieldAttrs = { kind: 'ref', arg: name, switches: '\\n \\h' };
  else fieldAttrs = { kind: 'ref', arg: name, switches: '\\h' };
  const marks = hyperlink ? [markTypes.link!.create({ href: `#${name}` })] : [];
  const node = nodeTypes.field!.create({ result: '…', ...fieldAttrs }, null, marks);
  v.dispatch(v.state.tr.replaceSelectionWith(node, false).setMeta('nw-no-track', true).setMeta('nw-allow', true));
  updateFields(ctl);
  return null;
}

// ------------------------------------------------------------------------------------------------ index and citations

export function markIndexEntry(ctl: WriterCtl, entry: string, opts: { see?: string; bold?: boolean; italic?: boolean } = {}): void {
  const v = ctl.mainView;
  if (!v || !entry.trim()) return;
  let sw = '';
  if (opts.see) sw += ` \\t "${opts.see}"`;
  if (opts.bold) sw += ' \\b';
  if (opts.italic) sw += ' \\i';
  const node = nodeTypes.field!.create({ kind: 'xe', arg: entry.trim(), switches: sw.trim() || null, result: '' });
  const { to } = v.state.selection;
  v.dispatch(v.state.tr.insert(to, node).setMeta('nw-no-track', true).setMeta('nw-allow', true));
}

export function insertCitation(ctl: WriterCtl, tags: string[], opts: { pages?: string; suppressAuthor?: boolean; suppressYear?: boolean } = {}): void {
  const v = ctl.mainView;
  if (!v || ctl.readOnly || !tags.length) return;
  let sw = '';
  if (opts.pages) sw += ` \\p "${opts.pages}"`;
  if (opts.suppressAuthor) sw += ' \\n';
  if (opts.suppressYear) sw += ' \\y';
  const node = nodeTypes.field!.create({ kind: 'citation', arg: tags.join(';'), switches: sw.trim() || null, result: '…' });
  v.dispatch(v.state.tr.replaceSelectionWith(node, false).setMeta('nw-no-track', true).setMeta('nw-allow', true));
  updateFields(ctl);
}

/** The citation or other field node selected or just before the caret (for editing it). */
export function fieldAtCaret(ctl: WriterCtl): { pos: number; node: PMNode } | null {
  const v = ctl.mainView;
  if (!v) return null;
  const sel = v.state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === 'field') return { pos: sel.from, node: sel.node };
  const before = sel.$from.nodeBefore;
  if (before && before.type.name === 'field') return { pos: sel.from - before.nodeSize, node: before };
  return null;
}

void plainOf;
void ptToPx;
void tocInstr;
void run;
