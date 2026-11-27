import { FOLLOW_PRESETS, type FollowPreset } from './followup';
import { emailsOf, fieldsOf, foldText } from './search';
import type { MailData, MailRecord } from './store';

/*
 * Rules and quick steps. A rule has conditions (all of them must hold; the words of one condition are alternatives),
 * exceptions (any of them spares the message) and actions. A quick step is a set of actions run at once on the messages
 * selected. Here it is only decided what to do; the program does it (it may have to tell the server).
 */

export type TextCondition = 'from' | 'to' | 'cc' | 'recipient' | 'subject' | 'body' | 'subjectOrBody' | 'attachment';

export type Condition =
  | { kind: TextCondition; words: string[] }
  | { kind: 'hasAttachments' | 'toMe' | 'onlyMe' | 'ccMe' }
  | { kind: 'importance'; value: 'high' | 'low' }
  | { kind: 'larger'; kb: number }
  | { kind: 'account'; account: string };

export type ConditionKind = Condition['kind'];

export const CONDITIONS: { kind: ConditionKind; label: string }[] = [
  { kind: 'from', label: 'El remitente contiene' },
  { kind: 'to', label: '«Para» contiene' },
  { kind: 'cc', label: '«Cc» contiene' },
  { kind: 'recipient', label: 'Algún destinatario contiene' },
  { kind: 'subject', label: 'El asunto contiene' },
  { kind: 'body', label: 'El texto contiene' },
  { kind: 'subjectOrBody', label: 'El asunto o el texto contiene' },
  { kind: 'attachment', label: 'El nombre de un adjunto contiene' },
  { kind: 'hasAttachments', label: 'Tiene datos adjuntos' },
  { kind: 'toMe', label: 'Mi dirección está en «Para»' },
  { kind: 'onlyMe', label: 'Me lo envían solo a mí' },
  { kind: 'ccMe', label: 'Mi dirección está en «Cc»' },
  { kind: 'importance', label: 'La importancia es' },
  { kind: 'larger', label: 'El tamaño es mayor que (KB)' },
  { kind: 'account', label: 'Llegó a la cuenta' },
];

export const isTextCondition = (k: ConditionKind): k is TextCondition => ['from', 'to', 'cc', 'recipient', 'subject', 'body', 'subjectOrBody', 'attachment'].includes(k);

export type Action =
  | { kind: 'move' | 'copy'; folder: string }
  | { kind: 'delete' | 'deletePermanent' | 'read' | 'unread' | 'complete' | 'clearFlag' | 'clearCategories' }
  | { kind: 'category'; name: string }
  | { kind: 'follow'; when: FollowPreset }
  /** Rules only: a notice in the program. */
  | { kind: 'alert'; text: string }
  /** Quick steps only: they open the message to be written. Nothing is sent by itself. */
  | { kind: 'reply' | 'replyAll' }
  | { kind: 'forward'; to: string };

export type ActionKind = Action['kind'];

export const ACTIONS: { kind: ActionKind; label: string; only?: 'rule' | 'step' }[] = [
  { kind: 'move', label: 'Mover a la carpeta' },
  { kind: 'copy', label: 'Copiar a la carpeta' },
  { kind: 'delete', label: 'Eliminar' },
  { kind: 'deletePermanent', label: 'Eliminar para siempre' },
  { kind: 'read', label: 'Marcar como leído' },
  { kind: 'unread', label: 'Marcar como no leído' },
  { kind: 'category', label: 'Asignar la categoría' },
  { kind: 'clearCategories', label: 'Quitar las categorías' },
  { kind: 'follow', label: 'Marcar para seguimiento' },
  { kind: 'complete', label: 'Marcar como completado' },
  { kind: 'clearFlag', label: 'Quitar la bandera' },
  { kind: 'alert', label: 'Mostrar un aviso', only: 'rule' },
  { kind: 'reply', label: 'Responder', only: 'step' },
  { kind: 'replyAll', label: 'Responder a todos', only: 'step' },
  { kind: 'forward', label: 'Reenviar a', only: 'step' },
];

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: Condition[];
  exceptions: Condition[];
  actions: Action[];
  /** No later rule is applied to a message this one matched. */
  stop: boolean;
}

export interface QuickStep {
  id: string;
  name: string;
  actions: Action[];
}

export interface RuleContext {
  /** The addresses of the person, in lower case. */
  own: ReadonlySet<string>;
}

export function conditionHolds(c: Condition, m: MailRecord, ctx: RuleContext): boolean {
  const mine = (line: string) => emailsOf(line).some((e) => ctx.own.has(e));
  switch (c.kind) {
    case 'hasAttachments':
      return m.hasAttachments;
    case 'importance':
      return m.importance === c.value;
    case 'larger':
      return m.size > c.kb * 1024;
    case 'account':
      return m.remote?.account === c.account;
    case 'toMe':
      return mine(fieldsOf(m).to);
    case 'ccMe':
      return mine(fieldsOf(m).cc);
    case 'onlyMe': {
      const f = fieldsOf(m);
      const to = emailsOf(f.to);
      return to.length === 1 && ctx.own.has(to[0]!) && !emailsOf(f.cc).length;
    }
    default: {
      const f = fieldsOf(m);
      const where = (): string[] => {
        switch (c.kind) {
          case 'from':
            return [f.from];
          case 'to':
            return [f.to];
          case 'cc':
            return [f.cc];
          case 'recipient':
            return [f.to, f.cc];
          case 'subject':
            return [f.subject];
          case 'body':
            return [f.text()];
          case 'subjectOrBody':
            return [f.subject, f.text()];
          default:
            return f.attachments();
        }
      };
      const texts = where();
      return c.words.some((w) => {
        const v = foldText(w.trim());
        return !!v && texts.some((t) => t.includes(v));
      });
    }
  }
}

/** A rule without conditions applies to nothing: it would act on all the mail by an oversight. */
export const ruleMatches = (r: Rule, m: MailRecord, ctx: RuleContext): boolean =>
  r.conditions.length > 0 && r.conditions.every((c) => conditionHolds(c, m, ctx)) && !r.exceptions.some((c) => conditionHolds(c, m, ctx));

/** What the active rules ask to do with a message, in order. */
export function planRules(rules: Rule[], m: MailRecord, ctx: RuleContext): { rules: Rule[]; actions: Action[] } {
  const matched: Rule[] = [];
  const actions: Action[] = [];
  for (const r of rules) {
    if (!r.enabled || !ruleMatches(r, m, ctx)) continue;
    matched.push(r);
    const end = r.actions.findIndex((a) => a.kind === 'deletePermanent');
    actions.push(...(end < 0 ? r.actions : r.actions.slice(0, end + 1)));
    if (r.stop || end >= 0) break;
  }
  return { rules: matched, actions };
}

/** Why a rule or a quick step cannot work as it is: a folder it uses is gone. */
export function brokenActions(d: MailData, actions: Action[]): string {
  return actions.some((a) => (a.kind === 'move' || a.kind === 'copy') && !d.folders.some((f) => f.id === a.folder)) ? 'Usa una carpeta que ya no existe.' : '';
}

export const DEFAULT_QUICK_STEPS: QuickStep[] = [
  { id: 'qs:done', name: 'Listo', actions: [{ kind: 'complete' }, { kind: 'read' }, { kind: 'move', folder: 'archive' }] },
  { id: 'qs:replydelete', name: 'Responder y eliminar', actions: [{ kind: 'reply' }, { kind: 'delete' }] },
];

export const quickStepsOf = (d: MailData): QuickStep[] => d.quickSteps ?? DEFAULT_QUICK_STEPS;

// ------------------------------------------------------------------ reading a saved file

const text = (v: unknown, max = 500): v is string => typeof v === 'string' && v.length <= max;

function readCondition(v: unknown): Condition | null {
  const c = (v ?? {}) as { kind?: unknown; words?: unknown; value?: unknown; kb?: unknown; account?: unknown };
  const kind = CONDITIONS.find((x) => x.kind === c.kind)?.kind;
  if (!kind) return null;
  if (isTextCondition(kind)) {
    const words = Array.isArray(c.words) ? c.words.filter((w): w is string => text(w) && !!w.trim()).slice(0, 100) : [];
    return words.length ? { kind, words } : null;
  }
  if (kind === 'importance') return c.value === 'high' || c.value === 'low' ? { kind, value: c.value } : null;
  if (kind === 'larger') return typeof c.kb === 'number' && c.kb >= 0 && Number.isFinite(c.kb) ? { kind, kb: c.kb } : null;
  if (kind === 'account') return text(c.account, 100) && c.account ? { kind, account: c.account } : null;
  return { kind } as Condition;
}

function readAction(v: unknown, use: 'rule' | 'step'): Action | null {
  const a = (v ?? {}) as { kind?: unknown; folder?: unknown; name?: unknown; when?: unknown; text?: unknown; to?: unknown };
  const known = ACTIONS.find((x) => x.kind === a.kind && (!x.only || x.only === use));
  if (!known) return null;
  const kind = known.kind;
  if (kind === 'move' || kind === 'copy') return text(a.folder, 1100) && a.folder ? { kind, folder: a.folder } : null;
  if (kind === 'category') return text(a.name, 80) && a.name ? { kind, name: a.name } : null;
  if (kind === 'follow') return FOLLOW_PRESETS.some((p) => p.id === a.when) ? { kind, when: a.when as FollowPreset } : null;
  if (kind === 'alert') return { kind, text: text(a.text) ? a.text : '' };
  if (kind === 'forward') return { kind, to: text(a.to, 2000) ? a.to : '' };
  return { kind } as Action;
}

function readList<T>(v: unknown, read: (x: unknown) => T | null): { list: T[]; whole: boolean } {
  const all = Array.isArray(v) ? v : [];
  const list = all.map(read).filter((x): x is T => x !== null);
  return { list, whole: list.length === all.length };
}

/** A rule that cannot be read whole is kept but turned off: with a condition missing it would reach more mail. */
export function readRules(v: unknown): Rule[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Rule[] = [];
  for (const r of v as Partial<Rule>[]) {
    if (!r || !text(r.id, 100) || !r.id || !text(r.name, 200)) continue;
    const conditions = readList(r.conditions, readCondition);
    const exceptions = readList(r.exceptions, readCondition);
    const actions = readList(r.actions, (a) => readAction(a, 'rule'));
    const whole = conditions.whole && exceptions.whole && actions.whole;
    out.push({ id: r.id, name: r.name, enabled: r.enabled === true && whole, conditions: conditions.list, exceptions: exceptions.list, actions: actions.list, stop: r.stop === true });
  }
  return out.length ? out.slice(0, 500) : undefined;
}

export function readQuickSteps(v: unknown): QuickStep[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: QuickStep[] = [];
  for (const s of v as Partial<QuickStep>[]) {
    if (!s || !text(s.id, 100) || !s.id || !text(s.name, 200)) continue;
    out.push({ id: s.id, name: s.name, actions: readList(s.actions, (a) => readAction(a, 'step')).list });
  }
  return out.slice(0, 100);
}
