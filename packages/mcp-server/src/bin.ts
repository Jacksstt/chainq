#!/usr/bin/env node
/**
 * Entry point for `chainq-mcp` CLI.
 * Will register tools against the MCP TypeScript SDK once wired (v0.0.1).
 */

import { createServer } from "./index.js";

async function main() {
  const _server = createServer();
  console.error("[chainq-mcp] pre-alpha — server not yet wired to MCP SDK");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
