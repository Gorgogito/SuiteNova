import { t } from '@suitenova/core-ui';
import type { Effects, RunProps } from '@suitenova/slides-core';
import type { SlidesUI } from './commands';
import { ColorPicker, Gallery, REFLECTION_PRESET, SHADOW_PRESETS, useUi } from './ribbonParts';
import { applyRun } from './textcmds';

/** Text fill, outline and effects of the selected text (the "WordArt styles" of the Shape Format tab). */
export function TextFillPicker({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  return (
    <ColorPicker
      ui={ui}
      label={t('Relleno de texto')}
      icon="fontColor"
      allowNone={false}
      onPick={(clr) => applyRun(c, (r) => ({ ...r, color: clr ?? undefined, fx: r.fx ? { ...r.fx, fill: undefined } : undefined }), 'Relleno de texto')}
    />
  );
}

export function TextOutlinePicker({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  return (
    <ColorPicker
      ui={ui}
      label={t('Contorno de texto')}
      icon="textOutline"
      noneLabel={t('Sin contorno')}
      onPick={(clr) =>
        applyRun(
          c,
          (r) => {
            const fx = { ...r.fx };
            if (clr) fx.ln = { w: 1, fill: { t: 'solid', c: clr } };
            else delete fx.ln;
            return { ...r, fx } as RunProps;
          },
          'Contorno de texto',
        )
      }
    />
  );
}

export function TextEffectsMenu({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  const set = (fn: (e: Effects) => Effects) => applyRun(c, (r) => ({ ...r, fx: { ...r.fx, effects: fn(r.fx?.effects ?? {}) } }), 'Efectos de texto');
  return (
    <Gallery label={t('Efectos de texto')} icon="shadow" size="small" iconOnly>
      {(close) => (
        <div className="sl-effects" role="menu">
          <div className="sl-swatchtitle">{t('Sombra')}</div>
          {SHADOW_PRESETS.map((p) => (
            <button key={p.id} type="button" role="menuitem" onClick={() => (set((e) => ({ ...e, outer: p.fx.outer, inner: undefined })), close())}>
              {t(p.label)}
            </button>
          ))}
          <div className="sl-swatchtitle">{t('Reflejo')}</div>
          <button type="button" role="menuitem" onClick={() => (set((e) => ({ ...e, reflection: undefined })), close())}>
            {t('Sin reflejo')}
          </button>
          <button type="button" role="menuitem" onClick={() => (set((e) => ({ ...e, reflection: REFLECTION_PRESET })), close())}>
            {t('Reflejo: parte superior pegada')}
          </button>
          <div className="sl-swatchtitle">{t('Iluminado')}</div>
          <button type="button" role="menuitem" onClick={() => (set((e) => ({ ...e, glow: undefined })), close())}>
            {t('Sin iluminado')}
          </button>
          {[5, 10, 18].map((rad) => (
            <button key={rad} type="button" role="menuitem" onClick={() => (set((e) => ({ ...e, glow: { rad, c: { scheme: 'accent1', mods: [{ t: 'alpha', v: 60000 }] } } })), close())}>
              {t('Iluminado')} {rad} pt
            </button>
          ))}
        </div>
      )}
    </Gallery>
  );
}
