import { getLocale, setLocale, t } from '@suitenova/core-ui';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import './messages';

/** Every Spanish literal passed to t() (or shown as a label) in the Plan UI must have an English text. */
function literals(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of src.matchAll(/\bt\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) out.push(m[2]!.replace(/\\'/g, "'").replace(/\\"/g, '"'));
  // text between tags in JSX that is not wrapped in t() is also user visible
  return out;
}

describe('Nova Plan English texts', () => {
  it('translates every literal passed to t()', () => {
    const dir = __dirname;
    const files = readdirSync(dir).filter((f) => /^(Dialogs|Views|Chart|Gantt|PlanApp)\.tsx$/.test(f));
    const seen = new Set<string>(['Material', 'Total']); // the same word in both languages
    const prev = getLocale();
    setLocale('en');
    try {
      const missing: string[] = [];
      for (const f of files)
        for (const s of literals(join(dir, f))) {
          if (seen.has(s)) continue;
          seen.add(s);
          if (t(s) === s && /[a-záéíóúñ]{3,}/i.test(s) && !/^[A-Z0-9 .,%:\-–/()+]+$/.test(s)) missing.push(s);
        }
      expect(missing.sort()).toEqual([]);
    } finally {
      setLocale(prev);
    }
  });
});
