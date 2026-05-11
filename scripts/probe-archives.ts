#!/usr/bin/env tsx
/**
 * Probe every entry in `@chainq/snapshot/PUBLIC_ARCHIVES` and report
 * which archives are currently UP.
 *
 * Usage:
 *   pnpm exec tsx scripts/probe-archives.ts             # print to stdout
 *   pnpm exec tsx scripts/probe-archives.ts --write     # also write docs/SUPPORTED-CHAINS.md
 *
 * Method: `GET <archiveUrl>/height` with a short timeout. If the response
 * is HTTP 200 and the body parses as a positive integer, the archive is
 * considered UP and we record the head height. Anything else marks it
 * DOWN with the failure reason.
 *
 * Concurrency is capped at 8 to be polite to Subsquid's edge.
 */

import { PUBLIC_ARCHIVES } from "../packages/snapshot/src/index.ts";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface ProbeResult {
  chain: string;
  url: string;
  status: "up" | "down";
  height?: number;
  detail?: string;
  elapsedMs: number;
}

const TIMEOUT_MS = 8000;
const CONCURRENCY = 8;

async function probeOne(chain: string, url: string): Promise<ProbeResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${url}/height`, { signal: controller.signal });
    const elapsedMs = Date.now() - started;
    if (!r.ok) {
      return { chain, url, status: "down", detail: `HTTP ${r.status}`, elapsedMs };
    }
    const body = (await r.text()).trim();
    const n = Number(body);
    if (!Number.isFinite(n) || n <= 0) {
      return { chain, url, status: "down", detail: `unparseable height: ${body.slice(0, 40)}`, elapsedMs };
    }
    return { chain, url, status: "up", height: n, elapsedMs };
  } catch (err) {
    const elapsedMs = Date.now() - started;
    const detail =
      err instanceof Error && err.name === "AbortError" ? "timeout" : (err as Error).message;
    return { chain, url, status: "down", detail, elapsedMs };
  } finally {
    clearTimeout(timer);
  }
}

async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const workers = Array.from({ length: n }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  const write = process.argv.includes("--write");
  const entries = Object.entries(PUBLIC_ARCHIVES).sort(([a], [b]) => a.localeCompare(b));
  console.error(`[probe] checking ${entries.length} archives, concurrency=${CONCURRENCY} …`);

  const results = await pool(entries, CONCURRENCY, async ([chain, url]) => {
    const r = await probeOne(chain, url);
    console.error(
      `[probe] ${r.status === "up" ? "UP  " : "DOWN"} ${chain.padEnd(18)} ${(r.elapsedMs + "ms").padStart(6)}  ${r.height ?? r.detail ?? ""}`,
    );
    return r;
  });

  const up = results.filter((r) => r.status === "up");
  const down = results.filter((r) => r.status === "down");

  console.error("");
  console.error(`[probe] up=${up.length} / down=${down.length} of ${results.length}`);

  if (write) {
    const lines: string[] = [];
    lines.push(`# Supported chains`);
    lines.push("");
    lines.push(`Reachability probe results. Generated ${new Date().toISOString()} from`);
    lines.push(`\`scripts/probe-archives.ts\` against every entry in`);
    lines.push(`[\`@chainq/snapshot/PUBLIC_ARCHIVES\`](../packages/snapshot/src/index.ts).`);
    lines.push("");
    lines.push(`Method: \`GET <archiveUrl>/height\`. \`status: up\` means HTTP 200 and the body parses as a positive integer (the archive head height). Anything else is \`down\` with the reason recorded.`);
    lines.push("");
    lines.push(`**${up.length} of ${results.length} archives are currently reachable.**`);
    lines.push("");
    lines.push(`Reproduce locally:`);
    lines.push("");
    lines.push("```bash");
    lines.push(`pnpm exec tsx scripts/probe-archives.ts --write`);
    lines.push("```");
    lines.push("");
    lines.push(`## UP (${up.length})`);
    lines.push("");
    lines.push(`| chain | head height | latency | archive URL |`);
    lines.push(`|-------|------------:|--------:|-------------|`);
    for (const r of up) {
      lines.push(
        `| \`${r.chain}\` | ${r.height!.toLocaleString()} | ${r.elapsedMs} ms | ${r.url} |`,
      );
    }
    lines.push("");
    if (down.length > 0) {
      lines.push(`## DOWN / unknown (${down.length})`);
      lines.push("");
      lines.push(`Entries below are present in \`PUBLIC_ARCHIVES\` but the probe could not confirm them on the latest run. Reasons vary: network blip during probe, archive not yet provisioned, slug mismatch, region restriction.`);
      lines.push("");
      lines.push(`| chain | archive URL | detail |`);
      lines.push(`|-------|-------------|--------|`);
      for (const r of down) {
        lines.push(`| \`${r.chain}\` | ${r.url} | ${r.detail ?? "?"} |`);
      }
      lines.push("");
    }
    lines.push(`## Non-EVM ingest paths (counted separately)`);
    lines.push("");
    lines.push(`These chains are NOT in \`PUBLIC_ARCHIVES\` (Subsquid doesn't index them) but chainq supports them via dedicated ingest packages:`);
    lines.push("");
    lines.push(`| chain | package | public API |`);
    lines.push(`|-------|---------|------------|`);
    lines.push(`| \`solana\` | \`@chainq/ingest-solana\` | Helius RPC (free tier available) |`);
    lines.push(`| \`filecoin\` | \`@chainq/ingest-filecoin\` | Filfox + Spacescan REST (no key) |`);
    lines.push("");
    lines.push(`Total chains supported end-to-end: **${up.length + 2}** (${up.length} EVM via Subsquid + Solana + Filecoin).`);
    lines.push("");
    lines.push(`## Adding a chain`);
    lines.push("");
    lines.push(`1. Find the archive slug on https://docs.sqd.dev/subsquid-network/reference/networks/`);
    lines.push(`2. Append the entry to \`packages/snapshot/src/index.ts\` \`PUBLIC_ARCHIVES\``);
    lines.push(`3. Re-run this script: \`pnpm exec tsx scripts/probe-archives.ts --write\``);
    lines.push("");
    lines.push(`Once a chain shows up in the **UP** table, you can immediately run:`);
    lines.push("");
    lines.push("```bash");
    lines.push(`chainq pull --chain <slug> --from N --to M`);
    lines.push(`chainq watch --chain <slug> --from N`);
    lines.push("```");
    const out = resolve("docs/SUPPORTED-CHAINS.md");
    writeFileSync(out, lines.join("\n"));
    console.error(`[probe] wrote ${out}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
