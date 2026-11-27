import { t } from '@suitenova/core-ui';
import { TOO_LATE, isRetryable, retryDelay, withSendDate, type MailRecord, type Outgoing } from '@suitenova/mail-core';
import type { MailCtl } from './ctl';
import { canConnect, messageOf, remote } from './remote';

/* The messages waiting to be sent. They leave only while the program is open. */

/** The longest the program sleeps before looking again (a computer that slept wakes up late). */
const TICK = 30_000;
/** For this long another window that says it is sending a message is believed. */
const BUSY = 5 * 60_000;
const CLAIM = 'novamail.sent.';
const KEEP_CLAIMS = 30 * 86400_000;
const UNKNOWN = 'Nova Mail se cerró mientras se enviaba: comprueba si llegó antes de volver a enviarlo.';

/**
 * Runs something while no other window of the program runs it too (the browser keeps the turn, also between windows).
 * Undefined when another one has it right now.
 */
async function alone<T>(name: string, run: (sure: boolean) => Promise<T>): Promise<T | undefined> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks) return run(false);
  return locks.request(name, { ifAvailable: true }, async (lock) => (lock ? run(true) : undefined)) as Promise<T | undefined>;
}

/*
 * Two windows may have the same file open, and the program may be closed between sending a message and saving that it
 * was sent. What is being sent and what was sent is noted outside the file, by Message-ID, so that nothing leaves twice.
 */
interface Claim {
  state: 'sending' | 'sent';
  at: number;
  by: string;
}
const claimKey = (m: MailRecord) => CLAIM + (m.mid || m.id);
function readClaim(key: string): Claim | null {
  try {
    const c = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<Claim> | null;
    return c && (c.state === 'sending' || c.state === 'sent') && typeof c.at === 'number' ? (c as Claim) : null;
  } catch {
    return null;
  }
}
function writeClaim(key: string, claim: Claim | null): void {
  try {
    if (claim) localStorage.setItem(key, JSON.stringify(claim));
    else localStorage.removeItem(key);
  } catch {
    // without storage there is only this window
  }
}
function dropOldClaims(now: number): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(CLAIM) && now - (readClaim(key)?.at ?? 0) > KEEP_CLAIMS) localStorage.removeItem(key);
    }
  } catch {
    // nothing to tidy
  }
}

const clock = (at: number) => new Date(at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export class MailOutbox {
  private readonly me = Math.random().toString(36).slice(2);
  private sending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private working: Promise<void> | null = null;

  constructor(private readonly ctl: MailCtl) {}

  get messages(): MailRecord[] {
    return this.ctl.data.messages.filter((m) => m.folder === 'outbox' && m.outgoing);
  }

  isSending(id: string): boolean {
    return this.sending.has(id);
  }

  /** The last message that can still be taken back before it leaves. */
  get undoable(): MailRecord | null {
    const now = Date.now();
    return this.messages.filter((m) => m.outgoing!.kind === 'delay' && !m.outgoing!.held && m.outgoing!.at > now && !this.sending.has(m.id)).pop() ?? null;
  }

  /** What to say about a message that waits. */
  status(m: MailRecord): string {
    const o = m.outgoing;
    if (!o) return '';
    if (this.sending.has(m.id)) return t('Enviando…');
    if (o.held) return t('No se envió: {error}', { error: t(o.error ?? '') });
    if (o.error) return t('No se pudo enviar ({error}). Se reintentará: {date}.', { error: t(o.error), date: clock(o.at) });
    if (o.kind === 'later') return t('Programado para {date}.', { date: clock(o.at) });
    return t('Se enviará en un momento.');
  }

  /** What to ask before closing the window while something waits to leave. */
  closeQuestion(): string | null {
    const n = this.messages.filter((m) => !m.outgoing!.held).length;
    if (!n) return null;
    return n === 1
      ? t('Hay 1 mensaje en la Bandeja de salida: solo se envía con Nova Mail abierto. ¿Cerrar de todos modos?')
      : t('Hay {n} mensajes en la Bandeja de salida: solo se envían con Nova Mail abierto. ¿Cerrar de todos modos?', { n });
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Sets the alarm for the next message that has to leave. */
  schedule(): void {
    this.dispose();
    if (!canConnect()) return;
    const waiting = this.messages.filter((m) => !m.outgoing!.held && !this.sending.has(m.id));
    if (!waiting.length) return;
    // until the accounts are known nothing can leave
    const next = this.ctl.accounts.length ? Math.min(...waiting.map((m) => m.outgoing!.at)) : Date.now() + TICK;
    this.timer = setTimeout(() => void this.process(), Math.max(0, Math.min(TICK, next - Date.now())));
  }

  /** Sends what is due, one after another. */
  process(): Promise<void> {
    this.working ??= this.run().finally(() => {
      this.working = null;
      this.schedule();
    });
    return this.working;
  }

  private async run(): Promise<void> {
    if (!canConnect() || !this.ctl.accounts.length) return;
    dropOldClaims(Date.now());
    const tried = new Set<string>();
    for (;;) {
      const now = Date.now();
      const next = this.messages.find((m) => !tried.has(m.id) && !m.outgoing!.held && m.outgoing!.at <= now);
      if (!next) return;
      tried.add(next.id);
      await this.dispatch(next);
    }
  }

  private hold(m: MailRecord, error: string): void {
    m.outgoing = { ...m.outgoing!, held: true, error };
    // what the status bar said about it no longer holds
    this.ctl.syncMessage = '';
    this.ctl.alerts.sendFailed(m, error);
    this.ctl.touch(true);
  }

  private async dispatch(m: MailRecord): Promise<void> {
    const done = await alone(claimKey(m), async (sure) => {
      await this.leave(m, sure);
      return true;
    });
    // another window is sending it right now
    if (!done && m.outgoing) m.outgoing = { ...m.outgoing, at: Date.now() + 60_000 };
  }

  /** With `sure`, no other window can be sending it while this runs. */
  private async leave(m: MailRecord, sure: boolean): Promise<void> {
    const data = this.ctl.data;
    const o: Outgoing = m.outgoing!;
    const account = this.ctl.accounts.find((a) => a.id === o.account);
    if (!account) return this.hold(m, 'La cuenta con la que se iba a enviar ya no existe.');
    const now = Date.now();
    if (now - o.at > TOO_LATE) return this.hold(m, 'Tenía que salir hace más de un día y Nova Mail estaba cerrado. Revísalo y envíalo.');
    const key = claimKey(m);
    const claim = readClaim(key);
    // the window that sent it saved the copies, also the one of the server
    if (claim?.state === 'sent') return this.ctl.delivered(m, account, m.raw, true);
    if (claim && claim.by !== this.me) {
      if (!sure && now - claim.at < BUSY) {
        m.outgoing = { ...o, at: now + 60_000 };
        return;
      }
      writeClaim(key, null);
      return this.hold(m, UNKNOWN);
    }
    const raw = withSendDate(m.raw, new Date(now));
    writeClaim(key, { state: 'sending', at: now, by: this.me });
    this.sending.add(m.id);
    this.ctl.touch();
    try {
      await remote.send(account.id, o.recipients, raw);
      writeClaim(key, { state: 'sent', at: Date.now(), by: this.me });
      this.sending.delete(m.id);
      // another file may have been opened meanwhile: the note above settles it when this one is opened again
      if (this.ctl.data === data) this.ctl.delivered(m, account, raw);
    } catch (e) {
      writeClaim(key, null);
      this.sending.delete(m.id);
      if (this.ctl.data !== data || !m.outgoing) return;
      const error = messageOf(e);
      const tries = (m.outgoing.tries ?? 0) + 1;
      if (!isRetryable(error)) {
        m.outgoing = { ...m.outgoing, tries };
        return this.hold(m, error);
      }
      m.outgoing = { ...m.outgoing, tries, error, at: Date.now() + retryDelay(tries) };
      // said once; the retries go on quietly
      if (tries === 1) this.ctl.alerts.sendFailed(m, error);
      this.ctl.touch(true);
    }
  }

  /** «Enviar ahora»: also for one that was waiting for the person. */
  sendNow(id: string): Promise<void> {
    const m = this.messages.find((x) => x.id === id);
    if (!m || this.sending.has(id)) return Promise.resolve();
    // the person has looked: what was left half sent is sent again; what is known to be sent is not
    if (m.outgoing!.held && readClaim(claimKey(m))?.state === 'sending') writeClaim(claimKey(m), null);
    const { held: _held, error: _error, ...rest } = m.outgoing!;
    m.outgoing = { ...rest, at: Date.now() };
    this.ctl.touch(true);
    // one already on its way finishes first
    return this.working ? this.working.then(() => this.process()) : this.process();
  }

  /** Another time to send it. */
  retime(id: string, at: number): void {
    const m = this.messages.find((x) => x.id === id);
    if (!m || this.sending.has(id)) return;
    const { held: _held, error: _error, tries: _tries, ...rest } = m.outgoing!;
    m.outgoing = { ...rest, at, kind: 'later' };
    this.ctl.touch(true);
    this.schedule();
  }

  /** Takes it back: it is a draft again, open to go on writing. False if it is already leaving. */
  takeBack(id: string): boolean {
    const m = this.messages.find((x) => x.id === id);
    if (!m) return false;
    if (this.sending.has(id)) {
      this.ctl.syncMessage = 'Ya se está enviando: no se puede recuperar.';
      this.ctl.touch();
      return false;
    }
    m.folder = 'drafts';
    delete m.outgoing;
    this.ctl.syncMessage = 'Envío cancelado: el mensaje está en Borradores.';
    this.ctl.touch(true);
    this.schedule();
    this.ctl.editDraft(id);
    return true;
  }
}
