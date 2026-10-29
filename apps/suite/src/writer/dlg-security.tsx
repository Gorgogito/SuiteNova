import { Button, Input } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { createIdentity, fingerprint, readCertificate, signDocument, type CertificateInfo, type SignIdentity } from '@suitenova/writer-core';
import { useEffect, useState } from 'react';
import type { WriterUI } from './commands';
import { Modal, field, focusDocSoon } from './dialogs';

const IDENTITY_KEY = 'nova.writer.identity';

export function loadIdentity(): SignIdentity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    const v = raw ? (JSON.parse(raw) as SignIdentity) : null;
    return v && v.privateKey && v.publicKey && v.name ? v : null;
  } catch {
    return null;
  }
}

function saveIdentity(id: SignIdentity): void {
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(id));
  } catch {
    /* no storage: the identity only lives until the window closes */
  }
}

// ------------------------------------------------------------------------------------------------ password to open

export function EncryptDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const mismatch = again !== '' && pw !== again;
  return (
    <Modal
      title={t('Cifrar con contraseña')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!pw || pw !== again}
            onClick={() => {
              ui.ctl.password = pw;
              ui.ctl.dirty = true;
              ui.ctl.touch();
              onClose();
              focusDocSoon(ui);
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>{t('El archivo se guardará cifrado (AES-256) y habrá que escribir la contraseña para abrirlo. Si la olvida, no se puede recuperar el documento.')}</p>
      <div style={field}>
        <label htmlFor="nw-pw1">{t('Contraseña')}</label>
        <Input id="nw-pw1" type="password" value={pw} onChange={(_e, d) => setPw(d.value)} autoFocus />
      </div>
      <div style={field}>
        <label htmlFor="nw-pw2">{t('Repita la contraseña')}</label>
        <Input id="nw-pw2" type="password" value={again} onChange={(_e, d) => setAgain(d.value)} />
      </div>
      {mismatch && <p role="alert" style={{ color: '#b00020', margin: 0 }}>{t('Las contraseñas no coinciden.')}</p>}
    </Modal>
  );
}

/** Asked when opening an encrypted file; `onSubmit` returns an error message when the password does not open it. */
export function OpenPasswordDialog({ name, onSubmit, onCancel }: { name: string; onSubmit: (pw: string) => Promise<string | null>; onCancel: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setErr(null);
    const e = await onSubmit(pw);
    if (e) {
      setErr(e);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('Documento protegido con contraseña')}
      onClose={onCancel}
      actions={
        <>
          <Button onClick={onCancel}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!pw || busy} onClick={() => void go()}>
            {busy ? t('Abriendo…') : t('Aceptar')}
          </Button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>{t('«{name}» está cifrado. Escriba la contraseña para abrirlo.', { name })}</p>
      <div style={field}>
        <label htmlFor="nw-pwo">{t('Contraseña')}</label>
        <Input id="nw-pwo" type="password" value={pw} onChange={(_e, d) => setPw(d.value)} onKeyDown={(e) => e.key === 'Enter' && pw && !busy && void go()} autoFocus />
      </div>
      {err && <p role="alert" style={{ color: '#b00020', margin: 0 }}>{err}</p>}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ signature

export function SignDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const existing = loadIdentity();
  const [name, setName] = useState(existing?.name ?? ui.ctl.author ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [fp, setFp] = useState('');
  useEffect(() => {
    if (existing) void fingerprint(existing.publicKey).then(setFp);
  }, [existing]);
  return (
    <Modal
      title={t('Firmar documento')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                let id = existing;
                if (!id || id.name !== name.trim() || id.email !== email.trim()) {
                  id = await createIdentity(name.trim(), email.trim());
                  saveIdentity(id);
                }
                const sig = await signDocument(ui.ctl.toWriterDoc(), id, comment.trim());
                ui.ctl.setSignature(sig);
                onClose();
                focusDocSoon(ui);
              } catch (e) {
                setErr((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {t('Firmar')}
          </Button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>{t('Su firma garantiza que el contenido no cambió desde que firmó. Es una firma propia de Nova Writer (el certificado lo crea este equipo): no acredita quién es usted ante terceros y Word no la reconoce.')}</p>
      <div style={field}>
        <label htmlFor="nw-sg-name">{t('Nombre del firmante')}</label>
        <Input id="nw-sg-name" value={name} onChange={(_e, d) => setName(d.value)} autoFocus />
      </div>
      <div style={field}>
        <label htmlFor="nw-sg-mail">{t('Correo electrónico (opcional)')}</label>
        <Input id="nw-sg-mail" value={email} onChange={(_e, d) => setEmail(d.value)} />
      </div>
      <div style={field}>
        <label htmlFor="nw-sg-why">{t('Motivo (opcional)')}</label>
        <Input id="nw-sg-why" value={comment} onChange={(_e, d) => setComment(d.value)} />
      </div>
      {existing && fp && <p style={{ margin: 0, opacity: 0.85 }}>{t('Identidad de este equipo: {fp}', { fp })}</p>}
      {err && <p role="alert" style={{ color: '#b00020' }}>{err}</p>}
    </Modal>
  );
}

export function SignatureInfoDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const sig = ui.ctl.signature;
  const [cert, setCert] = useState<CertificateInfo | null>(null);
  useEffect(() => {
    if (sig) setCert(readCertificate(sig));
  }, [sig]);
  if (!sig) return null;
  const status = ui.ctl.signatureStatus;
  const label = status === 'valid' ? t('Válida: el contenido es el que se firmó.') : status === 'modified' ? t('El documento cambió después de firmarse.') : status === 'invalid' ? t('La firma no es válida (está alterada).') : t('Comprobando…');
  const color = status === 'valid' ? '#1b7f3b' : status ? '#b00020' : undefined;
  return (
    <Modal
      title={t('Firma digital')}
      onClose={onClose}
      actions={
        <>
          <Button
            onClick={() => {
              if (window.confirm(t('¿Quitar la firma del documento?'))) {
                ui.ctl.setSignature(null);
                onClose();
              }
            }}
          >
            {t('Quitar firma')}
          </Button>
          <Button appearance="primary" onClick={onClose}>
            {t('Cerrar')}
          </Button>
        </>
      }
    >
      <p role="status" style={{ fontWeight: 600, color, marginTop: 0 }}>{label}</p>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', margin: 0 }}>
        <dt>{t('Firmante')}</dt>
        <dd style={{ margin: 0 }}>{sig.signer}{cert?.email ? ` <${cert.email}>` : ''}</dd>
        <dt>{t('Fecha')}</dt>
        <dd style={{ margin: 0 }}>{new Date(sig.date).toLocaleString()}</dd>
        {sig.comment ? (
          <>
            <dt>{t('Motivo')}</dt>
            <dd style={{ margin: 0 }}>{sig.comment}</dd>
          </>
        ) : null}
        <dt>{t('Huella de la clave')}</dt>
        <dd style={{ margin: 0, fontFamily: 'Consolas, monospace' }}>{cert?.fingerprint ?? '—'}</dd>
      </dl>
      <p style={{ opacity: 0.85, marginBottom: 0 }}>{t('Certificado propio sin autoridad certificadora: confirma que lo firmó la misma identidad (la huella), no quién es.')}</p>
    </Modal>
  );
}
