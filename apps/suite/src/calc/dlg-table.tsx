import { Button, Checkbox, Input, Select } from '@fluentui/react-components';
import { formatA1, normRect, parseA1, type PivotDef, type Rect, type SparklineType, type TableDef } from '@suitenova/calc-engine';
import { t } from '@suitenova/core-ui';
import { useState } from 'react';
import type { CalcUI } from './commands';
import { Modal, field } from './modal';

/** "A1:C5", "$A$1:$C$5" or "Hoja!A1:C5" -> a rectangle (and the sheet name if one was written). */
export function parseRangeText(text: string): { rect: Rect; sheet?: string } | null {
  const m = /^\s*(?:(?:'((?:[^']|'')+)'|([^!']+))!)?\s*(\$?[A-Za-z]{1,3}\$?\d+)(?::(\$?[A-Za-z]{1,3}\$?\d+))?\s*$/.exec(text);
  if (!m) return null;
  const a = parseA1(m[3]!.toUpperCase());
  const b = parseA1((m[4] ?? m[3]!).toUpperCase());
  if (!a || !b) return null;
  return { rect: normRect({ r1: a.row, c1: a.col, r2: b.row, c2: b.col }), sheet: m[1] ? m[1].replace(/''/g, "'") : m[2] };
}

export const rectText = (r: Rect): string => (r.r1 === r.r2 && r.c1 === r.c2 ? formatA1(r.r1, r.c1, true, true) : `${formatA1(r.r1, r.c1, true, true)}:${formatA1(r.r2, r.c2, true, true)}`);

export function TableCreateDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const d = ui.doc;
  const block = d.x.defaultBlock();
  const [range, setRange] = useState(block ? rectText(block) : '');
  const [header, setHeader] = useState<boolean>(true);
  const [error, setError] = useState('');
  const parsed = parseRangeText(range);
  const go = () => {
    if (!parsed) return setError(t('La referencia no es válida.'));
    const err = d.x.createTable(header, parsed.rect);
    if (err) setError(err);
    else onClose();
  };
  return (
    <Modal title={t('Crear tabla')} onClose={onClose} actions={<><Button onClick={onClose}>{t('Cancelar')}</Button><Button appearance="primary" disabled={!parsed} onClick={go}>{t('Aceptar')}</Button></>}>
      <div style={field}>
        <label htmlFor="tbl-range">{t('¿Dónde están los datos de la tabla?')}</label>
        <Input id="tbl-range" autoFocus value={range} onChange={(_e, v) => { setRange(v.value); setError(''); }} onKeyDown={(e) => e.key === 'Enter' && parsed && go()} aria-invalid={!parsed} />
      </div>
      <Checkbox label={t('La tabla tiene encabezados')} checked={header} onChange={(_e, v) => setHeader(!!v.checked)} />
      {error && <p role="alert" style={{ color: 'var(--colorPaletteRedForeground1)' }}>{error}</p>}
    </Modal>
  );
}

export function TableResizeDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const d = ui.doc;
  const cur = d.x.tableAtActive()?.table;
  const [range, setRange] = useState(cur ? rectText(normRect(cur.ref)) : '');
  const [error, setError] = useState('');
  const parsed = parseRangeText(range);
  if (!cur) return null;
  return (
    <Modal
      title={t('Cambiar tamaño de la tabla')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!parsed}
            onClick={() => {
              const err = d.x.resizeTable(cur.id, parsed!.rect);
              if (err) setError(err);
              else onClose();
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <p>{t('Seleccione el nuevo rango de datos de la tabla. La fila de encabezados debe seguir en la misma fila.')}</p>
      <div style={field}>
        <label htmlFor="tbl-rs">{t('Rango de datos')}</label>
        <Input id="tbl-rs" autoFocus value={range} onChange={(_e, v) => { setRange(v.value); setError(''); }} aria-invalid={!parsed} />
      </div>
      {error && <p role="alert" style={{ color: 'var(--colorPaletteRedForeground1)' }}>{error}</p>}
    </Modal>
  );
}

// -------------------------------------------------------------------------------------------- sparklines
export function SparklineDialog({ ui, type, onClose }: { ui: CalcUI; type: SparklineType; onClose: () => void }) {
  const d = ui.doc;
  const sel = normRect(d.activeRange);
  const [data, setData] = useState(rectText(sel));
  const [loc, setLoc] = useState('');
  const [error, setError] = useState('');
  const pd = parseRangeText(data);
  const pl = parseRangeText(loc);
  const names: Record<SparklineType, string> = { line: 'Línea', column: 'Columna', winloss: 'Ganancia o pérdida' };
  return (
    <Modal
      title={`${t('Crear minigráficos')}: ${t(names[type])}`}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!pd || !pl}
            onClick={() => {
              const err = d.x.insertSparklines(type, pd!.rect, pl!.rect);
              if (err) setError(err);
              else onClose();
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <p>{t('Elija los datos que quiere analizar y dónde se colocarán los minigráficos.')}</p>
      <div style={field}>
        <label htmlFor="sp-data">{t('Rango de datos')}</label>
        <Input id="sp-data" autoFocus value={data} onChange={(_e, v) => { setData(v.value); setError(''); }} aria-invalid={!pd} />
      </div>
      <div style={field}>
        <label htmlFor="sp-loc">{t('Rango de ubicación')}</label>
        <Input id="sp-loc" value={loc} placeholder="$F$2:$F$10" onChange={(_e, v) => { setLoc(v.value); setError(''); }} aria-invalid={loc !== '' && !pl} />
      </div>
      {error && <p role="alert" style={{ color: 'var(--colorPaletteRedForeground1)' }}>{error}</p>}
    </Modal>
  );
}

// -------------------------------------------------------------------------------------------- slicers
/** The fields a slicer can filter for the table or pivot at the cursor. */
export function slicerSource(ui: CalcUI): { target: { kind: 'pivot' | 'table'; id: string }; fields: string[]; name: string } | null {
  const d = ui.doc;
  const pv = d.x.pivotAtActive();
  if (pv) return { target: { kind: 'pivot', id: pv.pivot.id }, fields: d.wb.pivotData(pv.pivot)?.headers ?? [], name: pv.pivot.name };
  const tb = d.x.tableAtActive();
  if (tb) return { target: { kind: 'table', id: tb.table.id }, fields: tb.table.columns.map((c) => c.name), name: tb.table.name };
  return null;
}

export function SlicerDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const d = ui.doc;
  const src = slicerSource(ui);
  const [picked, setPicked] = useState<string[]>([]);
  if (!src) return null;
  return (
    <Modal
      title={t('Insertar segmentaciones')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!picked.length}
            onClick={() => {
              for (const f of picked) d.x.insertSlicer(src.target, f);
              onClose();
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <p>{t('Campos de {name}', { name: src.name })}</p>
      <div role="group" aria-label={t('Campos')} style={{ maxHeight: 260, overflow: 'auto', display: 'grid', gap: 2 }}>
        {src.fields.map((f) => (
          <Checkbox key={f} label={f} checked={picked.includes(f)} onChange={(_e, v) => setPicked(v.checked ? [...picked, f] : picked.filter((x) => x !== f))} />
        ))}
      </div>
    </Modal>
  );
}

// -------------------------------------------------------------------------------------------- table options (rename, style)
export function TableNameField({ ui, table }: { ui: CalcUI; table: TableDef }) {
  const [name, setName] = useState(table.name);
  const [error, setError] = useState('');
  return (
    <label className="nv-field" style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
      {t('Nombre de la tabla')}
      <input
        className="nv-select"
        style={{ width: 130 }}
        value={name}
        aria-invalid={!!error}
        title={error || t('Nombre de la tabla')}
        onChange={(e) => {
          setName(e.target.value);
          setError('');
        }}
        onBlur={() => {
          if (name === table.name) return;
          const err = ui.doc.x.renameTable(table.id, name.trim());
          if (err) {
            setError(err);
            window.alert(err);
            setName(table.name);
          }
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
    </label>
  );
}

export function SelectLike({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: [string, string][]; label: string }) {
  return (
    <Select aria-label={label} value={value} onChange={(_e, v) => onChange(v.value)}>
      {options.map(([k, l]) => (
        <option key={k} value={k}>
          {l}
        </option>
      ))}
    </Select>
  );
}

export type { PivotDef };
