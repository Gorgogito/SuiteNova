// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMessage, parseMessage, rawOf } from '@suitenova/mail-core';
import { writerSchema } from '@suitenova/writer-core';
import type { Node as PMNode } from 'prosemirror-model';
import { MailCtl, type ComposeState } from './ctl';
import { messageContent } from './rich/content';
import { renderMail } from './rich/html';
import { saveSignatures, signatureFor, withSignature } from './rich/library';
import { docFromText, htmlToDoc } from './rich/parse';

const p = (...content: PMNode[]) => writerSchema.node('paragraph', null, content);
const txt = (s: string, ...marks: [string, Record<string, unknown>?][]) => writerSchema.text(s, marks.map(([name, attrs]) => writerSchema.mark(name, attrs)));
const doc = (...blocks: PMNode[]) => writerSchema.node('doc', null, blocks);
// a 1×1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('del editor al mensaje', () => {
  it('el texto sin formato va solo como texto', () => {
    const r = renderMail(docFromText('Hola\n\nAdiós'));
    expect(r.rich).toBe(false);
    expect(r.text).toBe('Hola\n\nAdiós');
    expect(messageContent({ body: 'x', doc: docFromText('Hola').toJSON() })).toEqual({ text: 'Hola', html: null, inline: [] });
  });

  it('el formato va en el HTML con el estilo escrito en cada elemento, y el texto se lee igual', () => {
    const r = renderMail(
      doc(
        p(txt('Importante', ['strong'], ['color', { value: '#c00000' }]), txt(' y '), txt('web', ['link', { href: 'https://example.org' }])),
        writerSchema.node('bullet_list', null, [writerSchema.node('list_item', null, [p(txt('uno'))]), writerSchema.node('list_item', null, [p(txt('dos'))])]),
        writerSchema.node('paragraph', { align: 'center' }, [txt('<b>no</b>')]),
      ),
    );
    expect(r.rich).toBe(true);
    expect(r.html).toContain('<span style="color:#c00000"><b>Importante</b></span>');
    expect(r.html).toContain('<a href="https://example.org">web</a>');
    expect(r.html).toContain('<ul style="margin:0;padding-left:28px"><li>uno</li><li>dos</li></ul>');
    expect(r.html).toContain('text-align:center');
    expect(r.html).toContain('&lt;b&gt;no&lt;/b&gt;');
    expect(r.html).not.toContain('class=');
    expect(r.text).toBe('Importante y web <https://example.org>\n• uno\n• dos\n<b>no</b>');
  });

  it('no deja pasar vínculos activos ni imágenes que se pidan a otro sitio', () => {
    const r = renderMail(doc(p(txt('x', ['link', { href: 'javascript:alert(1)' }]), writerSchema.node('image', { src: 'https://t.example/p.gif', alt: 'rastreo' }))));
    expect(r.html).not.toContain('javascript');
    expect(r.html).not.toContain('<img');
    expect(r.inline).toEqual([]);
  });

  it('las imágenes viajan incrustadas, una vez cada una', () => {
    const img = writerSchema.node('image', { src: PNG, alt: 'logo', width: 40, edits: { name: 'logo.png' } });
    const r = renderMail(doc(p(img), p(img)));
    expect(r.inline).toHaveLength(1);
    expect(r.inline[0]!.filename).toBe('logo.png');
    expect(r.html.match(new RegExp(`cid:${r.inline[0]!.contentId}`, 'g'))).toHaveLength(2);
    expect(r.html).toContain('alt="logo" width="40"');
    expect(r.text).toBe('[Imagen: logo]\n[Imagen: logo]');
  });

  it('las tablas llevan su estilo y sus fórmulas calculadas', () => {
    const cell = (s: string) => writerSchema.node('table_cell', null, [p(...(s ? [txt(s)] : []))]);
    const table = writerSchema.node('table', { tstyle: 'grid-1' }, [writerSchema.node('table_row', null, [cell('Concepto'), cell('Total')]), writerSchema.node('table_row', null, [cell('3'), cell('=A2*2')])]);
    const r = renderMail(doc(table));
    expect(r.html).toContain('<table');
    expect(r.html).toContain('>6</td>');
    expect(r.html).toMatch(/border-top:\dpx solid/);
    expect(r.text).toContain('6');
    expect(r.text).not.toContain('=A2*2');
  });

  it('un borrador antiguo con tabla se abre con sus celdas y su fórmula', () => {
    const data = JSON.stringify({ id: 't', name: 'Tabla 1', rows: [['2', '=A1*3']], styleId: 'grid-1' }).replace(/"/g, '&quot;');
    const d = htmlToDoc(`<div>Antes<br><table data-nova="${data}"><tbody><tr><td>2</td><td>6</td></tr></tbody></table>Después<img src="https://x.example/a.png"></div>`);
    expect(JSON.stringify(d.toJSON())).toContain('=A1*3');
    expect(JSON.stringify(d.toJSON())).not.toContain('x.example');
    expect(d.textContent).toContain('Antes');
    expect(d.textContent).toContain('Después');
  });
});

describe('responder con formato', () => {
  let ctl: MailCtl;
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    ctl = new MailCtl();
  });
  afterEach(() => {
    ctl.dispose();
    vi.unstubAllGlobals();
  });
  const original = () =>
    ctl.importRaw(
      buildMessage({ from: { name: 'Ana', email: 'ana@x.es' }, to: [{ name: '', email: 'yo@x.es' }], subject: 'Informe', text: 'Cifras', html: '<style>.a{color:red}</style><p class="a">Ci<b>fras</b><img src="cid:g1"></p><script>alert(1)</script>', attachments: [{ filename: 'g.png', contentType: 'image/png', data: new Uint8Array([1, 2, 3]), contentId: 'g1' }], messageId: '<inf@x.es>' }),
      'inbox',
    );
  const write = (over: Partial<ComposeState>) => ctl.updateCompose({ ...ctl.compose!, ...over });

  it('el original va debajo con su formato y sus imágenes, sin nada activo', () => {
    ctl.reply(original().id, false);
    const c = ctl.compose!;
    expect(c.body).toBe('');
    const { raw } = ctl.buildRaw({ ...c, body: 'Gracias', doc: docFromText('Gracias').toJSON() });
    const m = parseMessage(raw);
    expect(m.html).toContain('Gracias');
    expect(m.html).toContain('Ci<b>fras</b>');
    expect(m.html).toContain('.a{color:red}');
    expect(m.html).toContain('<blockquote');
    expect(m.html).not.toContain('<script');
    expect(m.inlineParts.map((x) => x.cid)).toEqual(['g1']);
    expect(m.text).toMatch(/^Gracias\r?\n\r?\nEl .*Ana <ana@x\.es> escribió:\r?\n> Cifras/);
  });

  it('un borrador se abre como se escribió: formato, original e importancia', () => {
    ctl.reply(original().id, false);
    const written = doc(p(txt('Hecho', ['strong'])));
    write({ doc: written.toJSON(), body: 'Hecho', importance: 'high' });
    ctl.closeSaving();
    const rec = ctl.data.messages.find((m) => m.folder === 'drafts')!;
    expect(rec.importance).toBe('high');
    expect(parseMessage(rawOf(rec)).html).toContain('<b>Hecho</b>');
    ctl.editDraft(rec.id);
    const c = ctl.compose!;
    expect(c.doc).toEqual(written.toJSON());
    expect(c.importance).toBe('high');
    expect(c.quote!.inline.map((a) => a.contentId)).toEqual(['g1']);
    // opening it again changes nothing
    ctl.requestCloseCompose();
    expect(ctl.askClose).toBe(false);
  });

  it('la firma de la cuenta se pone sola y cambia con la cuenta', () => {
    const sig = (id: string, text: string) => ({ id, name: id, doc: docFromText(text).toJSON() });
    saveSignatures({ list: [sig('g', 'General'), sig('r', 'Corta'), sig('c', 'Casa')], defaults: { '': { new: 'g', reply: 'r' }, casa: { new: 'c' }, mudo: { new: '' } } });
    expect(signatureFor(undefined, 'new')!.id).toBe('g');
    expect(signatureFor('casa', 'new')!.id).toBe('c');
    expect(signatureFor('casa', 'reply')!.id).toBe('r');
    expect(signatureFor('mudo', 'new')).toBeNull();
    ctl.newMessage();
    expect(ctl.compose!.body).toBe('\n\nGeneral');
    // an untouched message with only its signature closes without asking and leaves no draft
    ctl.requestCloseCompose();
    expect(ctl.compose).toBeNull();
    expect(ctl.data.messages).toHaveLength(0);
    ctl.newMessage();
    expect(ctl.withAccount(ctl.compose!, 'casa').body).toBe('\n\nCasa');
    ctl.reply(original().id, false);
    expect(ctl.compose!.body).toBe('\n\nCorta');
  });

  it('la firma ocupa el sitio de la que había', () => {
    const one = { id: 'a', name: 'a', doc: docFromText('Uno').toJSON() };
    const two = { id: 'b', name: 'b', doc: docFromText('Dos').toJSON() };
    const first = withSignature(docFromText('Hola'), one);
    const second = withSignature(first, two);
    expect(renderMail(second).text).toBe('Hola\n\nDos');
    expect(renderMail(withSignature(second, null)).text).toBe('Hola\n');
    expect(renderMail(second).html).toContain('data-nova-signature');
  });

  it('las macros leen y escriben Body, HTMLBody e Importance como en Outlook', () => {
    original();
    ctl.macros = [
      {
        name: 'M',
        code: `Sub Probar()
Set r = Application.Session.GetDefaultFolder(olFolderInbox).Items(1).Reply
Debug.Print InStr(r.Body, "Cifras") > 0
r.HTMLBody = "<p>Hola <b>mundo</b></p>"
r.Importance = olImportanceHigh
r.Save
Debug.Print r.Body
End Sub`,
      },
    ];
    ctl.setMacrosEnabled(true);
    ctl.macroRt.run('Probar');
    const rec = ctl.data.messages.find((m) => m.folder === 'drafts')!;
    expect(rec.importance).toBe('high');
    expect(parseMessage(rawOf(rec)).html).toContain('<b>mundo</b>');
  });
});
