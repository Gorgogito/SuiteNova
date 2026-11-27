/**
 * Recipients of a message being written: reading what was typed in To, Cc and Bcc, and suggesting addresses from the
 * contacts and from the mail itself, as Outlook does.
 */
import { decodeBase64, parseMessage, type Address } from './mime';
import type { MailData, MailRecord } from './store';
import { displayName, isGroup } from './vcard';

/** Index of every separator (comma or semicolon) that is not inside quotes or angle brackets. */
function separators(text: string): number[] {
  const out: number[] = [];
  let quoted = false;
  let angle = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"' && text[i - 1] !== '\\') quoted = !quoted;
    else if (!quoted && ch === '<') angle = true;
    else if (!quoted && ch === '>') angle = false;
    else if (!quoted && !angle && (ch === ',' || ch === ';')) out.push(i);
  }
  return out;
}

/** What was typed, as addresses. Anything that is not an address is kept, so that it can be pointed out. */
export function splitRecipients(text: string): Address[] {
  const cuts = [-1, ...separators(text), text.length];
  return cuts
    .slice(1)
    .map((end, i) => text.slice(cuts[i]! + 1, end).trim())
    .filter(Boolean)
    .map((item) => {
      const m = /^(.*)<([^<>]+)>$/s.exec(item);
      return m ? { name: m[1]!.trim().replace(/^"(.*)"$/s, '$1').replace(/\\(["\\])/g, '$1').trim(), email: m[2]!.trim() } : { name: '', email: item };
    });
}

/** The recipient being typed where the cursor is: its text and the stretch it takes. */
export function typedRecipient(text: string, caret: number): { from: number; to: number; query: string } {
  const cuts = separators(text);
  const before = cuts.filter((i) => i < caret);
  const from = before.length ? before[before.length - 1]! + 1 : 0;
  const to = cuts.find((i) => i >= caret) ?? text.length;
  return { from, to, query: text.slice(from, to).trim() };
}

export interface BookEntry {
  name: string;
  email: string;
  /** Contacts first, then the people written to most, then those who have written. */
  score: number;
  /** A contact group: choosing it writes these people. */
  group?: Address[];
}

const CONTACT = 1_000_000;
/** The headers of a message, without decoding its attachments. */
const heads = new WeakMap<MailRecord, Address[]>();
function recipientsOf(r: MailRecord): Address[] {
  let list = heads.get(r);
  if (!list) {
    const m = parseMessage(decodeBase64(r.raw.slice(0, 64 * 1024)));
    list = [...m.to, ...m.cc, ...(r.bcc ?? []).map((email) => ({ name: '', email }))];
    heads.set(r, list);
  }
  return list;
}

/** Everyone the mail knows. `own` are the addresses of the person (lower case): what they send counts its recipients. */
export function addressBook(d: MailData, own: ReadonlySet<string>): BookEntry[] {
  const book = new Map<string, BookEntry>();
  const add = (name: string, email: string, score: number) => {
    const address = email.trim();
    if (!/^[^\s@<>,;]+@[^\s@<>,;]+$/.test(address)) return;
    const key = address.toLowerCase();
    const e = book.get(key);
    if (!e) book.set(key, { name: name.trim(), email: address, score });
    else {
      e.score += score >= CONTACT && e.score >= CONTACT ? 0 : score;
      // the name given in the contacts wins over the one of a message
      if (name.trim() && (!e.name || score >= CONTACT)) e.name = name.trim();
    }
  };
  for (const c of d.contacts) for (const v of c.emails) add(displayName(c) === v.value ? '' : displayName(c), v.value, CONTACT);
  for (const m of d.messages) {
    if (m.folder === 'junk') continue;
    if (m.folder === 'sent' || own.has(m.fromEmail.toLowerCase())) {
      if (m.folder !== 'drafts') for (const a of recipientsOf(m)) add(a.name, a.email, 3);
    } else add(m.from === m.fromEmail ? '' : m.from, m.fromEmail, 1);
  }
  const groups = d.contacts.filter((c) => isGroup(c) && c.members!.length).map((c): BookEntry => ({ name: displayName(c), email: '', score: CONTACT, group: c.members! }));
  return [...groups, ...book.values()];
}

const fold = (s: string): string => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** The entries that match what is typed, the best first: the start of the name, of a word of it or of the address, then the rest. */
export function suggestRecipients(book: BookEntry[], query: string, exclude: ReadonlySet<string> = new Set(), limit = 6): BookEntry[] {
  const q = fold(query.replace(/^"/, '').trim());
  if (!q) return [];
  const found: { e: BookEntry; rank: number }[] = [];
  for (const e of book) {
    // a group is no longer suggested once everyone in it is written
    if (e.group ? e.group.every((m) => exclude.has(m.email.toLowerCase())) : exclude.has(e.email.toLowerCase())) continue;
    const name = fold(e.name);
    const email = fold(e.email);
    const rank = name.startsWith(q) || email.startsWith(q) ? 2 : name.split(/\s+/).some((w) => w.startsWith(q)) ? 1 : name.includes(q) || email.includes(q) ? 0 : -1;
    if (rank >= 0) found.push({ e, rank });
  }
  return found.sort((a, b) => b.rank - a.rank || b.e.score - a.e.score || a.e.email.localeCompare(b.e.email) || a.e.name.localeCompare(b.e.name)).slice(0, limit).map((x) => x.e);
}
