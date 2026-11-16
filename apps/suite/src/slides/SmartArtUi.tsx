import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { COLORS_CATALOG, LAYOUT_CATALOG, STYLE_CATALOG, kid, local, newSmartArt, serializeXml, type DrawnShape, type El } from '@suitenova/smartart-core';
import { shapeSvg } from '@suitenova/shapes-core';
import { changeSmartArt, diagramArea, isLiveSmartArt, newSmartArtGroup, setSmartArtText, smartArtIds, smartArtText, updateSlide, type GroupEl, type SlideElement } from '@suitenova/slides-core';
import { useMemo, useState } from 'react';
import type { SlidesUI } from './commands';
import { Modal } from './Dialogs';

/*
 * SmartArt de Nova Slides: vista previa del dibujo (las formas del motor en un SVG con los acentos de Office) y el cuadro de insertar y
 * editar con galería de diseños, panel de texto, estilo y colores.
 */

const ACCENTS: Record<string, string> = { accent1: '#4472c4', accent2: '#ed7d31', accent3: '#a5a5a5', accent4: '#ffc000', accent5: '#5b9bd5', accent6: '#70ad47', lt1: '#ffffff', dk1: '#000000', tx1: '#000000', bg1: '#ffffff', lt2: '#e7e6e6', dk2: '#44546a' };

const mix = (hex: string, to: number, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - k) + to * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

/** Un color de DrawingML (`a:schemeClr`/`a:srgbClr` con `tint`, `shade`, `alpha`) como color css y opacidad. */
function colorOf(c: El | undefined): { color: string; alpha: number } | null {
  const e = c?.kids[0];
  if (!e) return null;
  let hex = e.name.endsWith('srgbClr') ? `#${e.attrs.val}` : (ACCENTS[e.attrs.val ?? ''] ?? '#808080');
  let alpha = 1;
  for (const m of e.kids) {
    const v = Number(m.attrs.val ?? 0) / 100000;
    const n = local(m.name);
    if (n === 'tint') hex = mix(hex, 255, 1 - v);
    else if (n === 'shade') hex = mix(hex, 0, 1 - v);
    else if (n === 'alpha') alpha = v;
  }
  return { color: hex, alpha };
}

const lineFrom = (s: DrawnShape): { color: string; width: number } | null => {
  const ln = s.spPr.find((x) => local(x.name) === 'ln');
  if (!ln || kid(ln, 'noFill')) return null;
  const c = colorOf(kid(ln, 'solidFill'));
  return c ? { color: c.color, width: Math.max(0.5, Number(ln.attrs.w ?? 12700) / 12700) } : null;
};
const fillFrom = (s: DrawnShape): { color: string; alpha: number } | null => {
  const f = s.spPr.find((x) => local(x.name) === 'solidFill');
  return f ? colorOf(f) : null;
};

/** El camino de una geometría propia (conector) como puntos. */
function customPath(g: El): string {
  const path = kid(kid(g, 'pathLst'), 'path');
  if (!path) return '';
  let d = '';
  for (const k of path.kids) {
    const pt = kid(k, 'pt');
    if (!pt) continue;
    d += `${local(k.name) === 'moveTo' ? 'M' : 'L'}${Number(pt.attrs.x) / 12700} ${Number(pt.attrs.y) / 12700}`;
  }
  return d;
}

const paras = (s: DrawnShape): string[] => {
  const out: string[] = [];
  const walk = (e: El) => {
    if (local(e.name) === 'p') {
      const text = serializeXml(e)
        .replace(/<a:t>([^<]*)<\/a:t>/g, '\u0001$1\u0002')
        .match(/\u0001[^\u0002]*\u0002/g)
        ?.map((x) => x.slice(1, -1))
        .join('');
      if (text) out.push(text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
    } else e.kids.forEach(walk);
  };
  if (s.txBody) walk(s.txBody);
  return out;
};

/** Dibujo de un SmartArt en pequeño: las formas con su relleno, línea y texto. `w` y `h` son los puntos del dibujo. */
export function SmartArtPreview({ shapes, w, h, width = 260, text = true }: { shapes: DrawnShape[]; w: number; h: number; width?: number; text?: boolean }) {
  const k = width / w;
  return (
    <svg width={width} height={h * k} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={t('Vista previa del SmartArt')} style={{ background: '#fff', border: '1px solid var(--colorNeutralStroke2)', borderRadius: 4 }}>
      {shapes.map((s, i) => {
        const x = s.x / 12700;
        const y = s.y / 12700;
        const sw = s.w / 12700;
        const sh = s.h / 12700;
        const rot = s.rot / 60000;
        const f = fillFrom(s);
        const ln = lineFrom(s);
        const tr = `translate(${x} ${y})${rot ? ` rotate(${rot} ${sw / 2} ${sh / 2})` : ''}`;
        if (s.custGeom) return <path key={i} d={customPath(s.custGeom)} transform={tr} fill="none" stroke={ln?.color ?? '#4472c4'} strokeWidth={ln?.width ?? 1} />;
        const lines = text ? paras(s) : [];
        const size = Math.max(6, Math.min(sh / (lines.length + 1.2), sw / Math.max(3, ...lines.map((l) => l.length)) * 1.8, 30));
        return (
          <g key={i} transform={tr}>
            <g dangerouslySetInnerHTML={{ __html: shapeSvg(s.prst ?? 'rect', sw, sh, { fill: f ? f.color : null, stroke: ln?.color ?? null, strokeWidth: ln?.width ?? 0, adj: s.adj }).replace(/<(path|rect|ellipse|polygon)/g, f && f.alpha < 1 ? `<$1 fill-opacity="${f.alpha}"` : '<$1') }} />
            {lines.length > 0 && (
              <text x={sw / 2} y={sh / 2 - ((lines.length - 1) * size * 0.6) / 1} textAnchor="middle" fontSize={size} fontFamily="Calibri, Carlito, sans-serif" fill={f && f.color !== '#ffffff' && ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'].includes(f.color) && f.alpha === 1 ? '#fff' : '#222'}>
                {lines.map((l, j) => (
                  <tspan key={j} x={sw / 2} dy={j === 0 ? size * 0.35 : size * 1.2}>
                    {l}
                  </tspan>
                ))}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

const sampleOf = (id: string) => LAYOUT_CATALOG.find((l) => l.id === id)?.sample ?? 'Uno\nDos\nTres';

type Props = { ui: SlidesUI; onClose: () => void; arg?: unknown };

/** Insertar un SmartArt nuevo o editar el elegido (`arg = { edit: true }`): diseño, texto, estilo y colores con vista previa. */
export function SmartArtDialog({ ui, onClose, arg }: Props) {
  const c = ui.ctl;
  const editing = (arg as { edit?: boolean } | undefined)?.edit === true;
  const target = editing && c.selected.length === 1 && isLiveSmartArt(c.selected[0]!) ? (c.selected[0] as GroupEl) : null;
  const ids = target ? smartArtIds(target) : null;
  const [layout, setLayout] = useState(ids?.layout ?? LAYOUT_CATALOG[2]!.id);
  const [style, setStyle] = useState(ids?.style ?? STYLE_CATALOG[0]!.id);
  const [colors, setColors] = useState(ids?.colors ?? COLORS_CATALOG[0]!.id);
  const [text, setText] = useState(target ? smartArtText(target) : sampleOf(LAYOUT_CATALOG[2]!.id));
  const [touched, setTouched] = useState(!!target);
  const area = diagramArea(c.deck.size);
  const frame = target?.xfrm ?? { x: area.x, y: area.y, w: area.w, h: area.h };
  const prev = useMemo(() => {
    try {
      const w = 480;
      const h = Math.max(120, Math.round((w * frame.h) / frame.w));
      const sa = newSmartArt({ layout, text, style, colors, width: w, height: h });
      return { shapes: sa.drawing ?? [], w, h, error: false };
    } catch {
      return { shapes: [], w: 480, h: 285, error: true };
    }
  }, [layout, text, style, colors, frame.w, frame.h]);
  const thumbs = useMemo(
    () =>
      LAYOUT_CATALOG.map((l) => {
        try {
          return { l, shapes: newSmartArt({ layout: l.id, text: l.sample, width: 160, height: 100 }).drawing ?? [] };
        } catch {
          return { l, shapes: [] as DrawnShape[] };
        }
      }),
    [],
  );
  const pick = (id: string) => {
    setLayout(id);
    // el texto de ejemplo del diseño anterior se cambia por el del nuevo mientras no se haya escrito nada propio
    if (!touched) setText(sampleOf(id));
  };
  const apply = () => {
    if (target) {
      let g: GroupEl | null = text !== smartArtText(target) ? setSmartArtText(target, text) : target;
      g = g && changeSmartArt(g, { layout: layout !== ids?.layout ? layout : undefined, style: style !== ids?.style ? style : undefined, colors: colors !== ids?.colors ? colors : undefined });
      if (!g) {
        onClose();
        return;
      }
      const next = g;
      c.apply('Editar SmartArt', (d) => updateSlide(d, c.slide.id, (s) => ({ ...s, shapes: s.shapes.map((e): SlideElement => (e.id === target.id ? next : e)) })), { selection: [target.id] });
    } else {
      c.addElement(newSmartArtGroup({ layout, text, style, colors }, frame), { select: true });
    }
    onClose();
  };
  const nodes = text.split('\n').filter((x) => x.trim()).length;
  return (
    <Modal
      title={editing ? t('Editar SmartArt') : t('Insertar SmartArt')}
      onClose={onClose}
      wide
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!nodes || (editing && !target)} onClick={apply}>
            {editing ? t('Aceptar') : t('Insertar')}
          </Button>
        </>
      }
    >
      <div className="sl-form" style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 14 }}>
        <div>
          <div className="sl-layouts sl-sa-gallery" role="radiogroup" aria-label={t('Diseño del SmartArt')}>
            {thumbs.map(({ l, shapes }) => (
              <label key={l.id} className={layout === l.id ? 'is-on' : ''} title={t(l.description)} data-sa-layout={l.id}>
                <input type="radio" name="sa-layout" checked={layout === l.id} onChange={() => pick(l.id)} />
                <SmartArtPreview shapes={shapes} w={160} h={100} width={120} text={false} />
                <b>{t(l.name)}</b>
              </label>
            ))}
          </div>
          <label className="sl-field" style={{ marginTop: 8 }}>
            <span>{t('Texto (uno por línea; un tabulador o dos espacios para cada subnivel)')}</span>
            <textarea
              rows={7}
              aria-label={t('Texto del SmartArt')}
              value={text}
              onChange={(e) => {
                setTouched(true);
                setText(e.target.value);
              }}
              onKeyDown={(e) => {
                // el tabulador sangra en lugar de saltar de campo
                if (e.key === 'Tab') {
                  e.preventDefault();
                  const el = e.currentTarget;
                  const a = el.selectionStart;
                  const v = el.value;
                  const ls = v.lastIndexOf('\n', a - 1) + 1;
                  setTouched(true);
                  setText(v.slice(0, ls) + '\t' + v.slice(ls));
                  requestAnimationFrame(() => el.setSelectionRange(a + 1, a + 1));
                }
              }}
            />
          </label>
        </div>
        <div>
          <SmartArtPreview shapes={prev.shapes} w={prev.w} h={prev.h} width={280} />
          {prev.error && <p className="sl-note">{t('Este diseño no puede dibujar ese texto.')}</p>}
          <label className="sl-field" style={{ marginTop: 8 }}>
            <span>{t('Colores')}</span>
            <select aria-label={t('Colores del SmartArt')} value={colors} onChange={(e) => setColors(e.target.value)}>
              {COLORS_CATALOG.map((x) => (
                <option key={x.id} value={x.id}>
                  {t(x.name)}
                </option>
              ))}
            </select>
          </label>
          <label className="sl-field">
            <span>{t('Estilo')}</span>
            <select aria-label={t('Estilo del SmartArt')} value={style} onChange={(e) => setStyle(e.target.value)}>
              {STYLE_CATALOG.map((x) => (
                <option key={x.id} value={x.id}>
                  {t(x.name)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <p className="sl-note">{t('Cada SmartArt guarda su lista y su diseño: se puede editar el texto, cambiar de diseño, de colores y de estilo, y vuelve a distribuirse solo.')}</p>
    </Modal>
  );
}
