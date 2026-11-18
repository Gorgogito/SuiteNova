import { autoCorrectTyped, loadAutoCorrectFrom, saveAutoCorrectTo, type AutoCorrectOptions, type TypedResult } from '@suitenova/spell-core';

const store = (): Storage | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

let cache: AutoCorrectOptions | null = null;
let raw: string | null | undefined;

/** Las opciones de autocorrección: una sola lista para todos los productos. Se vuelven a leer si otra pestaña o el cuadro de Writer las cambian. */
export function getAutoCorrect(): AutoCorrectOptions {
  let now: string | null = null;
  try {
    now = store()?.getItem('nova.writer.autocorrect') ?? null;
  } catch {
    /* sin almacenamiento */
  }
  if (!cache || now !== raw) {
    cache = loadAutoCorrectFrom(store());
    raw = now;
  }
  return cache;
}

export function setAutoCorrect(o: AutoCorrectOptions): void {
  saveAutoCorrectTo(store(), o);
  cache = null;
}

/** Autocorrección de un campo de texto sin formato al escribir (con las opciones compartidas). */
export const autoCorrectField = (prev: string, next: string, caret: number, override: Partial<AutoCorrectOptions> = {}): TypedResult | null => autoCorrectTyped(prev, next, caret, { ...getAutoCorrect(), ...override });
