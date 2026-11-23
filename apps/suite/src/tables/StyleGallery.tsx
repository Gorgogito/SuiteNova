import { Popover, PopoverSurface, PopoverTrigger } from '@fluentui/react-components';
import { Icon, t } from '@suitenova/core-ui';
import { DEFAULT_OPTIONS, STYLE_FAMILIES, styleById, styleCatalog, type StyleOptions } from '@suitenova/table-core';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { TableHost } from './host';
import './messages';
import { StyleThumb } from './StyleThumb';
import './tables.css';

const OPTIONS: [keyof StyleOptions, string][] = [
  ['firstRow', 'Fila de encabezado'],
  ['lastRow', 'Fila de totales'],
  ['firstCol', 'Primera columna'],
  ['lastCol', 'Última columna'],
  ['bandRows', 'Filas con bandas'],
  ['bandCols', 'Columnas con bandas'],
];

/** The gallery of table styles (every family in the six accent colours) with the style options, like Office's Table Design. */
export function StyleGallery({ host, label = 'Estilos de tabla' }: { host: TableHost; label?: string }) {
  host.useRefresh();
  const [open, setOpen] = useState(false);
  const info = host.info();
  const options = info?.options ?? DEFAULT_OPTIONS;
  const current = styleById(info?.styleId ?? undefined);
  return (
    <Popover open={open} onOpenChange={(_e, d) => setOpen(d.open)} positioning="below-start">
      <PopoverTrigger disableButtonEnhancement>
        <button type="button" className="nv-btn nv-tbl-trigger" disabled={!info} title={t(label)} aria-label={t(label)}>
          <StyleThumb style={current} options={options} width={44} height={30} />
          <span className="nv-tbl-trigger__label">
            {t(label)} <ChevronDown size={11} />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverSurface>
        <div className="nv-tbl-gallery" role="group" aria-label={t(label)}>
          {styleCatalog().map((fam) => (
            <section key={fam.family} aria-label={t(STYLE_FAMILIES.find((f) => f.id === fam.family)!.name)}>
              <h4>{t(fam.name)}</h4>
              <div className="nv-tbl-gallery__row">
                {fam.styles.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="nv-tbl-thumb"
                    aria-pressed={info?.styleId === s.id}
                    title={s.accent ? `${t(fam.name)} – ${t('Énfasis')} ${s.accent}` : t(fam.name)}
                    aria-label={s.accent ? `${t(fam.name)} – ${t('Énfasis')} ${s.accent}` : t(fam.name)}
                    onClick={() => {
                      host.setStyle(s.id);
                      setOpen(false);
                    }}
                  >
                    <StyleThumb style={s} options={options} />
                  </button>
                ))}
              </div>
            </section>
          ))}
          <div className="nv-tbl-options" role="group" aria-label={t('Opciones de estilo de tabla')}>
            <h4>{t('Opciones de estilo de tabla')}</h4>
            {OPTIONS.map(([k, name]) => (
              <label key={k}>
                <input type="checkbox" checked={options[k]} onChange={(e) => host.setOption(k, e.target.checked)} /> {t(name)}
              </label>
            ))}
          </div>
          <button
            type="button"
            className="nv-btn nv-btn--small"
            onClick={() => {
              host.setStyle(null);
              setOpen(false);
            }}
          >
            <Icon name="eraser" /> {t('Borrar estilo')}
          </button>
        </div>
      </PopoverSurface>
    </Popover>
  );
}
