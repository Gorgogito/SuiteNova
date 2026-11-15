import { Button } from '@fluentui/react-components';
import { duplicatesSql, unmatchedSql } from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import { useState } from 'react';
import type { BaseCtl } from './ctl';
import { Dlg } from './dlg-sheet';

/** The query wizards of Access: find duplicates and find unmatched records. They open an ordinary query in SQL view and run it. */
export function QueryWizardDialog({ ctl, kind }: { ctl: BaseCtl; kind: 'dups' | 'unmatched' }) {
  const db = ctl.db!;
  const tables = db.tableNames();
  const [a, setA] = useState(tables[0] ?? '');
  const [aField, setAField] = useState('');
  const [b, setB] = useState(tables[1] ?? tables[0] ?? '');
  const [bField, setBField] = useState('');
  const [fields, setFields] = useState<string[]>([]);
  const [show, setShow] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const colsA = a ? db.columns(a).map((c) => c.name) : [];
  const colsB = b ? db.columns(b).map((c) => c.name) : [];
  const close = () => {
    ctl.xDialog = null;
    ctl.touch();
  };
  const toggle = (set: (f: (x: string[]) => string[]) => void, name: string, on: boolean) => set((x) => (on ? [...x, name] : x.filter((n) => n !== name)));
  const make = () => {
    try {
      const sql = kind === 'dups' ? duplicatesSql(a, fields, show) : unmatchedSql(a, aField || colsA[0]!, b, bField || colsB[0]!, show);
      close();
      ctl.newQuery(sql);
      // like the Access wizards, it shows the result straight away
      setTimeout(() => document.querySelector<HTMLButtonElement>('.bs-query .bs-btn--primary')?.click(), 120);
    } catch (e) {
      setMsg(t((e as Error).message));
    }
  };
  const checks = (list: string[], chosen: string[], set: (f: (x: string[]) => string[]) => void, label: string) => (
    <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {list.map((c) => (
        <label key={c} className="bs-check">
          <input type="checkbox" checked={chosen.includes(c)} onChange={(e) => toggle(set, c, e.target.checked)} /> {c}
        </label>
      ))}
    </div>
  );
  return (
    <Dlg
      title={kind === 'dups' ? t('Buscar registros duplicados') : t('Buscar registros no coincidentes')}
      onClose={close}
      actions={
        <>
          <Button onClick={close}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!a || (kind === 'dups' && !fields.length)} onClick={make}>
            {t('Crear la consulta')}
          </Button>
        </>
      }
    >
      <div className="bs-dlgform">
        <label>
          {kind === 'dups' ? t('Tabla') : t('Tabla cuyos registros se muestran')}
          <select aria-label={kind === 'dups' ? t('Tabla') : t('Tabla cuyos registros se muestran')} value={a} onChange={(e) => (setA(e.target.value), setFields([]), setShow([]), setAField(''))}>
            {tables.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        {kind === 'dups' ? (
          <>
            <b>{t('Campos que pueden repetirse')}</b>
            {checks(colsA, fields, setFields, t('Campos que pueden repetirse'))}
          </>
        ) : (
          <>
            <label>
              {t('Campo de esa tabla')}
              <select aria-label={t('Campo de esa tabla')} value={aField || colsA[0]} onChange={(e) => setAField(e.target.value)}>
                {colsA.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label>
              {t('Tabla con la que se compara')}
              <select aria-label={t('Tabla con la que se compara')} value={b} onChange={(e) => (setB(e.target.value), setBField(''))}>
                {tables.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label>
              {t('Campo de la otra tabla')}
              <select aria-label={t('Campo de la otra tabla')} value={bField || colsB[0]} onChange={(e) => setBField(e.target.value)}>
                {colsB.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <b>{t('Campos que se muestran (si no eliges ninguno, todos)')}</b>
        {checks(colsA, show, setShow, t('Campos que se muestran (si no eliges ninguno, todos)'))}
        <p className="bs-note" role="alert">{msg}</p>
        <p className="bs-note">{t('La consulta se abre en vista SQL y se ejecuta; se puede cambiar y guardar.')} {kind === 'dups' ? t('Un valor vacío no cuenta como repetido.') : ''}</p>
      </div>
    </Dlg>
  );
}
