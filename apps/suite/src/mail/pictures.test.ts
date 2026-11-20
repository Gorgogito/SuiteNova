import { buildMessage, parseMessage } from '@suitenova/mail-core';
import { describe, expect, it } from 'vitest';
import { htmlBody, picturesOfDraft, tokenOf, uniqueName, usedPictures, type ComposePicture } from './pictures';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const pic = (name: string, extra: Partial<ComposePicture> = {}): ComposePicture => ({ id: `${name}@x`, name, orig: { mime: 'image/png', data: png }, sent: { mime: 'image/png', data: png }, width: 320, alt: '', ...extra });

describe('imágenes en el cuerpo del mensaje', () => {
  it('cada marca del texto se vuelve su imagen en línea y la imagen quitada del texto no se envía', () => {
    const a = pic('a.png', { alt: 'Logo "Nova"', width: 200 });
    const b = pic('b.png');
    const body = `Hola\n${tokenOf('a.png')}\nAdiós <yo> & tú`;
    expect(usedPictures(body, [a, b])).toEqual([a]);
    const h = htmlBody(body, [a, b])!;
    expect(h.html).toContain('<img src="cid:a.png@x" alt="Logo &quot;Nova&quot;" width="200"');
    expect(h.html).toContain('Hola<br>');
    expect(h.html).toContain('Adiós &lt;yo&gt; &amp; tú');
    expect(h.inline).toHaveLength(1);
    expect(h.inline[0]).toMatchObject({ filename: 'a.png', contentId: 'a.png@x', contentType: 'image/png' });
    expect(htmlBody('solo texto', [a])).toBeNull();
  });

  it('el mensaje construido lleva el HTML con la imagen y al abrir el borrador las imágenes vuelven con su marca', () => {
    const a = pic('foto.png', { alt: 'Una foto', width: 150 });
    const body = `Mira:\n${tokenOf('foto.png')}\nFin`;
    const h = htmlBody(body, [a])!;
    const raw = buildMessage({ from: { name: '', email: 'yo@x.org' }, to: [{ name: '', email: 'tu@x.org' }], subject: 'S', text: body, html: h.html, attachments: h.inline });
    expect(raw).toContain('multipart/related');
    const m = parseMessage(raw);
    expect(m.text).toContain('[Imagen: foto.png]');
    expect(m.attachments).toHaveLength(0);
    const back = picturesOfDraft(m.html, m.inlineParts);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ name: 'foto.png', width: 150, alt: 'Una foto' });
    expect([...back[0]!.sent.data]).toEqual([...png]);
    expect(usedPictures(m.text!, back)).toHaveLength(1);
  });

  it('un nombre repetido recibe un número', () => {
    expect(uniqueName('a.png', [])).toBe('a.png');
    expect(uniqueName('a.png', ['a.png'])).toBe('a (2).png');
    expect(uniqueName('a.png', ['a.png', 'a (2).png'])).toBe('a (3).png');
  });
});
