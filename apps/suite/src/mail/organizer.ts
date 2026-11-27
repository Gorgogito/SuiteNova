import {
  DEFAULT_SEARCH_FOLDERS,
  addCategory,
  brokenActions,
  changeCategory,
  isBlockedSender,
  listSender,
  newMailId,
  parseQuery,
  planRules,
  presetDue,
  quickStepsOf,
  removeCategory,
  searchFoldersOf,
  unlistSender,
  type Action,
  type JunkList,
  type QuickStep,
  type Rule,
  type SearchFolder,
} from '@suitenova/mail-core';
import type { MailCtl } from './ctl';

/** A notice shown in the program: what a rule asked to say. */
export interface RuleNotice {
  key: string;
  title: string;
  text: string;
}

const MOVES = new Set<Action['kind']>(['move', 'delete', 'deletePermanent']);
const writes = (a: Action): boolean => a.kind === 'reply' || a.kind === 'replyAll' || a.kind === 'forward';

/** Categories, follow-up reminders, rules, quick steps, search folders and blocked senders of the open mailbox. */
export class MailOrganizer {
  notices: RuleNotice[] = [];

  constructor(private readonly ctl: MailCtl) {}

  reset(): void {
    this.notices = [];
  }

  private get data() {
    return this.ctl.data;
  }

  // ---------- doing ----------

  /**
   * Runs actions on one message. What marks it goes first (the server has to be told before the message changes of
   * folder), then copies, then what writes an answer, and last what takes it away. False when something could not be done.
   */
  private perform(id: string, actions: Action[], notice?: string): boolean {
    const ctl = this.ctl;
    const there = () => ctl.data.messages.find((m) => m.id === id);
    let ok = true;
    const order = (a: Action) => (MOVES.has(a.kind) ? 3 : writes(a) ? 2 : a.kind === 'copy' ? 1 : 0);
    for (const a of [...actions].sort((x, y) => order(x) - order(y))) {
      const m = there();
      if (!m) break;
      if ((a.kind === 'move' || a.kind === 'copy') && !ctl.data.folders.some((f) => f.id === a.folder)) {
        ok = false;
        continue;
      }
      // after something that could not be done (the copy that was to be kept), nothing is removed for good
      if (a.kind === 'deletePermanent' && !ok) continue;
      switch (a.kind) {
        case 'move':
          if (!ctl.moveMany([id], a.folder)) ok = false;
          break;
        case 'copy':
          ctl.copyMany([id], a.folder);
          break;
        case 'delete':
          // what is already among the deleted items stays there: a rule or a step never removes it for good unasked
          if (m.folder !== 'trash') ctl.deleteMany([id]);
          break;
        case 'deletePermanent':
          ctl.deleteMany([id], true);
          break;
        case 'read':
        case 'unread':
          ctl.setReadMany([id], a.kind === 'read');
          break;
        case 'category':
          ctl.categorize([id], a.name, true);
          break;
        case 'clearCategories':
          ctl.clearCategories([id]);
          break;
        case 'follow':
          ctl.followMany([id], presetDue(a.when, Date.now()));
          break;
        case 'complete':
          ctl.completeMany([id]);
          break;
        case 'clearFlag':
          ctl.setFlagMany([id], false);
          break;
        case 'alert':
          this.notices = [...this.notices, { key: newMailId(), title: notice ?? '', text: a.text || m.subject }].slice(-20);
          ctl.touch();
          break;
        case 'reply':
        case 'replyAll':
          ctl.reply(id, a.kind === 'replyAll');
          break;
        case 'forward': {
          ctl.forward(id);
          if (ctl.compose && a.to) ctl.updateCompose({ ...ctl.compose, to: a.to });
          break;
        }
      }
    }
    return ok;
  }

  dismissNotice(key: string): void {
    this.notices = this.notices.filter((n) => n.key !== key);
    this.ctl.touch();
  }

  /** What arrived by itself: blocked senders go to junk, and the rules look at what is not read. Returns what to say. */
  arrive(ids: string[]): string[] {
    if (!ids.length) return [];
    const ctl = this.ctl;
    const own = ctl.ownAddresses();
    let junk = 0;
    let ruled = 0;
    let failed = 0;
    // what is done by itself is not what an undo takes back
    ctl.together(
      'Reglas',
      () => {
        for (const m of ctl.records(ids)) {
          if (isBlockedSender(this.data, m.fromEmail) && !own.has(m.fromEmail.toLowerCase())) {
            if (ctl.moveMany([m.id], 'junk')) junk++;
            else failed++;
            continue;
          }
          if (m.read) continue;
          const plan = planRules(this.data.rules ?? [], m, { own });
          if (!plan.rules.length) continue;
          ruled++;
          if (!this.perform(m.id, plan.actions, plan.rules[0]!.name)) failed++;
        }
      },
      false,
    );
    const said: string[] = [];
    if (junk) said.push(junk === 1 ? '1 de un remitente bloqueado, a Correo no deseado' : `${junk} de remitentes bloqueados, a Correo no deseado`);
    if (ruled) said.push(ruled === 1 ? 'reglas aplicadas a 1' : `reglas aplicadas a ${ruled}`);
    if (failed) said.push(failed === 1 ? 'a 1 no se le pudo aplicar todo (revisa las carpetas de las reglas)' : `a ${failed} no se les pudo aplicar todo (revisa las carpetas de las reglas)`);
    return said;
  }

  /** «Ejecutar reglas ahora», on the messages of a folder, read or not. */
  runRules(ruleIds: string[], folder: string): { matched: number; failed: number } {
    const ctl = this.ctl;
    const own = ctl.ownAddresses();
    const rules = (this.data.rules ?? []).filter((r) => ruleIds.includes(r.id)).map((r) => ({ ...r, enabled: true }));
    let matched = 0;
    let failed = 0;
    ctl.together('Ejecutar reglas', () => {
      for (const m of this.data.messages.filter((x) => x.folder === folder)) {
        const plan = planRules(rules, m, { own });
        if (!plan.rules.length) continue;
        matched++;
        if (!this.perform(m.id, plan.actions, plan.rules[0]!.name)) failed++;
      }
    });
    return { matched, failed };
  }

  /** Why a quick step cannot be run on the selection; empty when it can. */
  stepProblem(step: QuickStep, ids = this.ctl.selectedIds()): string {
    if (!ids.length) return 'Selecciona un mensaje.';
    if (!step.actions.length) return 'El paso no tiene acciones.';
    const broken = brokenActions(this.data, step.actions);
    if (broken) return broken;
    if (step.actions.some(writes)) {
      if (ids.length > 1) return 'Un paso que escribe un mensaje se aplica a uno solo.';
      if (this.ctl.records(ids)[0]?.folder === 'drafts') return 'Ese paso no se aplica a un borrador.';
    }
    return '';
  }

  runStep(id: string, ids = this.ctl.selectedIds()): void {
    const step = quickStepsOf(this.data).find((s) => s.id === id);
    if (!step) return;
    const problem = this.stepProblem(step, ids);
    if (problem) {
      this.ctl.syncMessage = problem;
      this.ctl.touch();
      return;
    }
    let ok = true;
    this.ctl.together(step.name, () => {
      for (const m of ids) if (!this.perform(m, step.actions)) ok = false;
    });
    if (!ok) this.ctl.touch();
  }

  // ---------- junk ----------

  /** Blocks the senders of these messages and sends the messages to junk. Returns the addresses blocked. */
  block(ids: string[]): string[] {
    const own = this.ctl.ownAddresses();
    const records = this.ctl.records(ids).filter((m) => m.fromEmail && !own.has(m.fromEmail.toLowerCase()));
    const done: string[] = [];
    for (const m of records) {
      try {
        const entry = listSender(this.data, 'blocked', m.fromEmail);
        if (!done.includes(entry)) done.push(entry);
      } catch {
        // an address that is not one cannot be blocked
      }
    }
    if (done.length) {
      this.ctl.moveMany(
        records.map((m) => m.id),
        'junk',
      );
      this.ctl.touch(true);
    }
    return done;
  }

  /** «No es correo no deseado»: trusts the senders and takes the messages out of junk. */
  trust(ids: string[]): string[] {
    const records = this.ctl.records(ids);
    const done: string[] = [];
    for (const m of records) {
      try {
        const entry = listSender(this.data, 'safe', m.fromEmail);
        if (!done.includes(entry)) done.push(entry);
      } catch {
        // an address that is not one cannot be listed
      }
    }
    const junk = records.filter((m) => m.folder === 'junk').map((m) => m.id);
    if (junk.length) this.ctl.moveMany(junk, 'inbox');
    this.ctl.touch(done.length > 0);
    return done;
  }

  addSender(list: JunkList, text: string): void {
    listSender(this.data, list, text);
    this.ctl.touch(true);
  }

  removeSender(list: JunkList, entry: string): void {
    unlistSender(this.data, list, entry);
    this.ctl.touch(true);
  }

  // ---------- categories ----------

  addCategory(name: string, color: string): string {
    const c = addCategory(this.data, name, color);
    this.ctl.touch(true);
    return c.name;
  }

  changeCategory(name: string, patch: { name?: string; color?: string }): void {
    changeCategory(this.data, name, patch);
    this.ctl.touch(true);
  }

  removeCategory(name: string): void {
    removeCategory(this.data, name);
    this.ctl.touch(true);
  }

  // ---------- follow-up reminders ----------

  /** Flagged messages whose reminder has come. */
  dueReminders(now: number): { id: string; subject: string; due: number | null }[] {
    return this.data.messages.filter((m) => m.flagged && m.follow?.remind !== undefined && m.follow.remind <= now).map((m) => ({ id: m.id, subject: m.subject, due: m.follow!.due }));
  }

  dismissReminder(id: string): void {
    const m = this.data.messages.find((x) => x.id === id);
    if (!m?.follow) return;
    delete m.follow.remind;
    if (m.follow.due === null) delete m.follow;
    this.ctl.touch(true);
  }

  // ---------- rules, quick steps and search folders ----------

  private checkName(name: string, what: string): string {
    const n = name.trim();
    if (!n) throw new Error(what);
    return n.slice(0, 100);
  }

  saveRule(rule: Rule): void {
    const name = this.checkName(rule.name, 'Escribe un nombre para la regla.');
    if (!rule.conditions.length) throw new Error('Añade al menos una condición.');
    if (!rule.actions.length) throw new Error('Añade al menos una acción.');
    const list = this.data.rules ?? [];
    const next = { ...rule, name, id: rule.id || `r${newMailId()}` };
    this.data.rules = list.some((r) => r.id === next.id) ? list.map((r) => (r.id === next.id ? next : r)) : [...list, next];
    this.ctl.touch(true);
  }

  removeRule(id: string): void {
    this.data.rules = (this.data.rules ?? []).filter((r) => r.id !== id);
    if (!this.data.rules.length) delete this.data.rules;
    this.ctl.touch(true);
  }

  enableRule(id: string, on: boolean): void {
    const r = this.data.rules?.find((x) => x.id === id);
    if (!r || (on && (!r.conditions.length || !r.actions.length))) return;
    r.enabled = on;
    this.ctl.touch(true);
  }

  moveRule(id: string, by: -1 | 1): void {
    this.data.rules = moved(this.data.rules ?? [], id, by);
    this.ctl.touch(true);
  }

  saveStep(step: QuickStep): void {
    const name = this.checkName(step.name, 'Escribe un nombre para el paso rápido.');
    if (!step.actions.length) throw new Error('Añade al menos una acción.');
    const list = quickStepsOf(this.data);
    const next = { ...step, name, id: step.id || `qs:${newMailId()}` };
    this.data.quickSteps = list.some((s) => s.id === next.id) ? list.map((s) => (s.id === next.id ? next : s)) : [...list, next];
    this.ctl.touch(true);
  }

  removeStep(id: string): void {
    this.data.quickSteps = quickStepsOf(this.data).filter((s) => s.id !== id);
    this.ctl.touch(true);
  }

  moveStep(id: string, by: -1 | 1): void {
    this.data.quickSteps = moved(quickStepsOf(this.data), id, by);
    this.ctl.touch(true);
  }

  searchFolder(id: string): SearchFolder | undefined {
    return searchFoldersOf(this.data).find((f) => f.id === id);
  }

  saveSearchFolder(folder: Omit<SearchFolder, 'id'> & { id?: string }): string {
    const name = this.checkName(folder.name, 'Escribe un nombre para la carpeta de búsqueda.');
    const query = folder.query.replace(/^\s*\*\s*/, '').trim();
    const parsed = parseQuery(query);
    if (parsed.empty) throw new Error('Escribe qué hay que buscar.');
    if (parsed.errors.length) throw new Error(`No se entiende «${parsed.errors[0]}».`);
    const list = searchFoldersOf(this.data);
    if (list.some((f) => f.id !== folder.id && f.name.toLowerCase() === name.toLowerCase())) throw new Error('Ya existe una carpeta de búsqueda con ese nombre.');
    const next = { id: folder.id || `q:${newMailId()}`, name, query };
    this.data.searchFolders = list.some((f) => f.id === next.id) ? list.map((f) => (f.id === next.id ? next : f)) : [...list, next];
    this.ctl.touch(true);
    return next.id;
  }

  removeSearchFolder(id: string): void {
    this.data.searchFolders = searchFoldersOf(this.data).filter((f) => f.id !== id);
    if (this.ctl.folder === id) this.ctl.setFolder('inbox');
    this.ctl.touch(true);
  }

  restoreSearchFolders(): void {
    const list = searchFoldersOf(this.data);
    this.data.searchFolders = [...list, ...DEFAULT_SEARCH_FOLDERS.filter((d) => !list.some((f) => f.id === d.id))];
    this.ctl.touch(true);
  }
}

function moved<T extends { id: string }>(list: T[], id: string, by: -1 | 1): T[] {
  const i = list.findIndex((x) => x.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}
