/**
 * DEX taker-concentration mini-report — under 100 LOC.
 *
 * Demonstrates how short a chain-specific report becomes once you use
 * `@chainq/mcp-server`'s analytics helpers. Compare to scripts/filecoin-demo.ts
 * which goes deeper but is ~500 lines.
 *
 *   pnpm exec tsx scripts/dex-concentration-minimal.ts
 *   open docs/reports/04-dex-taker-concentration.html
 */

import { Engine, MetricRegistry, saveChart, writeReport,
         concentrationSuite, lorenzChartData } from "../packages/mcp-server/src/index.ts";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPORT_DIR = resolve("docs/reports");

async function main() {
  const engine = new Engine({
    dataDir: "./data",
    cacheDbPath: join(mkdtempSync(join(tmpdir(), "chainq-dex-")), "c.db"),
  });
  await engine.start();
  mkdirSync(REPORT_DIR, { recursive: true });

  // 1 SQL → 1 analytics call → 1 chart → 1 report.
  const sqlRes = await engine.query(
    `SELECT taker AS k, SUM(amount_usd) AS v
     FROM "dex.trades" WHERE chain = 'base'
     GROUP BY 1 ORDER BY v DESC NULLS LAST LIMIT 1000`,
    { cacheLabel: "dex:taker-concentration" },
  );
  const suite = concentrationSuite(
    sqlRes.rows.map((r) => ({ value: Number((r as Record<string, unknown>).v ?? 0) })),
  );

  const chartPath = resolve(REPORT_DIR, "04-dex-taker-lorenz.svg");
  await saveChart(
    {
      type: "line",
      data: lorenzChartData(suite.lorenz),
      x: "p_groups",
      y: "p_value",
      title: "Lorenz curve — Base DEX takers vs. cumulative USD volume",
    },
    chartPath,
  );

  const out = resolve(REPORT_DIR, "04-dex-taker-concentration.html");
  writeReport({
    title: { en: "Base DEX taker concentration", ja: "Base DEX テイカー集中度" },
    outPath: out,
    locale: "both",
    summary: {
      en: `Across ${suite.groups.toLocaleString()} takers on Base, the **top 10 hold ${(suite.topN[10] * 100).toFixed(1)}%** of USD volume. HHI=\`${suite.hhi.toFixed(4)}\`, Gini=\`${suite.gini.toFixed(3)}\`.`,
      ja: `Base 上の **${suite.groups.toLocaleString()} 名** のテイカーのうち、**上位10名で USD 出来高の ${(suite.topN[10] * 100).toFixed(1)}%** を占有。HHI=\`${suite.hhi.toFixed(4)}\`、Gini=\`${suite.gini.toFixed(3)}\`。`,
    },
    frontmatter: {
      table: "dex.trades",
      chain: "base",
      takers_total: suite.groups,
      hhi: suite.hhi.toFixed(4),
      gini: suite.gini.toFixed(4),
    },
    sections: [
      {
        heading: { en: "Concentration suite", ja: "集中度指標" },
        table: [
          { metric: "top-1",  value: (suite.topN[1]  * 100).toFixed(2) + "%" },
          { metric: "top-5",  value: (suite.topN[5]  * 100).toFixed(2) + "%" },
          { metric: "top-10", value: (suite.topN[10] * 100).toFixed(2) + "%" },
          { metric: "top-25", value: (suite.topN[25] * 100).toFixed(2) + "%" },
          { metric: "top-50", value: (suite.topN[50] * 100).toFixed(2) + "%" },
          { metric: "HHI",    value: suite.hhi.toFixed(4) },
          { metric: "Gini",   value: suite.gini.toFixed(3) },
        ],
      },
      {
        heading: { en: "Lorenz curve", ja: "ローレンツ曲線" },
        chartPath: "./04-dex-taker-lorenz.svg",
        caption: {
          en: "Cumulative taker count vs. cumulative USD volume on Base.",
          ja: "Base 上の累積テイカー比率と累積 USD 出来高の比率。",
        },
      },
      {
        heading: { en: "Caveats", ja: "注意" },
        body: {
          en: "Synthetic data from `pnpm seed`. Replace with `chainq pull --chain base` for real volume.",
          ja: "`pnpm seed` の合成データです。実出来高で再現するには `chainq pull --chain base` を使ってください。",
        },
      },
    ],
  });
  console.log(`[dex] report → ${out}`);
  await engine.stop();
}

main().catch((e) => { console.error(e); process.exit(1); });
