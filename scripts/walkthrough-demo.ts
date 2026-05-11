/**
 * Walkthrough demo — what an AI agent's chainq session looks like end-to-end.
 *
 * Run from the repo root after `pnpm seed`:
 *   pnpm exec tsx scripts/walkthrough-demo.ts
 *
 * Prints 9 steps showing budget setup → discovery → describe → estimate →
 * metric execution → chart render → report → recall → final budget status.
 * Reads only from `./data` and writes artifacts to a temp directory.
 */

import { Engine, MetricRegistry, saveChart, writeReport, CATALOG, findTable } from "../packages/mcp-server/src/index.ts";
import { BudgetTracker } from "../packages/mcp-server/src/budget.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main() {
  const out = mkdtempSync(join(tmpdir(), "chainq-demo-"));
  const engine = new Engine({ dataDir: "./data", cacheDbPath: join(out, "cache.duckdb") });
  await engine.start();
  const reg = new MetricRegistry("packages/semantic/metrics");
  reg.load();
  const budget = new BudgetTracker();

  const log = (n: number, label: string, body: unknown) => {
    console.log(`\n── Step ${n}: ${label} ──`);
    console.log(typeof body === "string" ? body : JSON.stringify(body, null, 2));
  };

  budget.setLimits({ rows: 5000, seconds: 30 });
  log(1, "agent → chainq_budget_set({ rows: 5000, seconds: 30 })", budget.status());

  log(2, "agent → chainq_list_tables()", CATALOG.map((t) => ({ name: t.name, chains: t.chains })));

  const t = findTable("dex.trades")!;
  log(3, "agent → chainq_describe('dex.trades')  [excerpt]", {
    partitions: t.partitions,
    sampleQueries: t.sampleQueries?.map((q) => q.title),
    gotchas: t.gotchas?.slice(0, 2),
  });

  const sql = reg.render("dex_volume_usd", {
    dimensions: ["day"],
    filters: { chain: "base" },
    start: "2026-01-01T00:00:00Z",
    end: "2026-02-01T00:00:00Z",
  });
  const est = await engine.estimate(sql);
  log(4, "agent → chainq_estimate_cost(sql)", { ...est, decision: budget.checkEstimate(est) });

  const r = await engine.query(sql, { cacheLabel: "demo:base-daily-jan" });
  budget.record({ rows: r.actualRows, bytes: r.actualBytes, seconds: r.actualSeconds });
  log(5, "agent → chainq_metric('dex_volume_usd', { chain: 'base', ... })", {
    rows: r.actualRows,
    seconds: r.actualSeconds.toFixed(3),
    first2: r.rows.slice(0, 2),
    budgetAfter: budget.status().consumed,
  });

  const chart = await saveChart(
    {
      type: "bar",
      data: r.rows as Record<string, unknown>[],
      x: "day",
      y: "volume_usd",
      title: "Base daily DEX volume — Jan 2026",
    },
    join(out, "chart.svg"),
  );
  log(6, "agent → chainq_chart_render(...)", { path: chart, format: "svg" });

  const report = writeReport({
    title: "Base daily DEX volume — Jan 2026",
    outPath: join(out, "report.html"),
    summary: `Base saw activity across ${r.actualRows} day-row(s) in the seeded dataset. **Top day** topped \`$350k\` in synthetic volume; trend is roughly flat.`,
    frontmatter: { generated_by: "agent-demo", chain: "base", window: "2026-01-01 → 2026-02-01" },
    sections: [
      { heading: "Volume by day", chartPath: "./chart.svg", caption: "USD volume, all DEXes" },
      { heading: "Top rows", table: r.rows.slice(0, 5) as Record<string, unknown>[] },
      { heading: "Caveats", body: "Numbers are illustrative — they come from `pnpm seed`'s synthetic dataset, not live mainnet. Replace with `chainq pull --chain base` output to reproduce against real data." },
    ],
  });
  log(7, "agent → chainq_report(...) → HTML", { path: report });

  const recalled = await engine.recall("base daily", 3);
  log(
    8,
    "future agent → chainq_recall('base daily')",
    recalled.map((c) => ({ id: c.id, score: c.score?.toFixed(2), label: c.label, rows: c.result_rows })),
  );

  log(9, "agent → chainq_budget_status()", budget.status());

  await engine.stop();
  console.log(`\nArtifacts in: ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
