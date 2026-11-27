import {
  addMembers,
  completeTask,
  contactByEmail,
  contactByName,
  contactFromAddress,
  displayName,
  expandGroups,
  mergeContacts,
  reopenTask,
  splitRecipients,
  type Address,
  type Contact,
  type TaskItem,
} from '@suitenova/mail-core';
import type { MailCtl } from './ctl';

/** How many changes of the contacts, and of the tasks, can be undone. */
const DEPTH = 30;

type Kind = 'contacts' | 'tasks';
type Item = Contact | TaskItem;
interface Step {
  label: string;
  /** What each changed item was, and where; without `before`, it was not there. */
  items: { id: string; before?: Item; index: number }[];
}

/**
 * The contacts and the tasks of the open mailbox. Each of the two has its own undo, which puts back only what its own
 * changes touched. Items are never changed where they are: a changed one is a new one.
 */
export class MailPeople {
  private past: Record<Kind, Step[]> = { contacts: [], tasks: [] };

  constructor(private readonly ctl: MailCtl) {}

  reset(): void {
    this.past = { contacts: [], tasks: [] };
  }

  private list(kind: Kind): Item[] {
    return this.ctl.data[kind];
  }

  private put(kind: Kind, list: Item[]): void {
    if (kind === 'contacts') this.ctl.data.contacts = list as Contact[];
    else this.ctl.data.tasks = list as TaskItem[];
  }

  /** Changes the contacts or the tasks; one undo takes it back. */
  change(kind: Kind, label: string, run: () => void): void {
    const before = this.list(kind);
    run();
    const after = this.list(kind);
    const now = new Map(after.map((x) => [x.id, x]));
    const was = new Set(before.map((x) => x.id));
    const items: Step['items'] = [
      ...before.flatMap((x, index) => (now.get(x.id) === x ? [] : [{ id: x.id, before: x, index }])),
      ...after.filter((x) => !was.has(x.id)).map((x) => ({ id: x.id, index: -1 })),
    ];
    if (!items.length) return;
    this.past[kind].push({ label, items });
    if (this.past[kind].length > DEPTH) this.past[kind].shift();
    this.ctl.touch(true);
  }

  undoLabel(kind: Kind): string {
    return this.past[kind][this.past[kind].length - 1]?.label ?? '';
  }

  undo(kind: Kind): void {
    const step = this.past[kind].pop();
    if (!step) return;
    const changed = new Set(step.items.map((i) => i.id));
    const list = this.list(kind).filter((x) => !changed.has(x.id));
    // in the order they had, so that each goes back to its place
    for (const { before, index } of step.items) if (before) list.splice(Math.min(index, list.length), 0, before);
    this.put(kind, list);
    const back = step.items.find((i) => i.before)?.id ?? null;
    const there = (id: string | null) => !!id && list.some((x) => x.id === id);
    if (kind === 'contacts') this.ctl.selectedContact = back ?? (there(this.ctl.selectedContact) ? this.ctl.selectedContact : null);
    else if (!this.ctl.selectedTask?.startsWith('mail:')) this.ctl.selectedTask = back ?? (there(this.ctl.selectedTask) ? this.ctl.selectedTask : null);
    this.ctl.touch(true);
  }

  // ---------- contacts ----------

  find(id: string): Contact | undefined {
    return this.ctl.data.contacts.find((c) => c.id === id);
  }

  add(c: Contact): void {
    this.change('contacts', 'Agregar contacto', () => {
      this.ctl.data.contacts = [...this.ctl.data.contacts, c];
    });
    this.ctl.selectedContact = c.id;
    this.ctl.touch();
  }

  update(c: Contact): void {
    this.change('contacts', 'Cambiar contacto', () => {
      this.ctl.data.contacts = this.ctl.data.contacts.map((x) => (x.id === c.id ? c : x));
    });
  }

  remove(id: string): void {
    this.change('contacts', 'Eliminar contacto', () => {
      this.ctl.data.contacts = this.ctl.data.contacts.filter((c) => c.id !== id);
    });
    if (this.ctl.selectedContact === id) this.ctl.selectedContact = null;
    this.ctl.touch();
  }

  import(contacts: Contact[]): void {
    this.change('contacts', 'Importar contactos', () => {
      this.ctl.data.contacts = [...this.ctl.data.contacts, ...contacts];
    });
  }

  /** Joins each list of contacts into one, in the place of the first. One undo takes all of them back. */
  merge(groups: string[][]): number {
    let joined = 0;
    this.change('contacts', 'Combinar contactos', () => {
      for (const ids of groups) {
        const list = this.ctl.data.contacts.filter((c) => ids.includes(c.id));
        if (list.length < 2) continue;
        const one = mergeContacts(list);
        const gone = new Set(list.map((c) => c.id));
        this.ctl.data.contacts = this.ctl.data.contacts.flatMap((c) => (c.id === list[0]!.id ? [one] : gone.has(c.id) ? [] : [c]));
        if (this.ctl.selectedContact && gone.has(this.ctl.selectedContact)) this.ctl.selectedContact = one.id;
        joined += list.length;
      }
    });
    return joined;
  }

  /** Goes to the contact of someone, adding it first if there is none. */
  fromAddress(a: Address): void {
    const there = contactByEmail(this.ctl.data.contacts, a.email);
    const c = there ?? contactFromAddress(a);
    if (!there) this.add(c);
    this.ctl.openContact(c.id);
  }

  /** A person called like this who does not have the address yet. */
  sameName(a: Address): Contact | undefined {
    return a.name && !contactByEmail(this.ctl.data.contacts, a.email) ? contactByName(this.ctl.data.contacts, a.name) : undefined;
  }

  /** Gives an address to a contact that is already there, and goes to it. */
  addEmail(id: string, email: string): void {
    const c = this.find(id);
    if (!c) return;
    this.update({ ...c, emails: [...c.emails, { label: 'otro', value: email }] });
    this.ctl.openContact(id);
  }

  /** What was typed, added to a group: addresses, names of contacts or of other groups. Returns what was not understood. */
  addToGroup(group: Contact, typed: string): { group: Contact; unknown: string[] } {
    const unknown: string[] = [];
    const people: Address[] = [];
    for (const a of expandGroups(splitRecipients(typed), this.ctl.data.contacts)) {
      if (/^[^\s@<>,;]+@[^\s@<>,;]+$/.test(a.email)) {
        people.push(a);
        continue;
      }
      const c = contactByName(this.ctl.data.contacts, a.email);
      const email = c?.emails[0]?.value;
      if (email) people.push({ name: displayName(c!), email });
      else unknown.push(a.email);
    }
    return { group: addMembers(group, people), unknown };
  }

  // ---------- tasks ----------

  addTask(t: TaskItem): void {
    this.change('tasks', 'Agregar tarea', () => {
      this.ctl.data.tasks = [...this.ctl.data.tasks, t];
    });
    this.ctl.selectedTask = t.id;
    this.ctl.touch();
  }

  updateTask(t: TaskItem): void {
    this.change('tasks', 'Cambiar tarea', () => {
      this.ctl.data.tasks = this.ctl.data.tasks.map((x) => (x.id === t.id ? t : x));
    });
  }

  /** Completes a task, or opens it again. Returns the next date of one that repeats. */
  toggleTask(id: string): number | null {
    const t = this.ctl.data.tasks.find((x) => x.id === id);
    if (!t) return null;
    let next: number | null = null;
    if (t.done) this.change('tasks', 'Reabrir tarea', () => reopenTask(this.ctl.data, id));
    else this.change('tasks', 'Completar tarea', () => void (next = completeTask(this.ctl.data, id, Date.now())));
    return next;
  }

  removeTask(id: string): void {
    this.change('tasks', 'Eliminar tarea', () => {
      this.ctl.data.tasks = this.ctl.data.tasks.filter((t) => t.id !== id);
    });
    if (this.ctl.selectedTask === id) this.ctl.selectedTask = null;
    this.ctl.touch();
  }
}
