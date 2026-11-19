import { t } from '@suitenova/core-ui';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import './macros.css';
import './messages';

export interface CodeEditorHandle {
  /** Puts the caret on a line (1-based) and scrolls it into view. */
  goTo(line: number): void;
}

const LINE_HEIGHT = 18;
const PAD = 6;

/**
 * The code box of the macro editor: a text area with line numbers, a margin where a click sets a breakpoint (F9 does it on the caret's line), the
 * lines with a syntax error marked, and the line a paused run is at highlighted.
 */
export function CodeEditor({
  code,
  onChange,
  label,
  disabled,
  readOnly,
  bad,
  breakpoints,
  onToggleBreakpoint,
  current,
  handle,
  fill,
}: {
  code: string;
  onChange: (code: string) => void;
  label: string;
  disabled?: boolean;
  readOnly?: boolean;
  bad?: Set<number>;
  breakpoints?: Set<number>;
  onToggleBreakpoint?: (line: number) => void;
  /** The line a paused run is at. */
  current?: number | null;
  handle?: Ref<CodeEditorHandle>;
  /** Fills the space it is given instead of a fixed height. */
  fill?: boolean;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const tabMoves = useRef(false);
  const [top, setTop] = useState(0);
  const lines = code.split('\n').length;

  const goTo = (line: number) => {
    const el = area.current;
    if (!el) return;
    const text = code.split('\n');
    let pos = 0;
    for (let i = 0; i < Math.min(line - 1, text.length); i++) pos += text[i]!.length + 1;
    el.focus();
    el.setSelectionRange(pos, pos + (text[line - 1]?.length ?? 0));
    el.scrollTop = Math.max(0, (line - 4) * LINE_HEIGHT);
    setTop(el.scrollTop);
  };
  useImperativeHandle(handle, () => ({ goTo }));

  // a paused run shows its line without taking the focus
  useEffect(() => {
    const el = area.current;
    if (!el || !current) return;
    const y = (current - 1) * LINE_HEIGHT;
    if (y < el.scrollTop || y > el.scrollTop + el.clientHeight - 2 * LINE_HEIGHT) {
      el.scrollTop = Math.max(0, y - 3 * LINE_HEIGHT);
      setTop(el.scrollTop);
    }
  }, [current]);

  const insert = (text: string, at: number, to: number, caret: number) => {
    onChange(code.slice(0, at) + text + code.slice(to));
    requestAnimationFrame(() => area.current?.setSelectionRange(caret, caret));
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (e.key === 'F9' && onToggleBreakpoint) {
      e.preventDefault();
      onToggleBreakpoint(code.slice(0, el.selectionStart).split('\n').length);
      return;
    }
    if (readOnly) return;
    // Esc followed by Tab leaves the box, so the keyboard is never trapped
    if (e.key === 'Escape') {
      tabMoves.current = true;
      return;
    }
    if (e.key === 'Tab' && !tabMoves.current && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      insert('    ', el.selectionStart, el.selectionEnd, el.selectionStart + 4);
      return;
    }
    tabMoves.current = false;
    if (e.key === 'Enter') {
      const s = el.selectionStart;
      const lineStart = code.lastIndexOf('\n', s - 1) + 1;
      const indent = /^[ \t]*/.exec(code.slice(lineStart, s))![0];
      if (indent) {
        e.preventDefault();
        insert('\n' + indent, s, el.selectionEnd, s + 1 + indent.length);
      }
    }
  };

  return (
    <div className="nv-mac__editor" style={fill ? { height: 'auto', flex: 1, minHeight: 200 } : undefined}>
      {current ? <div className="nv-mac__cur" aria-hidden="true" style={{ top: PAD + (current - 1) * LINE_HEIGHT - top }} /> : null}
      <div className="nv-mac__gutter" aria-hidden="true" style={{ transform: `translateY(${-top}px)` }}>
        {Array.from({ length: lines }, (_x, i) => {
          const n = i + 1;
          const cls = [bad?.has(n) ? 'is-bad' : '', breakpoints?.has(n) ? 'is-bp' : '', current === n ? 'is-cur' : ''].filter(Boolean).join(' ');
          return (
            <div key={n} className={cls} data-line={n} onClick={() => onToggleBreakpoint?.(n)}>
              {n}
            </div>
          );
        })}
      </div>
      <textarea
        ref={area}
        className="nv-mac__code"
        aria-label={label}
        spellCheck={false}
        wrap="off"
        disabled={disabled}
        readOnly={readOnly}
        value={code}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        onScroll={(e) => setTop(e.currentTarget.scrollTop)}
      />
      <span className="nv-mac__sr" role="status">
        {breakpoints?.size ? `${t('Puntos de interrupción en las líneas')}: ${[...breakpoints].sort((a, b) => a - b).join(', ')}` : ''}
      </span>
    </div>
  );
}
