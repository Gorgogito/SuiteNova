import { t } from '@suitenova/core-ui';
import type { DynamicFilter } from '@suitenova/calc-engine';
import { ArrowDownAZ, ArrowUpAZ, FilterX, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CalcDoc } from './doc';

const MAX_LIST = 2000;

const DATE_FILTERS = {
  day: [['today', 'Hoy'], ['yesterday', 'Ayer'], ['tomorrow', 'Mañana']] as [string, string][],
  span: [
    ['thisWeek', 'Esta semana'], ['lastWeek', 'La semana pasada'], ['nextWeek', 'La próxima semana'],
    ['thisMonth', 'Este mes'], ['lastMonth', 'El mes pasado'], ['nextMonth', 'El próximo mes'],
    ['thisQuarter', 'Este trimestre'], ['lastQuarter', 'El trimestre pasado'], ['nextQuarter', 'El próximo trimestre'],
    ['thisYear', 'Este año'], ['lastYear', 'El año pasado'], ['nextYear', 'El próximo año'],
    ['yearToDate', 'Del año hasta hoy'],
  ] as [string, string][],
};

/** Excel-style drop-down of a filtered column: sort, clear, custom filter and a checklist of values. */
export function FilterMenu({ doc, col, x, y, onClose, onCustom }: { doc: CalcDoc; col: number; x: number; y: number; onClose: () => void; onCustom: () => void }) {
  const values = useMemo(() => doc.filterValues(col), [doc, col]);
  const current = doc.autoFilter?.columns[col];
  const [query, setQuery] = useState('');
  // values without a filter are all selected
  const [checked, setChecked] = useState<Set<string>>(() => new Set((current?.values ?? values.map((v) => v.key)).map((k) => k.toLowerCase())));
  const ref = useRef<HTMLDivElement>(null);
  const label = doc.filterHeaderLabel(col);
  const info = useMemo(() => doc.filterColumnInfo(col), [doc, col]);
  const [topOpen, setTopOpen] = useState(false);
  const [topKind, setTopKind] = useState<'top' | 'bottom'>('top');
  const [topN, setTopN] = useState(10);
  const [topPct, setTopPct] = useState(false);

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
      {info.kind !== 'text' && (
        <>
          <hr />
          {info.kind === 'number' && (
            <>
              <button type="button" className="calc-fmenu__item" onClick={() => setTopOpen(!topOpen)}>
                {t('Diez mejores…')}
              </button>
              {topOpen && (
                <div style={{ display: 'flex', gap: 6, padding: '4px 10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <select aria-label={t('Superiores o inferiores')} value={topKind} onChange={(e) => setTopKind(e.target.value as 'top' | 'bottom')}>
                    <option value="top">{t('Superiores')}</option>
                    <option value="bottom">{t('Inferiores')}</option>
                  </select>
                  <input type="number" min={1} style={{ width: 56 }} aria-label={t('Cantidad')} value={topN} onChange={(e) => setTopN(Math.max(1, Math.trunc(Number(e.target.value) || 1)))} />
                  <select aria-label={t('Elementos o porcentaje')} value={topPct ? 'pct' : 'items'} onChange={(e) => setTopPct(e.target.value === 'pct')}>
                    <option value="items">{t('Elementos')}</option>
                    <option value="pct">{t('Porcentaje')}</option>
                  </select>
                  <button type="button" className="is-primary" onClick={act(() => doc.setColumnFilter(col, { top: { n: topN, ...(topPct ? { percent: true } : {}), ...(topKind === 'bottom' ? { bottom: true } : {}) } }))}>
                    {t('Aceptar')}
                  </button>
                </div>
              )}
              <button type="button" className="calc-fmenu__item" onClick={act(() => doc.setColumnFilter(col, { dynamic: 'aboveAverage' }))}>
                {t('Por encima del promedio')}
              </button>
              <button type="button" className="calc-fmenu__item" onClick={act(() => doc.setColumnFilter(col, { dynamic: 'belowAverage' }))}>
                {t('Por debajo del promedio')}
              </button>
            </>
          )}
          {info.kind === 'date' && (
            <div style={{ padding: '2px 10px' }}>
              <select
                aria-label={t('Filtros de fecha')}
                value=""
                style={{ width: '100%' }}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  const f: DynamicFilter = v.startsWith('Q') ? { quarter: Number(v.slice(1)) as 1 | 2 | 3 | 4 } : v.startsWith('M') ? { month: Number(v.slice(1)) } : (v as DynamicFilter);
                  doc.setColumnFilter(col, { dynamic: f });
                  onClose();
                  window.dispatchEvent(new Event('nova:focus-grid'));
                }}
              >
                <option value="">{t('Filtros de fecha…')}</option>
                <optgroup label={t('Día')}>
                  {DATE_FILTERS.day.map(([k, l]) => (
                    <option key={k} value={k}>
                      {t(l)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t('Semana, mes, trimestre y año')}>
                  {DATE_FILTERS.span.map(([k, l]) => (
                    <option key={k} value={k}>
                      {t(l)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t('Trimestre de cualquier año')}>
                  {[1, 2, 3, 4].map((q) => (
                    <option key={q} value={`Q${q}`}>{`${t('Trimestre')} ${q}`}</option>
                  ))}
                </optgroup>
                <optgroup label={t('Mes de cualquier año')}>
                  {Array.from({ length: 12 }, (_x, i) => (
                    <option key={i} value={`M${i + 1}`}>
                      {new Date(2000, i, 1).toLocaleString(doc.locale === 'es' ? 'es' : 'en', { month: 'long' })}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
          )}
        </>
      )}
      {(info.fills.length > 0 || info.fonts.length > 0) && (
        <>
          <hr />
          {(['cell', 'font'] as const).map((kind) => {
            const colors = kind === 'cell' ? info.fills : info.fonts;
            const blank = kind === 'cell' ? info.blankFill : info.blankFont;
            if (!colors.length) return null;
            const current = doc.autoFilter?.columns[col]?.color;
            return (
              <div key={kind} style={{ padding: '2px 10px' }}>
                <small>{kind === 'cell' ? t('Filtrar por color de relleno') : t('Filtrar por color de fuente')}</small>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                  {colors.map((c) => (
                    <button
                      key={c}
                      type="button"
                      title={c}
                      aria-label={`${kind === 'cell' ? t('Relleno') : t('Fuente')} ${c}`}
                      aria-pressed={current?.kind === kind && current.color?.toLowerCase() === c}
                      onClick={act(() => doc.setColumnFilter(col, { color: { kind, color: c } }))}
                      style={{ width: 20, height: 20, border: current?.kind === kind && current.color?.toLowerCase() === c ? '2px solid var(--colorBrandForeground1)' : '1px solid var(--colorNeutralStroke1)', background: c, cursor: 'pointer' }}
                    />
                  ))}
                  {blank && (
                    <button type="button" className="calc-fmenu__item" style={{ width: 'auto', padding: '0 6px' }} onClick={act(() => doc.setColumnFilter(col, { color: { kind, color: null } }))}>
                      {kind === 'cell' ? t('Sin relleno') : t('Automático')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}
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
