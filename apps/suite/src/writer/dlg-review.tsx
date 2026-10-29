import { Button, Checkbox, Input, Select } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { checkProtectionPassword, makeProtection, type Protection } from '@suitenova/writer-core';
import { useState } from 'react';
import type { WriterUI } from './commands';
import { Modal, field, focusDocSoon } from './dialogs';
import { getUser, setUser, initialsOf } from './review';

const MODES: { id: Protection['mode']; label: string; help: string }[] = [
  { id: 'readOnly', label: 'Sin cambios (solo lectura)', help: 'No se puede modificar nada, ni comentar.' },
  { id: 'comments', label: 'Comentarios', help: 'Solo se pueden añadir comentarios.' },
  { id: 'trackedChanges', label: 'Cambios controlados', help: 'Todo lo que se cambie queda registrado y no se puede desactivar el control.' },
  { id: 'forms', label: 'Rellenar formularios', help: 'Solo se pueden rellenar los controles de contenido.' },
];

export function ProtectDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const [mode, setMode] = useState<Protection['mode']>('readOnly');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const mismatch = pw !== pw2;
  return (
    <Modal
      title={t('Restringir edición')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={mismatch}
            onClick={() => {
              const p = makeProtection(mode, pw || null);
              ui.ctl.setProtection(p);
              onClose();
              focusDocSoon(ui);
            }}
          >
            {t('Sí, aplicar la protección')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="nw-prot-mode">{t('Tipo de edición permitida')}</label>
        <Select id="nw-prot-mode" value={mode} onChange={(_e, d) => setMode(d.value as Protection['mode'])}>
          {MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {t(m.label)}
            </option>
          ))}
        </Select>
        <span style={{ fontSize: 12 }}>{t(MODES.find((m) => m.id === mode)!.help)}</span>
      </div>
      <div style={field}>
        <label htmlFor="nw-prot-pw">{t('Contraseña (opcional)')}</label>
        <Input id="nw-prot-pw" type="password" value={pw} onChange={(_e, d) => setPw(d.value)} autoComplete="off" />
      </div>
      <div style={field}>
        <label htmlFor="nw-prot-pw2">{t('Repita la contraseña')}</label>
        <Input id="nw-prot-pw2" type="password" value={pw2} onChange={(_e, d) => setPw2(d.value)} autoComplete="off" />
        {mismatch && <span role="alert">{t('Las contraseñas no coinciden.')}</span>}
      </div>
      <p style={{ fontSize: 12, margin: 0 }}>{t('La protección de edición no cifra el documento: quien abra el archivo con otro programa puede ignorarla. Use "Cifrar con contraseña" para impedir que se abra.')}</p>
    </Modal>
  );
}

export function UnprotectDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [wrong, setWrong] = useState(false);
  const check = () => {
    const p = ui.ctl.protection;
    if (p && !checkProtectionPassword(p, pw)) {
      setWrong(true);
      return;
    }
    ui.ctl.setProtection(null);
    onClose();
    focusDocSoon(ui);
  };
  return (
    <Modal
      title={t('Quitar la protección')}
      width={380}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" onClick={check}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="nw-unprot-pw">{t('Contraseña')}</label>
        <Input
          id="nw-unprot-pw"
          type="password"
          value={pw}
          autoFocus
          onChange={(_e, d) => {
            setPw(d.value);
            setWrong(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && check()}
        />
        {wrong && <span role="alert">{t('La contraseña no es correcta.')}</span>}
      </div>
    </Modal>
  );
}

export function UserDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const u = getUser();
  const [name, setName] = useState(u.name);
  const [initials, setInitials] = useState(u.initials);
  return (
    <Modal
      title={t('Nombre de usuario')}
      width={400}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!name.trim()}
            onClick={() => {
              setUser({ name: name.trim(), initials: initials.trim() || initialsOf(name) });
              onClose();
              focusDocSoon(ui);
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <p style={{ margin: '0 0 8px', fontSize: 12 }}>{t('Se usa como autor de los comentarios y de los cambios controlados.')}</p>
      <div style={field}>
        <label htmlFor="nw-user-name">{t('Nombre')}</label>
        <Input id="nw-user-name" value={name} onChange={(_e, d) => setName(d.value)} autoFocus />
      </div>
      <div style={field}>
        <label htmlFor="nw-user-ini">{t('Iniciales')}</label>
        <Input id="nw-user-ini" value={initials} onChange={(_e, d) => setInitials(d.value)} />
      </div>
    </Modal>
  );
}

void Checkbox;
