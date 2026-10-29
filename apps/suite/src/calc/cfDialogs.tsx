import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Input, Select } from '@fluentui/react-components';
import { ICON_COUNTS, canonicalFormula, defaultIconThresholds, formatRect, localizeFormula, normRect, parseA1, parseFormula, parseInput, type CFFormat, type CFKind, type CFOperator, type CFRule, type FormulaLocale, type IconSetName, type Rect } from '@suitenova/calc-engine';
import { t } from '@suitenova/core-ui';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import type { CalcUI } from './commands';

export type CFPreset = 'gt' | 'lt' | 'between' | 'eq' | 'text' | 'dup' | 'top' | 'bottom' | 'above' | 'below' | 'new';

const field: React.CSSProperties = { display: 'grid', gap: 4, marginBottom: 10 };

export const FORMAT_PRESETS: Record<string, { label: string; format: CFFormat }> = {
  redFill: { label: 'Relleno rojo claro con texto rojo oscuro', format: { bg: '#ffc7ce', color: '#9c0006' } },
  yellowFill: { label: 'Relleno amarillo con texto amarillo oscuro', format: { bg: '#ffeb9c', color: '#9c5700' } },
  greenFill: { label: 'Relleno verde con texto verde oscuro', format: { bg: '#c6efce', color: '#006100' } },
  redLight: { label: 'Relleno rojo claro', format: { bg: '#ffc7ce' } },
  redText: { label: 'Texto rojo oscuro', format: { color: '#9c0006' } },
  boldRed: { label: 'Negrita roja', format: { bold: true, color: '#c00000' } },
};

export const SCALE_PRESETS: Record<string, { label: string; stops: string[] }> = {
  gyr: { label: 'Verde - Amarillo - Rojo', stops: ['#63be7b', '#ffeb84', '#f8696b'] },
  ryg: { label: 'Rojo - Amarillo - Verde', stops: ['#f8696b', '#ffeb84', '#63be7b'] },
  bwr: { label: 'Azul - Blanco - Rojo', stops: ['#5a8ac6', '#fcfcff', '#f8696b'] },
  wg: { label: 'Blanco - Verde', stops: ['#ffffff', '#63be7b'] },
  wr: { label: 'Blanco - Rojo', stops: ['#ffffff', '#f8696b'] },
  wb: { label: 'Blanco - Azul', stops: ['#ffffff', '#5a8ac6'] },
};

export const ICON_LABELS: Record<IconSetName, string> = { '3Arrows': '3 flechas', '3TrafficLights': '3 semáforos', '3Symbols': '3 símbolos', '3Flags': '3 banderas', '4Arrows': '4 flechas', '5Arrows': '5 flechas' };

const OPERATORS: [CFOperator, string][] = [
  ['greaterThan', 'es mayor que'],
  ['lessThan', 'es menor que'],
  ['greaterThanOrEqual', 'es mayor o igual que'],
  ['lessThanOrEqual', 'es menor o igual que'],
  ['equal', 'es igual a'],
  ['notEqual', 'es distinto de'],
  ['between', 'está entre'],
  ['notBetween', 'no está entre'],
];

export function parseRangesText(text: string): Rect[] | null {
  const parts = text.split(/[;,\s]+/).filter(Boolean);
  if (!parts.length) return null;
  const out: Rect[] = [];
  for (const part of parts) {
    const [a, b] = part.replace(/\$/g, '').split(':');
    const p = parseA1((a ?? '').toUpperCase());
    const q = parseA1((b ?? a ?? '').toUpperCase());
    if (!p || !q) return null;
    out.push(normRect({ r1: p.row, c1: p.col, r2: q.row, c2: q.col }));
  }
  return out;
}

export const rangesText = (rs: Rect[]): string => rs.map((r) => formatRect(normRect(r))).join(', ');

/** User text for a comparison value -> canonical formula text ("30", "\"abc\"", "$A$1"). */
function valueToFormula(text: string, locale: FormulaLocale): string | null {
  const s = text.trim();
  if (!s) return null;
  if (s.startsWith('=')) return canonicalFormula(s.slice(1), locale);
  const p = parseInput(s, { decimalComma: locale === 'es' });
  if (p.kind === 'number') return String(p.value);
  if (p.kind === 'bool') return p.value ? 'TRUE' : 'FALSE';
  return `"${s.replace(/"/g, '""')}"`;
}

function formulaToValue(f: string | undefined, locale: FormulaLocale): string {
  if (!f) return '';
  const m = /^"((?:[^"]|"")*)"$/.exec(f);
  if (m) return m[1]!.replace(/""/g, '"');
  if (/^-?\d+(\.\d+)?$/.test(f)) return locale === 'es' ? f.replace('.', ',') : f;
  return `=${localizeFormula(f, locale)}`;
}

/** Spanish description of a rule for the manager list. */
export function describeRule(r: CFRule, locale: FormulaLocale): string {
  const val = (f?: string) => formulaToValue(f, locale);
  switch (r.type) {
    case 'cellIs':
      return `${t('Valor de la celda')} ${t(OPERATORS.find(([o]) => o === r.operator)?.[1] ?? r.operator)} ${val(r.formula1)}${r.formula2 ? ` ${t('y')} ${val(r.formula2)}` : ''}`;
    case 'expression':
      return `${t('Fórmula')}: =${localizeFormula(r.formula, locale)}`;
    case 'text':
      return `${t({ contains: 'Contiene', notContains: 'No contiene', beginsWith: 'Empieza por', endsWith: 'Termina con' }[r.mode])} "${r.text}"`;
    case 'duplicates':
      return r.unique ? t('Valores únicos') : t('Valores duplicados');
    case 'top':
      return `${r.bottom ? t('Inferiores') : t('Superiores')} ${r.rank}${r.percent ? ' %' : ''}`;
    case 'average':
      return `${r.above ? t('Por encima del promedio') : t('Por debajo del promedio')}${r.equal ? ` ${t('o igual')}` : ''}`;
    case 'blanks':
      return r.not ? t('Celdas con valores') : t('Celdas en blanco');
    case 'errors':
      return r.not ? t('Sin errores') : t('Celdas con errores');
    case 'colorScale':
      return `${t('Escala de color')} (${r.stops.length})`;
    case 'dataBar':
      return t('Barra de datos');
    case 'iconSet':
      return `${t('Conjunto de iconos')}: ${t(ICON_LABELS[r.set])}`;
  }
}

function Modal({ title, onClose, children, actions, width = 520 }: { title: string; onClose: () => void; children: ReactNode; actions: ReactNode; width?: number }) {
  return (
    <Dialog open modalType="modal" onOpenChange={(_e, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: width, width: '92vw' }}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>{children}</DialogContent>
          <DialogActions>{actions}</DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

const FILTER_OPS: [string, string][] = [
  ['eq', 'es igual a'],
  ['ne', 'no es igual a'],
  ['gt', 'es mayor que'],
  ['ge', 'es mayor o igual que'],
  ['lt', 'es menor que'],
  ['le', 'es menor o igual que'],
  ['beginsWith', 'comienza por'],
  ['endsWith', 'termina con'],
  ['contains', 'contiene'],
  ['notContains', 'no contiene'],
];

// -------------------------------------------------------------------------------------------- custom filter
export function CustomFilterDialog({ ui, col, onClose }: { ui: CalcUI; col: number; onClose: () => void }) {
  const d = ui.doc;
  const cur = d.autoFilter?.columns[col]?.conditions;
  const [ops, setOps] = useState<[string, string]>([cur?.list[0]?.op ?? 'eq', cur?.list[1]?.op ?? 'eq']);
  const [vals, setVals] = useState<[string, string]>([cur?.list[0]?.value ?? '', cur?.list[1]?.value ?? '']);
  const [and, setAnd] = useState(cur?.and ?? true);
  const label = d.filterHeaderLabel(col);
  const list = [0, 1].map((i) => ({ op: ops[i]!, value: vals[i]! })).filter((c) => c.value !== '');
  return (
    <Modal
      title={t('Autofiltro personalizado')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!list.length}
            onClick={() => {
              d.setColumnFilter(col, { conditions: { list: list as never, and } });
              onClose();
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        {t('Mostrar las filas en las que')} <strong>{label}</strong>:
      </p>
      {[0, 1].map((i) => (
        <div key={i}>
          <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 8, marginBottom: 6 }}>
            <Select value={ops[i]} aria-label={t('Operador')} onChange={(_e, v) => setOps((o) => (i === 0 ? [v.value, o[1]] : [o[0], v.value]))}>
              {FILTER_OPS.map(([k, l]) => (
                <option key={k} value={k}>
                  {t(l)}
                </option>
              ))}
            </Select>
            <Input value={vals[i]} aria-label={t('Valor')} onChange={(_e, v) => setVals((o) => (i === 0 ? [v.value, o[1]] : [o[0], v.value]))} />
          </div>
          {i === 0 && (
            <div style={{ margin: '4px 0 8px' }}>
              <label style={{ marginRight: 16 }}>
                <input type="radio" name="andor" checked={and} onChange={() => setAnd(true)} /> {t('Y')}
              </label>
              <label>
                <input type="radio" name="andor" checked={!and} onChange={() => setAnd(false)} /> {t('O')}
              </label>
            </div>
          )}
        </div>
      ))}
      <small style={{ color: 'var(--colorNeutralForeground3)' }}>{t('Usa ? para un carácter y * para varios (en "es igual a").')}</small>
    </Modal>
  );
}

// -------------------------------------------------------------------------------------------- rule editor
type RuleType = 'cellIs' | 'text' | 'top' | 'average' | 'duplicates' | 'blanks' | 'errors' | 'expression' | 'colorScale' | 'dataBar' | 'iconSet';

const TYPE_LABELS: [RuleType, string][] = [
  ['cellIs', 'Aplicar formato a celdas cuyo valor…'],
  ['text', 'Aplicar formato a celdas que contienen texto'],
  ['top', 'Aplicar formato a valores superiores o inferiores'],
  ['average', 'Aplicar formato a valores por encima o por debajo del promedio'],
  ['duplicates', 'Aplicar formato a valores únicos o duplicados'],
  ['blanks', 'Aplicar formato a celdas con o sin valores'],
  ['errors', 'Aplicar formato a celdas con o sin errores'],
  ['expression', 'Usar una fórmula para determinar las celdas'],
  ['colorScale', 'Escala de color'],
  ['dataBar', 'Barra de datos'],
  ['iconSet', 'Conjunto de iconos'],
];

function initialFrom(rule: CFRule | undefined, preset: CFPreset | undefined) {
  const s = {
    type: 'cellIs' as RuleType,
    operator: 'greaterThan' as CFOperator,
    v1: '',
    v2: '',
    textMode: 'contains' as 'contains' | 'notContains' | 'beginsWith' | 'endsWith',
    text: '',
    bottom: false,
    rank: 10,
    percent: false,
    above: true,
    equal: false,
    unique: false,
    not: false,
    expr: '',
    scale: 'gyr',
    barColor: '#638ec6',
    showValue: true,
    iconSet: '3Arrows' as IconSetName,
    reverse: false,
    formatKey: 'redFill',
  };
  switch (preset) {
    case 'gt': s.operator = 'greaterThan'; break;
    case 'lt': s.operator = 'lessThan'; break;
    case 'between': s.operator = 'between'; break;
    case 'eq': s.operator = 'equal'; break;
    case 'text': s.type = 'text'; break;
    case 'dup': s.type = 'duplicates'; break;
    case 'top': s.type = 'top'; break;
    case 'bottom': s.type = 'top'; s.bottom = true; break;
    case 'above': s.type = 'average'; break;
    case 'below': s.type = 'average'; s.above = false; break;
  }
  void rule;
  return s;
}

export function CFRuleDialog({ ui, preset, editId, onClose }: { ui: CalcUI; preset?: CFPreset; editId?: string; onClose: () => void }) {
  const d = ui.doc;
  const loc = d.locale;
  const existing = editId ? d.condFormats.find((r) => r.id === editId) : undefined;
  const [s, setS] = useState(() => {
    const base = initialFrom(existing, preset);
    if (!existing) return base;
    const r = existing;
    const out = { ...base, type: (r.type === 'blanks' ? 'blanks' : r.type) as RuleType };
    if (r.type === 'cellIs') Object.assign(out, { operator: r.operator, v1: formulaToValue(r.formula1, loc), v2: formulaToValue(r.formula2, loc) });
    if (r.type === 'expression') out.expr = `=${localizeFormula(r.formula, loc)}`;
    if (r.type === 'text') Object.assign(out, { textMode: r.mode, text: r.text });
    if (r.type === 'duplicates') out.unique = !!r.unique;
    if (r.type === 'top') Object.assign(out, { rank: r.rank, percent: !!r.percent, bottom: !!r.bottom });
    if (r.type === 'average') Object.assign(out, { above: r.above, equal: !!r.equal });
    if (r.type === 'blanks' || r.type === 'errors') out.not = !!r.not;
    if (r.type === 'dataBar') Object.assign(out, { barColor: r.color, showValue: r.showValue !== false });
    if (r.type === 'iconSet') Object.assign(out, { iconSet: r.set, reverse: !!r.reverse, showValue: r.showValue !== false });
    const match = Object.entries(FORMAT_PRESETS).find(([, p]) => JSON.stringify(p.format) === JSON.stringify(r.format));
    out.formatKey = match ? match[0] : 'custom';
    return out;
  });
  const [rangeText, setRangeText] = useState(() => {
    if (existing) return rangesText(existing.ranges);
    const r = d.activeRange;
    const single = d.sel.ranges.length === 1 && r.r1 === r.r2 && r.c1 === r.c2;
    return rangesText(single ? [d.usedBlock() ?? r] : d.sel.ranges);
  });
  const [custom, setCustom] = useState<CFFormat>(existing?.format ?? { bg: '#ffc7ce', color: '#9c0006' });
  const [scaleColors, setScaleColors] = useState<string[]>(existing?.type === 'colorScale' ? existing.stops.map((x) => x.color) : SCALE_PRESETS.gyr!.stops);
  const [error, setError] = useState('');
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setS((p) => ({ ...p, [k]: v }));
  const isStyle = !['colorScale', 'dataBar', 'iconSet'].includes(s.type);
  const format: CFFormat = s.formatKey === 'custom' ? custom : FORMAT_PRESETS[s.formatKey]!.format;

  const build = (): Omit<CFRule, 'id' | 'priority'> | null => {
    const ranges = parseRangesText(rangeText);
    if (!ranges) {
      setError(t('El rango no es válido. Ejemplo: A1:B10'));
      return null;
    }
    const base = { ranges, ...(isStyle ? { format } : {}), ...(existing?.stopIfTrue ? { stopIfTrue: true } : {}) };
    let kind: CFKind;
    switch (s.type) {
      case 'cellIs': {
        const f1 = valueToFormula(s.v1, loc);
        const f2 = valueToFormula(s.v2, loc);
        if (!f1 || ((s.operator === 'between' || s.operator === 'notBetween') && !f2)) {
          setError(t('Escribe el valor de comparación.'));
          return null;
        }
        kind = { type: 'cellIs', operator: s.operator, formula1: f1, ...(f2 && (s.operator === 'between' || s.operator === 'notBetween') ? { formula2: f2 } : {}) };
        break;
      }
      case 'text':
        if (!s.text) return (setError(t('Escribe el texto que se debe buscar.')), null);
        kind = { type: 'text', mode: s.textMode, text: s.text };
        break;
      case 'top':
        if (!(s.rank >= 1)) return (setError(t('El número debe ser mayor que cero.')), null);
        kind = { type: 'top', rank: Math.floor(s.rank), ...(s.percent ? { percent: true } : {}), ...(s.bottom ? { bottom: true } : {}) };
        break;
      case 'average':
        kind = { type: 'average', above: s.above, ...(s.equal ? { equal: true } : {}) };
        break;
      case 'duplicates':
        kind = { type: 'duplicates', ...(s.unique ? { unique: true } : {}) };
        break;
      case 'blanks':
        kind = { type: 'blanks', ...(s.not ? { not: true } : {}) };
        break;
      case 'errors':
        kind = { type: 'errors', ...(s.not ? { not: true } : {}) };
        break;
      case 'expression': {
        const text = s.expr.trim().replace(/^=/, '');
        try {
          const canonical = canonicalFormula(text, loc);
          parseFormula(canonical);
          kind = { type: 'expression', formula: canonical };
        } catch {
          setError(t('La fórmula no es válida.'));
          return null;
        }
        break;
      }
      case 'colorScale': {
        const positions = scaleColors.length === 3 ? [{ type: 'min' as const }, { type: 'percentile' as const, value: 50 }, { type: 'max' as const }] : [{ type: 'min' as const }, { type: 'max' as const }];
        kind = { type: 'colorScale', stops: scaleColors.map((color, i) => ({ cfvo: positions[i]!, color })) };
        break;
      }
      case 'dataBar':
        kind = { type: 'dataBar', color: s.barColor, min: { type: 'min' }, max: { type: 'max' }, ...(s.showValue ? {} : { showValue: false }) };
        break;
      case 'iconSet':
        kind = { type: 'iconSet', set: s.iconSet, thresholds: defaultIconThresholds(s.iconSet), ...(s.reverse ? { reverse: true } : {}), ...(s.showValue ? {} : { showValue: false }) };
        break;
    }
    return { ...base, ...kind } as Omit<CFRule, 'id' | 'priority'>;
  };

  const save = () => {
    const rule = build();
    if (!rule) return;
    if (existing) d.updateCF(existing.id, rule as Partial<CFRule>, true);
    else d.addCF(rule);
    onClose();
  };

  return (
    <Modal title={existing ? t('Editar regla de formato') : t('Nueva regla de formato')} onClose={onClose} width={600} actions={<><Button onClick={onClose}>{t('Cancelar')}</Button><Button appearance="primary" onClick={save}>{t('Aceptar')}</Button></>}>
      <div style={field}>
        <label htmlFor="cf-type">{t('Tipo de regla')}</label>
        <Select id="cf-type" value={s.type} onChange={(_e, v) => set('type', v.value as RuleType)}>
          {TYPE_LABELS.map(([k, l]) => (
            <option key={k} value={k}>
              {t(l)}
            </option>
          ))}
        </Select>
      </div>
      <div style={field}>
        <label htmlFor="cf-range">{t('Se aplica al rango')}</label>
        <Input id="cf-range" value={rangeText} onChange={(_e, v) => { setRangeText(v.value); setError(''); }} />
      </div>

      {s.type === 'cellIs' && (
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 8, marginBottom: 10 }}>
          <Select value={s.operator} aria-label={t('Operador')} onChange={(_e, v) => set('operator', v.value as CFOperator)}>
            {OPERATORS.map(([k, l]) => (
              <option key={k} value={k}>
                {t(l)}
              </option>
            ))}
          </Select>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input style={{ flex: 1 }} value={s.v1} aria-label={t('Valor')} onChange={(_e, v) => { set('v1', v.value); setError(''); }} placeholder={t('Valor o =celda')} />
            {(s.operator === 'between' || s.operator === 'notBetween') && <Input style={{ flex: 1 }} value={s.v2} aria-label={t('Segundo valor')} onChange={(_e, v) => { set('v2', v.value); setError(''); }} />}
          </div>
        </div>
      )}
      {s.type === 'text' && (
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 8, marginBottom: 10 }}>
          <Select value={s.textMode} aria-label={t('Operador')} onChange={(_e, v) => set('textMode', v.value as typeof s.textMode)}>
            <option value="contains">{t('Contiene')}</option>
            <option value="notContains">{t('No contiene')}</option>
            <option value="beginsWith">{t('Empieza por')}</option>
            <option value="endsWith">{t('Termina con')}</option>
          </Select>
          <Input value={s.text} aria-label={t('Texto')} onChange={(_e, v) => { set('text', v.value); setError(''); }} />
        </div>
      )}
      {s.type === 'top' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <Select value={s.bottom ? 'bottom' : 'top'} aria-label={t('Superiores o inferiores')} onChange={(_e, v) => set('bottom', v.value === 'bottom')}>
            <option value="top">{t('Superiores')}</option>
            <option value="bottom">{t('Inferiores')}</option>
          </Select>
          <Input type="number" min={1} style={{ width: 90 }} value={String(s.rank)} aria-label={t('Cantidad')} onChange={(_e, v) => set('rank', Number(v.value))} />
          <Checkbox label={t('% del rango')} checked={s.percent} onChange={(_e, v) => set('percent', !!v.checked)} />
        </div>
      )}
      {s.type === 'average' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <Select value={s.above ? 'above' : 'below'} aria-label={t('Por encima o por debajo')} onChange={(_e, v) => set('above', v.value === 'above')}>
            <option value="above">{t('Por encima del promedio')}</option>
            <option value="below">{t('Por debajo del promedio')}</option>
          </Select>
          <Checkbox label={t('o igual')} checked={s.equal} onChange={(_e, v) => set('equal', !!v.checked)} />
        </div>
      )}
      {s.type === 'duplicates' && (
        <div style={field}>
          <Select value={s.unique ? 'unique' : 'dup'} aria-label={t('Duplicados o únicos')} onChange={(_e, v) => set('unique', v.value === 'unique')}>
            <option value="dup">{t('Valores duplicados')}</option>
            <option value="unique">{t('Valores únicos')}</option>
          </Select>
        </div>
      )}
      {(s.type === 'blanks' || s.type === 'errors') && (
        <div style={field}>
          <Select value={s.not ? 'not' : 'is'} aria-label={t('Condición')} onChange={(_e, v) => set('not', v.value === 'not')}>
            <option value="is">{s.type === 'blanks' ? t('Celdas en blanco') : t('Celdas con errores')}</option>
            <option value="not">{s.type === 'blanks' ? t('Celdas con valores') : t('Sin errores')}</option>
          </Select>
        </div>
      )}
      {s.type === 'expression' && (
        <div style={field}>
          <label htmlFor="cf-expr">{t('Fórmula (relativa a la primera celda del rango)')}</label>
          <Input id="cf-expr" value={s.expr} placeholder={loc === 'es' ? '=$B2>100' : '=$B2>100'} onChange={(_e, v) => { set('expr', v.value); setError(''); }} />
        </div>
      )}
      {s.type === 'colorScale' && (
        <div style={field}>
          <label>{t('Combinación de colores')}</label>
          <Select value={Object.entries(SCALE_PRESETS).find(([, p]) => p.stops.join() === scaleColors.join())?.[0] ?? 'custom'} aria-label={t('Combinación de colores')} onChange={(_e, v) => v.value !== 'custom' && setScaleColors(SCALE_PRESETS[v.value]!.stops)}>
            {Object.entries(SCALE_PRESETS).map(([k, p]) => (
              <option key={k} value={k}>
                {t(p.label)}
              </option>
            ))}
            <option value="custom">{t('Personalizada')}</option>
          </Select>
          <div style={{ display: 'flex', gap: 10 }}>
            {scaleColors.map((c, i) => (
              <input key={i} type="color" value={c} aria-label={`${t('Color')} ${i + 1}`} onChange={(e) => setScaleColors((all) => all.map((x, j) => (j === i ? e.target.value : x)))} />
            ))}
            <Button size="small" onClick={() => setScaleColors((all) => (all.length === 3 ? [all[0]!, all[2]!] : [all[0]!, '#ffeb84', all[1]!]))}>
              {scaleColors.length === 3 ? t('Usar 2 colores') : t('Usar 3 colores')}
            </Button>
          </div>
        </div>
      )}
      {s.type === 'dataBar' && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
          <label>{t('Color de la barra')}</label>
          <input type="color" value={s.barColor} aria-label={t('Color de la barra')} onChange={(e) => set('barColor', e.target.value)} />
          <Checkbox label={t('Mostrar el valor')} checked={s.showValue} onChange={(_e, v) => set('showValue', !!v.checked)} />
        </div>
      )}
      {s.type === 'iconSet' && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
          <Select value={s.iconSet} aria-label={t('Conjunto de iconos')} onChange={(_e, v) => set('iconSet', v.value as IconSetName)}>
            {(Object.keys(ICON_COUNTS) as IconSetName[]).map((k) => (
              <option key={k} value={k}>
                {t(ICON_LABELS[k])}
              </option>
            ))}
          </Select>
          <Checkbox label={t('Invertir orden')} checked={s.reverse} onChange={(_e, v) => set('reverse', !!v.checked)} />
          <Checkbox label={t('Mostrar el valor')} checked={s.showValue} onChange={(_e, v) => set('showValue', !!v.checked)} />
        </div>
      )}

      {isStyle && (
        <div style={field}>
          <label htmlFor="cf-fmt">{t('Formato')}</label>
          <Select id="cf-fmt" value={s.formatKey} onChange={(_e, v) => set('formatKey', v.value)}>
            {Object.entries(FORMAT_PRESETS).map(([k, p]) => (
              <option key={k} value={k}>
                {t(p.label)}
              </option>
            ))}
            <option value="custom">{t('Formato personalizado…')}</option>
          </Select>
          {s.formatKey === 'custom' && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <label>
                {t('Relleno')} <input type="color" value={custom.bg ?? '#ffffff'} aria-label={t('Relleno')} onChange={(e) => setCustom({ ...custom, bg: e.target.value })} />
              </label>
              <label>
                {t('Texto')} <input type="color" value={custom.color ?? '#000000'} aria-label={t('Color del texto')} onChange={(e) => setCustom({ ...custom, color: e.target.value })} />
              </label>
              <Checkbox label={t('Negrita')} checked={!!custom.bold} onChange={(_e, v) => setCustom({ ...custom, bold: !!v.checked || undefined })} />
              <Checkbox label={t('Cursiva')} checked={!!custom.italic} onChange={(_e, v) => setCustom({ ...custom, italic: !!v.checked || undefined })} />
            </div>
          )}
          <span
            aria-label={t('Vista previa')}
            style={{ display: 'inline-block', padding: '2px 10px', border: '1px solid var(--colorNeutralStroke2)', background: format.bg, color: format.color, fontWeight: format.bold ? 700 : 400, fontStyle: format.italic ? 'italic' : 'normal', width: 'fit-content' }}
          >
            AaBbCc
          </span>
        </div>
      )}
      {error && (
        <p role="alert" style={{ color: 'var(--colorPaletteRedForeground1)' }}>
          {error}
        </p>
      )}
    </Modal>
  );
}

// -------------------------------------------------------------------------------------------- manager
export function CFManagerDialog({ ui, onClose, onEdit }: { ui: CalcUI; onClose: () => void; onEdit: (id: string) => void }) {
  const d = ui.doc;
  useSyncExternalStore(d.subscribe, d.getVersion);
  const rules = [...d.condFormats].sort((a, b) => a.priority - b.priority);
  return (
    <Modal title={t('Administrador de reglas de formato condicional')} onClose={onClose} width={720} actions={<><Button onClick={() => { onClose(); ui.openDialog('cfRule', { preset: 'new' }); }}>{t('Nueva regla…')}</Button><Button appearance="primary" onClick={onClose}>{t('Cerrar')}</Button></>}>
      {rules.length === 0 ? (
        <p style={{ color: 'var(--colorNeutralForeground3)' }}>{t('Esta hoja no tiene reglas de formato condicional.')}</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th>{t('Regla (en orden de prioridad)')}</th>
              <th>{t('Formato')}</th>
              <th>{t('Se aplica a')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.map((r, i) => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--colorNeutralStroke2)' }}>
                <td style={{ padding: '6px 8px 6px 0' }}>{describeRule(r, d.locale)}</td>
                <td>
                  {r.format ? (
                    <span style={{ display: 'inline-block', padding: '0 8px', border: '1px solid var(--colorNeutralStroke2)', background: r.format.bg, color: r.format.color, fontWeight: r.format.bold ? 700 : 400, fontStyle: r.format.italic ? 'italic' : 'normal' }}>AaBbCc</span>
                  ) : r.type === 'colorScale' ? (
                    <span style={{ display: 'inline-block', width: 60, height: 14, border: '1px solid var(--colorNeutralStroke2)', background: `linear-gradient(90deg, ${r.stops.map((x) => x.color).join(',')})` }} />
                  ) : r.type === 'dataBar' ? (
                    <span style={{ display: 'inline-block', width: 40, height: 14, background: r.color }} />
                  ) : null}
                </td>
                <td>{rangesText(r.ranges)}</td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <Button size="small" appearance="subtle" disabled={i === 0} aria-label={t('Subir prioridad')} onClick={() => d.moveCF(r.id, -1)}>
                    ▲
                  </Button>
                  <Button size="small" appearance="subtle" disabled={i === rules.length - 1} aria-label={t('Bajar prioridad')} onClick={() => d.moveCF(r.id, 1)}>
                    ▼
                  </Button>
                  <Button size="small" appearance="subtle" onClick={() => { onClose(); onEdit(r.id); }}>
                    {t('Editar')}
                  </Button>
                  <Button size="small" appearance="subtle" onClick={() => d.deleteCF(r.id)}>
                    {t('Eliminar')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
