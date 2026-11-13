import { Button, Checkbox, Input, Select } from '@fluentui/react-components';
import { ERROR_KINDS, TREND_TYPES, type ChartDef, type ErrorBars, type ErrorKind, type TrendType, type Trendline } from '@suitenova/calc-engine';
import { t } from '@suitenova/core-ui';
import { field, row2 } from './modal';

export const TREND_LABEL: Record<TrendType, string> = {
  linear: 'Lineal',
  exp: 'Exponencial',
  log: 'Logarítmica',
  poly: 'Polinómica',
  power: 'Potencial',
  movingAvg: 'Media móvil',
};
export const ERROR_LABEL: Record<ErrorKind, string> = {
  fixed: 'Valor fijo',
  percent: 'Porcentaje',
  stdev: 'Desviación estándar',
  stderr: 'Error estándar',
  custom: 'Personalizado',
};

const num = (s: string): number | undefined => {
  const v = Number(s.replace(',', '.'));
  return s.trim() === '' || Number.isNaN(v) ? undefined : v;
};

/** ¿Admite este gráfico líneas de tendencia? (no apilados, ni circulares, radar, cotizaciones, superficie ni 3D, como en Excel) */
export const supportsTrend = (def: ChartDef): boolean => !def.stacked && !def.threeD && ['column', 'bar', 'line', 'area', 'scatter'].includes(def.type);
/** ¿Admite barras de error? (igual salvo que sí admite apilados) */
export const supportsErrorBars = (def: ChartDef): boolean => !def.threeD && ['column', 'bar', 'line', 'area', 'scatter'].includes(def.type);

function TrendFields({ tl, onChange, onRemove, id }: { tl: Trendline; onChange: (t: Trendline) => void; onRemove: () => void; id: string }) {
  return (
    <div style={{ border: '1px solid var(--colorNeutralStroke2)', borderRadius: 6, padding: 8, marginBottom: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'end' }}>
        <div style={field}>
          <label htmlFor={`${id}-t`}>{t('Tipo de tendencia')}</label>
          <Select id={`${id}-t`} value={tl.type} onChange={(_e, v) => onChange({ ...tl, type: v.value as TrendType })}>
            {TREND_TYPES.map((k) => (
              <option key={k} value={k}>
                {t(TREND_LABEL[k])}
              </option>
            ))}
          </Select>
        </div>
        <div style={field}>
          {tl.type === 'poly' && (
            <>
              <label htmlFor={`${id}-o`}>{t('Orden (2–6)')}</label>
              <Input id={`${id}-o`} type="number" value={String(tl.order ?? 2)} onChange={(_e, v) => onChange({ ...tl, order: Math.min(6, Math.max(2, Math.trunc(num(v.value) ?? 2))) })} />
            </>
          )}
          {tl.type === 'movingAvg' && (
            <>
              <label htmlFor={`${id}-p`}>{t('Períodos')}</label>
              <Input id={`${id}-p`} type="number" value={String(tl.period ?? 2)} onChange={(_e, v) => onChange({ ...tl, period: Math.max(2, Math.trunc(num(v.value) ?? 2)) })} />
            </>
          )}
        </div>
        <Button aria-label={t('Quitar línea de tendencia')} onClick={onRemove}>
          {t('Quitar')}
        </Button>
      </div>
      {tl.type !== 'movingAvg' && (
        <div style={row2}>
          <div style={field}>
            <label htmlFor={`${id}-f`}>{t('Prolongar hacia delante')}</label>
            <Input id={`${id}-f`} value={tl.forward === undefined ? '' : String(tl.forward)} placeholder="0" onChange={(_e, v) => onChange({ ...tl, forward: num(v.value) })} />
          </div>
          <div style={field}>
            <label htmlFor={`${id}-b`}>{t('Prolongar hacia atrás')}</label>
            <Input id={`${id}-b`} value={tl.backward === undefined ? '' : String(tl.backward)} placeholder="0" onChange={(_e, v) => onChange({ ...tl, backward: num(v.value) })} />
          </div>
        </div>
      )}
      {(tl.type === 'linear' || tl.type === 'exp') && (
        <div style={field}>
          <label htmlFor={`${id}-i`}>{t('Cortar el eje Y en')}</label>
          <Input id={`${id}-i`} value={tl.intercept === undefined ? '' : String(tl.intercept)} placeholder={t('Automático')} onChange={(_e, v) => onChange({ ...tl, intercept: num(v.value) })} />
        </div>
      )}
      <Checkbox label={t('Presentar ecuación en el gráfico')} checked={!!tl.dispEq} disabled={tl.type === 'movingAvg'} onChange={(_e, v) => onChange({ ...tl, dispEq: v.checked ? true : undefined })} />
      <Checkbox label={t('Presentar el valor R cuadrado en el gráfico')} checked={!!tl.dispR2} disabled={tl.type === 'movingAvg'} onChange={(_e, v) => onChange({ ...tl, dispR2: v.checked ? true : undefined })} />
    </div>
  );
}

const DIRECTIONS: [ErrorBars['direction'], string][] = [
  ['both', 'Ambos'],
  ['plus', 'Más'],
  ['minus', 'Menos'],
];

export function ErrorBarFields({ title, eb, onChange, id }: { title: string; eb: ErrorBars | undefined; onChange: (e: ErrorBars | undefined) => void; id: string }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={field}>
        <label htmlFor={`${id}-k`}>{title}</label>
        <Select
          id={`${id}-k`}
          value={eb?.kind ?? 'none'}
          onChange={(_e, v) => (v.value === 'none' ? onChange(undefined) : onChange({ direction: 'both', ...eb, kind: v.value as ErrorKind }))}
        >
          <option value="none">{t('Ninguna')}</option>
          {ERROR_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(ERROR_LABEL[k])}
            </option>
          ))}
        </Select>
      </div>
      {eb && (
        <div style={{ paddingLeft: 12 }}>
          <div style={row2}>
            <div style={field}>
              <label htmlFor={`${id}-d`}>{t('Dirección')}</label>
              <Select id={`${id}-d`} value={eb.direction} onChange={(_e, v) => onChange({ ...eb, direction: v.value as ErrorBars['direction'] })}>
                {DIRECTIONS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {t(label)}
                  </option>
                ))}
              </Select>
            </div>
            {eb.kind !== 'custom' && eb.kind !== 'stderr' && (
              <div style={field}>
                <label htmlFor={`${id}-v`}>{eb.kind === 'percent' ? t('Porcentaje (%)') : eb.kind === 'stdev' ? t('Número de desviaciones') : t('Valor')}</label>
                <Input id={`${id}-v`} value={eb.value === undefined ? '' : String(eb.value)} placeholder={eb.kind === 'percent' ? '5' : '1'} onChange={(_e, v) => onChange({ ...eb, value: num(v.value) })} />
              </div>
            )}
          </div>
          {eb.kind === 'custom' && (
            <div style={row2}>
              <div style={field}>
                <label htmlFor={`${id}-p`}>{t('Valores positivos (rango o lista)')}</label>
                <Input id={`${id}-p`} value={eb.plus ?? ''} placeholder="Hoja1!$C$2:$C$6" onChange={(_e, v) => onChange({ ...eb, plus: v.value || undefined })} />
              </div>
              <div style={field}>
                <label htmlFor={`${id}-m`}>{t('Valores negativos (rango o lista)')}</label>
                <Input id={`${id}-m`} value={eb.minus ?? ''} placeholder="1; 2; 3" onChange={(_e, v) => onChange({ ...eb, minus: v.value || undefined })} />
              </div>
            </div>
          )}
          <Checkbox label={t('Sin remate en los extremos')} checked={!!eb.noCap} onChange={(_e, v) => onChange({ ...eb, noCap: v.checked ? true : undefined })} />
        </div>
      )}
    </div>
  );
}

/** Pestaña «Análisis» del cuadro de formato de gráfico: tendencias y barras de error por serie. */
export function AnalysisTab({ def, names, setSeries }: { def: ChartDef; names: string[]; setSeries: (i: number, patch: Partial<ChartDef['series'][number]>) => void }) {
  const trend = supportsTrend(def);
  const bars = supportsErrorBars(def);
  return (
    <>
      <p>{t('Líneas de tendencia y barras de error de cada serie. Las tendencias no se pueden usar en gráficos apilados ni 3D.')}</p>
      {def.series.map((s, i) => (
        <fieldset key={i} style={{ border: '1px solid var(--colorNeutralStroke2)', borderRadius: 6, marginBottom: 8, padding: 8 }}>
          <legend>{names[i] ?? `${t('Serie')} ${i + 1}`}</legend>
          {trend && (
            <>
              {(s.trendlines ?? []).map((tl, j) => (
                <TrendFields
                  key={j}
                  id={`an-${i}-${j}`}
                  tl={tl}
                  onChange={(next) => setSeries(i, { trendlines: (s.trendlines ?? []).map((x, k) => (k === j ? next : x)) })}
                  onRemove={() => setSeries(i, { trendlines: (s.trendlines ?? []).filter((_x, k) => k !== j).length ? (s.trendlines ?? []).filter((_x, k) => k !== j) : undefined })}
                />
              ))}
              <Button onClick={() => setSeries(i, { trendlines: [...(s.trendlines ?? []), { type: 'linear' }] })}>{t('Agregar línea de tendencia')}</Button>
            </>
          )}
          {bars && (
            <>
              <ErrorBarFields id={`ay-${i}`} title={def.type === 'scatter' ? t('Barras de error verticales') : t('Barras de error')} eb={s.errY} onChange={(e) => setSeries(i, { errY: e })} />
              {def.type === 'scatter' && <ErrorBarFields id={`ax-${i}`} title={t('Barras de error horizontales')} eb={s.errX} onChange={(e) => setSeries(i, { errX: e })} />}
            </>
          )}
        </fieldset>
      ))}
    </>
  );
}
