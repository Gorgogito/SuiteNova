import { newContact, newGroup, newTask, parseMailData, parseMessage, serializeMail, type Contact } from '@suitenova/mail-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MailCtl } from './ctl';
import { FakeServer, account, standardServer } from './fake-server';
import { addressItems } from './people-menus';
import { setTransport } from './remote';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
});

const day = (d: number, h = 0) => new Date(2026, 5, d, h).getTime();
let srv: FakeServer;
let c: MailCtl;

beforeEach(() => {
  srv = standardServer();
  setTransport(srv.transport);
  c = new MailCtl();
  c.accounts = [account('a1', 'Ana')];
  c.setOwner({ name: 'Ana', email: 'a1@ejemplo.es' });
});
afterEach(() => {
  c.dispose();
  setTransport(null);
  store.clear();
});

const person = (name: string, email: string, over: Partial<Contact> = {}): Contact => ({ ...newContact(), name, emails: [{ label: 'otro', value: email }], ...over });
const names = () => c.data.contacts.map((x) => x.name);

describe('contactos', () => {
  it('cada sección deshace lo suyo, y vuelve a su sitio', () => {
    const a = person('Ana', 'ana@x.es');
    const b = person('Berta', 'berta@x.es');
    const z = person('Zoe', 'zoe@x.es');
    c.go('contacts');
    for (const x of [a, b, z]) c.addContact(x);
    c.updateContact({ ...b, org: 'Obras' });
    c.deleteContact(a.id);
    c.go('tasks');
    expect(c.undoLabel).toBe('');
    c.addTask('Llamar');
    expect(c.undoLabel).toBe('Agregar tarea');
    c.go('contacts');
    expect(c.undoLabel).toBe('Eliminar contacto');
    c.undo();
    expect(names()).toEqual(['Ana', 'Berta', 'Zoe']);
    expect(c.selectedContact).toBe(a.id);
    c.undo();
    expect(c.data.contacts[1]!.org).toBe('');
    c.undo();
    expect(names()).toEqual(['Ana', 'Berta']);
    expect(c.data.tasks).toHaveLength(1);
    // saving without changes is not a change
    const label = c.undoLabel;
    c.updateContact(c.data.contacts[0]!);
    expect(c.undoLabel).toBe(label);
  });

  it('deshacer un cambio no toca lo que se hizo en otras cosas', () => {
    const a = person('Ana', 'ana@x.es');
    c.addContact(a);
    c.addTask('Una');
    const two = c.addTask('Dos');
    c.updateTask({ ...two, notes: 'x' });
    const one = c.data.tasks[0]!;
    c.updateTask({ ...one, remind: day(1) });
    c.go('tasks');
    c.undo();
    c.dismissReminder(`t:${c.data.tasks[0]!.id}`);
    c.undo();
    expect(c.data.tasks.map((t) => [t.title, t.notes])).toEqual([['Una', ''], ['Dos', '']]);
    expect(c.data.contacts).toHaveLength(1);
  });

  it('combinar varios duplicados se deshace de una vez', () => {
    const list = [person('Ana', 'ana@x.es', { org: 'Uno' }), person('Luis', 'luis@x.es'), person('Ana G.', 'ana@x.es'), person('Luis', 'l@casa.es')];
    for (const x of list) c.addContact(x);
    c.selectedContact = list[2]!.id;
    expect(c.people.merge([[list[0]!.id, list[2]!.id], [list[1]!.id, list[3]!.id], ['nadie']])).toBe(4);
    expect(c.data.contacts).toHaveLength(2);
    expect(c.data.contacts[0]!.org).toBe('Uno');
    expect(c.data.contacts[1]!.emails).toHaveLength(2);
    expect(c.data.contacts.some((x) => x.id === c.selectedContact)).toBe(true);
    c.go('contacts');
    c.undo();
    expect(c.data.contacts).toEqual(list);
  });

  it('deshacer una combinación deja el orden aunque el más completo no fuera el primero', () => {
    const list = [person('Ana', 'ana@x.es'), person('Luis', 'luis@x.es'), person('Ana G.', 'ana@x.es', { org: 'Obras', note: 'n' })];
    for (const x of list) c.addContact(x);
    c.people.merge([[list[0]!.id, list[2]!.id]]);
    expect(c.data.contacts.map((x) => x.id)).toEqual([list[2]!.id, list[1]!.id]);
    c.go('contacts');
    c.undo();
    expect(c.data.contacts).toEqual(list);
  });

  it('desde un mensaje: agregar, ver, o dar la dirección a quien ya está', () => {
    const m = c.importRaw('From: "Marta Ruiz" <marta@x.es>\r\nTo: a1@ejemplo.es\r\nSubject: Hola\r\n\r\nx\r\n', 'inbox');
    const from = { name: m.from, email: m.fromEmail };
    expect(addressItems(c, from).map((i) => i !== 'separator' && i.label).slice(0, 1)).toEqual(['Agregar a contactos']);
    c.people.fromAddress(from);
    expect(c.section).toBe('contacts');
    expect(c.data.contacts).toMatchObject([{ name: 'Marta Ruiz', first: 'Marta', last: 'Ruiz' }]);
    c.go('mail');
    c.people.fromAddress({ name: '', email: 'MARTA@x.es' });
    expect(c.data.contacts).toHaveLength(1);
    expect(addressItems(c, from)[0]).toMatchObject({ label: 'Ver el contacto' });
    const other = { name: 'marta ruiz', email: 'marta@casa.es' };
    expect(addressItems(c, other)[1]).toMatchObject({ label: 'Agregar la dirección a «Marta Ruiz»' });
    c.people.addEmail(c.data.contacts[0]!.id, other.email);
    expect(c.data.contacts[0]!.emails.map((e) => e.value)).toEqual(['marta@x.es', 'marta@casa.es']);
  });

  it('un grupo: agregar personas por dirección, nombre o grupo, y escribirle', async () => {
    c.addContact(person('Luis Pérez', 'luis@x.es'));
    const g = c.addContact({ ...newGroup('Equipo') });
    const filled = c.people.addToGroup(g, 'luis pérez, marta@x.es, Fulano, MARTA@x.es');
    expect(filled.unknown).toEqual(['Fulano']);
    expect(filled.group.members).toEqual([{ name: 'Luis Pérez', email: 'luis@x.es' }, { name: '', email: 'marta@x.es' }]);
    c.updateContact(filled.group);
    const all = c.people.addToGroup(newGroup('Todos'), 'Equipo');
    expect(all.group.members).toHaveLength(2);
    // el nombre del grupo, escrito en «Para», se envía a su gente
    c.newMessage('Equipo');
    c.compose!.subject = 'Reunión';
    const id = c.compose!.id;
    const built = c.buildRaw(c.compose!);
    expect(built.to.map((a) => a.email)).toEqual(['luis@x.es', 'marta@x.es']);
    await c.send(c.compose!, 'a1');
    await c.outbox.process();
    expect(srv.sent.at(-1)!.recipients).toEqual(['luis@x.es', 'marta@x.es']);
    expect(parseMessage(Uint8Array.from(srv.sent.at(-1)!.raw, (ch) => ch.charCodeAt(0))).to.map((a) => a.email)).toEqual(['luis@x.es', 'marta@x.es']);
    expect(id).toBeTruthy();
  });

  it('se guardan en el archivo con foto y miembros', () => {
    c.addContact(person('Ana', 'ana@x.es', { photo: 'data:image/png;base64,iVBORw0KGgo=' }));
    c.addContact({ ...newGroup('G'), members: [{ name: '', email: 'a@x.es' }] });
    expect(parseMailData(serializeMail(c.data)).contacts).toEqual(c.data.contacts);
  });
});

describe('tareas', () => {
  it('completar una que se repite deja la hecha, avisa de la siguiente y se deshace', () => {
    c.go('tasks');
    const t = { ...newTask('Informe'), due: day(10), rrule: 'FREQ=WEEKLY' };
    c.people.addTask(t);
    c.toggleTask(t.id);
    expect(c.data.tasks.map((x) => [x.due, x.done])).toEqual([[day(17), false], [day(10), true]]);
    expect(c.syncMessage).toContain('la siguiente vence');
    expect(c.selectedTask).toBe(t.id);
    c.undo();
    expect(c.data.tasks).toEqual([t]);
  });

  it('el aviso de una tarea lleva a ella, y se pospone o descarta', () => {
    const t = { ...newTask('Llamar'), remind: day(1, 9) };
    c.people.addTask(t);
    c.go('mail');
    expect(c.dueReminders(day(1, 10)).map((r) => r.key)).toEqual([`t:${t.id}`]);
    c.taskFilter = 'done';
    c.openReminder(`t:${t.id}`);
    expect([c.section, c.selectedTask, c.taskFilter]).toEqual(['tasks', t.id, 'open']);
    c.alerts.pressed({ id: `rem:t:${t.id}`, action: 'snooze' });
    expect(c.data.tasks[0]!.remind).toBeGreaterThan(Date.now());
    c.alerts.pressed({ id: `rem:t:${t.id}`, action: 'dismiss' });
    expect(c.data.tasks[0]!.remind).toBeUndefined();
  });
});
