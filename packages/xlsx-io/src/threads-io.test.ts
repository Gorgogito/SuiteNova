import { Workbook, applyObjects, captureObjects, type CellThread } from '@suitenova/calc-engine';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { readXlsx, writeXlsx } from './index';

const thread = (extra: Partial<CellThread> = {}): CellThread => ({
  id: 't1',
  row: 1,
  col: 1,
  messages: [
    { id: 'm1', author: 'Ana María', initials: 'AM', date: '2026-11-20T10:00:00.000Z', text: 'Revisar este <dato> & más' },
    { id: 'm2', author: 'Luis Torres', date: '2026-11-20T10:05:00.000Z', text: 'De acuerdo\nSegunda línea' },
  ],
  ...extra,
});
const make = (f: (s: Workbook['sheets'][number]) => void) => {
  const w = new Workbook();
  w.editObjects(w.sheets[0]!.id, f);
  return w;
};
const trip = async (w: Workbook) => {
  const bytes = await writeXlsx(w);
  return { bytes, workbook: (await readXlsx(bytes)).workbook };
};

describe('conversations (threaded comments) in a .xlsx', () => {
  it('writes the conversation, the people and the stand-in note, and reads them back', async () => {
    const { workbook, bytes } = await trip(
      make((s) => {
        s.threads.push(thread({ resolved: true }));
        s.comments.push({ row: 4, col: 3, author: 'Pablo', text: 'Una nota' });
      }),
    );
    const sh = workbook.sheets[0]!;
    expect(sh.comments).toMatchObject([{ row: 4, col: 3, author: 'Pablo', text: 'Una nota' }]);
    expect(sh.threads).toHaveLength(1);
    const t = sh.threads[0]!;
    expect([t.row, t.col, t.resolved]).toEqual([1, 1, true]);
    expect(t.messages.map((m) => [m.author, m.date, m.text])).toEqual([
      ['Ana María', '2026-11-20T10:00:00.000Z', 'Revisar este <dato> & más'],
      ['Luis Torres', '2026-11-20T10:05:00.000Z', 'De acuerdo\nSegunda línea'],
    ]);
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);
    expect(names).toContain('xl/threadedComments/threadedComment1.xml');
    expect(names).toContain('xl/persons/person.xml');
    const tc = await zip.file('xl/threadedComments/threadedComment1.xml')!.async('string');
    expect(tc).toMatch(/done="1"/);
    expect(tc.match(/parentId="\{[0-9A-F-]{36}\}"/g)).toHaveLength(1);
    // the stand-in note older versions of Excel show (author «tc={id}»), besides the real note
    const notes = await zip.file('xl/comments1.xml')!.async('string');
    expect(notes).toMatch(/<author>tc=\{[0-9A-F-]{36}\}<\/author>/);
    expect(notes).toContain('[Threaded comment]');
    expect(notes).toContain('<comment ref="D5"');
    const types = await zip.file('[Content_Types].xml')!.async('string');
    expect(types).toContain('application/vnd.ms-excel.threadedcomments+xml');
    expect(types).toContain('application/vnd.ms-excel.person+xml');
  });

  it('keeps the id of the conversation, and an unresolved one stays unresolved', async () => {
    const a = (await trip(make((s) => void s.threads.push(thread())))).workbook;
    expect(a.sheets[0]!.threads[0]!.resolved).toBeUndefined();
    const again = make((s) => void s.threads.push(...a.sheets[0]!.threads));
    expect((await trip(again)).workbook.sheets[0]!.threads[0]!.id).toBe(a.sheets[0]!.threads[0]!.id);
  });

  it('a note whose author looks like a stand-in but has no conversation stays a note', async () => {
    const { workbook } = await trip(make((s) => void s.comments.push({ row: 0, col: 0, author: 'tc={X}', text: 'nota' })));
    expect(workbook.sheets[0]!.comments).toHaveLength(1);
  });

  it('moves with its cell when rows are inserted, and goes when the row is deleted', () => {
    const w = make((s) => void s.threads.push(thread()));
    const id = w.sheets[0]!.id;
    w.shiftStructure(id, 'row', 0, 2);
    expect(w.sheets[0]!.threads[0]!.row).toBe(3);
    w.shiftStructure(id, 'row', 3, -1);
    expect(w.sheets[0]!.threads).toHaveLength(0);
  });

  it('survives undo of an object edit (the snapshot carries the conversations)', () => {
    const w = make((s) => void s.threads.push(thread()));
    const sh = w.sheets[0]!;
    const snap = captureObjects(sh);
    sh.threads = [];
    applyObjects(sh, snap);
    expect(sh.threads).toHaveLength(1);
    expect(sh.threads[0]).not.toBe(snap.threads![0]);
  });
});
