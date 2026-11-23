import { t } from '@suitenova/core-ui';
import { FILL_TRANSPARENCIES, GLOW_COLORS, GLOW_SIZES, GRAPHIC_COLORS, GRAPHIC_STYLES, OUTLINE_WEIGHTS, SHADOW_PRESETS, glowOf, type GraphicFx, type IconLook } from '@suitenova/icon-core';
import '../images/images.css';
import './messages-graphics';

/** What the graphics menus need from a product: the look of the selected icon (null when it is not an icon) and its effects. */
export interface GraphicsHost {
  /** The look of the selected icon, or null when the selection is a plain picture or nothing. */
  look(): Required<IconLook> | null;
  /** Paints the selected icon another way (what the patch leaves out stays), in one step of the product's history. */
  setLook(patch: IconLook, label: string): Promise<void>;
  /** The effects of the selected picture (icon or not). */
  fx(): GraphicFx | null;
  setFx(fx: GraphicFx | null, label: string): void;
  /** Applies a whole style: the look and the effects. */
  setStyle(look: IconLook, fx: GraphicFx | null, label: string): Promise<void>;
}

const mark = (on: boolean) => (on ? '✓ ' : '');

function Swatches({ value, onPick, none }: { value: string | null; onPick: (c: string) => void; none?: boolean }) {
  return (
    <div className="nv-gfx__swatches" role="group" aria-label={t('Colores')}>
      {GRAPHIC_COLORS.map((c) => (
        <button key={c.color} type="button" title={t(c.name)} aria-label={t(c.name)} aria-pressed={!none && value === c.color} className="nv-gfx__swatch" style={{ background: c.color }} onClick={() => onPick(c.color)} />
      ))}
    </div>
  );
}

function CustomColor({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  return (
    <label className="nv-gfx__custom">
      <span>{t('Más colores…')}</span>
      <input type="color" aria-label={t('Más colores…')} value={value} onChange={(e) => onPick(e.target.value)} />
    </label>
  );
}

/** «Relleno de gráfico»: color, sin relleno, transparencia. */
export function GraphicFillItems({ host, close }: { host: GraphicsHost; close: () => void }) {
  const look = host.look();
  if (!look) return null;
  const set = (patch: IconLook, keep = false) => {
    void host.setLook(patch, t('Relleno de gráfico'));
    if (!keep) close();
  };
  return (
    <div role="menu" aria-label={t('Relleno de gráfico')} className="nv-gfx">
      <Swatches value={look.fill} onPick={(c) => set({ fill: c })} />
      <CustomColor value={look.fill ?? '#000000'} onPick={(c) => set({ fill: c }, true)} />
      <button type="button" role="menuitemradio" aria-checked={look.fill === null} onClick={() => set({ fill: null })}>
        {mark(look.fill === null)}
        {t('Sin relleno')}
      </button>
      <div className="nv-gfx__title">{t('Transparencia')}</div>
      {FILL_TRANSPARENCIES.map((tr) => (
        <button key={tr} type="button" role="menuitemradio" aria-checked={Math.abs(1 - tr - look.opacity) < 0.01} onClick={() => set({ opacity: 1 - tr })}>
          {mark(Math.abs(1 - tr - look.opacity) < 0.01)}
          {Math.round(tr * 100)} %
        </button>
      ))}
    </div>
  );
}

/** «Contorno de gráfico»: color, sin contorno, grosor. */
export function GraphicOutlineItems({ host, close }: { host: GraphicsHost; close: () => void }) {
  const look = host.look();
  if (!look) return null;
  const cur = look.stroke;
  const set = (stroke: IconLook['stroke'], keep = false) => {
    void host.setLook({ stroke }, t('Contorno de gráfico'));
    if (!keep) close();
  };
  return (
    <div role="menu" aria-label={t('Contorno de gráfico')} className="nv-gfx">
      <Swatches value={cur?.color ?? null} none={!cur} onPick={(c) => set({ color: c, width: cur?.width ?? 1 })} />
      <CustomColor value={cur?.color ?? '#000000'} onPick={(c) => set({ color: c, width: cur?.width ?? 1 }, true)} />
      <button type="button" role="menuitemradio" aria-checked={!cur} onClick={() => set(null)}>
        {mark(!cur)}
        {t('Sin contorno')}
      </button>
      <div className="nv-gfx__title">{t('Grosor')}</div>
      {OUTLINE_WEIGHTS.map((w) => (
        <button key={w} type="button" role="menuitemradio" aria-checked={cur?.width === w} onClick={() => set({ color: cur?.color ?? '#000000', width: w })}>
          {mark(cur?.width === w)}
          {String(w).replace('.', ',')} pt
        </button>
      ))}
    </div>
  );
}

/** «Efectos de gráfico»: sombra y resplandor (también para una imagen que no es un icono). */
export function GraphicEffectsItems({ host, close }: { host: GraphicsHost; close: () => void }) {
  const fx = host.fx() ?? {};
  const set = (next: GraphicFx, label: string) => {
    host.setFx(next.shadow || next.glow ? next : null, label);
    close();
  };
  const sameShadow = (p: GraphicFx['shadow']) => !!fx.shadow && !!p && fx.shadow.angle === p.angle && fx.shadow.blur === p.blur && fx.shadow.dist === p.dist;
  const color = fx.glow?.color ?? GLOW_COLORS[0]!;
  return (
    <div role="menu" aria-label={t('Efectos de gráfico')} className="nv-gfx">
      <div className="nv-gfx__title">{t('Sombra')}</div>
      <button type="button" role="menuitemradio" aria-checked={!fx.shadow} onClick={() => set({ ...fx, shadow: undefined }, t('Sombra'))}>
        {mark(!fx.shadow)}
        {t('Sin sombra')}
      </button>
      {SHADOW_PRESETS.map((s) => (
        <button key={s.id} type="button" role="menuitemradio" aria-checked={sameShadow(s.shadow)} onClick={() => set({ ...fx, shadow: s.shadow }, t('Sombra'))}>
          {mark(sameShadow(s.shadow))}
          {t(s.name)}
        </button>
      ))}
      <div className="nv-gfx__title">{t('Resplandor')}</div>
      <button type="button" role="menuitemradio" aria-checked={!fx.glow} onClick={() => set({ ...fx, glow: undefined }, t('Resplandor'))}>
        {mark(!fx.glow)}
        {t('Sin resplandor')}
      </button>
      {GLOW_SIZES.map((r) => (
        <button key={r} type="button" role="menuitemradio" aria-checked={fx.glow?.radius === r} onClick={() => set({ ...fx, glow: glowOf(r, color) }, t('Resplandor'))}>
          {mark(fx.glow?.radius === r)}
          {t('{n} puntos', { n: r })}
        </button>
      ))}
      <div className="nv-gfx__swatches" role="group" aria-label={t('Color del resplandor')}>
        {GLOW_COLORS.map((c) => (
          <button key={c} type="button" aria-label={c} aria-pressed={fx.glow?.color === c} className="nv-gfx__swatch" style={{ background: c }} onClick={() => set({ ...fx, glow: glowOf(fx.glow?.radius ?? 10, c) }, t('Resplandor'))} />
        ))}
      </div>
    </div>
  );
}

const STAR = 'M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z';

/** «Estilos de gráfico»: the ready-made looks, each drawn with a small star. */
export function GraphicStyleItems({ host, close }: { host: GraphicsHost; close: () => void }) {
  if (!host.look()) return null;
  return (
    <div role="menu" aria-label={t('Estilos de gráfico')} className="nv-img__styles">
      {GRAPHIC_STYLES.map((s) => {
        const fill = s.look.fill ?? 'none';
        const stroke = s.look.stroke;
        const sh = s.fx?.shadow;
        const gl = s.fx?.glow;
        return (
          <button
            key={s.id}
            type="button"
            role="menuitem"
            title={t(s.name)}
            aria-label={t(s.name)}
            onClick={() => {
              void host.setStyle(s.look, s.fx ?? null, t('Estilo de gráfico'));
              close();
            }}
          >
            <svg viewBox="0 0 24 24" width="34" height="34" fill={fill} fillOpacity={s.look.opacity ?? 1} stroke={stroke?.color} strokeWidth={stroke?.width} strokeLinejoin="round" style={{ filter: [sh ? `drop-shadow(2px 2px 2px rgba(0,0,0,.45))` : '', gl ? `drop-shadow(0 0 4px ${gl.color})` : ''].filter(Boolean).join(' ') || undefined }} aria-hidden="true">
              <path d={STAR} />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
