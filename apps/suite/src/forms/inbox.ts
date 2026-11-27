/*
 * Response files on their way from Nova Mail to Nova Forms. Mail leaves them here (a store of this computer that all the
 * windows of the program share) and the Forms window with that form open offers to add them. Nothing is added to a form
 * without the person saying so.
 */
import { responseFileFor } from '@suitenova/forms-core';

export interface InboxItem {
  /** The form and the response: leaving the same file twice keeps one. */
  key: string;
  formId: string;
  text: string;
  /** Where it came from, to show it. */
  from: string;
  at: number;
}

const DB = 'nova-forms-inbox';
const STORE = 'responses';
/** The most a response file can weigh to be passed on. */
export const MAX_INBOX_BYTES = 40 * 1024 * 1024;

/** What is left for Forms from a response file; null if it is not one. */
export function inboxItem(text: string, from: string, at = Date.now()): InboxItem | null {
  const formId = responseFileFor(text);
  if (!formId) return null;
  const id = (JSON.parse(text) as { id?: unknown }).id;
  return { key: `${formId}|${typeof id === 'string' && id ? id.slice(0, 60) : `${at}-${text.length}`}`, formId, text, from: from.slice(0, 200), at };
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const changed = () => {
  const channel = new BroadcastChannel(DB);
  channel.postMessage('changed');
  channel.close();
};

export async function putInbox(items: InboxItem[]): Promise<void> {
  await run('readwrite', (s) => items.forEach((i) => s.put(i)));
  changed();
}

export const listInbox = async (): Promise<InboxItem[]> => ((await run('readonly', (s) => s.getAll() as IDBRequest<InboxItem[]>)) ?? []).sort((a, b) => a.at - b.at);

export async function removeInbox(keys: string[]): Promise<void> {
  await run('readwrite', (s) => keys.forEach((k) => s.delete(k)));
  changed();
}

/** Calls `show` with what is waiting, now and each time it changes. Returns how to stop. */
export function watchInbox(show: (items: InboxItem[]) => void): () => void {
  if (typeof indexedDB === 'undefined') return () => undefined;
  let stopped = false;
  const look = () =>
    void listInbox().then(
      (items) => !stopped && show(items),
      () => undefined,
    );
  const channel = new BroadcastChannel(DB);
  channel.onmessage = look;
  look();
  return () => {
    stopped = true;
    channel.close();
  };
}
