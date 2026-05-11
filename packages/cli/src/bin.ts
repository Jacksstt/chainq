#!/usr/bin/env node
/**
 * `chainq` CLI entry point.
 *
 * Subcommands:
 *   help                                    Show usage.
 *   version | --version | -v                Print the installed version.
 *   init [path] [--force]                   Initialise a chainq workspace.
 *   doctor                                  Health-check the local install.
 *   tools                                   List MCP tools the server exposes.
 *   metrics                                 List semantic-layer metrics.
 *   pull --chain <id> --from N --to N       Pull a Parquet snapshot.
 *   ingest backfill                         Multi-range / multi-chain pull.
 *   seed                                    Write sample parquet files.
 *   mcp serve [--stdio]                     Start the MCP server.
 */

import { resolve, dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInit } from "./init.js";
import { runBackfill, type BackfillRange } from "./backfill.js";

const args = process.argv.slice(2);

const COMMANDS = [
  ["help", "Show usage."],
  ["version", "Print the installed chainq version."],
  ["init [path] [--force]", "Initialise a chainq workspace in `path` (default: cwd)."],
  ["doctor", "Run a local health check (data dir, metrics, engine)."],
  ["tools", "List the MCP tools the server exposes."],
  ["metrics", "List semantic-layer metrics from the metrics directory."],
  ["seed", "Write sample parquet files to ./data."],
  ["pull --chain <id> --from N --to N [--topic0 0x...]", "Pull a Parquet snapshot from a public archive."],
  ["ingest backfill --plan <plan.json>", "Run multi-range backfill from a JSON plan."],
  ["ingest backfill --chains <list> --from N --to M [--concurrency K]", "Backfill a uniform range across multiple chains."],
  ["mcp serve [--stdio]", "Start the MCP server (stdio transport)."],
] as const;

const KNOWN_TOP_LEVEL = new Set([
  "help", "--help", "-h",
  "version", "--version", "-v",
  "init",
  "doctor",
  "tools",
  "metrics",
  "seed",
  "pull",
  "ingest",
  "mcp",
]);

function usage(): void {
  const pad = Math.max(...COMMANDS.map(([sig]) => sig.length)) + 2;
  const lines = [
    `chainq ${packageVersion()} — self-hosted onchain analytics for AI agents`,
    "",
    "Usage:",
    ...COMMANDS.map(([sig, desc]) => `  chainq ${sig.padEnd(pad)}${desc}`),
    "",
    "Environment:",
    "  CHAINQ_DATA_DIR     Directory with parquet files (default: ./data).",
    "  CHAINQ_METRICS_DIR  Directory with metric YAML files (default: packages/semantic/metrics).",
    "",
    "Docs:  https://github.com/Jacksstt/chainq/tree/main/docs",
  ];
  console.log(lines.join("\n"));
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

    case "version":
    case "--version":
    case "-v":
      console.log(packageVersion());
      return;

    case "init":
      await runInitCmd(rest);
      return;

    case "doctor":
      await runDoctor();
      return;

    case "tools":
      await runListTools(isVerbose(rest));
      return;

    case "metrics":
      await runListMetrics(isVerbose(rest));
      return;

    case "mcp": {
      if (rest[0] !== "serve") {
        console.error(`Unknown subcommand: chainq mcp ${rest[0] ?? ""}`);
        console.error("Did you mean:  chainq mcp serve [--stdio]");
        process.exit(1);
      }
      const transportFlags = rest.slice(1);
      for (const f of transportFlags) {
        if (f !== "--stdio") {
          console.error(`Unknown flag for mcp serve: ${f}`);
          console.error("Supported: --stdio (default).");
          process.exit(1);
        }
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
        console.error("Did you mean:  chainq ingest backfill ...");
        process.exit(1);
      }
      await runIngestBackfill(rest.slice(1));
      return;
    }

    default: {
      console.error(`Unknown command: ${cmd}`);
      const suggestion = suggestCommand(cmd ?? "");
      if (suggestion) {
        console.error(`Did you mean:  chainq ${suggestion}`);
      } else {
        console.error("Run `chainq help` for the full list.");
      }
      process.exit(1);
    }
  }
}

function packageRoot(): string {
  // bin.ts lives at <root>/packages/cli/src/bin.ts, so three "..":
  //   src → cli → packages → <root>.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "..");
}

function packageVersion(): string {
  try {
    const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const raw = readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function suggestCommand(cmd: string): string | null {
  const known = Array.from(KNOWN_TOP_LEVEL).filter((c) => !c.startsWith("-"));
  let best: { name: string; d: number } | null = null;
  for (const k of known) {
    const d = editDistance(cmd, k);
    if (d <= 2 && (!best || d < best.d)) best = { name: k, d };
  }
  return best?.name ?? null;
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array(n + 1).fill(0);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, dp[j - 1]!, dp[j]!) + 1;
      prev = tmp;
    }
  }
  return dp[n]!;
}

async function runMcpServe(): Promise<void> {
  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );
  const { startServer } = await import("@chainq/mcp-server");
  const root = packageRoot();
  const dataDir = resolve(process.env.CHAINQ_DATA_DIR ?? join(root, "data"));
  const metricsDir = resolve(
    process.env.CHAINQ_METRICS_DIR ?? join(root, "packages/semantic/metrics"),
  );
  // Banner goes to stderr so it never pollutes the MCP stdio channel.
  console.error(
    `[chainq] MCP server ready on stdio. dataDir=${dataDir} metricsDir=${metricsDir} version=${packageVersion()}`,
  );
  console.error("[chainq] Send a `tools/list` request from your MCP client or Ctrl-C to stop.");
  const transport = new StdioServerTransport();
  await startServer(transport, { dataDir, metricsDir, version: packageVersion() });
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

  const createdCount = result.created.length;
  const skippedCount = result.skipped.length;
  console.log("");
  console.log(`Initialised chainq workspace at ${result.targetDir}.`);
  console.log(
    `  created: ${createdCount} file${createdCount === 1 ? "" : "s"}` +
      `   skipped: ${skippedCount} file${skippedCount === 1 ? "" : "s"}` +
      (skippedCount > 0 && !force ? "   (re-run with --force to overwrite)" : ""),
  );
  if (createdCount === 0 && skippedCount === 0) {
    console.log("  (nothing to do — workspace already initialised)");
  }
  console.log("");
  console.log("Next steps:");
  const cdHint = positional[0] ? `cd ${positional[0]} && ` : "";
  console.log(`  ${cdHint}chainq seed           # write sample parquet files`);
  console.log(`  ${cdHint}chainq mcp serve      # start the MCP server (stdio)`);
  console.log("");
}

async function runDoctor(): Promise<void> {
  const root = packageRoot();
  const dataDir = resolve(process.env.CHAINQ_DATA_DIR ?? join(root, "data"));
  const metricsDir = resolve(
    process.env.CHAINQ_METRICS_DIR ?? join(root, "packages/semantic/metrics"),
  );

  const checks: { name: string; ok: boolean; detail: string }[] = [];

  checks.push({
    name: "Node version",
    ok: nodeMajor() >= 20,
    detail: `${process.version} (need ≥ v20)`,
  });

  checks.push({
    name: "Package root",
    ok: existsSync(join(root, "package.json")),
    detail: root,
  });

  if (existsSync(dataDir)) {
    const parquet = readdirSync(dataDir).filter((f) => f.endsWith(".parquet"));
    checks.push({
      name: "Data directory",
      ok: true,
      detail: `${dataDir} (${parquet.length} parquet file${parquet.length === 1 ? "" : "s"})`,
    });
  } else {
    checks.push({
      name: "Data directory",
      ok: false,
      detail: `${dataDir} (missing — run \`chainq seed\` or \`chainq init\`)`,
    });
  }

  let metricCount = 0;
  if (existsSync(metricsDir)) {
    metricCount = readdirSync(metricsDir).filter(
      (f) => f.endsWith(".yml") || f.endsWith(".yaml"),
    ).length;
    checks.push({
      name: "Metrics directory",
      ok: metricCount > 0,
      detail: `${metricsDir} (${metricCount} metric${metricCount === 1 ? "" : "s"})`,
    });
  } else {
    checks.push({
      name: "Metrics directory",
      ok: false,
      detail: `${metricsDir} (missing)`,
    });
  }

  // Probe the engine and run a 1-row query. Use a throwaway cache path so we
  // don't fight any running MCP server holding the default `dataDir/.chainq-cache.duckdb`.
  let engineOk = false;
  let engineDetail = "";
  try {
    const { Engine } = await import("@chainq/mcp-server");
    const { tmpdir } = await import("node:os");
    const cacheDbPath = join(tmpdir(), `chainq-doctor-${process.pid}.duckdb`);
    const engine = new Engine({ dataDir, cacheDbPath });
    await engine.start();
    try {
      const r = await engine.query("SELECT 1 AS ok", { cacheLabel: null });
      engineOk = r.rows.length === 1 && Number(r.rows[0]?.ok) === 1;
      engineDetail = engineOk ? "DuckDB OK, SELECT 1 returned 1 row" : "DuckDB query returned unexpected result";
    } finally {
      await engine.stop();
    }
  } catch (err) {
    engineDetail = `failed to start: ${(err as Error).message}`;
  }
  checks.push({ name: "Engine (DuckDB)", ok: engineOk, detail: engineDetail });

  // MCP tool catalog count.
  try {
    const { TOOL_CATALOG } = await import("@chainq/mcp-server");
    checks.push({
      name: "MCP tool catalog",
      ok: TOOL_CATALOG.length > 0,
      detail: `${TOOL_CATALOG.length} tools registered`,
    });
  } catch (err) {
    checks.push({
      name: "MCP tool catalog",
      ok: false,
      detail: `import failed: ${(err as Error).message}`,
    });
  }

  console.log(`chainq doctor — version ${packageVersion()}`);
  console.log("");
  const nameWidth = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) {
    const mark = c.ok ? "[ ok ]" : "[fail]";
    console.log(`  ${mark}  ${c.name.padEnd(nameWidth)}  ${c.detail}`);
  }
  console.log("");

  const failed = checks.filter((c) => !c.ok).length;
  if (failed === 0) {
    console.log(`All ${checks.length} checks passed.`);
  } else {
    console.error(`${failed} of ${checks.length} checks failed.`);
    process.exit(1);
  }
}

async function runListTools(verbose: boolean): Promise<void> {
  const { TOOL_CATALOG } = await import("@chainq/mcp-server");
  console.log(`chainq MCP tools (${TOOL_CATALOG.length} total):\n`);
  const groups = new Map<string, typeof TOOL_CATALOG[number][]>();
  for (const t of TOOL_CATALOG) {
    const arr = groups.get(t.group) ?? [];
    arr.push(t);
    groups.set(t.group, arr);
  }
  for (const [group, tools] of groups) {
    console.log(`  ${group}`);
    for (const t of tools) {
      console.log(`    ${t.name.padEnd(24)} ${t.title}`);
      if (verbose) {
        console.log(`      ${wrapText(t.description, 86, "      ")}`);
      }
    }
    console.log("");
  }
  if (verbose) {
    console.log("Schemas available via `chainq mcp serve` + `tools/list` from an MCP client.");
  } else {
    console.log("Pass --verbose for descriptions. Schemas via `chainq mcp serve` + `tools/list`.");
  }
}

async function runListMetrics(verbose: boolean): Promise<void> {
  const root = packageRoot();
  const metricsDir = resolve(
    process.env.CHAINQ_METRICS_DIR ?? join(root, "packages/semantic/metrics"),
  );
  const { MetricRegistry } = await import("@chainq/mcp-server");
  const registry = new MetricRegistry(metricsDir);
  registry.load();
  const list = registry.list();
  console.log(`chainq metrics (${list.length} total) — from ${metricsDir}:\n`);
  if (list.length === 0) {
    console.log("  (no metric YAML files found)");
    return;
  }
  const nameWidth = Math.max(...list.map((m) => m.metric.length));
  for (const m of list) {
    const dims = m.dimensions.length > 0 ? `dims=[${m.dimensions.join(",")}]` : "no dimensions";
    console.log(`  ${m.metric.padEnd(nameWidth)}  ${dims}`);
    const description = (m.description ?? "").trim();
    if (verbose && description) {
      for (const line of description.split("\n")) {
        console.log(`  ${" ".repeat(nameWidth)}  ${line.trim()}`);
      }
      const guards: string[] = [];
      if (m.guardrails.maxRows) guards.push(`max_rows=${m.guardrails.maxRows}`);
      if (m.guardrails.maxRangeDays) guards.push(`max_range_days=${m.guardrails.maxRangeDays}`);
      if (m.guardrails.timeoutSeconds) guards.push(`timeout=${m.guardrails.timeoutSeconds}s`);
      if (guards.length > 0) {
        console.log(`  ${" ".repeat(nameWidth)}  (${guards.join(", ")})`);
      }
      console.log("");
    } else if (description) {
      const summary = description.split("\n")[0]!.trim();
      console.log(`  ${" ".repeat(nameWidth)}  ${summary}`);
    }
  }
  if (!verbose) {
    console.log("\nPass --verbose for full descriptions + guardrails.");
  }
}

function isVerbose(args: string[]): boolean {
  return args.includes("--verbose") || args.includes("-v");
}

function wrapText(s: string, width: number, indent: string): string {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (current.length + w.length + 1 > width) {
      lines.push(current.trimEnd());
      current = w + " ";
    } else {
      current += w + " ";
    }
  }
  if (current.trim()) lines.push(current.trimEnd());
  return lines.join("\n" + indent);
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
    console.error("usage:");
    console.error("  chainq ingest backfill --plan <plan.json>");
    console.error("  chainq ingest backfill --chains <list> --from N --to M [--concurrency K]");
    console.error("");
    console.error("example:");
    console.error("  chainq ingest backfill --chains ethereum,base --from 18000000 --to 18001000");
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

function nodeMajor(): number {
  const m = /^v(\d+)/.exec(process.version);
  return m ? Number(m[1]) : 0;
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
