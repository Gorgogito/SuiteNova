import { buildMessage, parseMessage, rawOf, serializeMail, parseMailData } from '@suitenova/mail-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MailCtl, type ComposeState } from './ctl';
import { FakeServer, account, standardServer } from './fake-server';
import { PRESETS, authOf, protocolOf, savesSentCopy, setTransport } from './remote';

let srv: FakeServer;
let ctl: MailCtl;
beforeEach(async () => {
  srv = standardServer();
  srv.accounts = [account()];
  setTransport(srv.transport);
  ctl = new MailCtl();
  await ctl.loadAccounts();
});
const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
afterEach(() => {
  ctl.dispose();
  setTransport(null);
  vi.useRealTimers();
  store.clear();
});

const compose = (over: Partial<ComposeState> = {}): ComposeState => ({ id: 'c1', to: 'luis@x.es', cc: '', bcc: '', subject: 'Hola', body: 'Texto', attachments: [], ...over });
const subjectsIn = (folder: string) => ctl.data.messages.filter((m) => m.folder === folder).map((m) => m.subject).sort();
const rec = (subject: string) => ctl.data.messages.find((m) => m.subject === subject)!;
const folderOf = (path: string) => ctl.data.folders.find((f) => f.remote?.path === path)!;

describe('sincronizar todas las carpetas', () => {
  it('baja la bandeja de entrada con sus marcas y también las demás carpetas, con su jerarquía', async () => {
    await ctl.syncAll();
    expect(ctl.accounts.map((a) => a.id)).toEqual(['a1']);
    expect(ctl.data.messages.filter((m) => m.folder === 'inbox').map((m) => [m.subject, m.read, m.flagged]).sort()).toEqual([['Dos', false, false], ['Tres', false, true], ['Uno', true, false]]);
    const proyecto = folderOf('Trabajo/Proyecto A');
    const fase = folderOf('Trabajo/Proyecto A/Fase 1');
    expect(ctl.data.folders.find((f) => f.id === 'c:a1:Trabajo')!.name).toBe('Trabajo');
    expect(proyecto.parent).toBe('c:a1:Trabajo');
    expect(fase.parent).toBe(proyecto.id);
    expect(subjectsIn(proyecto.id)).toEqual(['Informe del proyecto']);
    expect(subjectsIn(fase.id)).toEqual(['Detalle de la fase']);
    expect(subjectsIn(folderOf('Personal').id)).toEqual(['Cena del sábado']);
    expect(ctl.syncMessage).toMatch(/Sincronizado a las .*6 mensajes nuevos/);
    expect(ctl.syncing).toBe(false);
    expect(ctl.dirty).toBe(true);
  });
  it('la segunda vez solo baja lo nuevo', async () => {
    await ctl.syncAll();
    srv.folder('INBOX').msgs.push(FakeServer.mail('4', 'Cuatro'));
    srv.calls.length = 0;
    await ctl.syncAll();
    expect(subjectsIn('inbox')).toEqual(['Cuatro', 'Dos', 'Tres', 'Uno']);
    expect(ctl.syncMessage).toMatch(/1 mensaje nuevo/);
    expect(srv.calls.filter((c) => c === 'mail_fetch')).toHaveLength(1);
    await ctl.syncAll();
    expect(ctl.syncMessage).toMatch(/0 mensajes nuevos/);
    expect(srv.calls.filter((c) => c === 'mail_fetch')).toHaveLength(1);
  });
  it('lo que cambia en el servidor se refleja: borrados, mensajes movidos, marcas y carpetas nuevas o quitadas', async () => {
    await ctl.syncAll();
    // otro cliente: borra «Uno», marca «Dos» como leído y con bandera, y mueve «Cena del sábado» a la bandeja de entrada
    srv.folder('INBOX').msgs = srv.folder('INBOX').msgs.filter((m) => m.key !== '1');
    srv.folder('INBOX').msgs.find((m) => m.key === '2')!.flags = ['\\Seen', '\\Flagged'];
    srv.folder('Personal').msgs = [];
    srv.folder('INBOX').msgs.push(FakeServer.mail('9', 'Cena del sábado'));
    srv.add('Nueva', [], [FakeServer.mail('1', 'En la carpeta nueva')]);
    srv.folders = srv.folders.filter((f) => f.name !== 'Trabajo/Proyecto A/Fase 1');
    await ctl.syncAll();
    expect(subjectsIn('inbox')).toEqual(['Cena del sábado', 'Dos', 'Tres']);
    expect([rec('Dos').read, rec('Dos').flagged]).toEqual([true, true]);
    expect(subjectsIn(folderOf('Personal').id)).toEqual([]);
    expect(subjectsIn(folderOf('Nueva').id)).toEqual(['En la carpeta nueva']);
    expect(ctl.data.folders.some((f) => f.remote?.path === 'Trabajo/Proyecto A/Fase 1')).toBe(false);
    expect(ctl.data.messages.some((m) => m.subject === 'Detalle de la fase')).toBe(false);
    expect(ctl.syncMessage).toMatch(/quitados|quitado/);
  });
  it('solo se conservan los N más nuevos de cada carpeta', async () => {
    srv.folder('INBOX').msgs = Array.from({ length: 150 }, (_, i) => FakeServer.mail(String(i + 1), `M${i + 1}`));
    ctl.setSyncSettings({ limit: 100 });
    await ctl.syncAll();
    const inbox = ctl.data.messages.filter((m) => m.folder === 'inbox');
    expect(inbox).toHaveLength(100);
    expect(inbox.some((m) => m.subject === 'M150')).toBe(true);
    expect(inbox.some((m) => m.subject === 'M50')).toBe(false);
    ctl.setSyncSettings({ limit: 500 });
    await ctl.syncAll();
    expect(ctl.data.messages.filter((m) => m.folder === 'inbox')).toHaveLength(150);
  });
  it('los mensajes enormes no se descargan y se avisa', async () => {
    srv.folder('INBOX').msgs.push(FakeServer.mail('4', 'Gigante', { size: 26 * 1024 * 1024 }));
    await ctl.syncAll();
    expect(ctl.data.messages.some((m) => m.subject === 'Gigante')).toBe(false);
    expect(ctl.syncMessage).toMatch(/1 demasiado grandes/);
  });
  it('si el servidor renumera la carpeta se baja de nuevo y lo local no se toca', async () => {
    await ctl.syncAll();
    ctl.newMessage();
    ctl.saveDraft(compose());
    srv.folder('INBOX').validity = '99';
    srv.folder('INBOX').msgs = [FakeServer.mail('1', 'Nuevo uno'), FakeServer.mail('2', 'Nuevo dos')];
    await ctl.syncAll();
    expect(subjectsIn('inbox')).toEqual(['Nuevo dos', 'Nuevo uno']);
    expect(ctl.data.messages.some((m) => m.folder === 'drafts')).toBe(true);
  });
  it('los errores se explican, una carpeta con problemas no detiene a las demás y nada se pierde', async () => {
    srv.failWith = 'El servidor no aceptó el usuario o la contraseña.';
    await ctl.syncAll();
    expect(ctl.syncMessage).toMatch(/Error al sincronizar: Personal: El servidor no aceptó/);
    expect(ctl.syncing).toBe(false);
    srv.failWith = null;
    srv.folders = srv.folders.filter((f) => f.name !== 'Drafts');
    srv.add('Drafts', ['\\Drafts']);
    await ctl.syncAll();
    expect(ctl.data.messages).toHaveLength(6);
    // una carpeta cuya lectura falla: se cuenta el error y se sigue con las otras
    const original = srv.transport;
    setTransport(async (cmd, args = {}) => {
      if (cmd === 'mail_folder_state' && args.folder === 'Personal') throw new Error('El servidor rechazó la operación: bloqueada');
      return original(cmd, args);
    });
    srv.folder('INBOX').msgs.push(FakeServer.mail('4', 'Cuatro'));
    await ctl.syncAll();
    expect(ctl.syncMessage).toMatch(/Error al sincronizar: Personal \(Personal\): El servidor rechazó la operación: bloqueada/);
    expect(subjectsIn('inbox')).toContain('Cuatro');
  });
  it('sin cuentas lo dice, y no se sincroniza dos veces a la vez', async () => {
    const vacio = new MailCtl();
    await vacio.syncAll();
    expect(vacio.syncMessage).toMatch(/ninguna cuenta/);
    srv.calls.length = 0;
    await Promise.all([ctl.syncAll(), ctl.syncAll()]);
    expect(srv.calls.filter((c) => c === 'mail_list_folders')).toHaveLength(1);
  });
  it('varias cuentas: cada una con sus carpetas y sus mensajes', async () => {
    srv.accounts = [account('a1'), account('a2', 'Trabajo')];
    await ctl.loadAccounts();
    await ctl.syncAll();
    expect(ctl.data.messages.filter((m) => m.remote?.account === 'a1')).toHaveLength(6);
    expect(ctl.data.messages.filter((m) => m.remote?.account === 'a2')).toHaveLength(6);
    expect(ctl.data.folders.filter((f) => f.remote?.path === 'Personal').map((f) => f.id).sort()).toEqual(['s:a1:Personal', 's:a2:Personal']);
    expect(Object.keys(ctl.data.sync ?? {}).filter((k) => k.endsWith('|INBOX')).sort()).toEqual(['a1|INBOX', 'a2|INBOX']);
  });
  it('POP3: solo la bandeja de entrada; lo que desaparece del servidor se conserva aquí', async () => {
    srv = new FakeServer();
    srv.mirror = false;
    srv.add('INBOX', [], [FakeServer.mail('u1', 'Primero'), FakeServer.mail('u2', 'Segundo')]);
    srv.accounts = [account('p1', 'Correo antiguo', { protocol: 'pop3' })];
    setTransport(srv.transport);
    await ctl.loadAccounts();
    await ctl.syncAll();
    expect(subjectsIn('inbox')).toEqual(['Primero', 'Segundo']);
    srv.folder('INBOX').msgs = [FakeServer.mail('u3', 'Tercero')];
    await ctl.syncAll();
    expect(subjectsIn('inbox')).toEqual(['Primero', 'Segundo', 'Tercero']);
    // moverlo a otra carpeta de Nova Mail es local (POP3 no tiene carpetas)
    expect(ctl.move(rec('Primero').id, 'archive')).toBe(true);
    expect(srv.calls).not.toContain('mail_move');
    expect(ctl.data.pending).toBeUndefined();
    await ctl.syncAll();
    expect(ctl.data.messages.filter((m) => m.subject === 'Primero')).toHaveLength(1);
  });
});

describe('lo que se hace aquí también se hace en el servidor', () => {
  beforeEach(async () => {
    await ctl.syncAll();
  });

  it('eliminar manda el mensaje a la papelera del servidor; desde la papelera se borra para siempre', async () => {
    const dos = rec('Dos');
    ctl.delete(dos.id);
    expect(dos.folder).toBe('trash');
    await ctl.flush();
    expect(srv.keys('INBOX')).toEqual(['1', '3']);
    expect(srv.subjects('Trash')).toEqual(['Dos']);
    expect(ctl.pendingCount).toBe(0);
    // se reconoce al sincronizar: no queda repetido
    await ctl.syncAll();
    expect(ctl.data.messages.filter((m) => m.subject === 'Dos')).toHaveLength(1);
    expect(rec('Dos').remote).toEqual({ account: 'a1', folder: 'Trash', key: srv.keys('Trash')[0] });
    // otra vez desde la papelera: para siempre
    ctl.delete(rec('Dos').id);
    await ctl.flush();
    expect(srv.keys('Trash')).toEqual([]);
    expect(ctl.data.messages.some((m) => m.subject === 'Dos')).toBe(false);
    await ctl.syncAll();
    expect(ctl.data.messages.some((m) => m.subject === 'Dos')).toBe(false);
  });
  it('archivar y mover a una carpeta del servidor, incluidas las subcarpetas', async () => {
    expect(ctl.move(rec('Uno').id, 'archive')).toBe(true);
    expect(ctl.move(rec('Tres').id, folderOf('Trabajo/Proyecto A/Fase 1').id)).toBe(true);
    await ctl.flush();
    expect(srv.subjects('Archive')).toEqual(['Uno']);
    expect(srv.subjects('Trabajo/Proyecto A/Fase 1').sort()).toEqual(['Detalle de la fase', 'Tres']);
    expect(srv.keys('INBOX')).toEqual(['2']);
    await ctl.syncAll();
    expect(ctl.data.messages.filter((m) => m.subject === 'Uno' || m.subject === 'Tres')).toHaveLength(2);
    expect(rec('Tres').folder).toBe(folderOf('Trabajo/Proyecto A/Fase 1').id);
    expect(rec('Tres').remote!.folder).toBe('Trabajo/Proyecto A/Fase 1');
  });
  it('no se puede mover un mensaje del servidor a una carpeta que solo existe aquí', async () => {
    ctl.addFolder('Solo local');
    const local = ctl.data.folders.find((f) => f.name === 'Solo local')!;
    expect(ctl.move(rec('Dos').id, local.id)).toBe(false);
    expect(rec('Dos').folder).toBe('inbox');
    expect(ctl.syncMessage).toMatch(/no tiene una carpeta equivalente en el servidor/);
    expect(ctl.data.pending).toBeUndefined();
  });
  it('las marcas van al servidor, juntas; un mensaje solo local no genera llamadas', async () => {
    const dos = rec('Dos');
    ctl.select(dos.id);
    ctl.toggleFlag(dos.id);
    ctl.setRead(dos.id, false);
    ctl.reply(dos.id, false);
    await ctl.flush();
    const f = srv.folder('INBOX').msgs.find((m) => m.key === '2')!;
    expect(f.flags.sort()).toEqual(['\\Answered', '\\Flagged']);
    expect(srv.flagCalls.every((c) => c.keys.join() === '2')).toBe(true);
    const n = srv.flagCalls.length;
    const local = ctl.importRaw(buildMessage({ from: { name: '', email: 'a@x.es' }, to: [{ name: '', email: 'b@x.es' }], subject: 'Local', text: 'x' }), 'inbox');
    ctl.setRead(local.id, true);
    await ctl.flush();
    expect(srv.flagCalls).toHaveLength(n);
  });
  it('si no hay conexión el cambio local se mantiene, se avisa y se reintenta en la siguiente sincronización', async () => {
    const dos = rec('Dos');
    srv.failWith = 'Error de red: sin conexión';
    ctl.setRead(dos.id, true);
    ctl.delete(rec('Tres').id);
    await ctl.flush();
    expect(dos.read).toBe(true);
    expect(ctl.syncMessage).toMatch(/No se pudo actualizar el servidor \(se reintentará\): Personal: Error de red/);
    expect(ctl.pendingCount).toBeGreaterThan(0);
    // mientras tanto, lo borrado aquí no se vuelve a bajar aunque el servidor lo siga teniendo
    srv.failWith = null;
    const original = srv.transport;
    let blocked = true;
    setTransport(async (cmd, args = {}) => {
      if (blocked && ['mail_move', 'mail_remove', 'mail_set_flag'].includes(cmd)) throw new Error('Error de red: sin conexión');
      return original(cmd, args);
    });
    await ctl.syncAll();
    expect(ctl.data.messages.filter((m) => m.subject === 'Tres')).toHaveLength(1);
    expect(rec('Tres').folder).toBe('trash');
    // vuelve la conexión
    blocked = false;
    await ctl.syncAll();
    expect(ctl.pendingCount).toBe(0);
    expect(srv.subjects('Trash')).toEqual(['Tres']);
    expect(srv.folder('INBOX').msgs.find((m) => m.key === '2')!.flags).toContain('\\Seen');
  });
  it('vaciar la papelera borra para siempre los mensajes del servidor', async () => {
    ctl.delete(rec('Uno').id);
    ctl.delete(rec('Dos').id);
    await ctl.flush();
    await ctl.syncAll();
    expect(srv.keys('Trash')).toHaveLength(2);
    expect(ctl.emptyFolder('trash')).toBe(2);
    await ctl.flush();
    expect(srv.keys('Trash')).toEqual([]);
    expect(subjectsIn('trash')).toEqual([]);
  });
  it('carpetas: subcarpetas locales, subcarpetas en el servidor y eliminar', async () => {
    ctl.addFolder('Local', null);
    const local = ctl.data.folders.find((f) => f.name === 'Local')!;
    ctl.addFolder('Hija', local.id);
    expect(() => ctl.addFolder('hija', local.id)).toThrow(/Ya existe/);
    expect(() => ctl.addFolder('a/b')).toThrow(/barras/);
    expect(ctl.data.folders.find((f) => f.name === 'Hija')!.parent).toBe(local.id);
    expect(() => ctl.deleteFolder(local.id)).toThrow(/subcarpetas/);
    ctl.deleteFolder(ctl.data.folders.find((f) => f.name === 'Hija')!.id);
    ctl.deleteFolder(local.id);
    // en el servidor
    await ctl.addServerFolder('a1', 'Clientes', 'c:a1:Trabajo');
    expect(srv.folders.some((f) => f.path === 'Trabajo/Clientes')).toBe(true);
    expect(folderOf('Trabajo/Clientes').parent).toBe('c:a1:Trabajo');
    await ctl.addServerFolder('a1', 'Facturas', 'inbox');
    expect(srv.folders.some((f) => f.path === 'INBOX/Facturas')).toBe(true);
    expect(folderOf('INBOX/Facturas').parent).toBe('inbox');
    await expect(ctl.addServerFolder('a1', 'X', 'carpeta-que-no-existe')).rejects.toThrow(/no está en la cuenta/);
    // eliminar una carpeta del servidor la borra allí con sus mensajes
    const personal = folderOf('Personal');
    ctl.deleteFolder(personal.id);
    expect(ctl.data.messages.some((m) => m.subject === 'Cena del sábado')).toBe(false);
    await ctl.flush();
    expect(srv.folders.some((f) => f.name === 'Personal')).toBe(false);
    expect(() => ctl.deleteFolder(folderOf('Trabajo/Proyecto A').id)).toThrow(/subcarpetas/);
  });
  it('lo pendiente se guarda en el archivo y se retoma al abrirlo', async () => {
    ctl.delete(rec('Dos').id);
    ctl.setRead(rec('Tres').id, true);
    const text = serializeMail(ctl.data);
    expect(parseMailData(text).pending).toHaveLength(2);
    const otra = new MailCtl();
    otra.load(parseMailData(text), null, null);
    await otra.loadAccounts();
    await otra.flush();
    expect(srv.subjects('Trash')).toEqual(['Dos']);
    expect(otra.pendingCount).toBe(0);
    otra.dispose();
  });
  it('quitar una cuenta descarta lo que quedaba pendiente para ella pero conserva sus mensajes', async () => {
    srv.failWith = 'Error de red: sin conexión';
    ctl.delete(rec('Dos').id);
    await ctl.flush();
    expect(ctl.pendingCount).toBe(1);
    ctl.forgetAccount('a1');
    expect(ctl.pendingCount).toBe(0);
    expect(subjectsIn('trash')).toEqual(['Dos']);
  });
});

describe('sincronización automática', () => {
  it('se repite cada cierto tiempo, se puede apagar y recuerda la preferencia', async () => {
    vi.useFakeTimers();
    ctl.setSyncSettings({ autoMinutes: 1 });
    srv.calls.length = 0;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(srv.calls.filter((c) => c === 'mail_list_folders')).toHaveLength(1);
    expect(ctl.data.messages.length).toBeGreaterThan(0);
    srv.folder('INBOX').msgs.push(FakeServer.mail('4', 'Llegó solo'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(subjectsIn('inbox')).toContain('Llegó solo');
    ctl.setSyncSettings({ autoMinutes: 0 });
    srv.calls.length = 0;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(srv.calls).toEqual([]);
    const again = new MailCtl();
    again.startSync();
    expect(again.autoMinutes).toBe(0);
    again.dispose();
    ctl.setSyncSettings({ autoMinutes: 7 });
    expect(ctl.autoMinutes).toBe(0);
  });
  it('la automática no dice nada si no hay cuentas', async () => {
    const vacio = new MailCtl();
    await vacio.syncAll({ auto: true });
    expect(vacio.syncMessage).toBe('');
  });
});

describe('enviar', () => {
  it('envía con la cuenta elegida, incluye los destinatarios ocultos en el sobre y guarda copia en Enviados', async () => {
    await ctl.syncAll();
    ctl.newMessage();
    const c = compose({ to: 'Luis <luis@x.es>', cc: 'cc@x.es', bcc: 'oculta@x.es', subject: 'Reunión', body: 'Hola, ¿mañana?' });
    ctl.saveDraft(c);
    await ctl.send(c, 'a1');
    expect(srv.sent).toHaveLength(1);
    expect(srv.sent[0]!.recipients).toEqual(['luis@x.es', 'cc@x.es', 'oculta@x.es']);
    const raw = srv.sent[0]!.raw;
    expect(raw).toMatch(/From: .*<a1@ejemplo.es>/);
    expect(raw).not.toContain('oculta@x.es');
    expect(parseMessage(Uint8Array.from(raw, (ch) => ch.charCodeAt(0))).subject).toBe('Reunión');
    expect(ctl.compose).toBeNull();
    const sent = ctl.data.messages.filter((m) => m.folder === 'sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.bcc).toEqual(['oculta@x.es']);
    expect(ctl.data.messages.some((m) => m.folder === 'drafts')).toBe(false);
    expect(ctl.syncMessage).toMatch(/Mensaje enviado a 3 destinatarios/);
    // IMAP en un proveedor que no guarda su copia: se guarda en Enviados del servidor, una sola vez
    await ctl.flush();
    expect(srv.appended).toHaveLength(1);
    expect(srv.appended[0]!.folder).toBe('Sent');
    expect(srv.appended[0]!.seen).toBe(true);
    expect(parseMessage(Uint8Array.from(srv.appended[0]!.raw, (ch) => ch.charCodeAt(0))).subject).toBe('Reunión');
    await ctl.syncAll();
    expect(ctl.data.messages.filter((m) => m.subject === 'Reunión')).toHaveLength(1);
    expect(rec('Reunión').remote!.folder).toBe('Sent');
    expect(rec('Reunión').bcc).toEqual(['oculta@x.es']);
  });
  it('Gmail y Outlook guardan su propia copia: no se vuelve a guardar; con JMAP y Exchange tampoco', async () => {
    srv.accounts = [account('g', 'Gmail', { imap: { host: 'imap.gmail.com', port: 993, security: 'tls' } }), account('j', 'JMAP', { protocol: 'jmap', url: 'https://x.example/jmap' })];
    await ctl.loadAccounts();
    await ctl.syncAll();
    await ctl.send(compose(), 'g');
    await ctl.send(compose(), 'j');
    await ctl.flush();
    expect(srv.appended).toHaveLength(0);
    // el usuario puede decidirlo cuenta por cuenta
    expect(savesSentCopy(account('x', 'x', { save_sent: true, imap: { host: 'imap.gmail.com', port: 993, security: 'tls' } }))).toBe(true);
    expect(savesSentCopy(account('x', 'x', { save_sent: false }))).toBe(false);
    expect(savesSentCopy(account('x'))).toBe(true);
    expect(savesSentCopy(account('x', 'x', { imap: { host: 'outlook.office365.com', port: 993, security: 'tls' } }))).toBe(false);
  });
  it('antes de la primera sincronización no se conoce Enviados: se avisa', async () => {
    await ctl.send(compose(), 'a1');
    expect(ctl.syncMessage).toMatch(/la copia en Enviados del servidor no se guardó/);
    expect(srv.appended).toHaveLength(0);
  });
  it('el remitente es siempre la dirección de la cuenta', async () => {
    ctl.setOwner({ name: 'Otra Persona', email: 'otra@ejemplo.es' });
    await ctl.send(compose(), 'a1');
    const raw = srv.sent[0]!.raw;
    expect(raw).toContain('a1@ejemplo.es');
    expect(raw).not.toContain('otra@ejemplo.es');
  });
  it('un fallo no pierde el mensaje: sigue abierto para corregirlo', async () => {
    ctl.newMessage('luis@x.es');
    const c = ctl.compose!;
    srv.failWith = 'No se pudo conectar con smtp.ejemplo.es:465';
    await expect(ctl.send(c, 'a1')).rejects.toThrow(/No se pudo conectar/);
    expect(ctl.compose).toBe(c);
    expect(ctl.data.messages.filter((m) => m.folder === 'sent')).toHaveLength(0);
  });
  it('rechaza lo que no tiene sentido antes de tocar la red', async () => {
    await expect(ctl.send(compose({ to: '' }), 'a1')).rejects.toThrow(/destinatario/);
    await expect(ctl.send(compose({ to: 'no es una dirección' }), 'a1')).rejects.toThrow(/no es válida/);
    await expect(ctl.send(compose({ to: 'a@b.c\r\nBcc: x@y.z' }), 'a1')).rejects.toThrow(/no es válida/);
    await expect(ctl.send(compose(), 'inexistente')).rejects.toThrow(/Elige la cuenta/);
    expect(srv.sent).toHaveLength(0);
  });
  it('con adjuntos y texto con acentos, el mensaje enviado se lee igual', async () => {
    const c = compose({ body: 'Contraseña: ñandú — €', attachments: [{ filename: 'a.txt', contentType: 'text/plain', data: new TextEncoder().encode('adjunto') }] });
    await ctl.send(c, 'a1');
    const parsed = parseMessage(Uint8Array.from(srv.sent[0]!.raw, (ch) => ch.charCodeAt(0)));
    expect(parsed.text?.trim()).toBe('Contraseña: ñandú — €');
    expect(parsed.attachments.map((a) => a.filename)).toEqual(['a.txt']);
    expect(rawOf(ctl.data.messages.find((m) => m.folder === 'sent')!).length).toBeGreaterThan(100);
  });
});

describe('proveedores', () => {
  it('todos usan conexión cifrada y explican cómo iniciar sesión', () => {
    for (const p of PRESETS) {
      if (p.protocol === 'imap' || p.protocol === 'pop3') {
        expect(['tls', 'starttls']).toContain(p.imap.security);
        expect(['tls', 'starttls']).toContain(p.smtp.security);
      } else {
        expect(p.url === '' || p.url!.startsWith('https://')).toBe(true);
      }
      expect(p.hint.length).toBeGreaterThan(20);
      expect(p.auth.length).toBeGreaterThan(0);
    }
    expect(PRESETS.find((p) => p.id === 'gmail')!.imap).toEqual({ host: 'imap.gmail.com', port: 993, security: 'tls' });
  });
  it('Gmail y Outlook ofrecen OAuth primero; Fastmail JMAP, un token; hay POP3, JMAP y Exchange', () => {
    expect(PRESETS.find((p) => p.id === 'gmail')).toMatchObject({ auth: ['oauth', 'password'], oauth: 'google' });
    expect(PRESETS.find((p) => p.id === 'outlook')).toMatchObject({ auth: ['oauth', 'password'], oauth: 'microsoft' });
    expect(PRESETS.find((p) => p.id === 'fastmail')).toMatchObject({ protocol: 'jmap', auth: ['token', 'password'] });
    expect(new Set(PRESETS.map((p) => p.protocol))).toEqual(new Set(['imap', 'pop3', 'jmap', 'ews']));
    expect(PRESETS.find((p) => p.id === 'exchange')!.hint).toMatch(/1 de octubre de 2026/);
    expect(protocolOf(account())).toBe('imap');
    expect(authOf(account('x', 'x', { auth: { kind: 'oauth' } }))).toBe('oauth');
  });
});
