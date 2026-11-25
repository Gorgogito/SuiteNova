import { Popover, PopoverSurface, PopoverTrigger } from '@fluentui/react-components';
import { Icon, t } from '@suitenova/core-ui';
import { officeTheme } from '@suitenova/theme-core';
import { ThemeSwatches } from '../themes';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { NO_SHADING, type TableHost } from './host';
import './messages';
import './tables.css';


/** «Shading»: a colour for the selected cells, no colour, or back to what the table style says. */
export function ShadingMenu({ host, iconOnly = true }: { host: TableHost; iconOnly?: boolean }) {
  host.useRefresh();
  const [open, setOpen] = useState(false);
  const disabled = !host.info();
  const pick = (c: string | null) => {
    host.setShading(c);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={(_e, d) => setOpen(d.open)} positioning="below-start">
      <PopoverTrigger disableButtonEnhancement>
        <button type="button" className="nv-btn nv-btn--small" disabled={disabled} title={t('Sombreado')} aria-label={t('Sombreado')}>
          <Icon name="fillColor" />
          {!iconOnly && <span>{t('Sombreado')}</span>}
          <ChevronDown size={12} />
        </button>
      </PopoverTrigger>
      <PopoverSurface>
        <div className="nv-tbl-pop" role="group" aria-label={t('Sombreado')}>
          <ThemeSwatches theme={host.theme?.() ?? officeTheme()} label={t('Sombreado')} onPick={(c) => pick(c)} extra={<>
            <button type="button" className="nv-btn nv-btn--small nv-tbl-wide" onClick={() => pick(NO_SHADING)}>
              {t('Sin color')}
            </button>
            <button type="button" className="nv-btn nv-btn--small nv-tbl-wide" onClick={() => pick(null)}>
              {t('Restablecer el color del estilo')}
            </button>
          </>} />
        </div>
      </PopoverSurface>
    </Popover>
  );
}
