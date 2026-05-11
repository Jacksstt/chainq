#!/usr/bin/env tsx
/**
 * In-process smoke test: walk the Engine + catalog without spawning a real
 * stdio transport. Exits non-zero on the first failure so it can run in CI.
 */

import { resolve } from "node:path";
import assert from "node:assert/strict";

import { CATALOG, Engine, findTable, searchTables } from "../packages/mcp-server/src/index.ts";

async function main() {
  const dataDir = resolve("data");
  console.log(`[smoke] data dir = ${dataDir}`);

  // catalog basics --------------------------------------------------------
  assert.ok(CATALOG.length >= 3, "catalog should have at least 3 tables");
  console.log(`[smoke] catalog tables = ${CATALOG.map((t) => t.name).join(", ")}`);

  // findTable -------------------------------------------------------------
  const dex = findTable("dex.trades");
  assert.ok(dex, "dex.trades missing");
  assert.ok(dex.columns.length > 0, "dex.trades columns missing");

  // searchTables ----------------------------------------------------------
  const hits = searchTables("dex");
  assert.ok(hits.some((t) => t.name === "dex.trades"), "search did not surface dex.trades");

  const filFiltered = searchTables("", "filecoin");
  assert.deepEqual(filFiltered.map((t) => t.name), ["filecoin.deals"]);

  // engine ----------------------------------------------------------------
  const engine = new Engine({ dataDir });
  await engine.start();

  const trades = await engine.query(`SELECT chain, COUNT(*) AS n FROM "dex.trades" GROUP BY chain ORDER BY chain`);
  assert.ok(trades.rows.length > 0, "dex.trades returned no rows");
  console.log("[smoke] dex.trades per chain:");
  for (const row of trades.rows) console.log(`         ${JSON.stringify(row)}`);

  const transfers = await engine.query(`SELECT COUNT(*) AS n FROM "erc20.transfers"`);
  const n = transfers.rows[0]?.["n"];
  assert.ok(typeof n === "string" || typeof n === "number", "erc20.transfers count missing");
  console.log(`[smoke] erc20.transfers rows = ${n}`);

  const deals = await engine.query(`SELECT COUNT(*) AS n FROM "filecoin.deals"`);
  console.log(`[smoke] filecoin.deals rows = ${deals.rows[0]?.["n"]}`);

  const est = await engine.estimate(`SELECT * FROM "dex.trades"`);
  console.log(`[smoke] estimate dex.trades = ${JSON.stringify(est)}`);

  await engine.stop();
  console.log("[smoke] ok");
}

main().catch((err) => {
  console.error("[smoke] FAILED:", err);
  process.exit(1);
});
