import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { useState } from 'react';
import type { BaseCtl } from './ctl';
import { useRestorePage } from './dlg-sheet';

/** Indexes of a table (as Access's «Índices» window): create one over several fields, with or without duplicates, and drop it. */
export function IndexesDialog({ ctl, table, onClose }: { ctl: BaseCtl; table: string; onClose: () => void }) {
  useRestorePage();
  const db = ctl.db!;
  const [, setN] = useState(0);
  const [name, setName] = useState('');
  const [cols, setCols] = useState<string[]>([]);
  const [unique, setUnique] = useState(false);
  const [error, setError] = useState('');
  const fields = db.columns(table).map((c) => c.name);
  const list = db.indexes(table);
  const create = () => {
    try {
      db.createIndex(table, name || `ix_${table}_${cols.join('_')}`, cols, unique);
      setName('');
      setCols([]);
      setUnique(false);
      setError('');
      setN((x) => x + 1);
      ctl.touch();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog open modalType="modal" onOpenChange={(_e, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 640, width: '94vw' }}>
        <DialogBody>
          <DialogTitle>{`${t('Índices')}: ${table}`}</DialogTitle>
          <DialogContent>
            <div className="bs-dlgform">
              <table className="bs-idxlist" aria-label={t('Índices de la tabla')}>
                <thead>
                  <tr>
                    <th scope="col">{t('Nombre')}</th>
                    <th scope="col">{t('Campos')}</th>
                    <th scope="col">{t('Sin duplicados')}</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((i) => (
                    <tr key={i.name}>
                      <td>{i.name}</td>
                      <td>{i.columns.map((c) => c ?? t('(expresión)')).join(', ')}</td>
                      <td>{i.unique ? t('Sí') : t('No')}</td>
                      <td>
                        {i.auto ? (
                          <small>{t('Lo crea SQLite para una clave o un campo único')}</small>
                        ) : (
                          <Button
                            size="small"
                            aria-label={`${t('Eliminar el índice')} ${i.name}`}
                            onClick={() => {
                              try {
                                db.dropIndex(i.name);
                                setN((x) => x + 1);
                                ctl.touch();
                              } catch (e) {
                                setError((e as Error).message);
                              }
                            }}
                          >
                            {t('Eliminar')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!list.length && (
                    <tr>
                      <td colSpan={4}>{t('La tabla no tiene índices.')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              <fieldset style={{ border: '1px solid rgba(128,128,128,.4)', padding: 8 }}>
                <legend>{t('Índice nuevo')}</legend>
                <label>
                  {t('Nombre del índice')}
                  <input aria-label={t('Nombre del índice')} value={name} placeholder={`ix_${table}_…`} onChange={(e) => setName(e.target.value)} />
                </label>
                <div role="group" aria-label={t('Campos del índice')} style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {fields.map((f) => (
                    <label key={f} className="bs-check">
                      <input type="checkbox" checked={cols.includes(f)} onChange={(e) => setCols((c) => (e.target.checked ? [...c, f] : c.filter((x) => x !== f)))} /> {f}
                    </label>
                  ))}
                </div>
                <label className="bs-check">
                  <input type="checkbox" checked={unique} onChange={(e) => setUnique(e.target.checked)} /> {t('Sin duplicados')}
                </label>
                <Button appearance="primary" disabled={!cols.length} onClick={create}>
                  {t('Crear índice')}
                </Button>
              </fieldset>
              <p className="bs-note">{t('Los campos se indexan en el orden en que se marcan. Un índice sin duplicados rechaza valores repetidos (y no se puede crear si ya los hay). Se pueden deshacer con Ctrl+Z.')}</p>
              <p className="bs-note" role="alert" style={{ color: '#b3261e' }}>
                {error}
              </p>
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={onClose}>
              {t('Cerrar')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
