import { t } from '@suitenova/core-ui';
import { ArrowDownAZ, ArrowUpAZ, FilterX, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CalcDoc } from './doc';

const MAX_LIST = 2000;

/** Excel-style drop-down of a filtered column: sort, clear, custom filter and a checklist of values. */
export function FilterMenu({ doc, col, x, y, onClose, onCustom }: { doc: CalcDoc; col: number; x: number; y: number; onClose: () => void; onCustom: () => void }) {
  const values = useMemo(() => doc.filterValues(col), [doc, col]);
  const current = doc.autoFilter?.columns[col];
  const [query, setQuery] = useState('');
  // values without a filter are all selected
  const [checked, setChecked] = useState<Set<string>>(() => new Set((current?.values ?? values.map((v) => v.key)).map((k) => k.toLowerCase())));
  const ref = useRef<HTMLDivElement>(null);
  const label = doc.filterHeaderLabel(col);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const visible = values.filter((v) => !query || (v.key || t('(Vacías)')).toLowerCase().includes(query.toLowerCase()));
  const allVisibleChecked = visible.length > 0 && visible.every((v) => checked.has(v.key.toLowerCase()));
  const toggleAll = () => {
    const next = new Set(checked);
    for (const v of visible) allVisibleChecked ? next.delete(v.key.toLowerCase()) : next.add(v.key.toLowerCase());
    setChecked(next);
  };
  const apply = () => {
    const everything = values.every((v) => checked.has(v.key.toLowerCase()));
    if (everything) doc.setColumnFilter(col, null);
    else doc.setColumnFilter(col, { values: values.filter((v) => checked.has(v.key.toLowerCase())).map((v) => v.key) });
    onClose();
    window.dispatchEvent(new Event('nova:focus-grid'));
  };

  const left = Math.min(x, window.innerWidth - 270);
  const top = Math.min(y, window.innerHeight - 420);
  const act = (fn: () => void) => () => {
    fn();
    onClose();
    window.dispatchEvent(new Event('nova:focus-grid'));
  };

  return (
    <div ref={ref} className="calc-fmenu" style={{ left, top }} role="dialog" aria-label={t('Filtro de la columna {name}', { name: label })} onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className="calc-fmenu__item" onClick={act(() => doc.sortByFilterColumn(col, true))}>
        <ArrowUpAZ size={16} /> {t('Ordenar de A a Z')}
      </button>
      <button type="button" className="calc-fmenu__item" onClick={act(() => doc.sortByFilterColumn(col, false))}>
        <ArrowDownAZ size={16} /> {t('Ordenar de Z a A')}
      </button>
      <hr />
      <button type="button" className="calc-fmenu__item" disabled={!current} onClick={act(() => doc.setColumnFilter(col, null))}>
        <FilterX size={16} /> {t('Borrar filtro de "{name}"', { name: label })}
      </button>
      <button type="button" className="calc-fmenu__item" onClick={() => {
        onClose();
        onCustom();
      }}>
        <SlidersHorizontal size={16} /> {t('Filtro personalizado…')}
      </button>
      <hr />
      <input className="calc-fmenu__search" autoFocus placeholder={t('Buscar')} aria-label={t('Buscar')} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} />
      <div className="calc-fmenu__list" role="group" aria-label={t('Valores')}>
        <label className="calc-fmenu__check">
          <input type="checkbox" checked={allVisibleChecked} onChange={toggleAll} /> {query ? t('(Seleccionar resultados)') : t('(Seleccionar todo)')}
        </label>
        {visible.slice(0, MAX_LIST).map((v) => (
          <label key={v.key.toLowerCase()} className="calc-fmenu__check">
            <input
              type="checkbox"
              checked={checked.has(v.key.toLowerCase())}
              onChange={(e) => {
                const next = new Set(checked);
                if (e.target.checked) next.add(v.key.toLowerCase());
                else next.delete(v.key.toLowerCase());
                setChecked(next);
              }}
            />
            <span>{v.key === '' ? t('(Vacías)') : v.key}</span>
            <small>{v.count}</small>
          </label>
        ))}
        {visible.length > MAX_LIST && <small className="calc-fmenu__more">{t('Hay más valores; usa la búsqueda.')}</small>}
      </div>
      <div className="calc-fmenu__actions">
        <button type="button" onClick={onClose}>
          {t('Cancelar')}
        </button>
        <button type="button" className="is-primary" onClick={apply}>
          {t('Aceptar')}
        </button>
      </div>
    </div>
  );
}
