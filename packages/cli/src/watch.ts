/**
 * `chainq watch` — realtime block stream with checkpointing.
 *
 * Strategy:
 *   1. Read a JSON checkpoint file at `<dataDir>/.checkpoint-<chain>.json`.
 *      Resume from `lastBlock + 1` if it exists, else from `fromBlock`.
 *   2. Pull batches from a Subsquid archive via `streamSubsquid()`.
 *   3. For each batch, append the rows to a chain-local Parquet shard
 *      (`<dataDir>/<chain>.<table>.<batchSeq>.parquet`), keeping shards
 *      under `maxRowsPerShard` for sane DuckDB read latency.
 *   4. After each successful flush, update the checkpoint atomically
 *      (write to `.tmp`, then rename).
 *
 * Reorg handling is intentionally minimal in this milestone — Subsquid's
 * archive already serves finalised blocks, so reorg risk at archive read
 * time is bounded. When we move to a hot path that follows the chain
 * head, we'll add a roll-back-N-blocks safeguard.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

export interface WatchOptions {
  chain: string;
  archiveUrl: string;
  fromBlock: number;
  toBlock?: number;
  outDir: string;
  /** Approximate rows per emitted shard. */
  maxRowsPerShard?: number;
  /** Cap the number of batches we accept per invocation (testing). */
  maxBatches?: number;
  /** Inject fetch (for offline tests / record-replay). */
  fetch?: typeof globalThis.fetch;
  /** Subsquid request shape; defaults to logs-only over all addresses. */
  request?: {
    logs?: { address?: string[]; topic0?: string[] }[];
  };
  /** Optional logger; defaults to console.error. */
  log?: (msg: string) => void;
  /**
   * Reorg-safety: when set, rewind the resume cursor by N blocks before
   * the next pull, so the most recent N blocks are re-fetched and any
   * minor reorg is corrected on the next iteration. Subsquid's v2 archive
   * serves finalised blocks (so the default is 0), but if you're pointing
   * at a head-following archive, set this to your chain's finality
   * tolerance (e.g. 12 for Ethereum, 30 for Polygon).
   */
  reorgBufferBlocks?: number;
}

export interface WatchCheckpoint {
  chain: string;
  lastBlock: number;
  totalRows: number;
  totalBatches: number;
  firstSeenAt: string;
  lastUpdatedAt: string;
}

export interface WatchSummary {
  chain: string;
  rangeFrom: number;
  rangeTo: number;
  batches: number;
  rows: number;
  shardsWritten: string[];
  checkpointPath: string;
  elapsedSeconds: number;
}

/**
 * Run a single watch session and return a summary. Caller decides whether
 * to loop / cron / daemonize.
 */
export async function runWatch(opts: WatchOptions): Promise<WatchSummary> {
  const log = opts.log ?? ((m) => console.error(m));
  const outDir = resolve(opts.outDir);
  mkdirSync(outDir, { recursive: true });

  const checkpointPath = join(outDir, `.checkpoint-${opts.chain}.json`);
  let checkpoint: WatchCheckpoint | null = null;
  if (existsSync(checkpointPath)) {
    try {
      checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8")) as WatchCheckpoint;
    } catch (err) {
      log(`[watch] checkpoint unreadable, starting fresh: ${(err as Error).message}`);
      checkpoint = null;
    }
  }
  // Reorg-safe resume: if a buffer is configured, rewind the cursor by
  // `reorgBufferBlocks` so the most recent N blocks are re-fetched on
  // every run. Re-fetching overwrites the existing shard cleanly (Parquet
  // shards are append-only per invocation, named by sequence; the next
  // invocation produces a new shard so duplicates are detectable downstream
  // by `(block_number, log_index)` dedup if needed).
  const buffer = Math.max(0, Math.floor(opts.reorgBufferBlocks ?? 0));
  const fromBlock = checkpoint
    ? Math.max(opts.fromBlock, checkpoint.lastBlock + 1 - buffer)
    : opts.fromBlock;
  if (checkpoint && buffer > 0) {
    log(`[watch] reorg buffer: rewinding ${buffer} blocks from checkpoint ${checkpoint.lastBlock}`);
  }
  log(`[watch] chain=${opts.chain} from=${fromBlock}${opts.toBlock ? ` to=${opts.toBlock}` : " (follow head)"} archive=${opts.archiveUrl}`);

  const started = Date.now();
  const shardsWritten: string[] = [];
  let totalBatches = 0;
  let totalRows = 0;
  let highBlock = fromBlock - 1;

  // Lazy import the EVM stream so the CLI stays slim.
  const { streamSubsquid } = await import("@chainq/ingest-evm");

  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();

  const maxRows = opts.maxRowsPerShard ?? 50_000;
  let bufRows: Array<Record<string, unknown>> = [];
  let bufHighBlock = highBlock;
  let shardSeq = (checkpoint?.totalBatches ?? 0);

  const flushShard = async () => {
    if (bufRows.length === 0) return;
    const path = join(outDir, `${opts.chain}.logs.${String(shardSeq).padStart(6, "0")}.parquet`);
    await appendParquet(conn, path, bufRows);
    shardsWritten.push(path);
    log(`[watch] wrote ${bufRows.length} rows → ${path} (highBlock=${bufHighBlock})`);
    bufRows = [];
    shardSeq += 1;
  };

  try {
    const stream = streamSubsquid({
      archiveUrl: opts.archiveUrl,
      fromBlock,
      ...(opts.toBlock != null ? { toBlock: opts.toBlock } : {}),
      request: opts.request ?? { logs: [{}] },
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
    for await (const batch of stream) {
      totalBatches += 1;
      const logs = batch.logs ?? [];
      const header = batch.header;
      // Project logs to a stable row shape independent of Subsquid field order.
      for (const lg of logs) {
        const row = lg as Record<string, unknown>;
        bufRows.push({
          chain: opts.chain,
          block_number: header.number,
          block_hash: header.hash,
          block_time_unix: header.timestamp,
          ...row,
        });
        bufHighBlock = Math.max(bufHighBlock, header.number);
        totalRows += 1;
      }
      highBlock = Math.max(highBlock, header.number);
      if (bufRows.length >= maxRows) await flushShard();
      if (opts.maxBatches && totalBatches >= opts.maxBatches) break;
    }
    await flushShard();
  } finally {
    conn.disconnectSync();
  }

  const now = new Date().toISOString();
  const newCheckpoint: WatchCheckpoint = {
    chain: opts.chain,
    lastBlock: highBlock,
    totalRows: (checkpoint?.totalRows ?? 0) + totalRows,
    totalBatches: shardSeq,
    firstSeenAt: checkpoint?.firstSeenAt ?? now,
    lastUpdatedAt: now,
  };
  const tmpPath = checkpointPath + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(newCheckpoint, null, 2));
  renameSync(tmpPath, checkpointPath);

  return {
    chain: opts.chain,
    rangeFrom: fromBlock,
    rangeTo: highBlock,
    batches: totalBatches,
    rows: totalRows,
    shardsWritten,
    checkpointPath,
    elapsedSeconds: (Date.now() - started) / 1000,
  };
}

async function appendParquet(
  conn: DuckDBConnection,
  outPath: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  // Stage the rows as JSON in a tmp file, let DuckDB infer the schema with
  // read_json_auto, then COPY TO parquet. Tmp file is unlinked after.
  const stage = mkdtempSync(join(tmpdir(), "chainq-watch-"));
  const jsonPath = join(stage, "rows.json");
  try {
    writeFileSync(jsonPath, JSON.stringify(rows));
    const tableId = `watch_buf_${Math.random().toString(36).slice(2, 10)}`;
    await conn.run(`DROP TABLE IF EXISTS ${tableId}`);
    await conn.run(`CREATE TABLE ${tableId} AS SELECT * FROM read_json_auto('${jsonPath}', format='array')`);
    await conn.run(`COPY ${tableId} TO '${outPath}' (FORMAT 'parquet')`);
    await conn.run(`DROP TABLE ${tableId}`);
  } finally {
    try { rmSync(stage, { recursive: true, force: true }); } catch {}
  }
}
