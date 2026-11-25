import { t } from '@suitenova/core-ui';
import { GALLERY_TINTS, themeGallery, type ColorRef, type DocTheme } from '@suitenova/theme-core';
import './messages';
import './themes.css';

/** The ten standard colours of Office's colour menu (they do not follow the theme). */
export const STANDARD_COLORS = ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'];

const KIND: Record<string, keyof typeof GALLERY_TINTS> = { bg1: 'bg1', tx1: 'tx1', bg2: 'bg2', tx2: 'tx2' };

/** «Accent 1, Lighter 80%»: the name Office gives the colour of the gallery (for the screen reader and the tooltip). */
function nameOf(label: string, tint: number): string {
  if (!tint) return t(label);
  const pct = Math.round(Math.abs(tint) * 100);
  return `${t(label)}, ${t(tint > 0 ? 'más claro' : 'más oscuro')} ${pct} %`;
}

/**
 * The colours of a colour menu: the theme in columns (the colour and five variations, as Office), the ten standard ones and «more colours».
 * A colour of the theme is given with the reference to it, so that it follows the theme when this changes; a standard or free one is fixed.
 */
export function ThemeSwatches({ theme, label, onPick, extra }: { theme: DocTheme; label: string; onPick: (color: string, ref?: ColorRef) => void; extra?: React.ReactNode }) {
  const cols = themeGallery(theme);
  return (
    <div className="nv-theme-colors" role="group" aria-label={label}>
      <h4>{t('Colores del tema')}</h4>
      <div className="nv-theme-colors__grid">
        {cols.map((col) => {
          const kind = KIND[col.slot] ?? 'accent';
          const tints = [0, ...GALLERY_TINTS[kind]];
          return (
            <div key={col.slot} className="nv-theme-colors__col">
              {col.colors.map((c, i) => {
                const tint = tints[i]!;
                const ref: ColorRef = tint ? { slot: col.slot, tint } : { slot: col.slot };
                const name = nameOf(col.label, tint);
                return <button key={i} type="button" style={{ background: c }} aria-label={name} title={name} onClick={() => onPick(c, ref)} />;
              })}
            </div>
          );
        })}
      </div>
      <h4>{t('Colores estándar')}</h4>
      <div className="nv-theme-colors__std">
        {STANDARD_COLORS.map((c) => (
          <button key={c} type="button" style={{ background: c }} aria-label={c} title={c} onClick={() => onPick(c)} />
        ))}
      </div>
      {extra}
      <label className="nv-theme-colors__more">
        {t('Más colores')} <input type="color" defaultValue="#ffff00" aria-label={t('Más colores')} onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  );
}
