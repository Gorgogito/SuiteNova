import { decodeBase64, parseHeaders } from './mime';
import type { MailRecord } from './store';

/*
 * Conversations. Messages belong together when one names another (Message-ID, In-Reply-To, References). A reply that
 * names nobody (some programs send them so) joins the latest earlier message with the same subject.
 */

export const messageIds = (value: string): string[] => value.match(/<[^<>\s]+>/g) ?? [];

const PREFIX = /^\s*(re|rv|fw|fwd|enc|reenv)\s*(\[\d+\])?\s*:\s*/i;

/** The subject without the prefixes of answers and forwards. */
export function topicOf(subject: string): string {
  let s = subject;
  for (let m = PREFIX.exec(s); m; m = PREFIX.exec(s)) s = s.slice(m[0].length);
  return s.trim();
}

/** Message-ID and referenced ids of a record; records saved before they were kept get them from their headers, once. */
export function threadHeaders(r: MailRecord): { mid: string; refs: string[] } {
  if (r.refs === undefined) {
    let mid = r.mid ?? '';
    let refs: string[] = [];
    try {
      // the headers are at the start: the whole message is not decoded
      const head = new TextDecoder('latin1').decode(decodeBase64(r.raw.slice(0, 65536))).split(/\r?\n\r?\n/)[0]!;
      const headers = parseHeaders(head);
      const value = (name: string) => headers.find(([k]) => k.toLowerCase() === name)?.[1] ?? '';
      mid ||= value('message-id');
      refs = [...new Set([...messageIds(value('references')), ...messageIds(value('in-reply-to'))])];
    } catch {
      // a message that cannot be read is a conversation of its own
    }
    r.refs = refs;
    if (mid) r.mid = mid;
  }
  return { mid: r.mid ?? '', refs: r.refs };
}

/** The conversation of each message (record id → key of the conversation). */
export function conversationsOf(messages: MailRecord[]): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.has(root)) root = parent.get(root)!;
    // shorter paths for the next time
    for (let cur = x; parent.has(cur) && parent.get(cur) !== root; ) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const join = (a: string, b: string) => {
    const x = find(a);
    const y = find(b);
    if (x !== y) parent.set(x, y);
  };
  const node = new Map<string, string>();
  const loose: MailRecord[] = [];
  for (const m of messages) {
    const { mid, refs } = threadHeaders(m);
    const own = mid || `#${m.id}`;
    node.set(m.id, own);
    for (const r of refs) join(own, r);
    if (!refs.length && PREFIX.test(m.subject)) loose.push(m);
  }
  if (loose.length) {
    const topics = new Map<string, MailRecord[]>();
    for (const m of messages) {
      const t = topicOf(m.subject).toLowerCase();
      if (t) topics.set(t, [...(topics.get(t) ?? []), m]);
    }
    for (const m of loose) {
      const earlier = (topics.get(topicOf(m.subject).toLowerCase()) ?? []).filter((x) => x.id !== m.id && x.date <= m.date).sort((a, b) => b.date - a.date)[0];
      if (earlier) join(node.get(m.id)!, node.get(earlier.id)!);
    }
  }
  return new Map(messages.map((m) => [m.id, find(node.get(m.id)!)]));
}
