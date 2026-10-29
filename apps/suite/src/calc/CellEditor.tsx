import { ES_FUNCTIONS, functionRegistry } from '@suitenova/calc-engine';
import { t } from '@suitenova/core-ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { canPointAt } from './GridView';
import type { CalcDoc, EditState } from './doc';
import { ENTRY_PENDING } from './doc-objects';
import { FONT_STACK } from './render';

interface Props {
  doc: CalcDoc;
  edit: EditState;
  rect: { x: number; y: number; w: number; h: number };
  zoom: number;
  dark: boolean;
  maxW: number;
  maxH: number;
}

/** Functions whose (localised) name starts with `prefix`, for autocomplete. */
export function suggestFunctions(prefix: string, locale: 'es' | 'en', limit = 8): string[] {
  const p = prefix.toUpperCase();
  if (!p) return [];
  const names = [...functionRegistry.keys()].filter((n) => !n.includes('.') || true);
  const loc = names.map((n) => (locale === 'es' ? (ES_FUNCTIONS[n] ?? n) : n));
  const uniq = [...new Set(loc)].filter((n) => n.toUpperCase().startsWith(p) && n.toUpperCase() !== p);
  return uniq.sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, limit);
}

/** The identifier being typed right before the caret in a formula, if any. */
export function wordAtCaret(text: string, caret: number): { word: string; start: number } | null {
  if (!text.startsWith('=')) return null;
  const m = /([A-Za-zÀ-￿][\w.À-￿]*)$/.exec(text.slice(0, caret));
  if (!m) return null;
  // not a cell reference like A1 or a sheet name followed by "!"
  if (/^[A-Za-z]{1,3}\d+$/.test(m[1]!)) return null;
  const before = text[caret - m[1]!.length - 1];
  if (before === '!' || before === "'") return null;
  return { word: m[1]!, start: caret - m[1]!.length };
}

export function CellEditor({ doc, edit, rect, zoom, dark, maxW, maxH }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [active, setActive] = useState(0);
  const style = doc.wb.getStyle(edit.sheetId, edit.row, edit.col);
  const fontSize = (style.fontSize ?? 11) * (96 / 72) * zoom;

  // focus when the editor opens in the cell (not when the formula bar drives it)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || edit.fromBar) return;
    el.focus({ preventScroll: true });
    const end = edit.caret ?? el.value.length;
    el.setSelectionRange(end, end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep the caret where the formula bar / point mode put it
  useEffect(() => {
    const el = ref.current;
    if (!el || edit.caret === undefined || document.activeElement !== el) return;
    if (el.selectionStart !== edit.caret) el.setSelectionRange(edit.caret, edit.caret);
  }, [edit.text, edit.caret]);

  const caret = edit.caret ?? edit.text.length;
  const word = useMemo(() => wordAtCaret(edit.text, caret), [edit.text, caret]);
  const suggestions = useMemo(() => (word ? suggestFunctions(word.word, doc.locale) : []), [word, doc]);
  useEffect(() => setActive(0), [word?.word]);

  const accept = (name: string) => {
    if (!word) return;
    const next = edit.text.slice(0, word.start) + name + '(' + edit.text.slice(caret);
    doc.setEditText(next, word.start + name.length + 1);
  };

  // width grows with the content
  const lines = edit.text.split('\n');
  const approx = Math.max(...lines.map((l) => l.length)) * fontSize * 0.55 + 12;
  const width = Math.min(maxW, Math.max(rect.w, approx));
  const height = Math.min(maxH, Math.max(rect.h, lines.length * fontSize * 1.25 + 6));

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // the grid also listens for keys on this subtree; it must not see keys the editor already used
    e.stopPropagation();
    const el = e.currentTarget;
    const mod = e.ctrlKey || e.metaKey;
    if (suggestions.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setActive((a) => (e.key === 'ArrowDown' ? Math.min(a + 1, suggestions.length - 1) : Math.max(a - 1, 0)));
      return;
    }
    if (suggestions.length && e.key === 'Tab') {
      e.preventDefault();
      accept(suggestions[active]!);
      return;
    }
    const finish = (move: 'down' | 'up' | 'right' | 'left' | 'none') => {
      e.preventDefault();
      const err = doc.commitEdit(move);
      if (err && err !== ENTRY_PENDING) window.alert(err);
      else window.dispatchEvent(new Event('nova:focus-grid'));
    };
    switch (e.key) {
      case 'Enter':
        if (e.altKey) {
          e.preventDefault();
          const s = el.selectionStart;
          doc.setEditText(edit.text.slice(0, s) + '\n' + edit.text.slice(el.selectionEnd), s + 1);
        } else if (mod) finish('none');
        else finish(e.shiftKey ? 'up' : 'down');
        break;
      case 'Tab':
        finish(e.shiftKey ? 'left' : 'right');
        break;
      case 'Escape':
        e.preventDefault();
        doc.cancelEdit();
        window.dispatchEvent(new Event('nova:focus-grid'));
        break;
      case 'F2':
        e.preventDefault();
        doc.setEditMode(edit.mode === 'edit' ? 'enter' : 'edit');
        break;
      case 'ArrowDown':
      case 'ArrowUp':
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (edit.mode !== 'enter' || e.altKey) break;
        // while a reference may be inserted, arrows just move the caret
        if (canPointAt(edit.text, el.selectionStart)) break;
        finish(e.key === 'ArrowDown' ? 'down' : e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowRight' ? 'right' : 'left');
        break;
      }
    }
  };

  return (
    <>
      <textarea
        ref={ref}
        className="calc-editor"
        value={edit.text}
        spellCheck={false}
        autoComplete="off"
        rows={1}
        onChange={(e) => doc.setEditText(e.target.value, e.target.selectionStart)}
        onSelect={(e) => {
          // use the live edit state: a stale closure here would resurrect an edit that was just cancelled
          const s = e.currentTarget.selectionStart;
          if (doc.edit && s !== doc.edit.caret) doc.edit = { ...doc.edit, caret: s };
        }}
        onKeyDown={onKeyDown}
        style={{
          left: rect.x,
          top: rect.y,
          width,
          height,
          fontSize,
          fontFamily: `${style.fontName ? `'${style.fontName}', ` : ''}${FONT_STACK}`,
          fontWeight: style.bold ? 700 : 400,
          fontStyle: style.italic ? 'italic' : 'normal',
          textDecoration: [style.underline ? 'underline' : '', style.strike ? 'line-through' : ''].join(' ').trim() || 'none',
          color: dark ? '#e8e8e8' : '#000',
          background: dark ? '#1e1e1e' : '#fff',
          textAlign: style.hAlign === 'center' ? 'center' : style.hAlign === 'right' ? 'right' : 'left',
        }}
      />
      {suggestions.length > 0 && (
        <ul className="calc-suggest" style={{ left: rect.x, top: rect.y + height + 2 }} role="listbox" aria-label={t('calc.suggest')}>
          {suggestions.map((name, i) => (
            <li
              key={name}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                accept(name);
              }}
            >
              <span className="calc-suggest__fx">ƒx</span>
              {name}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
