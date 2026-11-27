import { bytesOf, decodeBase64, encodeBase64 } from './mime';

/*
 * The Outbox. A message waits there to be sent: a few seconds so that it can be taken back, until the time it was
 * programmed for, or because it could not be sent. It is only sent while the program is open.
 */

export interface Outgoing {
  account: string;
  /** The envelope: To, Cc and Bcc. */
  recipients: string[];
  /** Not before this moment. */
  at: number;
  /** Waiting to be taken back, programmed for later, or left here after it could not be sent. */
  kind: 'delay' | 'later' | 'queued';
  tries?: number;
  /** Why the last attempt failed. */
  error?: string;
  /** It waits for the person: it is not tried again by itself. */
  held?: boolean;
}

const RETRY_MINUTES = [1, 2, 5, 15, 30];
/** How long to wait after the attempt number `tries` (1 is the first). */
export const retryDelay = (tries: number): number => RETRY_MINUTES[Math.min(Math.max(1, tries), RETRY_MINUTES.length) - 1]! * 60_000;

/** A failure that may be over later: the network or a server that asks to try again. */
export const isRetryable = (message: string): boolean => /^Error de red|^Error temporal|no respondió a tiempo|No se pudo conectar|No se encontró el servidor|sin conexión/i.test(message);

/** A message this late was waiting while the program was closed: it is not sent without asking. */
export const TOO_LATE = 24 * 3600_000;

/** The message with the date of the moment it leaves. */
export function withSendDate(raw64: string, date: Date): string {
  const bytes = bytesOf(decodeBase64(raw64));
  // the headers are ASCII and end at the first empty line; the rest is not touched
  let end = bytes.length;
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === 10 && (bytes[i + 1] === 10 || (bytes[i + 1] === 13 && bytes[i + 2] === 10))) {
      end = i + 1;
      break;
    }
  }
  let head = '';
  for (let i = 0; i < end; i += 8192) head += String.fromCharCode(...bytes.subarray(i, Math.min(end, i + 8192)));
  const next = head.replace(/^Date:[^\r\n]*/im, `Date: ${date.toUTCString().replace('GMT', '+0000')}`);
  const out = new Uint8Array(next.length + bytes.length - end);
  for (let i = 0; i < next.length; i++) out[i] = next.charCodeAt(i);
  out.set(bytes.subarray(end), next.length);
  return encodeBase64(out);
}

/** The times offered to send later. */
export function sendLaterPresets(now: number): { label: string; at: number }[] {
  const n = new Date(now);
  const at = (offset: number, hour: number) => new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset, hour).getTime();
  const out: { label: string; at: number }[] = [];
  if (at(0, 18) - now > 30 * 60_000) out.push({ label: 'Hoy a las 18:00', at: at(0, 18) });
  out.push({ label: 'Mañana a las 8:00', at: at(1, 8) });
  const monday = ((8 - n.getDay()) % 7) || 7;
  if (monday > 1) out.push({ label: 'El lunes a las 8:00', at: at(monday, 8) });
  return out;
}

export function readOutgoing(v: unknown): Outgoing | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Partial<Outgoing>;
  if (typeof o.account !== 'string' || !o.account || !Array.isArray(o.recipients) || typeof o.at !== 'number' || !Number.isFinite(o.at)) return undefined;
  const recipients = o.recipients.filter((r): r is string => typeof r === 'string' && r.length <= 400).slice(0, 200);
  if (!recipients.length || recipients.length !== o.recipients.length) return undefined;
  const out: Outgoing = { account: o.account, recipients, at: o.at, kind: o.kind === 'delay' || o.kind === 'later' ? o.kind : 'queued' };
  if (typeof o.tries === 'number' && o.tries > 0) out.tries = Math.floor(o.tries);
  if (typeof o.error === 'string' && o.error) out.error = o.error.slice(0, 1000);
  if (o.held === true) out.held = true;
  return out;
}
