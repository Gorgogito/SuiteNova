import { Popover, PopoverSurface, PopoverTrigger } from '@fluentui/react-components';
import { Icon, t } from '@suitenova/core-ui';
import { clrCss, geometryOf, presetNames, type Clr, type Effects, type Fill, type Ln, type RunProps, type SlideElement } from '@suitenova/slides-core';
import { ChevronDown } from 'lucide-react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { FONT_NAMES, FONT_SIZES, type SlidesUI } from './commands';
import { applyRun } from './textcmds';

export const PALETTE = [
  ['#000000', '#7f7f7f', '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'],
  ['#ffffff', '#d9d9d9', '#f4cccc', '#fce5cd', '#fff2cc', '#ffffcc', '#d9ead3', '#d0e0e3', '#cfe2f3', '#c9daf8', '#d9d2e9', '#ead1dc'],
];
const THEME_SLOTS: { slot: Clr['scheme']; label: string }[] = [
  { slot: 'bg1', label: 'Fondo 1' },
  { slot: 'tx1', label: 'Texto 1' },
  { slot: 'bg2', label: 'Fondo 2' },
  { slot: 'tx2', label: 'Texto 2' },
  { slot: 'accent1', label: 'Énfasis 1' },
  { slot: 'accent2', label: 'Énfasis 2' },
  { slot: 'accent3', label: 'Énfasis 3' },
  { slot: 'accent4', label: 'Énfasis 4' },
  { slot: 'accent5', label: 'Énfasis 5' },
  { slot: 'accent6', label: 'Énfasis 6' },
];

export function useUi(ui: SlidesUI) {
  useSyncExternalStore(ui.ctl.subscribe, ui.ctl.getVersion);
  return ui.ctl;
}

/** A colour menu: theme colours (with tints), standard colours, none, and "more colours". */
export function ColorPicker({ ui, label, icon, onPick, allowNone = true, noneLabel }: { ui: SlidesUI; label: string; icon: string; onPick: (c: Clr | null) => void; allowNone?: boolean; noneLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<Clr>({ rgb: '#c00000' });
  const css = (c: Clr) => {
    const cc = ui.canvasCtx();
    return cc ? clrCss(c, cc.env.cc) : (c.rgb ?? '#888');
  };
  const pick = (c: Clr | null) => {
    if (c) setLast(c);
    onPick(c);
    setOpen(false);
  };
  return (
    <div className="nv-split">
      <button type="button" className="nv-btn nv-btn--small nv-colorbtn" title={label} aria-label={label} onClick={() => onPick(last)}>
        <Icon name={icon} />
        <span className="nv-colorbar" style={{ background: css(last) }} />
      </button>
      <Popover open={open} onOpenChange={(_e, d) => setOpen(d.open)} positioning="below-start">
        <PopoverTrigger disableButtonEnhancement>
          <button type="button" className="nv-btn nv-btn--small nv-btn--menu" aria-label={`${label} (${t('más')})`} aria-haspopup="dialog">
            <ChevronDown size={12} />
          </button>
        </PopoverTrigger>
        <PopoverSurface>
          <div className="sl-swatchtitle">{t('Colores del tema')}</div>
          <div className="nv-swatches" role="group" aria-label={t('Colores del tema')}>
            {THEME_SLOTS.map(({ slot, label: l }) => (
              <button key={slot} type="button" style={{ background: css({ scheme: slot }) }} aria-label={l} title={l} onClick={() => pick({ scheme: slot })} />
            ))}
            {[20000, 40000, 60000, 75000].map((m) =>
              THEME_SLOTS.slice(4).map(({ slot, label: l }) => (
                <button key={`${slot}${m}`} type="button" style={{ background: css({ scheme: slot, mods: [{ t: 'lumMod', v: m }, { t: 'lumOff', v: 100000 - m }] }) }} aria-label={`${l} ${100 - m / 1000}%`} onClick={() => pick({ scheme: slot, mods: [{ t: 'lumMod', v: m }, { t: 'lumOff', v: 100000 - m }] })} />
              )),
            )}
          </div>
          <div className="sl-swatchtitle">{t('Colores estándar')}</div>
          <div className="nv-swatches" role="group" aria-label={t('Colores estándar')}>
            {PALETTE[0]!.map((col) => (
              <button key={col} type="button" style={{ background: col }} aria-label={col} title={col} onClick={() => pick({ rgb: col })} />
            ))}
          </div>
          <div style={{ padding: '4px 8px 8px', display: 'flex', gap: 8, alignItems: 'center' }}>
            {allowNone && (
              <button type="button" className="nv-btn nv-btn--small" onClick={() => pick(null)}>
                {noneLabel ?? t('Sin color')}
              </button>
            )}
            <label className="sl-more">
              {t('Más colores')}
              <input type="color" aria-label={t('Más colores')} onChange={(e) => pick({ rgb: e.target.value })} />
            </label>
          </div>
        </PopoverSurface>
      </Popover>
    </div>
  );
}

export function FontGroup({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  const r: RunProps = ui.runProps();
  const font = (r.latin && !r.latin.startsWith('+') ? r.latin : undefined) ?? ui.canvasCtx()?.chain.theme.fonts.minor.latin ?? 'Calibri';
  const size = r.sz ?? 18;
  const names = FONT_NAMES.includes(font) ? FONT_NAMES : [font, ...FONT_NAMES];
  const sizes = FONT_SIZES.includes(size) ? FONT_SIZES : [...FONT_SIZES, size].sort((a, b) => a - b);
  return (
    <div className="nv-rows">
      <div className="nv-row">
        <select className="nv-select" style={{ width: 130 }} aria-label={t('Fuente')} title={t('Fuente')} value={font} onChange={(e) => applyRun(c, (x) => ({ ...x, latin: e.target.value }))}>
          {names.map((n) => (
            <option key={n} value={n} style={{ fontFamily: n }}>
              {n}
            </option>
          ))}
        </select>
        <select className="nv-select" style={{ width: 62 }} aria-label={t('Tamaño de fuente')} title={t('Tamaño de fuente')} value={size} onChange={(e) => applyRun(c, (x) => ({ ...x, sz: Number(e.target.value) }))}>
          {sizes.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** A popover holding a grid of choices. */
export function Gallery({ label, icon, size = 'large', children, wide }: { label: string; icon: string; size?: 'large' | 'small'; children: (close: () => void) => ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={(_e, d) => setOpen(d.open)} positioning="below-start">
      <PopoverTrigger disableButtonEnhancement>
        <button type="button" className={`nv-btn nv-btn--${size}`} aria-haspopup="dialog" aria-label={label} title={label}>
          <Icon name={icon} />
          <span className="nv-btn__label">
            {label} <ChevronDown size={11} />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverSurface>
        <div className={wide ? 'sl-gallery sl-gallery--wide' : 'sl-gallery'}>{children(() => setOpen(false))}</div>
      </PopoverSurface>
    </Popover>
  );
}

// ------------------------------------------------------------------------------------------------ shapes gallery

const SHAPE_GROUPS: { title: string; shapes: string[] }[] = [
  { title: 'Líneas', shapes: ['line', 'straightConnector1', 'bentConnector3', 'curvedConnector3'] },
  { title: 'Rectángulos', shapes: ['rect', 'roundRect', 'snip1Rect', 'snip2SameRect', 'snipRoundRect', 'round1Rect', 'round2SameRect'] },
  { title: 'Formas básicas', shapes: ['ellipse', 'triangle', 'rtTriangle', 'diamond', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'heptagon', 'octagon', 'decagon', 'dodecagon', 'pie', 'chord', 'teardrop', 'frame', 'halfFrame', 'corner', 'diagStripe', 'plus', 'plaque', 'can', 'cube', 'bevel', 'donut', 'noSmoking', 'blockArc', 'foldedCorner', 'smileyFace', 'heart', 'lightningBolt', 'sun', 'moon', 'cloud', 'arc', 'bracketPair', 'bracePair', 'leftBracket', 'rightBracket', 'leftBrace', 'rightBrace'] },
  { title: 'Flechas de bloque', shapes: ['rightArrow', 'leftArrow', 'upArrow', 'downArrow', 'leftRightArrow', 'upDownArrow', 'quadArrow', 'leftRightUpArrow', 'bentArrow', 'uturnArrow', 'leftUpArrow', 'bentUpArrow', 'curvedRightArrow', 'curvedLeftArrow', 'curvedUpArrow', 'curvedDownArrow', 'stripedRightArrow', 'notchedRightArrow', 'homePlate', 'chevron', 'rightArrowCallout', 'leftArrowCallout', 'upArrowCallout', 'downArrowCallout', 'circularArrow'] },
  { title: 'Formas de ecuación', shapes: ['mathPlus', 'mathMinus', 'mathMultiply', 'mathDivide', 'mathEqual', 'mathNotEqual'] },
  { title: 'Diagrama de flujo', shapes: ['flowChartProcess', 'flowChartAlternateProcess', 'flowChartDecision', 'flowChartInputOutput', 'flowChartPredefinedProcess', 'flowChartInternalStorage', 'flowChartDocument', 'flowChartMultidocument', 'flowChartTerminator', 'flowChartPreparation', 'flowChartManualInput', 'flowChartManualOperation', 'flowChartConnector', 'flowChartOffpageConnector', 'flowChartPunchedCard', 'flowChartPunchedTape', 'flowChartSummingJunction', 'flowChartOr', 'flowChartCollate', 'flowChartSort', 'flowChartExtract', 'flowChartMerge', 'flowChartOnlineStorage', 'flowChartDelay', 'flowChartMagneticTape', 'flowChartMagneticDisk', 'flowChartMagneticDrum', 'flowChartDisplay'] },
  { title: 'Estrellas y cintas', shapes: ['star4', 'star5', 'star6', 'star7', 'star8', 'star10', 'star12', 'star16', 'star24', 'star32', 'irregularSeal1', 'irregularSeal2', 'ribbon', 'ribbon2', 'ellipseRibbon', 'ellipseRibbon2', 'verticalScroll', 'horizontalScroll', 'wave', 'doubleWave'] },
  { title: 'Llamadas', shapes: ['wedgeRectCallout', 'wedgeRoundRectCallout', 'wedgeEllipseCallout', 'cloudCallout', 'borderCallout1', 'borderCallout2', 'borderCallout3', 'accentCallout1', 'accentCallout2', 'accentCallout3', 'callout1', 'callout2', 'callout3', 'accentBorderCallout1'] },
  { title: 'Botones de acción', shapes: ['actionButtonBackPrevious', 'actionButtonForwardNext', 'actionButtonBeginning', 'actionButtonEnd', 'actionButtonHome', 'actionButtonInformation', 'actionButtonReturn', 'actionButtonMovie', 'actionButtonDocument', 'actionButtonSound', 'actionButtonHelp', 'actionButtonBlank'] },
];
const known = new Set(presetNames());

export function ShapePreview({ prst, size = 26 }: { prst: string; size?: number }) {
  const g = geometryOf({ prst }, size - 6, size - 6);
  const isLine = /^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/.test(prst);
  return (
    <svg width={size} height={size} viewBox={`-3 -3 ${size} ${size}`} aria-hidden="true">
      {g.paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.fill === 'none' || isLine ? 'none' : '#4472c4'} stroke="#2f528f" strokeWidth={1.2} />
      ))}
    </svg>
  );
}

export function ShapesGallery({ ui, label = 'Formas', size = 'large' as 'large' | 'small' }: { ui: SlidesUI; label?: string; size?: 'large' | 'small' }) {
  const c = useUi(ui);
  return (
    <Gallery label={t(label)} icon="shape-rect" size={size} wide>
      {(close) => (
        <div className="sl-shapes" role="menu" aria-label={t('Formas')}>
          {SHAPE_GROUPS.map((g) => (
            <div key={g.title}>
              <div className="sl-swatchtitle">{t(g.title)}</div>
              <div className="sl-shapegrid">
                {g.shapes
                  .filter((s) => known.has(s))
                  .map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="menuitem"
                      title={s}
                      aria-label={s}
                      onClick={() => {
                        c.setTool(/^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/.test(s) ? { kind: 'line', prst: s } : { kind: 'shape', prst: s });
                        close();
                        c.containerFocus?.();
                      }}
                    >
                      <ShapePreview prst={s} />
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Gallery>
  );
}

// ------------------------------------------------------------------------------------------------ layouts

export function LayoutGallery({ ui, label, icon, apply }: { ui: SlidesUI; label: string; icon: string; apply: 'new' | 'change' }) {
  const c = useUi(ui);
  return (
    <Gallery label={t(label)} icon={icon} wide>
      {(close) => (
        <div className="sl-layouts" role="menu" aria-label={t(label)}>
          {c.deck.layouts.map((l) => (
            <button
              key={l.id}
              type="button"
              role="menuitem"
              className="sl-layoutbtn"
              onClick={() => {
                if (apply === 'new') c.newSlide(l.id);
                else c.setLayoutOf(l.id);
                close();
                c.containerFocus?.();
              }}
            >
              <LayoutSketch ui={ui} layoutId={l.id} />
              <span>{l.name}</span>
            </button>
          ))}
        </div>
      )}
    </Gallery>
  );
}

function LayoutSketch({ ui, layoutId }: { ui: SlidesUI; layoutId: string }) {
  const c = ui.ctl;
  const l = c.deck.layouts.find((x) => x.id === layoutId);
  const master = c.deck.masters.find((m) => m.id === l?.masterId) ?? c.deck.masters[0];
  const W = 96;
  const k = W / c.deck.size.w;
  const boxes = (l?.shapes ?? []).filter((s): s is Extract<SlideElement, { kind: 'shape' }> => s.kind === 'shape' && !!s.ph && !['dt', 'ftr', 'sldNum'].includes(s.ph.type));
  return (
    <svg width={W} height={c.deck.size.h * k} viewBox={`0 0 ${W} ${c.deck.size.h * k}`} aria-hidden="true">
      <rect width={W} height={c.deck.size.h * k} fill="#fff" stroke="#999" />
      {boxes.map((b) => {
        const x = b.xfrm ?? master?.shapes.find((m) => m.kind === 'shape' && m.ph?.type === (b.ph!.type === 'ctrTitle' ? 'title' : b.ph!.type === 'obj' || b.ph!.type === 'subTitle' ? 'body' : b.ph!.type))?.xfrm;
        if (!x) return null;
        return <rect key={b.id} x={x.x * k} y={x.y * k} width={x.w * k} height={x.h * k} fill="#e8eefc" stroke="#7a8fc0" strokeWidth={0.6} />;
      })}
    </svg>
  );
}

// ------------------------------------------------------------------------------------------------ fills, outlines, effects

export const solid = (c: Clr): Fill => ({ t: 'solid', c });

export function FillMenu({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  return (
    <ColorPicker
      ui={ui}
      label={t('Relleno de forma')}
      icon="paintbucket"
      noneLabel={t('Sin relleno')}
      onPick={(clr) => c.patchSelected('Relleno', (el) => ({ ...el, fill: clr ? solid(clr) : { t: 'none' } }) as SlideElement)}
    />
  );
}

export function OutlineMenu({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  return (
    <ColorPicker
      ui={ui}
      label={t('Contorno de forma')}
      icon="shape-rect"
      noneLabel={t('Sin contorno')}
      onPick={(clr) =>
        c.patchSelected('Contorno', (el) => {
          const cur = (el as { ln?: Ln }).ln ?? {};
          return { ...el, ln: clr ? { ...cur, fill: solid(clr), w: cur.w ?? 1.5 } : { ...cur, fill: { t: 'none' } } } as SlideElement;
        })
      }
    />
  );
}

export const SHADOW_PRESETS: { id: string; label: string; fx: Effects }[] = [
  { id: 'none', label: 'Sin sombra', fx: {} },
  { id: 'outer', label: 'Exterior: desplazada abajo a la derecha', fx: { outer: { blur: 4, dist: 3, dir: 45, c: { rgb: '#000000', mods: [{ t: 'alpha', v: 40000 }] }, algn: 'tl', rotWithShape: false } } },
  { id: 'outerSoft', label: 'Exterior: difuminada', fx: { outer: { blur: 12, dist: 4, dir: 90, c: { rgb: '#000000', mods: [{ t: 'alpha', v: 35000 }] }, algn: 'ctr', rotWithShape: false } } },
  { id: 'inner', label: 'Interior', fx: { inner: { blur: 6, dist: 3, dir: 45, c: { rgb: '#000000', mods: [{ t: 'alpha', v: 50000 }] } } } },
];
export const REFLECTION_PRESET: Effects['reflection'] = { blur: 0.5, stA: 50, stPos: 0, endA: 0, endPos: 35, dist: 0, dir: 90, fadeDir: 90, sx: 100, sy: -100, algn: 'bl', rotWithShape: false };

export function EffectsMenu({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  const set = (fn: (e: Effects) => Effects) => c.patchSelected('Efectos', (el) => ({ ...el, effects: fn((el as { effects?: Effects }).effects ?? {}) }) as SlideElement);
  return (
    <Gallery label={t('Efectos de forma')} icon="shadow" size="small">
      {(close) => (
        <div className="sl-effects" role="menu">
          <div className="sl-swatchtitle">{t('Sombra')}</div>
          {SHADOW_PRESETS.map((p) => (
            <button key={p.id} type="button" role="menuitem" onClick={() => (set((e) => ({ ...e, outer: p.fx.outer, inner: p.fx.inner })), close())}>
              {t(p.label)}
            </button>
          ))}
          <div className="sl-swatchtitle">{t('Reflejo')}</div>
          <button type="button" role="menuitem" onClick={() => (set((e) => ({ ...e, reflection: undefined })), close())}>{t('Sin reflejo')}</button>
          <button type="button" role="menuitem" onClick={() => (set((e) => ({ ...e, reflection: REFLECTION_PRESET })), close())}>{t('Reflejo: parte superior pegada')}</button>
          <div className="sl-swatchtitle">{t('Iluminado')}</div>
          <button type="button" role="menuitem" onClick={() => (set((e) => ({ ...e, glow: undefined })), close())}>{t('Sin iluminado')}</button>
          {[5, 10, 18].map((r) => (
            <button key={r} type="button" role="menuitem" onClick={() => (set((e) => ({ ...e, glow: { rad: r, c: { scheme: 'accent1', mods: [{ t: 'alpha', v: 60000 }] } } })), close())}>
              {t('Iluminado')} {r} pt
            </button>
          ))}
          <div className="sl-swatchtitle">{t('Bordes suaves')}</div>
          <button type="button" role="menuitem" onClick={() => (set((e) => ({ ...e, softEdge: undefined })), close())}>{t('Sin bordes suaves')}</button>
          {[2.5, 5, 10].map((r) => (
            <button key={r} type="button" role="menuitem" onClick={() => (set((e) => ({ ...e, softEdge: { rad: r } })), close())}>
              {r} pt
            </button>
          ))}
        </div>
      )}
    </Gallery>
  );
}
