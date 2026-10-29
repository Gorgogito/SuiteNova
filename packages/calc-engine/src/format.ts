import { numberToText } from './coerce';
import { timeFromFraction, weekdayFromSerial, ymdFromSerial } from './dates';
import { CalcError, type Scalar } from './values';

export type FormatLocale = 'es' | 'en';

export interface Formatted {
  text: string;
  /** CSS colour requested by the format (e.g. [Red]). */
  color?: string;
}

export const BUILTIN_FORMATS: Record<number, string> = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  12: '# ?/?',
  13: '# ??/??',
  14: 'm/d/yyyy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'm/d/yyyy h:mm',
  37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mmss.0',
  48: '##0.0E+0',
  49: '@',
};

const MONTHS: Record<FormatLocale, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
};
const DAYS: Record<FormatLocale, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
};

type Tok =
  | { k: 'lit'; v: string }
  | { k: 'digit'; v: '0' | '#' | '?' }
  | { k: 'dot' }
  | { k: 'comma' }
  | { k: 'pct' }
  | { k: 'exp'; sign: boolean }
  | { k: 'text' }
  | { k: 'date'; v: string }
  | { k: 'ampm'; v: string }
  | { k: 'elapsed'; v: string };

interface Section {
  toks: Tok[];
  color?: string;
  condition?: (n: number) => boolean;
  isDate: boolean;
}

const COLORS: Record<string, string> = {
  black: '#000000',
  blue: '#0000ff',
  cyan: '#00ffff',
  green: '#008000',
  magenta: '#ff00ff',
  red: '#ff0000',
  white: '#ffffff',
  yellow: '#ffff00',
};

const sectionCache = new Map<string, Section[]>();

function splitSections(code: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  let inB = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]!;
    if (ch === '\\') {
      cur += ch + (code[++i] ?? '');
      continue;
    }
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch === '[') inB = true;
    else if (!inQ && ch === ']') inB = false;
    if (ch === ';' && !inQ && !inB) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseSection(src: string): Section {
  const toks: Tok[] = [];
  let color: string | undefined;
  let condition: Section['condition'];
  let isDate = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    const rest = src.slice(i);
    if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      const text = src.slice(i + 1, end < 0 ? undefined : end);
      toks.push({ k: 'lit', v: text });
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    if (ch === '\\') {
      toks.push({ k: 'lit', v: src[i + 1] ?? '' });
      i += 2;
      continue;
    }
    if (ch === '[') {
      const end = src.indexOf(']', i);
      const body = src.slice(i + 1, end < 0 ? undefined : end);
      i = end < 0 ? src.length : end + 1;
      const lower = body.toLowerCase();
      if (COLORS[lower]) color = COLORS[lower];
      else if (/^(h+|m+|s+)$/.test(lower)) {
        toks.push({ k: 'elapsed', v: lower });
        isDate = true;
      } else if (body.startsWith('$')) {
        const sym = body.slice(1).split('-')[0] ?? '';
        if (sym) toks.push({ k: 'lit', v: sym });
      } else {
        const m = /^(<=|>=|<>|<|>|=)\s*(-?[\d.]+)$/.exec(body);
        if (m) {
          const n = Number(m[2]);
          const op = m[1]!;
          condition = (x) => (op === '<' ? x < n : op === '>' ? x > n : op === '<=' ? x <= n : op === '>=' ? x >= n : op === '=' ? x === n : x !== n);
        }
      }
      continue;
    }
    if (ch === '_') {
      toks.push({ k: 'lit', v: ' ' });
      i += 2;
      continue;
    }
    if (ch === '*') {
      i += 2;
      continue;
    }
    const upper = rest.toUpperCase();
    if (upper.startsWith('AM/PM') || upper.startsWith('A/P')) {
      const len = upper.startsWith('AM/PM') ? 5 : 3;
      toks.push({ k: 'ampm', v: rest.slice(0, len) });
      isDate = true;
      i += len;
      continue;
    }
    if (upper.startsWith('E+') || upper.startsWith('E-')) {
      toks.push({ k: 'exp', sign: upper[1] === '+' });
      i += 2;
      continue;
    }
    if (/[ymdhs]/i.test(ch)) {
      const m = /^([ymdhs])\1*/i.exec(rest)!;
      toks.push({ k: 'date', v: m[0].toLowerCase() });
      isDate = true;
      i += m[0].length;
      continue;
    }
    if (ch === '0' || ch === '#' || ch === '?') toks.push({ k: 'digit', v: ch });
    else if (ch === '.') toks.push({ k: 'dot' });
    else if (ch === ',') toks.push({ k: 'comma' });
    else if (ch === '%') toks.push({ k: 'pct' });
    else if (ch === '@') toks.push({ k: 'text' });
    else toks.push({ k: 'lit', v: ch });
    i++;
  }
  return { toks, color, condition, isDate };
}

function sectionsOf(code: string): Section[] {
  let s = sectionCache.get(code);
  if (!s) {
    s = splitSections(code).map(parseSection);
    if (sectionCache.size > 500) sectionCache.clear();
    sectionCache.set(code, s);
  }
  return s;
}

export function isDateFormat(code: string | undefined): boolean {
  if (!code || code === 'General') return false;
  const s = sectionsOf(code)[0];
  return !!s && s.isDate;
}

function roundTo(x: number, d: number): number {
  const f = Math.pow(10, d);
  return (Math.sign(x) * Math.floor(Math.abs(x) * f * (1 + Number.EPSILON) + 0.5)) / f;
}

function groupThousands(int: string, sep: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

const sepsFor = (loc: FormatLocale) => (loc === 'es' ? { dec: ',', thou: '.' } : { dec: '.', thou: ',' });

/** Display text for General format. */
export function generalText(n: number, locale: FormatLocale = 'en'): string {
  let s: string;
  if (Number.isInteger(n) && Math.abs(n) < 1e11) s = String(n);
  else {
    s = numberToText(n);
    for (let p = 15; p >= 1 && s.length > 11 && !s.includes('E'); p--) s = numberToText(Number(n.toPrecision(p)));
    if (s.length > 11) {
      for (let d = 10; d >= 0; d--) {
        s = n
          .toExponential(d)
          .replace(/\.?0+e/, 'e')
          .replace(/e([+-])(\d)$/, 'e$10$2')
          .replace('e', 'E');
        if (s.length <= 11) break;
      }
    }
  }
  return locale === 'es' ? s.replace('.', ',') : s;
}

function formatNumeric(value: number, sec: Section, locale: FormatLocale, showMinus: boolean): string {
  const toks = sec.toks;
  const { dec: decSep, thou: thouSep } = sepsFor(locale);
  let v = Math.abs(value);
  const pct = toks.filter((t) => t.k === 'pct').length;
  v *= Math.pow(100, pct);

  const dotIdx = toks.findIndex((t) => t.k === 'dot');
  const expIdx = toks.findIndex((t) => t.k === 'exp');
  const lastDigit = toks.map((t) => t.k === 'digit').lastIndexOf(true);
  const firstDigit = toks.findIndex((t) => t.k === 'digit');
  // trailing commas right after the last digit scale by 1000
  let scale = 0;
  for (let i = lastDigit + 1; i < toks.length && toks[i]!.k === 'comma'; i++) scale++;
  v /= Math.pow(1000, scale);
  const useThousands = toks.some((t, i) => t.k === 'comma' && i > firstDigit && i < lastDigit);

  const numericEnd = expIdx >= 0 ? expIdx : toks.length;
  // the mantissa ends at its last digit placeholder; anything after is a literal tail
  let mantissaEnd = -1;
  for (let i = 0; i < numericEnd; i++) if (toks[i]!.k === 'digit') mantissaEnd = i;
  const intToks = toks.slice(Math.max(firstDigit, 0), dotIdx >= 0 && dotIdx < numericEnd ? dotIdx : mantissaEnd + 1);
  const decToks = dotIdx >= 0 && dotIdx < numericEnd ? toks.slice(dotIdx + 1, mantissaEnd + 1) : [];
  const decPlaces = decToks.filter((t) => t.k === 'digit').length;

  let expText = '';
  let mantissa = v;
  if (expIdx >= 0) {
    const e = toks[expIdx] as Extract<Tok, { k: 'exp' }>;
    const expDigits = toks.slice(expIdx + 1).filter((t) => t.k === 'digit').length;
    const intPlaceholders = intToks.filter((t) => t.k === 'digit').length || 1;
    let exp = mantissa === 0 ? 0 : Math.floor(Math.log10(mantissa));
    if (intPlaceholders > 1) exp = Math.floor(exp / intPlaceholders) * intPlaceholders;
    mantissa = mantissa / Math.pow(10, exp);
    if (roundTo(mantissa, decPlaces) >= Math.pow(10, intPlaceholders)) {
      mantissa /= 10;
      exp += 1;
    }
    expText = `E${exp < 0 ? '-' : e.sign ? '+' : ''}${String(Math.abs(exp)).padStart(expDigits, '0')}`;
  }

  const rounded = roundTo(mantissa, decPlaces);
  const fixed = rounded.toFixed(decPlaces);
  const [intStrRaw, decStrRaw = ''] = fixed.split('.');
  let intStr = intStrRaw!;
  const intPlace = intToks.filter((t) => t.k === 'digit') as Extract<Tok, { k: 'digit' }>[];
  const zeroCount = intPlace.filter((t) => t.v === '0').length;
  if (intStr === '0' && zeroCount === 0) intStr = '';
  intStr = intStr.padStart(zeroCount, '0');

  // distribute integer digits right-to-left over the integer placeholders
  const digitsRev = intStr.split('').reverse();
  const outInt: string[] = [];
  let di = 0;
  for (let i = intToks.length - 1; i >= 0; i--) {
    const t = intToks[i]!;
    if (t.k === 'digit') {
      const d = digitsRev[di++];
      if (d !== undefined) outInt.push(d);
      else if (t.v === '?') outInt.push(' ');
    } else if (t.k === 'lit') outInt.push(t.v);
    else if (t.k === 'pct') outInt.push('%');
  }
  // leftover digits go in front of the leftmost placeholder
  while (di < digitsRev.length) outInt.push(digitsRev[di++]!);
  let intOut = outInt.reverse().join('');
  if (useThousands) {
    const m = /^(\D*)(\d+)(.*)$/.exec(intOut);
    if (m) intOut = m[1] + groupThousands(m[2]!, thouSep) + m[3];
  }

  let decOut = '';
  if (decPlaces > 0 || dotIdx >= 0) {
    const decDigits = decStrRaw.padEnd(decPlaces, '0').split('');
    // drop optional (#) zeros from the end, blank out ? zeros
    const places = decToks.filter((t) => t.k === 'digit') as Extract<Tok, { k: 'digit' }>[];
    let end = decDigits.length;
    while (end > 0 && decDigits[end - 1] === '0' && places[end - 1]?.v !== '0') end--;
    const kept = decDigits.slice(0, end);
    for (let i = end; i < decDigits.length; i++) if (places[i]?.v === '?') kept.push(' ');
    let di2 = 0;
    const parts: string[] = [];
    for (const t of decToks) {
      if (t.k === 'digit') {
        const d = kept[di2++];
        if (d !== undefined) parts.push(d);
      } else if (t.k === 'lit') parts.push(t.v);
      else if (t.k === 'pct') parts.push('%');
    }
    const body = parts.join('');
    decOut = dotIdx >= 0 && dotIdx < numericEnd ? decSep + body : '';
  }

  // literals before the first / after the last numeric token
  const head = toks.slice(0, firstDigit < 0 ? 0 : firstDigit).filter((t) => t.k === 'lit' || t.k === 'pct');
  const headText = head.map((t) => (t.k === 'lit' ? t.v : '%')).join('');
  const tailToks = expIdx >= 0 ? [...toks.slice(mantissaEnd + 1, expIdx), ...toks.slice(expIdx + 1).filter((t) => t.k !== 'digit')] : toks.slice(mantissaEnd + 1);
  const tailText = tailToks
    .filter((t) => t.k === 'lit' || t.k === 'pct')
    .map((t) => (t.k === 'lit' ? t.v : '%'))
    .join('');
  // percent signs placed between int and decimal parts are handled in the digit loops above

  const core = intOut + decOut + expText;
  const sign = showMinus && value < 0 && Number(rounded) !== 0 ? '-' : '';
  return sign + headText + core + tailText;
}

function formatDate(serial: number, sec: Section, locale: FormatLocale): string {
  const toks = sec.toks;
  const hasAmPm = toks.some((t) => t.k === 'ampm');
  const total = Math.round(serial * 86400) / 86400;
  const ymd = ymdFromSerial(total);
  const time = timeFromFraction(total);
  const wd = weekdayFromSerial(total);
  const out: string[] = [];
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    switch (t.k) {
      case 'lit':
        out.push(t.v);
        break;
      case 'ampm':
        out.push(time.h >= 12 ? (t.v.length > 3 ? 'PM' : 'P') : t.v.length > 3 ? 'AM' : 'A');
        break;
      case 'elapsed': {
        const totalSeconds = Math.floor(serial * 86400 + 0.5);
        if (t.v[0] === 'h') out.push(pad(Math.floor(totalSeconds / 3600), t.v.length));
        else if (t.v[0] === 'm') out.push(pad(Math.floor(totalSeconds / 60), t.v.length));
        else out.push(pad(totalSeconds, t.v.length));
        break;
      }
      case 'date': {
        const v = t.v;
        const c = v[0];
        if (c === 'y') out.push(v.length <= 2 ? pad(ymd.y % 100, 2) : pad(ymd.y, 4));
        else if (c === 'd') {
          if (v.length === 1) out.push(String(ymd.d));
          else if (v.length === 2) out.push(pad(ymd.d, 2));
          else if (v.length === 3) out.push(capitalize(DAYS[locale][wd]!.slice(0, 3), locale));
          else out.push(capitalize(DAYS[locale][wd]!, locale));
        } else if (c === 'h') {
          const h = hasAmPm ? time.h % 12 || 12 : time.h;
          out.push(v.length === 1 ? String(h) : pad(h, 2));
        } else if (c === 's') {
          out.push(v.length === 1 ? String(time.s) : pad(time.s, 2));
        } else if (c === 'm') {
          // minute when adjacent to h or s, otherwise month
          const prev = [...toks.slice(0, i)].reverse().find((x) => x.k === 'date' || x.k === 'elapsed');
          const next = toks.slice(i + 1).find((x) => x.k === 'date' || x.k === 'elapsed');
          const isMinute = (prev && 'v' in prev && /^h/.test(prev.v)) || (next && 'v' in next && /^s/.test(next.v));
          if (isMinute) out.push(v.length === 1 ? String(time.mi) : pad(time.mi, 2));
          else if (v.length === 1) out.push(String(ymd.m));
          else if (v.length === 2) out.push(pad(ymd.m, 2));
          else if (v.length === 3) out.push(capitalize(MONTHS[locale][ymd.m - 1]!.slice(0, 3), locale));
          else if (v.length === 4) out.push(capitalize(MONTHS[locale][ymd.m - 1]!, locale));
          else out.push(MONTHS[locale][ymd.m - 1]![0]!.toUpperCase());
        }
        break;
      }
      case 'dot':
        out.push('.');
        break;
      case 'comma':
        out.push(',');
        break;
      case 'digit': {
        // fractional seconds like .000 after s
        const prev = toks[i - 1];
        if (prev && prev.k === 'dot' && t.v === '0') out.push(String(Math.round((total * 86400) % 1 * 10)));
        break;
      }
      default:
        break;
    }
  }
  return out.join('');
}

const capitalize = (s: string, locale: FormatLocale): string => (locale === 'es' ? s : s.charAt(0).toUpperCase() + s.slice(1));

/** Format a cell value with an Excel number-format code. */
export function formatValue(value: Scalar, code: string | undefined, locale: FormatLocale = 'en'): Formatted {
  if (value === null) return { text: '' };
  if (value instanceof CalcError) return { text: value.code };
  const fmt = !code || code === 'General' ? undefined : code;

  if (typeof value === 'boolean') return { text: value ? 'TRUE' : 'FALSE' };
  if (typeof value === 'string') {
    if (!fmt) return { text: value };
    const secs = sectionsOf(fmt);
    const sec = secs.length >= 4 ? secs[3]! : secs.find((s) => s.toks.some((t) => t.k === 'text'));
    if (!sec || !sec.toks.some((t) => t.k === 'text')) return { text: value };
    return { text: sec.toks.map((t) => (t.k === 'text' ? value : t.k === 'lit' ? t.v : '')).join(''), color: sec.color };
  }

  if (!fmt) return { text: generalText(value, locale) };
  const secs = sectionsOf(fmt);
  let sec: Section;
  let showMinus = false;
  const conditional = secs.some((s) => s.condition);
  if (conditional) {
    sec = secs.find((s) => s.condition?.(value)) ?? secs[secs.length - 1]!;
    showMinus = value < 0 && secs.length < 2;
  } else if (secs.length === 1) {
    sec = secs[0]!;
    showMinus = true;
  } else if (value < 0) {
    sec = secs[1]!;
  } else if (value === 0 && secs.length >= 3) {
    sec = secs[2]!;
  } else sec = secs[0]!;
  if (secs.length >= 2 && value < 0 && !conditional) showMinus = false;

  if (sec.isDate) {
    if (value < 0) return { text: '#'.repeat(10) };
    return { text: formatDate(value, sec, locale), color: sec.color };
  }
  if (sec.toks.length === 1 && sec.toks[0]!.k === 'text') return { text: generalText(value, locale), color: sec.color };
  if (sec.toks.length === 0) return { text: '', color: sec.color };
  // sections that are only literals (e.g. ;;; hides everything)
  if (!sec.toks.some((t) => t.k === 'digit')) return { text: sec.toks.map((t) => (t.k === 'lit' ? t.v : '')).join(''), color: sec.color };
  return { text: formatNumeric(value, sec, locale, showMinus), color: sec.color };
}
