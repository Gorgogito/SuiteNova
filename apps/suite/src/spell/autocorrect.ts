import { defaultMathAutoCorrect, setMathAutoCorrect } from '@suitenova/math-core';
import { autoCorrectTyped, loadAutoCorrectFrom, loadMathListFrom, saveAutoCorrectTo, saveMathListTo, type AutoCorrectOptions, type TypedResult } from '@suitenova/spell-core';

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

/** La lista de autocorrección matemática vigente (la guardada, o la de fábrica de Ecuaciones). */
export function getMathList(): Record<string, string> {
  return loadMathListFrom(store()) ?? defaultMathAutoCorrect();
}

/** Guarda la lista matemática y la pone a trabajar en el editor de ecuaciones (`null`: la de fábrica). */
export function setMathList(list: Record<string, string> | null): void {
  saveMathListTo(store(), list);
  setMathAutoCorrect(list);
}

// Lo guardado vale desde el arranque: el editor de ecuaciones lee la lista del usuario antes de que se abra ningún cuadro.
setMathAutoCorrect(loadMathListFrom(store()));
