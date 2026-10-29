import { clrCss, STYLE_FAMILIES, setBorders, setCellFill, tableStyleFor, type BorderMode, type Clr, type Fill, type Ln, type TableEl, type TableStyleDef } from '@suitenova/slides-core';
import { t } from '@suitenova/core-ui';
import type { SlidesUI } from './commands';
import { parts } from './render/table';
import { ColorPicker, Gallery, solid, useUi } from './ribbonParts';

/** A small picture of a table style: four rows by four columns with a header and bands. */
function StyleThumb({ def, ui }: { def: TableStyleDef | null; ui: SlidesUI }) {
  const cc = ui.canvasCtx()?.env.cc;
  const fake = { firstRow: true, bandRow: true } as TableEl;
  const col = (c: Clr | undefined) => (c && cc ? clrCss(c, cc) : '#999');
  const cells: React.ReactNode[] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let bg = 'transparent';
      let line: string | undefined;
      if (def) {
        for (const p of parts(def, fake, r, c, 4, 4)) {
          if (p.fill?.t === 'solid') bg = col(p.fill.c);
          const l = p.ln?.insideH ?? p.ln?.t ?? p.ln?.b;
          if (l?.fill?.t === 'solid') line = col(l.fill.c);
        }
      }
      cells.push(<span key={`${r}${c}`} style={{ background: bg, border: line ? `1px solid ${line}` : '1px solid transparent' }} />);
    }
  }
  return <span className="sl-stylethumb">{cells}</span>;
}

/** Gallery of table styles: four families in six accent colours, and two without a style. */
export function TableStyleGallery({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  const on = !!c.table;
  return (
    <Gallery label={t('Estilos de tabla')} icon="tableGrid" wide>
      {(close) => (
        <div role="menu" aria-label={t('Estilos de tabla')} className="sl-tablestyles">
          {STYLE_FAMILIES.map((f) => (
            <div key={f.id}>
              <div className="sl-swatchtitle">{t(f.name)}</div>
              <div className="sl-stylerow">
                {[1, 2, 3, 4, 5, 6].map((a) => {
                  const def = tableStyleFor(f.id, a);
                  return (
                    <button key={def.id} type="button" role="menuitem" disabled={!on} title={def.name} aria-label={def.name} onClick={() => (c.setTableStyle(def), close())}>
                      <StyleThumb def={def} ui={ui} />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="sl-swatchtitle">{t('Sin estilo')}</div>
          <div className="sl-stylerow">
            <button type="button" role="menuitem" disabled={!on} title={t('Sin estilo, sin cuadrícula')} aria-label={t('Sin estilo, sin cuadrícula')} onClick={() => (c.setTableStyle(null, 'none'), close())}>
              <StyleThumb def={null} ui={ui} />
            </button>
            <button type="button" role="menuitem" disabled={!on} title={t('Sin estilo, cuadrícula de tabla')} aria-label={t('Sin estilo, cuadrícula de tabla')} onClick={() => (c.setTableStyle(null, 'grid'), close())}>
              <StyleThumb def={null} ui={ui} />
            </button>
          </div>
        </div>
      )}
    </Gallery>
  );
}

export const BORDER_MODES: [BorderMode, string][] = [
  ['all', 'Todos los bordes'],
  ['outer', 'Borde exterior'],
  ['inner', 'Bordes interiores'],
  ['top', 'Borde superior'],
  ['bottom', 'Borde inferior'],
  ['left', 'Borde izquierdo'],
  ['right', 'Borde derecho'],
  ['insideH', 'Borde horizontal interior'],
  ['insideV', 'Borde vertical interior'],
  ['none', 'Sin borde'],
];

export const lnOfPen = (pen: { w: number; clr: Clr; dash?: Ln['dash'] }): Ln => ({ w: pen.w, fill: solid(pen.clr), ...(pen.dash ? { dash: pen.dash } : {}) });

/** Borders of the selected cells: the pen (weight, colour, dash) and where to draw it. */
export function TableBordersMenu({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  const on = !!c.table;
  const pen = c.borderPen;
  return (
    <Gallery label={t('Bordes')} icon="cellBorders" size="small">
      {(close) => (
        <div role="menu" aria-label={t('Bordes')} className="sl-menulist sl-borders">
          <label className="sl-inline">
            <span>{t('Grosor')}</span>
            <select aria-label={t('Grosor del borde')} value={pen.w} onChange={(e) => ((c.borderPen = { ...pen, w: Number(e.target.value) }), c.touch())}>
              {[0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6].map((w) => <option key={w} value={w}>{w} pt</option>)}
            </select>
          </label>
          <label className="sl-inline">
            <span>{t('Estilo')}</span>
            <select aria-label={t('Estilo del borde')} value={pen.dash ?? 'solid'} onChange={(e) => ((c.borderPen = { ...pen, dash: e.target.value === 'solid' ? undefined : (e.target.value as Ln['dash']) }), c.touch())}>
              <option value="solid">{t('Continuo')}</option>
              <option value="dash">{t('Guiones')}</option>
              <option value="sysDot">{t('Puntos')}</option>
              <option value="dashDot">{t('Guion y punto')}</option>
            </select>
          </label>
          <div className="sl-swatchtitle">{t('Color del borde')}</div>
          <div className="nv-swatches" role="group" aria-label={t('Color del borde')}>
            {(['dk1', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'lt1'] as const).map((slot) => (
              <button key={slot} type="button" aria-label={slot} aria-pressed={pen.clr.scheme === slot} style={{ background: ui.canvasCtx() ? clrCss({ scheme: slot }, ui.canvasCtx()!.env.cc) : '#888', outline: pen.clr.scheme === slot ? '2px solid var(--nv-accent, #c05621)' : undefined }} onClick={() => ((c.borderPen = { ...pen, clr: { scheme: slot } }), c.touch())} />
            ))}
          </div>
          {BORDER_MODES.map(([mode, label]) => (
            <button key={mode} type="button" role="menuitem" disabled={!on} onClick={() => (c.tableApply('Bordes de tabla', (tb, rg) => setBorders(tb, rg, mode, mode === 'none' ? null : lnOfPen(c.borderPen))), close())}>
              {t(label)}
            </button>
          ))}
        </div>
      )}
    </Gallery>
  );
}

/** Fill of the selected cells. */
export function TableShadingPicker({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  return (
    <ColorPicker
      ui={ui}
      label={t('Sombreado')}
      icon="paintbucket"
      noneLabel={t('Sin relleno')}
      onPick={(clr) => c.tableApply('Sombreado de celdas', (tb, rg) => setCellFill(tb, rg, (clr ? solid(clr) : { t: 'none' }) as Fill))}
    />
  );
}
