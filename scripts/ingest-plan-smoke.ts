#!/usr/bin/env tsx
/**
 * Offline smoke test for multi-machine ingest planning + shard merge.
 *
 * Part 1 (pure): `splitRangePlan` must produce contiguous, non-overlapping,
 * gap-free slices whose union equals the input range, with balanced sizes and
 * a sane fallback when workers > blocks.
 *
 * Part 2 (DuckDB): build two tiny single-column Parquet files, merge them with
 * `mergeShards`, read the output back and assert the row count equals the sum
 * of the inputs.
 */

import { splitRangePlan, mergeShards } from "../packages/cli/src/ingest-plan.ts";
import { DuckDBInstance } from "@duckdb/node-api";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

/** Assert a plan covers [from,to] exactly: contiguous, no gaps, no overlaps. */
function assertFullCoverage(
  plans: { worker: number; fromBlock: number; toBlock: number }[],
  from: number,
  to: number,
  label: string,
): void {
  assert.ok(plans.length >= 1, `${label}: expected at least one slice`);
  // worker indices are 0..n-1, in order.
  plans.forEach((p, i) => {
    assert.equal(p.worker, i, `${label}: worker index ${i} mismatch (got ${p.worker})`);
    assert.ok(p.toBlock >= p.fromBlock, `${label}: slice ${i} inverted ${p.fromBlock}..${p.toBlock}`);
  });
  // First slice starts at `from`, last ends at `to`.
  assert.equal(plans[0]!.fromBlock, from, `${label}: first slice must start at ${from}`);
  assert.equal(plans[plans.length - 1]!.toBlock, to, `${label}: last slice must end at ${to}`);
  // Each slice begins exactly where the previous ended + 1 (contiguous, gap-free, no overlap).
  for (let i = 1; i < plans.length; i++) {
    assert.equal(
      plans[i]!.fromBlock,
      plans[i - 1]!.toBlock + 1,
      `${label}: gap/overlap between slice ${i - 1} and ${i}`,
    );
  }
  // Total covered block count == range size.
  const covered = plans.reduce((acc, p) => acc + (p.toBlock - p.fromBlock + 1), 0);
  assert.equal(covered, to - from + 1, `${label}: covered ${covered} != range ${to - from + 1}`);
}

/** Write a single-column (i BIGINT) Parquet file with `n` rows. */
async function writeTinyParquet(path: string, n: number): Promise<void> {
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  try {
    await conn.run(
      `COPY (SELECT i FROM range(0, ${n}) t(i)) TO '${path}' (FORMAT parquet)`,
    );
  } finally {
    conn.disconnectSync();
  }
}

async function main() {
  // ---- Part 1: splitRangePlan invariants ----

  // 0..99 / 4 → four slices of 25, contiguous, balanced.
  {
    const plans = splitRangePlan({ chain: "ethereum", fromBlock: 0, toBlock: 99, workers: 4 });
    assert.equal(plans.length, 4, "0..99/4 should be 4 slices");
    assertFullCoverage(plans, 0, 99, "0..99/4");
    const sizes = plans.map((p) => p.toBlock - p.fromBlock + 1);
    assert.deepEqual(sizes, [25, 25, 25, 25], "0..99/4 sizes should all be 25");
    for (const p of plans) assert.equal(p.chain, "ethereum", "chain propagated");
  }

  // 0..100 / 3 → 101 blocks, base 33, remainder 2 absorbed by last (33,33,35).
  {
    const plans = splitRangePlan({ chain: "base", fromBlock: 0, toBlock: 100, workers: 3 });
    assert.equal(plans.length, 3, "0..100/3 should be 3 slices");
    assertFullCoverage(plans, 0, 100, "0..100/3");
    const sizes = plans.map((p) => p.toBlock - p.fromBlock + 1);
    assert.deepEqual(sizes, [33, 33, 35], "0..100/3 sizes (last absorbs remainder)");
  }

  // Non-zero offset: 1000..1009 / 3 → base 3, remainder 1 (3,3,4).
  {
    const plans = splitRangePlan({ chain: "base", fromBlock: 1000, toBlock: 1009, workers: 3 });
    assertFullCoverage(plans, 1000, 1009, "1000..1009/3");
    const sizes = plans.map((p) => p.toBlock - p.fromBlock + 1);
    assert.deepEqual(sizes, [3, 3, 4], "1000..1009/3 sizes");
  }

  // Single block, 1 worker.
  {
    const plans = splitRangePlan({ chain: "base", fromBlock: 50, toBlock: 50, workers: 1 });
    assert.equal(plans.length, 1, "single-block single-worker → 1 slice");
    assertFullCoverage(plans, 50, 50, "50..50/1");
  }

  // workers > range: 0..4 (5 blocks) / 10 → capped to 5 slices of one block each.
  {
    const plans = splitRangePlan({ chain: "base", fromBlock: 0, toBlock: 4, workers: 10 });
    assert.equal(plans.length, 5, "workers>blocks should cap at block count");
    assertFullCoverage(plans, 0, 4, "0..4/10");
    for (const p of plans) {
      assert.equal(p.toBlock - p.fromBlock + 1, 1, "each capped slice is 1 block");
    }
  }

  // Error cases.
  assert.throws(
    () => splitRangePlan({ chain: "x", fromBlock: 0, toBlock: 10, workers: 0 }),
    /workers must be an integer >= 1/,
    "workers<1 should throw",
  );
  assert.throws(
    () => splitRangePlan({ chain: "x", fromBlock: 10, toBlock: 5, workers: 2 }),
    /must be >= fromBlock/,
    "to<from should throw",
  );

  console.log("[ingest-plan-smoke] splitRangePlan invariants ok");

  // ---- Part 2: mergeShards round-trip ----

  const dir = mkdtempSync(join(tmpdir(), "chainq-merge-"));
  const shardA = join(dir, "shard-a.parquet");
  const shardB = join(dir, "shard-b.parquet");
  const outPath = join(dir, "merged.parquet");

  const rowsA = 7;
  const rowsB = 5;
  await writeTinyParquet(shardA, rowsA);
  await writeTinyParquet(shardB, rowsB);
  assert.ok(existsSync(shardA) && existsSync(shardB), "input shards should exist");

  const merged = await mergeShards([shardA, shardB], outPath);
  assert.equal(merged.outPath, outPath, "mergeShards returns the out path");
  assert.ok(existsSync(outPath), "merged parquet should exist on disk");
  assert.equal(merged.rows, rowsA + rowsB, `merged rows should be ${rowsA + rowsB}`);

  // Independently read it back to double-check the on-disk count.
  {
    const instance = await DuckDBInstance.create(":memory:");
    const conn = await instance.connect();
    try {
      const reader = await conn.runAndReadAll(
        `SELECT count(*) AS n FROM read_parquet('${outPath}')`,
      );
      const row = reader.getRowObjects()[0];
      const n = row ? Number(row["n"]) : -1;
      assert.equal(n, rowsA + rowsB, `re-read count should be ${rowsA + rowsB}`);
    } finally {
      conn.disconnectSync();
    }
  }

  // Empty list must throw a clear error.
  await assert.rejects(
    () => mergeShards([], outPath),
    /shardPaths is empty/,
    "empty shard list should reject",
  );

  console.log("[ingest-plan-smoke] mergeShards round-trip ok");
  console.log("[ingest-plan-smoke] ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
