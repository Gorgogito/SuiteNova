export interface KeytipRequest {
  id: string;
  /** Localised text the tip is derived from. */
  label: string;
  /** Desired tip; honoured if still free. */
  preferred?: string;
}

function letters(label: string): string[] {
  return label
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .split('');
}

/**
 * Assign unique, prefix-free keytips (like Office's Alt-key navigation).
 * Preferred tips win, then the first free letter of the label, then digits,
 * then two-letter combos. A tip never is a prefix of another one.
 */
export function assignKeytips(requests: KeytipRequest[]): Map<string, string> {
  const result = new Map<string, string>();
  const taken = new Set<string>();
  const conflicts = (tip: string) => [...taken].some((o) => o.startsWith(tip) || tip.startsWith(o));

  for (const r of requests) {
    const p = r.preferred?.toUpperCase();
    if (p && !conflicts(p)) {
      result.set(r.id, p);
      taken.add(p);
    }
  }
  for (const r of requests) {
    if (result.has(r.id)) continue;
    const candidates = [...new Set(letters(r.label))];
    let tip = candidates.find((c) => !conflicts(c));
    if (!tip) tip = '123456789'.split('').find((d) => !conflicts(d));
    if (!tip) {
      const first = candidates[0] ?? 'Z';
      for (const second of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        if (!conflicts(first + second)) {
          tip = first + second;
          break;
        }
      }
    }
    if (tip) {
      result.set(r.id, tip);
      taken.add(tip);
    }
  }
  return result;
}

export type KeytipState =
  | { level: 'off' }
  | { level: 'tabs'; buffer: string }
  | { level: 'items'; tabId: string; buffer: string };

export const KEYTIPS_OFF: KeytipState = { level: 'off' };

export interface KeytipTarget {
  tip: string;
  activate: () => void;
}

/** Pure transition for a typed character; returns the new state and whether it was consumed. */
export function typeKeytip(
  state: KeytipState,
  char: string,
  targets: KeytipTarget[],
  onActivate: (t: KeytipTarget) => KeytipState,
): { state: KeytipState; consumed: boolean } {
  if (state.level === 'off') return { state, consumed: false };
  const buffer = (state.buffer + char).toUpperCase();
  const exact = targets.find((t) => t.tip === buffer);
  if (exact) return { state: onActivate(exact), consumed: true };
  if (targets.some((t) => t.tip.startsWith(buffer))) {
    return { state: { ...state, buffer }, consumed: true };
  }
  return { state, consumed: true };
}
