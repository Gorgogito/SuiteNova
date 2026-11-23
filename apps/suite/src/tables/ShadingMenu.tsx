import { Popover, PopoverSurface, PopoverTrigger } from '@fluentui/react-components';
import { Icon, t } from '@suitenova/core-ui';
import { OFFICE_PALETTE, tint } from '@suitenova/table-core';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { NO_SHADING, type TableHost } from './host';
import './messages';
import './tables.css';

const GRAYS = ['#ffffff', '#f2f2f2', '#d9d9d9', '#a6a6a6', '#595959', '#000000'];
const STANDARD = ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'];

/** The colours of the theme: each accent and its lighter tints, in columns, like Office. */
const THEME: string[][] = [GRAYS, ...OFFICE_PALETTE.accents.map((a) => [tint(a, 0.2), tint(a, 0.4), tint(a, 0.6), a])];

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
          <h4>{t('Colores del tema')}</h4>
          <div className="nv-tbl-theme">
            {THEME.map((col, i) => (
              <div key={i} className="nv-tbl-theme__col">
                {col.map((c, k) => (
                  <button key={k} type="button" style={{ background: c }} aria-label={c} title={c} onClick={() => pick(c)} />
                ))}
              </div>
            ))}
          </div>
          <h4>{t('Colores estándar')}</h4>
          <div className="nv-tbl-std">
            {STANDARD.map((c) => (
              <button key={c} type="button" style={{ background: c }} aria-label={c} title={c} onClick={() => pick(c)} />
            ))}
          </div>
          <button type="button" className="nv-btn nv-btn--small nv-tbl-wide" onClick={() => pick(NO_SHADING)}>
            {t('Sin color')}
          </button>
          <button type="button" className="nv-btn nv-btn--small nv-tbl-wide" onClick={() => pick(null)}>
            {t('Restablecer el color del estilo')}
          </button>
          <label className="nv-tbl-custom">
            {t('Más colores…')} <input type="color" aria-label={t('Más colores…')} defaultValue="#ffff00" onChange={(e) => pick(e.target.value)} />
          </label>
        </div>
      </PopoverSurface>
    </Popover>
  );
}
