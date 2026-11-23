import { buildMessage, parseMessage } from '@suitenova/mail-core';
import { describe, expect, it } from 'vitest';
import { htmlBody, tokenOf } from './pictures';
import { newTable, shownCells, tableHtml, tableText, tableToken, tablesOfDraft, textBody, uniqueTableName, usedTables } from './tables';

const sample = () => {
  const t = newTable('Tabla 1', 4, 3);
  t.rows = [['Producto', 'Cant', 'Precio'], ['Té', '2', '10'], ['Café', '3', '20'], ['Total', '=SUM(ABOVE)', '=SUM(ABOVE)']];
  return t;
};

describe('tablas en el cuerpo del mensaje', () => {
  it('las fórmulas se calculan con ARRIBA y referencias, también una que lee otra', () => {
    const t = sample();
    expect(shownCells(t, '.')[3]).toEqual(['Total', '5', '30']);
    t.rows.push(['', '=B4*2', '=C4+B5']);
    expect(shownCells(t, '.')[4]).toEqual(['', '10', '40']);
  });
  it('el texto alineado lleva los números a la derecha y una línea bajo el encabezado', () => {
    const lines = tableText(sample(), '.').split('\n');
    expect(lines[0]).toBe('Producto | Cant | Precio');
    expect(lines[1]).toMatch(/^-+-\+-/);
    expect(lines[2]).toBe('Té       |    2 |     10');
    expect(lines[4]).toBe('Total    |    5 |     30');
  });
  it('el HTML es una tabla con el estilo en línea y el encabezado como th', () => {
    const h = tableHtml(sample(), '.');
    expect(h).toContain('<table');
    expect(h).toContain('<th style=');
    expect(h).toMatch(/background-color:#[0-9a-f]{6}|border-top:1px solid/);
    expect(h).toContain('>5</td>');
  });
  it('la marca del texto se vuelve la tabla en el HTML y en el texto, y una tabla quitada del texto no se envía', () => {
    const t = sample();
    const body = `Hola\n${tableToken('Tabla 1')}\nAdiós <yo>`;
    expect(usedTables(body, [t])).toEqual([t]);
    const h = htmlBody(body, [], [t], '.')!;
    expect(h.html).toContain('<table');
    expect(h.html).toContain('Adiós &lt;yo&gt;');
    expect(h.inline).toHaveLength(0);
    expect(htmlBody('solo texto', [], [t])).toBeNull();
    expect(textBody(body, [t], '.')).toContain('Total    |    5 |     30');
    expect(textBody(body, [t], '.')).not.toContain('[Tabla:');
    // una imagen y una tabla en el mismo mensaje
    expect(tokenOf('a.png')).toBe('[Imagen: a.png]');
  });
  it('el borrador guarda la marca en el texto y la tabla en el HTML, y vuelve igual', () => {
    const t = sample();
    t.styleId = 'medium-2';
    t.options = { ...t.options, lastRow: true };
    const body = `Mira:\n${tableToken('Tabla 1')}\nFin`;
    const h = htmlBody(body, [], [t], '.')!;
    const raw = buildMessage({ from: { name: '', email: 'yo@x.org' }, to: [{ name: '', email: 'tu@x.org' }], subject: 'S', text: body, html: h.html, attachments: [] });
    const m = parseMessage(raw);
    expect(m.text).toContain('[Tabla: Tabla 1]');
    const back = tablesOfDraft(m.html);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ name: 'Tabla 1', rows: t.rows, styleId: 'medium-2' });
    expect(back[0]!.options.lastRow).toBe(true);
  });
  it('un nombre repetido recibe un número', () => {
    expect(uniqueTableName([])).toBe('Tabla 1');
    expect(uniqueTableName(['Tabla 1', 'Tabla 3'])).toBe('Tabla 2');
  });
});
