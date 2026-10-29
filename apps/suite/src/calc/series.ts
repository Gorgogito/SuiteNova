import type { Scalar } from '@suitenova/calc-engine';

const LISTS: string[][] = [
  ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'],
  ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'],
  ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
  ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
  ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'],
];

function matchCase(sample: string, text: string): string {
  if (sample === sample.toUpperCase() && sample.length > 1) return text.toUpperCase();
  if (sample[0] === sample[0]!.toUpperCase() && sample[0] !== sample[0]!.toLowerCase()) return text[0]!.toUpperCase() + text.slice(1);
  return text;
}

function listSeries(values: string[], count: number): string[] | null {
  const lower = values.map((v) => v.toLowerCase());
  for (const list of LISTS) {
    const first = list.indexOf(lower[0]!);
    if (first < 0) continue;
    const step = lower.length > 1 ? list.indexOf(lower[1]!) - first : 1;
    if (step === 0 || lower.some((v) => !list.includes(v))) continue;
    const n = list.length;
    const out: string[] = [];
    for (let k = 0; k < count; k++) out.push(matchCase(values[0]!, list[(((first + (values.length + k) * step) % n) + n) % n]!));
    return out;
  }
  return null;
}

/** Extend a selection of source cells by `count` more cells, the way a fill handle does. Forward only. */
export function fillSeries(src: Scalar[], count: number, opts: { increment?: boolean } = {}): Scalar[] {
  if (count <= 0 || src.length === 0) return [];
  const out: Scalar[] = [];
  const allNumbers = src.every((v) => typeof v === 'number');
  if (allNumbers) {
    const nums = src as number[];
    // a single number is copied unless the user asked to increment
    if (nums.length === 1 && !opts.increment) return Array.from({ length: count }, () => nums[0]!);
    const step = nums.length > 1 ? (nums[nums.length - 1]! - nums[0]!) / (nums.length - 1) : 1;
    const last = nums[nums.length - 1]!;
    for (let k = 1; k <= count; k++) out.push(Math.round((last + step * k) * 1e10) / 1e10);
    return out;
  }
  if (src.every((v) => typeof v === 'string')) {
    const strs = src as string[];
    const list = listSeries(strs, count);
    if (list) return list;
    // text with a trailing number: "Item 1" -> "Item 2"
    const m = strs.map((s) => /^(.*?)(\d+)$/.exec(s));
    if (m.every((x) => x !== null) && new Set(m.map((x) => x![1])).size === 1) {
      const prefix = m[0]![1]!;
      const nums = m.map((x) => Number(x![2]));
      const width = m[m.length - 1]![2]!.length;
      const padded = m[m.length - 1]![2]!.startsWith('0');
      const step = nums.length > 1 ? (nums[nums.length - 1]! - nums[0]!) / (nums.length - 1) : 1;
      for (let k = 1; k <= count; k++) {
        const v = String(Math.max(0, Math.round(nums[nums.length - 1]! + step * k)));
        out.push(prefix + (padded ? v.padStart(width, '0') : v));
      }
      return out;
    }
  }
  // anything else repeats cyclically
  for (let k = 0; k < count; k++) out.push(src[k % src.length]!);
  return out;
}
