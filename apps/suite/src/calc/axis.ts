/**
 * One axis (rows or columns) of the grid: a default size plus sparse overrides.
 * Offsets are computed with a prefix-sum over the sorted overrides, so lookups are O(log k).
 */
export class Axis {
  private idx: number[] = [];
  private prefix: number[] = []; // prefix[i] = sum of (size - default) for overrides before idx[i]
  constructor(
    readonly defaultSize: number,
    overrides: Iterable<[number, number]>,
    readonly count: number,
  ) {
    const sorted = [...overrides].filter(([i]) => i < count).sort((a, b) => a[0] - b[0]);
    let acc = 0;
    for (const [i, size] of sorted) {
      this.idx.push(i);
      this.prefix.push(acc);
      acc += size - defaultSize;
    }
    this.sizes = new Map(sorted);
    this.totalDelta = acc;
  }

  private sizes: Map<number, number>;
  private totalDelta: number;

  size(i: number): number {
    return this.sizes.get(i) ?? this.defaultSize;
  }

  /** Number of overrides with index < i. */
  private before(i: number): number {
    let lo = 0;
    let hi = this.idx.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.idx[mid]! < i) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Start position of item i. */
  offset(i: number): number {
    const k = this.before(i);
    const delta = k === 0 ? 0 : this.prefix[k - 1]! + (this.size(this.idx[k - 1]!) - this.defaultSize);
    return i * this.defaultSize + delta;
  }

  get total(): number {
    return this.count * this.defaultSize + this.totalDelta;
  }

  /** Index of the item containing position px (clamped to the valid range). */
  indexAt(px: number): number {
    if (px <= 0) return 0;
    if (px >= this.total) return this.count - 1;
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.offset(mid) <= px) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}
