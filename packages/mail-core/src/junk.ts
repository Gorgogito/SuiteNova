import type { MailData } from './store';

/*
 * Blocked and safe senders. An entry is an address (ana@ejemplo.com) or a domain (@ejemplo.com, which includes its
 * subdomains). A safe sender is never treated as blocked.
 */

export interface JunkLists {
  blocked: string[];
  safe: string[];
}

export type JunkList = keyof JunkLists;

/** An entry as it is kept, or null when it is neither an address nor a domain. */
export function senderEntry(text: string): string | null {
  const s = text.trim().toLowerCase().replace(/^.*<([^>]*)>$/, '$1').replace(/^\*@/, '@');
  if (/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;".]+$/.test(s)) return s;
  const domain = s.replace(/^@/, '');
  return /^(?:[a-z0-9¡-￿-]+\.)+[a-z0-9¡-￿-]{2,}$/.test(domain) ? `@${domain}` : null;
}

export function senderListed(list: string[] | undefined, email: string): boolean {
  const e = email.trim().toLowerCase();
  const domain = e.slice(e.lastIndexOf('@') + 1);
  return !!e && !!list?.some((x) => (x.startsWith('@') ? domain === x.slice(1) || domain.endsWith(`.${x.slice(1)}`) : x === e));
}

export const isSafeSender = (d: MailData, email: string): boolean => senderListed(d.junk?.safe, email);
export const isBlockedSender = (d: MailData, email: string): boolean => !isSafeSender(d, email) && senderListed(d.junk?.blocked, email);

/** Adds to one list and takes the same entry out of the other. Returns the entry kept. */
export function listSender(d: MailData, which: JunkList, text: string): string {
  const entry = senderEntry(text);
  if (!entry) throw new Error('Escribe una dirección (ana@ejemplo.com) o un dominio (@ejemplo.com).');
  const lists = (d.junk ??= { blocked: [], safe: [] });
  const other: JunkList = which === 'blocked' ? 'safe' : 'blocked';
  lists[other] = lists[other].filter((x) => x !== entry);
  if (!lists[which].includes(entry)) lists[which] = [...lists[which], entry].sort();
  return entry;
}

export function unlistSender(d: MailData, which: JunkList, entry: string): void {
  if (!d.junk) return;
  d.junk[which] = d.junk[which].filter((x) => x !== entry);
  if (!d.junk.blocked.length && !d.junk.safe.length) delete d.junk;
}

export function readJunk(v: unknown): JunkLists | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const list = (x: unknown): string[] => [...new Set((Array.isArray(x) ? x : []).map((e) => (typeof e === 'string' ? senderEntry(e) : null)).filter((e): e is string => !!e))].sort().slice(0, 5000);
  const o = v as Partial<JunkLists>;
  const out = { blocked: list(o.blocked), safe: list(o.safe) };
  return out.blocked.length || out.safe.length ? out : undefined;
}
