import { docNode, mergeR, slidesSchema, type ParaProps, type RunProps, type TextContext } from '@suitenova/slides-core';
import { baseKeymap, chainCommands, deleteSelection, joinBackward, selectAll, splitBlock } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, Plugin, PluginKey, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { cssText, effectiveParaProps, numberParas, paraInfo, runStyle, type TextEnv } from '../render/TextView';

/*
 * ProseMirror editing of a shape's text. The look of the text while editing comes from decorations computed with the same functions
 * as the static view, so what is edited is what is drawn.
 */

export interface EditContext {
  tc: TextContext;
  env: TextEnv;
  ph?: { c?: import('@suitenova/slides-core').Clr };
}

export const editCtxKey = new PluginKey<{ ctx: EditContext }>('slides-edit-ctx');

function buildDecorations(doc: PMNode, ec: EditContext): DecorationSet {
  const decos: Decoration[] = [];
  const nums = numberParas(doc, ec.tc);
  let first = true;
  doc.forEach((para, pos, i) => {
    const { pp, baseR } = effectiveParaProps(ec.tc, para);
    const info = paraInfo(pp, baseR, para, first, nums[i], ec.env, 1, ec.ph, true);
    first = false;
    const attrs: Record<string, string> = { class: 'sl-p', style: cssText(info.style) };
    decos.push(Decoration.node(pos, pos + para.nodeSize, attrs));
    if (info.bullet) decos.push(Decoration.widget(pos + 1, () => bulletEl(info.bullet!), { side: -1, key: `b${pos}${info.bullet.text}`, ignoreSelection: true }));
    para.forEach((c, off) => {
      const from = pos + 1 + off;
      if (c.type.name === 'text') {
        const raw = c.marks.find((m) => m.type.name === 'run')?.attrs.r as RunProps | undefined;
        decos.push(Decoration.inline(from, from + c.nodeSize, { style: cssText(runStyle(mergeR(baseR, raw), ec.env, 1, ec.ph)) }));
      }
    });
  });
  return DecorationSet.create(doc, decos);
}

function bulletEl(b: NonNullable<ReturnType<typeof paraInfo>['bullet']>): HTMLElement {
  const s = document.createElement('span');
  s.className = 'sl-bullet';
  s.contentEditable = 'false';
  s.textContent = b.text;
  s.setAttribute('style', cssText(b.style));
  return s;
}

export function decorationPlugin(ec: EditContext): Plugin {
  return new Plugin({
    key: editCtxKey,
    state: {
      init: () => ({ ctx: ec }),
      apply: (tr, v) => (tr.getMeta(editCtxKey) as { ctx: EditContext } | undefined) ?? v,
    },
    props: {
      decorations(state) {
        const v = editCtxKey.getState(state)!;
        return buildDecorations(state.doc, v.ctx);
      },
    },
  });
}

// ------------------------------------------------------------------------------------------------ commands

const runType = slidesSchema.marks.run!;

/** The run properties at the selection: the level style plus the marks (merged over the whole selection when they agree). */
export function currentRun(state: EditorState, ec: EditContext): RunProps {
  const { from, to, empty, $from } = state.selection;
  const para = $from.depth >= 1 ? $from.node(1) : state.doc.firstChild!;
  const { baseR } = effectiveParaProps(ec.tc, para);
  const stored = state.storedMarks?.find((m) => m.type === runType)?.attrs.r as RunProps | undefined;
  if (empty) {
    const m = (stored ?? ($from.marks().find((x) => x.type === runType)?.attrs.r as RunProps | undefined)) ?? (para.attrs.end as RunProps);
    return mergeR(baseR, m);
  }
  let acc: RunProps | undefined;
  state.doc.nodesBetween(from, to, (n) => {
    if (n.isText) {
      const r = mergeR(baseR, n.marks.find((m) => m.type === runType)?.attrs.r as RunProps | undefined);
      if (!acc) acc = r;
      else {
        for (const k of Object.keys(acc) as (keyof RunProps)[]) if (JSON.stringify(acc[k]) !== JSON.stringify(r[k])) delete acc[k];
      }
    }
  });
  return acc ?? baseR;
}

/** Applies a change of run properties to the selection (to what is typed next when the selection is empty). */
export function setRun(fn: (r: RunProps) => RunProps): Command {
  return (state, dispatch) => {
    const { from, to, empty, $from } = state.selection;
    if (empty) {
      if (dispatch) {
        const cur = ($from.marks().find((m) => m.type === runType)?.attrs.r as RunProps | undefined) ?? {};
        const next = fn(state.storedMarks?.find((m) => m.type === runType)?.attrs.r ?? cur);
        dispatch(state.tr.setStoredMarks(Object.keys(next).length ? [runType.create({ r: next })] : []));
      }
      return true;
    }
    if (dispatch) {
      const tr = state.tr;
      state.doc.nodesBetween(from, to, (n, pos) => {
        if (!n.isText) return;
        const a = Math.max(from, pos);
        const b = Math.min(to, pos + n.nodeSize);
        const cur = (n.marks.find((m) => m.type === runType)?.attrs.r as RunProps | undefined) ?? {};
        const next = fn(cur);
        tr.removeMark(a, b, runType);
        if (Object.keys(next).length) tr.addMark(a, b, runType.create({ r: next }));
      });
      // fields and line breaks carry their own run properties
      state.doc.nodesBetween(from, to, (n, pos) => {
        if (n.type.name === 'field' || n.type.name === 'hard_break') tr.setNodeMarkup(pos, undefined, { ...n.attrs, r: fn(n.attrs.r as RunProps) });
      });
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** The paragraphs touched by the selection. */
function selectedParas(state: EditorState): { node: PMNode; pos: number }[] {
  const out: { node: PMNode; pos: number }[] = [];
  const { from, to } = state.selection;
  state.doc.forEach((node, pos) => {
    if (pos + node.nodeSize > from && pos <= to) out.push({ node, pos });
  });
  return out;
}

export function setPara(fn: (p: ParaProps, lvl: number) => { p?: ParaProps; lvl?: number }): Command {
  return (state, dispatch) => {
    if (dispatch) {
      const tr = state.tr;
      for (const { node, pos } of selectedParas(state)) {
        const r = fn(node.attrs.p as ParaProps, node.attrs.lvl as number);
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...(r.p ? { p: r.p } : {}), ...(r.lvl !== undefined ? { lvl: r.lvl } : {}) });
      }
      dispatch(tr);
    }
    return true;
  };
}

export const changeLevel = (delta: number): Command => setPara((p, lvl) => ({ lvl: Math.max(0, Math.min(8, lvl + delta)), p }));

const isListPara = (ec: EditContext, para: PMNode): boolean => {
  const b = effectiveParaProps(ec.tc, para).pp.bullet;
  return !!b && (b.kind === 'char' || b.kind === 'auto');
};

/** Enter: a new paragraph with the same properties (an empty list item ends the list instead). */
const makeEnter = (ec: () => EditContext): Command => (state, dispatch) => {
  const { $from, empty } = state.selection;
  const para = $from.parent;
  if (empty && para.content.size === 0 && isListPara(ec(), para)) {
    if (dispatch) {
      const pos = $from.before();
      const lvl = para.attrs.lvl as number;
      if (lvl > 0) dispatch(state.tr.setNodeMarkup(pos, undefined, { ...para.attrs, lvl: lvl - 1 }));
      else dispatch(state.tr.setNodeMarkup(pos, undefined, { ...para.attrs, p: { ...(para.attrs.p as ParaProps), bullet: { kind: 'none' as const }, marL: 0, indent: 0 } }));
    }
    return true;
  }
  return splitBlock(state, dispatch);
};

const softBreak: Command = (state, dispatch) => {
  if (dispatch) dispatch(state.tr.replaceSelectionWith(slidesSchema.nodes.hard_break!.create()).scrollIntoView());
  return true;
};

const makeTab = (ec: () => EditContext): Command => (state, dispatch) => {
  const { $from } = state.selection;
  // in a list item a tab at its start demotes it; elsewhere it is a tab character
  if (isListPara(ec(), $from.parent) && $from.parentOffset === 0) return changeLevel(1)(state, dispatch);
  if (dispatch) dispatch(state.tr.insertText('\t'));
  return true;
};
const shiftTab: Command = (state, dispatch) => changeLevel(-1)(state, dispatch);

const makeBackspace = (ec: () => EditContext): Command => (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (empty && $from.parentOffset === 0) {
    const p = $from.parent.attrs.p as ParaProps;
    const lvl = $from.parent.attrs.lvl as number;
    if (isListPara(ec(), $from.parent)) {
      // the first backspace removes the bullet, keeping the text
      if (dispatch) dispatch(state.tr.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, p: { ...p, bullet: { kind: 'none' }, marL: 0, indent: 0 } }));
      return true;
    }
    if (lvl > 0 && $from.index($from.depth - 1) === 0) return changeLevel(-1)(state, dispatch);
  }
  return false;
};

const toggleMark =
  (key: keyof RunProps, on: RunProps[keyof RunProps] = true): ((ec: () => EditContext) => Command) =>
  (ec) =>
  (state, dispatch) => {
    const cur = currentRun(state, ec());
    const has = !!cur[key];
    return setRun((r) => {
      const n = { ...r };
      if (has) (n as Record<string, unknown>)[key] = key === 'strike' || key === 'u' ? undefined : false;
      else (n as Record<string, unknown>)[key] = on;
      if (n[key] === undefined) delete n[key];
      return n;
    })(state, dispatch);
  };

export function editPlugins(ec: () => EditContext, initial: EditContext): Plugin[] {
  return [
    history(),
    decorationPlugin(initial),
    keymap({
      Enter: makeEnter(ec),
      'Shift-Enter': softBreak,
      Tab: makeTab(ec),
      'Shift-Tab': shiftTab,
      Backspace: chainCommands(makeBackspace(ec), deleteSelection, joinBackward),
      'Mod-z': undo,
      'Mod-y': redo,
      'Mod-Shift-z': redo,
      'Mod-a': selectAll,
      'Mod-b': toggleMark('b')(ec),
      'Mod-i': toggleMark('i')(ec),
      'Mod-u': toggleMark('u', 'sng')(ec),
    }),
    keymap(baseKeymap),
  ];
}

export function makeState(doc: unknown, plugins: Plugin[]): EditorState {
  return EditorState.create({ doc: docNode(doc), plugins });
}

/** Selects all the text of the editor and puts the cursor at the end, used when entering a shape. */
export function cursorAtEnd(tr: Transaction): Transaction {
  return tr.setSelection(TextSelection.atEnd(tr.doc));
}
