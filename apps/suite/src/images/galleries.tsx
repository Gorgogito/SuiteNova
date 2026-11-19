import { t } from '@suitenova/core-ui';
import { ARTISTIC_EFFECTS, ASPECT_RATIOS, DEFAULT_LEVEL, PICTURE_STYLES, applyStyle, cropToAspect, type FrameEdits, type PictureStyle } from '@suitenova/image-core';
import type { CSSProperties } from 'react';
import type { PictureHost } from './host';
import './images.css';
import './messages';

/** A small drawing of what a style does (shape, border, shadow, glow, reflection) on a plain swatch. */
function swatchStyle(f: PictureStyle['frame']): CSSProperties {
  const s: CSSProperties = {};
  if (f.shape === 'roundRect') s.borderRadius = '22%';
  else if (f.shape === 'ellipse') s.borderRadius = '50%';
  if (f.border) s.border = `${Math.max(1, Math.min(5, f.border.width / 2))}px ${f.border.dash ? (f.border.dash === 'dot' ? 'dotted' : 'dashed') : 'solid'} ${f.border.color}`;
  const sh: string[] = [];
  if (f.fx?.shadow) sh.push(`${f.fx.shadow.dist / 2}px ${f.fx.shadow.dist / 2}px ${f.fx.shadow.blur / 2}px rgba(0,0,0,${f.fx.shadow.alpha})`);
  if (f.fx?.glow) sh.push(`0 0 ${f.fx.glow.radius / 2}px ${f.fx.glow.color}`);
  if (sh.length) s.boxShadow = sh.join(',');
  if (f.fx?.softEdge) s.filter = 'blur(1px)';
  if (f.fx?.reflection) (s as Record<string, unknown>).WebkitBoxReflect = 'below 0 linear-gradient(transparent 55%, rgba(0,0,0,.45))';
  return s;
}

/** The gallery of picture styles (the 13 of `image-core`): choosing one sets shape, border and effects of the selected pictures. */
export function PictureStyleItems({ host, close }: { host: PictureHost; close: () => void }) {
  const pick = (st: PictureStyle) => {
    host.setFrame(applyStyle(host.frame(), st), t('Estilo de imagen'));
    close();
  };
  return (
    <div role="menu" aria-label={t('Estilos de imagen')} className="nv-img__styles">
      {PICTURE_STYLES.map((st) => (
        <button key={st.id} type="button" role="menuitem" title={t(st.name)} aria-label={t(st.name)} onClick={() => pick(st)}>
          <span className="nv-img__swatch" style={swatchStyle(st.frame)} />
        </button>
      ))}
    </div>
  );
}

/** The list of artistic effects: choosing one applies it with the usual intensity (a dialog changes it); «Ninguno» takes it off. */
export function ArtisticItems({ host, close, onOptions }: { host: PictureHost; close: () => void; onOptions?: () => void }) {
  const cur = host.pixelEdits().artistic?.id;
  const apply = (id: string | null) => {
    const e = host.pixelEdits();
    void host.setPixelEdits({ ...e, artistic: id ? { id, level: DEFAULT_LEVEL } : undefined }, t('Efecto artístico'));
    close();
  };
  return (
    <div role="menu" aria-label={t('Efectos artísticos')} className="nv-img__menu">
      <button type="button" role="menuitemradio" aria-checked={!cur} onClick={() => apply(null)}>
        {!cur ? '✓ ' : ''}
        {t('Ninguno')}
      </button>
      {ARTISTIC_EFFECTS.map((fx) => (
        <button key={fx.id} type="button" role="menuitemradio" aria-checked={cur === fx.id} onClick={() => apply(fx.id)}>
          {cur === fx.id ? '✓ ' : ''}
          {t(fx.name)}
        </button>
      ))}
      {onOptions && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            close();
            onOptions();
          }}
        >
          {t('Opciones de efectos artísticos…')}
        </button>
      )}
    </div>
  );
}

/** «Relación de aspecto»: crops the picture to the largest rectangle of that proportion that fits what shows now, centred. */
export function AspectItems({ host, close }: { host: PictureHost; close: () => void }) {
  const pick = async (ratio: number) => {
    const n = await host.naturalSize();
    if (!n) return;
    const f: FrameEdits = host.frame();
    host.setFrame({ ...f, crop: cropToAspect(n.w, n.h, f.crop ?? { l: 0, t: 0, r: 0, b: 0 }, ratio) }, t('Relación de aspecto'));
    close();
  };
  return (
    <div role="menu" aria-label={t('Relación de aspecto')} className="nv-img__menu">
      {ASPECT_RATIOS.map((a) => (
        <button key={a.id} type="button" role="menuitem" onClick={() => void pick(a.w / a.h)}>
          {t(a.name)}
        </button>
      ))}
    </div>
  );
}

