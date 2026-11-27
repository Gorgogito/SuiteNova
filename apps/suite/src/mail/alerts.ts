import { t } from '@suitenova/core-ui';
import { dismissReminder, snoozeReminder, type DueReminder, type MailRecord } from '@suitenova/mail-core';
import type { MailCtl } from './ctl';
import { showNotice, systemNotices, type Pressed, type SystemNotice } from './notify';
import { canConnect, protocolOf, remote } from './remote';

export interface AlertSettings {
  /** Say when new mail arrives. */
  newMail: boolean;
  /** Also with the notices of Windows. */
  system: boolean;
  /** Receive at once from IMAP servers that can tell (IDLE), besides synchronising now and then. */
  instant: boolean;
  /** Seconds a message waits in the Outbox so that sending it can be taken back; 0: it leaves at once. */
  delay: number;
}
export const DELAY_CHOICES = [0, 5, 10, 20, 30, 60];
export const DEFAULT_ALERTS: AlertSettings = { newMail: true, system: true, instant: true, delay: 0 };
const KEY = 'novamail.alerts';
/** How long a notice inside the program stays. */
export const TOAST_MS = 10_000;
/** How long each wait for new mail lasts before asking again. */
const WAIT_SECONDS = 240;
const SNOOZE_MINUTES = 10;

export function readAlerts(): AlertSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AlertSettings>;
    return {
      newMail: typeof v.newMail === 'boolean' ? v.newMail : DEFAULT_ALERTS.newMail,
      system: typeof v.system === 'boolean' ? v.system : DEFAULT_ALERTS.system,
      instant: typeof v.instant === 'boolean' ? v.instant : DEFAULT_ALERTS.instant,
      delay: typeof v.delay === 'number' && DELAY_CHOICES.includes(v.delay) ? v.delay : DEFAULT_ALERTS.delay,
    };
  } catch {
    return { ...DEFAULT_ALERTS };
  }
}

/** A notice inside the program: new mail, or a message that could not be sent. */
export interface Toast {
  key: string;
  title: string;
  text: string;
  messageId?: string;
}

/** How an account is being told of new mail. */
export type WatchState = 'instant' | 'polling' | 'retrying';

const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** What tells the person that something happened: new mail (at once where the server can), reminders and failures. */
export class MailAlerts {
  settings = readAlerts();
  toasts: Toast[] = [];
  /** By account, while it is being watched. */
  readonly watching = new Map<string, WatchState>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private enabled = false;
  private generation = 0;
  private loops = new Set<string>();
  /** Reminders already told to the system. */
  private told = new Set<string>();
  private count = 0;

  constructor(private readonly ctl: MailCtl) {}

  set(patch: Partial<AlertSettings>): void {
    const next = { ...this.settings, ...patch };
    if (!DELAY_CHOICES.includes(next.delay)) next.delay = 0;
    this.settings = next;
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // without storage it holds for this session only
    }
    if (patch.instant !== undefined) this.startWatch();
    this.ctl.touch();
  }

  /** Another file: what was said about the one before does not hold. */
  reset(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.toasts = [];
    this.told.clear();
  }

  dispose(): void {
    this.reset();
    this.enabled = false;
    this.stopWatch();
  }

  private system(notice: SystemNotice): void {
    if (!this.settings.system || !systemNotices()) return;
    showNotice(notice).catch((e) => {
      this.ctl.syncMessage = (e as Error).message ?? String(e);
      this.ctl.touch();
    });
  }

  private toast(toast: Omit<Toast, 'key'>): void {
    const key = `n${++this.count}`;
    this.toasts = [...this.toasts, { ...toast, key }].slice(-4);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.dismiss(key);
    }, TOAST_MS);
    this.timers.add(timer);
    this.ctl.touch();
  }

  dismiss(key: string): void {
    if (!this.toasts.some((x) => x.key === key)) return;
    this.toasts = this.toasts.filter((x) => x.key !== key);
    this.ctl.touch();
  }

  /** Messages that have just arrived: what is unread and was not taken away as junk. */
  newMail(ids: string[]): void {
    if (!this.settings.newMail || !ids.length) return;
    const quiet = new Set(['trash', 'junk', 'drafts', 'sent', 'outbox']);
    const news = this.ctl.records(ids).filter((m) => !m.read && !quiet.has(m.folder));
    if (!news.length) return;
    const who = (m: MailRecord) => m.from || m.fromEmail || t('(sin remitente)');
    const newest = [...news].sort((a, b) => b.date - a.date)[0]!;
    const title = news.length === 1 ? who(newest) : t('{n} mensajes nuevos', { n: news.length });
    const text = news.length === 1 ? newest.subject || t('(sin asunto)') : [...new Set(news.map(who))].slice(0, 3).join(', ');
    this.toast({ title, text, messageId: newest.id });
    this.system({ id: `mail:${newest.id}`, title, body: text });
  }

  sendFailed(m: MailRecord, reason: string): void {
    const title = t('No se pudo enviar «{subject}»', { subject: m.subject || t('(sin asunto)') });
    this.toast({ title, text: t(reason), messageId: m.id });
    this.system({ id: `mail:${m.id}`, title, body: t(reason) });
  }

  /** Tells the system, once, of each reminder that has come. */
  reminders(due: DueReminder[]): void {
    for (const r of due) {
      // one that was snoozed is said again when it comes back
      const until = this.ctl.data.reminders?.[r.key]?.until;
      const key = `${r.key}|${until === undefined ? r.at : `snoozed ${until}`}`;
      if (this.told.has(key)) continue;
      this.told.add(key);
      this.system({
        id: `rem:${r.key}`,
        title: r.title || t('(sin título)'),
        body: r.kind === 'mail' ? t('Seguimiento') : new Date(r.at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }),
        actions: [
          { id: 'snooze', label: t('Posponer {n} min', { n: SNOOZE_MINUTES }) },
          { id: 'dismiss', label: t('Descartar') },
        ],
      });
    }
  }

  /** What was pressed in a notice of the system. */
  pressed({ id, action }: Pressed): void {
    const at = id.indexOf(':');
    const kind = id.slice(0, at);
    const key = id.slice(at + 1);
    if (kind === 'mail') this.ctl.openMessage(key);
    else if (kind === 'rem') {
      if (action === 'snooze') {
        snoozeReminder(this.ctl.data, key, Date.now() + SNOOZE_MINUTES * 60_000);
        this.ctl.touch(true);
      } else if (action === 'dismiss') {
        dismissReminder(this.ctl.data, key);
        this.ctl.touch(true);
      } else this.ctl.openReminder(key);
    }
  }

  // ---------- new mail at once ----------

  /** From now on the accounts are watched (the program calls it once it knows them). */
  enableWatch(): void {
    this.enabled = true;
    this.startWatch();
  }

  private stopWatch(): void {
    this.generation++;
    this.loops.clear();
    this.watching.clear();
  }

  /** Starts watching what is not being watched, or stops it all if it was turned off. */
  startWatch(): void {
    if (!this.enabled || !this.settings.instant || !canConnect()) {
      this.stopWatch();
      return;
    }
    for (const id of [...this.watching.keys()]) if (!this.ctl.accounts.some((a) => a.id === id)) this.watching.delete(id);
    for (const a of this.ctl.accounts) {
      if (protocolOf(a) !== 'imap' || this.loops.has(a.id)) continue;
      this.loops.add(a.id);
      void this.watch(a.id, this.generation);
    }
  }

  private async watch(id: string, generation: number): Promise<void> {
    const alive = () => generation === this.generation && this.ctl.accounts.some((a) => a.id === id);
    let marker: string | null = null;
    let failures = 0;
    let hurried = 0;
    while (alive()) {
      const began = Date.now();
      try {
        const r = await remote.wait(id, marker, WAIT_SECONDS);
        if (!alive()) break;
        // a server that cannot tell is only synchronised now and then; it is not asked again
        if (r?.status !== 'changed' && r?.status !== 'timeout') {
          this.watching.set(id, 'polling');
          this.ctl.touch();
          return;
        }
        failures = 0;
        this.state(id, 'instant');
        marker = r.marker;
        if (r.status === 'changed') await this.ctl.pullInbox(id);
        // a server that answers at once again and again must not keep the program busy
        hurried = Date.now() - began < 500 ? hurried + 1 : 0;
        if (hurried > 3) await pause(5000);
      } catch {
        if (!alive()) break;
        failures++;
        this.state(id, 'retrying');
        await pause(Math.min(30_000 * 2 ** (failures - 1), 300_000));
      }
    }
    if (generation === this.generation) this.loops.delete(id);
  }

  private state(id: string, state: WatchState): void {
    if (this.watching.get(id) === state) return;
    this.watching.set(id, state);
    this.ctl.touch();
  }
}
