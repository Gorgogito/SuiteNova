import { Button, Checkbox, Input, Select, Tab, TabList } from '@fluentui/react-components';
import { DEFAULT_3D, SERIES_TYPES, type Chart3D, type ChartAxis, type ChartDef, type SeriesType } from '@suitenova/calc-engine';
import { t } from '@suitenova/core-ui';
import { useState } from 'react';
import type { CalcUI } from './commands';
import { chartData } from './chartOption';
import { AreaFonts } from '../chart/AreaFonts';
import { SeriesFormat } from '../chart/SeriesFormat';
import { AnalysisTab, supportsErrorBars, supportsTrend } from './dlg-chartfit';
import { Modal, field, row2 } from './modal';

const SERIES_LABEL: Record<SeriesType, string> = { column: 'Columna', line: 'Línea', area: 'Área', scatter: 'Puntos' };

function AxisFields({ title, axis, onChange, log = true }: { title: string; axis: ChartAxis; onChange: (a: ChartAxis) => void; log?: boolean }) {
  const numText = (v: number | undefined) => (v === undefined ? '' : String(v));
  const parse = (s: string): number | undefined => (s.trim() === '' || Number.isNaN(Number(s.replace(',', '.'))) ? undefined : Number(s.replace(',', '.')));
  return (
    <fieldset style={{ border: '1px solid var(--colorNeutralStroke2)', borderRadius: 6, marginBottom: 10, padding: 8 }}>
      <legend>{title}</legend>
      <div style={field}>
        <label>{t('Título del eje')}</label>
        <Input value={axis.title ?? ''} onChange={(_e, v) => onChange({ ...axis, title: v.value || undefined })} />
      </div>
      <div style={row2}>
        <div style={field}>
          <label>{t('Mínimo')}</label>
          <Input value={numText(axis.min)} placeholder={t('Automático')} onChange={(_e, v) => onChange({ ...axis, min: parse(v.value) })} />
        </div>
        <div style={field}>
          <label>{t('Máximo')}</label>
          <Input value={numText(axis.max)} placeholder={t('Automático')} onChange={(_e, v) => onChange({ ...axis, max: parse(v.value) })} />
        </div>
      </div>
      <div style={field}>
        <label>{t('Formato de número de las etiquetas (código)')}</label>
        <Input value={axis.format ?? ''} placeholder="#,##0.00" onChange={(_e, v) => onChange({ ...axis, format: v.value || undefined })} />
      </div>
      {log && <Checkbox label={t('Escala logarítmica')} checked={!!axis.log} onChange={(_e, v) => onChange({ ...axis, log: v.checked ? true : undefined })} />}
      <Checkbox label={t('Líneas de cuadrícula')} checked={axis.gridlines ?? false} onChange={(_e, v) => onChange({ ...axis, gridlines: !!v.checked })} />
      <Checkbox label={t('Valores en orden inverso')} checked={!!axis.reverse} onChange={(_e, v) => onChange({ ...axis, reverse: v.checked ? true : undefined })} />
    </fieldset>
  );
}

export function ChartFormatDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const d = ui.doc;
  const chart = d.chartById(d.selectedChart);
  const [def, setDef] = useState<ChartDef | null>(() => (chart ? structuredClone(chart) : null));
  const [tab, setTab] = useState('general');
  if (!chart || !def) return null;
  const set = (patch: Partial<ChartDef>) => setDef((x) => (x ? { ...x, ...patch } : x));
  const setSeries = (i: number, patch: Partial<ChartDef['series'][number]>) => setDef((x) => (x ? { ...x, series: x.series.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : x));
  const data = chartData(chart, d.wb, d.activeSheetId, d.locale);
  const cartesian = !['pie', 'doughnut', 'radar', 'stock', 'surface'].includes(def.type);
  const combinable = ['column', 'line', 'area', 'scatter'].includes(def.type);
  const threeD = def.threeD ?? null;
  const set3d = (patch: Partial<Chart3D>) => set({ threeD: { ...(def.threeD ?? DEFAULT_3D), ...patch } });
  const n = (s: string, min: number, max: number, fallback: number) => {
    const v = Number(s);
    return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
  };
  return (
    <Modal
      title={t('Formato del gráfico')}
      onClose={onClose}
      width={640}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            onClick={() => {
              const { id, ...rest } = def;
              void id;
              d.updateChart(chart.id, rest, 'Formato del gráfico');
              onClose();
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <TabList selectedValue={tab} onTabSelect={(_e, v) => setTab(String(v.value))} style={{ marginBottom: 12 }}>
        <Tab value="general">{t('General')}</Tab>
        {combinable && <Tab value="series">{t('Series')}</Tab>}
        {def.series.length > 0 && !['stock', 'surface', 'waterfall', 'funnel', 'histogram', 'boxwhisker'].includes(def.type) && <Tab value="format">{t('Formato de serie')}</Tab>}
        <Tab value="areas">{t('Áreas y fuentes')}</Tab>
        {cartesian && <Tab value="axes">{t('Ejes')}</Tab>}
        {(supportsTrend(def) || supportsErrorBars(def)) && <Tab value="analysis">{t('Análisis')}</Tab>}
        {(threeD || def.type === 'surface') && <Tab value="3d">{t('Giro 3D')}</Tab>}
        {(['radar', 'surface', 'stock', 'waterfall', 'funnel', 'histogram', 'boxwhisker'] as string[]).includes(def.type) && <Tab value="type">{t('Opciones del tipo')}</Tab>}
      </TabList>
      {tab === 'general' && (
        <>
          <div style={field}>
            <label htmlFor="cf-title">{t('Título')}</label>
            <Input id="cf-title" value={def.title ?? ''} onChange={(_e, v) => set({ title: v.value || undefined })} />
          </div>
          <Checkbox label={t('Mostrar leyenda')} checked={def.legend} onChange={(_e, v) => set({ legend: !!v.checked })} />
          {['column', 'bar', 'line', 'area'].includes(def.type) && (
            <>
              <Checkbox label={t('Apilado')} checked={!!def.stacked} onChange={(_e, v) => set({ stacked: v.checked ? true : undefined, percent: v.checked ? def.percent : undefined })} />
              <Checkbox label={t('Apilado al 100 %')} checked={!!def.percent} disabled={!def.stacked} onChange={(_e, v) => set({ percent: v.checked ? true : undefined })} />
            </>
          )}
          {['line', 'area'].includes(def.type) && <Checkbox label={t('Líneas suavizadas')} checked={!!def.smooth} onChange={(_e, v) => set({ smooth: v.checked ? true : undefined })} />}
        </>
      )}
      {tab === 'format' && <SeriesFormat def={def} names={data.series.map((s) => s.name)} categories={data.categories} set={set} setSeries={setSeries} />}
      {tab === 'areas' && <AreaFonts def={def} set={set} />}
      {tab === 'series' && (
        <>
          <p>{t('Cada serie puede dibujarse de un modo distinto y usar el eje secundario (a la derecha) para valores de otra escala.')}</p>
          {def.series.map((s, i) => (
            <fieldset key={i} style={{ border: '1px solid var(--colorNeutralStroke2)', borderRadius: 6, marginBottom: 8, padding: 8 }}>
              <legend>{data.series[i]?.name ?? `${t('Serie')} ${i + 1}`}</legend>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: 10, alignItems: 'end' }}>
                <div style={field}>
                  <label>{t('Tipo')}</label>
                  <Select
                    aria-label={`${t('Tipo de la serie')} ${i + 1}`}
                    value={s.type ?? (def.type === 'column' ? 'column' : def.type === 'area' ? 'area' : def.type === 'scatter' ? 'scatter' : 'line')}
                    onChange={(_e, v) => setSeries(i, { type: v.value as SeriesType })}
                  >
                    {SERIES_TYPES.map((k) => (
                      <option key={k} value={k}>
                        {t(SERIES_LABEL[k])}
                      </option>
                    ))}
                  </Select>
                </div>
                <Checkbox label={t('Eje secundario')} checked={!!s.secondary} onChange={(_e, v) => setSeries(i, { secondary: v.checked ? true : undefined })} />
                <div style={field}>
                  <label>{t('Color')}</label>
                  <input type="color" aria-label={`${t('Color de la serie')} ${i + 1}`} value={s.color ?? data.series[i]?.color ?? '#3b82c4'} onChange={(e) => setSeries(i, { color: e.target.value })} />
                </div>
              </div>
            </fieldset>
          ))}
        </>
      )}
      {tab === 'analysis' && <AnalysisTab def={def} names={data.series.map((s) => s.name)} setSeries={setSeries} />}
      {tab === 'axes' && (
        <>
          <AxisFields title={def.type === 'bar' ? t('Eje de categorías (vertical)') : t('Eje horizontal')} axis={def.axisX ?? {}} onChange={(a) => set({ axisX: a })} log={def.type === 'scatter'} />
          <AxisFields title={t('Eje de valores')} axis={def.axisY ?? {}} onChange={(a) => set({ axisY: a })} />
          {def.series.some((s) => s.secondary) && <AxisFields title={t('Eje de valores secundario')} axis={def.axisY2 ?? {}} onChange={(a) => set({ axisY2: a })} />}
        </>
      )}
      {tab === '3d' && (
        <>
          <p>{t('Posición desde la que se ve el gráfico.')}</p>
          <div style={row2}>
            <div style={field}>
              <label htmlFor="c3-x">{t('Rotación X (inclinación, grados)')}</label>
              <Input id="c3-x" type="number" value={String(def.threeD?.rotX ?? 15)} onChange={(_e, v) => set3d({ rotX: n(v.value, -90, 90, 15) })} />
            </div>
            <div style={field}>
              <label htmlFor="c3-y">{t('Rotación Y (giro, grados)')}</label>
              <Input id="c3-y" type="number" value={String(def.threeD?.rotY ?? 20)} onChange={(_e, v) => set3d({ rotY: n(v.value, 0, 360, 20) })} />
            </div>
            <div style={field}>
              <label htmlFor="c3-p">{t('Perspectiva (0–100)')}</label>
              <Input id="c3-p" type="number" disabled={!!def.threeD?.rightAngle} value={String(def.threeD?.perspective ?? 30)} onChange={(_e, v) => set3d({ perspective: n(v.value, 0, 100, 30) })} />
            </div>
            <div style={field}>
              <label htmlFor="c3-d">{t('Profundidad (% del ancho)')}</label>
              <Input id="c3-d" type="number" value={String(def.threeD?.depth ?? 100)} onChange={(_e, v) => set3d({ depth: n(v.value, 20, 2000, 100) })} />
            </div>
          </div>
          <Checkbox label={t('Ejes en ángulo recto')} checked={!!def.threeD?.rightAngle} disabled={def.type === 'surface' || def.type === 'pie'} onChange={(_e, v) => set3d({ rightAngle: !!v.checked })} />
          {['column', 'line', 'area'].includes(def.type) && <Checkbox label={t('Series en profundidad')} checked={!!def.threeD?.seriesDepth} disabled={!!def.stacked} onChange={(_e, v) => set3d({ seriesDepth: v.checked ? true : undefined })} />}
        </>
      )}
      {tab === 'type' && (
        <>
          {def.type === 'radar' && (
            <>
              <Checkbox label={t('Relleno')} checked={!!def.radar?.filled} onChange={(_e, v) => set({ radar: { ...def.radar, filled: v.checked ? true : undefined } })} />
              <Checkbox label={t('Marcadores')} checked={!!def.radar?.markers} onChange={(_e, v) => set({ radar: { ...def.radar, markers: v.checked ? true : undefined } })} />
            </>
          )}
          {def.type === 'surface' && (
            <>
              <Checkbox label={t('Estructura alámbrica')} checked={!!def.surface?.wireframe} onChange={(_e, v) => set({ surface: { ...def.surface, wireframe: v.checked ? true : undefined } })} />
              <Checkbox label={t('Contorno (vista desde arriba)')} checked={!!def.surface?.contour} onChange={(_e, v) => set({ surface: { ...def.surface, contour: v.checked ? true : undefined } })} />
            </>
          )}
          {def.type === 'waterfall' && (
            <>
              <p>{t('Los puntos que son totales parten de cero y fijan el acumulado; los demás suman o restan al anterior.')}</p>
              <div style={field}>
                <label htmlFor="wf-tot">{t('Puntos que son totales (números separados por comas, el primero es 1)')}</label>
                <Input
                  id="wf-tot"
                  placeholder="1, 6"
                  value={(def.waterfall?.totals ?? []).map((i) => i + 1).join(', ')}
                  onChange={(_e, v) => {
                    const totals = v.value
                      .split(/[;,\s]+/)
                      .map((x) => Math.trunc(Number(x)) - 1)
                      .filter((x) => Number.isFinite(x) && x >= 0);
                    set({ waterfall: { ...def.waterfall, totals: totals.length ? [...new Set(totals)] : undefined } });
                  }}
                />
              </div>
              <Checkbox label={t('Líneas de conexión')} checked={def.waterfall?.connectors !== false} onChange={(_e, v) => set({ waterfall: { ...def.waterfall, connectors: v.checked ? undefined : false } })} />
            </>
          )}
          {def.type === 'funnel' && <p>{t('El embudo dibuja los valores de la primera serie en el orden en que aparecen en las celdas.')}</p>}
          {def.type === 'histogram' && (
            <>
              <div style={field}>
                <label htmlFor="hg-mode">{t('Clases')}</label>
                <Select
                  id="hg-mode"
                  value={def.histogram?.binWidth !== undefined ? 'width' : def.histogram?.binCount !== undefined ? 'count' : 'auto'}
                  onChange={(_e, v) => set({ histogram: { ...def.histogram, binWidth: v.value === 'width' ? (def.histogram?.binWidth ?? 10) : undefined, binCount: v.value === 'count' ? (def.histogram?.binCount ?? 5) : undefined } })}
                >
                  <option value="auto">{t('Automáticas')}</option>
                  <option value="width">{t('Por ancho de clase')}</option>
                  <option value="count">{t('Por número de clases')}</option>
                </Select>
              </div>
              <div style={row2}>
                {def.histogram?.binWidth !== undefined && (
                  <div style={field}>
                    <label htmlFor="hg-w">{t('Ancho de clase')}</label>
                    <Input id="hg-w" type="number" value={String(def.histogram.binWidth)} onChange={(_e, v) => set({ histogram: { ...def.histogram, binWidth: Number(v.value) > 0 ? Number(v.value) : undefined } })} />
                  </div>
                )}
                {def.histogram?.binCount !== undefined && (
                  <div style={field}>
                    <label htmlFor="hg-n">{t('Número de clases')}</label>
                    <Input id="hg-n" type="number" value={String(def.histogram.binCount)} onChange={(_e, v) => set({ histogram: { ...def.histogram, binCount: Number(v.value) >= 1 ? Math.trunc(Number(v.value)) : undefined } })} />
                  </div>
                )}
              </div>
              <div style={row2}>
                <div style={field}>
                  <label htmlFor="hg-o">{t('Clase de desbordamiento (valores mayores que)')}</label>
                  <Input id="hg-o" value={def.histogram?.overflow === undefined ? '' : String(def.histogram.overflow)} placeholder={t('Ninguna')} onChange={(_e, v) => set({ histogram: { ...def.histogram, overflow: v.value.trim() === '' || Number.isNaN(Number(v.value)) ? undefined : Number(v.value) } })} />
                </div>
                <div style={field}>
                  <label htmlFor="hg-u">{t('Clase de subdesbordamiento (valores menores o iguales que)')}</label>
                  <Input id="hg-u" value={def.histogram?.underflow === undefined ? '' : String(def.histogram.underflow)} placeholder={t('Ninguna')} onChange={(_e, v) => set({ histogram: { ...def.histogram, underflow: v.value.trim() === '' || Number.isNaN(Number(v.value)) ? undefined : Number(v.value) } })} />
                </div>
              </div>
              <div style={field}>
                <label htmlFor="hg-c">{t('Intervalos')}</label>
                <Select id="hg-c" value={def.histogram?.closed ?? 'right'} onChange={(_e, v) => set({ histogram: { ...def.histogram, closed: v.value === 'left' ? 'left' : undefined } })}>
                  <option value="right">{t('Cerrados por la derecha (a, b]')}</option>
                  <option value="left">{t('Cerrados por la izquierda [a, b)')}</option>
                </Select>
              </div>
            </>
          )}
          {def.type === 'boxwhisker' && (
            <>
              <div style={field}>
                <label htmlFor="bw-q">{t('Cálculo de los cuartiles')}</label>
                <Select id="bw-q" value={def.boxwhisker?.inclusive ? 'inclusive' : 'exclusive'} onChange={(_e, v) => set({ boxwhisker: { ...def.boxwhisker, inclusive: v.value === 'inclusive' ? true : undefined } })}>
                  <option value="exclusive">{t('Mediana exclusiva')}</option>
                  <option value="inclusive">{t('Mediana inclusiva')}</option>
                </Select>
              </div>
              <Checkbox label={t('Mostrar marcadores de la media')} checked={def.boxwhisker?.mean !== false} onChange={(_e, v) => set({ boxwhisker: { ...def.boxwhisker, mean: v.checked ? undefined : false } })} />
              <Checkbox label={t('Mostrar puntos atípicos')} checked={def.boxwhisker?.outliers !== false} onChange={(_e, v) => set({ boxwhisker: { ...def.boxwhisker, outliers: v.checked ? undefined : false } })} />
              <Checkbox label={t('Mostrar puntos internos')} checked={!!def.boxwhisker?.inner} onChange={(_e, v) => set({ boxwhisker: { ...def.boxwhisker, inner: v.checked ? true : undefined } })} />
            </>
          )}
          {def.type === 'stock' && <p>{t('El orden de las series determina su papel: {order}.', { order: (def.stock?.kind ?? 'hlc').split('').join(' · ').toUpperCase() })}</p>}
        </>
      )}
    </Modal>
  );
}
