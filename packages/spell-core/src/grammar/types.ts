import type { SpellLang } from '../languages';

export type IssueCategory = 'grammar' | 'punctuation' | 'style';

/** Un cambio de texto: sustituye `[start, end)` por `text` (con `start === end` es una inserción). */
export interface Fix {
  /** Lo que se muestra en el menú (por defecto, el texto nuevo). */
  label?: string;
  start: number;
  end: number;
  text: string;
}

export interface GrammarIssue {
  rule: string;
  category: IssueCategory;
  /** Lo que se subraya. */
  start: number;
  end: number;
  message: string;
  fixes: Fix[];
}

export interface RuleInfo {
  id: string;
  category: IssueCategory;
  label: string;
  description: string;
  /** `all` sirve a cualquier idioma; `es` y `en` solo a ese idioma. */
  family: 'all' | 'es' | 'en';
  /** Si está activa mientras no se diga otra cosa. */
  defaultOn: boolean;
}

export interface GrammarOptions {
  lang: SpellLang;
  /** Identificadores de las reglas que no se aplican. */
  disabled?: Iterable<string>;
  /** Reglas opcionales que sí se aplican (las que no están activas por omisión, como `long-sentence`). */
  enabled?: Iterable<string>;
  /** Si la primera letra del texto debe ser mayúscula (para texto que ya empieza a mitad de frase, `false`). Por defecto, sí. */
  startOfText?: boolean;
  /** A partir de cuántas palabras una frase es «muy larga» (regla opcional). */
  longSentenceWords?: number;
}

export interface Ctx {
  text: string;
  family: 'es' | 'en';
  startOfText: boolean;
  longSentenceWords: number;
}

export type Rule = (ctx: Ctx, out: GrammarIssue[]) => void;

export const isUpperCh = (c: string): boolean => c !== c.toLowerCase();
export const capitalize = (w: string): string => (w ? w[0]!.toUpperCase() + w.slice(1) : w);

/** Pasa a `rep` la forma de mayúsculas de `src` (Casa → Hogar, CASA → HOGAR, casa → hogar). */
export function matchCase(src: string, rep: string): string {
  if (src.length > 1 && src === src.toUpperCase() && src !== src.toLowerCase()) return rep.toUpperCase();
  if (src[0] && src[0] !== src[0].toLowerCase()) return capitalize(rep);
  return rep;
}

/** Texto sin espacios que rodea la posición `i` (una «ficha»): sirve para no tocar direcciones, rutas y código. */
export function tokenAt(text: string, i: number): string {
  let a = i;
  let b = i;
  while (a > 0 && !/\s/.test(text[a - 1]!)) a--;
  while (b < text.length && !/\s/.test(text[b]!)) b++;
  return text.slice(a, b);
}

/** Si una ficha parece una dirección, una ruta, un parámetro o un correo (no se le aplican las reglas de puntuación). */
export const looksTechnical = (token: string): boolean => /[/\\=&@]|:\/\/|^www\./i.test(token) || /^[a-z]+:[^\s]*\d/.test(token);
