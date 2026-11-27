import { buildMessage, parseMailData, quickStepsOf, serializeMail, type Rule } from '@suitenova/mail-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MailCtl } from './ctl';
import { FakeServer, account, standardServer } from './fake-server';
import { setTransport } from './remote';
import { buildQuery } from './search-form';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });

let ctl: MailCtl;
const add = (subject: string, day: number, folder = 'inbox', from = 'ana@x.es') =>
  ctl.importRaw(
    buildMessage({ from: { name: from.split('@')[0]!, email: from }, to: [{ name: '', email: 'yo@x.es' }], cc: [], bcc: [], subject, text: 't', attachments: [], date: new Date(2026, 2, day, 10), messageId: `<${subject.replace(/\W/g, '')}@x>` }),
    folder,
    { read: false },
  );
const rec = (subject: string) => ctl.data.messages.find((m) => m.subject === subject)!;
const id = (subject: string) => rec(subject).id;
const subjects = () => ctl.list().map((m) => m.subject);
const rule = (p: Partial<Rule>): Rule => ({ id: '', name: 'Regla', enabled: true, conditions: [{ kind: 'subject', words: ['Factura'] }], exceptions: [], actions: [{ kind: 'move', folder: 'archive' }], stop: true, ...p });

describe('organizar (en este equipo)', () => {
  beforeEach(() => {
    ctl = new MailCtl();
    ctl.setView({ groups: false });
    ctl.setOwner({ name: 'Yo', email: 'yo@x.es' });
    add('Factura 1', 5);
    add('Saludos', 4, 'inbox', 'luis@y.es');
    add('Factura 2', 3);
  });
  afterEach(() => {
    ctl.dispose();
    store.clear();
  });

  it('categorizar y deshacer; las categorías se guardan en el archivo', () => {
    ctl.categorize([id('Factura 1'), id('Saludos')], 'Categoría azul', true);
    ctl.categorize([id('Saludos')], 'Categoría roja', true);
    expect(parseMailData(serializeMail(ctl.data)).messages.find((m) => m.subject === 'Saludos')!.categories).toEqual(['Categoría azul', 'Categoría roja']);
    expect(ctl.undoLabel).toBe('Categorizar');
    ctl.undo();
    expect(rec('Saludos').categories).toEqual(['Categoría azul']);
    ctl.clearCategories([id('Saludos')]);
    expect(rec('Saludos').categories).toBeUndefined();
    ctl.undo();
    ctl.undo();
    expect(rec('Saludos').categories).toBeUndefined();
    expect(rec('Factura 1').categories).toBeUndefined();
  });

  it('la bandera marca, vuelve a pulsarse para completar, y deshacer lo devuelve', () => {
    ctl.followMany([id('Saludos')], new Date(2026, 2, 20).getTime(), 123);
    expect(rec('Saludos')).toMatchObject({ flagged: true, follow: { remind: 123 } });
    ctl.toggleFlag(id('Saludos'));
    expect(rec('Saludos').flagged).toBe(false);
    expect(rec('Saludos').follow!.done).toBeGreaterThan(0);
    ctl.undo();
    expect(rec('Saludos')).toMatchObject({ flagged: true, follow: { due: new Date(2026, 2, 20).getTime(), remind: 123 } });
    // poner la bandera a lo que ya la tiene no le quita la fecha
    ctl.setFlagMany([id('Saludos')], true);
    expect(rec('Saludos').follow!.due).toBeDefined();
    ctl.toggleFlag(id('Saludos'));
    ctl.toggleFlag(id('Saludos'));
    expect(rec('Saludos')).toMatchObject({ flagged: true });
    expect(rec('Saludos').follow).toBeUndefined();
  });

  it('los avisos de seguimiento salen a su hora y al descartarlos no vuelven', () => {
    ctl.followMany([id('Saludos')], null, 1000);
    ctl.followMany([id('Factura 1')], new Date(2026, 2, 20).getTime(), 5000);
    expect(ctl.dueReminders(999)).toEqual([]);
    expect(ctl.dueReminders(2000).map((r) => r.title)).toEqual(['Saludos']);
    ctl.dismissReminder(`f:${id('Saludos')}`);
    expect(rec('Saludos')).toMatchObject({ flagged: true });
    expect(rec('Saludos').follow).toBeUndefined();
    ctl.dismissReminder(`f:${id('Factura 1')}`);
    expect(rec('Factura 1').follow).toEqual({ due: new Date(2026, 2, 20).getTime() });
    expect(ctl.dueReminders(1e13)).toEqual([]);
  });

  it('una carpeta de búsqueda reúne mensajes de cualquier carpeta y no deja desaparecer lo que se está leyendo', () => {
    add('Archivada sin leer', 1, 'archive');
    ctl.setFolder('q:unread');
    expect(ctl.searchFolder!.name).toBe('Correo no leído');
    expect(subjects()).toEqual(['Factura 1', 'Saludos', 'Factura 2', 'Archivada sin leer']);
    ctl.select(id('Saludos'));
    expect(subjects()).toContain('Saludos');
    ctl.setQuery('factura');
    expect(subjects()).toEqual(['Factura 1', 'Factura 2']);
    ctl.setQuery('');
    expect(subjects()).not.toContain('Saludos');
    // al borrar se pasa al siguiente
    ctl.select(id('Factura 1'));
    ctl.delete(id('Factura 1'));
    expect(ctl.selected!.subject).toBe('Factura 2');
    // lo que se importa estando en ella va a la bandeja de entrada
    expect(add('Importado', 2, ctl.folder).folder).toBe('inbox');
    ctl.organize.removeSearchFolder('q:unread');
    expect(ctl.folder).toBe('inbox');
    expect(ctl.data.searchFolders!.map((f) => f.id)).toEqual(['q:follow']);
    ctl.organize.restoreSearchFolders();
    expect(ctl.data.searchFolders!.map((f) => f.id)).toEqual(['q:follow', 'q:unread']);
  });

  it('guardar carpetas de búsqueda comprueba lo escrito', () => {
    expect(() => ctl.organize.saveSearchFolder({ name: '', query: 'a' })).toThrow('nombre');
    expect(() => ctl.organize.saveSearchFolder({ name: 'x', query: ' * ' })).toThrow('qué hay que buscar');
    expect(() => ctl.organize.saveSearchFolder({ name: 'x', query: 'fecha:nunca' })).toThrow('fecha:nunca');
    expect(() => ctl.organize.saveSearchFolder({ name: 'correo no leído', query: 'a' })).toThrow('Ya existe');
    const saved = ctl.organize.saveSearchFolder({ name: 'Facturas', query: '* asunto:factura' });
    ctl.setFolder(saved);
    expect(subjects()).toEqual(['Factura 1', 'Factura 2']);
  });

  it('la búsqueda mantiene a la vista lo que se lee aunque deje de cumplirla', () => {
    ctl.setQuery('es:noleido');
    ctl.select(id('Saludos'));
    expect(subjects()).toContain('Saludos');
    ctl.setQuery('es:noleido ');
    expect(subjects()).not.toContain('Saludos');
    ctl.setQuery('fecha:nunca');
    expect(ctl.searchErrors).toEqual(['fecha:nunca']);
    expect(subjects()).toEqual([]);
  });

  it('el formulario de búsqueda avanzada escribe la búsqueda', () => {
    expect(buildQuery({ from: 'Ana López', to: '', subject: 'plan', words: ' coste anual ', category: 'Categoría azul', attachments: 'sí', state: 'noleido', since: '2026-03-01', until: '', everywhere: false })).toBe(
      'de:"Ana López" asunto:plan coste anual categoria:"Categoría azul" adjuntos:sí es:noleido desde:2026-03-01',
    );
  });

  it('las reglas se ejecutan a mano en una carpeta y un solo deshacer las devuelve', () => {
    ctl.organize.saveRule(rule({ actions: [{ kind: 'category', name: 'Categoría verde' }, { kind: 'move', folder: 'archive' }, { kind: 'read' }] }));
    const result = ctl.organize.runRules([ctl.data.rules![0]!.id], 'inbox');
    expect(result).toEqual({ matched: 2, failed: 0 });
    expect(subjects()).toEqual(['Saludos']);
    expect(rec('Factura 2')).toMatchObject({ folder: 'archive', read: true, categories: ['Categoría verde'] });
    expect(ctl.undoLabel).toBe('Ejecutar reglas');
    ctl.undo();
    expect(rec('Factura 2')).toMatchObject({ folder: 'inbox', read: false });
    expect(rec('Factura 2').categories).toBeUndefined();
    expect(ctl.undoLabel).toBe('');
  });

  it('copiar, avisar, eliminar sin pasar por encima de Eliminados, y carpetas que faltan', () => {
    ctl.organize.saveRule(rule({ name: 'Copia', actions: [{ kind: 'copy', folder: 'archive' }, { kind: 'alert', text: 'Llegó una factura' }], stop: false }));
    ctl.organize.saveRule(rule({ name: 'Rota', actions: [{ kind: 'move', folder: 'no-existe' }] }));
    const ids = ctl.data.rules!.map((r) => r.id);
    expect(ctl.organize.runRules(ids, 'inbox')).toEqual({ matched: 2, failed: 2 });
    expect(ctl.data.messages.filter((m) => m.subject === 'Factura 1').map((m) => m.folder).sort()).toEqual(['archive', 'inbox']);
    expect(ctl.organize.notices.map((n) => n.text)).toEqual(['Llegó una factura', 'Llegó una factura']);
    ctl.undo();
    expect(ctl.data.messages).toHaveLength(3);
    // eliminar dos veces con una regla no borra para siempre
    ctl.deleteMany([id('Factura 1')]);
    ctl.organize.saveRule(rule({ name: 'Fuera', actions: [{ kind: 'delete' }] }));
    ctl.organize.runRules([ctl.data.rules![2]!.id], 'trash');
    expect(rec('Factura 1').folder).toBe('trash');
  });

  it('reglas: validar, ordenar, activar y eliminar', () => {
    expect(() => ctl.organize.saveRule(rule({ name: ' ' }))).toThrow('nombre');
    expect(() => ctl.organize.saveRule(rule({ conditions: [] }))).toThrow('condición');
    expect(() => ctl.organize.saveRule(rule({ actions: [] }))).toThrow('acción');
    ctl.organize.saveRule(rule({ name: 'a' }));
    ctl.organize.saveRule(rule({ name: 'b' }));
    const [a, b] = ctl.data.rules!;
    ctl.organize.moveRule(b!.id, -1);
    expect(ctl.data.rules!.map((r) => r.name)).toEqual(['b', 'a']);
    ctl.organize.moveRule(b!.id, -1);
    ctl.organize.enableRule(a!.id, false);
    expect(ctl.data.rules!.map((r) => r.enabled)).toEqual([true, false]);
    ctl.organize.removeRule(a!.id);
    ctl.organize.removeRule(b!.id);
    expect(ctl.data.rules).toBeUndefined();
  });

  it('paso rápido «Listo»: completa, marca leído y archiva; un deshacer', () => {
    ctl.setFlagMany([id('Saludos')], true);
    ctl.select(id('Saludos'));
    ctl.organize.runStep('qs:done');
    expect(rec('Saludos')).toMatchObject({ folder: 'archive', read: true, flagged: false });
    expect(rec('Saludos').follow!.done).toBeDefined();
    expect(ctl.undoLabel).toBe('Listo');
    ctl.undo();
    expect(rec('Saludos')).toMatchObject({ folder: 'inbox', flagged: true });
    expect(rec('Saludos').follow).toBeUndefined();
  });

  it('un paso que responde abre el mensaje y se aplica a uno solo', () => {
    ctl.selectAll();
    ctl.organize.runStep('qs:replydelete');
    expect(ctl.compose).toBeNull();
    expect(ctl.syncMessage).toMatch(/uno solo/);
    ctl.select(id('Saludos'));
    ctl.organize.runStep('qs:replydelete');
    expect(ctl.compose).toMatchObject({ to: 'luis@y.es', subject: 'Re: Saludos' });
    expect(rec('Saludos').folder).toBe('trash');
    ctl.closeCompose();
    ctl.organize.saveStep({ id: '', name: 'Al jefe', actions: [{ kind: 'forward', to: 'jefa@x.es' }] });
    expect(quickStepsOf(ctl.data).map((s) => s.name)).toEqual(['Listo', 'Responder y eliminar', 'Al jefe']);
    ctl.select(id('Factura 1'));
    ctl.organize.runStep(ctl.data.quickSteps![2]!.id);
    expect(ctl.compose).toMatchObject({ to: 'jefa@x.es', subject: 'Fwd: Factura 1' });
    ctl.closeCompose();
    ctl.organize.removeStep('qs:done');
    ctl.organize.moveStep(ctl.data.quickSteps![1]!.id, -1);
    expect(quickStepsOf(ctl.data).map((s) => s.name)).toEqual(['Al jefe', 'Responder y eliminar']);
  });

  it('si no se pudo guardar la copia, una regla no borra para siempre', () => {
    ctl.organize.saveRule(rule({ actions: [{ kind: 'copy', folder: 'no-existe' }, { kind: 'deletePermanent' }] }));
    expect(ctl.organize.runRules([ctl.data.rules![0]!.id], 'inbox')).toEqual({ matched: 2, failed: 2 });
    expect(ctl.data.messages).toHaveLength(3);
  });

  it('bloquear un remitente y confiar en él', () => {
    ctl.select(id('Saludos'));
    expect(ctl.organize.block([id('Saludos')])).toEqual(['luis@y.es']);
    expect(rec('Saludos').folder).toBe('junk');
    expect(ctl.data.junk!.blocked).toEqual(['luis@y.es']);
    expect(ctl.organize.trust([id('Saludos')])).toEqual(['luis@y.es']);
    expect(rec('Saludos').folder).toBe('inbox');
    expect(ctl.data.junk).toEqual({ blocked: [], safe: ['luis@y.es'] });
    // la propia dirección no se bloquea
    add('Mío', 2, 'inbox', 'yo@x.es');
    expect(ctl.organize.block([id('Mío')])).toEqual([]);
    expect(rec('Mío').folder).toBe('inbox');
  });
});

describe('organizar con un servidor', () => {
  let srv: FakeServer;
  beforeEach(async () => {
    srv = standardServer();
    srv.add('Junk', ['\\Junk']);
    setTransport(srv.transport);
    ctl = new MailCtl();
    ctl.accounts = [account()];
    srv.accounts = [...ctl.accounts];
  });
  afterEach(() => {
    ctl.dispose();
    setTransport(null);
    store.clear();
  });
  const arrive = (key: string, subject: string, opts: Parameters<typeof FakeServer.mail>[2] = {}) => srv.folder('INBOX').msgs.push(FakeServer.mail(key, subject, opts));
  const settled = async () => {
    await new Promise((r) => setTimeout(r, 200));
    await ctl.flush();
  };

  it('la primera sincronización no aplica reglas; después, solo a lo nuevo sin leer', async () => {
    ctl.organize.saveRule(rule({ conditions: [{ kind: 'from', words: ['ana'] }], actions: [{ kind: 'follow', when: 'today' }, { kind: 'move', folder: 'archive' }] }));
    await ctl.syncAll();
    expect(srv.subjects('INBOX').sort()).toEqual(['Dos', 'Tres', 'Uno']);
    arrive('10', 'Nuevo');
    arrive('11', 'Visto en otro sitio', { flags: ['\\Seen'] });
    await ctl.syncAll();
    expect(ctl.syncMessage).toContain('reglas aplicadas a 1');
    await settled();
    expect(srv.find('Nuevo')!.folder).toBe('Archive');
    expect(srv.find('Nuevo')!.msg.flags).toContain('\\Flagged');
    expect(srv.find('Visto en otro sitio')!.folder).toBe('INBOX');
    expect(rec('Nuevo')).toMatchObject({ folder: 'archive', flagged: true });
    // lo que llega solo no se deshace
    expect(ctl.undoLabel).toBe('');
    await ctl.syncAll();
    expect(ctl.data.messages.filter((m) => m.subject === 'Nuevo')).toHaveLength(1);
    expect(rec('Nuevo').follow!.due).toBeDefined();
  });

  it('si el servidor renumera la carpeta, las reglas no vuelven a pasar', async () => {
    ctl.organize.saveRule(rule({ conditions: [{ kind: 'from', words: ['ana'] }] }));
    await ctl.syncAll();
    srv.folder('INBOX').validity = '2';
    await ctl.syncAll();
    await settled();
    expect(srv.subjects('Archive')).toEqual([]);
  });

  it('lo de un remitente bloqueado va a Correo no deseado, también en el servidor', async () => {
    await ctl.syncAll();
    ctl.organize.addSender('blocked', '@x.es');
    arrive('10', 'Publicidad', { flags: ['\\Seen'] });
    await ctl.syncAll();
    await settled();
    expect(srv.find('Publicidad')!.folder).toBe('Junk');
    expect(srv.find('Uno')!.folder).toBe('INBOX');
    expect(rec('Publicidad').folder).toBe('junk');
  });

  it('una regla que manda a una carpeta solo de este equipo lo dice', async () => {
    ctl.addFolder('Local');
    ctl.organize.saveRule(rule({ conditions: [{ kind: 'from', words: ['ana'] }], actions: [{ kind: 'move', folder: ctl.data.folders.find((f) => f.name === 'Local')!.id }] }));
    await ctl.syncAll();
    arrive('10', 'Nuevo');
    await ctl.syncAll();
    expect(ctl.syncMessage).toContain('no se le pudo aplicar todo');
    expect(rec('Nuevo').folder).toBe('inbox');
  });

  it('copiar a una carpeta de la cuenta la añade en el servidor; deshacer la retira', async () => {
    await ctl.syncAll();
    const personal = ctl.data.folders.find((f) => f.remote?.path === 'Personal')!.id;
    ctl.copyMany([rec('Uno').id], personal);
    await ctl.flush();
    expect(srv.subjects('Personal')).toEqual(['Cena del sábado', 'Uno']);
    await ctl.syncAll();
    expect(ctl.data.messages.filter((m) => m.subject === 'Uno')).toHaveLength(2);
    ctl.undo();
    await ctl.flush();
    expect(srv.subjects('Personal')).toEqual(['Cena del sábado']);
    expect(ctl.data.messages.filter((m) => m.subject === 'Uno')).toHaveLength(1);
    // sin enviar todavía: se retira de la cola
    srv.failWith = 'Error de red';
    ctl.copyMany([rec('Uno').id], personal);
    await ctl.flush();
    ctl.undo();
    expect(ctl.data.pending ?? []).toEqual([]);
  });

  it('deshacer una copia ya enviada y aún sin sincronizar avisa de que volverá', async () => {
    await ctl.syncAll();
    ctl.copyMany([rec('Uno').id], 'archive');
    await ctl.flush();
    ctl.undo();
    expect(ctl.syncMessage).toMatch(/volverá al sincronizar/);
    expect(ctl.data.messages.filter((m) => m.subject === 'Uno')).toHaveLength(1);
  });

  it('con POP3 la copia se queda en este equipo y no atasca la cola', async () => {
    await ctl.syncAll();
    ctl.accounts = [account('a1', 'Personal', { protocol: 'pop3' })];
    ctl.copyMany([rec('Uno').id], 'inbox');
    expect(ctl.data.messages.filter((m) => m.subject === 'Uno')).toHaveLength(2);
    expect(ctl.data.pending ?? []).toEqual([]);
  });

  it('«Listo» en el servidor y deshacer cuando ya se envió: vuelve con su bandera', async () => {
    await ctl.syncAll();
    ctl.select(rec('Tres').id);
    ctl.organize.runStep('qs:done');
    await settled();
    expect(srv.find('Tres')!.folder).toBe('Archive');
    expect(srv.find('Tres')!.msg.flags).not.toContain('\\Flagged');
    ctl.undo();
    await ctl.undoing;
    await settled();
    expect(srv.find('Tres')!.folder).toBe('INBOX');
    expect(srv.find('Tres')!.msg.flags).toContain('\\Flagged');
    await ctl.syncAll();
    expect(rec('Tres')).toMatchObject({ folder: 'inbox', flagged: true });
    expect(rec('Tres').follow).toBeUndefined();
  });

  it('el seguimiento y las categorías siguen tras sincronizar y mover', async () => {
    await ctl.syncAll();
    ctl.categorize([rec('Dos').id], 'Categoría roja', true);
    ctl.followMany([rec('Dos').id], new Date(2026, 5, 1).getTime());
    await settled();
    await ctl.syncAll();
    expect(rec('Dos')).toMatchObject({ categories: ['Categoría roja'], follow: { due: new Date(2026, 5, 1).getTime() } });
    ctl.move(rec('Dos').id, 'archive');
    await settled();
    await ctl.syncAll();
    expect(rec('Dos')).toMatchObject({ folder: 'archive', flagged: true, categories: ['Categoría roja'] });
    // en el servidor solo hay la bandera: si se quita allí, aquí se acaba el seguimiento
    srv.find('Dos')!.msg.flags = [];
    await ctl.syncAll();
    expect(rec('Dos').flagged).toBe(false);
    expect(rec('Dos').follow).toBeUndefined();
    expect(rec('Dos').categories).toEqual(['Categoría roja']);
  });
});
