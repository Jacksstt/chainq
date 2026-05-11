#!/usr/bin/env node
/**
 * Entry point for `chainq-mcp` — spawns a stdio MCP server.
 *
 * Env vars:
 *   CHAINQ_DATA_DIR  Directory holding the catalog's Parquet files.
 *                    Defaults to ./data.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";

import { startServer } from "./server.js";

async function main() {
  const dataDir = resolve(process.env.CHAINQ_DATA_DIR ?? "./data");
  const transport = new StdioServerTransport();
  await startServer(transport, { dataDir });
}

main().catch((err) => {
  console.error("[chainq-mcp] fatal:", err);
  process.exit(1);
});
