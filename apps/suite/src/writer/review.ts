import { markTypes, nodeTypes, type CommentData } from '@suitenova/writer-core';
import { Fragment, Mark, Slice, type Node as PMNode } from 'prosemirror-model';
import { Plugin, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from 'prosemirror-transform';
import type { EditorView } from 'prosemirror-view';

// ------------------------------------------------------------------------------------------------ the user

export interface UserInfo {
  name: string;
  initials: string;
}

const USER_KEY = 'nova.writer.user';

export function getUser(): UserInfo {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(USER_KEY) : null;
    if (raw) {
      const u = JSON.parse(raw) as UserInfo;
      if (u.name) return { name: u.name, initials: u.initials || initialsOf(u.name) };
    }
  } catch {
    // no storage: use the default
  }
  return { name: 'Autor', initials: 'A' };
}

export function setUser(u: UserInfo): void {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(u));
  } catch {
    // ignore: the name is only used for new comments and changes
  }
}

export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase())
    .join('');

let seq = 0;
export const newId = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

// ------------------------------------------------------------------------------------------------ comments

/** The range of text each comment is anchored to. */
export function commentRanges(doc: PMNode): Map<string, { from: number; to: number }> {
  const out = new Map<string, { from: number; to: number }>();
  doc.descendants((node, pos) => {
    if (!node.isInline) return true;
    for (const m of node.marks) {
      if (m.type.name !== 'comment') continue;
      const r = out.get(m.attrs.id);
      const to = pos + node.nodeSize;
      if (r) {
        r.from = Math.min(r.from, pos);
        r.to = Math.max(r.to, to);
      } else out.set(m.attrs.id, { from: pos, to });
    }
    return true;
  });
  return out;
}

/** Anchor a new comment on the selection (or on the word at the caret). Returns the comment id and its data. */
export function addCommentMark(view: EditorView, text: string, user: UserInfo): CommentData | null {
  const { state } = view;
  let { from, to } = state.selection;
  if (from === to) {
    // the word around the caret
    const $p = state.doc.resolve(from);
    const t = $p.parent.textContent;
    let a = $p.parentOffset;
    let b = a;
    while (a > 0 && /[\p{L}\p{N}]/u.test(t[a - 1]!)) a--;
    while (b < t.length && /[\p{L}\p{N}]/u.test(t[b]!)) b++;
    if (a === b) return null;
    from = $p.start() + a;
    to = $p.start() + b;
  }
  const id = newId('k');
  const tr = state.tr.addMark(from, to, markTypes.comment!.create({ id })).setMeta('nw-no-track', true);
  view.dispatch(tr);
  return { id, author: user.name, initials: user.initials, date: new Date().toISOString(), text, parent: null, done: false };
}

/** Remove the anchor marks of comments from the document. */
export function removeCommentMarks(view: EditorView, ids: string[]): void {
  const { state } = view;
  const tr = state.tr;
  const set = new Set(ids);
  state.doc.descendants((node, pos) => {
    if (!node.isInline) return true;
    for (const m of node.marks) if (m.type.name === 'comment' && set.has(m.attrs.id)) tr.removeMark(pos, pos + node.nodeSize, m);
    return true;
  });
  if (tr.docChanged) view.dispatch(tr.setMeta('nw-no-track', true));
}

// ------------------------------------------------------------------------------------------------ tracked changes

export interface Change {
  /** `ins` / `del` of text and objects; `pins` / `pdel` of a paragraph mark. */
  kind: 'ins' | 'del' | 'pins' | 'pdel';
  id: string;
  author: string;
  date: string;
  ranges: { from: number; to: number }[];
  /** Text of the change (for the list). */
  text: string;
}

/** Every tracked change of the document in order. Text marks with the same id form one change. */
export function listChanges(doc: PMNode): Change[] {
  const byKey = new Map<string, Change>();
  const order: Change[] = [];
  const add = (kind: Change['kind'], attrs: { id: string; author: string; date: string }, from: number, to: number, text: string) => {
    const key = `${kind}:${attrs.id}:${attrs.author}`;
    let c = byKey.get(key);
    if (!c) {
      c = { kind, id: attrs.id, author: attrs.author, date: attrs.date, ranges: [], text: '' };
      byKey.set(key, c);
      order.push(c);
    }
    const last = c.ranges[c.ranges.length - 1];
    if (last && last.to === from) last.to = to;
    else c.ranges.push({ from, to });
    c.text += text;
  };
  doc.descendants((node, pos) => {
    if (node.isInline) {
      for (const m of node.marks) {
        if (m.type.name === 'ins') add('ins', m.attrs as never, pos, pos + node.nodeSize, node.isText ? node.text! : '¤');
        else if (m.type.name === 'del') add('del', m.attrs as never, pos, pos + node.nodeSize, node.isText ? node.text! : '¤');
      }
    } else if (node.type.name === 'paragraph') {
      if (node.attrs.ins) add('pins', node.attrs.ins, pos + node.nodeSize - 1, pos + node.nodeSize, '¶');
      if (node.attrs.del) add('pdel', node.attrs.del, pos + node.nodeSize - 1, pos + node.nodeSize, '¶');
    }
    return true;
  });
  // keep the order of the first range
  return order.sort((a, b) => a.ranges[0]!.from - b.ranges[0]!.from);
}

const sameDay = (a: string, b: string) => a.slice(0, 10) === b.slice(0, 10);
void sameDay;

function markFragment(f: Fragment, mark: Mark): Fragment {
  const out: PMNode[] = [];
  f.forEach((n) => {
    if (n.isInline) out.push(n.mark(mark.addToSet(n.marks.filter((m) => m.type !== mark.type))));
    else out.push(n.copy(markFragment(n.content, mark)));
  });
  return Fragment.fromArray(out);
}

/**
 * Turn the edit of a transaction into a tracked change: inserted text gets an `ins` mark and deleted text keeps its place
 * with a `del` mark (deleted paragraph marks and inserted ones are recorded on the paragraph). Edits that cannot be
 * tracked are applied as they are.
 */
export function trackTransaction(tr: Transaction, state: EditorState, user: UserInfo): Transaction {
  if (!tr.docChanged || tr.getMeta('nw-no-track') || tr.getMeta('nw-load')) return tr;
  const steps = tr.steps;
  // only plain replacements, with positions going from the end of the document to its start (typing, deleting, replace all)
  let prevFrom = Infinity;
  for (const s of steps) {
    if (s instanceof AddMarkStep || s instanceof RemoveMarkStep) continue;
    if (!(s instanceof ReplaceStep)) return tr;
    if (s.from > prevFrom) return tr;
    prevFrom = s.from;
  }
  const date = new Date().toISOString();
  const rev = { id: newId('r'), author: user.name, date };
  const insMark = (at: number, doc: PMNode): Mark => {
    // typing right after our own insertion continues it
    const before = doc.resolve(at).nodeBefore;
    const prev = before?.marks.find((m) => m.type.name === 'ins' && m.attrs.author === user.name);
    return prev ?? markTypes.ins!.create(rev);
  };
  const delMark = markTypes.del!.create(rev);
  const nt = state.tr;
  let caret: number | null = null;
  const oldHead = state.selection.head;
  for (const step of steps) {
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
      nt.step(step);
      continue;
    }
    const s = step as ReplaceStep;
    const doc = nt.doc;
    const { from, to } = s;
    let insertAt = to;
    // 1) the deleted part stays, marked
    if (to > from) {
      const removable: { from: number; to: number }[] = [];
      const paragraphs: number[] = [];
      doc.nodesBetween(from, to, (node, pos) => {
        if (node.isInline) {
          const a = Math.max(from, pos);
          const b = Math.min(to, pos + node.nodeSize);
          const own = node.marks.find((m) => m.type.name === 'ins' && m.attrs.author === user.name);
          if (own) removable.push({ from: a, to: b });
          else if (!node.marks.some((m) => m.type.name === 'del')) nt.addMark(a, b, delMark);
        } else if (node.type.name === 'paragraph' && pos + node.nodeSize - 1 < to && pos + node.nodeSize - 1 >= from) {
          paragraphs.push(pos);
        }
        return true;
      });
      for (const p of paragraphs) {
        const para = nt.doc.nodeAt(p);
        if (para && !para.attrs.del && !para.attrs.ins) nt.setNodeMarkup(p, undefined, { ...para.attrs, del: rev });
      }
      for (const r of removable.reverse()) {
        nt.delete(r.from, r.to);
        insertAt -= r.to - r.from;
      }
    }
    // 2) the inserted part gets the insertion mark
    if (s.slice.size > 0) {
      const mark = insMark(insertAt, nt.doc);
      const slice = new Slice(markFragment(s.slice.content, mark), s.slice.openStart, s.slice.openEnd);
      const before = nt.doc.content.size;
      nt.step(new ReplaceStep(insertAt, insertAt, slice));
      const added = nt.doc.content.size - before;
      // an inserted paragraph break is recorded on the paragraph that ends there
      if (slice.content.childCount > 1 || (slice.openStart > 0 && slice.openEnd > 0 && slice.content.childCount >= 2)) {
        const $a = nt.doc.resolve(insertAt);
        const para = $a.parent;
        if (para.type.name === 'paragraph' && !para.attrs.ins) nt.setNodeMarkup($a.before(), undefined, { ...para.attrs, ins: rev });
      }
      caret = insertAt + added;
    } else {
      // a deletion: the caret goes before the deleted text when deleting backwards, after it when deleting forwards
      caret = oldHead >= to ? from : to;
    }
  }
  if (caret !== null) {
    const $c = nt.doc.resolve(Math.max(0, Math.min(caret, nt.doc.content.size)));
    nt.setSelection(TextSelection.near($c, -1));
  }
  nt.setMeta('addToHistory', tr.getMeta('addToHistory'));
  nt.scrollIntoView();
  for (const key of ['uiEvent', 'paste', 'composition', 'pointer']) {
    const v = tr.getMeta(key);
    if (v !== undefined) nt.setMeta(key, v);
  }
  return nt;
}

// ------------------------------------------------------------------------------------------------ accept and reject

function applyOne(tr: Transaction, c: Change, accept: boolean): void {
  // from the end so that the earlier ranges keep their positions
  const ranges = [...c.ranges].sort((a, b) => b.from - a.from);
  for (const r of ranges) {
    const from = tr.mapping.map(r.from);
    const to = tr.mapping.map(r.to);
    if (c.kind === 'ins') {
      if (accept) tr.removeMark(from, to, markTypes.ins);
      else tr.delete(from, to);
    } else if (c.kind === 'del') {
      if (accept) tr.delete(from, to);
      else tr.removeMark(from, to, markTypes.del);
    } else {
      // a paragraph mark: r covers the end token of the paragraph
      const $e = tr.doc.resolve(from);
      const paraStart = $e.before();
      const para = $e.parent;
      if (para.type.name !== 'paragraph') continue;
      const clear = (key: 'ins' | 'del') => tr.setNodeMarkup(paraStart, undefined, { ...para.attrs, [key]: null });
      const join = () => {
        const after = paraStart + para.nodeSize;
        const next = tr.doc.nodeAt(after);
        if (next && next.type.name === 'paragraph') {
          tr.join(after);
          // the merged paragraph keeps the properties of the paragraph whose mark survives
          tr.setNodeMarkup(paraStart, undefined, { ...next.attrs, ins: null, del: null });
        } else clear(c.kind === 'pins' ? 'ins' : 'del');
      };
      if (c.kind === 'pins') accept ? clear('ins') : join();
      else accept ? join() : clear('del');
    }
  }
}

export function applyChanges(view: EditorView, changes: Change[], accept: boolean): void {
  if (!changes.length) return;
  const tr = view.state.tr;
  // later changes first so that positions stay valid
  for (const c of [...changes].sort((a, b) => b.ranges[0]!.from - a.ranges[0]!.from)) applyOne(tr, c, accept);
  view.dispatch(tr.setMeta('nw-no-track', true).scrollIntoView());
}

export function changesIn(doc: PMNode, from: number, to: number): Change[] {
  return listChanges(doc).filter((c) => c.ranges.some((r) => r.from < to && r.to > from) || (from === to && c.ranges.some((r) => r.from <= from && r.to >= from)));
}

export function nextChange(state: EditorState, dir: 1 | -1): Change | null {
  const all = listChanges(state.doc);
  if (!all.length) return null;
  const head = state.selection.head;
  if (dir === 1) return all.find((c) => c.ranges[0]!.from >= head && !(c.ranges[0]!.from === head && state.selection.empty && false)) ?? all[0]!;
  const before = [...all].reverse().find((c) => c.ranges[0]!.to <= head - (state.selection.empty ? 0 : 0) - (state.selection.empty ? 1 : 0));
  return before ?? all[all.length - 1]!;
}

export function selectChange(view: EditorView, c: Change): void {
  const r = c.ranges[0]!;
  const doc = view.state.doc;
  const from = Math.min(r.from, doc.content.size);
  const to = Math.min(r.to, doc.content.size);
  const sel = c.kind === 'pins' || c.kind === 'pdel' ? TextSelection.near(doc.resolve(Math.max(1, from - 1)), -1) : TextSelection.create(doc, from, Math.max(from, to));
  view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
  view.focus();
}

// ------------------------------------------------------------------------------------------------ protection

export type ProtectionMode = 'readOnly' | 'forms' | 'comments' | 'trackedChanges';

/** Where a step touches content controls (for form filling and locked controls). */
function inControl($from: ReturnType<PMNode['resolve']>, $to: ReturnType<PMNode['resolve']>): { whole: PMNode | null; same: boolean } {
  for (let d = Math.min($from.depth, $to.depth); d > 0; d--) {
    const a = $from.node(d);
    if ((a.type.name === 'content_control' || a.type.name === 'content_control_block') && a === $to.node(d)) return { whole: a, same: true };
  }
  return { whole: null, same: false };
}

/**
 * Editing restrictions and locked content controls. `getMode` returns the active restriction of the document, if any.
 */
export function protectionPlugin(getMode: () => ProtectionMode | null): Plugin {
  return new Plugin({
    filterTransaction(tr) {
      if (!tr.docChanged || tr.getMeta('nw-allow')) return true;
      const mode = getMode();
      for (let i = 0; i < tr.steps.length; i++) {
        const step = tr.steps[i]!;
        const doc = tr.docs[i]!;
        const range = step instanceof ReplaceStep ? { from: step.from, to: step.to } : null;
        if (mode === 'readOnly') return false;
        if (mode === 'comments') {
          const ok = (step instanceof AddMarkStep || step instanceof RemoveMarkStep) && (step as AddMarkStep).mark.type.name === 'comment';
          if (!ok && !tr.getMeta('nw-comment')) return false;
        }
        if (mode === 'forms' && !tr.getMeta('nw-form')) {
          if (!range) return false;
          const c = inControl(doc.resolve(range.from), doc.resolve(range.to));
          if (!c.same) return false;
        }
        // locked controls
        if (range) {
          const $f = doc.resolve(range.from);
          const $t = doc.resolve(range.to);
          const c = inControl($f, $t);
          if (c.whole?.attrs.lock === 'contentLocked' && !tr.getMeta('nw-form')) return false;
          // deleting a control that cannot be deleted
          let blocked = false;
          doc.nodesBetween(range.from, range.to, (node, pos) => {
            if ((node.type.name === 'content_control' || node.type.name === 'content_control_block') && (node.attrs.lock === 'sdtLocked' || node.attrs.lock === 'sdtContentLocked') && pos >= range.from && pos + node.nodeSize <= range.to) blocked = true;
            return !blocked;
          });
          if (blocked) return false;
        }
      }
      return true;
    },
  });
}

void nodeTypes;
