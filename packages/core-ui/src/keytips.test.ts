import { describe, expect, it } from 'vitest';
import { assignKeytips, typeKeytip, type KeytipState } from './keytips';

describe('assignKeytips', () => {
  it('honours preferred tips and derives the rest from labels', () => {
    const m = assignKeytips([
      { id: 'home', label: 'Inicio', preferred: 'I' },
      { id: 'insert', label: 'Insertar' },
      { id: 'view', label: 'Vista' },
    ]);
    expect(m.get('home')).toBe('I');
    expect(m.get('insert')).toBe('N'); // I is taken, next free letter of "Insertar"
    expect(m.get('view')).toBe('V');
  });

  it('is accent-insensitive', () => {
    expect(assignKeytips([{ id: 'a', label: 'Árbol' }]).get('a')).toBe('A');
  });

  it('never yields duplicate or prefix-conflicting tips', () => {
    const labels = ['Copiar', 'Cortar', 'Pegar', 'Colar', 'Cursiva', 'Centrar', 'Cerrar', 'Cambiar', 'Cifrar', 'Citar', 'Ccc'];
    const m = assignKeytips(labels.map((label) => ({ id: label, label })));
    const tips = [...m.values()];
    expect(tips).toHaveLength(labels.length);
    for (const a of tips) for (const b of tips) if (a !== b) expect(b.startsWith(a)).toBe(false);
  });

  it('falls back to digits and two-letter tips when letters run out', () => {
    const m = assignKeytips([
      { id: '1', label: 'A' },
      { id: '2', label: 'A' },
      { id: '3', label: 'A' },
    ]);
    expect(new Set(m.values()).size).toBe(3);
  });
});

describe('typeKeytip', () => {
  const hits: string[] = [];
  const targets = [
    { tip: 'H', activate: () => hits.push('H') },
    { tip: 'FA', activate: () => hits.push('FA') },
    { tip: 'FB', activate: () => hits.push('FB') },
  ];
  const tabs: KeytipState = { level: 'tabs', buffer: '' };
  const done = () => ({ level: 'off' }) as KeytipState;

  it('activates an exact match', () => {
    const r = typeKeytip(tabs, 'h', targets, done);
    expect(r.state.level).toBe('off');
    expect(r.consumed).toBe(true);
  });
  it('buffers a prefix of a longer tip', () => {
    const r = typeKeytip(tabs, 'f', targets, done);
    expect(r.state).toEqual({ level: 'tabs', buffer: 'F' });
    expect(typeKeytip(r.state, 'b', targets, done).state.level).toBe('off');
  });
  it('swallows unknown keys without changing state', () => {
    const r = typeKeytip(tabs, 'z', targets, done);
    expect(r.state).toBe(tabs);
    expect(r.consumed).toBe(true);
  });
  it('ignores input while off', () => {
    expect(typeKeytip({ level: 'off' }, 'h', targets, done).consumed).toBe(false);
  });
});
