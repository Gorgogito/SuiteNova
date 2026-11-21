/** The language tag a voice is asked for, from the tag a document keeps for a run (`es`, `en`, `es-MX`, `en_GB`…); `fallback` when there is none. */
export function speechLang(tag: string | null | undefined, fallback: string): string {
  const t = (tag ?? '').trim().replace('_', '-');
  if (!t) return fallback;
  const l = t.toLowerCase();
  if (l === 'es') return 'es-ES';
  if (l === 'en') return 'en-US';
  return t;
}
