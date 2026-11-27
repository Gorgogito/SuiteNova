import { describe, expect, it } from 'vitest';
import { addMembers, contactByEmail, contactByName, contactFromAddress, expandGroups, findDuplicates, mergeContacts, newGroup, splitName } from './contacts';
import { newTask, parseIcs, writeIcs, type TaskItem } from './ics';
import { addressBook, splitRecipients, suggestRecipients } from './recipients';
import { dismissReminder, dueReminders, snoozeReminder } from './reminders';
import { newMailData, parseMailData, serializeMail } from './store';
import { completeTask, nextDue, readRepeat, reopenTask, writeRepeat } from './tasks';
import { contactsToCsv, newContact, parseVcf, writeVcf, type Contact } from './vcard';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const person = (name: string, emails: string[] = [], over: Partial<Contact> = {}): Contact => ({ ...newContact(), name, emails: emails.map((value) => ({ label: 'otro', value })), ...over });
const day = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const task = (over: Partial<TaskItem>): TaskItem => ({ ...newTask('Informe'), ...over });
const ymd = (t: number) => {
  const d = new Date(t);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
};

describe('contactos', () => {
  it('nombres y contactos desde una dirección', () => {
    expect(splitName('Ana García Ruiz')).toEqual({ first: 'Ana', last: 'García Ruiz' });
    expect(splitName('García, Ana')).toEqual({ first: 'Ana', last: 'García' });
    expect(contactFromAddress({ name: 'García, Ana', email: 'ana@x.es' })).toMatchObject({ name: 'Ana García', first: 'Ana', last: 'García', emails: [{ value: 'ana@x.es' }] });
    expect(contactFromAddress({ name: 'ana@x.es', email: 'ana@x.es' })).toMatchObject({ name: '', first: '' });
    const list = [person('Ana García', ['ANA@x.es'])];
    expect(contactByEmail(list, 'ana@X.es')).toBe(list[0]);
    expect(contactByName(list, 'ana garcia')).toBe(list[0]);
    expect(contactByName(list, '')).toBeUndefined();
  });

  it('grupos: sin repetir, en las sugerencias y al escribir su nombre', () => {
    const group = addMembers(newGroup('Equipo de obra'), [{ name: 'Ana', email: 'ana@x.es' }, { name: '', email: 'ANA@x.es' }, { name: 'Luis', email: 'luis@x.es' }, { name: 'Nadie', email: ' ' }]);
    expect(group.members!.map((m) => m.email)).toEqual(['ana@x.es', 'luis@x.es']);
    const empty = newGroup('Vacío');
    const contacts = [group, empty, person('Marta', ['marta@x.es'])];
    const written = splitRecipients('equipo de obra, marta@x.es, Ana <ana@x.es>');
    expect(expandGroups(written, contacts).map((a) => a.email)).toEqual(['ana@x.es', 'luis@x.es', 'marta@x.es']);
    // a group with nobody stays, so that it is pointed out
    expect(expandGroups(splitRecipients('Vacío'), contacts)).toEqual([{ name: '', email: 'Vacío' }]);
    // an address is never taken for a group
    expect(expandGroups([{ name: 'Equipo de obra', email: 'otro@x.es' }], contacts)).toEqual([{ name: 'Equipo de obra', email: 'otro@x.es' }]);
    const d = { ...newMailData(), contacts };
    const book = addressBook(d, new Set());
    expect(suggestRecipients(book, 'equi')[0]).toMatchObject({ name: 'Equipo de obra', group: group.members });
    expect(suggestRecipients(book, 'vac')).toEqual([]);
    expect(suggestRecipients(book, 'equi', new Set(['ana@x.es', 'luis@x.es']))).toEqual([]);
    expect(suggestRecipients(book, 'equi', new Set(['ana@x.es']))).toHaveLength(1);
  });

  it('duplicados por correo y por nombre, y combinarlos sin perder nada', () => {
    const a = person('Ana García', ['ana@x.es'], { org: 'Obras', phones: [{ label: 'móvil', value: '600 100 200' }], note: 'De la feria', categories: ['Rojo'] });
    const b = person('A. García', ['Ana@X.es', 'ana@casa.es'], { org: 'Reformas', phones: [{ label: 'trabajo', value: '600100200' }], photo: PNG });
    const c = person('ana garcía', [], { birthday: '1990-01-02', categories: ['Azul', 'Rojo'] });
    const d = person('Luis', ['luis@x.es']);
    const e = person('Luis', ['otro@x.es']);
    const alone = person('', ['solo@x.es']);
    const group = newGroup('Luis');
    const found = findDuplicates([a, d, b, group, c, e, alone, person('', ['mas@x.es'])]);
    expect(found.map((g) => [g.reason, g.contacts.map((x) => x.id).sort()])).toEqual([
      ['email', [a.id, b.id, c.id].sort()],
      ['name', [d.id, e.id].sort()],
    ]);
    const m = mergeContacts([c, a, b]);
    expect(m.emails.map((x) => x.value.toLowerCase()).sort()).toEqual(['ana@casa.es', 'ana@x.es']);
    expect(m.phones).toHaveLength(1);
    expect(m.photo).toBe(PNG);
    expect(m.birthday).toBe('1990-01-02');
    expect([...m.categories!].sort()).toEqual(['Azul', 'Rojo']);
    expect(m.note).toContain('De la feria');
    // what said something else is written down
    expect([m.org, m.note].join(' ')).toContain('Obras');
    expect([m.org, m.note].join(' ')).toContain('Reformas');
  });

  it('vCard: foto y grupo van y vuelven; lo raro no entra', () => {
    const group = addMembers(newGroup('Equipo'), [{ name: 'Ana García', email: 'ana@x.es' }, { name: '', email: 'luis@x.es' }]);
    const ana = person('Ana García', ['ana@x.es'], { photo: PNG });
    const text = writeVcf([ana, group]);
    expect(text).toContain('PHOTO;ENCODING=b;TYPE=PNG:');
    const back = parseVcf(text).contacts;
    expect(back[0]!.photo).toBe(PNG);
    expect(back[0]!.members).toBeUndefined();
    expect(back[1]!.members).toEqual(group.members);
    const other = parseVcf(
      ['BEGIN:VCARD', 'VERSION:4.0', 'FN:Grupo', 'KIND:group', 'MEMBER:urn:uuid:abc', 'MEMBER:mailto:z@x.es', 'END:VCARD', 'BEGIN:VCARD', 'VERSION:4.0', 'UID:urn:uuid:abc', 'FN:Zoe', 'EMAIL:zoe@x.es', `PHOTO:${PNG}`, 'END:VCARD', ''].join('\r\n'),
    );
    expect(other.contacts[0]!.members).toEqual([{ name: '', email: 'z@x.es' }, { name: 'Zoe', email: 'zoe@x.es' }]);
    expect(other.contacts[1]!.photo).toBe(PNG);
    // vCard 2.1, folded base64 and a blank line; a photo on the web; something that is not a picture
    const old = parseVcf(['BEGIN:VCARD', 'VERSION:2.1', 'FN:Vieja', 'PHOTO;ENCODING=BASE64;TYPE=JPEG:/9j/4AAQ', '  SkZJRg==', '', 'END:VCARD', 'BEGIN:VCARD', 'FN:Web', 'PHOTO;VALUE=URI:https://x.es/f.jpg', 'END:VCARD', 'BEGIN:VCARD', 'FN:Mala', 'PHOTO;ENCODING=b:PHNjcmlwdD4=', 'END:VCARD', ''].join('\r\n'));
    expect(old.contacts.map((c) => c.photo)).toEqual(['data:image/jpeg;base64,/9j/4AAQSkZJRg==', undefined, undefined]);
    expect(old.warnings.join()).toContain('Internet');
    expect(contactsToCsv([ana, group])).toHaveLength(2);
    const d = { ...newMailData(), contacts: [ana, group, { ...ana, id: 'x', photo: 'javascript:alert(1)', members: 7 as never }] };
    const loaded = parseMailData(serializeMail(d)).contacts;
    expect(loaded[0]!.photo).toBe(PNG);
    expect(loaded[1]!.members).toEqual(group.members);
    expect(loaded[2]!.photo).toBeUndefined();
    expect(loaded[2]!.members).toEqual([]);
  });
});

describe('tareas que se repiten', () => {
  const next = (over: Partial<TaskItem>, done = day(2026, 6, 20)) => {
    const n = nextDue(task(over), done);
    return n && [ymd(n.due), n.rrule];
  };

  it('la fecha siguiente', () => {
    expect(next({ due: day(2026, 6, 10), rrule: 'FREQ=DAILY;INTERVAL=3' })).toEqual([[2026, 6, 13], 'FREQ=DAILY;INTERVAL=3']);
    expect(next({ due: day(2026, 6, 10), rrule: 'FREQ=WEEKLY;INTERVAL=2' })).toEqual([[2026, 6, 24], 'FREQ=WEEKLY;INTERVAL=2']);
    // from a Friday, the next working day is Monday
    expect(next({ due: day(2026, 6, 12), rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' })![0]).toEqual([2026, 6, 15]);
    expect(next({ due: day(2026, 6, 10), rrule: 'FREQ=YEARLY' })![0]).toEqual([2027, 6, 10]);
    expect(next({ due: null, rrule: 'FREQ=DAILY' })![0]).toEqual([2026, 6, 21]);
    expect(next({ due: day(2026, 6, 10), rrule: 'FREQ=WEEKLY', fromDone: true })![0]).toEqual([2026, 6, 27]);
    expect(next({ due: day(2026, 6, 10), rrule: '' })).toBeNull();
    expect(next({ due: day(2026, 6, 10), rrule: 'FREQ=HOURLY' })).toBeNull();
  });

  it('un día 31 no se pierde en los meses cortos', () => {
    const feb = nextDue(task({ due: day(2026, 1, 31), rrule: 'FREQ=MONTHLY' }), day(2026, 1, 31))!;
    expect([ymd(feb.due), feb.rrule]).toEqual([[2026, 2, 28], 'FREQ=MONTHLY;BYMONTHDAY=31']);
    expect(ymd(nextDue(feb, day(2026, 2, 28))!.due)).toEqual([2026, 3, 31]);
    const leap = nextDue(task({ due: day(2028, 2, 29), rrule: 'FREQ=YEARLY' }), day(2028, 2, 29))!;
    expect(ymd(leap.due)).toEqual([2029, 2, 28]);
    expect(readRepeat(feb.rrule)).toEqual({ choice: 'FREQ=MONTHLY', every: 1, until: '' });
  });

  it('el final: por fecha o por número de veces', () => {
    expect(next({ due: day(2026, 6, 10), rrule: 'FREQ=WEEKLY;UNTIL=20260616' })).toBeNull();
    expect(next({ due: day(2026, 6, 10), rrule: 'FREQ=WEEKLY;UNTIL=20260617' })![0]).toEqual([2026, 6, 17]);
    expect(next({ due: day(2026, 6, 10), rrule: 'FREQ=DAILY;COUNT=2' })![1]).toBe('FREQ=DAILY;COUNT=1');
    expect(next({ due: day(2026, 6, 10), rrule: 'FREQ=DAILY;COUNT=1' })).toBeNull();
  });

  it('lo que ofrece el formulario', () => {
    expect(writeRepeat('FREQ=WEEKLY', 2, '2026-12-31')).toBe('FREQ=WEEKLY;INTERVAL=2;UNTIL=20261231');
    expect(readRepeat('FREQ=WEEKLY;INTERVAL=2;UNTIL=20261231')).toEqual({ choice: 'FREQ=WEEKLY', every: 2, until: '2026-12-31' });
    expect(readRepeat('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')!.choice).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(readRepeat('FREQ=MONTHLY;BYDAY=2TU')).toBeNull();
    expect(writeRepeat('', 3, '2026-01-01')).toBe('');
  });

  it('completar deja lo hecho y avanza la que se repite, con su aviso', () => {
    const d = newMailData();
    const t = task({ id: 't1', due: day(2026, 6, 10), rrule: 'FREQ=WEEKLY;COUNT=2', remind: day(2026, 6, 9, 17, 30) });
    d.tasks = [t, task({ id: 't2' })];
    expect(ymd(completeTask(d, 't1', day(2026, 6, 11, 12))!)).toEqual([2026, 6, 17]);
    expect(d.tasks.map((x) => [x.id === 't1', x.done])).toEqual([[true, false], [false, true], [false, false]]);
    expect(d.tasks[0]).toMatchObject({ due: day(2026, 6, 17), rrule: 'FREQ=WEEKLY;COUNT=1', remind: day(2026, 6, 16, 17, 30) });
    expect(d.tasks[1]).toMatchObject({ title: 'Informe', due: day(2026, 6, 10), completedAt: day(2026, 6, 11, 12) });
    expect(d.tasks[1]!.rrule).toBeUndefined();
    expect(d.tasks[1]!.remind).toBeUndefined();
    expect(d.tasks[1]!.uid).not.toBe(t.uid);
    // the one given to complete is not changed
    expect(t.done).toBe(false);
    expect(completeTask(d, 't1', day(2026, 6, 18))).toBeNull();
    expect(d.tasks[0]!.done).toBe(true);
    expect(d.tasks).toHaveLength(3);
    reopenTask(d, 't1');
    expect(d.tasks[0]).toMatchObject({ done: false, completedAt: null });
  });

  it('recordatorios de tareas: avisar, posponer y descartar', () => {
    const d = newMailData();
    const t = task({ id: 't1', due: day(2026, 6, 10), remind: day(2026, 6, 10, 9) });
    d.tasks = [t, task({ id: 't2', done: true, remind: day(2026, 6, 1) })];
    expect(dueReminders(d, day(2026, 6, 10, 8, 59))).toEqual([]);
    expect(dueReminders(d, day(2026, 6, 10, 9))).toEqual([{ key: 't:t1', kind: 'task', title: 'Informe', at: day(2026, 6, 10, 9), due: day(2026, 6, 10) }]);
    snoozeReminder(d, 't:t1', day(2026, 6, 10, 10));
    expect(dueReminders(d, day(2026, 6, 10, 9, 30))).toEqual([]);
    expect(dueReminders(d, day(2026, 6, 10, 10))).toHaveLength(1);
    dismissReminder(d, 't:t1');
    expect(dueReminders(d, day(2027, 1, 1))).toEqual([]);
    expect(d.tasks[0]!.remind).toBeUndefined();
    expect(t.remind).toBe(day(2026, 6, 10, 9));
  });

  it('van y vuelven en .ics y en el archivo', () => {
    const t = task({ due: day(2026, 6, 10), rrule: 'FREQ=MONTHLY;INTERVAL=2', fromDone: true, remind: day(2026, 6, 9, 8, 15) });
    const text = writeIcs([], [t]);
    expect(text).toContain('RRULE:FREQ=MONTHLY;INTERVAL=2');
    expect(text).toContain('DTSTART;VALUE=DATE:20260610');
    expect(parseIcs(text).tasks[0]).toMatchObject({ due: t.due, rrule: t.rrule, fromDone: true, remind: t.remind });
    const relative = parseIcs(['BEGIN:VCALENDAR', 'BEGIN:VTODO', 'UID:r@x', 'SUMMARY:R', 'DUE:20260610T120000', 'BEGIN:VALARM', 'TRIGGER;RELATED=END:-PT2H', 'END:VALARM', 'END:VTODO', 'END:VCALENDAR'].join('\r\n'));
    expect(relative.tasks[0]!.remind).toBe(day(2026, 6, 10, 10));
    const d = { ...newMailData(), tasks: [t, { ...t, id: 'x', rrule: 5 as never, remind: 'ya' as never }] };
    const back = parseMailData(serializeMail(d)).tasks;
    expect(back[0]).toEqual(t);
    expect(back[1]!.rrule).toBeUndefined();
    expect(back[1]!.fromDone).toBeUndefined();
    expect(back[1]!.remind).toBeUndefined();
  });
});
