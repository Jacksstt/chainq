#!/usr/bin/env tsx
/**
 * Offline smoke test for `chainq labels sync` — verifies the label providers,
 * dedupe, and parquet writer without hitting the network.
 *
 * Strategy: inject a `fetch` that REJECTS so the OFAC provider exercises its
 * bundled-fixture fallback, then assert that:
 *  - the parquet file was written
 *  - it contains ≥1 row for each expected label (sanctioned/weth/
 *    erc4337_entrypoint/stablecoin)
 *  - there are no exact (address, chain, label) duplicates
 */

import { syncLabels } from "../packages/snapshot/src/index.ts";
import { DuckDBInstance } from "@duckdb/node-api";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

// A fetch stub that always rejects, forcing the OFAC fixture fallback path.
const rejectingFetch: typeof globalThis.fetch = async () => {
  throw new Error("network disabled in smoke test");
};

async function scalar(
  conn: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  sql: string,
): Promise<number> {
  const reader = await conn.runAndReadAll(`SELECT (${sql}) AS n`);
  const rows = reader.getRowObjects();
  const first = rows[0];
  assert.ok(first, `query returned no rows: ${sql}`);
  return Number(first["n"]);
}

async function main() {
  const outDir = mkdtempSync(join(tmpdir(), "chainq-labels-"));
  console.log(`[labels-smoke] outDir=${outDir}`);

  const result = await syncLabels({ outDir, fetch: rejectingFetch });
  console.log(`[labels-smoke] wrote ${result.count} labels; bySource=${JSON.stringify(result.bySource)}`);

  assert.ok(existsSync(result.outputPath), `parquet missing: ${result.outputPath}`);
  assert.ok(result.count > 0, "expected at least one label");

  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  const src = `'${result.outputPath}'`;

  for (const label of ["sanctioned", "weth", "erc4337_entrypoint", "stablecoin"]) {
    const n = await scalar(
      conn,
      `SELECT COUNT(*) FROM read_parquet(${src}) WHERE label = '${label}'`,
    );
    assert.ok(n >= 1, `expected ≥1 row with label='${label}', got ${n}`);
    console.log(`[labels-smoke]   label='${label}': ${n} rows`);
  }

  const total = await scalar(conn, `SELECT COUNT(*) FROM read_parquet(${src})`);
  const distinct = await scalar(
    conn,
    `SELECT COUNT(DISTINCT (address || '|' || chain || '|' || label)) FROM read_parquet(${src})`,
  );
  assert.equal(total, distinct, `duplicate (address,chain,label) rows: total=${total} distinct=${distinct}`);
  console.log(`[labels-smoke]   no duplicates: total=${total} == distinct=${distinct}`);

  conn.disconnectSync();
  console.log("[labels-smoke] ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
