import { Button } from '@fluentui/react-components';
import { FORM_STYLES, applyFieldKinds, buildFormLayout, type FormStyle } from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import { useState } from 'react';
import type { BaseCtl } from './ctl';
import { Dlg } from './dlg-sheet';

const STYLE_LABEL: Record<FormStyle, string> = {
  columnar: 'En columnas (un registro)',
  tabular: 'Tarjetas (registros uno bajo otro)',
  datasheet: 'Hoja de datos',
  split: 'Dividido (un registro y la hoja)',
};

/** The form wizard of Access: table, fields, and how the records are laid out. It builds an ordinary form that can be edited. */
export function FormWizardDialog({ ctl }: { ctl: BaseCtl }) {
  const db = ctl.db!;
  const tables = db.tableNames();
  const [table, setTable] = useState(tables[0] ?? '');
  const [fields, setFields] = useState<string[] | null>(null);
  const [style, setStyle] = useState<FormStyle>('columnar');
  const [caption, setCaption] = useState('');
  const cols = table ? db.columns(table) : [];
  const chosen = fields ?? cols.map((c) => c.name);
  const close = () => {
    ctl.xDialog = null;
    ctl.touch();
  };
  const make = () => {
    const layout = applyFieldKinds(buildFormLayout(cols, chosen, style, db, caption.trim() || undefined), db.getMeta(table).fields);
    close();
    ctl.newFormWith(table, layout);
  };
  return (
    <Dlg
      title={t('Asistente de formularios')}
      onClose={close}
      actions={
        <>
          <Button onClick={close}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!table || !chosen.length} onClick={make}>
            {t('Crear el formulario')}
          </Button>
        </>
      }
    >
      <div className="bs-dlgform">
        <label>
          {t('Tabla')}
          <select aria-label={t('Tabla del formulario')} value={table} onChange={(e) => (setTable(e.target.value), setFields(null))}>
            {tables.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <b>{t('Campos del formulario')}</b>
        <div role="group" aria-label={t('Campos del formulario')} style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {cols.map((c) => (
            <label key={c.name} className="bs-check">
              <input type="checkbox" checked={chosen.includes(c.name)} onChange={(e) => setFields(e.target.checked ? cols.map((x) => x.name).filter((n) => chosen.includes(n) || n === c.name) : chosen.filter((n) => n !== c.name))} /> {c.name}
            </label>
          ))}
        </div>
        <b>{t('Distribución')}</b>
        <div role="radiogroup" aria-label={t('Distribución')} style={{ display: 'grid', gap: 4 }}>
          {FORM_STYLES.map((s) => (
            <label key={s} className="bs-check">
              <input type="radio" name="fwstyle" checked={style === s} onChange={() => setStyle(s)} /> {t(STYLE_LABEL[s])}
            </label>
          ))}
        </div>
        <label>
          {t('Título')}
          <input aria-label={t('Título del formulario nuevo')} value={caption} placeholder={table} onChange={(e) => setCaption(e.target.value)} />
        </label>
      </div>
    </Dlg>
  );
}
