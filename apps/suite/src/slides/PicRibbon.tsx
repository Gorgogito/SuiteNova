import { t } from '@suitenova/core-ui';
import { CORRECTIONS, CROP_SHAPES, RECOLORS, recolorOf, withAdjust, type PicEl } from '@suitenova/slides-core';
import type { SlidesUI } from './commands';
import { Gallery, ShapePreview, useUi } from './ribbonParts';

const pics = (c: SlidesUI['ctl']) => c.selected.filter((e): e is PicEl => e.kind === 'pic');
const patchPics = (c: SlidesUI['ctl'], label: string, fn: (p: PicEl) => PicEl) =>
  c.patch(pics(c).map((p) => p.id), label, (e) => fn(e as PicEl));

/** Crop to a shape: the picture takes the outline of the chosen shape. */
export function PictureShapeGallery({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  return (
    <Gallery label={t('Forma de la imagen')} icon="shape-rect" size="small" wide>
      {(close) => (
        <div className="sl-shapegrid" role="menu" aria-label={t('Forma de la imagen')}>
          {CROP_SHAPES.map((s) => (
            <button key={s.prst} type="button" role="menuitem" title={t(s.name)} aria-label={t(s.name)} onClick={() => (patchPics(c, 'Forma de la imagen', (p) => ({ ...p, geom: { prst: s.prst } })), close())}>
              <ShapePreview prst={s.prst} />
            </button>
          ))}
        </div>
      )}
    </Gallery>
  );
}

export function RecolorMenu({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  const cur = recolorOf(pics(c)[0]?.adjust);
  return (
    <Gallery label={t('Recolorear')} icon="palette" size="small">
      {(close) => (
        <div role="menu" aria-label={t('Recolorear')} className="sl-menulist">
          {RECOLORS.map((r) => (
            <button key={r.id} type="button" role="menuitemradio" aria-checked={cur === r.id} onClick={() => (patchPics(c, 'Recolorear', (p) => ({ ...p, adjust: withAdjust(p.adjust, r.patch) })), close())}>
              {cur === r.id ? '✓ ' : ''}{t(r.name)}
            </button>
          ))}
        </div>
      )}
    </Gallery>
  );
}

export function CorrectionsMenu({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  return (
    <Gallery label={t('Correcciones')} icon="contrast" size="small">
      {(close) => (
        <div role="menu" aria-label={t('Correcciones')} className="sl-menulist">
          {CORRECTIONS.map((k) => (
            <button key={k.name} type="button" role="menuitem" onClick={() => (patchPics(c, 'Correcciones de imagen', (p) => ({ ...p, adjust: withAdjust(p.adjust, { bright: k.bright, contrast: k.contrast }) })), close())}>
              {t(k.name)}
            </button>
          ))}
          <button type="button" role="menuitem" onClick={() => (ui.openDialog('pictureCorrections'), close())}>{t('Opciones de corrección de imagen…')}</button>
        </div>
      )}
    </Gallery>
  );
}
