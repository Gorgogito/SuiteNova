import { Button } from '@fluentui/react-components';
import type { CompactReport } from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import { useState } from 'react';
import type { BaseCtl } from './ctl';
import { Dlg } from './dlg-sheet';

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`);

/** What compact and repair did: how much smaller the file is and what the check found. */
export function CompactDialog({ ctl, report }: { ctl: BaseCtl; report: CompactReport }) {
  const close = () => {
    ctl.xDialog = null;
    ctl.touch();
  };
  const ok = report.integrity.length === 1 && report.integrity[0] === 'ok';
  return (
    <Dlg
      title={t('Compactar y reparar')}
      onClose={close}
      actions={
        <Button appearance="primary" onClick={close}>
          {t('Cerrar')}
        </Button>
      }
    >
      <div className="bs-dlgform" role="status" aria-label={t('Resultado de compactar y reparar')}>
        <p>
          {t('Tamaño antes: {a}. Tamaño ahora: {b}.', { a: size(report.sizeBefore), b: size(report.sizeAfter) })}{' '}
          {report.sizeAfter < report.sizeBefore ? t('Se recuperaron {n}.', { n: size(report.sizeBefore - report.sizeAfter) }) : t('No había espacio libre que recuperar.')}
        </p>
        <p>{ok ? (report.repaired ? t('Se encontró un problema en los índices y se reconstruyeron: el archivo está sano.') : t('Comprobación de integridad: el archivo está sano.')) : `${t('Quedan problemas que no se pudieron reparar:')} ${report.integrity.slice(0, 8).join(' · ')}`}</p>
        {report.foreignKeyProblems > 0 && <p>{t('Hay {n} registros sin correspondencia en la tabla relacionada (se pueden buscar con el asistente «Buscar no coincidentes»).', { n: report.foreignKeyProblems })}</p>}
        <p className="bs-hint">{t('Puede deshacer los cambios de datos anteriores: compactar no cambia los datos.')}</p>
      </div>
    </Dlg>
  );
}

/** Ask for the password of an encrypted file, or choose the one the database will be saved with. */
export function PasswordDialog({ mode, name, onOk, onCancel }: { mode: 'set' | 'open'; name?: string; onOk: (password: string) => Promise<string | null> | string | null | void; onCancel: () => void }) {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!pw) return setError(t('Escriba una contraseña.'));
    if (mode === 'set' && pw !== again) return setError(t('Las contraseñas no coinciden.'));
    setBusy(true);
    try {
      const err = await onOk(pw);
      if (err) setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dlg
      title={mode === 'set' ? t('Cifrar con contraseña') : `${t('Archivo cifrado')}${name ? `: ${name}` : ''}`}
      onClose={onCancel}
      actions={
        <>
          <Button onClick={onCancel}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={busy} onClick={() => void go()}>
            {mode === 'set' ? t('Cifrar') : t('Abrir')}
          </Button>
        </>
      }
    >
      <div className="bs-dlgform">
        {mode === 'set' && <p className="bs-hint">{t('El archivo se guardará cifrado (AES-256) y solo se podrá abrir con esta contraseña. Si la olvida, no hay forma de recuperar los datos. Otros programas, como DB Browser for SQLite, no podrán abrirlo.')}</p>}
        <label>
          {t('Contraseña')}
          <input type="password" autoFocus aria-label={t('Contraseña')} value={pw} onChange={(e) => (setPw(e.target.value), setError(''))} onKeyDown={(e) => e.key === 'Enter' && mode === 'open' && void go()} />
        </label>
        {mode === 'set' && (
          <label>
            {t('Repita la contraseña')}
            <input type="password" aria-label={t('Repita la contraseña')} value={again} onChange={(e) => (setAgain(e.target.value), setError(''))} onKeyDown={(e) => e.key === 'Enter' && void go()} />
          </label>
        )}
        {error && (
          <p role="alert" className="bs-error">
            {error}
          </p>
        )}
      </div>
    </Dlg>
  );
}
