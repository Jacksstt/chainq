/**
 * Analytics helpers — reusable concentration / distribution / bucket math
 * for use by chainq reports, the `chainq_analyze` MCP tool, and ad-hoc
 * agent code. Pure functions, no DB dependency.
 */

export interface ConcentrationSuite {
  /** Number of groups in the input. */
  groups: number;
  /** Sum of all values (denominator for share computations). */
  total: number;
  /** Top-N share map. Keys are the N values requested. */
  topN: Record<number, number>;
  /** Herfindahl-Hirschman index, Σ sᵢ². */
  hhi: number;
  /** Gini coefficient on the raw value distribution. */
  gini: number;
  /** Lorenz curve sampled to ~maxPoints points: [{ p_groups, p_value }]. */
  lorenz: Array<{ p_groups: number; p_value: number }>;
}

export interface PercentileSummary {
  count: number;
  min: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export interface Histogram {
  bucketSize: number;
  buckets: Array<{ from: number; to: number; count: number }>;
}

export interface BucketSpec {
  /** Inclusive lower bound. */
  min: number;
  /** Exclusive upper bound. Use `Infinity` for an open-ended tier. */
  max: number;
  /** Human-readable label for the bucket. */
  label: string;
}

export interface BucketResult<T> {
  label: string;
  count: number;
  total: number;
  share: number;
  items: T[];
}

/**
 * Compute the concentration suite for a set of group → value pairs.
 *
 * Example:
 *   concentrationSuite([{ key: "f0001", value: 100 }, ...])
 */
export function concentrationSuite(
  rows: Array<{ value: number }>,
  opts: { topN?: number[]; maxLorenzPoints?: number } = {},
): ConcentrationSuite {
  const topN = opts.topN ?? [1, 5, 10, 25, 50, 100];
  const maxPoints = opts.maxLorenzPoints ?? 50;
  const values = rows.map((r) => r.value).filter((v) => Number.isFinite(v) && v > 0);
  const sortedDesc = [...values].sort((a, b) => b - a);
  const total = sortedDesc.reduce((s, v) => s + v, 0);
  const top: Record<number, number> = {};
  if (total > 0) {
    for (const n of topN) {
      const slice = sortedDesc.slice(0, n);
      top[n] = slice.reduce((s, v) => s + v, 0) / total;
    }
  } else {
    for (const n of topN) top[n] = 0;
  }
  const hhi = total > 0 ? sortedDesc.reduce((s, v) => s + (v / total) ** 2, 0) : 0;
  const gini = computeGini(sortedDesc);
  const lorenz = computeLorenz(sortedDesc, maxPoints);
  return { groups: sortedDesc.length, total, topN: top, hhi, gini, lorenz };
}

/**
 * Quantile summary of a numeric distribution. Output `mean` is the arithmetic mean.
 */
export function distributionSummary(values: number[]): PercentileSummary {
  const cleaned = values.filter((v) => Number.isFinite(v));
  if (cleaned.length === 0) {
    return { count: 0, min: 0, p25: 0, p50: 0, p75: 0, p95: 0, p99: 0, max: 0, mean: 0 };
  }
  const sorted = [...cleaned].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0]!,
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1]!,
    mean: sorted.reduce((s, v) => s + v, 0) / sorted.length,
  };
}

/**
 * Fixed-width histogram. `bucketSize` is in the same units as `values`.
 * Buckets are aligned to multiples of `bucketSize`.
 */
export function histogram(values: number[], bucketSize: number): Histogram {
  if (bucketSize <= 0) throw new Error("histogram: bucketSize must be > 0");
  const cleaned = values.filter((v) => Number.isFinite(v));
  const counts = new Map<number, number>();
  for (const v of cleaned) {
    const k = Math.floor(v / bucketSize) * bucketSize;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const buckets = Array.from(counts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([from, count]) => ({ from, to: from + bucketSize, count }));
  return { bucketSize, buckets };
}

/**
 * Bucket arbitrary rows by a numeric key into a fixed set of tiers.
 * Each tier's `min` is inclusive and `max` is exclusive.
 */
export function bucketize<T>(
  rows: T[],
  key: (row: T) => number,
  buckets: BucketSpec[],
): Array<BucketResult<T>> {
  const out: Array<BucketResult<T>> = buckets.map((b) => ({
    label: b.label,
    count: 0,
    total: 0,
    share: 0,
    items: [],
  }));
  const grandTotal = rows.reduce((s, r) => s + key(r), 0);
  for (const row of rows) {
    const v = key(row);
    if (!Number.isFinite(v)) continue;
    const i = buckets.findIndex((b) => v >= b.min && v < b.max);
    if (i < 0) continue;
    out[i]!.count += 1;
    out[i]!.total += v;
    out[i]!.items.push(row);
  }
  if (grandTotal > 0) {
    for (const o of out) o.share = o.total / grandTotal;
  }
  return out;
}

/**
 * Sample quantile from a pre-sorted ASCENDING array. `p` ∈ [0, 1].
 */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor((sortedAsc.length - 1) * p)));
  return sortedAsc[idx]!;
}

/**
 * Gini coefficient on a list of non-negative values. Order is irrelevant.
 * Returns 0 for an empty or all-zero input.
 */
export function computeGini(values: number[]): number {
  const sorted = [...values].filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const sum = sorted.reduce((s, v) => s + v, 0);
  if (sum === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * sorted[i]!;
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

/**
 * Lorenz curve sampled to about `maxPoints` points. Sorted ASCENDING input
 * is preferred but the function will sort defensively.
 */
export function computeLorenz(
  values: number[],
  maxPoints = 50,
): Array<{ p_groups: number; p_value: number }> {
  const sorted = [...values].filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const n = sorted.length;
  const total = sorted.reduce((s, v) => s + v, 0);
  if (n === 0 || total === 0) return [{ p_groups: 0, p_value: 0 }];
  const step = Math.max(1, Math.floor(n / maxPoints));
  const out: Array<{ p_groups: number; p_value: number }> = [{ p_groups: 0, p_value: 0 }];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += sorted[i]!;
    if (i % step === 0 || i === n - 1) {
      out.push({
        p_groups: +((i + 1) / n).toFixed(4),
        p_value: +(acc / total).toFixed(4),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- chart-spec presets

/** Chart-spec presets that complement the analytics helpers above. */

export function lorenzChartData(curve: Array<{ p_groups: number; p_value: number }>): Array<Record<string, number>> {
  // Identity-pass; provided so callers can pipeline analytics → charts symmetrically.
  return curve.map((p) => ({ p_groups: p.p_groups, p_value: p.p_value }));
}

export function histogramChartData(h: Histogram): Array<Record<string, number>> {
  return h.buckets.map((b) => ({ from: b.from, count: b.count }));
}

export function bucketChartData<T>(buckets: Array<BucketResult<T>>): Array<Record<string, number | string>> {
  return buckets.map((b) => ({ tier: b.label, count: b.count, total: b.total, share: +b.share.toFixed(4) }));
}
