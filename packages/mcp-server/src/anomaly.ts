/**
 * Quantitative anomaly detection — z-score / IQR / threshold helpers.
 *
 * Reports that say "X is unusual" without a magnitude lose the rubric
 * score on `anomaly_callouts`. These helpers produce numbered outliers
 * the writer can hand straight to `anomalyCallout()`.
 */

export interface AnomalyOptions {
  /** Z-score threshold (default 2.0 ≈ top / bottom 2.3%). */
  zThreshold?: number;
  /** Optional limit on returned anomalies (sorted by |z| descending). */
  limit?: number;
}

export interface AnomalyHit<T> {
  row: T;
  value: number;
  z: number;
  baseline: number;
  stdev: number;
  direction: "high" | "low";
}

/**
 * Z-score-based outlier detection over a list of rows + a numeric
 * accessor. Robust against unsorted input; returns rows where |z| ≥ threshold.
 */
export function findZScoreAnomalies<T>(
  rows: T[],
  value: (r: T) => number,
  opts: AnomalyOptions = {},
): AnomalyHit<T>[] {
  const threshold = opts.zThreshold ?? 2.0;
  const limit = opts.limit;
  const values = rows.map((r) => value(r)).filter((v) => Number.isFinite(v));
  if (values.length < 2) return [];
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stdev = Math.sqrt(variance);
  if (stdev === 0) return [];
  const hits = rows
    .map((r) => {
      const v = value(r);
      if (!Number.isFinite(v)) return null;
      const z = (v - mean) / stdev;
      return { row: r, value: v, z, baseline: mean, stdev, direction: z >= 0 ? "high" as const : "low" as const };
    })
    .filter((h): h is AnomalyHit<T> => h != null && Math.abs(h.z) >= threshold)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  return limit ? hits.slice(0, limit) : hits;
}

/**
 * IQR (interquartile range) outlier detection — more robust against
 * extreme values than z-score, useful for skewed distributions.
 * Tukey's fence: lower = Q1 - 1.5*IQR, upper = Q3 + 1.5*IQR.
 */
export function findIqrAnomalies<T>(
  rows: T[],
  value: (r: T) => number,
  opts: { multiplier?: number; limit?: number } = {},
): AnomalyHit<T>[] {
  const multiplier = opts.multiplier ?? 1.5;
  const limit = opts.limit;
  const values = rows.map((r) => value(r)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (values.length < 4) return [];
  const q = (p: number) => values[Math.floor((values.length - 1) * p)]!;
  const q1 = q(0.25);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  const lo = q1 - multiplier * iqr;
  const hi = q3 + multiplier * iqr;
  const median = q(0.5);
  const hits = rows
    .map((r) => {
      const v = value(r);
      if (!Number.isFinite(v) || (v >= lo && v <= hi)) return null;
      const z = (v - median) / Math.max(1e-9, iqr);
      return { row: r, value: v, z, baseline: median, stdev: iqr, direction: v > hi ? "high" as const : "low" as const };
    })
    .filter((h): h is AnomalyHit<T> => h != null)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  return limit ? hits.slice(0, limit) : hits;
}

export interface DistributionSummary {
  count: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  stdev: number;
}

export function describeDistribution<T>(rows: T[], value: (r: T) => number): DistributionSummary {
  const values = rows.map(value).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (values.length === 0) {
    return { count: 0, min: 0, q1: 0, median: 0, q3: 0, max: 0, mean: 0, stdev: 0 };
  }
  const q = (p: number) => values[Math.floor((values.length - 1) * p)]!;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return {
    count: values.length,
    min: values[0]!,
    q1: q(0.25),
    median: q(0.5),
    q3: q(0.75),
    max: values[values.length - 1]!,
    mean,
    stdev: Math.sqrt(variance),
  };
}
