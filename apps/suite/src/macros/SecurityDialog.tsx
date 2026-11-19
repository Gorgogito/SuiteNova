import { Button, Field, Input, Radio, RadioGroup, Select } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { useEffect, useState } from 'react';
import { MacroModal, type MacroProject } from './MacroDialogs';
import {
  addLocation, certificates, codeModules, createCertificate, getSecurity, removeCertificate, removeLocation, removeSignature, setLevel, signModules, trustPublisher, untrustPublisher, verifyModules,
  type MacroLevel, type SignatureInfo,
} from './security';
import './macros.css';
import './messages';

const LEVELS: [MacroLevel, string, string][] = [
  ['off', 'Deshabilitar todas las macros', 'Ninguna macro se ejecuta, tampoco las de la biblioteca global.'],
  ['warn', 'Deshabilitar las macros con notificación', 'Un archivo con macros se abre con ellas deshabilitadas y una barra para habilitarlas (lo habitual).'],
  ['signed', 'Deshabilitar todas excepto las firmadas digitalmente', 'Solo corren las macros firmadas por un publicador de confianza.'],
  ['all', 'Habilitar todas las macros (no recomendado)', 'Cualquier archivo con macros se abre con ellas habilitadas.'],
];

/** What the signature of the file says, in words. */
export function signatureText(info: SignatureInfo | undefined): string {
  if (!info || info.state === 'none') return t('Las macros de este archivo no están firmadas.');
  if (info.state === 'invalid') return info.publisher ? t('La firma de «{p}» ya no es válida: las macros cambiaron después de firmarlas.', { p: info.publisher }) : t('La firma de las macros no es válida.');
  return info.trusted ? t('Firmadas por «{p}», un publicador de confianza.', { p: info.publisher ?? '' }) : t('Firmadas por «{p}», que no es un publicador de confianza.', { p: info.publisher ?? '' });
}

/** The trust centre of the macros: level, trusted folders, certificates, trusted publishers and the signature of this file. */
export function MacroSecurityDialog({ project, onClose }: { project: MacroProject; onClose: () => void }) {
  const [, bump] = useState(0);
  const rerender = () => bump((x) => x + 1);
  const sec = getSecurity();
  const certs = certificates();
  const [sig, setSig] = useState<SignatureInfo | undefined>();
  const [folder, setFolder] = useState('');
  const [name, setName] = useState('');
  const [certFp, setCertFp] = useState(certs[0]?.fingerprint ?? '');
  const [msg, setMsg] = useState('');
  const [tick, setTick] = useState(0);
  const hasCode = codeModules(project.modules).length > 0;

  useEffect(() => {
    let live = true;
    void verifyModules(project.modules).then((i) => live && setSig(i));
    return () => {
      live = false;
    };
  }, [tick, project.modules]);

  const afterChange = () => {
    setTick((x) => x + 1);
    project.changed();
    rerender();
  };
  const attempt = (fn: () => Promise<void> | void) => {
    setMsg('');
    Promise.resolve()
      .then(fn)
      .catch((e: Error) => setMsg(e.message));
  };

  return (
    <MacroModal title={t('Seguridad de macros')} onClose={onClose} width={640} actions={<Button appearance="primary" onClick={onClose}>{t('Cerrar')}</Button>}>
      <RadioGroup aria-label={t('Nivel de seguridad de las macros')} value={sec.level} onChange={(_e, d) => { setLevel(d.value as MacroLevel); rerender(); }}>
        {LEVELS.map(([v, label, help]) => (
          <Radio key={v} value={v} label={<span>{t(label)} <small className="nv-mac__hint">{t(help)}</small></span>} />
        ))}
      </RadioGroup>

      <h4>{t('Lugares de confianza')}</h4>
      <p><small className="nv-mac__hint">{t('Los archivos que se abren desde estas carpetas (o las de dentro) tienen sus macros habilitadas, sin preguntar.')}</small></p>
      <ul className="nv-mac__list" style={{ minHeight: 0, maxHeight: 84 }} aria-label={t('Lugares de confianza')}>
        {sec.locations.length === 0 && <li style={{ color: 'var(--colorNeutralForeground3)' }}>{t('No hay lugares de confianza.')}</li>}
        {sec.locations.map((l) => (
          <li key={l}>
            {l} <Button size="small" onClick={() => { removeLocation(l); rerender(); }}>{t('Quitar')}</Button>
          </li>
        ))}
      </ul>
      <div className="nv-mac__bar">
        <Input aria-label={t('Carpeta de confianza')} placeholder="C:\Documentos\Macros" value={folder} onChange={(_e, d) => setFolder(d.value)} style={{ minWidth: 260 }} />
        <Button size="small" disabled={!folder.trim()} onClick={() => { addLocation(folder); setFolder(''); rerender(); }}>{t('Agregar lugar')}</Button>
      </div>

      <h4>{t('Firma de las macros de este archivo')}</h4>
      <p role="status">{signatureText(sig)}</p>
      <div className="nv-mac__bar">
        <Select aria-label={t('Certificado con el que firmar')} value={certFp} onChange={(_e, d) => setCertFp(d.value)} disabled={certs.length === 0} style={{ minWidth: 200 }}>
          {certs.length === 0 && <option value="">{t('(sin certificados)')}</option>}
          {certs.map((c) => (
            <option key={c.fingerprint} value={c.fingerprint}>
              {c.name}
            </option>
          ))}
        </Select>
        <Button
          size="small"
          disabled={!hasCode || !certs.length}
          onClick={() =>
            attempt(async () => {
              const c = certs.find((x) => x.fingerprint === certFp) ?? certs[0]!;
              await signModules(project.modules, c);
              afterChange();
            })
          }
        >
          {t('Firmar las macros')}
        </Button>
        <Button size="small" disabled={!sig || sig.state === 'none'} onClick={() => { removeSignature(project.modules); afterChange(); }}>{t('Quitar la firma')}</Button>
        <Button
          size="small"
          disabled={!sig || sig.state !== 'valid' || sig.trusted}
          onClick={() => {
            if (sig?.publisher && sig.fingerprint) trustPublisher({ name: sig.publisher, fingerprint: sig.fingerprint });
            afterChange();
          }}
        >
          {t('Confiar en este publicador')}
        </Button>
      </div>
      <p><small className="nv-mac__hint">{t('La firma de Nova no es una firma Authenticode: Office no la reconoce, ni Nova reconoce las de Office. Cualquier cambio del código la invalida.')}</small></p>

      <h4>{t('Certificados personales')}</h4>
      <ul className="nv-mac__list" style={{ minHeight: 0, maxHeight: 84 }} aria-label={t('Certificados personales')}>
        {certs.length === 0 && <li style={{ color: 'var(--colorNeutralForeground3)' }}>{t('No hay certificados. Cree uno para firmar sus macros.')}</li>}
        {certs.map((c) => (
          <li key={c.fingerprint}>
            {c.name} <small className="nv-mac__hint">{c.fingerprint}</small>{' '}
            <Button size="small" onClick={() => { removeCertificate(c.fingerprint); setCertFp(''); rerender(); }}>{t('Eliminar')}</Button>
          </li>
        ))}
      </ul>
      <div className="nv-mac__bar">
        <Field label={t('Nombre del publicador')} orientation="horizontal">
          <Input value={name} onChange={(_e, d) => setName(d.value)} />
        </Field>
        <Button
          size="small"
          disabled={!name.trim()}
          onClick={() =>
            attempt(async () => {
              const c = await createCertificate(name);
              setCertFp(c.fingerprint);
              setName('');
              rerender();
            })
          }
        >
          {t('Crear certificado')}
        </Button>
      </div>

      <h4>{t('Publicadores de confianza')}</h4>
      <ul className="nv-mac__list" style={{ minHeight: 0, maxHeight: 84 }} aria-label={t('Publicadores de confianza')}>
        {sec.publishers.length === 0 && <li style={{ color: 'var(--colorNeutralForeground3)' }}>{t('No hay publicadores de confianza.')}</li>}
        {sec.publishers.map((p) => (
          <li key={p.fingerprint}>
            {p.name} <small className="nv-mac__hint">{p.fingerprint}</small>{' '}
            <Button size="small" onClick={() => { untrustPublisher(p.fingerprint); rerender(); }}>{t('Quitar')}</Button>
          </li>
        ))}
      </ul>
      {msg && <p role="alert" style={{ color: 'var(--colorPaletteRedForeground1)' }}>{msg}</p>}
    </MacroModal>
  );
}
