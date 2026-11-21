/*
 * How things that are written are said. A voice reads «Sr.» as «S r», «5 €» as «cinco» and «PDF» as a word nobody says; these rules turn them into what
 * a person would say. They work on the text of one piece in the language it is read in (Spanish and English have rules; another language is left as
 * it is) and, like the others in `prepare.ts`, keep the map back to the written text.
 */

export interface PronounceRule {
  re: RegExp;
  to: (m: RegExpExecArray) => string;
}

const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const ORD_M = ['primero', 'segundo', 'tercero', 'cuarto', 'quinto', 'sexto', 'séptimo', 'octavo', 'noveno', 'décimo'];
const ORD_F = ['primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta', 'séptima', 'octava', 'novena', 'décima'];

/** Abbreviations with a stop, written as they usually are (the stop is part of what is replaced). */
const ABBR_ES: Record<string, string> = {
  'Sr.': 'señor', 'Sra.': 'señora', 'Srta.': 'señorita', 'Sres.': 'señores', 'Dr.': 'doctor', 'Dra.': 'doctora', 'Lic.': 'licenciado', 'Ing.': 'ingeniero', 'Arq.': 'arquitecto',
  'Prof.': 'profesor', 'Profa.': 'profesora', 'Ud.': 'usted', 'Uds.': 'ustedes', 'Vd.': 'usted', 'etc.': 'etcétera', 'pág.': 'página', 'págs.': 'páginas', 'núm.': 'número',
  'Av.': 'avenida', 'Avda.': 'avenida', 'tel.': 'teléfono', 'art.': 'artículo', 'cap.': 'capítulo', 'vol.': 'volumen', 'aprox.': 'aproximadamente', 'Dpto.': 'departamento',
};
const ABBR_EN: Record<string, string> = { 'Mr.': 'Mister', 'Mrs.': 'Missus', 'Ms.': 'Miz', 'Dr.': 'Doctor', 'Prof.': 'Professor', 'vs.': 'versus', 'etc.': 'et cetera', 'Inc.': 'Incorporated', 'Ltd.': 'Limited' };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const abbrRe = (list: Record<string, string>) => new RegExp(`(?<![\\p{L}\\p{N}.])(${Object.keys(list).map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'gu');

/** A token of capitals with no vowel (PDF, HTML, CPU) is spelled; one that can be said as a word (ONU, IVA) is not. */
const SIGLA = /(?<![\p{L}\p{N}])(?![IVXLCDM]+(?![\p{L}\p{N}]))[BCDFGHJKLMNPQRSTVWXZ]{2,5}(?![\p{L}\p{N}])/gu;
const spell = (s: string): string => s.split('').join(' ');

export function pronounceRules(lang: string): PronounceRule[] {
  const es = /^es/i.test(lang);
  const en = /^en/i.test(lang);
  if (!es && !en) return [];
  const rules: PronounceRule[] = [];
  if (es) {
    rules.push({ re: /(?<![\p{L}\p{N}])EE\. ?UU\./gu, to: () => 'Estados Unidos' });
    rules.push({ re: /(?<![\p{L}\p{N}])p\. ?ej\./gu, to: () => 'por ejemplo' });
    rules.push({ re: /(?<=\d\s?)a\. ?m\./g, to: () => 'de la mañana' });
    rules.push({ re: /(?<=\d\s?)p\. ?m\./g, to: () => 'de la tarde' });
    rules.push({ re: abbrRe(ABBR_ES), to: (m) => ABBR_ES[m[1]!]! });
    // ordinals: 1.º 2.ª 3º (the first ten)
    rules.push({ re: /(?<![\p{L}\p{N}])(10|[1-9])\.?([ºª])(?![\p{L}\p{N}])/gu, to: (m) => (m[2] === 'º' ? ORD_M : ORD_F)[Number(m[1]) - 1]! });
    // a date as dd/mm/yyyy is said as a date
    rules.push({
      re: /(?<![\d/])(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])\/(\d{4})(?![\d/])/g,
      to: (m) => `${Number(m[1])} de ${MONTHS_ES[Number(m[2]) - 1]} de ${m[3]}`,
    });
    rules.push({ re: /(?<=\d)\s?%/g, to: () => ' por ciento' });
    rules.push({ re: /%/g, to: () => 'por ciento' });
    rules.push({ re: /(?<=\d)\s?€/g, to: () => ' euros' });
    rules.push({ re: /€\s?(\d(?:[\d.,]*\d)?)/g, to: (m) => `${m[1]} euros` });
    rules.push({ re: /\$\s?(\d(?:[\d.,]*\d)?)/g, to: (m) => `${m[1]} dólares` });
    rules.push({ re: /£\s?(\d(?:[\d.,]*\d)?)/g, to: (m) => `${m[1]} libras` });
    rules.push({ re: /°\s?C(?![\p{L}])/gu, to: () => ' grados centígrados' });
    rules.push({ re: /°\s?F(?![\p{L}])/gu, to: () => ' grados Fahrenheit' });
    rules.push({ re: /(?<=\d)\s?°/g, to: () => ' grados' });
    rules.push({ re: /#(?=\d)/g, to: () => 'número ' });
    rules.push({ re: /&/g, to: () => ' y ' });
    rules.push({ re: /(?<![\p{L}\p{N}])@(?=[\p{L}\p{N}])/gu, to: () => 'arroba ' });
    rules.push({ re: /×/g, to: () => ' por ' });
    rules.push({ re: /÷/g, to: () => ' entre ' });
    rules.push({ re: /≥/g, to: () => ' mayor o igual que ' });
    rules.push({ re: /≤/g, to: () => ' menor o igual que ' });
    rules.push({ re: /≠/g, to: () => ' distinto de ' });
    rules.push({ re: /±/g, to: () => ' más menos ' });
  } else {
    rules.push({ re: /(?<![\p{L}\p{N}.])e\.g\./gu, to: () => 'for example' });
    rules.push({ re: /(?<![\p{L}\p{N}.])i\.e\./gu, to: () => 'that is' });
    rules.push({ re: abbrRe(ABBR_EN), to: (m) => ABBR_EN[m[1]!]! });
    rules.push({ re: /(?<=\d)\s?%/g, to: () => ' percent' });
    rules.push({ re: /%/g, to: () => 'percent' });
    rules.push({ re: /\$\s?(\d(?:[\d.,]*\d)?)/g, to: (m) => `${m[1]} dollars` });
    rules.push({ re: /€\s?(\d(?:[\d.,]*\d)?)/g, to: (m) => `${m[1]} euros` });
    rules.push({ re: /£\s?(\d(?:[\d.,]*\d)?)/g, to: (m) => `${m[1]} pounds` });
    rules.push({ re: /(?<=\d)\s?€/g, to: () => ' euros' });
    rules.push({ re: /°\s?C(?![\p{L}])/gu, to: () => ' degrees Celsius' });
    rules.push({ re: /°\s?F(?![\p{L}])/gu, to: () => ' degrees Fahrenheit' });
    rules.push({ re: /(?<=\d)\s?°/g, to: () => ' degrees' });
    rules.push({ re: /#(?=\d)/g, to: () => 'number ' });
    rules.push({ re: /&/g, to: () => ' and ' });
    rules.push({ re: /(?<![\p{L}\p{N}])@(?=[\p{L}\p{N}])/gu, to: () => 'at ' });
    rules.push({ re: /×/g, to: () => ' times ' });
    rules.push({ re: /÷/g, to: () => ' divided by ' });
    rules.push({ re: /≥/g, to: () => ' greater than or equal to ' });
    rules.push({ re: /≤/g, to: () => ' less than or equal to ' });
    rules.push({ re: /≠/g, to: () => ' not equal to ' });
    rules.push({ re: /±/g, to: () => ' plus or minus ' });
  }
  rules.push({ re: SIGLA, to: (m) => spell(m[0]) });
  return rules;
}
