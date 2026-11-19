/**
 * Datos de la autocorrección que vienen de fábrica, por idioma: la lista de reemplazos (como la que trae Office) y las excepciones.
 * La lista y las excepciones son por idioma (español e inglés), como los archivos `.acl` de Office; el español de España, México y Perú
 * comparten las del español.
 */

export type AutoLang = 'es' | 'en';

export const AUTO_LANGS: { id: AutoLang; label: string }[] = [
  { id: 'es', label: 'Español' },
  { id: 'en', label: 'English' },
];

export const isAutoLang = (x: unknown): x is AutoLang => x === 'es' || x === 'en';

/** El idioma de autocorrección que corresponde a un idioma de revisión o etiqueta BCP 47 (`es-MX`, `en-GB`…); el español si no se conoce. */
export function autoLangOf(lang: string | null | undefined): AutoLang {
  return (lang ?? '').toLowerCase().startsWith('en') ? 'en' : 'es';
}

/** Las tres listas de excepciones de Office («Excepciones de Autocorrección»). */
export interface AutoExceptions {
  /** Abreviaturas tras las que la palabra siguiente no empieza con mayúscula (`Sr.`, `etc.`). Sin el punto final. */
  firstLetter: string[];
  /** Palabras que pueden llevar dos mayúsculas iniciales sin corregirse (`PCs`, `IDentidad`). */
  twoInitialCaps: string[];
  /** Palabras que no se corrigen nunca (ni por la lista, ni por las mayúsculas). */
  other: string[];
}

const ES_ABBR = ['etc', 'sr', 'sra', 'srta', 'dr', 'dra', 'pág', 'págs', 'ud', 'uds', 'aprox', 'núm', 'tel', 'av', 'pp', 'vol', 'cap', 'fig', 'ej', 'p.ej', 'ee', 'uu', 'vs', 'cf', 'ibid', 'no', 'dpto', 'admón', 'atte', 'cía', 'ca', 'cta', 'ed', 'edit', 'ing', 'lic', 'prof', 'tít'];
const EN_ABBR = ['etc', 'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'cf', 'ibid', 'no', 'fig', 'vol', 'ch', 'pp', 'approx', 'dept', 'inc', 'ltd', 'co', 'e.g', 'i.e', 'a.m', 'p.m'];

/** Las excepciones de fábrica de un idioma. */
export function defaultExceptions(lang: AutoLang): AutoExceptions {
  return { firstLetter: [...(lang === 'en' ? EN_ABBR : ES_ABBR)], twoInitialCaps: [], other: [] };
}

const ES_LIST: Record<string, string> = {
  tambien: 'también',
  despues: 'después',
  ademas: 'además',
  aqui: 'aquí',
  alli: 'allí',
  ahi: 'ahí',
  asi: 'así',
  porfavor: 'por favor',
  esque: 'es que',
  enserio: 'en serio',
  apesar: 'a pesar',
  sinembargo: 'sin embargo',
  osea: 'o sea',
  atravez: 'a través',
  aora: 'ahora',
  haver: 'haber',
  nesesito: 'necesito',
  nesesario: 'necesario',
  derrepente: 'de repente',
  talvez: 'tal vez',
  agusto: 'a gusto',
  aveces: 'a veces',
};

const EN_LIST: Record<string, string> = {
  teh: 'the',
  adn: 'and',
  taht: 'that',
  thier: 'their',
  wich: 'which',
  becuase: 'because',
  recieve: 'receive',
  recieved: 'received',
  seperate: 'separate',
  definately: 'definitely',
  occured: 'occurred',
  occurence: 'occurrence',
  untill: 'until',
  wierd: 'weird',
  freind: 'friend',
  beleive: 'believe',
  accomodate: 'accommodate',
  goverment: 'government',
  tommorow: 'tomorrow',
  alot: 'a lot',
  dont: "don't",
  doesnt: "doesn't",
  isnt: "isn't",
};

/** La lista de reemplazos de fábrica de un idioma. */
export function defaultReplacements(lang: AutoLang): Record<string, string> {
  return { ...(lang === 'en' ? EN_LIST : ES_LIST) };
}
