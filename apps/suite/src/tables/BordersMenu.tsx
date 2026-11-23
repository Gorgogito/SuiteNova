import { Popover, PopoverSurface, PopoverTrigger } from '@fluentui/react-components';
import { Icon, t } from '@suitenova/core-ui';
import type { BorderMode } from '@suitenova/table-core';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { PEN_WIDTHS, setPen, usePen, type Pen, type TableHost } from './host';
import './messages';
import './tables.css';

const MODES: { mode: BorderMode; label: string; icon: string }[] = [
  { mode: 'all', label: 'Todos los bordes', icon: 'gridlines' },
  { mode: 'outer', label: 'Borde exterior', icon: 'square' },
  { mode: 'inner', label: 'Bordes interiores', icon: 'gridlines' },
  { mode: 'top', label: 'Borde superior', icon: 'alignTop' },
  { mode: 'bottom', label: 'Borde inferior', icon: 'alignBottom' },
  { mode: 'left', label: 'Borde izquierdo', icon: 'alignLeft' },
  { mode: 'right', label: 'Borde derecho', icon: 'alignRight' },
  { mode: 'insideH', label: 'Borde horizontal interior', icon: 'alignMiddle' },
  { mode: 'insideV', label: 'Borde vertical interior', icon: 'colRight' },
  { mode: 'none', label: 'Sin borde', icon: 'eraser' },
];

const LINE_STYLES: { id: Pen['style']; label: string }[] = [
  { id: 'single', label: 'Continua' },
  { id: 'dashed', label: 'Rayas' },
  { id: 'dotted', label: 'Puntos' },
  { id: 'double', label: 'Doble' },
];

/** «Borders»: the line (style, weight, colour) and where to draw it on the selected cells, like Word's Borders menu and pen. */
export function BordersMenu({ host, iconOnly = true }: { host: TableHost; iconOnly?: boolean }) {
  host.useRefresh();
  const pen = usePen();
  const [open, setOpen] = useState(false);
  const disabled = !host.info();
  return (
    <Popover open={open} onOpenChange={(_e, d) => setOpen(d.open)} positioning="below-start">
      <PopoverTrigger disableButtonEnhancement>
        <button type="button" className="nv-btn nv-btn--small" disabled={disabled} title={t('Bordes')} aria-label={t('Bordes')}>
          <Icon name="gridlines" />
          {!iconOnly && <span>{t('Bordes')}</span>}
          <ChevronDown size={12} />
        </button>
      </PopoverTrigger>
      <PopoverSurface>
        <div className="nv-tbl-pop" role="menu" aria-label={t('Bordes')}>
          <div className="nv-tbl-pen" role="group" aria-label={t('Estilo de línea')}>
            <label>
              {t('Estilo de línea')}
              <select value={pen.style} onChange={(e) => setPen({ style: e.target.value as Pen['style'] })}>
                {LINE_STYLES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {t(s.label)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Grosor de línea')}
              <select value={pen.width} onChange={(e) => setPen({ width: Number(e.target.value) })}>
                {PEN_WIDTHS.map((w) => (
                  <option key={w} value={w}>
                    {String(w).replace('.', ',')} pt
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Color de la línea')}
              <input type="color" value={pen.color} onChange={(e) => setPen({ color: e.target.value })} />
            </label>
          </div>
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              role="menuitem"
              className="nv-tbl-mode"
              onClick={() => {
                host.setBorders(m.mode, m.mode === 'none' ? null : { style: pen.style, width: pen.width, color: pen.color });
                setOpen(false);
              }}
            >
              <Icon name={m.icon} /> {t(m.label)}
            </button>
          ))}
        </div>
      </PopoverSurface>
    </Popover>
  );
}
