import { describe, expect, it } from 'vitest';
import type { CommentData } from '@suitenova/writer-core';
import { fromThreads, toThreads } from './comment-adapter';

const c = (id: string, parent: string | null, extra: Partial<CommentData> = {}): CommentData => ({ id, author: 'Ana', initials: 'A', date: `2026-11-20T10:0${id.length}:00Z`, text: id, parent, done: false, ...extra });

describe('Writer comments as threads', () => {
  it('groups replies under their comment and orders by where the text is (text gone last)', () => {
    const list = [c('a', null), c('b', 'a'), c('z', null), c('y', null)];
    const ranges = new Map([['z', { from: 3, to: 5 }], ['a', { from: 9, to: 12 }]]);
    const t = toThreads(list, ranges);
    expect(t.map((x) => x.id)).toEqual(['z', 'a', 'y']);
    expect(t[1]!.messages.map((m) => m.id)).toEqual(['a', 'b']);
    expect(t[2]!.anchor.from).toBeNull();
  });
  it('goes back to the same list the .docx holds (resolved on every message, edit date kept)', () => {
    const list = [c('a', null, { done: true }), c('b', 'a', { done: true, edited: '2026-11-21T00:00:00Z' })];
    expect(fromThreads(toThreads(list))).toEqual(list);
  });
  it('keeps the initials a person wrote with', () => {
    expect(fromThreads(toThreads([c('a', null, { author: 'Ana María', initials: 'XY' })]))[0]).toMatchObject({ author: 'Ana María', initials: 'XY' });
  });
});
