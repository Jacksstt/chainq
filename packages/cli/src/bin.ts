#!/usr/bin/env node
/**
 * `chainq` CLI entry point.
 *
 * Subcommands:
 *   help                                    Show usage.
 *   init                                    Stub — initialize a workspace.
 *   pull   --chain <id> --from N --to N     Pull a Parquet snapshot from a
 *                                           public archive (no RPC required).
 *   mcp serve [--stdio]                     Spawn the MCP server.
 *   seed                                    Write sample parquet files to ./data.
 */

import { resolve, dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);

function usage(): void {
  console.log(
    [
      "chainq — pre-alpha",
      "",
      "Usage:",
      "  chainq help",
      "  chainq init                            (stub)",
      "  chainq pull --chain <id> --from N --to N [--topic0 0x...]",
      "  chainq mcp serve [--stdio]             Start the MCP server.",
      "  chainq seed                            Write sample parquet files to ./data.",
      "",
      "Env:",
      "  CHAINQ_DATA_DIR    Directory with parquet (default ./data).",
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

    case "pull":
      await runPull(rest);
      return;

    default:
      console.error(`Unknown command: ${cmd}`);
      usage();
      process.exit(1);
  }
}

function packageRoot(): string {
  // bin.ts lives at <root>/packages/cli/src/bin.ts, so three "..":
  //   src → cli → packages → <root>.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "..");
}

async function runMcpServe(): Promise<void> {
  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );
  const { startServer } = await import("@chainq/mcp-server");
  // Resolve paths relative to the chainq install root, not the CWD, so the
  // MCP server works no matter where the host (Claude Code, IDE) spawns it.
  const root = packageRoot();
  const dataDir = resolve(process.env.CHAINQ_DATA_DIR ?? join(root, "data"));
  const metricsDir = resolve(
    process.env.CHAINQ_METRICS_DIR ?? join(root, "packages/semantic/metrics"),
  );
  const transport = new StdioServerTransport();
  await startServer(transport, { dataDir, metricsDir });
}

async function runSeed(): Promise<void> {
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

async function runPull(restArgs: string[]): Promise<void> {
  const opts = parseFlags(restArgs);
  const chain = opts["chain"];
  const from = Number(opts["from"]);
  const to = Number(opts["to"]);
  if (!chain || !Number.isFinite(from) || !Number.isFinite(to)) {
    console.error("usage: chainq pull --chain <id> --from N --to N [--topic0 0x...]");
    process.exit(1);
  }
  const { pull, PUBLIC_ARCHIVES } = await import("@chainq/snapshot");
  const archiveUrl = opts["archive"] ?? PUBLIC_ARCHIVES[chain];
  if (!archiveUrl) {
    console.error(`No public archive known for chain '${chain}'. Pass --archive <url>.`);
    process.exit(1);
  }
  const outDir = resolve(process.env.CHAINQ_DATA_DIR ?? "./data");
  console.error(`[pull] chain=${chain} from=${from} to=${to} archive=${archiveUrl}`);
  const result = await pull({
    chain,
    archiveUrl,
    fromBlock: from,
    toBlock: to,
    outDir,
    ...(opts["topic0"] ? { logFilter: { topic0: [opts["topic0"]] } } : {}),
  });
  console.error(`[pull] wrote ${result.rows} rows to ${result.outputPath}`);
}

function parseFlags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a && a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        out[key] = "true";
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
