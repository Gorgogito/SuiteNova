import { CommandRegistry, coreCommands, getLocale, setLocale, t, type RibbonItem } from '@suitenova/core-ui';
import { buildMessage, newEvent, parseMessage, rawOf } from '@suitenova/mail-core';
import { describe, expect, it } from 'vitest';
import { mailCommands, type MailUI } from './commands';
import { MailCtl } from './ctl';
import './messages';
import { safeHtml } from './MailViews';
import { mailTabs } from './ribbonDef';

function setup() {
  const ctl = new MailCtl();
  ctl.setOwner({ name: 'Yo', email: 'yo@nova.test' });
  const ui: MailUI = {
    ctl,
    openDialog: () => undefined,
    newWindow: () => undefined,
    open: async () => undefined,
    save: async () => undefined,
    importFiles: () => undefined,
    exportMessage: async () => undefined,
    exportFolder: async () => undefined,
    exportCalendar: async () => undefined,
    exportContacts: async () => undefined,
    focusSearch: () => undefined,
    close: () => undefined,
  };
  const registry = new CommandRegistry();
  registry.registerAll(coreCommands);
  registry.registerAll(mailCommands(ui));
  registry.register({ id: 'file.close', label: 'Cerrar', run: () => undefined });
  return { ui, registry, ctl };
}

function commandsIn(items: RibbonItem[]): string[] {
  return items.flatMap((i) => {
    if (i.kind === 'button') return [i.command];
    if (i.kind === 'dropdown') return [...(i.primaryCommand ? [i.primaryCommand] : []), ...i.entries.flatMap((e) => (e.kind === 'command' ? [e.command] : []))];
    return [];
  });
}

const msg = (subject: string, text: string, from = 'ana@x.es', extra: Record<string, unknown> = {}) =>
  buildMessage({ from: { name: '', email: from }, to: [{ name: '', email: 'yo@nova.test' }], subject, text, ...extra });

describe('Nova Mail ribbon', () => {
  it('only references commands that exist, in every section (no decorative controls)', () => {
    const { ui, registry } = setup();
    const missing: string[] = [];
    for (const section of ['mail', 'calendar', 'contacts', 'tasks'] as const) for (const tab of mailTabs(ui, section)) for (const g of tab.groups) for (const id of commandsIn(g.items)) if (!registry.get(id)) missing.push(`${section}/${tab.id}/${g.id}: ${id}`);
    expect(missing).toEqual([]);
  });

  it('gives every command a label and no two commands share a shortcut', () => {
    const { registry } = setup();
    const seen = new Map<string, string>();
    for (const c of registry.all()) {
      expect(c.label, c.id).toBeTruthy();
      for (const sc of Array.isArray(c.shortcut) ? c.shortcut : c.shortcut ? [c.shortcut] : []) {
        expect(seen.get(sc), `${sc} used by ${c.id} and ${seen.get(sc)}`).toBeUndefined();
        seen.set(sc, c.id);
      }
    }
  });

  it('keeps ribbon key tips unique within each tab, in every section', () => {
    const { ui } = setup();
    for (const section of ['mail', 'calendar', 'contacts', 'tasks'] as const) {
      for (const tab of mailTabs(ui, section)) {
        const tips = tab.groups.flatMap((g) => g.items.flatMap((i) => ('keytip' in i && i.keytip ? [i.keytip] : [])));
        for (const a of tips) for (const b of tips) if (a !== b) expect(b.startsWith(a), `${section}/${tab.id}: ${a} vs ${b}`).toBe(false);
      }
    }
  });

  it('has an English translation for every command label', () => {
    const { registry } = setup();
    const prev = getLocale();
    setLocale('en');
    try {
      const missing = registry
        .all()
        .filter((c) => /^(mail|cal|contact|task|data)\./.test(c.id))
        .filter((c) => t(c.label) === c.label && /[áéíóúñ¿¡]|^(Abrir|Guardar|Correo|Calendario|Contactos|Tareas|Responder|Reenviar|Archivar|Importar|Exportar|Eliminar|Evento|Hoy|Vista|Tarea|Contacto)/.test(c.label))
        .map((c) => `${c.id}: ${c.label}`);
      expect(missing).toEqual([]);
    } finally {
      setLocale(prev);
    }
  });
});

describe('Nova Mail controller', () => {
  it('imports, reads, flags, moves and deletes messages', () => {
    const { ctl } = setup();
    const a = ctl.importRaw(msg('Uno', 'primero'));
    ctl.importRaw(msg('Dos', 'segundo'));
    expect(ctl.list()).toHaveLength(2);
    expect(a.read).toBe(false);
    ctl.select(a.id);
    expect(a.read).toBe(true);
    ctl.toggleFlag(a.id);
    expect(a.flagged).toBe(true);
    ctl.move(a.id, 'archive');
    expect(ctl.list()).toHaveLength(1);
    ctl.setFolder('archive');
    ctl.delete(a.id);
    expect(a.folder).toBe('trash');
    ctl.setFolder('trash');
    ctl.delete(a.id);
    expect(ctl.data.messages).toHaveLength(1);
  });

  it('searches the current folder, or every folder with a leading *', () => {
    const { ctl } = setup();
    ctl.importRaw(msg('Presupuesto', 'cifras'), 'inbox');
    ctl.importRaw(msg('Presupuesto viejo', 'cifras'), 'archive');
    ctl.query = 'presupuesto';
    expect(ctl.list()).toHaveLength(1);
    ctl.query = '* presupuesto';
    expect(ctl.list()).toHaveLength(2);
  });

  it('prepares replies: subject, recipients (without me), quote and threading headers', () => {
    const { ctl } = setup();
    const r = ctl.importRaw(buildMessage({ from: { name: 'Ana', email: 'ana@x.es' }, to: [{ name: '', email: 'yo@nova.test' }, { name: '', email: 'luis@x.es' }], cc: [{ name: '', email: 'marta@x.es' }], subject: 'Plan', text: 'línea 1\nlínea 2', messageId: '<orig@x.es>' }));
    ctl.reply(r.id, false);
    expect(ctl.compose!.to).toBe('ana@x.es');
    expect(ctl.compose!.subject).toBe('Re: Plan');
    expect(ctl.compose!.body).toContain('> línea 1');
    expect(ctl.compose!.inReplyTo).toBe('<orig@x.es>');
    expect(r.answered).toBe(true);
    ctl.reply(r.id, true);
    expect(ctl.compose!.to).toBe('ana@x.es, luis@x.es');
    expect(ctl.compose!.cc).toBe('marta@x.es');
    ctl.forward(r.id);
    expect(ctl.compose!.subject).toBe('Fwd: Plan');
  });

  it('keeps Bcc out of saved drafts headers but remembers it for editing', () => {
    const { ctl } = setup();
    ctl.newMessage('bea@x.es');
    const c = ctl.compose!;
    c.bcc = 'oculta@x.es';
    c.subject = 'Hola';
    c.body = 'texto';
    const rec = ctl.saveDraft(c);
    expect(rec.folder).toBe('drafts');
    expect(parseMessage(rawOf(rec)).headers.some(([k]) => k.toLowerCase() === 'bcc')).toBe(false);
    expect(new TextDecoder().decode(rawOf(rec))).not.toContain('oculta@x.es');
    ctl.saveDraft(c); // saving again replaces the draft
    expect(ctl.data.messages.filter((m) => m.folder === 'drafts')).toHaveLength(1);
    ctl.editDraft(c.draftId!);
    expect(ctl.compose!.bcc).toBe('oculta@x.es');
  });

  it('manages folders, contacts, events and tasks', () => {
    const { ctl } = setup();
    ctl.addFolder('Clientes');
    expect(() => ctl.addFolder('clientes')).toThrow(/Ya existe/);
    const f = ctl.data.folders.find((x) => x.name === 'Clientes')!;
    const m = ctl.importRaw(msg('x', 'y'));
    ctl.move(m.id, f.id);
    ctl.deleteFolder(f.id);
    expect(m.folder).toBe('archive');
    ctl.deleteFolder('inbox'); // system folders cannot be deleted
    expect(ctl.data.folders.some((x) => x.id === 'inbox')).toBe(true);
    const c = ctl.addContact();
    ctl.updateContact({ ...c, name: 'Ana' });
    expect(ctl.data.contacts[0]!.name).toBe('Ana');
    ctl.deleteContact(c.id);
    expect(ctl.data.contacts).toHaveLength(0);
    const e = newEvent(1, 2, 'x');
    ctl.addEvent(e);
    ctl.updateEvent({ ...e, title: 'y' });
    expect(ctl.data.events[0]!.title).toBe('y');
    ctl.deleteEvent(e.id);
    const tk = ctl.addTask('Pagar');
    ctl.toggleTask(tk.id);
    expect(ctl.data.tasks[0]!.done).toBe(true);
    expect(ctl.data.tasks[0]!.completedAt).not.toBeNull();
  });

  it('notifies once for a batch of changes', () => {
    const { ctl } = setup();
    let n = 0;
    ctl.subscribe(() => n++);
    ctl.batch(() => {
      for (let i = 0; i < 50; i++) ctl.importRaw(msg(`m${i}`, 'x'));
    });
    expect(n).toBe(1);
    expect(ctl.data.messages).toHaveLength(50);
  });
});

describe('showing HTML mail safely', () => {
  // the HTML sanitizer needs a real DOM: it is exercised in the browser by scripts/e2e-mail.mjs

  it('shows plain text with links but without markup', () => {
    const m = parseMessage(msg('s', 'mira <b>esto</b> en https://example.org/x?a=1&b=2 ya'));
    const { html: out } = safeHtml(m, false);
    expect(out).toContain('&lt;b&gt;esto&lt;/b&gt;');
    expect(out).toContain('<a href="https://example.org/x?a=1&amp;b=2">');
  });
});
