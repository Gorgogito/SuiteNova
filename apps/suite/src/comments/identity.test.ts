import { describe, expect, it } from 'vitest';
import { getUser, savedUser, setUser, USER_KEY } from './identity';

const fake = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('one user name for the whole suite', () => {
  it('is «Autor» until a name is given, and savedUser says so', () => {
    const s = fake();
    expect(savedUser(s)).toBeNull();
    expect(getUser(s)).toMatchObject({ name: 'Autor', initials: 'A' });
  });
  it('keeps the name, the initials and a stable id', () => {
    const s = fake();
    const a = setUser({ name: ' Ana María Pérez ' }, s);
    expect(a).toMatchObject({ name: 'Ana María Pérez', initials: 'AMP' });
    expect(getUser(s)).toEqual(a);
    expect(setUser({ name: 'Ana', initials: 'xx' }, s).initials).toBe('xx');
    expect(JSON.parse(s.m.get(USER_KEY)!)).toMatchObject({ name: 'Ana', initials: 'xx' });
  });
  it('reads the name each product kept before, so nobody types it again', () => {
    expect(getUser(fake({ 'nova.writer.user': JSON.stringify({ name: 'Luis', initials: 'LT' }) }))).toMatchObject({ name: 'Luis', initials: 'LT' });
    expect(getUser(fake({ 'nova.author': 'Marta' })).name).toBe('Marta');
    expect(getUser(fake({ 'nova.slides.commentAuthor': 'Pablo' })).name).toBe('Pablo');
    // the shared one wins over the old ones
    expect(getUser(fake({ [USER_KEY]: JSON.stringify({ name: 'Nueva' }), 'nova.author': 'Vieja' })).name).toBe('Nueva');
  });
  it('survives damaged storage and storage that fails', () => {
    expect(getUser(fake({ [USER_KEY]: '{no', 'nova.author': 'Marta' })).name).toBe('Marta');
    expect(getUser(fake({ 'nova.writer.user': 'no es json' })).name).toBe('Autor');
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(getUser(broken).name).toBe('Autor');
    expect(setUser({ name: 'Ana' }, broken).name).toBe('Ana');
    expect(getUser(null).name).toBe('Autor');
  });
});
