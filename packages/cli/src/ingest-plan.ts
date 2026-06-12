/**
 * Multi-machine ingest planning + shard merge.
 *
 * `splitRangePlan` cuts a single inclusive block range into N contiguous,
 * non-overlapping, gap-free sub-ranges so each worker (machine) can backfill
 * one slice independently. `mergeShards` stitches the per-worker Parquet shards
 * back into one file with DuckDB's `read_parquet([...], union_by_name=true)`,
 * which tolerates shards whose column ordering differs.
 */

import { DuckDBInstance } from "@duckdb/node-api";

/** One worker's slice of a block range. Inclusive `fromBlock`..`toBlock`. */
export interface WorkerPlan {
  worker: number;
  chain: string;
  fromBlock: number;
  toBlock: number;
}

export interface SplitRangePlanOptions {
  chain: string;
  fromBlock: number;
  toBlock: number;
  workers: number;
}

/**
 * Split `[fromBlock, toBlock]` (inclusive) into `workers` contiguous,
 * non-overlapping, gap-free ranges, as evenly as possible. The last worker
 * absorbs any remainder so the union of all slices is exactly the input range.
 *
 * When `workers` exceeds the number of blocks, trailing workers would get
 * empty/inverted ranges; we cap the worker count at the block count so every
 * returned plan is a valid non-empty range. (Callers asking for more workers
 * than blocks simply get one slice per block.)
 *
 * @throws if `workers < 1` or `toBlock < fromBlock`.
 */
export function splitRangePlan(o: SplitRangePlanOptions): WorkerPlan[] {
  const { chain, fromBlock, toBlock, workers } = o;
  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error(`splitRangePlan: workers must be an integer >= 1 (got ${workers})`);
  }
  if (!Number.isFinite(fromBlock) || !Number.isFinite(toBlock)) {
    throw new Error(
      `splitRangePlan: fromBlock/toBlock must be finite numbers (got ${fromBlock}..${toBlock})`,
    );
  }
  if (toBlock < fromBlock) {
    throw new Error(
      `splitRangePlan: toBlock (${toBlock}) must be >= fromBlock (${fromBlock})`,
    );
  }

  const totalBlocks = toBlock - fromBlock + 1;
  // Never hand a worker an empty range: if there are fewer blocks than workers,
  // give one block per worker and stop.
  const effectiveWorkers = Math.min(workers, totalBlocks);

  const base = Math.floor(totalBlocks / effectiveWorkers);
  const remainder = totalBlocks - base * effectiveWorkers;

  const plans: WorkerPlan[] = [];
  let cursor = fromBlock;
  for (let w = 0; w < effectiveWorkers; w++) {
    // Distribute the remainder across the *last* slices via the last worker
    // absorbing it: every worker gets `base`, the final worker gets the rest.
    const isLast = w === effectiveWorkers - 1;
    const size = isLast ? base + remainder : base;
    const sliceFrom = cursor;
    const sliceTo = sliceFrom + size - 1;
    plans.push({ worker: w, chain, fromBlock: sliceFrom, toBlock: sliceTo });
    cursor = sliceTo + 1;
  }
  return plans;
}

export interface MergeShardsResult {
  rows: number;
  outPath: string;
}

/**
 * Merge several Parquet shards into a single Parquet file at `outPath`.
 *
 * Uses `read_parquet([...], union_by_name=true)` so shards whose columns are in
 * a different order (or have an extra/missing nullable column) still merge
 * cleanly by name. Returns the total row count written.
 *
 * @throws if `shardPaths` is empty.
 */
export async function mergeShards(
  shardPaths: string[],
  outPath: string,
): Promise<MergeShardsResult> {
  if (shardPaths.length === 0) {
    throw new Error("mergeShards: shardPaths is empty — nothing to merge");
  }

  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  try {
    const list = shardPaths.map((p) => quoteSqlString(p)).join(", ");
    const source = `read_parquet([${list}], union_by_name=true)`;

    // Write the merged file, then count what we wrote. We re-read the output
    // rather than the source so the count reflects exactly what landed on disk.
    await conn.run(
      `COPY (SELECT * FROM ${source}) TO ${quoteSqlString(outPath)} (FORMAT parquet)`,
    );

    const reader = await conn.runAndReadAll(
      `SELECT count(*) AS n FROM read_parquet(${quoteSqlString(outPath)})`,
    );
    const row = reader.getRowObjects()[0];
    const rows = row ? Number(row["n"]) : 0;

    return { rows, outPath };
  } finally {
    conn.disconnectSync();
  }
}

/**
 * Single-quote a string for inline SQL, escaping embedded quotes. File paths
 * here are operator-supplied (plan/merge args), not untrusted network input,
 * but quoting still guards against paths containing `'`.
 */
function quoteSqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
