import { Popover, PopoverSurface, PopoverTrigger } from '@fluentui/react-components';
import { Icon, t } from '@suitenova/core-ui';
import { ChevronDown } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import type { TableHost } from './host';
import './messages';
import './tables.css';

const COLS = 10;
const ROWS = 8;

/**
 * Insert › Table: a grid where the size is chosen by moving over it (or with the arrow keys), as in Word, PowerPoint and Outlook.
 * `onMore` opens the product's own «Insert Table…» dialog (for sizes beyond the grid).
 */
export function GridPicker({ host, onMore, size = 'large' }: { host: Pick<TableHost, 'insert'>; onMore: () => void; size?: 'large' | 'small' }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState({ r: 2, c: 4 });
  const pick = (r: number, c: number) => {
    host.insert(r, c);
    setOpen(false);
  };
  const key = (e: KeyboardEvent) => {
    const d = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key as string];
    if (d) {
      e.preventDefault();
      setSel((s) => ({ r: Math.max(1, Math.min(ROWS, s.r + d[0]!)), c: Math.max(1, Math.min(COLS, s.c + d[1]!)) }));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(sel.r, sel.c);
    }
  };
  return (
    <Popover open={open} onOpenChange={(_e, d) => setOpen(d.open)} positioning="below-start">
      <PopoverTrigger disableButtonEnhancement>
        <button type="button" className={`nv-btn nv-btn--${size}`} title={t('Insertar tabla')} aria-label={t('Insertar tabla')}>
          <Icon name="tableGrid" />
          <span>{t('Tabla')}</span>
          <ChevronDown size={12} />
        </button>
      </PopoverTrigger>
      <PopoverSurface>
        <div className="nv-tbl-pop">
          <div className="nv-tbl-size" aria-live="polite">
            {t('Tabla de {cols} × {rows}', { cols: sel.c, rows: sel.r })}
          </div>
          <div
            className="nv-tbl-grid"
            role="grid"
            tabIndex={0}
            aria-label={t('Insertar tabla')}
            aria-description={t('Elige cuántas columnas y filas. Flechas para cambiar el tamaño, Intro para insertar.')}
            onKeyDown={key}
            onMouseLeave={() => undefined}
          >
            {Array.from({ length: ROWS }, (_r, r) => (
              <div key={r} role="row" className="nv-tbl-grid__row">
                {Array.from({ length: COLS }, (_c, c) => (
                  <button key={c} type="button" tabIndex={-1} role="gridcell" aria-label={`${c + 1} × ${r + 1}`} data-on={r < sel.r && c < sel.c} onMouseEnter={() => setSel({ r: r + 1, c: c + 1 })} onClick={() => pick(r + 1, c + 1)} />
                ))}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="nv-btn nv-btn--small nv-tbl-wide"
            onClick={() => {
              setOpen(false);
              onMore();
            }}
          >
            {t('Insertar tabla…')}
          </button>
        </div>
      </PopoverSurface>
    </Popover>
  );
}
