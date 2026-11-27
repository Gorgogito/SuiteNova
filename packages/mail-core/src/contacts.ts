/**
 * What is done with contacts beyond reading and writing them: groups of people, telling apart who is already there,
 * duplicates and how they are joined, and a contact made from an address of a message.
 */
import type { Address } from './mime';
import { displayName, isGroup, newContact, type Contact, type LabeledValue } from './vcard';

const fold = (s: string): string => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const low = (s: string): string => s.trim().toLowerCase();

/** A name as it is written, split in first and last names: «García, Ana» or «Ana García Ruiz». */
export function splitName(name: string): { first: string; last: string } {
  const clean = name.replace(/\s+/g, ' ').trim();
  const comma = /^([^,]+),\s*(.+)$/.exec(clean);
  if (comma) return { first: comma[2]!, last: comma[1]! };
  const [first = '', ...rest] = clean.split(' ');
  return { first, last: rest.join(' ') };
}

/** The contact (not a group) that has an address. */
export function contactByEmail(contacts: Contact[], email: string): Contact | undefined {
  const wanted = low(email);
  return wanted ? contacts.find((c) => !isGroup(c) && c.emails.some((e) => low(e.value) === wanted)) : undefined;
}

/** A person (not a group) with that name who does not have the address: it may be added to them. */
export function contactByName(contacts: Contact[], name: string): Contact | undefined {
  const wanted = fold(name);
  return wanted ? contacts.find((c) => !isGroup(c) && fold(displayName(c)) === wanted) : undefined;
}

/** A new contact for someone who appears in a message. */
export function contactFromAddress(a: Address): Contact {
  const name = a.name.trim() && low(a.name) !== low(a.email) ? a.name.trim() : '';
  const { first, last } = splitName(name);
  return { ...newContact(), name: name ? `${first} ${last}`.trim() : '', first, last, emails: [{ label: 'otro', value: a.email.trim() }] };
}

/** A new group. */
export const newGroup = (name = ''): Contact => ({ ...newContact(), name, members: [] });

/** Adds people to a group, without repeating addresses. */
export function addMembers(group: Contact, people: Address[]): Contact {
  const members = [...(group.members ?? [])];
  const known = new Set(members.map((m) => low(m.email)));
  for (const p of people) {
    const email = p.email.trim();
    if (!email || known.has(low(email))) continue;
    known.add(low(email));
    members.push({ name: p.name.trim(), email });
  }
  return { ...group, members };
}

/**
 * What was typed as recipients, with the name of a group changed into the people of that group. A group with nobody in
 * it stays as it was typed, so that it can be pointed out.
 */
export function expandGroups(list: Address[], contacts: Contact[]): Address[] {
  const groups = new Map(contacts.filter((c) => isGroup(c) && c.members!.length).map((c) => [fold(displayName(c)), c.members!]));
  if (!groups.size) return list;
  const out: Address[] = [];
  const seen = new Set<string>();
  const add = (a: Address) => {
    if (seen.has(low(a.email))) return;
    seen.add(low(a.email));
    out.push(a);
  };
  for (const a of list) {
    const members = a.email.includes('@') ? undefined : groups.get(fold(a.email || a.name));
    if (members) members.forEach(add);
    else add(a);
  }
  return out;
}

export interface Duplicates {
  contacts: Contact[];
  /** Why they look like the same person. */
  reason: 'email' | 'name';
}

/** People who seem to be there more than once: they share an address, or they are called the same. */
export function findDuplicates(contacts: Contact[]): Duplicates[] {
  const people = contacts.filter((c) => !isGroup(c));
  const parent = people.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  const byEmail = new Set<number>();
  const join = (keys: (c: Contact) => string[], email: boolean) => {
    const first = new Map<string, number>();
    people.forEach((c, i) => {
      for (const k of new Set(keys(c))) {
        const j = first.get(k);
        if (j === undefined) first.set(k, i);
        else {
          const a = root(i);
          const b = root(j);
          if (a !== b) parent[a] = b;
          if (email) byEmail.add(i).add(j);
        }
      }
    });
  };
  join((c) => c.emails.map((e) => low(e.value)).filter(Boolean), true);
  // only a name that was written counts: not one taken from the address or the company
  join((c) => (c.name.trim() || c.first.trim() || c.last.trim() ? [fold(displayName(c))] : []), false);
  const groups = new Map<number, number[]>();
  people.forEach((_, i) => {
    const r = root(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g): Duplicates => ({ contacts: g.map((i) => people[i]!), reason: g.some((i) => byEmail.has(i)) ? 'email' : 'name' }))
    .sort((a, b) => displayName(a.contacts[0]!).localeCompare(displayName(b.contacts[0]!), 'es'));
}

const SINGLE = ['name', 'first', 'last', 'org', 'title', 'address', 'url', 'birthday'] as const;
const FIELD: Record<(typeof SINGLE)[number], string> = { name: 'Nombre', first: 'Nombre', last: 'Apellidos', org: 'Empresa', title: 'Cargo', address: 'Dirección', url: 'Sitio web', birthday: 'Cumpleaños' };
const filled = (c: Contact): number => SINGLE.filter((k) => c[k].trim()).length + c.emails.length + c.phones.length + (c.note ? 1 : 0) + (c.photo ? 1 : 0);

const union = (lists: LabeledValue[][], key: (v: string) => string): LabeledValue[] => {
  const seen = new Map<string, LabeledValue>();
  for (const v of lists.flat()) if (v.value.trim() && !seen.has(key(v.value))) seen.set(key(v.value), v);
  return [...seen.values()];
};

/**
 * One contact out of several: the most complete one, with everything the others add. What says something different in
 * one field (another company, another birthday) is written down in the notes: nothing is lost.
 */
export function mergeContacts(list: Contact[]): Contact {
  const [base, ...rest] = [...list].sort((a, b) => filled(b) - filled(a));
  const out: Contact = { ...base! };
  const other: string[] = [];
  for (const c of rest) {
    for (const k of SINGLE) {
      const v = c[k].trim();
      if (!v) continue;
      if (!out[k].trim()) out[k] = v;
      // the parts of the name only differ when the name does
      else if (fold(out[k]) !== fold(v) && k !== 'first' && k !== 'last') other.push(`${FIELD[k]}: ${v}`);
    }
    out.photo ??= c.photo;
  }
  const all = [base!, ...rest];
  out.emails = union(all.map((c) => c.emails), low);
  out.phones = union(all.map((c) => c.phones), (v) => v.replace(/[^\d+]/g, '') || low(v));
  const notes = [...new Set(all.map((c) => c.note.trim()).filter(Boolean))];
  const extra = [...new Set(other)].filter((x) => !notes.some((n) => n.includes(x)));
  if (extra.length) notes.push(extra.join('\n'));
  out.note = notes.join('\n\n');
  const categories = [...new Set(all.flatMap((c) => c.categories ?? []))];
  if (categories.length) out.categories = categories;
  if (!out.photo) delete out.photo;
  return out;
}
