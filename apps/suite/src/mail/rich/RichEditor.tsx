/**
 * The box a message is written in: the editor of Nova Writer and Nova Notes (formatting, lists, tables, pictures), with the
 * shared proofing: underlined mistakes, corrections and synonyms on the right button, and autocorrection while typing.
 */
import { tableStylePlugin } from '@suitenova/writer-core';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, Plugin, type Command } from 'prosemirror-state';
import { columnResizing, goToNextCell, isInTable, tableEditing } from 'prosemirror-tables';
import { EditorView } from 'prosemirror-view';
import { useEffect, useMemo, useRef, useState } from 'react';
import { hookMathCopy, mathClipboardProps } from '../../math/clipboard';
import { formulaPlugin } from '../../notes/plugins';
import { AutoCorrectDialog, ReviewMenu, ThesaurusDialog, WordMenu, defaultFieldLang, getAutoCorrect, getAutoCorrectFor, issueAt, langAtPos, loadSpeller, onReviewOptions, pmThesaurusHost, setAutoCorrect, setSpell, spellPlugin, wordUnderPointer, type Issue, type ReviewHost, type WordTarget } from '../../spell';
import { autoCorrectPlugin, autoListRules, ruleLineCommand } from '../../writer/autocorrect';
import { backspaceCommand, changeIndent, deleteCommand, enterCommand, listAncestor } from '../../writer/editing';
import { withoutRemotePictures } from './parse';

const VIEW_ID = 'mail';
// Escape belongs to the message (it closes it), not to the editor (where it would select the whole paragraph)
const { Escape: _selectParent, ...editingKeys } = baseKeymap;

/** A line to write in after a table that ends the message. Only when the text changes: looking at a message does not change it. */
const lineAfterTable = (): Plugin =>
  new Plugin({
    appendTransaction(transactions, _old, state) {
      if (!transactions.some((tr) => tr.docChanged) || state.doc.lastChild?.type.name !== 'table') return null;
      return state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph!.create()).setMeta('addToHistory', false);
    },
  });

/** Tab moves between cells and nests lists; in running text it goes on to the next control, as in any form. */
const tab = (dir: 1 | -1): Command => (state, dispatch) => {
  if (listAncestor(state)) return changeIndent(dir)(state, dispatch) || true;
  if (isInTable(state)) return goToNextCell(dir)(state, dispatch);
  return false;
};

export function RichEditor({ initial, label, onChange, onSelect, onView, onEscape }: { initial: PMNode; label: string; onChange: (doc: PMNode) => void; onSelect?: () => void; onView?: (view: EditorView | null) => void; /** Escape with nothing of the editor open: ProseMirror keeps the key, so it is handed on. */ onEscape?: () => void }) {
  const mount = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef({ onChange, onSelect, onView, onEscape });
  latest.current = { onChange, onSelect, onView, onEscape };
  const lang = defaultFieldLang();
  const [menu, setMenu] = useState<{ issue: Issue | null; word: WordTarget | null; x: number; y: number } | null>(null);
  const [thesaurus, setThesaurus] = useState(false);
  const [autoFix, setAutoFix] = useState(false);
  // a menu of the editor closes with Escape on its own: the key goes no further then
  const open = useRef(false);
  open.current = !!menu || thesaurus || autoFix;
  const host: ReviewHost = useMemo(
    () => ({ lang, views: () => (view.current ? [{ id: VIEW_ID, view: view.current }] : []), focus: () => view.current?.focus() }),
    [lang],
  );
  const synonyms = useMemo(() => pmThesaurusHost(host), [host]);

  useEffect(() => {
    const v: EditorView = new EditorView(mount.current!, {
      state: EditorState.create({
        doc: initial,
        plugins: [
          history(),
          autoListRules(getAutoCorrect),
          keymap({ Enter: ruleLineCommand(getAutoCorrect) }),
          keymap({ Enter: enterCommand, Tab: tab(1), 'Shift-Tab': tab(-1), Backspace: backspaceCommand, Delete: deleteCommand }),
          keymap({
            'Mod-z': undo,
            'Mod-y': redo,
            'Mod-Shift-z': redo,
            'Mod-b': (s, d) => toggleMark(s.schema.marks.strong!)(s, d),
            'Mod-i': (s, d) => toggleMark(s.schema.marks.em!)(s, d),
            'Mod-u': (s, d) => toggleMark(s.schema.marks.underline!)(s, d),
            // Ctrl+Enter sends the message: it adds nothing to the text
            'Mod-Enter': () => true,
          }),
          keymap({
            // a key of the editor, so that it reads where the cursor is now (and not before the last movement)
            'Shift-F7': () => {
              setThesaurus(true);
              return true;
            },
            Escape: () => {
              if (!open.current) latest.current.onEscape?.();
              return true;
            },
          }),
          keymap(editingKeys),
          columnResizing({ cellMinWidth: 30 }),
          tableEditing(),
          tableStylePlugin(),
          lineAfterTable(),
          formulaPlugin(),
          spellPlugin(),
          autoCorrectPlugin(getAutoCorrect, (editor, pos) => langAtPos(editor, pos - 1) ?? lang),
        ],
      }),
      ...mathClipboardProps,
      transformPasted: withoutRemotePictures,
      attributes: { class: 'nw-doc ml-editor', role: 'textbox', 'aria-multiline': 'true', 'aria-label': label, spellcheck: 'false' },
      dispatchTransaction(tr) {
        v.updateState(v.state.apply(tr));
        if (tr.docChanged) latest.current.onChange(v.state.doc);
        latest.current.onSelect?.();
      },
      handleDOMEvents: {
        contextmenu(editor, event) {
          const at = editor.posAtCoords({ left: event.clientX, top: event.clientY });
          const issue = at ? issueAt(editor, at.pos) : null;
          const word = issue ? null : wordUnderPointer(editor, event);
          if (!issue && !word) return false;
          event.preventDefault();
          setMenu({ issue, word, x: event.clientX, y: event.clientY });
          return true;
        },
      },
    });
    view.current = v;
    hookMathCopy(v);
    latest.current.onView?.(v);
    let alive = true;
    void loadSpeller(lang).then(
      (engine) => alive && setSpell(v, { engine, on: true, lang }),
      () => {},
    );
    const off = onReviewOptions(() => setSpell(v, {}));
    return () => {
      alive = false;
      off();
      view.current = null;
      latest.current.onView?.(null);
      v.destroy();
    };
    // one editor for the life of the box: later changes are made through its view
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div ref={mount} className="ml-editorbox" />
      {menu?.issue && <ReviewMenu host={host} viewId={VIEW_ID} issue={menu.issue} x={menu.x} y={menu.y} onClose={() => setMenu(null)} onAutoCorrect={() => setAutoFix(true)} />}
      {menu && !menu.issue && menu.word && view.current && <WordMenu host={host} view={view.current} target={menu.word} x={menu.x} y={menu.y} onClose={() => setMenu(null)} onThesaurus={() => setThesaurus(true)} onAutoCorrect={() => setAutoFix(true)} />}
      {thesaurus && <ThesaurusDialog host={synonyms} onClose={() => (setThesaurus(false), view.current?.focus())} />}
      {autoFix && <AutoCorrectDialog product="Nova Mail" plain initial={getAutoCorrectFor(lang)} onSave={setAutoCorrect} onClose={() => (setAutoFix(false), view.current?.focus())} />}
    </>
  );
}
