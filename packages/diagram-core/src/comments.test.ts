import JSZip from 'jszip';
import { XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { addPage, addShape, deleteItems, duplicatePage, exportVsdx, importVsdx, newDiagram, parseDiagram, serializeDiagram, updatePage, type CommentThread, type Diagram } from './index';

const T0 = '2026-11-20T10:00:00.000Z';
const msg = (id: string, author: string, text: string, min = 0, extra = {}) => ({ id, author, initials: author[0], date: new Date(Date.parse(T0) + min * 60000).toISOString(), text, ...extra });

function sample(): { d: Diagram; a: string; b: string } {
  let d = newDiagram('Demo');
  let p = d.pages[0]!;
  const ra = addShape(p, 'process', 200, 150, { text: 'Paso uno' });
  const rb = addShape(ra.page, 'decision', 500, 300, { text: '¿Ok?' });
  const threads: CommentThread[] = [
    { id: 't1', shape: ra.shape.id, resolved: true, messages: [msg('m1', 'Ana María', 'Revisar este <paso> & más'), msg('m2', 'Luis Torres', 'De acuerdo\nSegunda línea', 5)] },
    { id: 't2', messages: [msg('m3', 'Luis Torres', 'Comentario de la página', 10)] },
  ];
  p = { ...rb.page, threads };
  d = { ...d, pages: [p] };
  return { d, a: ra.shape.id, b: rb.shape.id };
}

describe('comments of a diagram', () => {
  it('are kept in the .novadiagram file', () => {
    const { d, a } = sample();
    const back = parseDiagram(serializeDiagram(d)).diagram.pages[0]!;
    expect(back.threads).toHaveLength(2);
    expect(back.threads![0]).toMatchObject({ id: 't1', shape: a, resolved: true });
    expect(back.threads![0]!.messages.map((m) => [m.author, m.text])).toEqual([['Ana María', 'Revisar este <paso> & más'], ['Luis Torres', 'De acuerdo\nSegunda línea']]);
    expect(back.threads![1]!.shape).toBeUndefined();
  });

  it('are repaired on reading: damaged ones are dropped and a comment on a missing shape goes to the page', () => {
    const { d } = sample();
    const raw = JSON.parse(serializeDiagram(d));
    raw.pages[0].threads = [{ id: 'x', shape: 'no-existe', messages: [{ id: 'm', author: 'Ana', date: 'ayer', text: 'hola' }] }, { id: 'y', messages: [{ text: 5 }] }, { id: 'z', messages: [] }, 'basura'];
    const t = parseDiagram(JSON.stringify(raw)).diagram.pages[0]!.threads!;
    expect(t).toHaveLength(1);
    expect(t[0]!.shape).toBeUndefined();
    expect(t[0]!.messages[0]!.date).toBe(new Date(0).toISOString());
  });

  it('go with their shape when it is deleted, and are not copied with a duplicated page', () => {
    const { d, a, b } = sample();
    const p = d.pages[0]!;
    const del = deleteItems(p, [a], []);
    expect(del.threads!.map((t) => t.id)).toEqual(['t2']);
    expect(deleteItems(p, [b], []).threads).toHaveLength(2);
    const dup = duplicatePage(d, p.id)!;
    expect(dup.page.threads).toBeUndefined();
    expect(d.pages[0]!.threads).toHaveLength(2);
    void addPage;
    void updatePage;
  });

  it('are written to a .vsdx as Visio writes them, and read back as conversations', async () => {
    const { d, a } = sample();
    const bytes = await exportVsdx(d);
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('visio/comments.xml')!.async('string');
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml).toContain('<AuthorEntry Name="Ana María"');
    expect(xml).toMatch(/<CommentEntry AuthorID="1" PageID="0" ShapeID="1" Date="2026-11-20T10:00:00" EditDate="2026-11-20T10:00:00" CommentID="1" AutoCommentType="0">Revisar este &lt;paso&gt; &amp; más<\/CommentEntry>/);
    // the reply is the next comment on the same shape, and the page comment has no shape
    expect(xml).toMatch(/AuthorID="2" PageID="0" ShapeID="1"[^>]*CommentID="2"/);
    expect(xml).toMatch(/PageID="0" Date="2026-11-20T10:10:00"[^>]*CommentID="3"/);
    expect(await zip.file('visio/_rels/document.xml.rels')!.async('string')).toContain('visio/2010/relationships/comments" Target="comments.xml"');
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('application/vnd.ms-visio.comments+xml');

    const back = (await importVsdx(bytes)).diagram.pages[0]!;
    expect(back.threads).toHaveLength(2);
    const onShape = back.threads!.find((t) => t.shape)!;
    const shapeBack = back.shapes.find((s) => s.id === onShape.shape)!;
    expect(shapeBack.text).toBe('Paso uno');
    expect(onShape.messages.map((m) => [m.author, m.text, m.date])).toEqual([['Ana María', 'Revisar este <paso> & más', T0], ['Luis Torres', 'De acuerdo\nSegunda línea', '2026-11-20T10:05:00.000Z']]);
    // Visio has no «resolved»
    expect(onShape.resolved).toBeUndefined();
    expect(back.threads!.find((t) => !t.shape)!.messages[0]!.text).toBe('Comentario de la página');
    void a;
  });

  it('a drawing with no comments has no comments part', async () => {
    const zip = await JSZip.loadAsync(await exportVsdx(newDiagram('Vacío')));
    expect(zip.file('visio/comments.xml')).toBeNull();
    expect(await zip.file('[Content_Types].xml')!.async('string')).not.toContain('comments');
  });

  it('a comment on a shape of a layer that does not print goes with its shape, which stays in the file', async () => {
    const { d, a } = sample();
    const p = d.pages[0]!;
    const hidden = { ...p, layers: [{ id: 'base', name: 'Base', visible: true, locked: false, printable: true }, { id: 'ly2', name: 'Oculta', visible: true, locked: false, printable: false }], shapes: p.shapes.map((s) => (s.id === a ? { ...s, layer: 'ly2' } : s)) };
    const xml = await (await JSZip.loadAsync(await exportVsdx({ ...d, pages: [hidden] }))).file('visio/comments.xml')!.async('string');
    expect(xml).toContain('Revisar este');
    expect(xml).toContain('Comentario de la página');
  });
});
