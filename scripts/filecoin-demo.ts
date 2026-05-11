/**
 * Filecoin storage-concentration HTML report — generated end-to-end from
 * the seeded sample dataset. Run from the repo root (after `pnpm seed`):
 *
 *   pnpm exec tsx scripts/filecoin-demo.ts
 *
 * Writes `docs/reports/02-filecoin-concentration.html` + its chart SVG.
 * Use this as the template when wiring a real chain-specific report
 * pipeline against `chainq pull --chain filecoin` output.
 */

import { Engine } from "../packages/mcp-server/src/engine.ts";
import { MetricRegistry } from "../packages/mcp-server/src/metrics.ts";
import { saveChart } from "../packages/mcp-server/src/charts.ts";
import { writeReport } from "../packages/mcp-server/src/report.ts";
import { findTable } from "../packages/mcp-server/src/catalog.ts";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "chainq-fc-"));
  const engine = new Engine({ dataDir: "./data", cacheDbPath: join(tmp, "c.db") });
  await engine.start();
  const reg = new MetricRegistry("./packages/semantic/metrics");
  reg.load();

  // 1. Sanity check the table we're about to query
  const tbl = findTable("filecoin.deals")!;
  console.log(`[fc] table=${tbl.name} columns=${tbl.columns.length} chains=${tbl.chains.join(",")}`);

  // 2. Run the per-provider storage metric over the synthetic epoch range
  //    (seeded data covers ~roughly 2,000 deals across many providers).
  const sql = reg.render("filecoin_provider_storage", {
    dimensions: ["provider"],
    start_epoch: 0,
    end_epoch: 10_000_000,
  });
  const all = await engine.query(sql, { maxRows: 1000, cacheLabel: "fc:provider-storage" });
  console.log(`[fc] metric returned ${all.actualRows} providers in ${all.actualSeconds.toFixed(3)}s`);

  // 3. Compute concentration metrics from the result
  const rows = (all.rows as Array<Record<string, unknown>>)
    .map((r) => ({
      provider: String(r["provider"] ?? ""),
      bytes: Number(r["bytes_stored"] ?? 0),
      tib: Number(r["tib_stored"] ?? 0),
      deals: Number(r["deal_count"] ?? 0),
    }))
    .filter((r) => Number.isFinite(r.bytes) && r.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);

  const totalBytes = rows.reduce((s, r) => s + r.bytes, 0);
  const top10 = rows.slice(0, 10);
  const top10Share = top10.reduce((s, r) => s + r.bytes, 0) / totalBytes;
  const hhi = rows.reduce((s, r) => s + (r.bytes / totalBytes) ** 2, 0);

  // 4. Render a bar chart of the top 10
  const reportDir = resolve("docs/reports");
  mkdirSync(reportDir, { recursive: true });
  const chartPath = resolve(reportDir, "02-filecoin-top-providers.svg");
  await saveChart(
    {
      type: "bar",
      data: top10.map((r) => ({ provider: r.provider, tib: r.tib })),
      x: "provider",
      y: "tib",
      title: "Top 10 Filecoin storage providers (TiB stored)",
    },
    chartPath,
  );
  console.log(`[fc] chart → ${chartPath}`);

  // 5. Write the bilingual HTML report (Japanese + English with CSS toggle).
  const out = resolve(reportDir, "02-filecoin-concentration.html");
  writeReport({
    title: {
      en: "Filecoin storage-provider concentration",
      ja: "Filecoin ストレージプロバイダの集中度",
    },
    outPath: out,
    locale: "both",
    summary: {
      en:
        `Across **${rows.length.toLocaleString()}** storage providers in the seeded snapshot, ` +
        `the **top 10 hold ${(top10Share * 100).toFixed(1)}%** of all committed bytes. ` +
        `Herfindahl index (byte-weighted): \`${hhi.toFixed(4)}\`. ` +
        `Higher HHI means tighter concentration; an HHI above 0.25 is conventionally treated as highly concentrated in industrial economics.`,
      ja:
        `シード済みスナップショットの **${rows.length.toLocaleString()}** プロバイダのうち、` +
        `**上位10社で全コミット容量の ${(top10Share * 100).toFixed(1)}%** を占めます。` +
        `バイト加重 Herfindahl 指数: \`${hhi.toFixed(4)}\`。` +
        `HHI が高いほど集中度が高く、0.25 を超えると産業組織論で「高度に集中している」と分類されるのが慣例です。`,
    },
    frontmatter: {
      generated_by: "chainq + scripts/filecoin-demo.ts (synthetic data)",
      table: "filecoin.deals",
      metric: "filecoin_provider_storage",
      providers_total: rows.length,
      top10_share: top10Share.toFixed(4),
      hhi: hhi.toFixed(4),
    },
    sections: [
      {
        heading: {
          en: "Top 10 providers by bytes stored",
          ja: "格納バイト数 上位10プロバイダ",
        },
        chartPath: "./02-filecoin-top-providers.svg",
        caption: {
          en: "Bytes stored per provider, top 10 (synthetic seeded dataset).",
          ja: "プロバイダ別格納バイト数、上位10位（合成シードデータ）。",
        },
      },
      {
        heading: {
          en: "Top 10 (raw figures)",
          ja: "上位10位（生の数値）",
        },
        table: top10.map((r, i) => ({
          rank: i + 1,
          provider: r.provider,
          tib_stored: r.tib.toFixed(1),
          deal_count: r.deals,
          share: `${((r.bytes / totalBytes) * 100).toFixed(2)}%`,
        })),
      },
      {
        heading: {
          en: "Interpreting the numbers",
          ja: "数値の読み方",
        },
        body: {
          en:
            "The dataset under `pnpm seed` synthesises ~2,000 Filecoin deals across a hand-curated " +
            "pool of providers — it is **not real mainnet**. The concentration number is therefore a " +
            "shape check, not a measurement. To run this against live data: `chainq pull --chain filecoin " +
            "--from <epoch> --to <epoch>` (the snapshot package wraps Filfox + Spacescan).\n\n" +
            "Cross-check with `chainq_metric(\"filecoin_deal_count\", filters={verified_deal: true})` to see " +
            "whether Filecoin Plus changes the distribution.",
          ja:
            "`pnpm seed` で生成されるデータセットは、手選りした少数のプロバイダプール上で約 2,000 件の Filecoin " +
            "ディールを合成したものです。**メインネット由来ではありません**。したがってここでの集中度は " +
            "「分布の形を確認するための数値」であり、計測値ではありません。実データで再現するには " +
            "`chainq pull --chain filecoin --from <epoch> --to <epoch>` を使ってください（snapshot パッケージが " +
            "Filfox + Spacescan の API を包んでいます）。\n\n" +
            "Filecoin Plus の検証付きディール（`verified_deal = true`）で分布がどう変わるかは " +
            "`chainq_metric(\"filecoin_deal_count\", filters={verified_deal: true})` で確認できます。",
        },
      },
      {
        heading: { en: "Caveats", ja: "注意" },
        body: {
          en:
            "Filecoin epochs are 30-second slots, not unix seconds. Convert to wall-clock time with " +
            "`(epoch * 30) + 1598306400` (GENESIS_TIMESTAMP, 2020-08-24 22:00:00 UTC).\n\n" +
            "A provider with a small `deal_count` but a large `tib_stored` is hosting big pieces. " +
            "Filtering by deal count alone misses these.",
          ja:
            "Filecoin の epoch は unix 秒ではなく 30 秒スロットです。壁時計時刻に変換するには " +
            "`(epoch * 30) + 1598306400`（GENESIS_TIMESTAMP, 2020-08-24 22:00:00 UTC）を使ってください。\n\n" +
            "`deal_count` が少ないのに `tib_stored` が大きいプロバイダは、大きなピースを保持しています。" +
            "ディール件数だけでフィルタするとこの種のプロバイダを取りこぼします。",
        },
      },
      {
        heading: {
          en: "Reproducing this report",
          ja: "このレポートを再現する",
        },
        body: {
          en:
            "1. `chainq_describe(\"filecoin.deals\")`\n" +
            "2. `chainq_metric(\"filecoin_provider_storage\", { dimensions: [\"provider\"], start_epoch, end_epoch })`\n" +
            "3. `chainq_chart_render({ type: \"bar\", x: \"provider\", y: \"tib_stored\", filename: \"top-providers.svg\" })`\n" +
            "4. `chainq_report({ title, filename: \"filecoin-concentration.html\", locale: \"both\", sections: [...] })`",
          ja:
            "1. `chainq_describe(\"filecoin.deals\")`\n" +
            "2. `chainq_metric(\"filecoin_provider_storage\", { dimensions: [\"provider\"], start_epoch, end_epoch })`\n" +
            "3. `chainq_chart_render({ type: \"bar\", x: \"provider\", y: \"tib_stored\", filename: \"top-providers.svg\" })`\n" +
            "4. `chainq_report({ title, filename: \"filecoin-concentration.html\", locale: \"both\", sections: [...] })`",
        },
      },
    ],
  });
  console.log(`[fc] report → ${out}`);

  await engine.stop();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
