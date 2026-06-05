#!/usr/bin/env tsx
/**
 * Offline smoke test for `@chainq/engine-trino` — verifies the Trino REST
 * statement protocol handling without hitting a live coordinator.
 *
 * Strategy: inject a mock `fetch` that simulates the page chain:
 *   POST <url>/v1/statement   → page 1: columns + nextUri, no data
 *   GET  <nextUri page 1>     → page 2: data rows, no nextUri (final)
 *
 * Asserts that:
 *  - rows are assembled correctly across pages (keyed by column name)
 *  - columnTypes are mapped from columns[].type
 *  - the required Trino headers are present on the requests
 *  - actualSeconds / actualBytes come from the final page stats
 *  - an `error` field in a page surfaces as a thrown Error
 */

import { TrinoEngine } from "../packages/engine-trino/src/index.ts";
import assert from "node:assert/strict";

const BASE = "https://trino.mock.test";
const STATEMENT_URL = `${BASE}/v1/statement`;
const NEXT_URI = `${BASE}/v1/statement/queued/q-123/1`;

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function headersToObject(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  const h = init?.headers;
  if (h === undefined) return out;
  if (h instanceof Headers) {
    h.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
  } else if (Array.isArray(h)) {
    for (const [k, v] of h) out[k.toLowerCase()] = v;
  } else {
    for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  }
  return out;
}

function makeMockFetch(captured: Captured[]): typeof globalThis.fetch {
  return async (url, init) => {
    const u = typeof url === "string" ? url : url.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = headersToObject(init);
    captured.push({
      url: u,
      method,
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    });

    // Page 1: submission returns columns + nextUri, but NO data yet.
    if (method === "POST" && u === STATEMENT_URL) {
      const page = {
        id: "q-123",
        nextUri: NEXT_URI,
        columns: [
          { name: "block_number", type: "bigint" },
          { name: "tx_hash", type: "varchar" },
        ],
        stats: { state: "RUNNING", elapsedTimeMillis: 10, processedBytes: 100 },
      };
      return new Response(JSON.stringify(page), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // Page 2: final page carries the data rows and NO nextUri.
    if (method === "GET" && u === NEXT_URI) {
      const page = {
        id: "q-123",
        // no nextUri → terminal page
        data: [
          [1000, "0xaaa"],
          [1001, "0xbbb"],
          [1002, "0xccc"],
        ],
        stats: { state: "FINISHED", elapsedTimeMillis: 1234, processedBytes: 5678 },
      };
      return new Response(JSON.stringify(page), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(`unexpected ${method} ${u}`, { status: 404 });
  };
}

async function testHappyPath(): Promise<void> {
  const captured: Captured[] = [];
  const engine = new TrinoEngine({
    url: BASE,
    catalog: "iceberg",
    schema: "base",
    user: "tester",
    fetch: makeMockFetch(captured),
  });

  const result = await engine.query("SELECT block_number, tx_hash FROM t");

  // --- rows assembled correctly across pages ---
  assert.equal(result.rows.length, 3, "expected 3 rows");
  assert.deepEqual(
    result.rows[0],
    { block_number: 1000, tx_hash: "0xaaa" },
    "row 0 should be keyed by column name",
  );
  assert.deepEqual(result.rows[2], { block_number: 1002, tx_hash: "0xccc" });

  // --- columnTypes mapped from columns[].type (seen only on page 1) ---
  assert.deepEqual(
    result.columnTypes,
    { block_number: "bigint", tx_hash: "varchar" },
    "columnTypes should map name→type",
  );

  // --- stats from the final page ---
  assert.equal(result.actualRows, 3);
  assert.equal(result.actualBytes, 5678, "bytes from final page stats");
  assert.equal(result.actualSeconds, 1.234, "seconds = elapsedTimeMillis/1000");
  assert.equal(result.truncated, false);

  // --- two requests: POST submit, then GET nextUri ---
  assert.equal(captured.length, 2, "expected POST + GET");
  assert.equal(captured[0]?.method, "POST");
  assert.equal(captured[0]?.url, STATEMENT_URL);
  assert.equal(captured[0]?.body, "SELECT block_number, tx_hash FROM t");
  assert.equal(captured[1]?.method, "GET");
  assert.equal(captured[1]?.url, NEXT_URI);

  // --- required Trino headers present on the POST ---
  const h = captured[0]?.headers ?? {};
  assert.equal(h["x-trino-user"], "tester", "X-Trino-User header");
  assert.equal(h["x-trino-catalog"], "iceberg", "X-Trino-Catalog header");
  assert.equal(h["x-trino-schema"], "base", "X-Trino-Schema header");
  // GET nextUri must still carry the user header.
  assert.equal(captured[1]?.headers["x-trino-user"], "tester");

  console.log("[trino-smoke] happy path: rows/columns/headers/stats ok");
}

async function testDefaultUser(): Promise<void> {
  const captured: Captured[] = [];
  const engine = new TrinoEngine({ url: BASE, fetch: makeMockFetch(captured) });
  await engine.query("SELECT 1 FROM t");
  assert.equal(
    captured[0]?.headers["x-trino-user"],
    "chainq",
    "default user should be 'chainq'",
  );
  console.log("[trino-smoke] default user 'chainq' ok");
}

async function testMaxRows(): Promise<void> {
  const captured: Captured[] = [];
  const engine = new TrinoEngine({ url: BASE, fetch: makeMockFetch(captured) });
  const result = await engine.query("SELECT * FROM t", { maxRows: 2 });
  assert.equal(result.rows.length, 2, "maxRows should slice to 2");
  assert.equal(result.truncated, true, "truncated flag should be set");
  console.log("[trino-smoke] maxRows truncation ok");
}

async function testErrorField(): Promise<void> {
  const errorFetch: typeof globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: "q-err",
        error: { message: "line 1:8: Column 'nope' cannot be resolved", errorName: "COLUMN_NOT_FOUND" },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const engine = new TrinoEngine({ url: BASE, fetch: errorFetch });
  await assert.rejects(
    () => engine.query("SELECT nope FROM t"),
    /COLUMN_NOT_FOUND.*cannot be resolved/,
    "an error field should throw a clear Error",
  );
  console.log("[trino-smoke] error field surfaces as thrown Error ok");
}

async function testEstimate(): Promise<void> {
  const engine = new TrinoEngine({ url: BASE, fetch: makeMockFetch([]) });
  const est = await engine.estimate("SELECT * FROM big_table");
  assert.equal(est.estimatedCredits, 0, "estimatedCredits must be 0");
  assert.ok(est.warnings.length >= 1, "estimate should carry a warning");
  console.log("[trino-smoke] estimate heuristic ok");
}

async function main(): Promise<void> {
  await testHappyPath();
  await testDefaultUser();
  await testMaxRows();
  await testErrorField();
  await testEstimate();
  console.log("[trino-smoke] ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
