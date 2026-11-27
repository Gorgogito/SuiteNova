import { Check, ChevronRight } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type MenuItem = { label: string; run?: () => void; disabled?: boolean; checked?: boolean; hint?: string; sub?: MenuItem[]; /** A square of this colour before the label. */ color?: string } | 'separator';

export interface MenuAt {
  x: number;
  y: number;
  label: string;
  items: MenuItem[];
}

function List({ x, y, flipX, label, items, onDone, onBack }: { x: number; y: number; flipX?: number; label: string; items: MenuItem[]; onDone: () => void; onBack?: () => void }) {
  const ref = useRef<HTMLUListElement>(null);
  const [at, setAt] = useState({ x, y });
  const [sub, setSub] = useState<{ i: number; x: number; y: number; flipX: number } | null>(null);

  // kept inside the window
  useLayoutEffect(() => {
    const el = ref.current!;
    const { width, height } = el.getBoundingClientRect();
    const left = x + width > window.innerWidth - 4 ? Math.max(4, (flipX ?? x) - width) : x;
    setAt({ x: left, y: Math.max(4, Math.min(y, window.innerHeight - height - 4)) });
  }, [x, y, flipX]);

  const buttons = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>(':scope > li > button:not(:disabled)') ?? [])];
  useEffect(() => buttons()[0]?.focus(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const openSub = (i: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setSub({ i, x: r.right - 2, y: r.top - 5, flipX: r.left + 2 });
  };

  return (
    <ul
      ref={ref}
      className="ml-menu"
      role="menu"
      aria-label={label}
      style={{ left: at.x, top: at.y }}
      onKeyDown={(e) => {
        e.stopPropagation();
        const list = buttons();
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === 'ArrowDown') list[(i + 1) % list.length]?.focus();
        else if (e.key === 'ArrowUp') list[(i - 1 + list.length) % list.length]?.focus();
        else if (e.key === 'Home') list[0]?.focus();
        else if (e.key === 'End') list[list.length - 1]?.focus();
        else if (e.key === 'Escape' || (e.key === 'ArrowLeft' && onBack)) (onBack ?? onDone)();
        else if (e.key === 'Tab') onDone();
        else if (e.key === 'ArrowRight') (document.activeElement as HTMLElement).getAttribute('aria-haspopup') && (document.activeElement as HTMLButtonElement).click();
        else return;
        e.preventDefault();
      }}
    >
      {items.map((it, i) =>
        it === 'separator' ? (
          <li key={i} role="separator" />
        ) : (
          <li key={i} role="none">
            <button
              type="button"
              role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={it.checked}
              aria-haspopup={it.sub ? 'menu' : undefined}
              aria-expanded={it.sub ? sub?.i === i : undefined}
              disabled={it.disabled}
              onMouseEnter={(e) => {
                e.currentTarget.focus();
                if (it.sub && !it.disabled) openSub(i, e.currentTarget);
                else setSub(null);
              }}
              onClick={(e) => {
                if (it.sub) return openSub(i, e.currentTarget);
                onDone();
                it.run?.();
              }}
            >
              <span className="ml-menu__check">{it.checked && <Check size={13} aria-hidden="true" />}</span>
              {it.color && <span className="ml-swatch" style={{ background: it.color }} aria-hidden="true" />}
              <span className="ml-menu__label">{it.label}</span>
              {it.hint && <span className="ml-menu__hint">{it.hint}</span>}
              {it.sub && <ChevronRight size={13} aria-hidden="true" />}
            </button>
            {it.sub && sub?.i === i && (
              <List
                x={sub.x}
                y={sub.y}
                flipX={sub.flipX}
                label={it.label}
                items={it.sub}
                onDone={onDone}
                onBack={() => {
                  const owner = buttons().find((b) => b.getAttribute('aria-expanded') === 'true');
                  setSub(null);
                  owner?.focus();
                }}
              />
            )}
          </li>
        ),
      )}
    </ul>
  );
}

/** A menu opened with the secondary button (or its key) where the pointer is. */
export function ContextMenu({ menu, onClose }: { menu: MenuAt; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // the focus goes back to where it was
  const [before] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => {
    const outside = (e: Event) => !box.current?.contains(e.target as Node) && close.current();
    const gone = () => close.current();
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('wheel', outside, true);
    window.addEventListener('blur', gone);
    window.addEventListener('resize', gone);
    return () => {
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('wheel', outside, true);
      window.removeEventListener('blur', gone);
      window.removeEventListener('resize', gone);
    };
  }, []);
  return (
    <div ref={box} onContextMenu={(e) => e.preventDefault()}>
      <List
        x={menu.x}
        y={menu.y}
        label={menu.label}
        items={menu.items}
        onDone={() => {
          onClose();
          before?.focus?.();
        }}
      />
    </div>
  );
}
