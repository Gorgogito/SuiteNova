import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { cellsOf, mapCells, setColWidth, setRowHeight, splitCell } from '@suitenova/slides-core';
import { useState } from 'react';
import type { SlidesUI } from './commands';
import { Modal } from './Dialogs';

type P = { ui: SlidesUI; onClose: () => void };
const PT_PER_CM = 28.3465;
const cm = (pt: number) => Math.round((pt / PT_PER_CM) * 100) / 100;
const pt = (v: number) => Math.round(v * PT_PER_CM * 100) / 100;

const Actions = ({ onClose, ok, apply }: { onClose: () => void; ok: boolean; apply: () => void }) => (
  <>
    <Button onClick={onClose}>{t('Cancelar')}</Button>
    <Button appearance="primary" disabled={!ok} onClick={apply}>{t('Aceptar')}</Button>
  </>
);

// ------------------------------------------------------------------------------------------------ split cells

export function TableSplitDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const [cols, setCols] = useState(2);
  const [rows, setRows] = useState(1);
  const ok = cols >= 1 && rows >= 1 && cols <= 20 && rows <= 20 && cols * rows > 1;
  const apply = () => {
    const s = c.cellSelection;
    if (s) c.tableApply('Dividir celdas', (tb) => splitCell(tb, s.range.r1, s.range.c1, rows, cols), (tb) => [s.range.r1, s.range.c1, Math.min(tb.rows.length - 1, s.range.r1), s.range.c1]);
    onClose();
  };
  return (
    <Modal title={t('Dividir celdas')} onClose={onClose} actions={<Actions onClose={onClose} ok={ok} apply={apply} />}>
      <div className="sl-form">
        <div className="sl-form__row">
          <label className="sl-field">
            <span>{t('Número de columnas')}</span>
            <input type="number" min={1} max={20} aria-label={t('Número de columnas')} value={cols} onChange={(e) => setCols(Math.round(Number(e.target.value)))} />
          </label>
          <label className="sl-field">
            <span>{t('Número de filas')}</span>
            <input type="number" min={1} max={20} aria-label={t('Número de filas')} value={rows} onChange={(e) => setRows(Math.round(Number(e.target.value)))} />
          </label>
        </div>
        <p className="sl-note">{t('Si la celda no está combinada, se agregan columnas o filas a la tabla y las celdas vecinas se extienden sobre ellas.')}</p>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ cell properties

export function TableCellDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const s = c.cellSelection;
  const t0 = c.table!;
  const first = s ? cellsOf(t0, s.range)[0]?.cell : t0.rows[0]!.cells[0]!;
  const [anchor, setAnchor] = useState<'t' | 'ctr' | 'b'>(first?.anchor ?? 't');
  const [m, setM] = useState({ l: cm(first?.marL ?? 7.2), r: cm(first?.marR ?? 7.2), t: cm(first?.marT ?? 3.6), b: cm(first?.marB ?? 3.6) });
  const num = (label: string, k: 'l' | 'r' | 't' | 'b') => (
    <label className="sl-field">
      <span>{label}</span>
      <input type="number" step={0.05} min={0} aria-label={label} value={m[k]} onChange={(e) => setM({ ...m, [k]: Number(e.target.value) })} />
    </label>
  );
  const apply = () => {
    c.tableApply('Propiedades de celda', (tb, rg) => mapCells(tb, rg, (cell) => ({ ...cell, anchor, marL: pt(m.l), marR: pt(m.r), marT: pt(m.t), marB: pt(m.b) })));
    onClose();
  };
  return (
    <Modal title={t('Opciones de celda')} onClose={onClose} actions={<Actions onClose={onClose} ok apply={apply} />}>
      <div className="sl-form">
        <label className="sl-field">
          <span>{t('Alineación vertical')}</span>
          <select aria-label={t('Alineación vertical de la celda')} value={anchor} onChange={(e) => setAnchor(e.target.value as 't' | 'ctr' | 'b')}>
            <option value="t">{t('Arriba')}</option>
            <option value="ctr">{t('En el medio')}</option>
            <option value="b">{t('Abajo')}</option>
          </select>
        </label>
        <fieldset className="sl-fieldset">
          <legend>{t('Márgenes de la celda (cm)')}</legend>
          <div className="sl-form__row">
            {num(t('Superior'), 't')}
            {num(t('Inferior'), 'b')}
            {num(t('Izquierdo'), 'l')}
            {num(t('Derecho'), 'r')}
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ row height and column width

export function TableSizeDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const tb = c.table!;
  const rg = c.cellSelection?.range ?? { r1: 0, c1: 0, r2: tb.rows.length - 1, c2: tb.cols.length - 1 };
  const nRows = rg.r2 - rg.r1 + 1;
  const nCols = rg.c2 - rg.c1 + 1;
  const [h, setH] = useState(cm(tb.rows.slice(rg.r1, rg.r2 + 1).reduce((a, r) => a + r.h, 0) / nRows));
  const [w, setW] = useState(cm(tb.cols.slice(rg.c1, rg.c2 + 1).reduce((a, x) => a + x, 0) / nCols));
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const mark = (k: string) => setTouched((o) => new Set([...o, k]));
  const apply = () => {
    c.tableApply('Tamaño de celda', (x) => {
      let out = x;
      if (touched.has('h')) for (let r = rg.r1; r <= rg.r2; r++) out = setRowHeight(out, r, pt(h));
      if (touched.has('w')) for (let k = rg.c1; k <= rg.c2; k++) out = setColWidth(out, k, pt(w), false);
      return out;
    });
    onClose();
  };
  return (
    <Modal title={t('Tamaño de celda')} onClose={onClose} actions={<Actions onClose={onClose} ok={h > 0 && w > 0} apply={apply} />}>
      <div className="sl-form">
        <div className="sl-form__row">
          <label className="sl-field">
            <span>{nRows > 1 ? t('Alto de las filas (cm)') : t('Alto de la fila (cm)')}</span>
            <input type="number" step={0.05} min={0.4} aria-label={t('Alto de fila')} value={h} onChange={(e) => (setH(Number(e.target.value)), mark('h'))} />
          </label>
          <label className="sl-field">
            <span>{nCols > 1 ? t('Ancho de las columnas (cm)') : t('Ancho de la columna (cm)')}</span>
            <input type="number" step={0.05} min={0.4} aria-label={t('Ancho de columna')} value={w} onChange={(e) => (setW(Number(e.target.value)), mark('w'))} />
          </label>
        </div>
        <p className="sl-note">{t('Una fila crece sola si su texto no cabe; el alto es el mínimo.')}</p>
      </div>
    </Modal>
  );
}
