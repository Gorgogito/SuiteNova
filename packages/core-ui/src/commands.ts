import { t } from './i18n';

export interface CommandDef {
  id: string;
  /** i18n key or literal text. */
  label: string;
  description?: string;
  /** Icon name from the icon registry. */
  icon?: string;
  /** e.g. "Ctrl+Shift+S". Several alternatives allowed. */
  shortcut?: string | string[];
  /** Shown in tooltips but not bound (for shortcuts handled natively, e.g. Ctrl+C). */
  hint?: string;
  run: () => void;
  enabled?: () => boolean;
  checked?: () => boolean;
}

export interface ParsedShortcut {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  del: 'delete',
  space: ' ',
  plus: '+',
  minus: '-',
  return: 'enter',
};

export function parseShortcut(spec: string): ParsedShortcut {
  const result: ParsedShortcut = { ctrl: false, shift: false, alt: false, key: '' };
  // "Ctrl++" splits into a trailing empty part, which means the "+" key.
  const parts = spec.split('+').map((p) => p.trim().toLowerCase());
  parts.forEach((p, i) => {
    if (p === 'ctrl' || p === 'cmd' || p === 'mod') result.ctrl = true;
    else if (p === 'shift') result.shift = true;
    else if (p === 'alt') result.alt = true;
    else if (p === '' && i === parts.length - 1 && i > 0) result.key = '+';
    else if (p !== '') result.key = KEY_ALIASES[p] ?? p;
  });
  return result;
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

export function matchesShortcut(e: KeyLike, s: ParsedShortcut): boolean {
  if ((e.ctrlKey || e.metaKey) !== s.ctrl) return false;
  if (e.altKey !== s.alt) return false;
  const key = e.key.toLowerCase();
  if (s.key === '+') {
    // "+" is Shift+"=" on many layouts; accept both without requiring a specific shift state.
    return key === '+' || key === '=';
  }
  if (e.shiftKey !== s.shift) return false;
  return key === s.key;
}

export function formatShortcut(spec: string): string {
  return spec
    .split('+')
    .map((p) => p.trim())
    .map((p, i, arr) => (p === '' && i === arr.length - 1 ? '+' : p))
    .filter((p) => p !== '')
    .join('+');
}

export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export class CommandRegistry {
  private commands = new Map<string, CommandDef>();
  private parsed = new Map<string, ParsedShortcut[]>();
  private listeners = new Set<() => void>();
  private version = 0;

  register(def: CommandDef): () => void {
    this.commands.set(def.id, def);
    const shortcuts = def.shortcut == null ? [] : Array.isArray(def.shortcut) ? def.shortcut : [def.shortcut];
    this.parsed.set(def.id, shortcuts.map(parseShortcut));
    this.notify();
    return () => {
      if (this.commands.get(def.id) === def) {
        this.commands.delete(def.id);
        this.parsed.delete(def.id);
        this.notify();
      }
    };
  }

  registerAll(defs: CommandDef[]): () => void {
    const offs = defs.map((d) => this.register(d));
    return () => offs.forEach((o) => o());
  }

  get(id: string): CommandDef | undefined {
    return this.commands.get(id);
  }

  all(): CommandDef[] {
    return [...this.commands.values()];
  }

  isEnabled(id: string): boolean {
    const c = this.commands.get(id);
    return !!c && (c.enabled ? c.enabled() : true);
  }

  isChecked(id: string): boolean {
    return this.commands.get(id)?.checked?.() ?? false;
  }

  run(id: string): boolean {
    const c = this.commands.get(id);
    if (!c || !this.isEnabled(id)) return false;
    c.run();
    this.invalidate();
    return true;
  }

  /** Call when external state that enabled()/checked() depend on has changed. */
  invalidate(): void {
    this.notify();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getVersion = (): number => this.version;

  shortcutLabel(id: string): string | undefined {
    const c = this.commands.get(id);
    if (!c?.shortcut) return c?.hint;
    return formatShortcut(Array.isArray(c.shortcut) ? (c.shortcut[0] ?? '') : c.shortcut);
  }

  /** Dispatch a keyboard event. Returns true when a command handled it. */
  handleKeyEvent(e: KeyboardEvent): boolean {
    if (e.defaultPrevented) return false;
    for (const [id, shortcuts] of this.parsed) {
      if (shortcuts.some((s) => matchesShortcut(e, s)) && this.isEnabled(id)) {
        e.preventDefault();
        this.run(id);
        return true;
      }
    }
    return false;
  }

  /** Accent- and case-insensitive search over label and description ("Tell me"). */
  search(query: string, limit = 8): CommandDef[] {
    const q = normalizeText(query.trim());
    if (!q) return [];
    const scored: { c: CommandDef; score: number }[] = [];
    for (const c of this.commands.values()) {
      if (!this.isEnabled(c.id)) continue;
      const label = normalizeText(t(c.label));
      const desc = normalizeText(c.description ? t(c.description) : '');
      let score = -1;
      if (label.startsWith(q)) score = 3;
      else if (label.split(/\s+/).some((w) => w.startsWith(q))) score = 2;
      else if (label.includes(q)) score = 1;
      else if (desc.includes(q)) score = 0;
      if (score >= 0) scored.push({ c, score });
    }
    scored.sort((a, b) => b.score - a.score || t(a.c.label).localeCompare(t(b.c.label)));
    return scored.slice(0, limit).map((s) => s.c);
  }

  private notify(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }
}
