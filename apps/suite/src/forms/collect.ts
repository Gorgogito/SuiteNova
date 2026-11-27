/*
 * Collecting responses on the local network. The desktop application listens (forms_server.rs) and hands each response to
 * this window, which decides with the rules of the form whether it is taken, writes it into the file and only then lets
 * whoever sent it be told that it arrived.
 */
import { answeredHtml, bodyLimit, exportHtml, localize, receiveResponse, type Form } from '@suitenova/forms-core';
import { isTauri } from '../platform';
import type { FormsCtl } from './ctl';

export interface Address {
  ip: string;
  /** The network adapter; empty for «this computer only». */
  name: string;
  /** The one this computer uses to go out to the network. */
  main: boolean;
}
export interface Served {
  page: string;
  answered: string;
  key: string;
  once: boolean;
  maxBody: number;
}
export type Verdict = { ok: true } | { ok: false; message: string };

export interface CollectBridge {
  addresses(): Promise<Address[]>;
  /** Starts listening; `arrived` gets each response as text, and what it answers is told to whoever sent it. */
  start(address: string, content: Served, arrived: (body: string) => Promise<Verdict>): Promise<{ url: string }>;
  update(content: Served): Promise<void>;
  stop(): Promise<void>;
}

let custom: CollectBridge | null = null;
/** Only for tests (linked to `window.__novaForms` in development). */
export function setCollectBridge(bridge: CollectBridge | null): void {
  custom = bridge;
}

const desktop: CollectBridge = (() => {
  let off: (() => void) | undefined;
  const invoke = async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => (await import('@tauri-apps/api/core')).invoke<T>(command, args);
  const stop = async () => {
    off?.();
    off = undefined;
    await invoke('forms_server_stop');
  };
  return {
    addresses: () => invoke<Address[]>('forms_server_addresses'),
    async start(address, content, arrived) {
      await stop();
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      off = await getCurrentWebviewWindow().listen<number>('nova-forms-response', (e) => {
        const id = e.payload;
        void (async () => {
          let verdict: Verdict;
          try {
            verdict = await arrived(await invoke<string>('forms_server_take', { id }));
          } catch {
            // without an answer the sender is told to try again
            return;
          }
          await invoke('forms_server_reply', { id, ok: verdict.ok, message: verdict.ok ? '' : verdict.message }).catch(() => undefined);
        })();
      });
      return invoke<{ url: string }>('forms_server_start', { address, content });
    },
    update: (content) => invoke('forms_server_update', { content }),
    stop,
  };
})();

/** Collecting needs the desktop application. */
export const collectBridge = (): CollectBridge | null => custom ?? (isTauri() ? desktop : null);

/** What is served for a form. */
export const servedContent = (form: Form): Served => ({ page: exportHtml(form, { send: true }), answered: answeredHtml(form), key: form.id, once: !!form.noAgain, maxBody: bodyLimit(form) });

export class Collector {
  running = false;
  starting = false;
  url = '';
  /** Responses taken since it was started, and the ones refused. */
  received = 0;
  refused = 0;
  lastRefusal = '';
  lastAt: number | null = null;
  error = '';
  /** Why it stopped by itself. */
  stopped = '';
  private formId = '';
  private taken = new Set<string>();
  /** One response at a time: each is written down before the next is looked at. */
  private queue: Promise<unknown> = Promise.resolve();
  private version = 0;
  private listeners = new Set<() => void>();

  constructor(
    private ctl: FormsCtl,
    /** Writes the form with its responses where it is kept; false if it could not. */
    private persist: () => Promise<boolean>,
    private onArrived: (count: number) => void = () => undefined,
  ) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = (): number => this.version;
  private touch(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  async start(address: string): Promise<void> {
    const bridge = collectBridge();
    if (!bridge || this.running || this.starting) return;
    this.starting = true;
    this.error = '';
    this.stopped = '';
    this.touch();
    try {
      this.formId = this.ctl.form.id;
      const { url } = await bridge.start(address, servedContent(this.ctl.form), (body) => this.arrived(body));
      this.url = url;
      this.running = true;
      this.received = this.refused = 0;
      this.lastRefusal = '';
      this.lastAt = null;
      this.taken.clear();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      await bridge.stop().catch(() => undefined);
    } finally {
      this.starting = false;
      this.touch();
    }
  }

  async stop(why = ''): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.url = '';
    this.stopped = why;
    this.touch();
    await collectBridge()
      ?.stop()
      .catch(() => undefined);
  }

  /** The form changed: whoever opens the address from now on sees it as it is. Another form stops the collecting. */
  async refresh(why: string): Promise<void> {
    if (!this.running) return;
    if (this.ctl.form.id !== this.formId) return this.stop(why);
    try {
      await collectBridge()?.update(servedContent(this.ctl.form));
      if (this.error) {
        this.error = '';
        this.touch();
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.touch();
    }
  }

  arrived(body: string): Promise<Verdict> {
    const done = this.queue.then(() => this.take(body));
    this.queue = done.catch(() => undefined);
    return done;
  }

  private async take(body: string): Promise<Verdict> {
    const lang = this.ctl.form.language;
    if (!this.running || this.ctl.form.id !== this.formId) return { ok: false, message: localize('Esta dirección recoge ahora otro formulario. Recarga la página.', lang) };
    const r = receiveResponse(this.ctl.form, this.ctl.responses, body, Date.now());
    if (!r.ok) {
      this.refused++;
      this.lastRefusal = r.message;
      this.touch();
      return r;
    }
    if (!r.duplicate) this.ctl.addReceived(r.response);
    // also when it was already there: the first time it may not have been written down
    if (!(await this.persist())) {
      this.error = 'No se pudo guardar el archivo: las respuestas están en pantalla, pero no escritas.';
      this.touch();
      return { ok: false, message: localize('No se pudo guardar la respuesta: avisa a quien la recoge y reintenta.', lang) };
    }
    this.error = '';
    const fresh = !this.taken.has(r.response.id);
    if (fresh) {
      this.taken.add(r.response.id);
      this.received = this.taken.size;
      this.lastAt = Date.now();
    }
    this.touch();
    if (fresh) this.onArrived(this.received);
    return { ok: true };
  }
}
