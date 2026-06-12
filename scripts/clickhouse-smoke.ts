#!/usr/bin/env tsx
/**
 * Offline smoke test for `ClickHouseEngine` — verifies the HTTP driver against
 * a mock `fetch` that returns a canned ClickHouse `FORMAT JSON` response. No
 * live ClickHouse server is contacted.
 *
 * Asserts:
 *  - start() succeeds (SELECT 1 connectivity check hits the endpoint)
 *  - query() maps meta→columnTypes, data→rows, statistics→actualBytes/Seconds
 *  - maxRows truncation slices rows and sets `truncated`
 *  - auth headers (X-ClickHouse-User/Key), database + max_execution_time params
 *    are present on the captured request
 */

import { ClickHouseEngine } from "../packages/engine-clickhouse/src/index.ts";
import assert from "node:assert/strict";

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** Canned ClickHouse `FORMAT JSON` body with 3 data rows over 2 columns. */
const CANNED_JSON = JSON.stringify({
  meta: [
    { name: "address", type: "String" },
    { name: "cnt", type: "UInt64" },
  ],
  data: [
    { address: "0xaaa", cnt: 10 },
    { address: "0xbbb", cnt: 20 },
    { address: "0xccc", cnt: 30 },
  ],
  rows: 3,
  statistics: { elapsed: 0.042, rows_read: 3, bytes_read: 4096 },
});

/** Build a mock fetch that records every request and replays CANNED_JSON. */
function makeMockFetch(captured: CapturedRequest[]): typeof globalThis.fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders) {
      // init.headers is a plain object in our driver; normalise keys to lower-case.
      for (const [k, v] of Object.entries(rawHeaders as Record<string, string>)) {
        headers[k.toLowerCase()] = v;
      }
    }
    captured.push({
      url,
      method: (init?.method ?? "GET").toUpperCase(),
      headers,
      body: typeof init?.body === "string" ? init.body : String(init?.body ?? ""),
    });
    return new Response(CANNED_JSON, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

async function main() {
  // -------------------------------------------------------------------------
  // start(): connectivity check
  // -------------------------------------------------------------------------
  const startCaptured: CapturedRequest[] = [];
  const startEngine = new ClickHouseEngine({
    url: "https://ch.example.test:8443",
    user: "alice",
    password: "s3cret",
    database: "chainq",
    fetch: makeMockFetch(startCaptured),
  });
  await startEngine.start();
  assert.equal(startCaptured.length, 1, "start() should issue exactly one request");
  const startReq = startCaptured[0];
  assert.ok(startReq, "start request captured");
  assert.equal(startReq.method, "POST", "start() should POST");
  assert.match(startReq.body, /SELECT 1/, "start() body should contain SELECT 1");
  assert.match(startReq.body, /FORMAT JSON/, "start() body should append FORMAT JSON");
  console.log("[clickhouse-smoke] start() ok");

  // -------------------------------------------------------------------------
  // query(): parsing + auth headers + params
  // -------------------------------------------------------------------------
  const queryCaptured: CapturedRequest[] = [];
  const engine = new ClickHouseEngine({
    url: "https://ch.example.test:8443",
    user: "alice",
    password: "s3cret",
    database: "chainq",
    fetch: makeMockFetch(queryCaptured),
  });

  const result = await engine.query("SELECT address, count() AS cnt FROM logs", {
    timeoutSeconds: 17,
  });

  // Rows / columnTypes / actuals.
  assert.equal(result.rows.length, 3, "expected 3 rows from canned response");
  assert.deepEqual(
    result.rows[0],
    { address: "0xaaa", cnt: 10 },
    "first row should match canned data",
  );
  assert.deepEqual(
    result.columnTypes,
    { address: "String", cnt: "UInt64" },
    "columnTypes should be mapped from meta",
  );
  assert.equal(result.actualRows, 3, "actualRows should equal returned row count");
  assert.equal(result.actualBytes, 4096, "actualBytes from statistics.bytes_read");
  assert.equal(result.actualSeconds, 0.042, "actualSeconds from statistics.elapsed");
  assert.equal(result.truncated, false, "no truncation when rows <= maxRows");
  console.log("[clickhouse-smoke] query() parsing ok");

  // Auth + params on the captured request.
  assert.equal(queryCaptured.length, 1, "query() should issue exactly one request");
  const req = queryCaptured[0];
  assert.ok(req, "query request captured");
  assert.equal(req.headers["x-clickhouse-user"], "alice", "X-ClickHouse-User header");
  assert.equal(req.headers["x-clickhouse-key"], "s3cret", "X-ClickHouse-Key header");
  const reqUrl = new URL(req.url);
  assert.equal(
    reqUrl.searchParams.get("database"),
    "chainq",
    "database query param",
  );
  assert.equal(
    reqUrl.searchParams.get("max_execution_time"),
    "17",
    "max_execution_time query param from timeoutSeconds",
  );
  assert.match(req.body, /FORMAT JSON/, "query body should append FORMAT JSON");
  console.log("[clickhouse-smoke] auth headers + params ok");

  // -------------------------------------------------------------------------
  // maxRows truncation
  // -------------------------------------------------------------------------
  const truncCaptured: CapturedRequest[] = [];
  const truncEngine = new ClickHouseEngine({
    url: "https://ch.example.test:8443",
    fetch: makeMockFetch(truncCaptured),
  });
  const truncated = await truncEngine.query("SELECT * FROM logs", { maxRows: 2 });
  assert.equal(truncated.rows.length, 2, "maxRows=2 should yield 2 rows");
  assert.equal(truncated.actualRows, 2, "actualRows should reflect capped rows");
  assert.equal(truncated.truncated, true, "truncated flag should be set");
  // No auth configured → headers must be absent.
  const truncReq = truncCaptured[0];
  assert.ok(truncReq, "trunc request captured");
  assert.equal(
    truncReq.headers["x-clickhouse-user"],
    undefined,
    "no user header when user unset",
  );
  console.log("[clickhouse-smoke] maxRows truncation ok");

  // -------------------------------------------------------------------------
  // estimate(): offline heuristic
  // -------------------------------------------------------------------------
  const est = await engine.estimate("SELECT * FROM logs");
  assert.equal(est.estimatedCredits, 0, "ClickHouse heuristic credits = 0");
  assert.ok(est.warnings.length >= 1, "estimate should carry a heuristic warning");
  assert.match(est.warnings[0] ?? "", /heuristic/i, "warning should mention heuristic");
  console.log("[clickhouse-smoke] estimate() heuristic ok");

  console.log("[clickhouse-smoke] ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
