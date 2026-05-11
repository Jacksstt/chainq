/**
 * `chainq ingest backfill` orchestrator.
 *
 * Drives `@chainq/snapshot`'s `pull()` over a list of (chain, fromBlock,
 * toBlock) ranges with bounded concurrency, gathering per-range successes
 * and failures so that a single bad range doesn't abort the whole job.
 */

import { pull, PUBLIC_ARCHIVES } from "@chainq/snapshot";

export interface BackfillRange {
  /** ethereum, base, polygon, arbitrum, optimism, ... */
  chain: string;
  fromBlock: number;
  toBlock: number;
  /** Optional log topic0 filter applied to this range only. */
  topic0?: string;
}

export interface BackfillOptions {
  ranges: BackfillRange[];
  outDir: string;
  /** Max concurrent pulls. Default 2. */
  concurrency?: number;
  /** Optional logger; defaults to console.error. */
  log?: (msg: string) => void;
}

export interface BackfillFailure {
  range: BackfillRange;
  error: string;
}

export interface BackfillResult {
  /** Ranges that completed without throwing. */
  ok: BackfillRange[];
  /** Ranges that failed (missing archive, pull threw, ...). */
  failed: BackfillFailure[];
  /** Sum of rows over all successful pulls. */
  totalRows: number;
  /** Wall-clock seconds for the whole backfill. */
  elapsedSeconds: number;
}

/**
 * Run `pull()` over each range with a bounded worker pool.
 *
 * Behaviour:
 *   - Missing `PUBLIC_ARCHIVES[chain]` → recorded as a failure, continues.
 *   - `pull()` throws → recorded as a failure, continues.
 *   - Order of results is not guaranteed; concurrency defaults to 2.
 */
export async function runBackfill(opts: BackfillOptions): Promise<BackfillResult> {
  const log = opts.log ?? ((msg) => console.error(msg));
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const ok: BackfillRange[] = [];
  const failed: BackfillFailure[] = [];
  let totalRows = 0;
  const startedAt = Date.now();

  // Tiny worker-pool: N workers pull from a shared index.
  let cursor = 0;
  const ranges = opts.ranges;

  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= ranges.length) return;
      const range = ranges[idx]!;
      const label = `${range.chain} [${range.fromBlock}..${range.toBlock}]`;
      const archiveUrl = PUBLIC_ARCHIVES[range.chain];
      if (!archiveUrl) {
        const error = `no public archive for chain '${range.chain}'`;
        log(`[backfill] skip ${label}: ${error}`);
        failed.push({ range, error });
        continue;
      }
      log(`[backfill] start ${label}`);
      try {
        const result = await pull({
          chain: range.chain,
          archiveUrl,
          fromBlock: range.fromBlock,
          toBlock: range.toBlock,
          outDir: opts.outDir,
          ...(range.topic0 ? { logFilter: { topic0: [range.topic0] } } : {}),
        });
        totalRows += result.rows;
        ok.push(range);
        log(`[backfill] done  ${label} rows=${result.rows}`);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        log(`[backfill] fail  ${label}: ${error}`);
        failed.push({ range, error });
      }
    }
  }

  const workers: Promise<void>[] = [];
  const n = Math.min(concurrency, Math.max(1, ranges.length));
  for (let i = 0; i < n; i++) workers.push(worker());
  await Promise.all(workers);

  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  return { ok, failed, totalRows, elapsedSeconds };
}
