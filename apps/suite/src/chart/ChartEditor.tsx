import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { CHART_COLORS, type ChartGrid, type ChartSpec } from '@suitenova/chart-core';
import { useMemo } from 'react';
import { buildChart, type ChartDraft } from './draft';
import { ChartPicture } from './ChartPicture';
import { CHART_PRESETS } from './presets';
import './messages';
import './chart.css';

/*
 * El cuadro de datos y tipo de un gráfico de Slides o de Writer: el tipo (cualquiera de los de Calc), el título, la leyenda y la
 * rejilla de datos, con una vista previa. Lo usan los dos productos; cada uno pone el cuadro y guarda el resultado a su manera.
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

export function ChartEditor({ draft, onChange, base, accents = CHART_COLORS }: { draft: ChartDraft; onChange: (d: ChartDraft) => void; base?: ChartSpec; accents?: string[] }) {
  const built = useBuilt(draft, base);
  const cells = draft.cells;
  const scatter = CHART_PRESETS.find((p) => p.id === draft.preset)?.type === 'scatter';
  const setCell = (r: number, k: number, v: string) => onChange({ ...draft, cells: cells.map((row, i) => (i === r ? row.map((x, j) => (j === k ? v : x)) : row)) });
  const addRow = () => onChange({ ...draft, cells: [...cells, cells[0]!.map(() => '')] });
  const addCol = () => onChange({ ...draft, cells: cells.map((row, i) => [...row, i === 0 ? `${t('Serie')} ${row.length}` : '']) });
  const delRow = () => onChange({ ...draft, cells: cells.length > 2 ? cells.slice(0, -1) : cells });
  const delCol = () => onChange({ ...draft, cells: cells[0]!.length > 2 ? cells.map((row) => row.slice(0, -1)) : cells });

  return (
    <div className="nc-form">
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
      <div className="nc-form__body">
        <div className="nc-form__data">
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
