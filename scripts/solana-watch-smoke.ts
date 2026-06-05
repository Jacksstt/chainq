/**
 * Offline smoke test for the Solana Yellowstone watch path.
 *
 * Injects a deterministic mock firehose (no gRPC endpoint, no network),
 * runs `runSolanaWatch`, and asserts: vote filtering, per-slot batching,
 * Parquet shard contents, checkpointing, and resume idempotency.
 *
 *   pnpm exec tsx scripts/solana-watch-smoke.ts
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { runSolanaWatch, type SolanaWatchCheckpoint } from "../packages/cli/src/watch-solana.ts";
import { mockYellowstoneSource, type YellowstoneUpdate } from "../packages/ingest-solana/src/index.ts";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`[solana-watch-smoke] FAIL: ${msg}`);
    process.exit(1);
  }
}

function tx(
  slot: number,
  signature: string,
  o: { success?: boolean; fee?: number; isVote?: boolean; keys?: string[] } = {},
): YellowstoneUpdate {
  return {
    transaction: {
      slot,
      signature,
      success: o.success ?? true,
      feeLamports: o.fee ?? 5000,
      isVote: o.isVote ?? false,
      accountKeys: o.keys ?? ["Acc1111", "Acc2222"],
    },
  };
}

const updates: YellowstoneUpdate[] = [
  tx(100, "sigA"),
  tx(100, "sigVote", { isVote: true }), // filtered out
  tx(100, "sigB"),
  tx(101, "sigC"),
  tx(101, "sigD", { success: false }),
  tx(102, "sigE", { keys: ["Acc1111", "Acc3333", "Acc4444"] }),
];

async function main(): Promise<void> {
  const out = mkdtempSync(join(tmpdir(), "chainq-solana-watch-"));
  console.error(`[solana-watch-smoke] outDir=${out}`);

  const r1 = await runSolanaWatch({
    source: mockYellowstoneSource(updates),
    outDir: out,
    fromSlot: 100,
    maxRowsPerShard: 1000,
    log: () => {},
  });
  assert(r1.rows === 5, `expected 5 rows (votes filtered), got ${r1.rows}`);
  assert(r1.batches === 3, `expected 3 slot-batches, got ${r1.batches}`);
  assert(r1.shardsWritten.length === 1, `expected 1 shard, got ${r1.shardsWritten.length}`);
  assert(r1.slotTo === 102, `expected slotTo=102, got ${r1.slotTo}`);
  console.error(`[solana-watch-smoke] first: rows=${r1.rows} batches=${r1.batches} slotTo=${r1.slotTo}`);

  // Parquet content check.
  const conn = await (await DuckDBInstance.create(":memory:")).connect();
  const shard = r1.shardsWritten[0]!;
  const rows = await (await conn.runAndReadAll(
    `SELECT signature, slot, success, len(account_keys) AS nkeys FROM read_parquet('${shard}') ORDER BY signature`,
  )).getRowObjects();
  assert(rows.length === 5, `parquet should have 5 rows, got ${rows.length}`);
  const failed = await (await conn.runAndReadAll(
    `SELECT COUNT(*) c FROM read_parquet('${shard}') WHERE success = false`,
  )).getRowObjects();
  assert(Number(failed[0]!["c"]) === 1, `expected 1 failed tx, got ${failed[0]!["c"]}`);
  const sigE = rows.find((r) => r["signature"] === "sigE")!;
  assert(Number(sigE["nkeys"]) === 3, `sigE should carry 3 account keys, got ${sigE["nkeys"]}`);
  conn.disconnectSync();
  console.error(`[solana-watch-smoke] parquet: 5 rows, 1 failed, sigE keys=3 — list column intact`);

  // Resume idempotency: same updates, all slots <= checkpoint → 0 new rows.
  const r2 = await runSolanaWatch({
    source: mockYellowstoneSource(updates),
    outDir: out,
    fromSlot: 0,
    maxRowsPerShard: 1000,
    log: () => {},
  });
  assert(r2.rows === 0, `expected 0 rows on resume, got ${r2.rows}`);
  const cp = JSON.parse(readFileSync(join(out, ".checkpoint-solana.json"), "utf8")) as SolanaWatchCheckpoint;
  assert(cp.lastSlot === 102, `checkpoint lastSlot should be 102, got ${cp.lastSlot}`);
  assert(cp.totalRows === 5, `checkpoint totalRows should be 5, got ${cp.totalRows}`);
  console.error(`[solana-watch-smoke] resume: rows=${r2.rows} (idempotent), checkpoint lastSlot=${cp.lastSlot}`);

  console.error("[solana-watch-smoke] ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
