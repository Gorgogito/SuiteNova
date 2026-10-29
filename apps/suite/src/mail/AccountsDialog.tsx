import { Button, DialogActions, DialogContent, DialogTitle, Input } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { useState } from 'react';
import { AUTO_SYNC_CHOICES, SYNC_LIMIT_CHOICES, type MailCtl } from './ctl';
import { NOT_AVAILABLE, PRESETS, authOf, isLoopback, messageOf, protocolOf, remote, savesSentCopy, type AuthKind, type OAuthConfig, type Preset, type Protocol, type RemoteAccount, type Security, type ServerConfig } from './remote';

const newId = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const PROTOCOL_NAME: Record<Protocol, string> = { imap: 'IMAP', pop3: 'POP3', jmap: 'JMAP', ews: 'Exchange (EWS)' };
const AUTH_NAME: Record<AuthKind, string> = {
  password: 'Contraseña (o contraseña de aplicación)',
  oauth: 'Iniciar sesión en el navegador (OAuth)',
  token: 'Token de acceso',
};
const PROVIDER_NAME: Record<OAuthConfig['provider'], string> = { google: 'Google', microsoft: 'Microsoft', custom: 'otro proveedor' };

function ServerFields({ label, value, onChange }: { label: string; value: ServerConfig; onChange: (v: ServerConfig) => void }) {
  return (
    <fieldset className="ml-acc__srv">
      <legend>{label}</legend>
      <label>
        <span>{t('Servidor')}</span>
        <Input aria-label={`${label}: ${t('Servidor')}`} value={value.host} onChange={(_e, d) => onChange({ ...value, host: d.value.trim() })} />
      </label>
      <label>
        <span>{t('Puerto')}</span>
        <Input aria-label={`${label}: ${t('Puerto')}`} value={String(value.port || '')} onChange={(_e, d) => onChange({ ...value, port: Number(d.value.replace(/\D/g, '')) || 0 })} style={{ width: 90 }} />
      </label>
      <label>
        <span>{t('Seguridad')}</span>
        <select className="nv-select" aria-label={`${label}: ${t('Seguridad')}`} value={value.security} onChange={(e) => onChange({ ...value, security: e.target.value as Security })}>
          <option value="tls">{t('TLS (cifrado desde el inicio)')}</option>
          <option value="starttls">STARTTLS</option>
          {isLoopback(value.host) && <option value="none">{t('Sin cifrar (solo en este equipo)')}</option>}
        </select>
      </label>
    </fieldset>
  );
}

const httpsOk = (u: string) => /^https:\/\/[^\s/@]+/i.test(u) || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(u);

function Form({ ctl, existing, onDone }: { ctl: MailCtl; existing: RemoteAccount | null; onDone: () => void }) {
  const first = PRESETS[0]!;
  const start: RemoteAccount = existing ?? {
    id: newId(),
    name: '',
    email: '',
    username: '',
    imap: first.imap,
    smtp: first.smtp,
    protocol: first.protocol,
    auth: { kind: first.auth[0]!, oauth: first.auth[0] === 'oauth' ? { provider: first.oauth ?? 'google', client_id: '' } : null },
    url: first.url ?? null,
  };
  const [a, setA] = useState<RemoteAccount>(start);
  const [presetId, setPresetId] = useState(existing ? 'other' : first.id);
  const preset = PRESETS.find((p) => p.id === presetId) as Preset;
  const [password, setPassword] = useState('');
  const [secret, setSecret] = useState('');
  const [saveSent, setSaveSent] = useState(existing ? savesSentCopy(existing) : (first.saveSent ?? true));
  const [loggedIn, setLoggedIn] = useState(!!existing && authOf(existing) === 'oauth');
  const [sessionLogin, setSessionLogin] = useState(false);
  const [busy, setBusy] = useState<'' | 'test' | 'save' | 'login'>('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const protocol = protocolOf(a);
  const kind = authOf(a);
  const oauth = a.auth?.oauth ?? { provider: preset.oauth ?? 'google', client_id: '' };
  const web = protocol === 'jmap' || protocol === 'ews';
  const username = a.username || a.email;

  /** Cambiar cualquier dato de la conexión obliga a iniciar sesión de nuevo (OAuth). */
  const set = (p: Partial<RemoteAccount>, keepLogin = false) => {
    setA((x) => ({ ...x, ...p }));
    setMsg(null);
    if (!keepLogin && ('imap' in p || 'smtp' in p || 'url' in p || 'protocol' in p || 'username' in p || 'auth' in p)) setLoggedIn(false);
  };
  const setOAuth = (p: Partial<OAuthConfig>) => set({ auth: { kind: 'oauth', oauth: { ...oauth, ...p } } });
  const full = (): RemoteAccount => ({
    ...a,
    name: a.name.trim() || a.email.trim(),
    email: a.email.trim(),
    username: username.trim(),
    protocol,
    auth: kind === 'oauth' ? { kind, oauth: { ...oauth, client_id: oauth.client_id.trim(), tenant: oauth.provider === 'microsoft' ? oauth.tenant || null : null } } : { kind },
    url: web ? (a.url ?? '').trim() : null,
    save_sent: protocol === 'imap' ? saveSent : null,
  });
  const usesPassword = kind === 'password' || kind === 'token';
  const serversOk = web ? httpsOk((a.url ?? '').trim()) : !!a.imap.host && !!a.smtp.host && a.imap.port > 0 && a.smtp.port > 0;
  const authOk = kind === 'oauth' ? !!oauth.client_id.trim() && (oauth.provider !== 'custom' || (!!oauth.auth_url && !!oauth.token_url && !!oauth.scope)) : !!(existing || password);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email.trim()) && serversOk && authOk && (kind !== 'oauth' || loggedIn);

  const pickPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)!;
    setPresetId(id);
    const k = p.auth[0]!;
    set({
      protocol: p.protocol,
      imap: { ...p.imap },
      smtp: { ...p.smtp },
      url: p.url ?? null,
      auth: { kind: k, oauth: k === 'oauth' ? { ...oauth, provider: p.oauth ?? (oauth.provider === 'custom' ? 'custom' : 'google') } : null },
    });
    setSaveSent(p.saveSent ?? true);
  };

  const run = async (what: 'test' | 'save' | 'login') => {
    setBusy(what);
    setMsg(null);
    try {
      if (what === 'login') {
        await remote.oauthLogin(full(), secret || undefined);
        setSecret('');
        setLoggedIn(true);
        setSessionLogin(true);
        setMsg({ kind: 'ok', text: t('Sesión iniciada: Nova Mail ya puede entrar en la cuenta. Ahora puedes probarla y guardarla.') });
      } else if (what === 'test') {
        await remote.test(full(), usesPassword ? password || undefined : undefined);
        setMsg({ kind: 'ok', text: web ? t('La conexión funciona: se pudo entrar en el servicio de correo.') : t('La conexión funciona: se pudo entrar en el servidor de entrada y en el de salida.') });
      } else {
        await remote.save(full(), usesPassword ? password || undefined : undefined);
        // la contraseña ya no se necesita aquí
        setPassword('');
        setSessionLogin(false);
        await ctl.loadAccounts();
        void ctl.syncAll();
        onDone();
      }
    } catch (e) {
      setMsg({ kind: 'err', text: messageOf(e) });
    } finally {
      setBusy('');
    }
  };

  const cancel = () => {
    // un inicio de sesión que no se guardó como cuenta no debe dejar nada guardado
    if (!existing && sessionLogin) void remote.oauthForget(a.id).catch(() => undefined);
    onDone();
  };

  return (
    <div className="ml-acc__form">
      <label>
        <span>{t('Proveedor')}</span>
        <select className="nv-select" aria-label={t('Proveedor')} value={presetId} onChange={(e) => pickPreset(e.target.value)}>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {t(p.name)}
            </option>
          ))}
        </select>
      </label>
      {preset.hint && <p className="ml-acc__hint">{t(preset.hint)}</p>}
      <label>
        <span>{t('Nombre de la cuenta')}</span>
        <Input aria-label={t('Nombre de la cuenta')} value={a.name} onChange={(_e, d) => set({ name: d.value }, true)} />
      </label>
      <label>
        <span>{t('Correo electrónico')}</span>
        <Input aria-label={t('Correo electrónico')} value={a.email} onChange={(_e, d) => set({ email: d.value }, true)} />
      </label>
      <label>
        <span>{t('Usuario (si es distinto del correo)')}</span>
        <Input aria-label={t('Usuario')} value={a.username} placeholder={a.email} onChange={(_e, d) => set({ username: d.value })} />
      </label>
      <label>
        <span>{t('Protocolo')}</span>
        <select
          className="nv-select"
          aria-label={t('Protocolo')}
          value={protocol}
          disabled={!presetId.startsWith('other') && presetId !== 'exchange' && presetId !== 'fastmail'}
          onChange={(e) => {
            const p = e.target.value as Protocol;
            set({ protocol: p, imap: p === 'pop3' ? { host: a.imap.host, port: 995, security: 'tls' } : { host: a.imap.host, port: 993, security: 'tls' } });
          }}
        >
          {(Object.keys(PROTOCOL_NAME) as Protocol[]).map((p) => (
            <option key={p} value={p}>
              {PROTOCOL_NAME[p]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t('Cómo iniciar sesión')}</span>
        <select
          className="nv-select"
          aria-label={t('Cómo iniciar sesión')}
          value={kind}
          onChange={(e) => {
            const k = e.target.value as AuthKind;
            set({ auth: { kind: k, oauth: k === 'oauth' ? { ...oauth } : null } });
          }}
        >
          {(['password', 'oauth', 'token'] as AuthKind[])
            .filter((k) => (k !== 'token' || web) && (k !== 'oauth' || protocol !== 'jmap' || oauth.provider === 'custom'))
            .map((k) => (
              <option key={k} value={k}>
                {t(AUTH_NAME[k])}
              </option>
            ))}
        </select>
      </label>
      {usesPassword && (
        <>
          <label>
            <span>{kind === 'token' ? (existing ? t('Token de acceso (déjalo vacío para conservar el guardado)') : t('Token de acceso')) : existing ? t('Contraseña (déjala vacía para conservar la guardada)') : t('Contraseña')}</span>
            <Input aria-label={kind === 'token' ? t('Token de acceso') : t('Contraseña')} type="password" autoComplete="off" value={password} onChange={(_e, d) => setPassword(d.value)} />
          </label>
          <p className="ml-acc__hint">{t('La contraseña se guarda en el almacén seguro de tu sistema (no en el archivo de Nova Mail) y solo se usa para conectar con estos servidores.')}</p>
        </>
      )}
      {kind === 'oauth' && (
        <fieldset className="ml-acc__srv ml-acc__stack" aria-label={t('OAuth')}>
          <legend>{t('Inicio de sesión con {proveedor} (OAuth)', { proveedor: t(PROVIDER_NAME[oauth.provider]) })}</legend>
          <p className="ml-acc__hint">
            {t('Nova Mail no trae una aplicación registrada: crea la tuya en {sitio}, de tipo «aplicación de escritorio», permite la redirección {uri} y pega aquí su identificador de cliente. Tu contraseña nunca pasa por Nova Mail.', {
              sitio: oauth.provider === 'microsoft' ? 'Microsoft Entra' : oauth.provider === 'google' ? 'Google Cloud' : t('tu proveedor'),
              uri: oauth.provider === 'microsoft' ? 'http://localhost' : 'http://127.0.0.1',
            })}
          </p>
          <label>
            <span>{t('Identificador de cliente (Client ID)')}</span>
            <Input aria-label={t('Identificador de cliente (Client ID)')} value={oauth.client_id} onChange={(_e, d) => setOAuth({ client_id: d.value.trim() })} />
          </label>
          <label>
            <span>{t('Secreto del cliente (solo si el proveedor lo exige)')}</span>
            <Input aria-label={t('Secreto del cliente')} type="password" autoComplete="off" value={secret} onChange={(_e, d) => setSecret(d.value)} />
          </label>
          {oauth.provider === 'microsoft' && (
            <label>
              <span>{t('Tipo de cuenta de Microsoft')}</span>
              <select className="nv-select" aria-label={t('Tipo de cuenta de Microsoft')} value={oauth.tenant || 'common'} onChange={(e) => setOAuth({ tenant: e.target.value })}>
                <option value="common">{t('Cualquiera (personal o de trabajo)')}</option>
                <option value="consumers">{t('Personal (Outlook.com, Hotmail)')}</option>
                <option value="organizations">{t('De trabajo o escuela (Microsoft 365)')}</option>
              </select>
            </label>
          )}
          {oauth.provider === 'custom' && (
            <>
              <label>
                <span>{t('Dirección de autorización')}</span>
                <Input aria-label={t('Dirección de autorización')} value={oauth.auth_url ?? ''} onChange={(_e, d) => setOAuth({ auth_url: d.value.trim() })} />
              </label>
              <label>
                <span>{t('Dirección del token')}</span>
                <Input aria-label={t('Dirección del token')} value={oauth.token_url ?? ''} onChange={(_e, d) => setOAuth({ token_url: d.value.trim() })} />
              </label>
              <label>
                <span>{t('Ámbito (scope)')}</span>
                <Input aria-label={t('Ámbito (scope)')} value={oauth.scope ?? ''} onChange={(_e, d) => setOAuth({ scope: d.value })} />
              </label>
            </>
          )}
          <div className="ml-acc__buttons">
            <Button disabled={busy !== '' || !authOk || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email.trim()) || !serversOk} onClick={() => void run('login')}>
              {busy === 'login' ? t('Esperando el inicio de sesión en el navegador…') : t('Iniciar sesión en el navegador')}
            </Button>
            <span role="status" className={loggedIn ? 'ml-ok' : 'ml-acc__hint'}>
              {loggedIn ? t('Sesión iniciada') : t('Sin iniciar sesión')}
            </span>
          </div>
        </fieldset>
      )}
      {web ? (
        <label>
          <span>{protocol === 'jmap' ? t('Dirección de la sesión JMAP') : t('Dirección del servicio Exchange (EWS)')}</span>
          <Input aria-label={protocol === 'jmap' ? t('Dirección de la sesión JMAP') : t('Dirección del servicio Exchange (EWS)')} value={a.url ?? ''} placeholder="https://" onChange={(_e, d) => set({ url: d.value.trim() })} />
        </label>
      ) : (
        <>
          <ServerFields label={protocol === 'pop3' ? t('Servidor de entrada (POP3)') : t('Servidor de entrada (IMAP)')} value={a.imap} onChange={(imap) => set({ imap })} />
          <ServerFields label={t('Servidor de salida (SMTP)')} value={a.smtp} onChange={(smtp) => set({ smtp })} />
        </>
      )}
      {protocol === 'imap' && (
        <label className="ml-acc__check">
          <input type="checkbox" checked={saveSent} onChange={(e) => setSaveSent(e.target.checked)} aria-label={t('Guardar una copia de lo enviado en Enviados del servidor')} />
          <span>{t('Guardar una copia de lo enviado en Enviados del servidor')}</span>
        </label>
      )}
      {protocol === 'imap' && <p className="ml-acc__hint">{t('Gmail y Outlook ya guardan su propia copia: con ellos déjalo sin marcar o quedaría repetida.')}</p>}
      {msg && (
        <p className={msg.kind === 'ok' ? 'ml-ok' : 'ml-acc__err'} role={msg.kind === 'ok' ? 'status' : 'alert'}>
          {msg.kind === 'ok' ? msg.text : t(msg.text)}
        </p>
      )}
      <div className="ml-acc__buttons">
        <Button disabled={busy !== '' || !valid} onClick={() => void run('test')}>
          {busy === 'test' ? t('Conectando…') : t('Probar conexión')}
        </Button>
        <Button appearance="primary" disabled={busy !== '' || !valid} onClick={() => void run('save')}>
          {t('Guardar cuenta')}
        </Button>
        <Button disabled={busy === 'save' || busy === 'test'} onClick={cancel}>
          {t('Cancelar')}
        </Button>
      </div>
    </div>
  );
}

const minutesLabel = (m: number): string => (m === 0 ? 'Nunca (solo con «Enviar y recibir»)' : m === 60 ? 'Cada hora' : m === 1 ? 'Cada minuto' : `Cada ${m} minutos`);

/** Lista y alta de cuentas de correo (IMAP, POP3, JMAP y Exchange). */
export function AccountsDialog({ ctl, onClose }: { ctl: MailCtl; onClose: () => void }) {
  const [editing, setEditing] = useState<RemoteAccount | 'new' | null>(null);
  const [err, setErr] = useState('');
  const accounts = ctl.accounts;

  const del = async (a: RemoteAccount) => {
    if (!window.confirm(t('¿Quitar la cuenta "{name}"? Los mensajes ya descargados se conservan en este archivo; se borran la contraseña o el inicio de sesión guardados.', { name: a.name }))) return;
    try {
      await remote.remove(a.id);
      ctl.forgetAccount(a.id);
      await ctl.loadAccounts();
    } catch (e) {
      setErr(messageOf(e));
    }
  };

  return (
    <>
      <DialogTitle>{t('Cuentas de correo')}</DialogTitle>
      <DialogContent>
        {!ctl.canConnect ? (
          <p role="status">{t(NOT_AVAILABLE)}</p>
        ) : editing ? (
          <Form ctl={ctl} existing={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
        ) : (
          <>
            {accounts.length === 0 ? <p>{t('Todavía no hay ninguna cuenta. Con una cuenta Nova Mail descarga tus mensajes y envía los que redactes.')}</p> : null}
            <ul className="ml-acc__list" aria-label={t('Cuentas')}>
              {accounts.map((a) => (
                <li key={a.id}>
                  <div>
                    <strong>{a.name}</strong>
                    <span>{a.email}</span>
                    <span className="ml-acc__srv-line">
                      {PROTOCOL_NAME[protocolOf(a)]} · {authOf(a) === 'oauth' ? 'OAuth' : authOf(a) === 'token' ? t('token') : t('contraseña')} · {protocolOf(a) === 'jmap' || protocolOf(a) === 'ews' ? (a.url ?? '') : `${a.imap.host}:${a.imap.port}${protocolOf(a) === 'imap' || protocolOf(a) === 'pop3' ? ` · ${a.smtp.host}:${a.smtp.port}` : ''}`}
                    </span>
                  </div>
                  <Button onClick={() => setEditing(a)} aria-label={`${t('Editar')} ${a.name}`}>
                    {t('Editar')}
                  </Button>
                  <Button onClick={() => void del(a)} aria-label={`${t('Quitar')} ${a.name}`}>
                    {t('Quitar')}
                  </Button>
                </li>
              ))}
            </ul>
            {err && (
              <p role="alert" className="ml-acc__err">
                {t(err)}
              </p>
            )}
            {accounts.length > 0 && (
              <fieldset className="ml-acc__srv ml-acc__stack" aria-label={t('Sincronización')}>
                <legend>{t('Sincronización')}</legend>
                <label>
                  <span>{t('Sincronizar automáticamente')}</span>
                  <select className="nv-select" aria-label={t('Sincronizar automáticamente')} value={ctl.autoMinutes} onChange={(e) => ctl.setSyncSettings({ autoMinutes: Number(e.target.value) })}>
                    {AUTO_SYNC_CHOICES.map((m) => (
                      <option key={m} value={m}>
                        {t(minutesLabel(m))}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t('Mensajes más nuevos que se conservan por carpeta')}</span>
                  <select className="nv-select" aria-label={t('Mensajes más nuevos que se conservan por carpeta')} value={ctl.syncLimit} onChange={(e) => ctl.setSyncSettings({ limit: Number(e.target.value) })}>
                    {SYNC_LIMIT_CHOICES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </fieldset>
            )}
            <p className="ml-acc__hint">{t('Nova Mail trae todas las carpetas de la cuenta, con sus subcarpetas, y las mantiene al día. Eliminar, archivar o mover un mensaje aquí también lo hace en el servidor; lo que cambies en el servidor llega en la siguiente sincronización. Si no hay conexión, los cambios quedan pendientes y se envían después.')}</p>
          </>
        )}
      </DialogContent>
      <DialogActions>
        {!editing && ctl.canConnect && <Button onClick={() => setEditing('new')}>{t('Añadir cuenta')}</Button>}
        {!editing && (
          <Button appearance="primary" onClick={onClose}>
            {t('Cerrar')}
          </Button>
        )}
      </DialogActions>
    </>
  );
}
