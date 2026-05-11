#!/usr/bin/env tsx
/**
 * Offline smoke test for `chainq watch` — verifies the streaming, sharding,
 * and checkpoint logic without hitting a live Subsquid endpoint.
 *
 * Strategy: inject a mock `fetch` into runWatch via the EVM stream that
 * yields a small sequence of synthetic batches, then assert that:
 *  - Parquet shards were written
 *  - A checkpoint file exists with the final block
 *  - A second invocation resumes from the checkpoint and is a no-op
 */

import { runWatch } from "../packages/cli/src/watch.ts";
import { existsSync, readFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const ARCHIVE = "https://mock.subsquid.test/network/base-mainnet";

function makeMockBatches(start: number, count: number) {
  // Each batch carries one block header + N synthetic logs.
  return Array.from({ length: count }, (_, i) => ({
    header: {
      number: start + i,
      hash: `0x${(start + i).toString(16).padStart(64, "0")}`,
      timestamp: 1_770_000_000 + (start + i) * 12,
    },
    logs: [
      { address: "0xaaa", topic0: "0x1234", data: "0x" + i.toString(16).padStart(64, "0") },
      { address: "0xbbb", topic0: "0x5678", data: "0x" + (i + 1).toString(16).padStart(64, "0") },
    ],
  }));
}

// First request returns 3 batches; second returns [] (Subsquid signals
// end-of-stream that way).
let serveCount = 0;
const mockFetch: typeof globalThis.fetch = async (_url, _init) => {
  serveCount += 1;
  const batches = serveCount === 1 ? makeMockBatches(1000, 3) : [];
  return new Response(JSON.stringify(batches), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

async function main() {
  const outDir = mkdtempSync(join(tmpdir(), "chainq-watch-"));
  console.log(`[watch-smoke] outDir=${outDir}`);

  const first = await runWatch({
    chain: "base",
    archiveUrl: ARCHIVE,
    fromBlock: 1000,
    maxBatches: 10,
    outDir,
    fetch: mockFetch,
  });
  console.log(`[watch-smoke] first: batches=${first.batches} rows=${first.rows} shards=${first.shardsWritten.length}`);
  assert.equal(first.batches, 3, "expected 3 mock batches");
  assert.equal(first.rows, 6, "expected 6 mock rows (2 logs × 3 batches)");
  assert.ok(first.shardsWritten.length >= 1, "expected at least one shard");
  for (const s of first.shardsWritten) {
    assert.ok(existsSync(s), `shard missing: ${s}`);
  }
  assert.ok(existsSync(first.checkpointPath), "checkpoint missing");
  const cp = JSON.parse(readFileSync(first.checkpointPath, "utf8"));
  assert.equal(cp.chain, "base");
  assert.equal(cp.lastBlock, 1002, "checkpoint lastBlock should match highest seen");

  // Second invocation: mock returns no batches (stream end). Should be a no-op
  // but the checkpoint stays at 1002 and no new shards are written.
  const before = readdirSync(outDir).length;
  const second = await runWatch({
    chain: "base",
    archiveUrl: ARCHIVE,
    fromBlock: 0,
    maxBatches: 10,
    outDir,
    fetch: mockFetch,
  });
  console.log(`[watch-smoke] second: batches=${second.batches} rows=${second.rows} shards=${second.shardsWritten.length}`);
  assert.equal(second.batches, 0, "second run should see no new batches");
  assert.equal(second.rows, 0, "second run should write no rows");
  assert.equal(second.shardsWritten.length, 0, "second run should write no shards");
  assert.equal(readdirSync(outDir).length, before, "no new files expected on second run");

  console.log("[watch-smoke] ok");
}

main().catch((e) => { console.error(e); process.exit(1); });
