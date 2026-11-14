import { t, useCore } from '@suitenova/core-ui';
import { ARTISTIC, BG_STYLES, COLOR_SCHEMES, FONT_SCHEMES, clrCss, colorContext, chainFor } from '@suitenova/slides-core';
import type { SlidesUI } from './commands';
import { Gallery, useUi } from './ribbonParts';

/** Variants group of the Design tab: colour schemes, font pairs and background styles as galleries. */
export function ColorsGallery({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  const exec = useCore().registry.run.bind(useCore().registry);
  const theme = c.realDeck.themes[0];
  return (
    <Gallery label={t('Colores')} icon="palette" size="small">
      {(close) => (
        <div className="sl-themegrid" role="menu" aria-label={t('Combinaciones de colores')}>
          {COLOR_SCHEMES.map((s) => (
            <button key={s.id} type="button" role="menuitem" aria-label={t(s.name)} title={t(s.name)} onClick={() => (exec(`slides.design.colors.${s.id}`), close())}>
              <span className="sl-themegrid__sw">
                {(['dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const).map((k) => (
                  <i key={k} style={{ background: s.colors[k] }} />
                ))}
              </span>
              {t(s.name)}
            </button>
          ))}
          <span hidden>{theme?.id}</span>
        </div>
      )}
    </Gallery>
  );
}

export function FontsGallery({ ui }: { ui: SlidesUI }) {
  useUi(ui);
  const exec = useCore().registry.run.bind(useCore().registry);
  return (
    <Gallery label={t('Fuentes')} icon="type" size="small">
      {(close) => (
        <div className="sl-effects" role="menu" aria-label={t('Fuentes del tema')}>
          {FONT_SCHEMES.map((s) => (
            <button key={s.id} type="button" role="menuitem" onClick={() => (exec(`slides.design.fonts.${s.id}`), close())}>
              <span style={{ fontFamily: s.fonts.major.latin, fontWeight: 600 }}>{s.fonts.major.latin}</span> / <span style={{ fontFamily: s.fonts.minor.latin }}>{s.fonts.minor.latin}</span>
            </button>
          ))}
        </div>
      )}
    </Gallery>
  );
}

export function BgStylesGallery({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  const exec = useCore().registry.run.bind(useCore().registry);
  const slide = c.deck.slides[0];
  const cc = slide ? colorContext(chainFor(c.deck, slide)) : null;
  const css = (s: (typeof BG_STYLES)[number]): string => {
    const f = s.fill;
    const col = (x: NonNullable<Parameters<typeof clrCss>[0]>) => {
      const dark = s.dark;
      // the swatch is drawn with the style's own light or dark map, whatever the deck uses now
      const slot = x.scheme === 'bg1' ? (dark ? 'dk1' : 'lt1') : x.scheme === 'bg2' ? (dark ? 'dk2' : 'lt2') : x.scheme;
      return cc ? clrCss({ ...x, scheme: slot }, cc) : '#888';
    };
    if (f.t === 'solid') return col(f.c);
    if (f.t === 'grad') return `linear-gradient(180deg, ${f.stops.map((st) => col(st.c)).join(', ')})`;
    return '#fff';
  };
  return (
    <Gallery label={t('Estilos de fondo')} icon="paintbucket" size="small">
      {(close) => (
        <div className="sl-bggrid" role="menu" aria-label={t('Estilos de fondo')}>
          {BG_STYLES.map((s) => (
            <button key={s.id} type="button" role="menuitem" aria-label={`${t('Estilo')} ${s.id}`} title={`${t('Estilo')} ${s.id}`} style={{ background: css(s) }} onClick={() => (exec(`slides.design.bgstyle.${s.id}`), close())} />
          ))}
        </div>
      )}
    </Gallery>
  );
}

/** Artistic effects of the selected pictures. */
export function ArtisticMenu({ ui }: { ui: SlidesUI }) {
  useUi(ui);
  const exec = useCore().registry.run.bind(useCore().registry);
  return (
    <Gallery label={t('Efectos artísticos')} icon="sparkles" size="small" iconOnly>
      {(close) => (
        <div role="menu" aria-label={t('Efectos artísticos')} className="sl-menulist">
          {ARTISTIC.map((fx) => (
            <button key={fx.id} type="button" role="menuitem" onClick={() => (exec(`slides.pic.artistic.${fx.id}`), close())}>
              {t(fx.name)}
            </button>
          ))}
        </div>
      )}
    </Gallery>
  );
}
