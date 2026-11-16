import { Checkbox, Input, Popover, PopoverSurface, PopoverTrigger, Select } from '@fluentui/react-components';
import { Icon, t } from '@suitenova/core-ui';
import { WORDART_STYLES, warpName, warpNames, type FxFill, type WordArtFx } from '@suitenova/wordart-core';
import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useState, type CSSProperties } from 'react';
import { renderWordArt } from './engine';
import './wordart.css';

/** El estilo de texto y la transformación de un WordArt, como los guardan los productos (`warp` null = sin transformar). */
export interface WordArtValue {
  fx: WordArtFx;
  warp: { prst: string; adj?: Record<string, number> } | null;
}

/** Una muestra («Abc») con un estilo y una transformación. Con la fuente del sistema se dibuja con el motor; si no, con texto SVG simple. */
export function WordArtPreview({ fx, prst, text = 'Abc', width = 64, height = 36 }: { fx: WordArtFx; prst?: string | null; text?: string; width?: number; height?: number }) {
  const uid = `wp${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [svg, setSvg] = useState<string | null>(null);
  const key = JSON.stringify([fx, prst, text, width, height]);
  useEffect(() => {
    let live = true;
    void renderWordArt({ text, family: 'Calibri', bold: true, italic: false, sizePx: height * 0.8, align: 'center', fx, warp: prst ? { prst } : null, width, height, id: uid }).then((s) => live && setSvg(s));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const f = fx.fill;
  const fill = f.type === 'solid' ? f.color : f.type === 'gradient' ? f.stops[Math.floor(f.stops.length / 2)]?.color ?? '#000' : 'none';
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ overflow: 'visible' }}>
      {svg ? (
        <g dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <text x={width / 2} y={height * 0.72} textAnchor="middle" fontSize={height * 0.8} fontWeight={700} fontFamily="Calibri, Carlito, sans-serif" fill={fill} stroke={fx.outline?.color} strokeWidth={fx.outline ? 1 : 0}>
          {text}
        </text>
      )}
    </svg>
  );
}

/** El botón que abre una galería. Es un elemento y no un componente: `PopoverTrigger` le pone sus propiedades directamente. */
function galleryButton({ label, icon, size, iconOnly }: { label: string; icon: string; size: 'large' | 'small'; iconOnly?: boolean }) {
  return (
    <button type="button" className={`nv-btn nv-btn--${size}`} aria-haspopup="dialog" aria-label={t(label)} title={t(label)}>
      <Icon name={icon} />
      <span className="nv-btn__label">
        {!iconOnly && t(label)} <ChevronDown size={11} />
      </span>
    </button>
  );
}

/** Galería de estilos de WordArt: `onPick` recibe el identificador del estilo. */
export function WordArtStyleGallery({ label = 'WordArt', icon = 'wordart', size = 'large', iconOnly, onPick }: { label?: string; icon?: string; size?: 'large' | 'small'; iconOnly?: boolean; onPick: (styleId: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={(_e, d) => setOpen(d.open)} positioning="below-start">
      <PopoverTrigger disableButtonEnhancement>
        {galleryButton({ label, icon, size, iconOnly })}
      </PopoverTrigger>
      <PopoverSurface>
        <div className="wa-gallery" role="menu" aria-label={t('Estilos de WordArt')}>
          <div className="wa-title">{t('Estilos de WordArt')}</div>
          <div className="wa-grid">
            {WORDART_STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="menuitem"
                title={t(s.name)}
                aria-label={t(s.name)}
                data-wordart-style={s.id}
                onClick={() => {
                  setOpen(false);
                  onPick(s.id);
                }}
              >
                <WordArtPreview fx={s.fx} />
              </button>
            ))}
          </div>
        </div>
      </PopoverSurface>
    </Popover>
  );
}

/** Galería «Transformar»: las 40 transformaciones de Office y «Sin transformación»; `onPick` recibe `null` para quitarla. */
export function WarpGallery({ label = 'Transformar', icon = 'wordart', size = 'large', iconOnly, current, onPick }: { label?: string; icon?: string; size?: 'large' | 'small'; iconOnly?: boolean; current?: string | null; onPick: (prst: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const sample: WordArtFx = { fill: { type: 'solid', color: '#4472c4' } };
  return (
    <Popover open={open} onOpenChange={(_e, d) => setOpen(d.open)} positioning="below-start">
      <PopoverTrigger disableButtonEnhancement>
        {galleryButton({ label, icon, size, iconOnly })}
      </PopoverTrigger>
      <PopoverSurface>
        <div className="wa-gallery" role="menu" aria-label={t('Transformar')}>
          <button type="button" role="menuitem" className="wa-none" data-warp="none" aria-pressed={!current} onClick={() => { setOpen(false); onPick(null); }}>
            {t('Sin transformación')}
          </button>
          <div className="wa-grid wa-grid--warp">
            {warpNames().map((n) => (
              <button
                key={n}
                type="button"
                role="menuitem"
                title={t(warpName(n))}
                aria-label={t(warpName(n))}
                aria-pressed={current === n}
                data-warp={n}
                onClick={() => {
                  setOpen(false);
                  onPick(n);
                }}
              >
                <WordArtPreview fx={sample} prst={n} width={72} height={44} />
              </button>
            ))}
          </div>
        </div>
      </PopoverSurface>
    </Popover>
  );
}

const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 };

/** Formulario del estilo y la transformación de un WordArt (controlado). Cada producto lo mete en su propio cuadro de diálogo. */
export function WordArtForm({ value, onChange }: { value: WordArtValue; onChange: (v: WordArtValue) => void }) {
  const { fx, warp } = value;
  const set = (patch: Partial<WordArtFx>) => onChange({ ...value, fx: { ...fx, ...patch } });
  const fillType = fx.fill.type;
  const c1 = fx.fill.type === 'solid' ? fx.fill.color : fx.fill.type === 'gradient' ? fx.fill.stops[0]!.color : '#4472c4';
  const c2 = fx.fill.type === 'gradient' ? fx.fill.stops[fx.fill.stops.length - 1]!.color : '#2f5597';
  const angle = fx.fill.type === 'gradient' ? fx.fill.angle : 90;
  const setFill = (type: FxFill['type'], a = c1, b = c2, ang = angle) =>
    set({ fill: type === 'none' ? { type: 'none' } : type === 'solid' ? { type: 'solid', color: a } : { type: 'gradient', angle: ang, stops: [{ pos: 0, color: a }, { pos: 1, color: b }] } });
  const num = (v: string, d: number) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : d);
  return (
    <div>
      <div style={row}>
        <label htmlFor="wa-fill">{t('Relleno del texto')}</label>
        <Select id="wa-fill" value={fillType} onChange={(_e, d) => setFill(d.value as FxFill['type'])}>
          <option value="none">{t('Sin relleno')}</option>
          <option value="solid">{t('Color liso')}</option>
          <option value="gradient">{t('Degradado')}</option>
        </Select>
        {fillType !== 'none' && <input type="color" aria-label={t('Color del relleno')} value={c1} onChange={(e) => setFill(fillType, e.target.value, c2, angle)} />}
        {fillType === 'gradient' && (
          <>
            <input type="color" aria-label={t('Segundo color del degradado')} value={c2} onChange={(e) => setFill('gradient', c1, e.target.value, angle)} />
            <Input type="number" aria-label={t('Ángulo del degradado')} style={{ width: 80 }} value={String(angle)} onChange={(_e, d) => setFill('gradient', c1, c2, num(d.value, 90))} />
          </>
        )}
      </div>
      <div style={row}>
        <Checkbox label={t('Contorno del texto')} checked={!!fx.outline} onChange={(_e, d) => set({ outline: d.checked ? { color: '#203864', width: 1.5 } : undefined })} />
        {fx.outline && (
          <>
            <input type="color" aria-label={t('Color del contorno del texto')} value={fx.outline.color} onChange={(e) => set({ outline: { ...fx.outline!, color: e.target.value } })} />
            <Input type="number" aria-label={t('Grosor del contorno del texto')} style={{ width: 80 }} min={0.25} step={0.25} value={String(fx.outline.width)} onChange={(_e, d) => set({ outline: { ...fx.outline!, width: Math.max(0.25, num(d.value, 1)) } })} />
          </>
        )}
      </div>
      <div style={row}>
        <Checkbox label={t('Sombra')} checked={!!fx.shadow} onChange={(_e, d) => set({ shadow: d.checked ? { color: '#000000', alpha: 0.45, blur: 4, dx: 2.1, dy: 2.1 } : undefined })} />
        {fx.shadow && (
          <>
            <input type="color" aria-label={t('Color de la sombra')} value={fx.shadow.color} onChange={(e) => set({ shadow: { ...fx.shadow!, color: e.target.value } })} />
            <Input type="number" aria-label={t('Desenfoque de la sombra')} style={{ width: 80 }} min={0} value={String(fx.shadow.blur)} onChange={(_e, d) => set({ shadow: { ...fx.shadow!, blur: Math.max(0, num(d.value, 4)) } })} />
          </>
        )}
      </div>
      <div style={row}>
        <Checkbox label={t('Resplandor')} checked={!!fx.glow} onChange={(_e, d) => set({ glow: d.checked ? { color: '#4472c4', alpha: 0.6, radius: 9 } : undefined })} />
        {fx.glow && (
          <>
            <input type="color" aria-label={t('Color del resplandor')} value={fx.glow.color} onChange={(e) => set({ glow: { ...fx.glow!, color: e.target.value } })} />
            <Input type="number" aria-label={t('Radio del resplandor')} style={{ width: 80 }} min={1} value={String(fx.glow.radius)} onChange={(_e, d) => set({ glow: { ...fx.glow!, radius: Math.max(1, num(d.value, 9)) } })} />
          </>
        )}
      </div>
      <div style={row}>
        <Checkbox label={t('Reflejo')} checked={!!fx.reflection} onChange={(_e, d) => set({ reflection: d.checked ? { alpha: 0.5, size: 0.35, gap: 0 } : undefined })} />
      </div>
      <div style={row}>
        <label htmlFor="wa-warp">{t('Transformar')}</label>
        <Select id="wa-warp" value={warp?.prst ?? ''} onChange={(_e, d) => onChange({ ...value, warp: d.value ? { prst: d.value } : null })}>
          <option value="">{t('Sin transformación')}</option>
          {warpNames().map((n) => (
            <option key={n} value={n}>
              {t(warpName(n))}
            </option>
          ))}
        </Select>
      </div>
      <div style={{ marginTop: 8 }}>
        <WordArtPreview fx={fx} prst={warp?.prst ?? null} text={t('Vista previa')} width={300} height={90} />
      </div>
    </div>
  );
}
