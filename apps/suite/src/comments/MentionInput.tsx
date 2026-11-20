import { completeMention, mentionQuery, suggestMentions, type Author } from '@suitenova/comment-core';
import { t } from '@suitenova/core-ui';
import { useRef, useState, type KeyboardEvent } from 'react';
import './comments.css';

/**
 * A text box where `@` offers the people of the document. Ctrl+Enter sends (or Enter, in a one-line box), Escape cancels, and with the list
 * open the arrows choose, and Enter or Tab complete the name.
 */
export function MentionInput({
  value, onChange, people, onSubmit, onCancel, label, placeholder, rows = 3, autoFocus, singleLine,
}: {
  value: string;
  onChange: (v: string) => void;
  people: readonly Author[];
  onSubmit: () => void;
  onCancel?: () => void;
  label: string;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  /** Enter sends (a reply box); otherwise Enter is a new line and Ctrl+Enter sends. */
  singleLine?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [closed, setClosed] = useState(false);
  const q = mentionQuery(value, caret);
  const options = q && !closed ? suggestMentions(q.query, people) : [];
  const open = options.length > 0;

  const complete = (a: Author) => {
    const r = completeMention(value, caret, a);
    if (!r) return;
    onChange(r.text);
    setPick(0);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(r.caret, r.caret);
      setCaret(r.caret);
    });
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        complete(options[Math.min(pick, options.length - 1)]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setClosed(true);
        return;
      }
    }
    if (e.key === 'Enter' && (singleLine ? !e.shiftKey : e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSubmit();
    } else if (e.key === 'Escape' && onCancel) {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="nv-cm-mention">
      <textarea
        ref={ref}
        className="nv-cm-input"
        aria-label={label}
        placeholder={placeholder}
        rows={singleLine ? 1 : rows}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setClosed(false);
          setPick(0);
        }}
        onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
        onKeyDown={onKey}
      />
      {open && (
        <ul className="nv-cm-suggest" role="listbox" aria-label={t('Personas')}>
          {options.map((a, i) => (
            <li key={a.id} role="option" aria-selected={i === pick} className={i === pick ? 'is-on' : ''} onMouseDown={(e) => { e.preventDefault(); complete(a); }}>
              <span className="nv-cm-avatar" aria-hidden="true">{a.initials}</span> {a.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
