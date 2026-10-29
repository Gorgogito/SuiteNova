import { t } from '@suitenova/core-ui';
import { Plus } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CalcDoc } from './doc';

const TAB_COLORS = ['#c00000', '#ed7d31', '#ffc000', '#70ad47', '#00b0f0', '#4472c4', '#7030a0', '#7f7f7f'];

export function SheetTabs({ doc }: { doc: CalcDoc }) {
  useSyncExternalStore(doc.subscribe, doc.getVersion);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: number } | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [doc.activeSheetId]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  const sheets = doc.wb.sheets;
  return (
    <div className="calc-tabs" role="tablist" aria-label={t('Hojas')}>
      <div className="calc-tabs__list">
        {sheets.map((s, i) => {
          const active = s.id === doc.activeSheetId;
          return renaming === s.id ? (
            <input
              key={s.id}
              className="calc-tabs__rename"
              autoFocus
              defaultValue={s.name}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => {
                const err = doc.renameSheet(s.id, e.currentTarget.value);
                if (err) window.alert(err);
                setRenaming(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                else if (e.key === 'Escape') setRenaming(null);
              }}
            />
          ) : (
            <button
              key={s.id}
              ref={active ? activeRef : undefined}
              type="button"
              role="tab"
              aria-selected={active}
              className={`calc-tab ${active ? 'is-active' : ''} ${dragId === s.id ? 'is-dragging' : ''}`}
              style={s.tabColor ? { ['--tab-color' as string]: s.tabColor } : undefined}
              draggable
              onDragStart={() => setDragId(s.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragId !== null && dragId !== s.id) doc.moveSheet(dragId, i);
                setDragId(null);
              }}
              onDragEnd={() => setDragId(null)}
              onClick={() => doc.activateSheet(s.id)}
              onDoubleClick={() => setRenaming(s.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                doc.activateSheet(s.id);
                setMenu({ x: e.clientX, y: e.clientY, id: s.id });
              }}
            >
              {s.name}
            </button>
          );
        })}
      </div>
      <button type="button" className="calc-tabs__add" title={t('Hoja nueva')} aria-label={t('Hoja nueva')} onClick={() => doc.addSheet()}>
        <Plus size={16} />
      </button>
      {menu && (
        <ul className="calc-menu" style={{ left: menu.x, bottom: window.innerHeight - menu.y }} role="menu" onPointerDown={(e) => e.stopPropagation()}>
          <li role="menuitem" onClick={() => { doc.addSheet(); setMenu(null); }}>{t('Insertar hoja')}</li>
          <li role="menuitem" onClick={() => { setRenaming(menu.id); setMenu(null); }}>{t('Cambiar nombre')}</li>
          <li role="menuitem" onClick={() => { doc.duplicateSheet(menu.id); setMenu(null); }}>{t('Duplicar')}</li>
          <li role="menuitem" onClick={() => { doc.moveSheet(menu.id, sheets.findIndex((x) => x.id === menu.id) - 1); setMenu(null); }}>{t('Mover a la izquierda')}</li>
          <li role="menuitem" onClick={() => { doc.moveSheet(menu.id, sheets.findIndex((x) => x.id === menu.id) + 1); setMenu(null); }}>{t('Mover a la derecha')}</li>
          <li role="separator" />
          <li className="calc-menu__colors" role="group" aria-label={t('Color de pestaña')}>
            {TAB_COLORS.map((c) => (
              <button key={c} type="button" aria-label={c} style={{ background: c }} onClick={() => { doc.setTabColor(menu.id, c); setMenu(null); }} />
            ))}
            <button type="button" className="calc-menu__nocolor" aria-label={t('Sin color')} onClick={() => { doc.setTabColor(menu.id, undefined); setMenu(null); }}>×</button>
          </li>
          <li role="separator" />
          <li
            role="menuitem"
            aria-disabled={sheets.length <= 1}
            className={sheets.length <= 1 ? 'is-disabled' : ''}
            onClick={() => {
              if (sheets.length <= 1) return;
              if (window.confirm(t('¿Eliminar la hoja "{name}"? Esta acción no se puede deshacer.', { name: sheets.find((x) => x.id === menu.id)?.name ?? '' }))) doc.deleteSheet(menu.id);
              setMenu(null);
            }}
          >
            {t('Eliminar')}
          </li>
        </ul>
      )}
    </div>
  );
}
