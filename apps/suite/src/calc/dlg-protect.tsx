import { Button, Checkbox, Input } from '@fluentui/react-components';
import { DEFAULT_ALLOW, hasPassword, type ProtectAction } from '@suitenova/calc-engine';
import { t } from '@suitenova/core-ui';
import { useState } from 'react';
import type { CalcUI } from './commands';
import { Modal, field } from './modal';

const ACTIONS: [ProtectAction, string][] = [
  ['selectLocked', 'Seleccionar celdas bloqueadas'],
  ['selectUnlocked', 'Seleccionar celdas desbloqueadas'],
  ['formatCells', 'Dar formato a celdas'],
  ['formatColumns', 'Dar formato a columnas'],
  ['formatRows', 'Dar formato a filas'],
  ['insertColumns', 'Insertar columnas'],
  ['insertRows', 'Insertar filas'],
  ['insertHyperlinks', 'Insertar hipervínculos'],
  ['deleteColumns', 'Eliminar columnas'],
  ['deleteRows', 'Eliminar filas'],
  ['sort', 'Ordenar'],
  ['autoFilter', 'Usar autofiltro'],
  ['pivotTables', 'Usar tablas dinámicas'],
  ['objects', 'Modificar objetos (gráficos, imágenes, notas)'],
];

const bad = { color: 'var(--colorPaletteRedForeground1)' } as const;

/** Elegir contraseña y confirmarla; devuelve el error de coincidencia (o null). */
function PasswordFields({ pw, setPw, again, setAgain, id }: { pw: string; setPw: (s: string) => void; again: string; setAgain: (s: string) => void; id: string }) {
  return (
    <>
      <div style={field}>
        <label htmlFor={`${id}-pw`}>{t('Contraseña para desproteger (opcional)')}</label>
        <Input id={`${id}-pw`} type="password" autoFocus value={pw} onChange={(_e, v) => setPw(v.value)} />
      </div>
      {pw && (
        <div style={field}>
          <label htmlFor={`${id}-pw2`}>{t('Confirmar contraseña')}</label>
          <Input id={`${id}-pw2`} type="password" value={again} onChange={(_e, v) => setAgain(v.value)} aria-invalid={again !== pw} />
        </div>
      )}
    </>
  );
}

export function ProtectSheetDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const d = ui.doc;
  const [allow, setAllow] = useState<Partial<Record<ProtectAction, boolean>>>({ ...DEFAULT_ALLOW });
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const mismatch = pw !== '' && again !== pw;
  return (
    <Modal
      title={t('Proteger hoja')}
      onClose={onClose}
      width={520}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={mismatch}
            onClick={() => {
              d.commitIfEditing();
              d.prot.protectSheet(d.activeSheetId, allow, pw || null);
              onClose();
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <p>{t('Una hoja protegida impide cambiar las celdas bloqueadas. Desbloquee antes las celdas que se puedan editar (Formato de celdas, pestaña Protección).')}</p>
      <PasswordFields pw={pw} setPw={setPw} again={again} setAgain={setAgain} id="ps" />
      {mismatch && <p role="alert" style={bad}>{t('Las contraseñas no coinciden.')}</p>}
      <p style={{ marginBottom: 4 }}>{t('Permitir a todos los usuarios de esta hoja:')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
        {ACTIONS.map(([a, label]) => (
          <Checkbox key={a} label={t(label)} checked={!!allow[a]} onChange={(_e, v) => setAllow({ ...allow, [a]: v.checked === true })} />
        ))}
      </div>
    </Modal>
  );
}

export function ProtectBookDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const d = ui.doc;
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const mismatch = pw !== '' && again !== pw;
  return (
    <Modal
      title={t('Proteger estructura del libro')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={mismatch}
            onClick={() => {
              d.commitIfEditing();
              d.prot.protectWorkbook(pw || null);
              onClose();
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <p>{t('Con la estructura protegida no se pueden añadir, eliminar, mover, copiar, renombrar ni ocultar hojas.')}</p>
      <PasswordFields pw={pw} setPw={setPw} again={again} setAgain={setAgain} id="pb" />
      {mismatch && <p role="alert" style={bad}>{t('Las contraseñas no coinciden.')}</p>}
    </Modal>
  );
}

/** Pide la contraseña para quitar la protección de la hoja activa o del libro. */
export function UnprotectDialog({ ui, target, onClose }: { ui: CalcUI; target: 'sheet' | 'book'; onClose: () => void }) {
  const d = ui.doc;
  const [pw, setPw] = useState('');
  const [wrong, setWrong] = useState(false);
  const submit = () => {
    const ok = target === 'sheet' ? d.prot.unprotectSheet(d.activeSheetId, pw) : d.prot.unprotectWorkbook(pw);
    if (ok) onClose();
    else setWrong(true);
  };
  return (
    <Modal
      title={target === 'sheet' ? t('Quitar protección de la hoja') : t('Quitar protección del libro')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" onClick={submit}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="unp-pw">{t('Contraseña')}</label>
        <Input
          id="unp-pw"
          type="password"
          autoFocus
          value={pw}
          onChange={(_e, v) => {
            setPw(v.value);
            setWrong(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          aria-invalid={wrong}
        />
      </div>
      {wrong && <p role="alert" style={bad}>{t('La contraseña no es correcta.')}</p>}
    </Modal>
  );
}

export { hasPassword };
