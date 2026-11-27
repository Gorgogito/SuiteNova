import { describe, expect, it } from 'vitest';
import { buildMessage } from './build';
import { addressBook, splitRecipients, suggestRecipients, typedRecipient } from './recipients';
import { addRaw, newMailData } from './store';
import { newContact } from './vcard';

describe('destinatarios escritos', () => {
  it('separa por comas y puntos y coma, sin cortar un nombre entre comillas', () => {
    expect(splitRecipients('"Pérez, Ana" <ana@x.es>; luis@x.es,  Marta Ruiz <marta@x.es>, ')).toEqual([
      { name: 'Pérez, Ana', email: 'ana@x.es' },
      { name: '', email: 'luis@x.es' },
      { name: 'Marta Ruiz', email: 'marta@x.es' },
    ]);
    expect(splitRecipients('')).toEqual([]);
  });

  it('conserva lo que no es una dirección, para avisar', () => {
    expect(splitRecipients('no es una dirección')).toEqual([{ name: '', email: 'no es una dirección' }]);
    expect(splitRecipients('a@b.c\r\nBcc: x@y.z')).toEqual([{ name: '', email: 'a@b.c\r\nBcc: x@y.z' }]);
  });

  it('encuentra el destinatario que se está escribiendo en la posición del cursor', () => {
    const text = '"Pérez, Ana" <ana@x.es>, lu, marta@x.es';
    expect(typedRecipient(text, text.indexOf('lu') + 2)).toEqual({ from: 24, to: 27, query: 'lu' });
    expect(typedRecipient('ma', 2)).toEqual({ from: 0, to: 2, query: 'ma' });
    expect(typedRecipient('a@x.es, ', 8).query).toBe('');
  });
});

describe('libreta de direcciones', () => {
  const mail = () => {
    const d = newMailData();
    d.contacts.push({ ...newContact(), name: 'Marta Contacto', emails: [{ label: '', value: 'marta@x.es' }] });
    const msg = (from: string, to: string, name = '') => buildMessage({ from: { name, email: from }, to: [{ name: '', email: to }], subject: 's', text: 't' });
    addRaw(d, 'inbox', msg('maria@x.es', 'yo@x.es', 'María Álvarez'));
    addRaw(d, 'sent', msg('yo@x.es', 'mario@x.es'));
    addRaw(d, 'archive', msg('yo@x.es', 'mario@x.es'));
    addRaw(d, 'junk', msg('mala@spam.test', 'yo@x.es'));
    addRaw(d, 'drafts', msg('yo@x.es', 'borrador@x.es'));
    return d;
  };

  it('reúne contactos, remitentes y destinatarios de lo enviado; no el correo no deseado ni los borradores', () => {
    const book = addressBook(mail(), new Set(['yo@x.es']));
    expect(book.map((e) => e.email).sort()).toEqual(['maria@x.es', 'mario@x.es', 'marta@x.es']);
  });

  it('sugiere por el comienzo del nombre, de una palabra o de la dirección, sin importar acentos', () => {
    const book = addressBook(mail(), new Set(['yo@x.es']));
    const found = (q: string) => suggestRecipients(book, q).map((e) => e.email);
    // primero el contacto, luego a quien más se escribe
    expect(found('mar')).toEqual(['marta@x.es', 'mario@x.es', 'maria@x.es']);
    expect(found('alva')).toEqual(['maria@x.es']);
    expect(found('maria al')).toEqual(['maria@x.es']);
    expect(found('')).toEqual([]);
    expect(suggestRecipients(book, 'mar', new Set(['marta@x.es'])).map((e) => e.email)).toEqual(['mario@x.es', 'maria@x.es']);
  });
});
