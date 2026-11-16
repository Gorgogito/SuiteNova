import { t } from '@suitenova/core-ui';
import { COLORS_CATALOG, LAYOUT_CATALOG, STYLE_CATALOG, drawingSvg, newSmartArt, type DrawnShape } from '@suitenova/smartart-core';
import { useMemo } from 'react';
import './smartart.css';

/*
 * Interfaz compartida del SmartArt (Slides, Writer y Calc): vista previa del dibujo y el formulario con galería de diseños, texto con
 * subniveles, colores y estilo. Cada producto lo pone dentro de su propio cuadro de diálogo.
 */

export interface SmartArtValue {
  layout: string;
  style: string;
  colors: string;
  /** Un nodo por línea; un tabulador por nivel. */
  text: string;
  /** ¿Lo escribió el usuario? Mientras no, cambiar de diseño cambia también el texto de ejemplo. */
  touched: boolean;
}

export const sampleOf = (layoutId: string): string => LAYOUT_CATALOG.find((l) => l.id === layoutId)?.sample ?? 'Uno\nDos\nTres';

/** Valor inicial para insertar un SmartArt nuevo. */
export const newSmartArtValue = (): SmartArtValue => ({ layout: LAYOUT_CATALOG[2]!.id, style: STYLE_CATALOG[0]!.id, colors: COLORS_CATALOG[0]!.id, text: sampleOf(LAYOUT_CATALOG[2]!.id), touched: false });

/** El dibujo de un SmartArt en un `<img>` SVG; `shapes` y su tamaño en puntos. */
export function SmartArtPreview({ shapes, w, h, width = 260, text = true }: { shapes: DrawnShape[]; w: number; h: number; width?: number; text?: boolean }) {
  const src = useMemo(() => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(drawingSvg(shapes, w, h, { text, width, height: (h * width) / w })), [shapes, w, h, text, width]);
  return <img src={src} width={width} height={(h * width) / w} alt={t('Vista previa del SmartArt')} style={{ background: '#fff', border: '1px solid var(--colorNeutralStroke2)', borderRadius: 4, display: 'block' }} />;
}

/** El dibujo que da un valor en un marco de `width` x `height` puntos; `null` si el diseño no puede con ese texto. */
function drawingOf(v: SmartArtValue, width: number, height: number): DrawnShape[] | null {
  try {
    return newSmartArt({ layout: v.layout, text: v.text, style: v.style, colors: v.colors, width, height }).drawing ?? [];
  } catch {
    return null;
  }
}

const thumbs = (): { l: (typeof LAYOUT_CATALOG)[number]; shapes: DrawnShape[] }[] =>
  LAYOUT_CATALOG.map((l) => ({ l, shapes: (() => { try { return newSmartArt({ layout: l.id, text: l.sample, width: 160, height: 100 }).drawing ?? []; } catch { return []; } })() }));

let thumbCache: ReturnType<typeof thumbs> | null = null;

/** Galería de diseños, texto, colores y estilo con vista previa. `aspect` es alto / ancho del marco donde va a quedar. */
export function SmartArtForm({ value, onChange, aspect, locked = false }: { value: SmartArtValue; onChange: (v: SmartArtValue) => void; aspect: number; locked?: boolean }) {
  const gallery = (thumbCache ??= thumbs());
  const pw = 480;
  const ph = Math.max(120, Math.round(pw * aspect));
  const prev = useMemo(() => drawingOf(value, pw, ph), [value.layout, value.text, value.style, value.colors, ph]);
  const set = (p: Partial<SmartArtValue>) => onChange({ ...value, ...p });
  const nodes = value.text.split('\n').filter((x) => x.trim()).length;
  return (
    <div className="sa-form">
      <div>
        <div className="sa-gallery" role="radiogroup" aria-label={t('Diseño del SmartArt')}>
          {gallery.map(({ l, shapes }) => (
            <label key={l.id} className={value.layout === l.id ? 'is-on' : ''} title={t(l.description)} data-sa-layout={l.id}>
              <input type="radio" name="sa-layout" checked={value.layout === l.id} onChange={() => set({ layout: l.id, text: value.touched ? value.text : sampleOf(l.id) })} />
              <SmartArtPreview shapes={shapes} w={160} h={100} width={120} text={false} />
              <b>{t(l.name)}</b>
            </label>
          ))}
        </div>
        <label className="sa-field">
          <span>{t('Texto (uno por línea; un tabulador para cada subnivel)')}</span>
          <textarea
            rows={7}
            aria-label={t('Texto del SmartArt')}
            value={value.text}
            onChange={(e) => set({ text: e.target.value, touched: true })}
            onKeyDown={(e) => {
              // el tabulador sangra la línea en lugar de saltar de campo
              if (e.key !== 'Tab') return;
              e.preventDefault();
              const el = e.currentTarget;
              const a = el.selectionStart;
              const v = el.value;
              const ls = v.lastIndexOf('\n', a - 1) + 1;
              set({ text: v.slice(0, ls) + '\t' + v.slice(ls), touched: true });
              requestAnimationFrame(() => el.setSelectionRange(a + 1, a + 1));
            }}
          />
        </label>
        {!nodes && <p className="sa-note">{t('Escribe al menos un elemento.')}</p>}
      </div>
      <div>
        {prev ? <SmartArtPreview shapes={prev} w={pw} h={ph} width={280} /> : <p className="sa-note">{t('Este diseño no puede dibujar ese texto.')}</p>}
        <label className="sa-field">
          <span>{t('Colores')}</span>
          <select aria-label={t('Colores del SmartArt')} value={value.colors} disabled={locked} onChange={(e) => set({ colors: e.target.value })}>
            {COLORS_CATALOG.map((x) => (
              <option key={x.id} value={x.id}>
                {t(x.name)}
              </option>
            ))}
          </select>
        </label>
        <label className="sa-field">
          <span>{t('Estilo')}</span>
          <select aria-label={t('Estilo del SmartArt')} value={value.style} disabled={locked} onChange={(e) => set({ style: e.target.value })}>
            {STYLE_CATALOG.map((x) => (
              <option key={x.id} value={x.id}>
                {t(x.name)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
