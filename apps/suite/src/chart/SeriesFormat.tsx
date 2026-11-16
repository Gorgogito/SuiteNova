import { t } from '@suitenova/core-ui';
import { CHART_COLORS, type ChartSeries, type ChartSpec, type DashStyle, type MarkerSymbol, type PointFormat, type StrokeFormat } from '@suitenova/chart-core';
import { useState } from 'react';
import './messages';
import './chart.css';

/*
 * El panel «Formato de serie» de Office: relleno o línea, borde, marcadores, formato de cada punto y las opciones de la serie (ancho
 * del hueco, superposición, ángulo del primer sector, agujero del anillo, sectores sacados). Lo usan Calc, Slides y Writer.
 */

type Kind = 'bar' | 'line' | 'area' | 'scatter' | 'radar' | 'pie';

/** Cómo se dibuja una serie: el tipo propio, o el del gráfico. */
export function kindOf(def: ChartSpec, s: ChartSeries): Kind | null {
  const t = s.type ?? def.type;
  switch (t) {
    case 'column':
    case 'bar':
      return 'bar';
    case 'line':
    case 'area':
    case 'scatter':
    case 'radar':
      return t;
    case 'pie':
    case 'doughnut':
      return 'pie';
    default:
      return null;
  }
}

const DASHES: [DashStyle, string][] = [['solid', 'Continua'], ['dash', 'Guiones'], ['dot', 'Puntos'], ['dashDot', 'Guion y punto'], ['longDash', 'Guiones largos']];
const SYMBOLS: [MarkerSymbol, string][] = [['circle', 'Círculo'], ['square', 'Cuadrado'], ['diamond', 'Rombo'], ['triangle', 'Triángulo'], ['x', 'Equis'], ['star', 'Estrella'], ['plus', 'Más'], ['dash', 'Guion'], ['dot', 'Punto'], ['none', 'Ninguno']];

const num = (v: string): number | undefined => {
  const n = Number(v.replace(',', '.'));
  return v.trim() === '' || !Number.isFinite(n) ? undefined : n;
};

function Stroke({ id, title, none, st, onChange, color, withColor = true }: { id: string; title: string; none: string; st: StrokeFormat | undefined; onChange: (s: StrokeFormat | undefined) => void; color: string; withColor?: boolean }) {
  const cur = st ?? {};
  const set = (patch: Partial<StrokeFormat>) => {
    const next: StrokeFormat = { ...cur, ...patch };
    for (const k of Object.keys(next) as (keyof StrokeFormat)[]) if (next[k] === undefined || next[k] === false) delete next[k];
    onChange(Object.keys(next).length ? next : undefined);
  };
  return (
    <fieldset className="nc-set">
      <legend>{title}</legend>
      <label className="nc-check">
        <input type="checkbox" checked={!!cur.none} onChange={(e) => set({ none: e.target.checked })} />
        <span>{none}</span>
      </label>
      {!cur.none && (
        <div className="nc-form__row">
          {withColor && (
            <label className="nc-field nc-field--narrow">
              <span>{t('Color')}</span>
              <input type="color" aria-label={`${title}: ${t('Color')}`} value={cur.color ?? color} onChange={(e) => set({ color: e.target.value })} />
            </label>
          )}
          <label className="nc-field nc-field--narrow">
            <span>{t('Ancho (pt)')}</span>
            <input id={`${id}-w`} type="number" min={0} max={20} step={0.25} aria-label={`${title}: ${t('Ancho (pt)')}`} value={cur.width ?? ''} placeholder={t('Automático')} onChange={(e) => set({ width: num(e.target.value) })} />
          </label>
          <label className="nc-field">
            <span>{t('Tipo de guion')}</span>
            <select aria-label={`${title}: ${t('Tipo de guion')}`} value={cur.dash ?? 'solid'} onChange={(e) => set({ dash: e.target.value === 'solid' ? undefined : (e.target.value as DashStyle) })}>
              {DASHES.map(([k, l]) => (
                <option key={k} value={k}>{t(l)}</option>
              ))}
            </select>
          </label>
        </div>
      )}
    </fieldset>
  );
}

export function SeriesFormat({ def, names, categories, set, setSeries }: { def: ChartSpec; names: string[]; categories: string[]; set: (patch: Partial<ChartSpec>) => void; setSeries: (i: number, patch: Partial<ChartSeries>) => void }) {
  const [i, setI] = useState(0);
  const idx = Math.min(i, Math.max(0, def.series.length - 1));
  const s = def.series[idx];
  if (!s) return null;
  const kind = kindOf(def, s);
  const color = s.color ?? CHART_COLORS[idx % CHART_COLORS.length]!;
  const patch = (p: Partial<ChartSeries>) => setSeries(idx, p);
  const filled = kind === 'bar' || kind === 'area' || kind === 'pie' || (kind === 'radar' && !!def.radar?.filled);
  const lined = kind === 'line' || kind === 'scatter' || (kind === 'radar' && !def.radar?.filled);
  const points = s.points ?? [];
  const setPoint = (pi: number, p: Partial<PointFormat>) => {
    const rest = points.filter((x) => x.idx !== pi);
    const merged: PointFormat = { ...(points.find((x) => x.idx === pi) ?? { idx: pi }), ...p };
    for (const k of Object.keys(merged) as (keyof PointFormat)[]) if (merged[k] === undefined) delete merged[k];
    const next = Object.keys(merged).length > 1 ? [...rest, merged].sort((a, b) => a.idx - b.idx) : rest;
    patch({ points: next.length ? next : undefined });
  };
  const oneSeriesBar = kind === 'bar' && def.series.length === 1;
  const pointKinds = kind === 'bar' || kind === 'pie';
  const count = Math.min(categories.length, 60);

  return (
    <div className="nc-form" data-testid="series-format">
      <label className="nc-field">
        <span>{t('Serie')}</span>
        <select aria-label={t('Serie que se formatea')} value={idx} onChange={(e) => setI(Number(e.target.value))}>
          {def.series.map((_x, k) => (
            <option key={k} value={k}>{names[k] ?? `${t('Serie')} ${k + 1}`}</option>
          ))}
        </select>
      </label>

      {filled && (
        <fieldset className="nc-set">
          <legend>{t('Relleno')}</legend>
          <label className="nc-check">
            <input type="checkbox" checked={!!s.noFill} onChange={(e) => patch({ noFill: e.target.checked ? true : undefined })} />
            <span>{t('Sin relleno')}</span>
          </label>
          {!s.noFill && (
            <div className="nc-form__row">
              <label className="nc-field nc-field--narrow">
                <span>{t('Color')}</span>
                <input type="color" aria-label={t('Color de relleno')} value={color} onChange={(e) => patch({ color: e.target.value })} />
              </label>
              <label className="nc-field nc-field--narrow">
                <span>{t('Transparencia (%)')}</span>
                <input type="number" min={0} max={100} aria-label={t('Transparencia del relleno')} value={s.transparency ?? 0} onChange={(e) => patch({ transparency: Math.max(0, Math.min(100, num(e.target.value) ?? 0)) || undefined })} />
              </label>
            </div>
          )}
        </fieldset>
      )}

      {lined && (
        <>
          <Stroke id={`sf-line-${idx}`} title={t('Línea')} none={t('Sin línea')} st={s.line} onChange={(l) => patch({ line: l })} color={color} withColor={false} />
          <label className="nc-field nc-field--narrow">
            <span>{t('Color de la línea')}</span>
            <input type="color" aria-label={t('Color de la línea')} value={color} onChange={(e) => patch({ color: e.target.value })} />
          </label>
          <fieldset className="nc-set">
            <legend>{t('Marcador')}</legend>
            <div className="nc-form__row">
              <label className="nc-field">
                <span>{t('Tipo de marcador')}</span>
                <select aria-label={t('Tipo de marcador')} value={s.marker?.symbol ?? ''} onChange={(e) => patch({ marker: { ...s.marker, symbol: (e.target.value || undefined) as MarkerSymbol | undefined } })}>
                  <option value="">{t('Automático')}</option>
                  {SYMBOLS.map(([k, l]) => (
                    <option key={k} value={k}>{t(l)}</option>
                  ))}
                </select>
              </label>
              <label className="nc-field nc-field--narrow">
                <span>{t('Tamaño')}</span>
                <input type="number" min={2} max={72} aria-label={t('Tamaño del marcador')} value={s.marker?.size ?? ''} placeholder={t('Automático')} onChange={(e) => patch({ marker: { ...s.marker, size: num(e.target.value) } })} />
              </label>
              <label className="nc-field nc-field--narrow">
                <span>{t('Color')}</span>
                <input type="color" aria-label={t('Color del marcador')} value={s.marker?.color ?? color} onChange={(e) => patch({ marker: { ...s.marker, color: e.target.value } })} />
              </label>
            </div>
          </fieldset>
        </>
      )}

      {filled && <Stroke id={`sf-border-${idx}`} title={t('Borde')} none={t('Sin borde')} st={s.line} onChange={(l) => patch({ line: l })} color="#000000" />}

      <fieldset className="nc-set">
        <legend>{t('Opciones de la serie')}</legend>
        <div className="nc-form__row">
          {kind === 'bar' && (
            <>
              <label className="nc-field nc-field--narrow">
                <span>{t('Ancho del intervalo (%)')}</span>
                <input type="number" min={0} max={500} aria-label={t('Ancho del intervalo')} value={def.gapWidth ?? 150} onChange={(e) => set({ gapWidth: Math.max(0, Math.min(500, num(e.target.value) ?? 150)) })} />
              </label>
              <label className="nc-field nc-field--narrow">
                <span>{t('Superposición (%)')}</span>
                <input type="number" min={-100} max={100} aria-label={t('Superposición de series')} value={def.overlap ?? (def.stacked ? 100 : 0)} onChange={(e) => set({ overlap: Math.max(-100, Math.min(100, num(e.target.value) ?? 0)) })} />
              </label>
            </>
          )}
          {oneSeriesBar && (
            <label className="nc-check">
              <input type="checkbox" checked={!!def.varyColors} onChange={(e) => set({ varyColors: e.target.checked ? true : undefined })} />
              <span>{t('Variar colores por punto')}</span>
            </label>
          )}
          {kind === 'pie' && (
            <>
              <label className="nc-field nc-field--narrow">
                <span>{t('Ángulo del primer sector (°)')}</span>
                <input type="number" min={0} max={360} aria-label={t('Ángulo del primer sector')} value={def.firstSliceAng ?? 0} onChange={(e) => set({ firstSliceAng: Math.max(0, Math.min(360, num(e.target.value) ?? 0)) || undefined })} />
              </label>
              {def.type === 'doughnut' && (
                <label className="nc-field nc-field--narrow">
                  <span>{t('Tamaño del agujero (%)')}</span>
                  <input type="number" min={10} max={90} aria-label={t('Tamaño del agujero')} value={def.holeSize ?? 50} onChange={(e) => set({ holeSize: Math.max(10, Math.min(90, num(e.target.value) ?? 50)) })} />
                </label>
              )}
              {def.type === 'pie' && (
                <label className="nc-field nc-field--narrow">
                  <span>{t('Explosión de los sectores (%)')}</span>
                  <input type="number" min={0} max={400} aria-label={t('Explosión de la serie')} value={s.explosion ?? 0} onChange={(e) => patch({ explosion: Math.max(0, Math.min(400, num(e.target.value) ?? 0)) || undefined })} />
                </label>
              )}
            </>
          )}
          {kind !== 'bar' && kind !== 'pie' && <span className="nc-note">{t('Esta serie no tiene opciones propias.')}</span>}
        </div>
      </fieldset>

      {pointKinds && count > 0 && (
        <fieldset className="nc-set">
          <legend>{t('Puntos de datos')}</legend>
          <div className="nc-points" role="group" aria-label={t('Formato de cada punto')}>
            {Array.from({ length: count }, (_x, p) => {
              const pt = points.find((q) => q.idx === p);
              return (
                <div key={p} className="nc-points__row">
                  <span className="nc-points__name">{categories[p] || `${t('Punto')} ${p + 1}`}</span>
                  <input type="color" aria-label={`${t('Color del punto')} ${p + 1}`} value={pt?.color ?? (kind === 'pie' ? CHART_COLORS[p % CHART_COLORS.length]! : color)} onChange={(e) => setPoint(p, { color: e.target.value })} />
                  {kind === 'pie' && def.type === 'pie' && (
                    <input type="number" min={0} max={400} className="nc-points__num" aria-label={`${t('Explosión del punto')} ${p + 1}`} value={pt?.explosion ?? ''} placeholder="%" onChange={(e) => setPoint(p, { explosion: num(e.target.value) || undefined })} />
                  )}
                  <button type="button" className="nc-points__reset" disabled={!pt} onClick={() => setPoint(p, { color: undefined, explosion: undefined })}>{t('Restablecer')}</button>
                </div>
              );
            })}
          </div>
        </fieldset>
      )}
    </div>
  );
}
