export interface Voice {
  /** What the system calls it (unique in practice). */
  name: string;
  /** BCP 47, as the system writes it (`es-ES`, `es_MX`, `en-US`). */
  lang: string;
  /** Installed in the computer (no connection needed). */
  local: boolean;
}

const norm = (l: string): string => l.replace('_', '-').toLowerCase();
const primary = (l: string): string => norm(l).split('-')[0]!;

/** How well a voice fits a language: 3 the very same, 2 the same language and the same region family, 1 the same language, 0 another one. */
export function fit(voice: Voice, lang: string): 0 | 1 | 2 | 3 {
  const v = norm(voice.lang);
  const l = norm(lang);
  if (v === l) return 3;
  if (primary(v) !== primary(l)) return 0;
  // Spanish of Latin America is understood with a voice of Spain when there is none of its own, and the other way round: same language, other region
  return l.includes('-') && v.includes('-') && v.split('-')[1] === l.split('-')[1] ? 2 : 1;
}

/**
 * The voice to read a text in `lang`: the one the person chose for that language when it is still there, else the best fit (the very same language
 * before another region of it, one in the computer before one that needs a connection), else none.
 */
export function pickVoice(voices: readonly Voice[], lang: string, preferred?: string | null): Voice | null {
  const chosen = preferred ? voices.find((v) => v.name === preferred) : undefined;
  if (chosen && fit(chosen, lang) > 0) return chosen;
  let best: Voice | null = null;
  let bs = 0;
  for (const v of voices) {
    const s = fit(v, lang) * 2 + (v.local ? 1 : 0);
    if (fit(v, lang) > 0 && s > bs) [best, bs] = [v, s];
  }
  return best;
}

/** The languages the voices can read (primary tags, in the order they first appear). */
export const languagesOf = (voices: readonly Voice[]): string[] => [...new Set(voices.map((v) => primary(v.lang)))];
