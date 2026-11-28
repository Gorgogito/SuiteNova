import { newForm, newQuestion, templates, type Form, type Response } from '@suitenova/forms-core';
import { readXlsx } from '@suitenova/xlsx-io';
import { describe, expect, it } from 'vitest';
import { FormsCtl } from './ctl';
import { questionSvg, PRINT_COLORS } from './QuestionChart';
import { summarize } from '@suitenova/forms-core';
import { responsesXlsx } from './xlsx';

const form: Form = {
  ...newForm('Merienda'),
  id: 'f',
  questions: [
    { ...newQuestion('choice'), id: 'c', title: 'Fruta', options: ['Mango', 'Piña'] },
    { ...newQuestion('text'), id: 't', title: '=HYPERLINK("x")' },
    { ...newQuestion('number'), id: 'n', title: 'Cuántas' },
    { ...newQuestion('date'), id: 'd', title: 'Día' },
  ],
};
const rs: Response[] = [
  { id: 'a', at: new Date(2026, 5, 1, 10, 30).toISOString(), name: 'Zoe', seconds: 75, answers: { c: 'Mango', t: '=1+1', n: 3, d: '2026-06-02' } },
  { id: 'b', at: new Date(2026, 5, 2, 9, 0).toISOString(), answers: { c: 'Piña', t: `bien\u0001<&>${'x'.repeat(40000)}` } },
];

describe('los resultados', () => {
  it('el libro de Excel se vuelve a leer: valores, fechas y nada convertido en fórmula', async () => {
    const book = (await readXlsx(await responsesXlsx(form, rs))).workbook;
    expect(book.sheets.map((s) => s.name)).toEqual(['Respuestas', 'Resumen']);
    const first = book.sheets[0]!;
    const value = (r: number, c: number) => book.getCell(first.id, r, c)?.value ?? null;
    expect(Array.from({ length: 8 }, (_, c) => value(0, c))).toEqual(['Id', 'Fecha', 'Nombre', 'Duración (s)', 'Fruta', '=HYPERLINK("x")', 'Cuántas', 'Día']);
    expect(Array.from({ length: 8 }, (_, c) => value(1, c)).slice(2, 7)).toEqual(['Zoe', 75, 'Mango', '=1+1', 3]);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) expect(book.getCell(first.id, r, c)?.formula, `${r},${c}`).toBeUndefined();
    // 2026-06-01 10:30 is the day 46174 and a bit
    expect(value(1, 1) as number).toBeCloseTo(46174 + 10.5 / 24, 5);
    expect(book.getStyle(first.id, 1, 1).numFmt).toBe('yyyy-mm-dd hh:mm');
    expect([value(1, 7), book.getStyle(first.id, 1, 7).numFmt]).toEqual([46175, 'yyyy-mm-dd']);
    expect((value(2, 5) as string).length).toBeLessThanOrEqual(32767);
    expect(value(2, 5) as string).toContain('bien<&>');
    expect(first.freeze.rows).toBe(1);
    const second = book.sheets[1]!;
    expect([0, 1, 2, 3].map((c) => book.getCell(second.id, 1, c)?.value)).toEqual(['1. Fruta', 'Mango', 1, 50]);
  });

  it('un libro sin respuestas se puede escribir', async () => {
    await expect(responsesXlsx(templates('es')[3]!.make(), [])).resolves.toBeInstanceOf(Uint8Array);
  });

  it('los gráficos se dibujan donde tienen sentido', () => {
    const [choice, text] = summarize(form, rs).questions;
    for (const kind of ['column', 'pie', 'doughnut'] as const) {
      const svg = questionSvg(choice!, kind, PRINT_COLORS, 'es', 'Otras');
      expect(svg.startsWith('<svg'), kind).toBe(true);
      expect(svg).toContain('Mango');
    }
    expect(questionSvg(text!, 'column', PRINT_COLORS, 'es', 'Otras')).toBe('');
    expect(questionSvg(summarize(form, []).questions[0]!, 'pie', PRINT_COLORS, 'es', 'Otras')).toBe('');
    const odd = questionSvg(summarize({ ...form, questions: [{ ...form.questions[0]!, options: ['<script>x</script>'] }] }, [{ ...rs[0]!, answers: { c: '<script>x</script>' } }]).questions[0]!, 'pie', PRINT_COLORS, 'es', 'Otras');
    expect(odd).not.toContain('<script>');
  });

  it('filtro, orden y la respuesta que se mira; abrir otro archivo lo olvida', () => {
    const ctl = new FormsCtl();
    ctl.load({ form, responses: rs }, null, null);
    ctl.setSort({ key: 'name', descending: false });
    ctl.setFilter({ text: 'mango' });
    ctl.setFilter({ from: '2026-06-01' });
    expect(ctl.filter).toEqual({ text: 'mango', from: '2026-06-01' });
    expect(ctl.ordered(ctl.responses).map((r) => r.id)).toEqual(['a', 'b']);
    ctl.showResponse('b');
    expect([ctl.resultsView, ctl.shownResponse, ctl.dirty]).toEqual(['individual', 'b', false]);
    ctl.clearFilter();
    ctl.setSort(null);
    expect([ctl.filter, ctl.ordered(ctl.responses)]).toEqual([{}, ctl.responses]);
    ctl.setFilter({ text: 'x' });
    ctl.load({ form, responses: [] }, null, null);
    expect([ctl.filter, ctl.sort, ctl.shownResponse, ctl.resultsView]).toEqual([{}, null, null, 'summary']);
  });

  it('guarda cuánto se tardó solo si tiene sentido', () => {
    const ctl = new FormsCtl();
    ctl.load({ form, responses: [] }, null, null);
    for (const seconds of [12, 0, undefined, 2.5]) ctl.addResponse({ c: 'Mango' }, '', seconds);
    expect(ctl.responses.map((r) => r.seconds)).toEqual([12, undefined, undefined, undefined]);
  });
});
