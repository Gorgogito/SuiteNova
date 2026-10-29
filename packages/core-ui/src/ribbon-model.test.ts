import { describe, expect, it } from 'vitest';
import { layoutGroup, type RibbonItem } from './ribbon-model';

const btn = (command: string, size?: 'large' | 'small'): RibbonItem => ({ kind: 'button', command, size });

describe('layoutGroup', () => {
  it('stacks small buttons three per column', () => {
    const cols = layoutGroup([btn('a'), btn('b'), btn('c'), btn('d')]);
    expect(cols.map((c) => c.kind)).toEqual(['stack', 'stack']);
    expect(cols[0]?.kind === 'stack' && cols[0].items).toHaveLength(3);
  });
  it('gives large buttons their own column and flushes pending stacks', () => {
    const cols = layoutGroup([btn('a'), btn('b'), btn('L', 'large'), btn('c')]);
    expect(cols.map((c) => c.kind)).toEqual(['stack', 'large', 'stack']);
  });
  it('keeps separators and custom items as their own columns', () => {
    const cols = layoutGroup([
      btn('a'),
      { kind: 'separator' },
      { kind: 'custom', id: 'x', label: 'X', render: () => null },
      btn('b'),
    ]);
    expect(cols.map((c) => c.kind)).toEqual(['stack', 'separator', 'custom', 'stack']);
  });
  it('returns nothing for an empty group', () => {
    expect(layoutGroup([])).toEqual([]);
  });
});
