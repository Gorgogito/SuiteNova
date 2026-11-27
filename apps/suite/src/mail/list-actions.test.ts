import { buildMessage, parseMailData, serializeMail } from '@suitenova/mail-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { safeFileName } from './attachments';
import { MailCtl } from './ctl';
import { account, standardServer, type FakeServer } from './fake-server';
import { setTransport } from './remote';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });

let ctl: MailCtl;
const add = (subject: string, day: number, folder = 'inbox', extra: { replyTo?: string } = {}) =>
  ctl.importRaw(
    buildMessage({ from: { name: 'Ana', email: 'ana@x.es' }, to: [{ name: '', email: 'yo@x.es' }], cc: [], bcc: [], subject, text: 't', attachments: [], date: new Date(2026, 2, day, 10), messageId: `<${subject.replace(/\W/g, '')}@x>`, inReplyTo: extra.replyTo, references: extra.replyTo ? [extra.replyTo] : undefined }),
    folder,
    { read: false },
  );
const subjects = () => ctl.list().map((m) => m.subject);
const picked = () => ctl.selectedRecords.map((m) => m.subject).sort();
const folderOfMail = (subject: string) => ctl.data.messages.find((m) => m.subject === subject)?.folder;
const rowKey = (subject: string) => ctl.rows().find((r) => r.type === 'message' && !r.child && r.rec.subject === subject)!.key;

describe('selección, deshacer y carpetas (en este equipo)', () => {
  beforeEach(() => {
    ctl = new MailCtl();
    ctl.setView({ groups: false });
    for (const [s, d] of [['A', 5], ['B', 4], ['C', 3], ['D', 2], ['E', 1]] as const) add(s, d);
  });
  afterEach(() => {
    ctl.dispose();
    store.clear();
  });

  it('un clic, con Ctrl y con Mayús', () => {
    ctl.selectRow(rowKey('B'));
    expect(picked()).toEqual(['B']);
    expect(ctl.selected!.read).toBe(true);
    ctl.selectRow(rowKey('D'), { range: true });
    expect(picked()).toEqual(['B', 'C', 'D']);
    ctl.selectRow(rowKey('C'), { add: true });
    expect(picked()).toEqual(['B', 'D']);
    ctl.selectRow(rowKey('A'), { add: true });
    expect(picked()).toEqual(['A', 'B', 'D']);
    // marcar varios no los lee
    expect(ctl.data.messages.find((m) => m.subject === 'C')!.read).toBe(false);
    ctl.selectAll();
    expect(picked()).toHaveLength(5);
    ctl.selectRow(rowKey('E'));
    expect(picked()).toEqual(['E']);
  });

  it('al quitar mensajes se pasa al siguiente', () => {
    ctl.selectRow(rowKey('B'));
    ctl.selectRow(rowKey('C'), { range: true });
    ctl.deleteMany(ctl.selectedIds());
    expect(subjects()).toEqual(['A', 'D', 'E']);
    expect(ctl.selected!.subject).toBe('D');
    ctl.selectRow(rowKey('E'));
    ctl.moveMany(ctl.selectedIds(), 'archive');
    expect(ctl.selected!.subject).toBe('D');
    // quitar otro que no es el que se lee no cambia lo que se lee
    ctl.delete(ctl.data.messages.find((m) => m.subject === 'A')!.id);
    expect(ctl.selected!.subject).toBe('D');
  });

  it('deshacer, paso a paso: mover, eliminar, marcas y borrar para siempre', () => {
    const id = (s: string) => ctl.data.messages.find((m) => m.subject === s)!.id;
    ctl.moveMany([id('A'), id('B')], 'archive');
    ctl.setReadMany([id('C'), id('D')], true);
    ctl.setFlagMany([id('C')], true);
    ctl.deleteMany([id('E')]);
    ctl.deleteMany([id('E')]); // desde Eliminados: para siempre
    expect(ctl.data.messages).toHaveLength(4);
    expect(ctl.undoLabel).toBe('Eliminar');
    ctl.undo();
    expect(folderOfMail('E')).toBe('trash');
    ctl.undo();
    expect(folderOfMail('E')).toBe('inbox');
    ctl.undo();
    expect(ctl.data.messages.find((m) => m.subject === 'C')!.flagged).toBe(false);
    ctl.undo();
    expect(ctl.data.messages.filter((m) => m.read).map((m) => m.subject)).toEqual([]);
    ctl.undo();
    expect(subjects()).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(picked()).toEqual(['A', 'B']);
    expect(ctl.undoLabel).toBe('');
    ctl.undo(); // sin nada que deshacer
    expect(ctl.data.messages).toHaveLength(5);
  });

  it('deshacer un movimiento no cambia lo que se leyó o marcó después', () => {
    const id = ctl.data.messages.find((m) => m.subject === 'B')!.id;
    ctl.move(id, 'archive');
    ctl.setFolder('archive');
    ctl.select(id); // se lee allí
    ctl.undo();
    expect([folderOfMail('B'), ctl.data.messages.find((m) => m.id === id)!.read]).toEqual(['inbox', true]);
  });

  it('abrir un borrador no deja marcada la selección anterior', () => {
    ctl.selectRow(rowKey('A'));
    ctl.selectRow(rowKey('C'), { range: true });
    ctl.selectedId = ctl.data.messages.find((m) => m.subject === 'E')!.id;
    expect(picked()).toEqual(['E']);
    expect(ctl.isSelected(ctl.data.messages.find((m) => m.subject === 'A')!.id)).toBe(false);
  });

  it('los nombres de los adjuntos no pueden salirse de la carpeta ni engañar', () => {
    const taken = new Set<string>();
    const safe = (n: string) => safeFileName(n, taken);
    expect(safe('..\\..\\Windows\\evil.dll')).toBe('evil.dll');
    expect(safe('/etc/passwd')).toBe('passwd');
    expect(safe('..')).toBe('adjunto');
    expect(safe('CON.txt')).toBe('_CON.txt');
    expect(safe('a<b>:c?.pdf. ')).toBe('a_b__c_.pdf');
    expect(safe('foto\u202egnp.exe')).toBe('fotognp.exe');
    expect(safe('Informe.pdf')).toBe('Informe.pdf');
    expect(safe('informe.PDF')).toBe('informe (2).PDF');
    expect(safe(`${'x'.repeat(300)}.txt`)).toHaveLength(154);
  });

  it('eliminar para siempre pregunta solo cuando hace falta', () => {
    const id = ctl.data.messages[0]!.id;
    expect(ctl.deleteQuestion([id])).toBeNull();
    expect(ctl.deleteQuestion([id], true)).toBe('local');
    ctl.delete(id);
    expect(ctl.deleteQuestion([id])).toBeNull(); // local: se puede deshacer
    ctl.data.messages.find((m) => m.id === id)!.remote = { account: 'a', folder: 'Trash', key: '1' };
    expect(ctl.deleteQuestion([id])).toBe('server');
  });

  it('con un filtro, lo que se lee sigue a la vista hasta cambiar de filtro o de carpeta', () => {
    ctl.setView({ filter: 'unread' });
    ctl.selectRow(rowKey('B'));
    expect(subjects()).toEqual(['A', 'B', 'C', 'D', 'E']);
    ctl.setFolder('archive');
    ctl.setFolder('inbox');
    expect(subjects()).toEqual(['A', 'C', 'D', 'E']);
    ctl.setView({ filter: 'all' });
    expect(subjects()).toHaveLength(5);
  });

  it('la vista se recuerda', () => {
    ctl.setView({ sort: 'subject', reverse: true, conversations: true });
    const other = new MailCtl();
    expect(other.view).toMatchObject({ sort: 'subject', reverse: true, conversations: true, groups: false });
    other.dispose();
  });

  it('una conversación se selecciona entera desde su encabezado y se abre', () => {
    add('Re: C', 6, 'inbox', { replyTo: '<C@x>' });
    add('Re: Re: C', 7, 'sent', { replyTo: '<ReC@x>' });
    ctl.setView({ conversations: true });
    const head = ctl.rows().find((r) => r.type === 'message' && !!r.thread)!;
    expect(head.type === 'message' && [head.rec.subject, head.thread!.members.length, head.thread!.ids.length]).toEqual(['Re: C', 3, 2]);
    ctl.selectRow(head.key);
    expect(picked()).toEqual(['C', 'Re: C']);
    expect(ctl.selectedThread).not.toBeNull();
    expect(ctl.single!.subject).toBe('Re: C'); // responder contesta a lo último
    ctl.toggleThread(ctl.selectedThread!);
    expect(ctl.rows().filter((r) => r.type === 'message' && r.child)).toHaveLength(3);
    ctl.selectRow(ctl.rows().find((r) => r.type === 'message' && r.child && r.rec.subject === 'C')!.key);
    expect(picked()).toEqual(['C']);
    expect(ctl.selectedThread).toBeNull();
    ctl.selectRow(head.key);
    ctl.deleteMany(ctl.selectedIds());
    expect(subjects()).toEqual(['A', 'B', 'D', 'E']);
    expect(folderOfMail('Re: Re: C')).toBe('sent'); // lo de otras carpetas no se toca
  });

  it('renombrar, mover y marcar como leída una carpeta; favoritos', async () => {
    ctl.addFolder('Clientes');
    ctl.addFolder('Viejas');
    const [a, b] = ['Clientes', 'Viejas'].map((n) => ctl.data.folders.find((f) => f.name === n)!.id) as [string, string];
    await ctl.renameFolder(a, 'Clientes 2026');
    await ctl.moveFolder(b, a);
    expect(ctl.data.folders.find((f) => f.id === b)!.parent).toBe(a);
    await expect(ctl.moveFolder(a, b)).rejects.toThrow('no se puede mover');
    await expect(ctl.renameFolder('inbox', 'Otra')).rejects.toThrow();
    ctl.addFolder('Libre');
    await expect(ctl.renameFolder(ctl.data.folders.find((f) => f.name === 'Libre')!.id, 'clientes 2026')).rejects.toThrow('Ya existe');
    ctl.markFolderRead('inbox');
    expect(ctl.data.messages.every((m) => m.read)).toBe(true);
    ctl.toggleFavorite(b);
    expect(parseMailData(serializeMail(ctl.data)).favorites).toEqual([b]);
  });
});

describe('deshacer y carpetas con servidor', () => {
  let srv: FakeServer;
  const rec = (subject: string) => ctl.data.messages.find((m) => m.subject === subject)!;
  const folderOf = (path: string) => ctl.data.folders.find((f) => f.remote?.path === path)!;
  beforeEach(async () => {
    srv = standardServer();
    srv.accounts = [account()];
    setTransport(srv.transport);
    ctl = new MailCtl();
    await ctl.loadAccounts();
    await ctl.syncAll();
  });
  afterEach(() => {
    ctl.dispose();
    setTransport(null);
    store.clear();
  });

  it('un movimiento sin enviar se retira de la cola', async () => {
    srv.failWith = 'Error de red';
    ctl.moveMany([rec('Uno').id, rec('Dos').id], 'archive');
    await ctl.flush();
    ctl.undo();
    await ctl.undoing;
    expect([rec('Uno').folder, rec('Uno').remote!.key, rec('Dos').remote!.key]).toEqual(['inbox', '1', '2']);
    expect((ctl.data.pending ?? []).filter((o) => o.kind === 'move')).toEqual([]);
    srv.failWith = null;
    await ctl.syncAll();
    expect(srv.subjects('INBOX').sort()).toEqual(['Dos', 'Tres', 'Uno']);
    expect(ctl.data.messages).toHaveLength(6);
  });

  it('un movimiento ya hecho en el servidor se deshace allí', async () => {
    ctl.delete(rec('Dos').id);
    await ctl.flush();
    expect(srv.subjects('Trash')).toEqual(['Dos']);
    ctl.undo();
    expect(ctl.syncMessage).toBe('Deshaciendo en el servidor…');
    await ctl.undoing;
    expect(ctl.syncMessage).toBe('Deshecho también en el servidor.');
    expect(srv.subjects('Trash')).toEqual([]);
    expect(srv.subjects('INBOX').sort()).toEqual(['Dos', 'Tres', 'Uno']);
    expect(rec('Dos').folder).toBe('inbox');
    await ctl.syncAll();
    expect(ctl.data.messages).toHaveLength(6);
    expect(rec('Dos').remote!.folder).toBe('INBOX');
  });

  it('también justo al hacerlo, mientras se está enviando', async () => {
    ctl.move(rec('Uno').id, 'archive');
    const sending = ctl.flush();
    ctl.undo();
    await sending;
    await ctl.undoing;
    await ctl.syncAll();
    expect(srv.subjects('Archive')).toEqual([]);
    expect(rec('Uno').folder).toBe('inbox');
    expect(ctl.data.messages).toHaveLength(6);
  });

  it('si el servidor no responde al deshacer, lo dice y el mensaje queda donde estaba', async () => {
    ctl.move(rec('Uno').id, 'archive');
    await ctl.flush();
    srv.failWith = 'Error de red';
    ctl.undo();
    await ctl.undoing;
    expect(ctl.syncMessage).toMatch(/^No se pudo deshacer en el servidor/);
    expect(rec('Uno').folder).toBe('archive');
  });

  it('tras moverlo, lo que se haga después con el mensaje también llega al servidor, sin esperar a sincronizar', async () => {
    ctl.move(rec('Uno').id, 'archive');
    await vi.waitFor(() => expect(rec('Uno').remote?.folder).toBe('Archive'));
    ctl.setFlagMany([rec('Uno').id], true);
    ctl.delete(rec('Uno').id);
    await vi.waitFor(() => expect(rec('Uno').remote?.folder).toBe('Trash'));
    expect(srv.find('Uno')).toMatchObject({ folder: 'Trash' });
    expect(srv.find('Uno')!.msg.flags).toContain('\\Flagged');
    // deshacer desde el mensaje ya enlazado
    ctl.undo();
    await vi.waitFor(() => expect(rec('Uno').remote?.folder).toBe('Archive'));
    expect(srv.find('Uno')!.folder).toBe('Archive');
    await ctl.syncAll();
    expect(ctl.data.messages).toHaveLength(6);
  });

  it('una sincronización a la vez que se enlaza no duplica nada', async () => {
    ctl.move(rec('Uno').id, 'archive');
    await new Promise((r) => setTimeout(r, 160));
    await Promise.all([ctl.syncAll(), ctl.syncAll()]);
    await new Promise((r) => setTimeout(r, 50));
    expect(ctl.data.messages).toHaveLength(6);
    expect(rec('Uno').remote?.folder).toBe('Archive');
  });

  it('lo borrado para siempre en el servidor se recupera solo aquí', async () => {
    ctl.delete(rec('Dos').id);
    await ctl.syncAll();
    ctl.delete(rec('Dos').id);
    await ctl.flush();
    ctl.undo();
    expect(rec('Dos').folder).toBe('trash');
    expect(rec('Dos').remote).toBeUndefined();
    expect(ctl.syncMessage).toMatch(/solo en este equipo/);
    expect(srv.subjects('Trash')).toEqual([]);
  });

  it('renombra y mueve una carpeta en el servidor, con sus subcarpetas y sin volver a bajar nada', async () => {
    const proyecto = folderOf('Trabajo/Proyecto A').id;
    ctl.setFolder(proyecto);
    ctl.toggleFavorite(proyecto);
    const informe = rec('Informe del proyecto').id;
    srv.calls.length = 0;
    await ctl.renameFolder(proyecto, 'Proyecto B');
    expect(srv.lastArgs.mail_rename_folder).toMatchObject({ folder: 'Trabajo/Proyecto A', path: 'Trabajo/Proyecto B' });
    expect(folderOf('Trabajo/Proyecto B').id).toBe(ctl.folder);
    expect(folderOf('Trabajo/Proyecto B/Fase 1').parent).toBe(ctl.folder);
    expect(ctl.data.favorites).toEqual([ctl.folder]);
    expect(rec('Informe del proyecto')).toMatchObject({ id: informe, folder: ctl.folder, remote: { folder: 'Trabajo/Proyecto B' } });
    expect(srv.calls).not.toContain('mail_fetch');
    await ctl.moveFolder(ctl.folder, folderOf('Personal').id);
    expect(srv.folders.map((f) => f.path)).toContain('Personal/Proyecto B/Fase 1');
    expect(rec('Detalle de la fase').folder).toBe(folderOf('Personal/Proyecto B/Fase 1').id);
    expect(ctl.data.messages).toHaveLength(6);
    expect(srv.calls).not.toContain('mail_fetch');
  });

  it('con cambios sin enviar o si el servidor lo rechaza, la carpeta no cambia', async () => {
    srv.failOnly = 'mail_move';
    ctl.move(rec('Informe del proyecto').id, 'archive');
    await ctl.flush();
    await expect(ctl.renameFolder(folderOf('Personal').id, 'Casa')).rejects.toThrow('sin enviar');
    srv.failOnly = 'mail_rename_folder';
    await expect(ctl.renameFolder(folderOf('Personal').id, 'Casa')).rejects.toThrow('sin conexión');
    expect(folderOf('Personal')).toBeDefined();
  });
});
