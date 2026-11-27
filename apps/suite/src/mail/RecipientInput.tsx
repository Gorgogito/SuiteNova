import { t } from '@suitenova/core-ui';
import { formatAddress, splitRecipients, suggestRecipients, typedRecipient, type BookEntry } from '@suitenova/mail-core';
import { useId, useLayoutEffect, useRef, useState } from 'react';

/** To, Cc or Bcc: a box that suggests people as their name or address is typed. */
export function RecipientInput({ label, name, value, onChange, entries, autoFocus }: { label: string; name: string; value: string; onChange: (v: string) => void; entries: () => BookEntry[]; autoFocus?: boolean }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typed = open ? typedRecipient(value, caret) : null;
  const others = new Set(typed ? splitRecipients(`${value.slice(0, typed.from)},${value.slice(typed.to)}`).map((a) => a.email.toLowerCase()) : []);
  const found = typed?.query ? suggestRecipients(entries(), typed.query, others).filter((e) => e.email.toLowerCase() !== typed.query.toLowerCase()) : [];
  const shown = found.length > 0;
  const at = Math.min(active, found.length - 1);
  // where the cursor goes once the chosen recipient is in the box, before another key can be read
  const place = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (place.current === null) return;
    input.current?.setSelectionRange(place.current, place.current);
    place.current = null;
  });

  const pick = (e: BookEntry) => {
    if (!typed) return;
    const head = value.slice(0, typed.from);
    const chosen = `${head}${head && !head.endsWith(' ') ? ' ' : ''}${formatAddress({ name: e.name, email: e.email })}, `;
    const rest = value.slice(typed.to).replace(/^[,;]\s*/, '');
    place.current = chosen.length;
    onChange(chosen + rest);
    setOpen(false);
  };

  return (
    <div className="ml-recip">
      <label>
        <span>{label}</span>
        <input
          ref={input}
          role="combobox"
          aria-label={name}
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={shown ? id : undefined}
          aria-activedescendant={shown ? `${id}-${at}` : undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => {
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setActive(0);
            setOpen(true);
            onChange(e.target.value);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (!shown) return;
            if (e.key === 'ArrowDown') setActive((at + 1) % found.length);
            else if (e.key === 'ArrowUp') setActive((at + found.length - 1) % found.length);
            else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) pick(found[at]!);
            else if (e.key === 'Escape') setOpen(false);
            else return;
            // the key belongs to the list: it does not close the message nor send it
            e.preventDefault();
            e.stopPropagation();
          }}
        />
      </label>
      {shown && (
        <ul id={id} role="listbox" aria-label={t('Sugerencias de destinatarios')}>
          {found.map((e, i) => (
            // the box keeps the focus: the click is taken before it leaves
            <li key={e.email} id={`${id}-${i}`} role="option" aria-selected={i === at} onMouseDown={(ev) => (ev.preventDefault(), pick(e))} onMouseEnter={() => setActive(i)}>
              <strong>{e.name || e.email}</strong>
              {e.name && <span>{e.email}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
