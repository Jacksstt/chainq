/**
 * `chainq watch --chain solana` — realtime Solana ingest over the Yellowstone
 * gRPC firehose, with the same checkpoint + Parquet-shard discipline as the
 * EVM `runWatch`. Slot-based instead of block-based.
 *
 * The transport is injected (`YellowstoneSource`) so this is offline-testable
 * with `mockYellowstoneSource`. The CLI builds a real source from env
 * (`YELLOWSTONE_ENDPOINT` / `YELLOWSTONE_TOKEN`).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { streamYellowstone, type YellowstoneSource } from "@chainq/ingest-solana";
import { appendParquet } from "./watch.js";

export interface SolanaWatchOptions {
  source: YellowstoneSource;
  outDir: string;
  fromSlot?: number;
  toSlot?: number;
  maxRowsPerShard?: number;
  maxUpdates?: number;
  includeVotes?: boolean;
  log?: (m: string) => void;
}

export interface SolanaWatchCheckpoint {
  chain: "solana";
  lastSlot: number;
  totalRows: number;
  totalShards: number;
  firstSeenAt: string;
  lastUpdatedAt: string;
}

export interface SolanaWatchSummary {
  chain: "solana";
  slotFrom: number;
  slotTo: number;
  batches: number;
  rows: number;
  shardsWritten: string[];
  checkpointPath: string;
  elapsedSeconds: number;
}

export async function runSolanaWatch(opts: SolanaWatchOptions): Promise<SolanaWatchSummary> {
  const log = opts.log ?? ((m) => console.error(m));
  const outDir = resolve(opts.outDir);
  mkdirSync(outDir, { recursive: true });

  const checkpointPath = join(outDir, ".checkpoint-solana.json");
  let checkpoint: SolanaWatchCheckpoint | null = null;
  if (existsSync(checkpointPath)) {
    try {
      checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8")) as SolanaWatchCheckpoint;
    } catch (err) {
      log(`[watch] checkpoint unreadable, starting fresh: ${(err as Error).message}`);
      checkpoint = null;
    }
  }
  const fromSlot = checkpoint ? Math.max(opts.fromSlot ?? 0, checkpoint.lastSlot + 1) : (opts.fromSlot ?? 0);
  log(`[watch] chain=solana from-slot=${fromSlot}${opts.toSlot != null ? ` to=${opts.toSlot}` : " (follow head)"}`);

  const started = Date.now();
  const shardsWritten: string[] = [];
  let batches = 0;
  let totalRows = 0;
  let highSlot = fromSlot - 1;

  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  const maxRows = opts.maxRowsPerShard ?? 50_000;
  let buf: Array<Record<string, unknown>> = [];
  let shardSeq = checkpoint?.totalShards ?? 0;

  const flush = async () => {
    if (buf.length === 0) return;
    const path = join(outDir, `solana.txs.${String(shardSeq).padStart(6, "0")}.parquet`);
    await appendParquet(conn, path, buf);
    shardsWritten.push(path);
    log(`[watch] wrote ${buf.length} rows → ${path} (highSlot=${highSlot})`);
    buf = [];
    shardSeq += 1;
  };

  try {
    const stream = streamYellowstone({
      source: opts.source,
      ...(fromSlot ? { fromSlot } : {}),
      ...(opts.toSlot != null ? { toSlot: opts.toSlot } : {}),
      ...(opts.maxUpdates != null ? { maxUpdates: opts.maxUpdates } : {}),
      ...(opts.includeVotes != null ? { includeVotes: opts.includeVotes } : {}),
    });
    for await (const b of stream) {
      batches += 1;
      for (const tx of b.txs) {
        buf.push({ chain: "solana", ...tx });
        totalRows += 1;
      }
      highSlot = Math.max(highSlot, b.slot);
      if (buf.length >= maxRows) await flush();
    }
    await flush();
  } finally {
    conn.disconnectSync();
    await opts.source.close?.();
  }

  const now = new Date().toISOString();
  const cp: SolanaWatchCheckpoint = {
    chain: "solana",
    lastSlot: highSlot,
    totalRows: (checkpoint?.totalRows ?? 0) + totalRows,
    totalShards: shardSeq,
    firstSeenAt: checkpoint?.firstSeenAt ?? now,
    lastUpdatedAt: now,
  };
  const tmp = checkpointPath + ".tmp";
  writeFileSync(tmp, JSON.stringify(cp, null, 2));
  renameSync(tmp, checkpointPath);

  return {
    chain: "solana",
    slotFrom: fromSlot,
    slotTo: highSlot,
    batches,
    rows: totalRows,
    shardsWritten,
    checkpointPath,
    elapsedSeconds: (Date.now() - started) / 1000,
  };
}
