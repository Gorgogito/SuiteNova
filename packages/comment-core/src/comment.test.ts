import { describe, expect, it } from 'vitest';
import {
  addThread, authorsOf, completeMention, count, deleteAll, deleteMessage, deleteThread, editMessage, filterThreads, findMentions, flatFromThreads, fullWhen, makeAuthor,
  mapAnchors, mentionQuery, mentionedAuthors, neighbor, reopen, reply, resolve, sortThreads, suggestMentions, threadsFromFlat, whenText, initialsOf, authorIdOf,
  type FlatComment, type Thread,
} from './index';

const ana = makeAuthor('Ana María Pérez');
const luis = makeAuthor('Luis');
const D = (m: number) => new Date(Date.UTC(2026, 10, 20, 10, m)).toISOString();

describe('people', () => {
  it('makes initials and a stable id from the name', () => {
    expect(initialsOf('Ana María Pérez')).toBe('AMP');
    expect(initialsOf('  luis ')).toBe('L');
    expect(initialsOf('a b c d e')).toBe('ABC');
    expect(authorIdOf('Ana  María')).toBe(authorIdOf('ana maria'));
    expect(makeAuthor('', '')).toMatchObject({ name: 'Autor', initials: 'A' });
    expect(makeAuthor('Luis', 'LT', 'p1')).toEqual({ id: 'p1', name: 'Luis', initials: 'LT' });
  });
  it('lists who wrote, once each, in order', () => {
    let l: Thread<number>[] = [];
    l = addThread(l, { anchor: 1, author: ana, text: 'a' }).list;
    l = addThread(l, { anchor: 2, author: luis, text: 'b' }).list;
    l = reply(l, l[0]!.id, luis, 'c');
    expect(authorsOf(l).map((a) => a.name)).toEqual(['Ana María Pérez', 'Luis']);
  });
});

describe('threads', () => {
  const start = () => {
    let l: Thread<{ at: number }>[] = [];
    const a = addThread(l, { anchor: { at: 5 }, author: ana, text: 'Revisar esto', date: D(0), id: 'k1' });
    l = a.list;
    l = addThread(l, { anchor: { at: 2 }, author: luis, text: 'Otra cosa', date: D(1), id: 'k2' }).list;
    return l;
  };
  it('adds a comment with its first message and replies in order', () => {
    let l = reply(start(), 'k1', luis, 'De acuerdo', D(5), 'r1');
    l = reply(l, 'k1', ana, 'Gracias', D(6), 'r2');
    expect(l[0]!.messages.map((m) => m.id)).toEqual(['k1', 'r1', 'r2']);
    expect(l[1]!.messages).toHaveLength(1);
  });
  it('resolves, answers a resolved thread (which opens it) and reopens', () => {
    let l = resolve(start(), 'k1', luis, D(9));
    expect(l[0]).toMatchObject({ resolved: true, resolvedBy: luis, resolvedAt: D(9) });
    l = reply(l, 'k1', ana, 'Una duda más', D(10));
    expect(l[0]!.resolved).toBe(false);
    expect(l[0]!.resolvedBy).toBeUndefined();
    l = resolve(l, 'k1');
    l = reopen(l, 'k1');
    expect(l[0]).toMatchObject({ resolved: false });
    expect('resolvedAt' in l[0]!).toBe(false);
    // reopening one that is open changes nothing
    expect(reopen(l, 'k1')).toEqual(l);
  });
  it('edits a message and notes when; the same text is not an edit', () => {
    let l = editMessage(start(), 'k1', 'Revisar esto otra vez', D(30));
    expect(l[0]!.messages[0]).toMatchObject({ text: 'Revisar esto otra vez', edited: D(30) });
    l = editMessage(l, 'k2', 'Otra cosa');
    expect(l[1]!.messages[0]!.edited).toBeUndefined();
    // the text of a comment just created (empty) is not an edit
    l = editMessage(addThread([], { anchor: { at: 1 }, author: ana, text: '', id: 'n' }).list, 'n', 'Primero', D(1));
    expect(l[0]!.messages[0]).toMatchObject({ text: 'Primero' });
    expect(l[0]!.messages[0]!.edited).toBeUndefined();
    // and the date of an edit goes there and back through a flat list
    const e = threadsFromFlat(flatFromThreads(editMessage(start(), 'k1', 'Otra', D(40))));
    expect(e[0]!.messages[0]!.edited).toBe(D(40));
  });
  it('deleting a reply keeps the thread; deleting the comment deletes it all', () => {
    let l = reply(start(), 'k1', luis, 'sí', D(2), 'r1');
    l = deleteMessage(l, 'r1');
    expect(l[0]!.messages).toHaveLength(1);
    l = reply(l, 'k1', luis, 'sí', D(2), 'r1');
    l = deleteMessage(l, 'k1');
    expect(l.map((t) => t.id)).toEqual(['k2']);
    expect(deleteThread(l, 'k2')).toEqual([]);
  });
  it('deletes all or only the resolved', () => {
    const l = resolve(start(), 'k2');
    expect(deleteAll(l, true).map((t) => t.id)).toEqual(['k1']);
    expect(deleteAll(l)).toEqual([]);
  });
  it('moves anchors and drops threads whose anchor is gone', () => {
    const l = mapAnchors(start(), (a) => (a.at === 2 ? null : { at: a.at + 10 }));
    expect(l.map((t) => [t.id, t.anchor.at])).toEqual([['k1', 15]]);
  });
  it('counts', () => {
    const l = resolve(reply(start(), 'k1', luis, 'x'), 'k2');
    expect(count(l)).toEqual({ threads: 2, open: 1, resolved: 1, messages: 3 });
  });
  it('filters by state, person and text (without case or accents)', () => {
    const l = resolve(reply(start(), 'k1', luis, 'Está bien', D(3)), 'k2');
    expect(filterThreads(l, { state: 'open' }).map((t) => t.id)).toEqual(['k1']);
    expect(filterThreads(l, { state: 'resolved' }).map((t) => t.id)).toEqual(['k2']);
    expect(filterThreads(l, { authorId: ana.id }).map((t) => t.id)).toEqual(['k1']);
    expect(filterThreads(l, { authorId: luis.id }).map((t) => t.id)).toEqual(['k1', 'k2']);
    expect(filterThreads(l, { text: 'ESTA BIEN' }).map((t) => t.id)).toEqual(['k1']);
    expect(filterThreads(l, { text: 'maria' }).map((t) => t.id)).toEqual(['k1']);
    expect(filterThreads(l, { state: 'all' })).toHaveLength(2);
  });
  it('sorts by the anchor the product uses, keeping ties in order', () => {
    const l = sortThreads(start(), (a, b) => a.at - b.at);
    expect(l.map((t) => t.id)).toEqual(['k2', 'k1']);
    const tie = sortThreads(mapAnchors(start(), () => ({ at: 1 })), (a, b) => a.at - b.at);
    expect(tie.map((t) => t.id)).toEqual(['k1', 'k2']);
  });
  it('goes to the next and previous thread, round the ends', () => {
    const l = start();
    expect(neighbor(l, 'k1', 1)!.id).toBe('k2');
    expect(neighbor(l, 'k2', 1)!.id).toBe('k1');
    expect(neighbor(l, 'k1', -1)!.id).toBe('k2');
    expect(neighbor(l, null, 1)!.id).toBe('k1');
    expect(neighbor(l, null, -1)!.id).toBe('k2');
    expect(neighbor([], 'x', 1)).toBeUndefined();
  });
  it('does not change what it was given', () => {
    const l = start();
    const copy = structuredClone(l);
    reply(l, 'k1', luis, 'x');
    resolve(l, 'k1');
    editMessage(l, 'k1', 'y');
    deleteMessage(l, 'k1');
    expect(l).toEqual(copy);
  });
});

describe('flat lists (how every Office file holds them)', () => {
  const flat = (id: string, parent: string | null, date: string, extra: Partial<FlatComment<number>> = {}): FlatComment<number> => ({ id, author: ana, date, text: id, parent, anchor: 7, ...extra });
  it('builds threads: comment first, answers by date, anchor from the comment', () => {
    const t = threadsFromFlat([flat('a', null, D(0)), flat('c', 'a', D(5)), flat('b', 'a', D(2)), flat('z', null, D(9), { anchor: 3 })]);
    expect(t.map((x) => x.id)).toEqual(['a', 'z']);
    expect(t[0]!.messages.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(t[1]!.anchor).toBe(3);
  });
  it('joins an answer to an answer with the first comment, and keeps an orphan as a comment', () => {
    const t = threadsFromFlat([flat('a', null, D(0)), flat('b', 'a', D(1)), flat('c', 'b', D(2)), flat('o', 'missing', D(3))]);
    expect(t.map((x) => [x.id, x.messages.map((m) => m.id)])).toEqual([['a', ['a', 'b', 'c']], ['o', ['o']]]);
  });
  it('survives a loop in a damaged file', () => {
    const t = threadsFromFlat([flat('a', 'b', D(0)), flat('b', 'a', D(1))]);
    expect(t.reduce((n, x) => n + x.messages.length, 0)).toBe(2);
  });
  it('reads resolved from the comment (or from a reply that carries it)', () => {
    expect(threadsFromFlat([flat('a', null, D(0), { resolved: true }), flat('b', 'a', D(1))])[0]!.resolved).toBe(true);
    expect(threadsFromFlat([flat('a', null, D(0)), flat('b', 'a', D(1), { resolved: true })])[0]!.resolved).toBe(true);
    expect(threadsFromFlat([flat('a', null, D(0)), flat('b', 'a', D(1))])[0]!.resolved).toBe(false);
  });
  it('goes there and back', () => {
    let l: Thread<number>[] = addThread([], { anchor: 4, author: ana, text: 'hola', date: D(0), id: 'a' }).list;
    l = reply(l, 'a', luis, 'ok', D(1), 'b');
    l = resolve(l, 'a');
    const f = flatFromThreads(l);
    expect(f.map((x) => [x.id, x.parent, x.resolved ?? false])).toEqual([['a', null, true], ['b', 'a', true]]);
    const back = threadsFromFlat(f);
    expect(back).toEqual([{ id: 'a', anchor: 4, messages: l[0]!.messages, resolved: true }]);
  });
});

describe('mentions', () => {
  const people = [ana, luis, makeAuthor('Ana')];
  it('finds @Name, the longest name first, ignoring case and accents', () => {
    const m = findMentions('Hola @ana maría pérez, mira esto @LUIS y @Ana.', people);
    expect(m.map((x) => x.author.name)).toEqual(['Ana María Pérez', 'Luis', 'Ana']);
    expect(findMentions('a@luis.com', people)).toEqual([]);
    expect(findMentions('@Luisa', people)).toEqual([]);
    expect(findMentions('@desconocido', people)).toEqual([]);
  });
  it('lists each mentioned person once', () => {
    expect(mentionedAuthors('@Luis @luis y @Luis', people).map((a) => a.name)).toEqual(['Luis']);
  });
  it('knows when the caret is in a mention being typed, and suggests and completes', () => {
    expect(mentionQuery('Hola @Lu', 8)).toEqual({ query: 'Lu', start: 5 });
    expect(mentionQuery('Hola Lu', 7)).toBeNull();
    expect(mentionQuery('correo a@b', 10)).toBeNull();
    expect(mentionQuery('@a\nb', 4)).toBeNull();
    expect(suggestMentions('lu', people).map((a) => a.name)).toEqual(['Luis']);
    expect(suggestMentions('maria', people).map((a) => a.name)).toEqual(['Ana María Pérez']);
    expect(suggestMentions('', people)).toHaveLength(3);
    expect(completeMention('Hola @Lu y más', 8, luis)).toEqual({ text: 'Hola @Luis  y más', caret: 11 });
    expect(completeMention('sin mención', 3, luis)).toBeNull();
  });
});

describe('when', () => {
  const now = new Date(Date.UTC(2026, 10, 20, 12, 0));
  it('says it as a person would', () => {
    expect(whenText(new Date(now.getTime() - 10_000).toISOString(), now)).toBe('ahora');
    expect(whenText(new Date(now.getTime() - 5 * 60_000).toISOString(), now)).toBe('hace 5 minutos');
    expect(whenText(new Date(now.getTime() - 3 * 3_600_000).toISOString(), now)).toBe('hace 3 horas');
    expect(whenText(new Date(now.getTime() - 86_400_000).toISOString(), now)).toBe('ayer');
    expect(whenText(new Date(now.getTime() - 30 * 86_400_000).toISOString(), now)).toMatch(/oct/);
    expect(whenText(new Date(Date.UTC(2024, 0, 5)).toISOString(), now)).toMatch(/2024/);
    expect(whenText('no es una fecha', now)).toBe('');
    expect(fullWhen(now.toISOString())).toMatch(/2026/);
  });
});
