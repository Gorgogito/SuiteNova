import { describe, expect, it } from 'vitest';
import { Workbook } from './workbook';

function time<T>(fn: () => T): { ms: number; value: T } {
  const t0 = performance.now();
  const value = fn();
  return { ms: performance.now() - t0, value };
}

describe('performance', () => {
  it('builds and recalculates 100k formulas quickly', { timeout: 60_000 }, () => {
    const w = new Workbook();
    const id = w.sheets[0]!.id;
    const n = 100_000;
    const build = time(() =>
      w.transact(() => {
        for (let r = 0; r < n; r++) {
          w.setValue(id, r, 0, r + 1);
          w.setInput(id, r, 1, `=A${r + 1}*2`);
          w.setInput(id, r, 2, `=B${r + 1}+1`);
        }
        w.setInput(id, 0, 4, `=SUM(C1:C${n})`);
      }),
    );
    expect(w.getValue(id, 0, 4)).toBe(n * (n + 1) + n);
    expect(build.ms).toBeLessThan(15_000);

    const edit = time(() => w.setValue(id, 0, 0, 1000));
    expect(w.getValue(id, 0, 4)).toBe(n * (n + 1) + n + 2 * 999);
    expect(edit.ms).toBeLessThan(500);
    console.log(`build ${build.ms.toFixed(0)} ms, single edit ${edit.ms.toFixed(1)} ms`);
  });

  it('evaluates thousands of lookups against a large table', { timeout: 120_000 }, () => {
    const w = new Workbook();
    const id = w.sheets[0]!.id;
    const rows = 20_000;
    const t = time(() =>
      w.transact(() => {
        for (let r = 0; r < rows; r++) {
          w.setValue(id, r, 0, r);
          w.setValue(id, r, 1, r * 3);
        }
        for (let r = 0; r < 5000; r++) w.setInput(id, r, 3, `=VLOOKUP(${r * 2},A1:B${rows},2,TRUE)`);
        for (let r = 0; r < 500; r++) w.setInput(id, r, 4, `=SUMIF(A1:A${rows},">${r}")`);
      }),
    );
    expect(w.getValue(id, 10, 3)).toBe(60);
    expect(t.ms).toBeLessThan(15_000);
    console.log(`lookups ${t.ms.toFixed(0)} ms`);
  });
});
