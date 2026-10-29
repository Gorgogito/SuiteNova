import { documentFormulas } from '@suitenova/notes-core';
import { nodeTypes } from '@suitenova/writer-core';
import { baseKeymap } from 'prosemirror-commands';
import { history } from 'prosemirror-history';
import { inputRules, wrappingInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { Plugin, PluginKey } from 'prosemirror-state';
import { columnResizing, tableEditing } from 'prosemirror-tables';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { backspaceCommand, deleteCommand, enterCommand, shiftTabCommand, tabCommand, trailingParagraph } from './editing';
import type { NotesCtl } from './ctl';

/** Clicking the box drawn in front of a tag with a check box toggles it between to-do and done. */
function tagClickPlugin(ctl: NotesCtl): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view, e) {
          const el = e.target as HTMLElement;
          if (el.tagName !== 'P' || !el.dataset.tag) return false;
          const tag = el.dataset.tag;
          const base = tag.endsWith(':done') ? tag.slice(0, -5) : tag;
          if (!ctl.isCheckbox(base === 'done' ? 'todo' : base)) return false;
          const r = el.getBoundingClientRect();
          if (e.clientX - r.left > 22) return false;
          const pos = view.posAtDOM(el, 0);
          const $p = view.state.doc.resolve(pos);
          const node = $p.parent;
          const done = tag === 'done' || tag.endsWith(':done');
          const b = tag === 'done' ? 'todo' : base;
          view.dispatch(view.state.tr.setNodeMarkup($p.before(), undefined, { ...node.attrs, tag: done ? b : `${b}:done` }));
          e.preventDefault();
          return true;
        },
      },
    },
  });
}

/** A link to another page of the notebook (`#nn:page:<id>`) opens that page. */
function pageLinkPlugin(ctl: NotesCtl): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        click(_view, e) {
          const a = (e.target as HTMLElement).closest?.('a');
          const href = a?.getAttribute('href') ?? '';
          const m = /^#nn:page:(.+)$/.exec(href);
          if (!m) return false;
          e.preventDefault();
          if (!ctl.goToAnyPage(m[1]!)) ctl.say('La página a la que apunta este vínculo ya no existe.');
          return true;
        },
      },
    },
  });
}

/**
 * Table formulas: a cell that starts with "=" shows its result; the formula itself appears while the cursor is in the cell.
 */
const focusKey = new PluginKey<boolean>('nn-focus');
function formulaPlugin(): Plugin {
  return new Plugin({
    key: focusKey,
    state: { init: () => false, apply: (tr, v) => (tr.getMeta(focusKey) as boolean | undefined) ?? v },
    props: {
      handleDOMEvents: {
        focus(view) {
          view.dispatch(view.state.tr.setMeta(focusKey, true));
          return false;
        },
        blur(view) {
          view.dispatch(view.state.tr.setMeta(focusKey, false));
          return false;
        },
      },
      decorations(state) {
        const cells = documentFormulas(state.doc, 'es');
        if (!cells.length) return DecorationSet.empty;
        const sel = state.selection;
        const focused = focusKey.getState(state) === true;
        const decos: Decoration[] = [];
        for (const c of cells) {
          const inside = focused && sel.from >= c.from - 1 && sel.to <= c.to + 1;
          if (inside) {
            decos.push(Decoration.widget(c.to, () => {
              const s = document.createElement('span');
              s.className = `nn-fval nn-fval--hint${c.result.error ? ' is-error' : ''}`;
              s.textContent = ` → ${c.result.text}`;
              s.contentEditable = 'false';
              return s;
            }, { side: 1, key: `h${c.from}${c.result.text}` }));
          } else {
            decos.push(Decoration.inline(c.from, c.to, { class: 'nn-fsrc' }));
            decos.push(Decoration.widget(c.from, () => {
              const s = document.createElement('span');
              s.className = `nn-fval${c.result.error ? ' is-error' : ''}`;
              s.textContent = c.result.text;
              s.title = c.result.formula;
              s.contentEditable = 'false';
              return s;
            }, { side: -1, key: `v${c.from}${c.result.text}` }));
          }
        }
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}

/** The plugins of the editor in every text box of a page. */
export function textPlugins(ctl: NotesCtl): Plugin[] {
  return [
    history(),
    inputRules({ rules: [wrappingInputRule(/^\s*([-+*•])\s$/, nodeTypes.bullet_list!), wrappingInputRule(/^(\d+)\.\s$/, nodeTypes.ordered_list!, (m) => ({ start: Number(m[1]), format: 'decimal' }))] }),
    keymap({ Enter: enterCommand, Tab: tabCommand, 'Shift-Tab': shiftTabCommand, Backspace: backspaceCommand, Delete: deleteCommand }),
    keymap(baseKeymap),
    columnResizing({ cellMinWidth: 30 }),
    tableEditing(),
    trailingParagraph(),
    tagClickPlugin(ctl),
    pageLinkPlugin(ctl),
    formulaPlugin(),
  ];
}
