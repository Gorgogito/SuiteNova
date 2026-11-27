import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMessage, newContact, parseMessage, rawOf } from '@suitenova/mail-core';
import { DRAFT_DELAY, MailCtl, type ComposeState } from './ctl';
import { FakeServer, account, standardServer } from './fake-server';
import { setTransport } from './remote';

let ctl: MailCtl;
const drafts = () => ctl.data.messages.filter((m) => m.folder === 'drafts');
const write = (over: Partial<ComposeState>) => ctl.updateCompose({ ...ctl.compose!, ...over });
const received = (over: Partial<Parameters<typeof buildMessage>[0]> = {}) =>
  ctl.importRaw(buildMessage({ from: { name: 'Ana', email: 'ana@x.es' }, to: [{ name: '', email: 'yo@x.es' }, { name: '', email: 'luis@x.es' }], subject: 'Plan', text: 'Hola', messageId: '<plan@x.es>', ...over }), 'inbox');

beforeEach(() => {
  vi.useFakeTimers();
  ctl = new MailCtl();
});
afterEach(() => {
  ctl.dispose();
  vi.useRealTimers();
});

describe('borrador automático', () => {
  it('se guarda poco después de dejar de escribir, y sigue siendo uno solo', () => {
    ctl.newMessage();
    write({ subject: 'Hola' });
    vi.advanceTimersByTime(DRAFT_DELAY - 100);
    expect(drafts()).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(drafts().map((m) => m.subject)).toEqual(['Hola']);
    write({ subject: 'Hola otra vez' });
    vi.advanceTimersByTime(DRAFT_DELAY + 100);
    expect(drafts().map((m) => m.subject)).toEqual(['Hola otra vez']);
    expect(ctl.compose!.draftId).toBe(drafts()[0]!.id);
    expect(ctl.dirty).toBe(true);
  });

  it('también se guarda si no se deja de escribir', () => {
    ctl.newMessage();
    for (let i = 1; i <= 12; i++) {
      write({ body: 'x'.repeat(i) });
      vi.advanceTimersByTime(2000);
    }
    expect(drafts()).toHaveLength(1);
  });

  it('un mensaje en blanco no deja borrador', () => {
    ctl.newMessage();
    vi.advanceTimersByTime(60000);
    ctl.requestCloseCompose();
    expect(ctl.compose).toBeNull();
    expect(drafts()).toHaveLength(0);
    expect(ctl.askClose).toBe(false);
  });
});

describe('cerrar', () => {
  it('pregunta si se perdería algo; «Seguir», «Descartar» y «Guardar»', () => {
    ctl.newMessage();
    write({ body: 'Un texto que no quiero perder' });
    ctl.requestCloseCompose();
    expect(ctl.askClose).toBe(true);
    expect(ctl.compose).not.toBeNull();
    vi.advanceTimersByTime(DRAFT_DELAY + 100);
    ctl.discardCompose();
    expect(ctl.compose).toBeNull();
    expect(drafts()).toHaveLength(0);
    ctl.newMessage();
    write({ body: 'Otro' });
    ctl.requestCloseCompose();
    ctl.closeSaving();
    expect(ctl.compose).toBeNull();
    expect(drafts()).toHaveLength(1);
  });

  it('una respuesta sin tocar se cierra sin preguntar y sin borrador', () => {
    const r = received();
    ctl.reply(r.id, false);
    ctl.requestCloseCompose();
    expect(ctl.compose).toBeNull();
    expect(drafts()).toHaveLength(0);
  });

  it('tras «Guardar borrador» cierra sin preguntar; «Descartar» vuelve a lo guardado', () => {
    ctl.newMessage();
    write({ subject: 'Guardado' });
    ctl.keepDraft();
    ctl.requestCloseCompose();
    expect(ctl.compose).toBeNull();
    expect(drafts().map((m) => m.subject)).toEqual(['Guardado']);
    ctl.editDraft(drafts()[0]!.id);
    write({ subject: 'Cambiado' });
    vi.advanceTimersByTime(DRAFT_DELAY + 100);
    expect(drafts().map((m) => m.subject)).toEqual(['Cambiado']);
    ctl.requestCloseCompose();
    expect(ctl.askClose).toBe(true);
    ctl.discardCompose();
    expect(drafts().map((m) => m.subject)).toEqual(['Guardado']);
    expect(ctl.selected?.subject).toBe('Guardado');
  });

  it('pasar a otro mensaje, carpeta o sección conserva lo escrito en Borradores y lo dice', () => {
    const r = received();
    for (const leave of [() => ctl.select(r.id), () => ctl.setFolder('archive'), () => ctl.go('calendar'), () => ctl.newMessage()]) {
      ctl.data.messages = ctl.data.messages.filter((m) => m.folder !== 'drafts');
      ctl.newMessage();
      write({ subject: 'A medias' });
      leave();
      expect(drafts().map((m) => m.subject)).toEqual(['A medias']);
      expect(ctl.composeNotice).toMatch(/Borradores/);
      ctl.closeCompose();
    }
  });

  it('un borrador abierto de nuevo tiene el mismo texto', () => {
    ctl.newMessage();
    write({ body: 'Una línea\nOtra' });
    ctl.closeSaving();
    ctl.editDraft(drafts()[0]!.id);
    expect(ctl.compose!.body).toBe('Una línea\nOtra');
  });

  it('abrir un borrador y salir no lo cambia', () => {
    ctl.newMessage('bea@x.es');
    write({ subject: 'Uno' });
    ctl.keepDraft();
    ctl.closeCompose();
    const id = drafts()[0]!.id;
    ctl.dirty = false;
    ctl.editDraft(id);
    ctl.setFolder('inbox');
    expect(drafts().map((m) => m.id)).toEqual([id]);
    expect(ctl.dirty).toBe(false);
    expect(ctl.composeNotice).toBe('');
  });

  it('borrar el borrador que se escribe cierra el mensaje', () => {
    ctl.newMessage();
    write({ subject: 'X' });
    ctl.keepDraft();
    ctl.delete(ctl.compose!.draftId!);
    expect(ctl.compose).toBeNull();
    vi.advanceTimersByTime(60000);
    expect(drafts()).toHaveLength(0);
  });

  it('un borrador de respuesta conserva la conversación al abrirlo de nuevo', () => {
    const r = received();
    ctl.reply(r.id, false);
    write({ body: 'Respuesta' });
    ctl.closeSaving();
    ctl.editDraft(drafts()[0]!.id);
    expect(ctl.compose!.inReplyTo).toBe('<plan@x.es>');
    expect(ctl.compose!.references).toEqual(['<plan@x.es>']);
  });
});

describe('responder', () => {
  let srv: FakeServer;
  beforeEach(async () => {
    srv = standardServer();
    srv.accounts = [account('a1', 'Uno', { email: 'uno@x.es' }), account('a2', 'Dos', { email: 'yo@x.es' })];
    setTransport(srv.transport);
    await ctl.loadAccounts();
  });
  afterEach(() => setTransport(null));

  it('no me incluye: mira las direcciones de las cuentas aunque no haya «Mi dirección»', () => {
    const r = received({ cc: [{ name: '', email: 'uno@x.es' }, { name: '', email: 'marta@x.es' }] });
    ctl.reply(r.id, true);
    expect(ctl.compose!.to).toBe('ana@x.es, luis@x.es');
    expect(ctl.compose!.cc).toBe('marta@x.es');
  });

  it('sale de la cuenta que recibió el mensaje, y esa es la que figura en el borrador', () => {
    const r = received();
    ctl.reply(r.id, false);
    expect(ctl.compose!.from).toBe('a2');
    write({ body: 'ok' });
    ctl.closeSaving();
    expect(parseMessage(rawOf(drafts()[0]!)).from[0]!.email).toBe('yo@x.es');
    ctl.editDraft(drafts()[0]!.id);
    expect(ctl.compose!.from).toBe('a2');
    ctl.forward(r.id);
    expect(ctl.compose!.from).toBe('a2');
  });

  it('responder a un mensaje enviado escribe a quienes lo recibieron', () => {
    const r = ctl.importRaw(buildMessage({ from: { name: '', email: 'yo@x.es' }, to: [{ name: '', email: 'luis@x.es' }], subject: 'Mío', text: 't' }), 'sent');
    ctl.reply(r.id, false);
    expect(ctl.compose!.to).toBe('luis@x.es');
  });

  it('el original queda como respondido solo al enviar', async () => {
    const r = received();
    ctl.reply(r.id, false);
    expect(r.answered).toBe(false);
    ctl.requestCloseCompose();
    expect(r.answered).toBe(false);
    ctl.reply(r.id, false);
    write({ body: 'Sí' });
    vi.advanceTimersByTime(DRAFT_DELAY + 100);
    await ctl.send(ctl.compose!, 'a2');
    expect(r.answered).toBe(true);
    expect(drafts()).toHaveLength(0);
    expect(ctl.compose).toBeNull();
  });

  it('enviar no cierra otro mensaje que se esté escribiendo', async () => {
    ctl.newMessage();
    write({ subject: 'A medias' });
    await ctl.send({ id: 'otro', to: 'luis@x.es', cc: '', bcc: '', subject: 'Aparte', body: 't', attachments: [] }, 'a1');
    expect(ctl.compose?.subject).toBe('A medias');
  });
});

describe('destinatarios', () => {
  it('sugiere contactos y personas del correo', () => {
    ctl.data.contacts.push({ ...newContact(), name: 'Marta Ruiz', emails: [{ label: '', value: 'marta@x.es' }] });
    received();
    expect(ctl.addressEntries().map((e) => e.email).sort()).toEqual(['ana@x.es', 'marta@x.es']);
  });
});
