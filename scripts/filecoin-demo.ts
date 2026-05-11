/**
 * Filecoin storage-concentration HTML report — end-to-end pipeline that
 * demonstrates an analyst-grade chainq output.
 *
 * Run from the repo root (after `pnpm seed`):
 *   pnpm exec tsx scripts/filecoin-demo.ts
 *
 * The script:
 *   1. Issues five SQL queries against `filecoin.deals` covering provider
 *      storage, verified-deal share, deal-duration distribution, client
 *      concentration, and per-epoch cohort activity.
 *   2. Computes a concentration suite (HHI, Gini, top-N shares, P50/P95/P99,
 *      provider tier counts, verified-vs-all delta).
 *   3. Renders five charts (top-25 storage, Lorenz curve, provider-tier
 *      distribution, verified-deal share by tier, deal-duration histogram).
 *   4. Writes a bilingual (ja / en) single-file HTML report to
 *      `docs/reports/02-filecoin-concentration.html`.
 */

import { Engine } from "../packages/mcp-server/src/engine.ts";
import { MetricRegistry } from "../packages/mcp-server/src/metrics.ts";
import { saveChart } from "../packages/mcp-server/src/charts.ts";
import { writeReport, type ReportSection } from "../packages/mcp-server/src/report.ts";
import { findTable } from "../packages/mcp-server/src/catalog.ts";
import {
  concentrationSuite,
  distributionSummary,
  histogram,
  bucketize,
  percentile,
  lorenzChartData,
  histogramChartData,
  bucketChartData,
} from "../packages/mcp-server/src/analytics.ts";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPORT_DIR = resolve("docs/reports");
const CHART_PREFIX = "02-filecoin";

const FILECOIN_GENESIS_TS = 1_598_306_400; // 2020-08-24 22:00:00 UTC
const EPOCH_SECONDS = 30;
const TIB = 1_099_511_627_776; // 2^40

interface ProviderRow {
  provider: string;
  bytes: number;
  tib: number;
  deals: number;
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "chainq-fc-"));
  const engine = new Engine({ dataDir: "./data", cacheDbPath: join(tmp, "c.db") });
  await engine.start();
  const reg = new MetricRegistry("./packages/semantic/metrics");
  reg.load();
  mkdirSync(REPORT_DIR, { recursive: true });

  // ---------- 1. Sanity check the table ----------
  const tbl = findTable("filecoin.deals")!;
  console.log(`[fc] table=${tbl.name} columns=${tbl.columns.length} chains=${tbl.chains.join(",")}`);

  // ---------- 2. Headline metric: bytes per provider ----------
  const sql = reg.render("filecoin_provider_storage", {
    dimensions: ["provider"],
    start_epoch: 0,
    end_epoch: 10_000_000,
  });
  const all = await engine.query(sql, { maxRows: 1000, cacheLabel: "fc:provider-storage" });
  const rows: ProviderRow[] = (all.rows as Array<Record<string, unknown>>)
    .map((r) => ({
      provider: String(r["provider"] ?? ""),
      bytes: Number(r["bytes_stored"] ?? 0),
      tib: Number(r["tib_stored"] ?? 0),
      deals: Number(r["deal_count"] ?? 0),
    }))
    .filter((r) => Number.isFinite(r.bytes) && r.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
  console.log(`[fc] providers=${rows.length} in ${all.actualSeconds.toFixed(3)}s`);

  // ---------- 3. Verified-deals breakdown ----------
  const verifiedSql = reg.render("filecoin_provider_storage", {
    dimensions: ["provider"],
    filters: { verified_deal: true },
    start_epoch: 0,
    end_epoch: 10_000_000,
  });
  const verified = await engine.query(verifiedSql, { maxRows: 1000, cacheLabel: "fc:provider-storage:verified" });
  const verifiedByProvider = new Map<string, number>();
  for (const r of verified.rows) {
    verifiedByProvider.set(String((r as Record<string, unknown>)["provider"]), Number((r as Record<string, unknown>)["bytes_stored"] ?? 0));
  }
  const verifiedBytes = Array.from(verifiedByProvider.values()).reduce((s, v) => s + v, 0);
  const totalBytes = rows.reduce((s, r) => s + r.bytes, 0);
  const verifiedShareOverall = verifiedBytes / totalBytes;

  // ---------- 4. Deal-duration distribution ----------
  const durationRes = await engine.query(
    `SELECT (end_epoch - start_epoch) AS duration_epochs FROM "filecoin.deals"`,
    { maxRows: 10_000, cacheLabel: "fc:duration" },
  );
  const durations = durationRes.rows
    .map((r) => Number((r as Record<string, unknown>)["duration_epochs"]))
    .filter((d) => Number.isFinite(d) && d > 0)
    .sort((a, b) => a - b);
  const durationDays = (d: number) => (d * EPOCH_SECONDS) / 86400;
  // Use the framework's distribution helper.
  const durSummary = distributionSummary(durations);
  const durationStats = {
    p25: durationDays(durSummary.p25),
    p50: durationDays(durSummary.p50),
    p75: durationDays(durSummary.p75),
    p95: durationDays(durSummary.p95),
    minDays: durationDays(durSummary.min),
    maxDays: durationDays(durSummary.max),
  };

  // ---------- 5. Client concentration ----------
  const clientRes = await engine.query(
    `SELECT client, COUNT(*) AS deals, COUNT(DISTINCT provider) AS distinct_providers
     FROM "filecoin.deals" GROUP BY 1 ORDER BY deals DESC LIMIT 10`,
    { maxRows: 10, cacheLabel: "fc:top-clients" },
  );
  const topClients = clientRes.rows.map((r) => r as Record<string, unknown>);

  // ---------- 6. Cohort split (early vs late deal-creation epoch) ----------
  const cohortRes = await engine.query(
    `WITH q AS (SELECT MIN(start_epoch) AS lo, MAX(start_epoch) AS hi FROM "filecoin.deals"),
          b AS (
            SELECT
              start_epoch,
              CASE
                WHEN start_epoch < q.lo + (q.hi - q.lo) * 0.5 THEN 'early'
                ELSE 'late'
              END AS cohort,
              piece_size_bytes,
              verified_deal
            FROM "filecoin.deals", q
          )
     SELECT cohort,
            COUNT(*) AS deals,
            SUM(piece_size_bytes) AS bytes,
            AVG(CASE WHEN verified_deal THEN 1.0 ELSE 0.0 END) AS verified_share
     FROM b GROUP BY 1 ORDER BY 1`,
    { maxRows: 10, cacheLabel: "fc:cohorts" },
  );
  const cohorts = cohortRes.rows.map((r) => r as Record<string, unknown>);

  // ---------- 7. Concentration suite (via @chainq/mcp-server analytics) ----------
  const totals = totalBytes;
  const suite = concentrationSuite(rows.map((r) => ({ value: r.bytes })), {
    topN: [1, 5, 10, 25, 50, 100],
  });
  const top = (n: number) => suite.topN[n] ?? 0;
  const hhi = suite.hhi;
  const gini = suite.gini;

  // Provider tiers (TiB-based) — reused analytics.bucketize.
  const TIER_SPECS = [
    { label: "<0.5 TiB",  min: 0,    max: 0.5 },
    { label: "0.5-2 TiB", min: 0.5,  max: 2 },
    { label: "2-10 TiB",  min: 2,    max: 10 },
    { label: "10-50 TiB", min: 10,   max: 50 },
    { label: ">50 TiB",   min: 50,   max: Infinity },
  ];
  const tierResults = bucketize(rows, (r) => r.tib, TIER_SPECS);
  // Adapter so downstream code keeps working with the old shape `{ label, count, providers }`.
  const tiers = tierResults.map((t) => ({
    label: t.label,
    count: t.count,
    providers: t.items as ProviderRow[],
  }));

  // ---------- 8. Charts ----------
  // svg() emits a static SVG; html() emits a self-contained interactive
  // vega-embed file; png() rasterizes via @resvg/resvg-js (retina by default).
  const svg = async (suffix: string, spec: Parameters<typeof saveChart>[0]) => {
    const out = resolve(REPORT_DIR, `${CHART_PREFIX}-${suffix}.svg`);
    await saveChart(spec, out);
    return `./${CHART_PREFIX}-${suffix}.svg`;
  };
  const png = async (suffix: string, spec: Parameters<typeof saveChart>[0]) => {
    const out = resolve(REPORT_DIR, `${CHART_PREFIX}-${suffix}.png`);
    await saveChart(spec, out, "png", { pngWidth: 800, pngScale: 2 });
    return `./${CHART_PREFIX}-${suffix}.png`;
  };
  const html = async (suffix: string, spec: Parameters<typeof saveChart>[0]) => {
    const out = resolve(REPORT_DIR, `${CHART_PREFIX}-${suffix}.html`);
    await saveChart(spec, out);
    return `./${CHART_PREFIX}-${suffix}.html`;
  };

  // CSV dumps for download chips.
  const csv = (suffix: string, rows: Array<Record<string, unknown>>): string => {
    const filePath = resolve(REPORT_DIR, `${CHART_PREFIX}-${suffix}.csv`);
    if (rows.length === 0) {
      writeFileSync(filePath, "");
      return `./${CHART_PREFIX}-${suffix}.csv`;
    }
    const cols = Object.keys(rows[0]!);
    const escapeCsv = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(",")];
    for (const r of rows) lines.push(cols.map((c) => escapeCsv(r[c])).join(","));
    writeFileSync(filePath, lines.join("\n"));
    return `./${CHART_PREFIX}-${suffix}.csv`;
  };

  const top25 = rows.slice(0, 25);
  // Interactive Vega chart for top 25; static SVG fallback also generated.
  const top25Data = top25.map((r, i) => ({ rank: i + 1, provider: r.provider, tib: Number(r.tib.toFixed(2)) }));
  const chartTop25 = await html("top25", {
    type: "bar",
    data: top25Data,
    x: "rank",
    y: "tib",
    title: "Top 25 storage providers (TiB) / 上位25社の格納容量 (TiB)",
  });
  await svg("top25", { type: "bar", data: top25Data, x: "rank", y: "tib", title: "Top 25 storage providers (TiB)" });
  const top25Png = await png("top25", { type: "bar", data: top25Data, x: "rank", y: "tib", title: "Top 25 storage providers (TiB)" });
  const top25CsvPath = csv("top25", top25Data);

  // Lorenz curve — interactive HTML this time.
  const lorenzData = lorenzChartData(suite.lorenz);
  const chartLorenz = await html("lorenz", {
    type: "line",
    data: lorenzData,
    x: "p_groups",
    y: "p_value",
    title: "Lorenz curve — providers vs. cumulative bytes / ローレンツ曲線",
  });
  await svg("lorenz", { type: "line", data: lorenzData, x: "p_groups", y: "p_value", title: "Lorenz curve" });
  const lorenzCsvPath = csv("lorenz", lorenzData as Array<Record<string, unknown>>);

  const chartTiers = await svg("tiers", {
    type: "bar",
    data: tiers.map((t) => ({ tier: t.label, count: t.count })),
    x: "tier",
    y: "count",
    title: "Provider count by size tier / 容量帯別プロバイダ数",
  });

  const verifiedByTier = tiers.map((t) => {
    const tierProviders = t.providers;
    const tierBytes = tierProviders.reduce((s, p) => s + p.bytes, 0);
    const tierVerified = tierProviders.reduce((s, p) => s + (verifiedByProvider.get(p.provider) ?? 0), 0);
    return { tier: t.label, verified_share: tierBytes > 0 ? +(tierVerified / tierBytes).toFixed(4) : 0 };
  });
  const chartVerifiedByTier = await svg("verified-by-tier", {
    type: "bar",
    data: verifiedByTier,
    x: "tier",
    y: "verified_share",
    title: "Verified-deal byte share by provider tier / 容量帯別 検証済みディール比率",
  });

  // Duration histogram in 30-day buckets — reused analytics.histogram.
  const durationHist = histogram(durations.map(durationDays), 30);
  const chartDuration = await svg("duration", {
    type: "bar",
    data: histogramChartData(durationHist),
    x: "from",
    y: "count",
    title: "Deal duration histogram (30-day buckets) / ディール期間ヒストグラム",
  });

  // ---------- 9. Build report sections ----------
  const sections: ReportSection[] = [];

  // 9a. Executive summary as bullets
  sections.push({
    heading: { en: "Executive summary", ja: "エグゼクティブサマリー" },
    body: {
      en:
        `- **${rows.length.toLocaleString()} providers** carry **${(totals / TIB).toFixed(1)} TiB** across ${(rows.reduce((s, r) => s + r.deals, 0)).toLocaleString()} deals in this snapshot.\n` +
        `- **Top 10 hold ${(top(10) * 100).toFixed(1)}%** of all bytes (top 5: ${(top(5) * 100).toFixed(1)}%, top 25: ${(top(25) * 100).toFixed(1)}%, top 50: ${(top(50) * 100).toFixed(1)}%).\n` +
        `- Herfindahl index (byte-weighted): \`${hhi.toFixed(4)}\` — well below the 0.25 industrial-economics "highly concentrated" threshold, but Gini coefficient \`${gini.toFixed(3)}\` indicates meaningful inequality of size.\n` +
        `- Filecoin Plus verified deals account for **${(verifiedShareOverall * 100).toFixed(1)}%** of bytes overall; the share is materially different across size tiers (see §5).\n` +
        `- Median deal duration **${durationStats.p50.toFixed(0)} days** (P25 ${durationStats.p25.toFixed(0)}d / P95 ${durationStats.p95.toFixed(0)}d) — see §6.`,
      ja:
        `- 本スナップショットでは **${rows.length.toLocaleString()} 社** のプロバイダが計 **${(totals / TIB).toFixed(1)} TiB** を ${(rows.reduce((s, r) => s + r.deals, 0)).toLocaleString()} 件のディールに分散して保有しています。\n` +
        `- **上位10社が全容量の ${(top(10) * 100).toFixed(1)}%** を占有（上位5社 ${(top(5) * 100).toFixed(1)}% / 上位25社 ${(top(25) * 100).toFixed(1)}% / 上位50社 ${(top(50) * 100).toFixed(1)}%）。\n` +
        `- バイト加重 Herfindahl 指数は \`${hhi.toFixed(4)}\` で、産業組織論で「高度に集中」と見なされる 0.25 を大きく下回ります。ただし Gini 係数 \`${gini.toFixed(3)}\` は規模の不均衡が無視できないことを示します。\n` +
        `- Filecoin Plus の検証済みディールは全体バイト数の **${(verifiedShareOverall * 100).toFixed(1)}%**。サイズ帯ごとに比率は大きく異なります（§5 参照）。\n` +
        `- ディール期間の中央値は **${durationStats.p50.toFixed(0)} 日**（P25 ${durationStats.p25.toFixed(0)}日 / P95 ${durationStats.p95.toFixed(0)}日）。詳細は §6 を参照。`,
    },
  });

  // 9b. Methodology
  sections.push({
    heading: { en: "1. Methodology & data scope", ja: "1. メソドロジー & データ範囲" },
    body: {
      en:
        `**Source table.** \`filecoin.deals\` — one row per protocol deal, ingested from public Filfox / Spacescan endpoints via \`@chainq/ingest-filecoin\`. In this run the table comes from \`pnpm seed\`'s synthetic dataset (${rows.reduce((s, r) => s + r.deals, 0).toLocaleString()} deals across ${rows.length} providers); replace with \`chainq pull --chain filecoin\` output to reproduce against mainnet.\n\n` +
        `**Engine.** DuckDB ${process.version.split(".").slice(0, 2).join(".")}-compatible build, in-memory views over Parquet files in \`./data\`. All five queries below ran in under ${(all.actualSeconds + verified.actualSeconds + durationRes.actualSeconds + clientRes.actualSeconds + cohortRes.actualSeconds).toFixed(2)}s combined.\n\n` +
        `**Window.** \`start_epoch BETWEEN 0 AND 10000000\` (epochs are 30-second slots since 2020-08-24 22:00:00 UTC — see Glossary). No cohort-level filtering except where noted.\n\n` +
        `**Metric definitions.** Concentration via Herfindahl (Σ sᵢ², bytes-weighted) and Gini (full Lorenz integration over byte mass). Provider tiers are bucketed by TiB stored: <0.5 / 0.5-2 / 2-10 / 10-50 / >50.`,
      ja:
        `**ソーステーブル**: \`filecoin.deals\`。1行=1ディール。Filfox / Spacescan API を \`@chainq/ingest-filecoin\` で取り込みます。本実行では \`pnpm seed\` の合成データ（プロバイダ ${rows.length} 社 × 計 ${rows.reduce((s, r) => s + r.deals, 0).toLocaleString()} 件）を使用。メインネット相当の出力で再現するには \`chainq pull --chain filecoin\` の結果に差し替えてください。\n\n` +
        `**エンジン**: DuckDB（Node ${process.version.split(".").slice(0, 2).join(".")} 互換ビルド）。\`./data\` の Parquet ファイル群に対しメモリ内ビューを構築。下記5本のクエリは合算 ${(all.actualSeconds + verified.actualSeconds + durationRes.actualSeconds + clientRes.actualSeconds + cohortRes.actualSeconds).toFixed(2)} 秒で完了。\n\n` +
        `**期間**: \`start_epoch BETWEEN 0 AND 10000000\`（epoch は 2020-08-24 22:00:00 UTC からの 30 秒スロット — 用語集参照）。コホート分析以外でのフィルタはなし。\n\n` +
        `**指標の定義**: 集中度は Herfindahl（Σsᵢ²、バイト加重）と Gini（バイト質量によるローレンツ曲線の積分）。プロバイダ階層は TiB ベースで <0.5 / 0.5-2 / 2-10 / 10-50 / >50 にバケット化。`,
    },
  });

  // 9c. Concentration suite
  sections.push({
    heading: { en: "2. Concentration suite", ja: "2. 集中度指標一式" },
    table: [
      { metric: "top-1 share",   value: (top(1)   * 100).toFixed(2) + "%", note: "share of bytes held by the largest single provider" },
      { metric: "top-5 share",   value: (top(5)   * 100).toFixed(2) + "%", note: "" },
      { metric: "top-10 share",  value: (top(10)  * 100).toFixed(2) + "%", note: "common reference for Filecoin ecosystem health" },
      { metric: "top-25 share",  value: (top(25)  * 100).toFixed(2) + "%", note: "" },
      { metric: "top-50 share",  value: (top(50)  * 100).toFixed(2) + "%", note: "" },
      { metric: "HHI (Herfindahl)", value: hhi.toFixed(4), note: "<0.10 unconcentrated · 0.10-0.18 moderate · >0.25 high" },
      { metric: "Gini coefficient", value: gini.toFixed(3), note: "0 = perfect equality · 1 = perfect inequality" },
    ],
    body: {
      en: `The numbers above are byte-weighted (not deal-count-weighted) because storage commitment is the load-bearing variable on Filecoin. Top-10 share is the figure most often cited in ecosystem dashboards; the HHI lets us compare against industries on a unified scale and Gini captures inequality along the tail that HHI smooths over.`,
      ja: `上記はバイト加重（ディール件数加重ではない）です。Filecoin ではストレージコミット量こそが効くからです。エコシステム系ダッシュボードで最頻出なのは top-10 share、HHI は他産業との横比較ができる尺度、Gini は HHI が平準化してしまう裾の不均衡を捕捉する補助指標として併用しています。`,
    },
  });

  // 9d. Top 25 providers
  sections.push({
    heading: { en: "3. Top 25 providers", ja: "3. 上位25プロバイダ" },
    chartPath: chartTop25,        // interactive HTML
    chartHeight: 420,
    caption: {
      en: "TiB stored per provider, rank 1-25 (interactive — hover for exact values). Power-law fall-off is characteristic.",
      ja: "プロバイダ別 TiB（上位1-25位）。インタラクティブ表示 — ホバーで正確な値が見えます。べき分布的な減衰がはっきり見えます。",
    },
    downloads: [
      { path: top25CsvPath,                       label: { en: "Top 25 raw rows", ja: "上位25 生データ" }, format: "csv" },
      { path: `./${CHART_PREFIX}-top25.svg`,      label: { en: "Static SVG fallback", ja: "静的SVG" },      format: "svg" },
      { path: top25Png,                           label: { en: "PNG (1600w retina)",  ja: "PNG (1600px retina)" }, format: "png" },
    ],
  });
  sections.push({
    heading: { en: "3a. Top 25 (raw)", ja: "3a. 上位25（生の数値）" },
    table: top25.map((r, i) => ({
      rank: i + 1,
      provider: r.provider,
      tib_stored: r.tib.toFixed(1),
      deal_count: r.deals,
      share: `${((r.bytes / totals) * 100).toFixed(2)}%`,
      cumulative: `${(top(i + 1) * 100).toFixed(2)}%`,
    })),
  });

  // 9e. Lorenz curve
  sections.push({
    heading: { en: "4. Lorenz curve & Gini", ja: "4. ローレンツ曲線と Gini" },
    chartPath: chartLorenz,        // interactive HTML
    chartHeight: 380,
    caption: {
      en: `Cumulative provider count (X) vs. cumulative bytes (Y). The diagonal is perfect equality. Gini = ${gini.toFixed(3)}.`,
      ja: `プロバイダの累積比率 (X) と 累積バイトの比率 (Y)。対角線が完全平等。Gini = ${gini.toFixed(3)}。`,
    },
    downloads: [
      { path: lorenzCsvPath,                      label: { en: "Lorenz curve data", ja: "ローレンツ曲線データ" }, format: "csv" },
      { path: `./${CHART_PREFIX}-lorenz.svg`,     label: { en: "Static SVG fallback", ja: "静的SVG" },           format: "svg" },
    ],
  });
  sections.push({
    heading: { en: "4a. Provider tier distribution", ja: "4a. 容量帯ごとのプロバイダ数" },
    chartPath: chartTiers,
    caption: {
      en: "Provider count bucketed by TiB stored. The majority of providers sit in the small-to-mid tiers.",
      ja: "TiB 格納量別のプロバイダ数。多くは小〜中規模帯に分布。",
    },
  });
  sections.push({
    heading: { en: "4b. Tier table", ja: "4b. 階層別サマリ" },
    table: tiers.map((t) => ({
      tier: t.label,
      providers: t.count,
      bytes_share: `${((t.providers.reduce((s, p) => s + p.bytes, 0) / totals) * 100).toFixed(2)}%`,
      median_tib: t.providers.length > 0 ? (percentile(t.providers.map((p) => p.tib).sort((a, b) => a - b), 0.5)).toFixed(1) : "—",
    })),
  });

  // 9f. Verified deals
  sections.push({
    heading: { en: "5. Verified deals (Filecoin Plus)", ja: "5. 検証済みディール (Filecoin Plus)" },
    chartPath: chartVerifiedByTier,
    caption: {
      en: "Verified-deal byte share by provider size tier. Filecoin Plus is intentionally spread across the long tail.",
      ja: "プロバイダ階層ごとの検証済みディール バイト比率。Filecoin Plus は裾を厚くする設計。",
    },
    body: {
      en: `Overall, **${(verifiedShareOverall * 100).toFixed(1)}%** of bytes are verified. The tiering chart shows how the program affects size brackets differently — smaller providers often see a larger verified share because the Filecoin Plus allocation is rate-limited per provider.`,
      ja: `全体では **${(verifiedShareOverall * 100).toFixed(1)}%** のバイトが検証済みです。階層別に見ると、小規模プロバイダの方が検証済み比率が高い傾向があります（Filecoin Plus はプロバイダごとに割当上限があるため、裾の方に偏りやすい）。`,
    },
  });

  // 9g. Duration distribution
  sections.push({
    heading: { en: "6. Deal duration distribution", ja: "6. ディール期間の分布" },
    chartPath: chartDuration,
    caption: {
      en: "Deal duration histogram, 30-day buckets. The protocol enforces 180/540-day minimum/maximum bounds.",
      ja: "30日刻みのディール期間ヒストグラム。プロトコル上は 180/540 日が下限・上限。",
    },
    table: [
      { quantile: "min",  days: durationStats.minDays.toFixed(0) },
      { quantile: "P25",  days: durationStats.p25.toFixed(0) },
      { quantile: "P50 (median)", days: durationStats.p50.toFixed(0) },
      { quantile: "P75",  days: durationStats.p75.toFixed(0) },
      { quantile: "P95",  days: durationStats.p95.toFixed(0) },
      { quantile: "max",  days: durationStats.maxDays.toFixed(0) },
    ],
  });

  // 9h. Client concentration
  sections.push({
    heading: { en: "7. Top clients by deal count", ja: "7. ディール件数上位クライアント" },
    table: topClients.map((c, i) => ({
      rank: i + 1,
      client: String(c["client"] ?? ""),
      deals: Number(c["deals"] ?? 0),
      distinct_providers: Number(c["distinct_providers"] ?? 0),
      provider_diversity: `${(Number(c["distinct_providers"] ?? 0) / Math.max(1, Number(c["deals"] ?? 0))).toFixed(2)}`,
    })),
    body: {
      en: `**provider_diversity** = distinct providers / deals. Values near 1.0 indicate a client that spreads each new deal across a new provider; values near 0 indicate concentration on a small set of preferred SPs.`,
      ja: `**provider_diversity** = 異なるプロバイダ数 ÷ ディール数。1.0 に近いほど「毎回別のプロバイダに分散して保存」、0 に近いほど「特定のプロバイダに依存」を示します。`,
    },
  });

  // 9i. Cohort analysis
  sections.push({
    heading: { en: "8. Cohort analysis (early vs late epochs)", ja: "8. コホート分析（前半・後半 epoch）" },
    table: cohorts.map((c) => ({
      cohort: String(c["cohort"] ?? ""),
      deals: Number(c["deals"] ?? 0),
      bytes_tib: (Number(c["bytes"] ?? 0) / TIB).toFixed(2),
      verified_share: `${(Number(c["verified_share"] ?? 0) * 100).toFixed(1)}%`,
    })),
    body: {
      en: `Splits the deal window into halves on \`start_epoch\`. Trends in verified-deal share or deal count between cohorts hint at program adoption changes; flatness here is expected for the synthetic dataset.`,
      ja: `\`start_epoch\` の中央値で前後半に二分割しています。検証済みディール比率や件数が前後半で変動する場合、Filecoin Plus 採用や SP 構成変化の指標になります。合成データではほぼ平坦になるはず。`,
    },
  });

  // 9j. Caveats (auto-callout: heading starts with "Caveats" / "注意")
  sections.push({
    heading: { en: "Caveats", ja: "注意" },
    body: {
      en:
        `Filecoin epochs are 30-second slots, not unix seconds. Convert to wall-clock with \`(epoch * ${EPOCH_SECONDS}) + ${FILECOIN_GENESIS_TS}\` (GENESIS_TIMESTAMP).\n\n` +
        `A provider with a small \`deal_count\` but a large \`tib_stored\` is hosting big pieces — filtering by deal count alone misses these.\n\n` +
        `The \`pnpm seed\` dataset deliberately distributes deals round-robin across 200 providers, so HHI and Gini understate real-mainnet concentration. Treat the **shape** of the report as the deliverable, not the magnitude.\n\n` +
        `Bytes_share in §4b sums to ~100% across tiers but can drift by ±0.01% due to floating-point accumulation in the share calculation.`,
      ja:
        `Filecoin の epoch は unix 秒ではなく 30 秒スロット。壁時計時刻は \`(epoch * ${EPOCH_SECONDS}) + ${FILECOIN_GENESIS_TS}\`（GENESIS_TIMESTAMP）で算出してください。\n\n` +
        `\`deal_count\` が少ないのに \`tib_stored\` が大きいプロバイダは「大きなピースを少数本ホストしている」タイプ。件数だけでフィルタすると取りこぼします。\n\n` +
        `\`pnpm seed\` のデータは意図的に 200 プロバイダにラウンドロビンで配るため、HHI と Gini はメインネットの実集中度を**過小評価**します。本レポートは「形」を見るためのものとして読んでください。\n\n` +
        `§4b の bytes_share は階層合計でほぼ 100% になりますが、シェア計算で浮動小数点の累積誤差により ±0.01% 程度ずれます。`,
    },
  });

  // 9k. Glossary
  sections.push({
    heading: { en: "Glossary", ja: "用語集" },
    body: {
      en:
        `**Epoch.** 30-second slot since 2020-08-24 22:00:00 UTC. Mainnet height ≈ epoch.\n\n` +
        `**Piece.** A storage unit; mainnet sectors are typically 32 GiB or 64 GiB. Multiple pieces can be packed into one sector via aggregation.\n\n` +
        `**Verified deal.** A deal under the Filecoin Plus program; receives 10x quality-adjusted power for the SP and discounted storage for the client.\n\n` +
        `**HHI (Herfindahl-Hirschman Index).** Σ sᵢ² where sᵢ is share. 1/N (uniform) is the floor; 1 is monopoly. <0.10 is unconcentrated, >0.25 is highly concentrated under US DOJ guidelines.\n\n` +
        `**Gini.** Inequality index over the Lorenz curve. 0 = everyone equal; 1 = one entity owns everything.\n\n` +
        `**TiB.** Tebibyte, 2⁴⁰ bytes ≈ 1.0995 × 10¹² bytes. Not to be confused with TB (10¹²).`,
      ja:
        `**Epoch（エポック）**: 2020-08-24 22:00:00 UTC 起算の 30 秒スロット。メインネットでは概ね高さ=epoch。\n\n` +
        `**Piece（ピース）**: 保存単位。メインネットのセクターは通常 32 GiB か 64 GiB。複数 piece は集約により 1 sector に詰められる。\n\n` +
        `**Verified deal（検証済みディール）**: Filecoin Plus 制度の対象ディール。SP は quality-adjusted power が 10 倍、クライアントは保存料金が割引される。\n\n` +
        `**HHI（ハーフィンダール指数）**: Σsᵢ²。1/N（一様分布）が下限、1 が独占。米国 DOJ ガイドラインでは <0.10 が無集中、>0.25 が高集中。\n\n` +
        `**Gini（ジニ係数）**: ローレンツ曲線に基づく不平等指数。0 = 完全平等、1 = 完全寡占。\n\n` +
        `**TiB**: テビバイト、2⁴⁰ バイト ≈ 1.0995 × 10¹² バイト。TB（10¹²）とは別物。`,
    },
  });

  // 9l. Reproducing
  sections.push({
    heading: { en: "Reproducing this report", ja: "このレポートの再現手順" },
    body: {
      en:
        `\`\`\`bash\n` +
        `# 1. Pull a real Filecoin window (RPC-free, public archive):\n` +
        `chainq pull --chain filecoin --from 4500000 --to 5000000\n\n` +
        `# 2. Run the report pipeline:\n` +
        `pnpm exec tsx scripts/filecoin-demo.ts\n\n` +
        `# 3. Open the output:\n` +
        `open docs/reports/02-filecoin-concentration.html\n` +
        `\`\`\`\n\n` +
        `Pipeline (MCP calls the agent makes under the hood):\n\n` +
        `1. \`chainq_describe("filecoin.deals")\` — schema + sample queries + gotchas.\n` +
        `2. \`chainq_metric("filecoin_provider_storage", { dimensions: ["provider"], start_epoch, end_epoch })\` — total + verified variants.\n` +
        `3. \`chainq_query("SELECT (end_epoch - start_epoch) AS duration_epochs FROM filecoin.deals")\` — duration distribution.\n` +
        `4. \`chainq_query("SELECT client, COUNT(*) AS deals, COUNT(DISTINCT provider) ...")\` — client diversity.\n` +
        `5. Five \`chainq_chart_render\` calls for top-25 / lorenz / tiers / verified-by-tier / duration.\n` +
        `6. \`chainq_report({ ..., locale: "both", format: "html" })\` — this file.`,
      ja:
        `\`\`\`bash\n` +
        `# 1. 実データの取り込み（RPC不要、公開アーカイブから）:\n` +
        `chainq pull --chain filecoin --from 4500000 --to 5000000\n\n` +
        `# 2. レポート生成:\n` +
        `pnpm exec tsx scripts/filecoin-demo.ts\n\n` +
        `# 3. 開く:\n` +
        `open docs/reports/02-filecoin-concentration.html\n` +
        `\`\`\`\n\n` +
        `パイプライン（裏で AI エージェントが叩く MCP コール）:\n\n` +
        `1. \`chainq_describe("filecoin.deals")\` — スキーマ・サンプル・落とし穴。\n` +
        `2. \`chainq_metric("filecoin_provider_storage", { dimensions: ["provider"], start_epoch, end_epoch })\` — 全件・検証済みの2バージョン。\n` +
        `3. \`chainq_query("SELECT (end_epoch - start_epoch) ...")\` — 期間分布。\n` +
        `4. \`chainq_query("SELECT client, COUNT(*) ...")\` — クライアント多様性。\n` +
        `5. \`chainq_chart_render\` を5回（top-25 / lorenz / tiers / verified-by-tier / duration）。\n` +
        `6. \`chainq_report({ ..., locale: "both", format: "html" })\` — このファイルそのもの。`,
    },
  });

  // 9m. References
  sections.push({
    heading: { en: "References & further reading", ja: "参考資料" },
    body: {
      en:
        `- Filecoin spec, [Deals & sectors](https://spec.filecoin.io/#section-systems.filecoin_markets) — official protocol semantics.\n` +
        `- Filfox provider explorer: https://filfox.info/ — sanity-check individual provider numbers.\n` +
        `- DOJ Horizontal Merger Guidelines — source for the HHI thresholds cited in §2.\n` +
        `- chainq docs/COMPARISON.md — when to use chainq vs Dune.`,
      ja:
        `- Filecoin 仕様 [Deals & sectors](https://spec.filecoin.io/#section-systems.filecoin_markets) — プロトコルの正典。\n` +
        `- Filfox provider explorer: https://filfox.info/ — 個別プロバイダの数字の突き合わせに。\n` +
        `- 米国 DOJ Horizontal Merger Guidelines — §2 で参照した HHI 閾値の出典。\n` +
        `- chainq docs/COMPARISON.md — chainq と Dune の使い分け。`,
    },
  });

  // ---------- 10. Write the report ----------
  const out = resolve(REPORT_DIR, "02-filecoin-concentration.html");
  writeReport({
    title: {
      en: "Filecoin storage-provider concentration",
      ja: "Filecoin ストレージプロバイダの集中度",
    },
    outPath: out,
    locale: "both",
    brand: {
      name: "PRIME BEAT · CHAINQ",
      accentColor: "#0ea5e9",
      footer: {
        en: "Authored by **Prime Beat** via [chainq](https://github.com/Jacksstt/chainq). Self-hosted, MCP-native. © 2026 Prime Beat Inc. — MIT.",
        ja: "**Prime Beat** が [chainq](https://github.com/Jacksstt/chainq) 経由で作成。セルフホスト、MCPネイティブ。© 2026 Prime Beat Inc. — MIT。",
      },
    },
    summary: {
      en: `An analyst-grade walkthrough of Filecoin storage concentration: top-N shares, Herfindahl, Gini, Lorenz curve, provider tiers, Filecoin Plus verified-deal share, deal-duration distribution, client diversity, and cohort analysis — all from the same \`filecoin.deals\` table via chainq's MCP surface.`,
      ja: `Filecoin のストレージ集中度をアナリスト水準で分解しています。 top-N シェア、Herfindahl、Gini、ローレンツ曲線、プロバイダ階層、Filecoin Plus 検証済みディール比率、ディール期間分布、クライアント多様性、コホート分析まで、すべて単一の \`filecoin.deals\` テーブルから chainq の MCP インターフェース経由で生成しています。`,
    },
    frontmatter: {
      generated_by: "chainq + scripts/filecoin-demo.ts (synthetic data)",
      table: "filecoin.deals",
      metric: "filecoin_provider_storage + 4 ad-hoc queries",
      providers_total: rows.length,
      deals_total: rows.reduce((s, r) => s + r.deals, 0),
      total_tib: (totals / TIB).toFixed(2),
      verified_share: verifiedShareOverall.toFixed(4),
      hhi: hhi.toFixed(4),
      gini: gini.toFixed(4),
      top10_share: top(10).toFixed(4),
    },
    sections,
  });
  console.log(`[fc] report → ${out}`);
  await engine.stop();
}

// All math helpers (percentile, Gini, Lorenz, bucketize, histogram) live in
// `@chainq/mcp-server/analytics`. This script imports them directly so any
// new chain-specific demo can be ~half the length of this one.

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
