#!/usr/bin/env node
/**
 * `chainq` CLI entry point.
 *
 * Subcommands:
 *   help                                    Show usage.
 *   init [path] [--force]                   Initialise a chainq workspace.
 *   pull   --chain <id> --from N --to N     Pull a Parquet snapshot from a
 *                                           public archive (no RPC required).
 *   mcp serve [--stdio]                     Spawn the MCP server.
 *   seed                                    Write sample parquet files to ./data.
 */

import { resolve, dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInit } from "./init.js";
import { runBackfill, type BackfillRange } from "./backfill.js";

const args = process.argv.slice(2);

function usage(): void {
  console.log(
    [
      "chainq — pre-alpha",
      "",
      "Usage:",
      "  chainq help",
      "  chainq init [path] [--force]    Initialise a chainq workspace.",
      "  chainq pull --chain <id> --from N --to N [--topic0 0x...]",
      "  chainq ingest backfill --plan <plan.json>",
      "  chainq ingest backfill --chains <list> --from N --to M [--concurrency K]",
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
      await runInitCmd(rest);
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

    case "ingest": {
      if (rest[0] !== "backfill") {
        console.error(`Unknown subcommand: chainq ingest ${rest[0] ?? ""}`);
        process.exit(1);
      }
      await runIngestBackfill(rest.slice(1));
      return;
    }

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

async function runInitCmd(restArgs: string[]): Promise<void> {
  let force = false;
  const positional: string[] = [];
  for (const a of restArgs) {
    if (a === "--force") {
      force = true;
    } else if (a.startsWith("--")) {
      console.error(`Unknown flag for init: ${a}`);
      process.exit(1);
    } else {
      positional.push(a);
    }
  }
  if (positional.length > 1) {
    console.error("usage: chainq init [path] [--force]");
    process.exit(1);
  }
  const targetDir = positional[0] ?? process.cwd();
  const result = await runInit({ targetDir, force });
  console.log(
    `\nInitialised chainq workspace at ${result.targetDir}. ` +
      `Created: ${result.created.length} files. ` +
      `Skipped: ${result.skipped.length} files` +
      (result.skipped.length > 0 ? " (use --force to overwrite)." : "."),
  );
  if (result.created.length > 0) {
    console.log("\nCreated:");
    for (const p of result.created) console.log(`  ${p}`);
  }
  if (result.skipped.length > 0) {
    console.log("\nSkipped:");
    for (const p of result.skipped) console.log(`  ${p}`);
  }
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

async function runIngestBackfill(restArgs: string[]): Promise<void> {
  const opts = parseFlags(restArgs);
  const planPath = opts["plan"];
  const chains = opts["chains"];

  if (planPath && chains) {
    console.error("error: --plan and --chains are mutually exclusive");
    process.exit(1);
  }

  let ranges: BackfillRange[];
  if (planPath) {
    let raw: string;
    try {
      raw = readFileSync(resolve(planPath), "utf8");
    } catch (err) {
      console.error(
        `error: failed to read plan '${planPath}': ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error(
        `error: plan '${planPath}' is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
    if (!Array.isArray(parsed)) {
      console.error("error: plan must be a JSON array of BackfillRange");
      process.exit(1);
    }
    ranges = parsed.map((r, i) => {
      if (
        !r ||
        typeof r !== "object" ||
        typeof (r as Record<string, unknown>)["chain"] !== "string" ||
        typeof (r as Record<string, unknown>)["fromBlock"] !== "number" ||
        typeof (r as Record<string, unknown>)["toBlock"] !== "number"
      ) {
        console.error(`error: plan entry [${i}] missing chain/fromBlock/toBlock`);
        process.exit(1);
      }
      const obj = r as Record<string, unknown>;
      const range: BackfillRange = {
        chain: obj["chain"] as string,
        fromBlock: obj["fromBlock"] as number,
        toBlock: obj["toBlock"] as number,
      };
      if (typeof obj["topic0"] === "string") range.topic0 = obj["topic0"];
      return range;
    });
  } else if (chains) {
    const from = Number(opts["from"]);
    const to = Number(opts["to"]);
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      console.error(
        "usage: chainq ingest backfill --chains <list> --from N --to M [--concurrency K] [--topic0 0x...]",
      );
      process.exit(1);
    }
    const chainList = chains
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (chainList.length === 0) {
      console.error("error: --chains is empty");
      process.exit(1);
    }
    ranges = chainList.map((chain) => {
      const range: BackfillRange = { chain, fromBlock: from, toBlock: to };
      if (opts["topic0"]) range.topic0 = opts["topic0"];
      return range;
    });
  } else {
    console.error(
      "usage:\n" +
        "  chainq ingest backfill --plan <plan.json>\n" +
        "  chainq ingest backfill --chains <list> --from N --to M [--concurrency K]",
    );
    process.exit(1);
  }

  const concurrency = opts["concurrency"] ? Number(opts["concurrency"]) : undefined;
  if (concurrency !== undefined && !Number.isFinite(concurrency)) {
    console.error("error: --concurrency must be a number");
    process.exit(1);
  }

  const outDir = resolve(process.env.CHAINQ_DATA_DIR ?? "./data");
  console.error(
    `[backfill] ranges=${ranges.length} concurrency=${concurrency ?? 2} outDir=${outDir}`,
  );

  const result = await runBackfill({
    ranges,
    outDir,
    ...(concurrency !== undefined ? { concurrency } : {}),
  });

  // Summary: ok-range count by chain. BackfillResult only exposes total
  // rows globally, so we report that plus per-chain success counts.
  const okByChain = new Map<string, number>();
  for (const r of result.ok) {
    okByChain.set(r.chain, (okByChain.get(r.chain) ?? 0) + 1);
  }

  console.error("");
  console.error(
    `ok: ${result.ok.length} ranges, failed: ${result.failed.length}, total rows: ${result.totalRows}`,
  );
  if (okByChain.size > 0) {
    console.error("by chain (ok ranges):");
    for (const [chain, count] of okByChain) {
      console.error(`  ${chain}: ${count}`);
    }
  }
  if (result.failed.length > 0) {
    console.error(`failed: ${result.failed.length} range${result.failed.length === 1 ? "" : "s"}`);
    for (const f of result.failed) {
      console.error(
        `  ${f.range.chain} [${f.range.fromBlock}..${f.range.toBlock}] — ${f.error}`,
      );
    }
  }
  console.error(`elapsed: ${result.elapsedSeconds.toFixed(2)}s`);

  if (result.failed.length > 0) process.exit(1);
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
