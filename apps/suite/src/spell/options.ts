import { loadReviewOptions, saveReviewOptions, type ReviewOptions } from '@suitenova/spell-core';

const store = (): Storage | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

let current: ReviewOptions | null = null;
const listeners = new Set<() => void>();

/** Las opciones de revisión: una sola para todos los productos, guardadas en el navegador. */
export function getReviewOptions(): ReviewOptions {
  return (current ??= loadReviewOptions(store()));
}

export function setReviewOptions(patch: Partial<ReviewOptions>): void {
  current = { ...getReviewOptions(), ...patch };
  saveReviewOptions(store(), current);
  for (const l of [...listeners]) l();
}

/** Avisa cuando cambian las opciones (para volver a subrayar). Devuelve la función que deja de avisar. */
export function onReviewOptions(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Avisa de que algo cambió en la revisión (palabras omitidas o agregadas) y hay que volver a subrayar. */
export function notifyReview(): void {
  for (const l of [...listeners]) l();
}

/** Cada vez que cambian las opciones sube el número (para que las cachés sepan que ya no valen). */
export const reviewOptionsKey = (o: ReviewOptions = getReviewOptions()): string => JSON.stringify(o);

// «Ignorar una vez»: lo que la persona pasó por alto en esta sesión (clave = regla + texto + contexto, no la posición).
const ignoredOnce = new Set<string>();
export const isIgnoredOnce = (key: string): boolean => ignoredOnce.has(key);
export function ignoreOnce(key: string): void {
  ignoredOnce.add(key);
  for (const l of [...listeners]) l();
}
/** «Volver a revisar»: lo omitido una vez vuelve a marcarse. */
export function resetIgnored(): void {
  ignoredOnce.clear();
  for (const l of [...listeners]) l();
}
