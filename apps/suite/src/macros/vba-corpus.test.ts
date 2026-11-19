import { basic } from '@suitenova/base-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Runs the corpus of `scripts/vba-compare/corpus.vba` with Nova Basic and writes `nova-out.json` next to it, so that
 * `scripts/vba-compare/compare.mjs` can set it against what real Excel gave (`excel-out.json`). It compares nothing by itself.
 */
const dir = join(__dirname, '../../../../scripts/vba-compare');

describe('corpus de VBA', () => {
  it('se ejecuta con Nova Basic y se guarda el resultado de cada fragmento', () => {
    const text = readFileSync(join(dir, 'corpus.vba'), 'utf8').replace(/\r\n/g, '\n');
    const items = text
      .split(/^'#### /m)
      .filter((c) => c.trim())
      .map((c) => {
        const nl = c.indexOf('\n');
        return { id: c.slice(0, nl).trim(), code: c.slice(nl + 1) };
      });
    expect(items.length).toBeGreaterThan(30);
    const results = items.map((it) => {
      try {
        const interp = new basic.Interpreter({ print: () => undefined, msgBox: () => 1, inputBox: () => null, objects: {}, functions: {}, compareText: false } as never, {});
        const errs = interp.load([{ name: 'M', source: it.code }]);
        if (errs.length) return { id: it.id, value: null, error: `Sintaxis: línea ${errs[0]!.line}: ${errs[0]!.message}` };
        const v = interp.call('T', []);
        return { id: it.id, value: v === undefined || v === null ? '' : String(v), error: null as string | null };
      } catch (e) {
        return { id: it.id, value: null, error: `#ERROR ${(e as Error).message}` };
      }
    });
    writeFileSync(join(dir, 'nova-out.json'), JSON.stringify({ results }, null, 1));
  });
});
