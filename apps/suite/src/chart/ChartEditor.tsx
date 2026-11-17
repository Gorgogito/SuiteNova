import { Button, Tab, TabList } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { CHART_COLORS, type ChartGrid, type ChartSeries, type ChartSpec } from '@suitenova/chart-core';
import { useMemo, useState } from 'react';
import { AreaFonts } from './AreaFonts';
import { buildChart, type ChartDraft } from './draft';
import { ChartPicture } from './ChartPicture';
import { CHART_ELEMENTS, ELEMENT_GROUPS, applyElement } from './elements';
import { CHART_PRESETS } from './presets';
import { SeriesFormat } from './SeriesFormat';
import { CHART_STYLES, COLOR_PALETTES, applyPalette, applyStyle, paletteColors, paletteOf } from './styles';
import './messages';
import './chart.css';

/*
 * El cuadro de un gráfico de Slides o de Writer: los datos y el tipo, los elementos (título, ejes, etiquetas, leyenda, tabla de datos),
 * el formato de las series y de los puntos, las áreas y las fuentes, y los colores y estilos; con una vista previa. Lo usan los dos
 * productos; cada uno pone el cuadro y guarda el resultado a su manera.
 */

const GROUPS: [string, string][] = [
  ['column', 'Columnas'],
  ['bar', 'Barras'],
  ['line', 'Líneas'],
  ['area', 'Áreas'],
  ['pie', 'Circular y anillos'],
  ['scatter', 'Dispersión (XY)'],
  ['radar', 'Radar'],
  ['stock', 'Cotizaciones'],
  ['surface', 'Superficie'],
  ['combo', 'Combinados'],
  ['stats', 'Estadísticos'],
];

/** El gráfico y la rejilla que saldrán del borrador, o el motivo por el que no pueden salir. */
export const useBuilt = (draft: ChartDraft, base?: ChartSpec): { spec: ChartSpec; grid: ChartGrid } | string => useMemo(() => buildChart(draft, base), [draft, base]);

/** Los elementos cuya casilla es de elegir una opción (y no de activar o quitar). */
const radio = (id: string) => /^(legend|table|labelsNone|labelsShow|labels\.)/.test(id);

type TabId = 'data' | 'elements' | 'series' | 'areas' | 'styles';

export function ChartEditor({ draft, onChange, base, onBase, accents = CHART_COLORS }: { draft: ChartDraft; onChange: (d: ChartDraft) => void; base?: ChartSpec; onBase?: (c: ChartSpec) => void; accents?: string[] }) {
  const built = useBuilt(draft, base);
  const [tab, setTab] = useState<TabId>('data');
  const cells = draft.cells;
  const scatter = CHART_PRESETS.find((p) => p.id === draft.preset)?.type === 'scatter';
  const ok = typeof built !== 'string';
  const setCell = (r: number, k: number, v: string) => onChange({ ...draft, cells: cells.map((row, i) => (i === r ? row.map((x, j) => (j === k ? v : x)) : row)) });
  const addRow = () => onChange({ ...draft, cells: [...cells, cells[0]!.map(() => '')] });
  const addCol = () => onChange({ ...draft, cells: cells.map((row, i) => [...row, i === 0 ? `${t('Serie')} ${row.length}` : '']) });
  const delRow = () => onChange({ ...draft, cells: cells.length > 2 ? cells.slice(0, -1) : cells });
  const delCol = () => onChange({ ...draft, cells: cells[0]!.length > 2 ? cells.map((row) => row.slice(0, -1)) : cells });

  /** El gráfico cambiado por un panel de formato vuelve al borrador: el título y la leyenda al borrador, lo demás a la base. */
  const commit = (next: ChartSpec) => {
    onBase?.(next);
    onChange({ ...draft, title: next.title ?? '', legend: next.legend });
  };
  const spec = ok ? built.spec : null;
  const names = cells[0]!.slice(1).map((n, i) => n || `${t('Serie')} ${i + 1}`);
  const categories = cells.slice(1).map((r) => r[0] ?? '');
  const pointCount = ok ? Math.max(0, built.grid.length - 1) : 0;
  const patchSpec = (p: Partial<ChartSpec>) => spec && commit({ ...spec, ...p });
  const patchSeries = (i: number, p: Partial<ChartSeries>) => spec && commit({ ...spec, series: spec.series.map((s, j) => (j === i ? { ...s, ...p } : s)) });

  return (
    <div className="nc-form">
      <TabList selectedValue={tab} onTabSelect={(_e, v) => setTab(v.value as TabId)} size="small">
        <Tab value="data">{t('Datos')}</Tab>
        <Tab value="elements" disabled={!ok}>{t('Elementos')}</Tab>
        <Tab value="series" disabled={!ok}>{t('Formato de serie')}</Tab>
        <Tab value="areas" disabled={!ok}>{t('Áreas y fuentes')}</Tab>
        <Tab value="styles" disabled={!ok}>{t('Estilos y colores')}</Tab>
      </TabList>
      <div className="nc-form__body">
        <div className="nc-form__data">
          {tab === 'data' && (
            <>
              <div className="nc-form__row">
                <label className="nc-field">
                  <span>{t('Tipo de gráfico')}</span>
                  <select value={draft.preset} onChange={(e) => onChange({ ...draft, preset: e.target.value })} aria-label={t('Tipo de gráfico')}>
                    {GROUPS.map(([g, label]) => (
                      <optgroup key={g} label={t(label)}>
                        {CHART_PRESETS.filter((p) => p.group === g).map((p) => (
                          <option key={p.id} value={p.id}>{t(p.label)}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label className="nc-field">
                  <span>{t('Título del gráfico')}</span>
                  <input value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} />
                </label>
                <label className="nc-check">
                  <input type="checkbox" checked={draft.legend} onChange={(e) => onChange({ ...draft, legend: e.target.checked })} />
                  <span>{t('Mostrar leyenda')}</span>
                </label>
              </div>
              <div className="nc-sheet" role="grid" aria-label={t('Datos del gráfico')}>
                <table>
                  <thead>
                    <tr>
                      <th aria-hidden="true" />
                      {cells[0]!.map((h, k) => (
                        <th key={k}>
                          {k === 0 ? <span>{scatter ? t('Valores X') : t('Categorías')}</span> : <input aria-label={t('Nombre de la serie {n}', { n: k })} value={h} onChange={(e) => setCell(0, k, e.target.value)} />}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cells.slice(1).map((row, i) => (
                      <tr key={i}>
                        <th scope="row">{i + 1}</th>
                        {row.map((v, k) => (
                          <td key={k}>
                            <input aria-label={t('Fila {r}, columna {c}', { r: i + 1, c: k + 1 })} value={v} inputMode={k === 0 && !scatter ? 'text' : 'decimal'} onChange={(e) => setCell(i + 1, k, e.target.value)} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="nc-form__row">
                <Button size="small" onClick={addRow}>{t('Agregar fila')}</Button>
                <Button size="small" onClick={delRow} disabled={cells.length <= 2}>{t('Quitar la última fila')}</Button>
                <Button size="small" onClick={addCol}>{t('Agregar serie')}</Button>
                <Button size="small" onClick={delCol} disabled={cells[0]!.length <= 2}>{t('Quitar la última serie')}</Button>
              </div>
            </>
          )}

          {tab === 'elements' && spec && (
            <div className="nc-elements" role="group" aria-label={t('Elementos del gráfico')}>
              {ELEMENT_GROUPS.map((g) => (
                <fieldset key={g} className="nc-set">
                  <legend>{t(g)}</legend>
                  {CHART_ELEMENTS.filter((e) => e.group === g).map((e) => (
                    <label key={e.id} className="nc-check">
                      <input type={radio(e.id) ? 'radio' : 'checkbox'} name={radio(e.id) ? `nc-el-${g}` : undefined} disabled={!e.enabled(spec)} checked={e.checked(spec)} onChange={() => commit(applyElement(spec, e.id))} />
                      <span>{t(e.label)}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          )}

          {tab === 'series' && spec && <SeriesFormat def={spec} names={names} categories={categories} set={patchSpec} setSeries={patchSeries} />}

          {tab === 'areas' && spec && <AreaFonts def={spec} set={patchSpec} />}

          {tab === 'styles' && spec && (
            <div className="nc-form">
              <fieldset className="nc-set">
                <legend>{t('Cambiar colores')}</legend>
                <div className="nc-gallery" role="group" aria-label={t('Cambiar colores')}>
                  {COLOR_PALETTES.map((p) => {
                    const on = paletteOf(spec, pointCount) === p.id;
                    return (
                      <button key={p.id} type="button" className={`nc-gallery__item${on ? ' is-on' : ''}`} aria-pressed={on} title={t(p.label)} onClick={() => commit(applyPalette(spec, p.id, pointCount))}>
                        <span className="nc-swatches">
                          {paletteColors(p.id, 5).map((c, i) => (
                            <i key={i} style={{ background: c }} />
                          ))}
                        </span>
                        <span>{t(p.label)}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <fieldset className="nc-set">
                <legend>{t('Estilos rápidos')}</legend>
                <div className="nc-gallery" role="group" aria-label={t('Estilos rápidos')}>
                  {CHART_STYLES.map((s) => (
                    <button key={s.id} type="button" className="nc-gallery__item" title={t(s.description)} onClick={() => commit(applyStyle(spec, s.id))}>
                      <span>{t(s.label)}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
          )}
        </div>
        <div className="nc-preview">
          {typeof built === 'string' ? (
            <p role="alert" className="nc-preview__error">{built}</p>
          ) : (
            <ChartPicture spec={built.spec} grid={built.grid} width={320} height={230} accents={accents} palette={{ text: '#333333', grid: '#dddddd', bg: '#ffffff' }} label={t('Vista previa')} />
          )}
        </div>
      </div>
    </div>
  );
}
