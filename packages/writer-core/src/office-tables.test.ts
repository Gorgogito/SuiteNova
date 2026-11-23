// Writes the .docx that `scripts/office-tables/layout-word.ps1` opens in the real Word (merged cells, borders and shading of a cell, alternative text,
// header row). It does nothing unless NOVA_OUT names the folder: `NOVA_OUT=<dir> npx vitest run src/office-tables.test.ts`.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'vitest';
import { DEFAULT_DOC_DEFAULTS, defaultPage, defaultSection, emptyWriterDoc, makeSection, nodeTypes, writeDocx, writerSchema } from './index';

const out = process.env.NOVA_OUT;
const line = (width: number, color: string) => ({ style: 'single', width, color });
const para = (t: string) => nodeTypes.paragraph!.create(null, t ? writerSchema.text(t) : undefined);
const cell = (t: string, attrs: Record<string, unknown> = {}) => nodeTypes.table_cell!.create({ colwidth: [90], ...attrs }, para(t));
const row = (...c: ReturnType<typeof cell>[]) => nodeTypes.table_row!.create(null, c);

describe.skipIf(!out)('a .docx for Word', () => {
  it('writes layout.docx', async () => {
    const t = nodeTypes.table!.create({ tstyle: 'medium-1', borders: false, headerRow: true, caption: 'Ventas', descr: 'Ventas por trimestre' }, [
      row(cell('Titulo', { colspan: 2, colwidth: [90, 90] }), cell('C'), cell('D')),
      row(cell('a1'), cell('b1', { background: '#ffc000' }), cell('c1'), cell('d1', { rowspan: 2 })),
      row(cell('a2'), cell('b2', { borders: { t: line(2.25, '#ff0000'), b: line(1, '#0000ff') } }), cell('c2')),
    ]);
    const d = { ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }), body: nodeTypes.doc!.create(null, [makeSection([t], defaultSection(defaultPage()))]) };
    const w = await writeDocx(d);
    fs.mkdirSync(out!, { recursive: true });
    fs.writeFileSync(path.join(out!, 'layout.docx'), w.data);
  });
});
