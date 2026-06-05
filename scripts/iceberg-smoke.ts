#!/usr/bin/env tsx
/**
 * Offline smoke test for the Apache Iceberg READ path
 * (`packages/snapshot/src/iceberg.ts`).
 *
 * No real Iceberg table exists offline, so this is split into two parts:
 *  - GATING: pure string-builder assertions on `icebergScanSql` (quoting,
 *    escaping, exact output). These MUST pass — failure exits 1.
 *  - BEST-EFFORT: spin up an in-memory DuckDB and attempt
 *    `loadIcebergExtension`. The first INSTALL needs network; if that fails
 *    offline we CATCH it, print a clear note, and still exit 0.
 */

import assert from "node:assert/strict";

import { icebergScanSql, loadIcebergExtension } from "../packages/snapshot/src/iceberg.ts";

async function main() {
  // ---- GATING: string builder ----
  assert.equal(
    icebergScanSql("data/iceberg/swaps"),
    "SELECT * FROM iceberg_scan('data/iceberg/swaps')",
    "plain path should produce a single-quoted iceberg_scan call",
  );

  assert.equal(
    icebergScanSql("s3://bucket/tbl/metadata/v1.metadata.json"),
    "SELECT * FROM iceberg_scan('s3://bucket/tbl/metadata/v1.metadata.json')",
    "S3 metadata path should be passed through verbatim",
  );

  // Single quotes must be doubled so the emitted SQL literal stays valid.
  assert.equal(
    icebergScanSql("/tmp/o'brien/tbl"),
    "SELECT * FROM iceberg_scan('/tmp/o''brien/tbl')",
    "single quotes in the path must be escaped (doubled)",
  );

  assert.equal(
    icebergScanSql("a'b'c"),
    "SELECT * FROM iceberg_scan('a''b''c')",
    "every single quote must be doubled",
  );

  console.log("[iceberg-smoke] string-builder assertions ok");

  // ---- BEST-EFFORT: real extension load (may need network) ----
  try {
    const { DuckDBInstance } = await import("@duckdb/node-api");
    const instance = await DuckDBInstance.create(":memory:");
    const conn = await instance.connect();
    await loadIcebergExtension(conn);
    conn.disconnectSync();
    console.log("[iceberg-smoke] iceberg extension installed + loaded");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`[iceberg-smoke] extension unavailable offline (expected): ${msg}`);
  }

  console.log("[iceberg-smoke] ok");
}

main().catch((e) => { console.error(e); process.exit(1); });
