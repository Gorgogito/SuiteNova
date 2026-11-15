import { Popover, PopoverSurface, PopoverTrigger } from '@fluentui/react-components';
import { Icon, t } from '@suitenova/core-ui';
import { SHAPE_CATEGORIES, shapeLabel, shapeSvg } from '@suitenova/shapes-core';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import './shapes.css';

/** A small drawing of a shape, for the gallery buttons. */
export function ShapePreview({ kind, size = 26 }: { kind: string; size?: number }) {
  const inner = size - 6;
  return (
    <svg width={size} height={size} viewBox={`-3 -3 ${size} ${size}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: shapeSvg(kind, inner, inner, { fill: '#4472c4', stroke: '#2f528f', strokeWidth: 1.2 }) }} />
  );
}

/**
 * The shape gallery every product uses: the same categories and the same shapes. `onPick` receives the shape kind; `categories` (by id)
 * limits what is offered (for example no lines when the product has its own line tool).
 */
export function ShapeGallery({ label = 'Formas', icon = 'shapes', size = 'large', iconOnly, categories, onPick }: { label?: string; icon?: string; size?: 'large' | 'small'; iconOnly?: boolean; categories?: string[]; onPick: (kind: string) => void }) {
  const [open, setOpen] = useState(false);
  const shown = SHAPE_CATEGORIES.filter((c) => !categories || categories.includes(c.id));
  return (
    <Popover open={open} onOpenChange={(_e, d) => setOpen(d.open)} positioning="below-start">
      <PopoverTrigger disableButtonEnhancement>
        <button type="button" className={`nv-btn nv-btn--${size}`} aria-haspopup="dialog" aria-label={t(label)} title={t(label)}>
          <Icon name={icon} />
          <span className="nv-btn__label">
            {!iconOnly && t(label)} <ChevronDown size={11} />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverSurface>
        <div className="ss-gallery" role="menu" aria-label={t('Formas')}>
          {shown.map((c) => (
            <div key={c.id}>
              <div className="ss-title">{t(c.title)}</div>
              <div className="ss-grid">
                {c.shapes.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="menuitem"
                    title={t(shapeLabel(s))}
                    aria-label={t(shapeLabel(s))}
                    data-shape={s}
                    onClick={() => {
                      setOpen(false);
                      onPick(s);
                    }}
                  >
                    <ShapePreview kind={s} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverSurface>
    </Popover>
  );
}
