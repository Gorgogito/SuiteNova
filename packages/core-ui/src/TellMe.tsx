import { useState } from 'react';
import { useCore } from './context';
import { Icon } from './icons';
import { t } from './i18n';

/** "Tell me what you want to do": command search box (Alt+Q). */
export function TellMe() {
  const { registry } = useCore();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const results = registry.search(query);

  const run = (id: string) => {
    registry.run(id);
    setQuery('');
    setOpen(false);
  };

  return (
    <div className="nv-tellme">
      <Icon name="search" size={14} />
      <input
        id="nv-tellme"
        type="search"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="nv-tellme-list"
        aria-label={t('tellme.placeholder')}
        placeholder={t('tellme.placeholder')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            const r = results[active];
            if (r) run(r.id);
          } else if (e.key === 'Escape') {
            setQuery('');
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {open && query.trim() !== '' && (
        <ul className="nv-tellme__list" id="nv-tellme-list" role="listbox">
          {results.length === 0 && <li className="nv-tellme__empty">{t('tellme.none')}</li>}
          {results.map((r, i) => (
            <li
              key={r.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                run(r.id);
              }}
            >
              <Icon name={r.icon} />
              <span>{t(r.label)}</span>
              <kbd>{registry.shortcutLabel(r.id)}</kbd>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
