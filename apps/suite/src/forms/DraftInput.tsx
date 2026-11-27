import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';

/**
 * A box whose text counts when it is finished: on leaving it or pressing Enter (Escape gives it up). For texts that can
 * only be judged whole, such as the name of a choice, which cannot pass through the name of another while being typed.
 */
export function DraftInput({ value, onCommit, ...rest }: { value: string; onCommit: (text: string) => string | null } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [state, setState] = useState({ of: value, text: value, error: null as string | null });
  // a change made elsewhere (an undo, a new order) takes the place of what was being typed
  if (state.of !== value) setState({ of: value, text: value, error: null });
  const text = state.of === value ? state.text : value;
  const live = useRef({ text, value, onCommit });
  live.current = { text, value, onCommit };
  const commit = () => {
    if (live.current.text === live.current.value) return;
    const error = live.current.onCommit(live.current.text);
    // refused, it goes back to what it was; accepted, the new value arrives from outside
    live.current.text = live.current.value;
    setState({ of: value, text: value, error });
  };
  // a box that goes away with something typed keeps it
  useEffect(
    () => () => {
      if (live.current.text !== live.current.value) live.current.onCommit(live.current.text);
    },
    [],
  );
  return (
    <>
      <input
        {...rest}
        value={text}
        aria-invalid={state.error ? true : undefined}
        onChange={(e) => setState({ of: value, text: e.target.value, error: null })}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape' && text !== value) {
            e.preventDefault();
            e.stopPropagation();
            live.current.text = value;
            setState({ of: value, text: value, error: null });
          }
        }}
      />
      {state.error && (
        <span className="fm-err" role="alert">
          {state.error}
        </span>
      )}
    </>
  );
}

/** What is being typed in a box counts before the form is saved, exported or closed. */
export function finishTyping(): void {
  if (typeof document === 'undefined') return;
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.blur();
    el.focus();
  }
}
