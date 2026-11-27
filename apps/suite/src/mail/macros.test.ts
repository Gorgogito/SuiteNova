import { buildMessage } from '@suitenova/mail-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MailCtl } from './ctl';

const lines = (...l: string[]) => l.join(String.fromCharCode(10));

function make(code: string) {
  const ctl = new MailCtl();
  ctl.setOwner({ name: 'Yo', email: 'yo@nova.test' });
  ctl.macros = [{ name: 'Modulo1', code }];
  ctl.macrosEnabled = true;
  const put = (from: string, subject: string, body: string, read = false) => ctl.importRaw(buildMessage({ from: { name: from, email: `${from.toLowerCase()}@x.test` }, to: [{ name: '', email: 'yo@nova.test' }], cc: [], bcc: [], subject, text: body, attachments: [] }), 'inbox', { read });
  return { ctl, put };
}
const run = (ctl: MailCtl, name = 'Prueba') => ctl.macroRt.run(name);

afterEach(() => vi.unstubAllGlobals());

describe('macros de Mail', () => {
  it('cuenta los mensajes sin leer, los recorre con For Each y lee asunto, remitente y texto', () => {
    const { ctl, put } = make(
      lines(
        'Function Prueba()',
        '  Dim c, m, s',
        '  Set c = Application.GetNamespace("MAPI").GetDefaultFolder(olFolderInbox)',
        '  For Each m In c.Items',
        '    If m.UnRead Then s = s & m.Subject & "/" & m.SenderName & "/" & Left(m.Body, 5) & ";"',
        '  Next',
        '  Prueba = c.Name & "|" & c.Items.Count & "|" & s',
        'End Function',
      ),
    );
    put('Ana', 'Hola', 'Cuerpo del primero');
    put('Luis', 'Leído', 'No importa', true);
    const r = run(ctl);
    expect(r.error ?? '').toBe('');
    expect(String(r.value)).toMatch(/^Bandeja de entrada\|2\|Hola\/Ana\/Cuerp;$/);
  });

  it('marcar como leído, Restrict y mover entre carpetas', () => {
    const { ctl, put } = make(
      lines(
        'Function Prueba()',
        '  Dim inbox, arch, m, n',
        '  Set inbox = Application.GetNamespace("MAPI").GetDefaultFolder(olFolderInbox)',
        '  Set arch = Application.GetNamespace("MAPI").Folders("Archivo")',
        '  n = inbox.Items.Restrict("[UnRead] = True").Count',
        '  Set m = inbox.Items.Restrict("[Subject] = ' + "'Hola'" + '").Item(1)',
        '  m.UnRead = False',
        '  m.Move arch',
        '  Prueba = n & "|" & inbox.Items.Restrict("[UnRead] = True").Count & "|" & arch.Items.Count',
        'End Function',
      ),
    );
    put('Ana', 'Hola', 'a');
    put('Luis', 'Otro', 'b');
    const r = run(ctl);
    expect(r.error ?? '').toBe('');
    expect(r.value).toBe('2|1|1');
    expect(ctl.data.messages.find((m) => m.subject === 'Hola')?.folder).toBe('archive');
  });

  it('Categories y FlagStatus se leen y se cambian', () => {
    const { ctl, put } = make(
      lines(
        'Function Prueba()',
        '  Dim inbox, m, s',
        '  Set inbox = Application.GetNamespace("MAPI").GetDefaultFolder(olFolderInbox)',
        '  Set m = inbox.Items.Item(1)',
        '  m.Categories = "Categoría azul; Trabajo"',
        '  m.FlagStatus = 2',
        '  s = m.Categories & "|" & m.FlagStatus',
        '  m.FlagStatus = 1',
        '  s = s & "|" & m.FlagStatus',
        '  m.FlagStatus = 0',
        '  m.Categories = ""',
        '  Prueba = s & "|" & m.FlagStatus & "|" & m.Categories',
        'End Function',
      ),
    );
    put('Ana', 'Hola', 'a');
    const r = run(ctl);
    expect(r.error ?? '').toBe('');
    expect(r.value).toBe('Categoría azul, Trabajo|2|1|0|');
    expect(ctl.data.messages[0]).toMatchObject({ flagged: false });
    expect(ctl.data.messages[0]!.categories).toBeUndefined();
  });

  it('CreateItem de un mensaje: Save lo deja en Borradores y Display lo abre para redactar', () => {
    const { ctl } = make(
      lines(
        'Sub Prueba()',
        '  Dim m',
        '  Set m = Application.CreateItem(olMailItem)',
        '  m.To = "ana@x.test"',
        '  m.Subject = "Desde macro"',
        '  m.Body = "Texto"',
        '  m.Save',
        '  m.Display',
        'End Sub',
      ),
    );
    expect(run(ctl).error ?? '').toBe('');
    const draft = ctl.data.messages.find((m) => m.folder === 'drafts');
    expect(draft?.subject).toBe('Desde macro');
    expect(ctl.compose?.subject).toBe('Desde macro');
  });

  it('enviar pide permiso, como la protección de Outlook: si se deniega no sale nada', () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('window', { confirm, alert: () => undefined });
    const { ctl } = make(lines('Sub Prueba()', '  Dim m', '  Set m = Application.CreateItem(olMailItem)', '  m.To = "ana@x.test"', '  m.Subject = "Hola"', '  m.Send', 'End Sub'));
    ctl.accounts = [{ id: 'a1', name: 'Yo', email: 'yo@nova.test' } as never];
    const r = run(ctl);
    expect(confirm).toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('denegó');
    expect(ctl.data.messages.some((m) => m.folder === 'sent')).toBe(false);
  });

  it('citas, contactos y tareas: crear, leer y borrar', () => {
    const { ctl } = make(
      lines(
        'Function Prueba()',
        '  Dim a, c, t',
        '  Set a = Application.CreateItem(olAppointmentItem)',
        '  a.Subject = "Reunión"',
        '  a.Start = #2026-03-02 10:00:00#',
        '  a.End = #2026-03-02 11:00:00#',
        '  a.Location = "Sala 3"',
        '  a.Save',
        '  Set c = Application.CreateItem(olContactItem)',
        '  c.FullName = "Ana Pérez"',
        '  c.Email1Address = "ana@x.test"',
        '  c.Save',
        '  Set t = Application.CreateItem(olTaskItem)',
        '  t.Subject = "Llamar"',
        '  t.Save',
        '  t.Complete = True',
        '  Prueba = Application.GetNamespace("MAPI").GetDefaultFolder(olFolderCalendar).Items.Count & "|" & Application.GetNamespace("MAPI").GetDefaultFolder(olFolderContacts).Items(1).Email1Address & "|" & Application.GetNamespace("MAPI").GetDefaultFolder(olFolderTasks).Items(1).Complete',
        'End Function',
      ),
    );
    const r = run(ctl);
    expect(r.error ?? '').toBe('');
    expect(r.value).toBe('1|ana@x.test|-1');
    expect(ctl.data.events[0]).toMatchObject({ title: 'Reunión', location: 'Sala 3' });
    expect(ctl.data.tasks[0]).toMatchObject({ title: 'Llamar', done: true });
  });

  it('un mensaje recibido no se puede editar, y con las macros deshabilitadas nada corre', () => {
    const { ctl, put } = make(lines('Sub Prueba()', '  Application.GetNamespace("MAPI").GetDefaultFolder(olFolderInbox).Items(1).Subject = "x"', 'End Sub'));
    put('Ana', 'Hola', 'a');
    const r = run(ctl);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('asunto');
    ctl.macrosEnabled = false;
    expect(run(ctl).ok).toBe(false);
  });

  it('Application_Startup corre al empezar, solo si las macros están habilitadas', () => {
    const { ctl } = make(lines('Sub Application_Startup()', '  Debug.Print "arrancó"', 'End Sub'));
    ctl.macroRt.runStartup();
    expect(ctl.macroRt.console.join('|')).toContain('arrancó');
    ctl.macroRt.clearConsole();
    ctl.macrosEnabled = false;
    ctl.macroRt.runStartup();
    expect(ctl.macroRt.console.length).toBe(0);
  });
});
