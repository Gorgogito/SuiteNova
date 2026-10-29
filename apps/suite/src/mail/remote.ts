import type { Fetched, FolderState, RemoteFolder } from '@suitenova/mail-core';
import { isTauri } from '../platform';

/** Seguridad de la conexión. "none" solo la acepta el programa para este mismo equipo (pruebas). */
export type Security = 'tls' | 'starttls' | 'none';
export interface ServerConfig {
  host: string;
  port: number;
  security: Security;
}

export type Protocol = 'imap' | 'pop3' | 'jmap' | 'ews';
/** password: contraseña; oauth: inicio de sesión en el navegador; token: un token de acceso fijo (JMAP y Exchange). */
export type AuthKind = 'password' | 'oauth' | 'token';
export interface OAuthConfig {
  provider: 'google' | 'microsoft' | 'custom';
  client_id: string;
  tenant?: string | null;
  auth_url?: string | null;
  token_url?: string | null;
  scope?: string | null;
}

/** Una cuenta, sin credenciales. Las credenciales solo las ve la parte de escritorio y viven en el almacén seguro del sistema. */
export interface RemoteAccount {
  id: string;
  name: string;
  email: string;
  username: string;
  imap: ServerConfig;
  smtp: ServerConfig;
  protocol?: Protocol;
  auth?: { kind: AuthKind; oauth?: OAuthConfig | null };
  /** JMAP: la dirección de la sesión; Exchange: la de EWS. */
  url?: string | null;
  /** ¿Guardar una copia de lo enviado en Enviados del servidor? Sin valor: según el proveedor. */
  save_sent?: boolean | null;
}

export type Transport = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

let custom: Transport | null = null;
/** Solo para pruebas con un servidor simulado (se enlaza desde `window.__novaMail` en desarrollo). */
export function setTransport(t: Transport | null): void {
  custom = t;
}

export const canConnect = (): boolean => !!custom || isTauri();

export const NOT_AVAILABLE = 'La conexión con servidores de correo solo está disponible en la aplicación de escritorio de SuiteNova.';

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    if (custom) return (await custom(cmd, args)) as T;
    if (!isTauri()) throw new Error(NOT_AVAILABLE);
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  } catch (e) {
    // las órdenes de Rust devuelven el error como texto ya explicado
    throw e instanceof Error ? e : new Error(String(e));
  }
}

export const remote = {
  accounts: () => call<RemoteAccount[]>('mail_accounts'),
  save: (account: RemoteAccount, password?: string) => call<void>('mail_account_save', { account, password: password ? password : null }),
  remove: (id: string) => call<void>('mail_account_remove', { id }),
  test: (account: RemoteAccount, password?: string) => call<void>('mail_test', { account, password: password ? password : null }),
  /** Abre el navegador y espera a que termine el inicio de sesión (hasta 3 minutos). */
  oauthLogin: (account: RemoteAccount, clientSecret?: string) => call<void>('mail_oauth_login', { account, clientSecret: clientSecret ? clientSecret : null }),
  oauthForget: (id: string) => call<void>('mail_oauth_forget', { id }),
  folders: (id: string) => call<RemoteFolder[]>('mail_list_folders', { id }),
  state: (id: string, folder: string) => call<FolderState>('mail_folder_state', { id, folder }),
  fetch: (id: string, folder: string, keys: string[], maxBytes: number) => call<Fetched>('mail_fetch', { id, folder, keys, maxBytes }),
  setFlag: (id: string, folder: string, keys: string[], flag: string, on: boolean) => call<void>('mail_set_flag', { id, folder, keys, flag, on }),
  move: (id: string, folder: string, keys: string[], to: string) => call<void>('mail_move', { id, folder, keys, to }),
  /** Borra para siempre del servidor. */
  removeMessages: (id: string, folder: string, keys: string[]) => call<void>('mail_remove', { id, folder, keys }),
  append: (id: string, folder: string, raw: string, seen: boolean) => call<void>('mail_append', { id, folder, raw, seen }),
  createFolder: (id: string, path: string) => call<void>('mail_create_folder', { id, path }),
  deleteFolder: (id: string, folder: string) => call<void>('mail_delete_folder', { id, folder }),
  send: (id: string, recipients: string[], raw: string) => call<void>('mail_send', { id, recipients, raw }),
};

export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const protocolOf = (a: RemoteAccount): Protocol => a.protocol ?? 'imap';
export const authOf = (a: RemoteAccount): AuthKind => a.auth?.kind ?? 'password';

/** Proveedores que guardan por sí mismos una copia de lo que se envía por SMTP: no hace falta (ni conviene) guardarla desde aquí. */
const SAVES_ITS_OWN = /(^|\.)(gmail\.com|googlemail\.com|office365\.com|outlook\.com|hotmail\.com|live\.com)$/i;
export function savesSentCopy(a: RemoteAccount): boolean {
  if (typeof a.save_sent === 'boolean') return a.save_sent;
  return !SAVES_ITS_OWN.test(a.imap.host.trim());
}

export interface Preset {
  id: string;
  name: string;
  protocol: Protocol;
  imap: ServerConfig;
  smtp: ServerConfig;
  url?: string;
  /** Formas de iniciar sesión que admite; la primera es la predeterminada. */
  auth: AuthKind[];
  oauth?: OAuthConfig['provider'];
  saveSent?: boolean;
  /** Qué hay que saber antes de usar este proveedor. */
  hint: string;
}

const NONE: ServerConfig = { host: '', port: 993, security: 'tls' };
const NONE_SMTP: ServerConfig = { host: '', port: 587, security: 'starttls' };

export const PRESETS: Preset[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    protocol: 'imap',
    imap: { host: 'imap.gmail.com', port: 993, security: 'tls' },
    smtp: { host: 'smtp.gmail.com', port: 465, security: 'tls' },
    auth: ['oauth', 'password'],
    oauth: 'google',
    saveSent: false,
    hint: 'Con OAuth inicias sesión en el navegador (hace falta registrar tu propia aplicación en Google Cloud: ver docs/LIMITACIONES.md). Sin OAuth: activa la verificación en dos pasos de tu cuenta de Google y crea una «contraseña de aplicación»; la contraseña normal no funciona.',
  },
  {
    id: 'outlook',
    name: 'Outlook / Microsoft 365',
    protocol: 'imap',
    imap: { host: 'outlook.office365.com', port: 993, security: 'tls' },
    smtp: { host: 'smtp.office365.com', port: 587, security: 'starttls' },
    auth: ['oauth', 'password'],
    oauth: 'microsoft',
    saveSent: false,
    hint: 'Microsoft ha desactivado el acceso con contraseña en muchas cuentas: usa OAuth (hace falta registrar tu propia aplicación en Microsoft Entra: ver docs/LIMITACIONES.md). En Microsoft 365 el administrador debe permitir IMAP y SMTP autenticado para el buzón.',
  },
  {
    id: 'icloud',
    name: 'iCloud',
    protocol: 'imap',
    imap: { host: 'imap.mail.me.com', port: 993, security: 'tls' },
    smtp: { host: 'smtp.mail.me.com', port: 587, security: 'starttls' },
    auth: ['password'],
    hint: 'Crea una «contraseña específica de app» en appleid.apple.com. El usuario es tu dirección de iCloud.',
  },
  {
    id: 'yahoo',
    name: 'Yahoo',
    protocol: 'imap',
    imap: { host: 'imap.mail.yahoo.com', port: 993, security: 'tls' },
    smtp: { host: 'smtp.mail.yahoo.com', port: 465, security: 'tls' },
    auth: ['password'],
    hint: 'Genera una «contraseña de aplicación» en la seguridad de tu cuenta de Yahoo.',
  },
  {
    id: 'fastmail',
    name: 'Fastmail (JMAP)',
    protocol: 'jmap',
    imap: NONE,
    smtp: NONE_SMTP,
    url: 'https://api.fastmail.com/jmap/session',
    auth: ['token', 'password'],
    hint: 'Crea un «token de API» con acceso al correo en los ajustes de seguridad de tu cuenta de Fastmail y pégalo en lugar de la contraseña. JMAP guarda por sí mismo la copia en Enviados.',
  },
  {
    id: 'exchange',
    name: 'Exchange (EWS)',
    protocol: 'ews',
    imap: NONE,
    smtp: NONE_SMTP,
    url: '',
    auth: ['password', 'oauth', 'token'],
    oauth: 'microsoft',
    hint: 'Solo para Exchange local con usuario y contraseña (no admite NTLM ni Kerberos). Exchange Online ha empezado a bloquear EWS a las aplicaciones externas desde el 1 de octubre de 2026: para Microsoft 365 elige «Outlook / Microsoft 365» (IMAP con OAuth). La dirección suele ser https://servidor/EWS/Exchange.asmx.',
  },
  { id: 'other', name: 'Otro proveedor (IMAP)', protocol: 'imap', imap: { ...NONE }, smtp: { ...NONE_SMTP }, auth: ['password', 'oauth'], oauth: 'custom', hint: 'Pide a tu proveedor los datos de IMAP y SMTP. Se usa siempre una conexión cifrada.' },
  { id: 'other-pop3', name: 'Otro proveedor (POP3)', protocol: 'pop3', imap: { host: '', port: 995, security: 'tls' }, smtp: { ...NONE_SMTP }, auth: ['password', 'oauth'], oauth: 'custom', hint: 'POP3 solo trae la bandeja de entrada: no tiene carpetas ni marcas en el servidor. Borrar un mensaje aquí lo borra del servidor.' },
  { id: 'other-jmap', name: 'Otro proveedor (JMAP)', protocol: 'jmap', imap: NONE, smtp: NONE_SMTP, url: '', auth: ['token', 'password'], hint: 'La dirección es la de la sesión JMAP (suele acabar en /jmap/session o /.well-known/jmap).' },
];

export const isLoopback = (host: string): boolean => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host.trim().toLowerCase());
