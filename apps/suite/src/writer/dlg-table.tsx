import { Button, Checkbox, Input, Select } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { ptToPx } from '@suitenova/writer-core';
import { TableMap } from 'prosemirror-tables';
import { useState } from 'react';
import type { WriterUI } from './commands';
import { Modal, field, focusDocSoon } from './dialogs';
import { findTable, setTableProps, sortTable, tableToText, textToTable, type Separator } from './table-tools';

const num = (s: string, fallback: number): number => {
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) ? v : fallback;
};

function run(ui: WriterUI, cmd: (s: import('prosemirror-state').EditorState, d?: (tr: import('prosemirror-state').Transaction) => void) => boolean) {
  const v = ui.ctl.view;
  if (v) cmd(v.state, v.dispatch);
}

// ------------------------------------------------------------------------------------------------ propiedades
export function TablePropsDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const cur = ui.ctl.state ? findTable(ui.ctl.state)?.node.attrs : undefined;
  const [align, setAlign] = useState<string>(cur?.align ?? 'left');
  const [borders, setBorders] = useState<boolean>(cur?.borders ?? true);
  const [color, setColor] = useState<string>(cur?.borderColor ?? '#000000');
  const [width, setWidth] = useState(String(cur?.borderWidth ?? 0.75));
  const [px, setPx] = useState(String(cur?.padding?.x ?? 5.4));
  const [py, setPy] = useState(String(cur?.padding?.y ?? 0));
  const [header, setHeader] = useState<boolean>(!!cur?.headerRow);
  const accept = () => {
    const bw = num(width, 0.75);
    const padding = num(px, 5.4) === 5.4 && num(py, 0) === 0 ? null : { x: Math.max(0, num(px, 5.4)), y: Math.max(0, num(py, 0)) };
    run(
      ui,
      setTableProps({
        align: align as 'left' | 'center' | 'right',
        borders,
        borderColor: color.toLowerCase() === '#000000' ? null : color,
        borderWidth: bw === 0.75 ? null : Math.min(6, Math.max(0.25, bw)),
        padding,
        headerRow: header,
      }),
    );
    onClose();
    focusDocSoon(ui);
  };
  return (
    <Modal
      title={t('Propiedades de la tabla')}
      onClose={onClose}
      width={460}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" onClick={accept}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={field}>
          <label htmlFor="tp-al">{t('Alineación de la tabla')}</label>
          <Select id="tp-al" value={align} onChange={(_e, v) => setAlign(v.value)}>
            <option value="left">{t('Izquierda')}</option>
            <option value="center">{t('Centrada')}</option>
            <option value="right">{t('Derecha')}</option>
          </Select>
        </div>
        <div style={{ ...field, alignContent: 'end' }}>
          <Checkbox label={t('Mostrar bordes')} checked={borders} onChange={(_e, v) => setBorders(!!v.checked)} />
        </div>
        <div style={field}>
          <label htmlFor="tp-bc">{t('Color del borde')}</label>
          <input id="tp-bc" type="color" value={color} disabled={!borders} onChange={(e) => setColor(e.target.value)} />
        </div>
        <div style={field}>
          <label htmlFor="tp-bw">{t('Grosor del borde (pt)')}</label>
          <Input id="tp-bw" type="number" step={0.25} min={0.25} max={6} disabled={!borders} value={width} onChange={(_e, v) => setWidth(v.value)} />
        </div>
        <div style={field}>
          <label htmlFor="tp-px">{t('Margen horizontal de celda (pt)')}</label>
          <Input id="tp-px" type="number" step={0.5} min={0} value={px} onChange={(_e, v) => setPx(v.value)} />
        </div>
        <div style={field}>
          <label htmlFor="tp-py">{t('Margen vertical de celda (pt)')}</label>
          <Input id="tp-py" type="number" step={0.5} min={0} value={py} onChange={(_e, v) => setPy(v.value)} />
        </div>
      </div>
      <Checkbox label={t('La primera fila es un encabezado (se repite en cada página al imprimir desde Word)')} checked={header} onChange={(_e, v) => setHeader(!!v.checked)} />
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ ordenar
export function TableSortDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const tbl = ui.ctl.state ? findTable(ui.ctl.state) : null;
  const width = tbl ? TableMap.get(tbl.node).width : 1;
  // columna de la celda donde está el cursor
  const startCol = (() => {
    const s = ui.ctl.state;
    if (!s || !tbl) return 0;
    const map = TableMap.get(tbl.node);
    const { $from } = s.selection;
    for (let d = $from.depth; d > tbl.depth; d--) {
      if ($from.node(d).type.spec.tableRole === 'cell' || $from.node(d).type.spec.tableRole === 'header_cell') {
        const i = map.map.indexOf($from.before(d) - tbl.pos - 1);
        return i < 0 ? 0 : i % map.width;
      }
    }
    return 0;
  })();
  const [col, setCol] = useState(startCol);
  const [dir, setDir] = useState('asc');
  const [mode, setMode] = useState<'text' | 'number'>('text');
  const [error, setError] = useState('');
  const accept = () => {
    const v = ui.ctl.view;
    if (!v) return;
    if (!sortTable(col, dir === 'asc', mode)(v.state)) return setError(t('No se puede ordenar una tabla con celdas combinadas verticalmente.'));
    sortTable(col, dir === 'asc', mode)(v.state, v.dispatch);
    onClose();
    focusDocSoon(ui);
  };
  return (
    <Modal
      title={t('Ordenar')}
      onClose={onClose}
      width={380}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" onClick={accept}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="so-col">{t('Ordenar por la columna')}</label>
        <Select id="so-col" value={String(col)} onChange={(_e, v) => setCol(Number(v.value))}>
          {Array.from({ length: width }, (_x, i) => (
            <option key={i} value={i}>
              {t('Columna')} {i + 1}
            </option>
          ))}
        </Select>
      </div>
      <div style={field}>
        <label htmlFor="so-type">{t('Tipo')}</label>
        <Select id="so-type" value={mode} onChange={(_e, v) => setMode(v.value as 'text' | 'number')}>
          <option value="text">{t('Texto')}</option>
          <option value="number">{t('Número')}</option>
        </Select>
      </div>
      <div style={field}>
        <label htmlFor="so-dir">{t('Orden')}</label>
        <Select id="so-dir" value={dir} onChange={(_e, v) => setDir(v.value)}>
          <option value="asc">{t('Ascendente')}</option>
          <option value="desc">{t('Descendente')}</option>
        </Select>
      </div>
      {tbl?.node.attrs.headerRow && <small>{t('La fila de encabezado no se ordena.')}</small>}
      {error && (
        <p role="alert" style={{ color: 'var(--colorPaletteRedForeground1)' }}>
          {error}
        </p>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ convertir
export function TableConvertDialog({ ui, toText, onClose }: { ui: WriterUI; toText: boolean; onClose: () => void }) {
  const [sep, setSep] = useState<Separator>('tab');
  const [error, setError] = useState('');
  const accept = () => {
    const v = ui.ctl.view;
    if (!v) return;
    const cmd = toText
      ? tableToText(sep === 'paragraph' ? 'tab' : sep)
      : textToTable(sep, ptToPx(ui.ctl.page.width - ui.ctl.page.marginLeft - ui.ctl.page.marginRight));
    if (!cmd(v.state)) return setError(toText ? t('Coloque el cursor dentro de una tabla.') : t('Seleccione párrafos de texto que no estén dentro de una tabla.'));
    cmd(v.state, v.dispatch);
    onClose();
    focusDocSoon(ui);
  };
  return (
    <Modal
      title={toText ? t('Convertir tabla en texto') : t('Convertir texto en tabla')}
      onClose={onClose}
      width={400}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" onClick={accept}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="cv-sep">{toText ? t('Separar el texto con') : t('Separar el texto en')}</label>
        <Select id="cv-sep" value={sep} onChange={(_e, v) => setSep(v.value as Separator)}>
          <option value="tab">{t('Tabulaciones')}</option>
          <option value="semicolon">{t('Puntos y coma')}</option>
          <option value="comma">{t('Comas')}</option>
          {!toText && <option value="paragraph">{t('Párrafos (una columna)')}</option>}
        </Select>
      </div>
      {error && (
        <p role="alert" style={{ color: 'var(--colorPaletteRedForeground1)' }}>
          {error}
        </p>
      )}
    </Modal>
  );
}
