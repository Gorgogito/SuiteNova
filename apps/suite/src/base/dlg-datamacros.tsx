import { Button } from '@fluentui/react-components';
import { DATA_EVENTS, basic, type DataEvent } from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import { useState } from 'react';
import type { BaseCtl } from './ctl';
import { Dlg } from './dlg-sheet';
import { MacroStepsEditor } from './MacroStepsEditor';

type MacroDef = basic.MacroDef;

const LABEL: Record<DataEvent, string> = {
  beforeChange: 'Antes de cambiar',
  beforeDelete: 'Antes de eliminar',
  afterInsert: 'Después de insertar',
  afterUpdate: 'Después de actualizar',
  afterDelete: 'Después de eliminar',
};
const HINT: Record<DataEvent, string> = {
  beforeChange: 'Al guardar un registro nuevo o modificado. Con «Establecer campo» cambia el registro que se guarda; con «Provocar un error» lo rechaza. Los valores nuevos se leen [Campo] y los anteriores [Old.Campo].',
  beforeDelete: 'Antes de eliminar un registro. «Provocar un error» impide la eliminación. Los valores del registro se leen [Campo].',
  afterInsert: 'Después de insertar un registro. Sus valores se leen [Campo].',
  afterUpdate: 'Después de modificar un registro. Los valores nuevos se leen [Campo] y los anteriores [Old.Campo].',
  afterDelete: 'Después de eliminar un registro. Sus valores se leen [Campo].',
};

/** The data macros of a table: macros that run when a record is inserted, changed or deleted, whoever does it. They are saved with the table. */
export function DataMacrosDialog({ ctl, table, onClose }: { ctl: BaseCtl; table: string; onClose: () => void }) {
  const db = ctl.db!;
  const meta = db.getMeta(table);
  const [draft, setDraft] = useState<Partial<Record<DataEvent, MacroDef>>>(() => ({ ...(meta.dataMacros as Partial<Record<DataEvent, MacroDef>> | undefined) }));
  const [ev, setEv] = useState<DataEvent>('afterInsert');
  const [error, setError] = useState('');
  const def = draft[ev] ?? { steps: [] };
  const count = (e: DataEvent) => draft[e]?.steps.length ?? 0;
  const save = () => {
    try {
      db.setMeta(table, { ...meta, dataMacros: draft });
      ctl.touch();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dlg
      title={`${t('Macros de datos')}: ${table}`}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" onClick={save}>
            {t('Guardar las macros de datos')}
          </Button>
        </>
      }
    >
      <p className="bs-hint">{t('Se ejecutan cuando se cambia un registro de la tabla desde un formulario, una consulta, una importación o el código, y se pueden deshacer junto con el cambio.')}</p>
      {!ctl.contentEnabled && <p className="bs-hint">{t('El contenido activo está deshabilitado en este archivo: las macros de datos no se ejecutan hasta que lo habilite.')}</p>}
      {error && (
        <p role="alert" className="bs-error">
          {error}
        </p>
      )}
      <div className="bs-dmevents" role="tablist" aria-label={t('Eventos de la tabla')}>
        {DATA_EVENTS.map((e) => (
          <button key={e} type="button" role="tab" aria-selected={ev === e} className={`bs-btn${ev === e ? ' is-on' : ''}`} onClick={() => setEv(e)}>
            {t(LABEL[e])}
            {count(e) ? ` (${count(e)})` : ''}
          </button>
        ))}
      </div>
      <p className="bs-hint">{t(HINT[ev])}</p>
      <MacroStepsEditor ctl={ctl} def={def} data onChange={(d) => setDraft({ ...draft, [ev]: d })} />
    </Dlg>
  );
}
