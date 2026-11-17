import { t } from '@suitenova/core-ui';
import type { AreaFormat, ChartFonts, ChartSpec, TextFormat } from '@suitenova/chart-core';
import { useState } from 'react';
import { Stroke } from './SeriesFormat';
import './messages';
import './chart.css';

/*
 * Los paneles «Formato del área del gráfico», «Formato del área de trazado» y «Fuente» de Office: relleno y borde de cada área, y la
 * fuente del gráfico, el título, la leyenda, los ejes y las etiquetas. Lo usan Calc, Slides y Writer.
 */

const PARTS: [keyof ChartFonts, string][] = [['chart', 'Todo el gráfico'], ['title', 'Título'], ['legend', 'Leyenda'], ['axis', 'Etiquetas de los ejes'], ['axisTitle', 'Títulos de los ejes'], ['labels', 'Etiquetas de datos']];
const FAMILIES = ['Calibri', 'Arial', 'Times New Roman', 'Georgia', 'Verdana', 'Tahoma', 'Courier New', 'Segoe UI', 'Cambria', 'Consolas'];

const num = (v: string): number | undefined => {
  const n = Number(v.replace(',', '.'));
  return v.trim() === '' || !Number.isFinite(n) ? undefined : n;
};

function Area({ id, title, area, fallback, onChange }: { id: string; title: string; area: AreaFormat | undefined; fallback: string; onChange: (a: AreaFormat | undefined) => void }) {
  const cur = area ?? {};
  const set = (patch: Partial<AreaFormat>) => {
    const next: AreaFormat = { ...cur, ...patch };
    for (const k of Object.keys(next) as (keyof AreaFormat)[]) if (next[k] === undefined || next[k] === false) delete next[k];
    onChange(Object.keys(next).length ? next : undefined);
  };
  return (
    <fieldset className="nc-set" data-area={id}>
      <legend>{title}</legend>
      <label className="nc-check">
        <input type="checkbox" checked={!!cur.noFill} onChange={(e) => set({ noFill: e.target.checked, fill: e.target.checked ? undefined : cur.fill })} />
        <span>{t('Sin relleno')}</span>
      </label>
      {!cur.noFill && (
        <div className="nc-form__row">
          <label className="nc-field nc-field--narrow">
            <span>{t('Color de relleno')}</span>
            <input type="color" aria-label={`${title}: ${t('Color de relleno')}`} value={cur.fill ?? fallback} onChange={(e) => set({ fill: e.target.value })} />
          </label>
          <label className="nc-field nc-field--narrow">
            <span>{t('Transparencia (%)')}</span>
            <input type="number" min={0} max={100} aria-label={`${title}: ${t('Transparencia del relleno')}`} value={cur.transparency ?? 0} onChange={(e) => set({ transparency: Math.max(0, Math.min(100, num(e.target.value) ?? 0)) || undefined })} />
          </label>
          {cur.fill && (
            <button type="button" className="nc-points__reset" onClick={() => set({ fill: undefined, transparency: undefined })}>{t('Automático')}</button>
          )}
        </div>
      )}
      <Stroke id={`${id}-border`} title={`${title}: ${t('Borde')}`} none={t('Sin borde')} st={cur.line} onChange={(l) => set({ line: l })} color="#808080" />
    </fieldset>
  );
}

export function AreaFonts({ def, set }: { def: ChartSpec; set: (patch: Partial<ChartSpec>) => void }) {
  const [part, setPart] = useState<keyof ChartFonts>('chart');
  const fonts = def.fonts ?? {};
  const cur: TextFormat = fonts[part] ?? {};
  const setFont = (patch: Partial<TextFormat>) => {
    const next: TextFormat = { ...cur, ...patch };
    for (const k of Object.keys(next) as (keyof TextFormat)[]) if (next[k] === undefined || next[k] === '') delete next[k];
    const all: ChartFonts = { ...fonts, [part]: Object.keys(next).length ? next : undefined };
    for (const k of Object.keys(all) as (keyof ChartFonts)[]) if (all[k] === undefined) delete all[k];
    set({ fonts: Object.keys(all).length ? all : undefined });
  };
  return (
    <div className="nc-form" data-testid="area-fonts">
      <Area id="area-chart" title={t('Área del gráfico')} area={def.chartArea} fallback="#ffffff" onChange={(a) => set({ chartArea: a })} />
      <Area id="area-plot" title={t('Área de trazado')} area={def.plotArea} fallback="#ffffff" onChange={(a) => set({ plotArea: a })} />
      <fieldset className="nc-set">
        <legend>{t('Fuente')}</legend>
        <div className="nc-form__row">
          <label className="nc-field">
            <span>{t('Elemento')}</span>
            <select aria-label={t('Elemento de texto')} value={part} onChange={(e) => setPart(e.target.value as keyof ChartFonts)}>
              {PARTS.map(([k, l]) => (
                <option key={k} value={k}>{t(l)}</option>
              ))}
            </select>
          </label>
          <label className="nc-field">
            <span>{t('Fuente')}</span>
            <select aria-label={t('Tipo de letra')} value={cur.family ?? ''} onChange={(e) => setFont({ family: e.target.value || undefined })}>
              <option value="">{t('Automático')}</option>
              {FAMILIES.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>
          <label className="nc-field nc-field--narrow">
            <span>{t('Tamaño (pt)')}</span>
            <input type="number" min={4} max={96} step={0.5} aria-label={t('Tamaño de letra')} value={cur.size ?? ''} placeholder={t('Automático')} onChange={(e) => setFont({ size: num(e.target.value) })} />
          </label>
        </div>
        <div className="nc-form__row">
          <label className="nc-check">
            <input type="checkbox" checked={!!cur.bold} onChange={(e) => setFont({ bold: e.target.checked ? true : undefined })} />
            <span>{t('Negrita')}</span>
          </label>
          <label className="nc-check">
            <input type="checkbox" checked={!!cur.italic} onChange={(e) => setFont({ italic: e.target.checked ? true : undefined })} />
            <span>{t('Cursiva')}</span>
          </label>
          <label className="nc-field nc-field--narrow">
            <span>{t('Color del texto')}</span>
            <input type="color" aria-label={t('Color del texto')} value={cur.color ?? '#404040'} onChange={(e) => setFont({ color: e.target.value })} />
          </label>
          <button type="button" className="nc-points__reset" onClick={() => setFont({ family: undefined, size: undefined, bold: undefined, italic: undefined, color: undefined })}>{t('Restablecer')}</button>
        </div>
      </fieldset>
    </div>
  );
}
