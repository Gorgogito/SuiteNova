import { normRect, rectContains, type Rect } from './addr';
import type { Node } from './ast';
import { compareScalars, textToNumber } from './coerce';
import { evaluate } from './evaluator';
import { cellKeyText } from './filter';
import { adjustForStructure, printFormula, renameSheetRefs, shiftRefs, type StructureChange } from './formula';
import { scalarOf } from './functions/util';
import { parseFormula } from './parser';
import { isErr, type Scalar } from './values';
import type { Sheet, Workbook } from './workbook';

export type CFOperator = 'between' | 'notBetween' | 'equal' | 'notEqual' | 'greaterThan' | 'greaterThanOrEqual' | 'lessThan' | 'lessThanOrEqual';

/** A threshold ("cfvo"): where a colour scale, data bar or icon set starts/stops. */
export interface CFValue {
  type: 'min' | 'max' | 'num' | 'percent' | 'percentile' | 'formula';
  value?: number | string;
}

export type IconSetName = '3Arrows' | '3TrafficLights' | '3Symbols' | '3Flags' | '4Arrows' | '5Arrows';

export interface CFFormat {
  color?: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

export type CFKind =
  | { type: 'cellIs'; operator: CFOperator; formula1: string; formula2?: string }
  | { type: 'expression'; formula: string }
  | { type: 'text'; mode: 'contains' | 'notContains' | 'beginsWith' | 'endsWith'; text: string }
  | { type: 'duplicates'; unique?: boolean }
  | { type: 'top'; rank: number; percent?: boolean; bottom?: boolean }
  | { type: 'average'; above: boolean; equal?: boolean }
  | { type: 'blanks'; not?: boolean }
  | { type: 'errors'; not?: boolean }
  | { type: 'colorScale'; stops: { cfvo: CFValue; color: string }[] }
  | { type: 'dataBar'; color: string; min: CFValue; max: CFValue; showValue?: boolean }
  | { type: 'iconSet'; set: IconSetName; thresholds: CFValue[]; reverse?: boolean; showValue?: boolean };

export type CFRule = {
  id: string;
  ranges: Rect[];
  /** 1 = highest priority. */
  priority: number;
  stopIfTrue?: boolean;
  format?: CFFormat;
} & CFKind;

export const ICON_COUNTS: Record<IconSetName, number> = { '3Arrows': 3, '3TrafficLights': 3, '3Symbols': 3, '3Flags': 3, '4Arrows': 4, '5Arrows': 5 };

/** Default thresholds (percent) for an icon set, as Excel does: equal bands. */
export function defaultIconThresholds(set: IconSetName): CFValue[] {
  const n = ICON_COUNTS[set];
  return Array.from({ length: n }, (_x, i) => ({ type: 'percent' as const, value: Math.round((i * 100) / n) }));
}

export interface CFResult {
  format?: CFFormat;
  /** Fill from a colour scale. */
  scaleBg?: string;
  bar?: { fraction: number; color: string };
  icon?: { set: IconSetName; index: number; count: number };
  /** Hide the cell's value (data bars / icon sets with showValue false). */
  hideValue?: boolean;
}

// ------------------------------------------------------------------------------------------------ ranges
/** Shift a rectangle after rows/columns were inserted or deleted. Returns null if it vanished. */
export function shiftRect(r: Rect, ch: Pick<StructureChange, 'axis' | 'index' | 'count'>): Rect | null {
  const lo = ch.axis === 'row' ? r.r1 : r.c1;
  const hi = ch.axis === 'row' ? r.r2 : r.c2;
  let nlo = lo;
  let nhi = hi;
  if (ch.count > 0) {
    if (lo >= ch.index) nlo += ch.count;
    if (hi >= ch.index) nhi += ch.count;
  } else {
    const n = -ch.count;
    const dl = ch.index;
    const dh = ch.index + n - 1;
    if (lo >= dl && hi <= dh) return null;
    nlo = lo > dh ? lo - n : lo >= dl ? dl : lo;
    nhi = hi > dh ? hi - n : hi >= dl ? dl - 1 : hi;
  }
  return ch.axis === 'row' ? { ...r, r1: nlo, r2: nhi } : { ...r, c1: nlo, c2: nhi };
}

const mapFormula = (text: string | undefined, fn: (n: Node) => Node): string | undefined => {
  if (!text) return text;
  try {
    return printFormula(fn(parseFormula(text)));
  } catch {
    return text;
  }
};

function mapRuleFormulas(rule: CFRule, fn: (n: Node) => Node): CFRule {
  switch (rule.type) {
    case 'cellIs':
      return { ...rule, formula1: mapFormula(rule.formula1, fn) ?? rule.formula1, formula2: mapFormula(rule.formula2, fn) };
    case 'expression':
      return { ...rule, formula: mapFormula(rule.formula, fn) ?? rule.formula };
    default:
      return rule;
  }
}

export function adjustCFRules(rules: CFRule[], sheetName: string, owner: string, ch: StructureChange): CFRule[] {
  const sameSheet = owner.toLowerCase() === ch.sheet.toLowerCase();
  return rules.flatMap((r) => {
    let ranges = r.ranges;
    if (sameSheet) ranges = r.ranges.map((x) => shiftRect(x, ch)).filter((x): x is Rect => x !== null);
    if (!ranges.length) return [];
    return [mapRuleFormulas({ ...r, ranges }, (n) => adjustForStructure(n, sheetName, ch))];
  });
}

export function renameCFRefs(rules: CFRule[], oldName: string, newName: string): CFRule[] {
  return rules.map((r) => mapRuleFormulas(r, (n) => renameSheetRefs(n, oldName, newName)));
}

// ------------------------------------------------------------------------------------------------ evaluation
interface Stats {
  nums: number[]; // sorted ascending
  min: number;
  max: number;
  mean: number;
  counts: Map<string, number>;
}

const percentile = (sorted: number[], p: number): number => {
  if (!sorted.length) return 0;
  const rank = Math.min(1, Math.max(0, p)) * (sorted.length - 1);
  const lo = Math.floor(rank);
  return sorted[lo]! + (rank - lo) * ((sorted[lo + 1] ?? sorted[lo]!) - sorted[lo]!);
};

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lerpColor = (a: string, b: string, t: number): string => {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const to = (x: number) => Math.round(x).toString(16).padStart(2, '0');
  return `#${to(r1 + (r2 - r1) * t)}${to(g1 + (g2 - g1) * t)}${to(b1 + (b2 - b1) * t)}`;
};

const MAX_STAT_CELLS = 300_000;

/** Computes conditional-format results for cells of one sheet. Create one per repaint (cheap) and reuse per frame. */
export class CFEvaluator {
  private sheet: Sheet;
  private rules: CFRule[];
  private stats = new Map<string, Stats>();
  private asts = new Map<string, Node | null>();
  private cache = new Map<number, CFResult | null>();

  constructor(
    private wb: Workbook,
    sheetId: number,
  ) {
    this.sheet = wb.sheet(sheetId);
    this.rules = [...this.sheet.condFormats].sort((a, b) => a.priority - b.priority);
  }

  get active(): boolean {
    return this.rules.length > 0;
  }

  private statsFor(rule: CFRule): Stats {
    let s = this.stats.get(rule.id);
    if (s) return s;
    const nums: number[] = [];
    const counts = new Map<string, number>();
    let seen = 0;
    for (const raw of rule.ranges) {
      const r = normRect(raw);
      const r2 = Math.min(r.r2, this.sheet.maxRow);
      const c2 = Math.min(r.c2, this.sheet.maxCol);
      for (let row = r.r1; row <= r2 && seen < MAX_STAT_CELLS; row++) {
        for (let col = r.c1; col <= c2; col++) {
          seen++;
          const v = this.sheet.cells.get(row * 16384 + col)?.value ?? null;
          if (v === null) continue;
          if (typeof v === 'number') nums.push(v);
          const key = typeof v === 'string' ? `s:${v.toLowerCase()}` : isErr(v) ? `e:${v.code}` : `${typeof v}:${v}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }
    nums.sort((a, b) => a - b);
    const mean = nums.length ? nums.reduce((a, x) => a + x, 0) / nums.length : 0;
    s = { nums, min: nums[0] ?? 0, max: nums[nums.length - 1] ?? 0, mean, counts };
    this.stats.set(rule.id, s);
    return s;
  }

  private ast(text: string | undefined): Node | null {
    if (!text) return null;
    let a = this.asts.get(text);
    if (a === undefined) {
      try {
        a = parseFormula(text);
      } catch {
        a = null;
      }
      this.asts.set(text, a);
    }
    return a;
  }

  /** Evaluate a rule formula for a cell; references are relative to the top-left cell of the rule's first range. */
  private evalAt(rule: CFRule, text: string | undefined, row: number, col: number): Scalar {
    const node = this.ast(text);
    if (!node) return null;
    const base = normRect(rule.ranges[0]!);
    const shifted = shiftRefs(node, row - base.r1, col - base.c1);
    try {
      const v = evaluate(shifted, { host: this.wb, sheetId: this.sheet.id, row, col, scope: null, volatile: false });
      return scalarOf(v, { host: this.wb, sheetId: this.sheet.id, row, col, scope: null, volatile: false });
    } catch {
      return null;
    }
  }

  private threshold(rule: CFRule, cfvo: CFValue, st: Stats, row: number, col: number): number {
    switch (cfvo.type) {
      case 'min':
        return st.min;
      case 'max':
        return st.max;
      case 'num':
        return Number(cfvo.value ?? 0);
      case 'percent':
        return st.min + ((st.max - st.min) * Number(cfvo.value ?? 0)) / 100;
      case 'percentile':
        return percentile(st.nums, Number(cfvo.value ?? 0) / 100);
      case 'formula': {
        const v = this.evalAt(rule, String(cfvo.value ?? ''), row, col);
        return typeof v === 'number' ? v : 0;
      }
    }
  }

  private compare(op: CFOperator, v: Scalar, a: Scalar, b: Scalar): boolean {
    const norm = (x: Scalar, other: Scalar): Scalar => (x === null ? (typeof other === 'string' ? '' : 0) : x);
    const x = norm(v, a);
    const cmp = (y: Scalar) => (isErr(x) || isErr(y) ? NaN : compareScalars(x, norm(y, x)));
    switch (op) {
      case 'equal':
        return cmp(a) === 0;
      case 'notEqual':
        return cmp(a) !== 0 && !Number.isNaN(cmp(a));
      case 'greaterThan':
        return cmp(a) > 0;
      case 'greaterThanOrEqual':
        return cmp(a) >= 0;
      case 'lessThan':
        return cmp(a) < 0;
      case 'lessThanOrEqual':
        return cmp(a) <= 0;
      case 'between':
        return cmp(a) >= 0 && cmp(b) <= 0;
      case 'notBetween':
        return cmp(a) < 0 || cmp(b) > 0;
    }
  }

  /** Does a style-type rule apply to the cell? */
  private matches(rule: CFRule, row: number, col: number, v: Scalar): boolean {
    switch (rule.type) {
      case 'cellIs':
        return this.compare(rule.operator, v, this.evalAt(rule, rule.formula1, row, col), this.evalAt(rule, rule.formula2, row, col));
      case 'expression': {
        const r = this.evalAt(rule, rule.formula, row, col);
        return r === true || (typeof r === 'number' && r !== 0);
      }
      case 'text': {
        const text = cellKeyText(this.wb, this.sheet, row, col).toLowerCase();
        const t = rule.text.toLowerCase();
        if (rule.mode === 'contains') return text.includes(t);
        if (rule.mode === 'notContains') return !text.includes(t);
        return rule.mode === 'beginsWith' ? text.startsWith(t) : text.endsWith(t);
      }
      case 'duplicates': {
        if (v === null) return false;
        const key = typeof v === 'string' ? `s:${v.toLowerCase()}` : isErr(v) ? `e:${v.code}` : `${typeof v}:${v}`;
        const n = this.statsFor(rule).counts.get(key) ?? 0;
        return rule.unique ? n === 1 : n > 1;
      }
      case 'top': {
        if (typeof v !== 'number') return false;
        const nums = this.statsFor(rule).nums;
        const count = rule.percent ? Math.max(1, Math.floor((nums.length * rule.rank) / 100)) : rule.rank;
        if (!nums.length) return false;
        return rule.bottom ? v <= nums[Math.min(count, nums.length) - 1]! : v >= nums[Math.max(0, nums.length - count)]!;
      }
      case 'average': {
        if (typeof v !== 'number') return false;
        const m = this.statsFor(rule).mean;
        return rule.above ? (rule.equal ? v >= m : v > m) : rule.equal ? v <= m : v < m;
      }
      case 'blanks':
        return rule.not ? v !== null && v !== '' : v === null || v === '';
      case 'errors':
        return rule.not ? !isErr(v) : isErr(v);
      default:
        return false;
    }
  }

  /** Conditional-format outcome for one cell, or null when nothing applies. */
  forCell(row: number, col: number): CFResult | null {
    const key = row * 16384 + col;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    let out: CFResult | null = null;
    const v: Scalar = this.sheet.cells.get(key)?.value ?? null;
    for (const rule of this.rules) {
      if (!rule.ranges.some((r) => rectContains(r, row, col))) continue;
      let hit = false;
      if (rule.type === 'colorScale') {
        if (typeof v === 'number') {
          const st = this.statsFor(rule);
          const pts = rule.stops.map((s) => ({ at: this.threshold(rule, s.cfvo, st, row, col), color: s.color }));
          const first = pts[0]!;
          const last = pts[pts.length - 1]!;
          let color: string;
          if (v <= first.at) color = first.color;
          else if (v >= last.at) color = last.color;
          else {
            let i = 0;
            while (i < pts.length - 2 && v > pts[i + 1]!.at) i++;
            const a = pts[i]!;
            const b = pts[i + 1]!;
            color = b.at === a.at ? b.color : lerpColor(a.color, b.color, (v - a.at) / (b.at - a.at));
          }
          out = { ...(out ?? {}) };
          out.scaleBg ??= color;
          hit = true;
        }
      } else if (rule.type === 'dataBar') {
        if (typeof v === 'number') {
          const st = this.statsFor(rule);
          const lo = this.threshold(rule, rule.min, st, row, col);
          const hi = this.threshold(rule, rule.max, st, row, col);
          const fraction = hi === lo ? 1 : Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
          out = { ...(out ?? {}) };
          out.bar ??= { fraction, color: rule.color };
          if (rule.showValue === false) out.hideValue = true;
          hit = true;
        }
      } else if (rule.type === 'iconSet') {
        if (typeof v === 'number') {
          const st = this.statsFor(rule);
          const th = rule.thresholds.map((t) => this.threshold(rule, t, st, row, col));
          let idx = 0;
          for (let i = 0; i < th.length; i++) if (v >= th[i]!) idx = i;
          if (rule.reverse) idx = th.length - 1 - idx;
          out = { ...(out ?? {}) };
          out.icon ??= { set: rule.set, index: idx, count: th.length };
          if (rule.showValue === false) out.hideValue = true;
          hit = true;
        }
      } else if (this.matches(rule, row, col, v)) {
        hit = true;
        if (rule.format) {
          out = { ...(out ?? {}) };
          const f = (out.format ??= {});
          for (const [k, val] of Object.entries(rule.format)) if (val !== undefined && (f as Record<string, unknown>)[k] === undefined) (f as Record<string, unknown>)[k] = val;
        }
      }
      if (hit && rule.stopIfTrue) break;
    }
    this.cache.set(key, out);
    return out;
  }
}

let ruleCounter = 0;
export const newRuleId = (): string => `cf-${Date.now().toString(36)}-${(ruleCounter++).toString(36)}`;

/** Next free priority number (rules added later have lower priority, like Excel's "move to top" default inverted). */
export const nextPriority = (rules: CFRule[]): number => Math.max(0, ...rules.map((r) => r.priority)) + 1;

void textToNumber;
