import { encodeBase64 } from '@suitenova/mail-core';
import type { RemoteAccount, Transport } from './remote';

/*
 * Un servidor de correo simulado que responde igual que las órdenes de la parte de escritorio (Rust). Sirve para las pruebas
 * de la aplicación y las de extremo a extremo en el navegador; los clientes reales de cada protocolo se prueban con
 * `cargo test` contra servidores falsos que hablan IMAP, POP3, JMAP, Exchange y OAuth en este equipo.
 */

export interface FakeMsg {
  key: string;
  flags: string[];
  raw: string;
}

export interface FakeFolder {
  name: string;
  path: string;
  attrs: string[];
  validity: string;
  msgs: FakeMsg[];
}

export const SECRET = 'clave-ultra-secreta-123';

export class FakeServer {
  accounts: RemoteAccount[] = [];
  passwords: Record<string, string> = {};
  /** Cuentas con OAuth en las que se inició sesión. */
  logins = new Set<string>();
  folders: FakeFolder[] = [];
  sent: { id: string; recipients: string[]; raw: string }[] = [];
  appended: { folder: string; raw: string; seen: boolean }[] = [];
  flagCalls: { folder: string; keys: string[]; flag: string; on: boolean }[] = [];
  calls: string[] = [];
  /** Los argumentos de la última llamada de cada orden. */
  lastArgs: Record<string, Record<string, unknown>> = {};
  failWith: string | null = null;
  /** Falla solo esta orden (por ejemplo `mail_move`). */
  failOnly: string | null = null;
  /** ¿Lo borrado o movido en el servidor desaparece de aquí? Con POP3, no. */
  mirror = true;
  /** JMAP y Exchange guardan ellos mismos lo enviado en Enviados. */
  keepsSent = false;
  private next = 5000;

  static mail(key: string, subject: string, opts: { flags?: string[]; body?: string; extra?: string; messageId?: string; size?: number } = {}): FakeMsg {
    const body = opts.size ? 'x'.repeat(opts.size) : (opts.body ?? `cuerpo de ${subject}`);
    const raw = `From: Ana <ana@x.es>\r\nTo: yo@ejemplo.es\r\nSubject: ${subject}\r\nMessage-ID: ${opts.messageId ?? `<${key}@srv>`}\r\nDate: Mon, 3 Mar 2025 10:00:00 +0000\r\n${opts.extra ?? ''}\r\n${body}\r\n`;
    return { key, flags: opts.flags ?? [], raw };
  }

  folder(name: string): FakeFolder {
    const f = this.folders.find((x) => x.name === name);
    if (!f) throw new Error(`no hay carpeta ${name}`);
    return f;
  }
  add(name: string, attrs: string[] = [], msgs: FakeMsg[] = [], path = name): FakeFolder {
    const f: FakeFolder = { name, path, attrs, validity: '1', msgs };
    this.folders.push(f);
    return f;
  }
  keys(name: string): string[] {
    return this.folder(name).msgs.map((m) => m.key);
  }
  subjects(name: string): string[] {
    return this.folder(name).msgs.map((m) => /Subject: (.*)\r\n/.exec(m.raw)?.[1] ?? '');
  }
  /** Sin la conexión: lo que el usuario vería en el servidor. */
  find(subject: string): { folder: string; msg: FakeMsg } | null {
    for (const f of this.folders) for (const m of f.msgs) if (new RegExp(`^Subject: ${subject}\\r$`, 'm').test(m.raw)) return { folder: f.name, msg: m };
    return null;
  }

  transport: Transport = async (cmd, args = {}) => {
    this.calls.push(cmd);
    this.lastArgs[cmd] = args;
    if (cmd !== 'mail_accounts' && (this.failWith || this.failOnly === cmd)) throw new Error((this.failWith ?? 'Error de red: sin conexión') as string);
    const acc = (id: unknown) => this.accounts.find((a) => a.id === id);
    const folder = (name: unknown) => {
      const f = this.folders.find((x) => x.name === name);
      if (!f) throw new Error('El servidor rechazó la operación: no such mailbox');
      return f;
    };
    switch (cmd) {
      case 'mail_accounts':
        return JSON.parse(JSON.stringify(this.accounts));
      case 'mail_account_save': {
        const a = args.account as RemoteAccount;
        const old = acc(a.id);
        const oauth = a.auth?.kind === 'oauth';
        const dest = (x: RemoteAccount) => JSON.stringify([x.imap.host, x.imap.port, x.smtp.host, x.smtp.port, x.username, x.protocol ?? 'imap', x.url ?? null, x.auth?.kind ?? 'password', x.auth?.oauth ?? null]);
        if (oauth) {
          if (args.password) throw new Error('Una cuenta con OAuth no usa contraseña.');
          if ((!old || dest(old) !== dest(a)) && !this.logins.has(a.id)) throw new Error('Inicia sesión con el proveedor antes de guardar la cuenta.');
        } else {
          if (!old && !args.password) throw new Error('Escribe la contraseña de la cuenta.');
          if (old && !args.password && dest(old) !== dest(a)) throw new Error('Al cambiar el servidor, el puerto, el protocolo o el usuario hay que escribir la contraseña de nuevo.');
          if (args.password) this.passwords[a.id] = args.password as string;
        }
        this.accounts = [...this.accounts.filter((x) => x.id !== a.id), a];
        return null;
      }
      case 'mail_account_remove':
        this.accounts = this.accounts.filter((x) => x.id !== args.id);
        delete this.passwords[args.id as string];
        this.logins.delete(args.id as string);
        return null;
      case 'mail_oauth_login': {
        const a = args.account as RemoteAccount;
        if (!a.auth?.oauth?.client_id) throw new Error('Falta el identificador de cliente (Client ID) de la aplicación registrada.');
        this.logins.add(a.id);
        return null;
      }
      case 'mail_oauth_forget':
        this.logins.delete(args.id as string);
        return null;
      case 'mail_test': {
        const a = args.account as RemoteAccount;
        if (a.auth?.kind === 'oauth') {
          if (!this.logins.has(a.id)) throw new Error('Inicia sesión con el proveedor para probar la cuenta.');
          return null;
        }
        const pw = (args.password as string | null) ?? this.passwords[a.id];
        if (pw !== SECRET) throw new Error('El servidor no aceptó el usuario o la contraseña. Con Gmail, iCloud o Yahoo hace falta una contraseña de aplicación (Outlook.com y Microsoft 365 piden OAuth).');
        return null;
      }
      case 'mail_list_folders':
        return this.folders.map((f) => ({ name: f.name, path: f.path, delimiter: '/', attrs: f.attrs }));
      case 'mail_folder_state': {
        const f = folder(args.folder);
        const items = f.msgs.map((m) => ({ key: m.key, flags: m.flags, size: m.raw.length })).sort((a, b) => (Number(b.key) || 0) - (Number(a.key) || 0) || b.key.localeCompare(a.key));
        return { validity: f.validity, items, mirror_deletions: this.mirror };
      }
      case 'mail_fetch': {
        const f = folder(args.folder);
        const out = { messages: [] as { key: string; flags: string[]; raw: string }[], skipped: [] as { key: string; size: number }[] };
        for (const k of args.keys as string[]) {
          const m = f.msgs.find((x) => x.key === k);
          if (!m) continue;
          if (m.raw.length > (args.maxBytes as number)) out.skipped.push({ key: k, size: m.raw.length });
          else out.messages.push({ key: k, flags: m.flags, raw: encodeBase64(new TextEncoder().encode(m.raw)) });
        }
        return out;
      }
      case 'mail_set_flag': {
        const f = folder(args.folder);
        this.flagCalls.push({ folder: args.folder as string, keys: args.keys as string[], flag: args.flag as string, on: args.on as boolean });
        for (const m of f.msgs) {
          if (!(args.keys as string[]).includes(m.key)) continue;
          m.flags = m.flags.filter((x) => x !== args.flag);
          if (args.on) m.flags.push(args.flag as string);
        }
        return null;
      }
      case 'mail_move': {
        const from = folder(args.folder);
        const to = folder(args.to);
        const keys = args.keys as string[];
        for (const m of from.msgs.filter((x) => keys.includes(x.key))) to.msgs.push({ ...m, key: String(this.next++) });
        from.msgs = from.msgs.filter((x) => !keys.includes(x.key));
        return null;
      }
      case 'mail_remove': {
        const f = folder(args.folder);
        f.msgs = f.msgs.filter((x) => !(args.keys as string[]).includes(x.key));
        return null;
      }
      case 'mail_append': {
        const f = folder(args.folder);
        const raw = atob(args.raw as string);
        this.appended.push({ folder: f.name, raw, seen: args.seen as boolean });
        f.msgs.push({ key: String(this.next++), flags: args.seen ? ['\\Seen'] : [], raw });
        return null;
      }
      case 'mail_create_folder': {
        const path = args.path as string;
        if (this.folders.some((f) => f.path === path)) throw new Error('El servidor rechazó la operación: ya existe');
        this.add(path, [], [], path);
        return null;
      }
      case 'mail_delete_folder': {
        folder(args.folder);
        this.folders = this.folders.filter((f) => f.name !== args.folder);
        return null;
      }
      case 'mail_send': {
        this.sent.push({ id: args.id as string, recipients: args.recipients as string[], raw: atob(args.raw as string) });
        if (this.keepsSent) {
          const sent = this.folders.find((f) => f.attrs.includes('\\Sent'));
          sent?.msgs.push({ key: String(this.next++), flags: ['\\Seen'], raw: atob(args.raw as string) });
        }
        return null;
      }
      default:
        throw new Error(`orden desconocida: ${cmd}`);
    }
  };
}

export const account = (id = 'a1', name = 'Personal', over: Partial<RemoteAccount> = {}): RemoteAccount => ({
  id,
  name,
  email: `${id}@ejemplo.es`,
  username: id,
  imap: { host: 'imap.ejemplo.es', port: 993, security: 'tls' },
  smtp: { host: 'smtp.ejemplo.es', port: 465, security: 'tls' },
  protocol: 'imap',
  auth: { kind: 'password' },
  ...over,
});

/** Un servidor con la estructura típica: bandeja de entrada, enviados, borradores, papelera, archivo y carpetas con subcarpetas. */
export function standardServer(): FakeServer {
  const s = new FakeServer();
  s.add('INBOX', [], [FakeServer.mail('1', 'Uno', { flags: ['\\Seen'] }), FakeServer.mail('2', 'Dos'), FakeServer.mail('3', 'Tres', { flags: ['\\Flagged'] })]);
  s.add('Sent', ['\\Sent']);
  s.add('Drafts', ['\\Drafts']);
  s.add('Trash', ['\\Trash']);
  s.add('Archive', ['\\Archive']);
  s.add('Trabajo', ['\\Noselect']);
  s.add('Trabajo/Proyecto A', [], [FakeServer.mail('1', 'Informe del proyecto')]);
  s.add('Trabajo/Proyecto A/Fase 1', [], [FakeServer.mail('1', 'Detalle de la fase')]);
  s.add('Personal', [], [FakeServer.mail('1', 'Cena del sábado')]);
  return s;
}
