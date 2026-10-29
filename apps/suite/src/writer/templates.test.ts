import { plainText, readDocx, writeDocx } from '@suitenova/writer-core';
import { describe, expect, it } from 'vitest';
import { TEMPLATES } from './templates';

describe('built-in templates', () => {
  it('has the templates the gallery promises, with unique ids', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  });
  for (const tpl of TEMPLATES) {
    it(`"${tpl.name}" is a valid document and survives .docx`, async () => {
      const d = tpl.build();
      d.body.check();
      const text = plainText(d.body);
      expect(text.length).toBeGreaterThan(20);
      const w = await writeDocx(d);
      const back = await readDocx(w.data);
      back.doc.body.check();
      expect(plainText(back.doc.body).replace(/\s+/g, ' ')).toContain(text.replace(/\s+/g, ' ').slice(0, 15));
      let controls = 0;
      let backControls = 0;
      d.body.descendants((n) => {
        if (n.type.name === 'content_control') controls++;
      });
      back.doc.body.descendants((n) => {
        if (n.type.name === 'content_control') backControls++;
      });
      expect(backControls).toBe(controls);
    });
  }
  it('the report keeps its footer with page numbers', async () => {
    const d = TEMPLATES.find((t) => t.id === 'report')!.build();
    const w = await writeDocx(d);
    const back = await readDocx(w.data);
    const parts = Object.values(back.doc.parts).map((p) => plainText(p));
    expect(parts.some((p) => /Página/.test(p))).toBe(true);
  });
  it('the template flag makes a .dotx', async () => {
    const d = { ...TEMPLATES[0]!.build(), isTemplate: true };
    const back = await readDocx((await writeDocx(d)).data);
    expect(back.doc.isTemplate).toBe(true);
  });
});
