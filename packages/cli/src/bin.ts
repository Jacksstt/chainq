#!/usr/bin/env node
/**
 * `chainq` CLI entry point.
 *
 * Subcommands:
 *   help                       Show usage.
 *   init                       Stub — initialize a workspace (not yet implemented).
 *   mcp serve [--stdio]        Spawn the MCP server over stdio.
 *   seed                       Generate small sample Parquet files into ./data.
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);

function usage(): void {
  console.log(
    [
      "chainq — pre-alpha",
      "",
      "Usage:",
      "  chainq help",
      "  chainq init                 (stub)",
      "  chainq mcp serve [--stdio]  Start the MCP server.",
      "  chainq seed                 Write sample parquet files to ./data.",
      "",
      "Env:",
      "  CHAINQ_DATA_DIR             Directory with parquet (default ./data).",
    ].join("\n"),
  );
}

async function main() {
  const [cmd, ...rest] = args;

  switch (cmd) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      usage();
      return;

    case "init":
      console.log("init: not yet implemented (v0.1.0).");
      return;

    case "mcp": {
      if (rest[0] !== "serve") {
        console.error(`Unknown subcommand: chainq mcp ${rest[0] ?? ""}`);
        process.exit(1);
      }
      await runMcpServe();
      return;
    }

    case "seed":
      await runSeed();
      return;

    default:
      console.error(`Unknown command: ${cmd}`);
      usage();
      process.exit(1);
  }
}

function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // packages/cli/src → repo root
  return resolve(here, "..", "..", "..", "..");
}

async function runMcpServe(): Promise<void> {
  // We import the server module directly — keeps everything in one process.
  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );
  const { startServer } = await import("@chainq/mcp-server");
  const dataDir = resolve(process.env.CHAINQ_DATA_DIR ?? "./data");
  const transport = new StdioServerTransport();
  await startServer(transport, { dataDir });
}

async function runSeed(): Promise<void> {
  // Spawn tsx on the seed script so we don't bundle it.
  const script = resolve(packageRoot(), "scripts", "seed-sample-data.ts");
  const child = spawn(
    process.execPath,
    [resolve(packageRoot(), "node_modules", "tsx", "dist", "cli.mjs"), script],
    { stdio: "inherit" },
  );
  await new Promise<void>((res, rej) => {
    child.on("exit", (code) => (code === 0 ? res() : rej(new Error(`seed exited ${code}`))));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
