#!/usr/bin/env tsx
/**
 * chainq query benchmark.
 *
 * Runs a fixed suite of queries against `./data`, measures wall-clock
 * latency over N trials each, prints a Markdown table, and (optionally)
 * writes it to `docs/BENCHMARKS.md`.
 *
 * Usage:
 *   pnpm exec tsx scripts/benchmark.ts                 # 5 trials each
 *   pnpm exec tsx scripts/benchmark.ts --trials 10
 *   pnpm exec tsx scripts/benchmark.ts --write          # write docs/BENCHMARKS.md
 *
 * Combine with `CHAINQ_SEED_SCALE=large pnpm seed` to benchmark against a
 * ~100x larger dataset (~3M dex.trades rows etc).
 */

import { Engine } from "../packages/mcp-server/src/engine.ts";
import { mkdtempSync, statSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

interface Bench {
  id: string;
  description: string;
  sql: string;
}

const BENCHES: Bench[] = [
  {
    id: "p0_count",
    description: "Trivial COUNT over dex.trades",
    sql: `SELECT COUNT(*) FROM dex_trades`,
  },
  {
    id: "p1_volume_by_chain",
    description: "GROUP BY chain SUM(amount_usd) — narrow scan",
    sql: `SELECT chain, SUM(amount_usd) AS v FROM dex_trades GROUP BY 1 ORDER BY 2 DESC`,
  },
  {
    id: "p2_volume_by_day_dex",
    description: "GROUP BY (chain, dex_name, day) — wider grouping",
    sql: `SELECT chain, dex_name, date_trunc('day', block_time) AS d, SUM(amount_usd) AS v
          FROM dex_trades GROUP BY 1,2,3 ORDER BY 3,1,2 LIMIT 200`,
  },
  {
    id: "p3_distinct_traders",
    description: "COUNT(DISTINCT taker) — hash distinct on 100k+ rows",
    sql: `SELECT chain, COUNT(DISTINCT taker) FROM dex_trades GROUP BY 1`,
  },
  {
    id: "p4_top_tokens_erc20",
    description: "Top 20 ERC-20 tokens by transfer count",
    sql: `SELECT token, COUNT(*) AS n FROM erc20_transfers GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
  },
  {
    id: "p5_priced_join",
    description: "dex.trades JOIN prices.usd on (chain, token_out, day) — cross-table",
    sql: `SELECT t.chain, t.dex_name, SUM(TRY_CAST(t.amount_out AS DOUBLE) * p.price_usd) AS v
          FROM dex_trades t
          JOIN prices_usd p ON p.token = t.token_out AND p.chain = t.chain
            AND p.price_time = date_trunc('day', t.block_time)
          GROUP BY 1,2 ORDER BY 3 DESC NULLS LAST LIMIT 50`,
  },
  {
    id: "p6_label_join",
    description: "erc20.transfers JOIN labels.addresses on recipient — label filter",
    sql: `SELECT l.label, COUNT(*) AS n FROM erc20_transfers t
          JOIN labels_addresses l ON l.address = t.to_addr AND l.chain = t.chain
          GROUP BY 1 ORDER BY 2 DESC`,
  },
  {
    id: "p7_filecoin_provider",
    description: "Filecoin SUM(piece_size_bytes) GROUP BY provider — top 25",
    sql: `SELECT provider, SUM(piece_size_bytes) AS bytes FROM filecoin_deals
          GROUP BY 1 ORDER BY 2 DESC LIMIT 25`,
  },
  {
    id: "p8_solana_distinct_mints",
    description: "Solana DISTINCT mints per day",
    sql: `SELECT date_trunc('day', block_time) AS d, COUNT(DISTINCT mint) AS mints
          FROM solana_transfers GROUP BY 1 ORDER BY 1 LIMIT 30`,
  },
  {
    id: "p9_window_function",
    description: "Window function — running USD volume on dex.trades top 5k",
    sql: `SELECT block_time, chain,
            SUM(amount_usd) OVER (PARTITION BY chain ORDER BY block_time
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum
          FROM (SELECT * FROM dex_trades LIMIT 5000) ORDER BY block_time LIMIT 100`,
  },
];

function quantile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((sortedAsc.length - 1) * p));
  return sortedAsc[idx]!;
}

function parseFlags(args: string[]): { trials: number; write: boolean } {
  let trials = 5;
  let write = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--trials") trials = Number(args[++i]) || 5;
    else if (a === "--write") write = true;
  }
  return { trials, write };
}

function totalDataBytes(dir: string): number {
  let bytes = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".parquet")) continue;
    try { bytes += statSync(join(dir, f)).size; } catch {}
  }
  return bytes;
}

async function main() {
  const { trials, write } = parseFlags(process.argv.slice(2));
  const dataDir = resolve("./data");
  const engine = new Engine({
    dataDir,
    cacheDbPath: join(mkdtempSync(join(tmpdir(), "chainq-bench-")), "c.db"),
  });
  await engine.start();

  const datasetBytes = totalDataBytes(dataDir);
  console.log(`# chainq benchmark — ${(datasetBytes / 1_048_576).toFixed(1)} MiB dataset · ${trials} trials/query · ${BENCHES.length} queries\n`);
  console.log(`Engine: DuckDB (in-memory views over local Parquet). Node ${process.version}.\n`);

  // Warm-up
  console.error("[bench] warm-up …");
  for (const b of BENCHES) {
    try { await engine.query(b.sql, { maxRows: 1, cacheLabel: null }); } catch {}
  }

  const out: Array<{ id: string; description: string; rows: number; p50: number; p95: number; p99: number; min: number; max: number; }> = [];

  for (const b of BENCHES) {
    const samples: number[] = [];
    let lastRows = 0;
    for (let i = 0; i < trials; i++) {
      const t0 = performance.now();
      const r = await engine.query(b.sql, { maxRows: 10_000, cacheLabel: null });
      samples.push(performance.now() - t0);
      lastRows = r.actualRows;
    }
    samples.sort((a, b) => a - b);
    out.push({
      id: b.id,
      description: b.description,
      rows: lastRows,
      p50: quantile(samples, 0.5),
      p95: quantile(samples, 0.95),
      p99: quantile(samples, 0.99),
      min: samples[0]!,
      max: samples[samples.length - 1]!,
    });
    console.error(`[bench] ${b.id}: P50=${quantile(samples, 0.5).toFixed(1)}ms P95=${quantile(samples, 0.95).toFixed(1)}ms rows=${lastRows}`);
  }

  // Markdown report
  const lines: string[] = [];
  lines.push(`# chainq benchmarks`);
  lines.push("");
  lines.push(`Generated ${new Date().toISOString()} · Node ${process.version} · DuckDB engine in-memory over local Parquet`);
  lines.push("");
  lines.push(`Dataset: ${(datasetBytes / 1_048_576).toFixed(1)} MiB across ${readdirSync(dataDir).filter((f) => f.endsWith(".parquet")).length} Parquet files (\`./data\`). Trials per query: ${trials}.`);
  lines.push("");
  lines.push(`Reproduce: \`pnpm exec tsx scripts/benchmark.ts --trials ${trials}\`. For a ~100× larger dataset run \`CHAINQ_SEED_SCALE=large pnpm seed\` first.`);
  lines.push("");
  lines.push(`| query | rows | P50 (ms) | P95 (ms) | P99 (ms) | min | max | what |`);
  lines.push(`|-------|-----:|---------:|---------:|---------:|----:|----:|------|`);
  for (const r of out) {
    lines.push(`| \`${r.id}\` | ${r.rows} | ${r.p50.toFixed(1)} | ${r.p95.toFixed(1)} | ${r.p99.toFixed(1)} | ${r.min.toFixed(1)} | ${r.max.toFixed(1)} | ${r.description} |`);
  }
  lines.push("");
  lines.push(`## Notes`);
  lines.push("");
  lines.push(`- Synthetic data from \`pnpm seed\`. Real-mainnet latencies will diverge — primary use is regression tracking + cost-model calibration.`);
  lines.push(`- The cache DB used for \`chainq_recall\` is a tmp file, isolated from any running MCP server.`);
  lines.push(`- Warm-up pass excluded from samples; DuckDB JIT and OS page cache effects are minimised but not eliminated.`);
  lines.push(`- Window function (\`p9_window_function\`) is intentionally bounded to 5,000 rows to keep latency comparable across machines.`);
  lines.push("");

  const md = lines.join("\n");
  console.log(md);
  if (write) {
    const dest = resolve("docs/BENCHMARKS.md");
    writeFileSync(dest, md);
    console.error(`[bench] wrote ${dest}`);
  }
  await engine.stop();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
