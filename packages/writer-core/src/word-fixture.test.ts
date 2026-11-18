// Genera scripts/word-compare/lang.docx para abrirlo con Word real (word-lang.ps1). Solo con NOVA_WORD_FIXTURES=1.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Node as PMNode } from 'prosemirror-model';
import { describe, it } from 'vitest';
import { DEFAULT_DOC_DEFAULTS, defaultPage, defaultSection, emptyWriterDoc, makeSection, nodeTypes, writeDocx, writerSchema, type WriterDoc } from './index';

const mk = (name: string, attrs?: Record<string, unknown>) => writerSchema.marks[name]!.create(attrs);
const p = (text: string, marks: ReturnType<typeof mk>[] = []) => nodeTypes.paragraph!.create({}, writerSchema.text(text, marks));
const wd = (...blocks: PMNode[]): WriterDoc => ({ ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }), body: nodeTypes.doc!.create(null, [makeSection(blocks, defaultSection(defaultPage()))]) });
describe.skipIf(!process.env.NOVA_WORD_FIXTURES)('fixture para Word', () => {
  it('lang.docx', async () => {
    const out = await writeDocx(wd(p('Una cassa rara.', [mk('lang', { value: 'es-MX' })]), p('A dogg runs.', [mk('lang', { value: 'en-US' })]), p('Una cassa sin revisar.', [mk('noproof')]), p('Una cassa normal.')));
    fs.writeFileSync(fileURLToPath(new URL('../../../scripts/word-compare/lang.docx', import.meta.url)), out.data);
  });
});
