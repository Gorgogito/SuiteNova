import { t, useCore } from '@suitenova/core-ui';
import { BG_STYLES, clrCss, colorContext, chainFor } from '@suitenova/slides-core';
import type { SlidesUI } from './commands';
import { Gallery, useUi } from './ribbonParts';
import { ArtisticItems } from '../images/galleries';
import { slidesPictureHost } from './pichost';

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

/** Artistic effects of the selected pictures (the shared list: it applies the effect on the original, with the usual intensity). */
export function ArtisticMenu({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  return (
    <Gallery label={t('Efectos artísticos')} icon="sparkles" size="small" iconOnly>
      {(close) => <ArtisticItems host={slidesPictureHost(c)} close={close} onOptions={() => ui.openDialog('pictureArtistic')} />}
    </Gallery>
  );
}
