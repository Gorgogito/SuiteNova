import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

/** Outline level of a paragraph: 1-6 for headings, 0 for body text. */
export function levelOf(node: PMNode): number {
  if (node.type.name !== 'paragraph') return 0;
  const m = /^Heading(\d)$/.exec(node.attrs.style ?? '');
  return m ? Number(m[1]) : 0;
}

export interface OutlineState {
  active: boolean;
  /** Positions of the headings whose content is folded. */
  collapsed: number[];
  /** Show only headings up to this level (null: everything). */
  level: number | null;
  deco: DecorationSet;
}

export const outlineKey = new PluginKey<OutlineState>('outline');

interface Meta {
  active?: boolean;
  toggle?: number;
  level?: number | null;
  clear?: boolean;
}

function build(doc: PMNode, st: Omit<OutlineState, 'deco'>): DecorationSet {
  if (!st.active) return DecorationSet.empty;
  const decos: Decoration[] = [];
  const collapsed = new Set(st.collapsed);
  let hideBelow = 0; // while > 0, hide blocks until a heading of this level or higher
  doc.forEach((sec, secOff) => {
    if (sec.type.name !== 'section') return;
    sec.forEach((block, off) => {
      const pos = secOff + 1 + off;
      const lv = levelOf(block);
      if (lv > 0) {
        if (hideBelow && lv <= hideBelow) hideBelow = 0;
      }
      const hiddenByFold = hideBelow > 0;
      const hiddenByLevel = st.level !== null && (lv === 0 || lv > st.level);
      const hidden = hiddenByFold || hiddenByLevel;
      const cls: string[] = [];
      if (hidden) cls.push('nw-ol-hidden');
      if (lv > 0) cls.push('nw-ol-h', `nw-ol-lv${lv}`);
      else cls.push('nw-ol-body');
      decos.push(Decoration.node(pos, pos + block.nodeSize, { class: cls.join(' ') }));
      if (lv > 0 && !hidden) {
        const isCollapsed = collapsed.has(pos);
        decos.push(
          Decoration.widget(
            pos + 1,
            (view) => {
              const b = document.createElement('span');
              b.className = `nw-ol-marker${isCollapsed ? ' is-collapsed' : ''}`;
              b.dataset.pos = String(pos);
              b.contentEditable = 'false';
              b.textContent = isCollapsed ? '⊞' : '⊟';
              b.title = isCollapsed ? 'Expandir' : 'Contraer';
              b.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                view.dispatch(view.state.tr.setMeta(outlineKey, { toggle: pos } satisfies Meta).setMeta('addToHistory', false));
              });
              return b;
            },
            { side: -1, key: `ol${pos}${isCollapsed ? 'c' : 'e'}`, ignoreSelection: true },
          ),
        );
      }
      if (lv > 0 && collapsed.has(pos) && !hideBelow) hideBelow = lv;
    });
  });
  return DecorationSet.create(doc, decos);
}

export function outlinePlugin(): Plugin<OutlineState> {
  return new Plugin<OutlineState>({
    key: outlineKey,
    state: {
      init: (_c, s) => ({ active: false, collapsed: [], level: null, deco: DecorationSet.empty, ...{ doc: s.doc } }) as OutlineState,
      apply(tr, value, _old, state) {
        const meta = tr.getMeta(outlineKey) as Meta | undefined;
        let { active, collapsed, level } = value;
        if (tr.docChanged) collapsed = collapsed.map((p) => tr.mapping.map(p));
        if (meta) {
          if (meta.active !== undefined) active = meta.active;
          if (meta.level !== undefined) level = meta.level;
          if (meta.clear) collapsed = [];
          if (meta.toggle !== undefined) collapsed = collapsed.includes(meta.toggle) ? collapsed.filter((p) => p !== meta.toggle) : [...collapsed, meta.toggle];
        } else if (!tr.docChanged) return value;
        return { active, collapsed, level, deco: build(state.doc, { active, collapsed, level }) };
      },
    },
    props: {
      decorations: (state) => outlineKey.getState(state)?.deco,
    },
  });
}

export const setOutlineActive = (active: boolean): Command => (state, dispatch) => {
  if (dispatch) dispatch(state.tr.setMeta(outlineKey, { active, clear: active } satisfies Meta).setMeta('addToHistory', false));
  return true;
};

export const showLevel = (level: number | null): Command => (state, dispatch) => {
  if (dispatch) dispatch(state.tr.setMeta(outlineKey, { level, clear: level === null } satisfies Meta).setMeta('addToHistory', false));
  return true;
};

/** Position of the block (child of a section) that holds the selection head, with its section. */
function blockAtHead(state: EditorState): { pos: number; node: PMNode; secPos: number; index: number; sec: PMNode } | null {
  const $h = state.selection.$head;
  for (let d = 1; d <= $h.depth; d++) {
    if ($h.node(d).type.name === 'section') {
      const sec = $h.node(d);
      const index = $h.index(d);
      if (index >= sec.childCount) return null;
      const node = sec.child(index);
      return { pos: $h.posAtIndex(index, d), node, secPos: $h.before(d), index, sec };
    }
  }
  return null;
}

/** Fold or unfold the heading at the caret. */
export const toggleFold: Command = (state, dispatch) => {
  const b = blockAtHead(state);
  if (!b || levelOf(b.node) === 0) return false;
  if (dispatch) dispatch(state.tr.setMeta(outlineKey, { toggle: b.pos } satisfies Meta).setMeta('addToHistory', false));
  return true;
};

export function expandAll(): Command {
  return (state, dispatch) => {
    if (dispatch) dispatch(state.tr.setMeta(outlineKey, { clear: true, level: null } satisfies Meta).setMeta('addToHistory', false));
    return true;
  };
}

const setStyle = (tr: Transaction, pos: number, node: PMNode, style: string | null) => tr.setNodeMarkup(pos, undefined, { ...node.attrs, style });

/** Promote (-1) or demote (+1) the headings in the selection; body text becomes a heading one level below the one before. */
export function shiftLevel(delta: 1 | -1): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    let changed = false;
    const { from, to } = state.selection;
    let prevLevel = 0;
    state.doc.descendants((node, pos) => {
      if (node.type.name !== 'paragraph') return true;
      const lv = levelOf(node);
      if (pos + node.nodeSize >= from && pos <= to) {
        let next = lv;
        if (lv === 0) next = delta === -1 ? Math.max(1, prevLevel || 1) : 0;
        else next = lv + delta;
        if (next !== lv) {
          if (next < 1 && delta === -1) next = 1;
          if (next > 6) next = 0;
          if (next !== lv) {
            setStyle(tr, pos, node, next === 0 ? null : `Heading${next}`);
            changed = true;
          }
        }
      }
      if (lv > 0) prevLevel = lv;
      return false;
    });
    if (!changed) return false;
    if (dispatch) dispatch(tr);
    return true;
  };
}

/** Make the paragraph at the caret body text. */
export const toBodyText: Command = (state, dispatch) => {
  const tr = state.tr;
  let changed = false;
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (node.type.name === 'paragraph' && levelOf(node) > 0) {
      setStyle(tr, pos, node, null);
      changed = true;
    }
    return node.type.name !== 'paragraph';
  });
  if (changed && dispatch) dispatch(tr);
  return changed;
};

/** Move the heading at the caret, with everything under it, above the previous one or below the next one. */
export function moveHeading(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const b = blockAtHead(state);
    if (!b) return false;
    const lv = levelOf(b.node);
    if (lv === 0) return false;
    const children: { node: PMNode; pos: number }[] = [];
    b.sec.forEach((node, off) => children.push({ node, pos: b.secPos + 1 + off }));
    const i = b.index;
    let j = i + 1;
    while (j < children.length && !(levelOf(children[j]!.node) > 0 && levelOf(children[j]!.node) <= lv)) j++;
    const from = children[i]!.pos;
    const to = j < children.length ? children[j]!.pos : b.secPos + b.sec.nodeSize - 1;
    if (dir === -1) {
      let p = i - 1;
      while (p >= 0 && !(levelOf(children[p]!.node) > 0 && levelOf(children[p]!.node) <= lv)) p--;
      if (p < 0) return false;
      const target = children[p]!.pos;
      if (dispatch) {
        const slice = state.doc.slice(from, to);
        const tr = state.tr.delete(from, to).insert(target, slice.content);
        tr.setSelection(TextSelection.near(tr.doc.resolve(target + 1)));
        dispatch(tr.scrollIntoView());
      }
      return true;
    }
    if (j >= children.length) return false;
    // the next group: from j to the next heading of the same or higher level
    let k = j + 1;
    while (k < children.length && !(levelOf(children[k]!.node) > 0 && levelOf(children[k]!.node) <= lv)) k++;
    const end = k < children.length ? children[k]!.pos : b.secPos + b.sec.nodeSize - 1;
    if (dispatch) {
      const slice = state.doc.slice(from, to);
      const tr = state.tr.insert(end, slice.content).delete(from, to);
      const newPos = end - (to - from);
      tr.setSelection(TextSelection.near(tr.doc.resolve(newPos + 1)));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Headings of a document for the navigation pane. */
export interface HeadingItem {
  pos: number;
  level: number;
  text: string;
}
export function headingsOf(doc: PMNode): HeadingItem[] {
  const out: HeadingItem[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'paragraph') {
      const lv = levelOf(node);
      if (lv > 0 && node.textContent.trim()) out.push({ pos, level: lv, text: node.textContent });
      return false;
    }
    return node.type.name !== 'table' || true;
  });
  return out;
}
