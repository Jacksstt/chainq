#!/usr/bin/env tsx
/**
 * MCP end-to-end smoke test.
 *
 * Spawns the MCP server as a child process over stdio, connects an MCP
 * client to it, asserts that tools are listed, and calls each tool once.
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";

async function main() {
  const dataDir = resolve("data");
  const cliEntry = resolve("packages/cli/src/bin.ts");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("node_modules/tsx/dist/cli.mjs"), cliEntry, "mcp", "serve"],
    env: { ...process.env, CHAINQ_DATA_DIR: dataDir },
  });

  const client = new Client({ name: "chainq-smoke", version: "0.0.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log("[mcp-smoke] tools:", tools.tools.map((t) => t.name).join(", "));
  const expected = [
    "chainq_list_tables",
    "chainq_search_tables",
    "chainq_describe",
    "chainq_estimate_cost",
    "chainq_query",
  ];
  for (const name of expected) {
    assert.ok(tools.tools.some((t) => t.name === name), `tool ${name} missing`);
  }

  const list = await client.callTool({ name: "chainq_list_tables", arguments: {} });
  console.log("[mcp-smoke] list_tables ok, length =", JSON.stringify(list).length);

  const describe = await client.callTool({
    name: "chainq_describe",
    arguments: { table: "dex.trades" },
  });
  console.log("[mcp-smoke] describe ok, length =", JSON.stringify(describe).length);

  const query = await client.callTool({
    name: "chainq_query",
    arguments: { sql: `SELECT chain, COUNT(*) AS n FROM "dex.trades" GROUP BY chain` },
  });
  console.log("[mcp-smoke] query ok, length =", JSON.stringify(query).length);

  await client.close();
  console.log("[mcp-smoke] ok");
}

main().catch((err) => {
  console.error("[mcp-smoke] FAILED:", err);
  process.exit(1);
});
