import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry, formatShortcut, matchesShortcut, parseShortcut } from './commands';

const key = (init: Partial<KeyboardEventInit> & { key: string }) => new KeyboardEvent('keydown', { cancelable: true, ...init });

describe('parseShortcut', () => {
  it('parses modifiers and key', () => {
    expect(parseShortcut('Ctrl+Shift+S')).toEqual({ ctrl: true, shift: true, alt: false, key: 's' });
    expect(parseShortcut('Alt+Q')).toEqual({ ctrl: false, shift: false, alt: true, key: 'q' });
  });
  it('handles aliases and the plus key', () => {
    expect(parseShortcut('Ctrl+F1').key).toBe('f1');
    expect(parseShortcut('Esc').key).toBe('escape');
    expect(parseShortcut('Ctrl++').key).toBe('+');
    expect(parseShortcut('Ctrl+Minus').key).toBe('-');
  });
});

describe('matchesShortcut', () => {
  it('requires exact modifiers', () => {
    const s = parseShortcut('Ctrl+B');
    expect(matchesShortcut(key({ key: 'b', ctrlKey: true }), s)).toBe(true);
    expect(matchesShortcut(key({ key: 'B', ctrlKey: true }), s)).toBe(true);
    expect(matchesShortcut(key({ key: 'b' }), s)).toBe(false);
    expect(matchesShortcut(key({ key: 'b', ctrlKey: true, shiftKey: true }), s)).toBe(false);
  });
  it('accepts Ctrl+= and Ctrl++ for zoom in', () => {
    const s = parseShortcut('Ctrl++');
    expect(matchesShortcut(key({ key: '=', ctrlKey: true }), s)).toBe(true);
    expect(matchesShortcut(key({ key: '+', ctrlKey: true, shiftKey: true }), s)).toBe(true);
  });
  it('treats Cmd as Ctrl', () => {
    expect(matchesShortcut(key({ key: 'z', metaKey: true }), parseShortcut('Ctrl+Z'))).toBe(true);
  });
});

describe('formatShortcut', () => {
  it('keeps a trailing plus key', () => {
    expect(formatShortcut('Ctrl++')).toBe('Ctrl++');
    expect(formatShortcut('Ctrl+S')).toBe('Ctrl+S');
  });
});

describe('CommandRegistry', () => {
  it('runs enabled commands and ignores disabled ones', () => {
    const r = new CommandRegistry();
    const run = vi.fn();
    r.register({ id: 'a', label: 'A', run });
    r.register({ id: 'b', label: 'B', run, enabled: () => false });
    expect(r.run('a')).toBe(true);
    expect(r.run('b')).toBe(false);
    expect(r.run('missing')).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers on register, run and invalidate', () => {
    const r = new CommandRegistry();
    const fn = vi.fn();
    r.subscribe(fn);
    r.register({ id: 'a', label: 'A', run: () => {} });
    r.run('a');
    r.invalidate();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('dispatches keyboard shortcuts and prevents default', () => {
    const r = new CommandRegistry();
    const run = vi.fn();
    r.register({ id: 'save', label: 'Save', shortcut: ['Ctrl+S', 'Shift+F12'], run });
    const e = key({ key: 's', ctrlKey: true });
    expect(r.handleKeyEvent(e)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(r.handleKeyEvent(key({ key: 'F12', shiftKey: true }))).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    expect(r.handleKeyEvent(key({ key: 'x', ctrlKey: true }))).toBe(false);
  });

  it('does not dispatch shortcuts of disabled commands', () => {
    const r = new CommandRegistry();
    const run = vi.fn();
    r.register({ id: 'x', label: 'X', shortcut: 'Ctrl+X', run, enabled: () => false });
    expect(r.handleKeyEvent(key({ key: 'x', ctrlKey: true }))).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('unregisters', () => {
    const r = new CommandRegistry();
    const off = r.register({ id: 'a', label: 'A', run: () => {} });
    off();
    expect(r.get('a')).toBeUndefined();
  });

  it('searches ignoring case and accents, ranking prefix matches first', () => {
    const r = new CommandRegistry();
    r.registerAll([
      { id: 'dark', label: 'Tema oscuro', run: () => {} },
      { id: 'light', label: 'Tema claro', run: () => {} },
      { id: 'ribbon', label: 'Contraer la cinta', description: 'Oculta los temas de la cinta', run: () => {} },
      { id: 'off', label: 'Tema apagado', run: () => {}, enabled: () => false },
    ]);
    expect(r.search('OSCURO').map((c) => c.id)).toEqual(['dark']);
    expect(r.search('tema').map((c) => c.id)).toEqual(['light', 'dark', 'ribbon']);
    expect(r.search('')).toEqual([]);
    expect(r.search('contráer').map((c) => c.id)).toEqual(['ribbon']);
    expect(r.search('contraer').map((c) => c.id)).toEqual(['ribbon']);
  });
});
