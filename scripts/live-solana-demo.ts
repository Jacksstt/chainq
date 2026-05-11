/**
 * Live Solana demo — pulls real activity via Helius RPC, runs analytics,
 * writes a bilingual single-file HTML report.
 *
 *   export HELIUS_API_KEY=...   # free tier OK from helius.dev
 *   pnpm exec tsx scripts/live-solana-demo.ts
 *
 * Without an API key, the script prints a friendly message and exits 0
 * so it can sit in CI without failing the build for users who haven't
 * set HELIUS_API_KEY.
 */

import { HeliusClient } from "../packages/ingest-solana/src/index.ts";
import { concentrationSuite, lorenzChartData } from "../packages/mcp-server/src/analytics.ts";
import { saveChart } from "../packages/mcp-server/src/charts.ts";
import { writeReport, type ReportSection } from "../packages/mcp-server/src/report.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REPORT_DIR = resolve("docs/reports");
const CHART_PREFIX = "08-solana-live";
const PAGE_SIZE = 200;
// Wormhole token bridge (well-known, high activity, public). Swap for any
// signature-producing program you want to probe.
const ADDRESS = "wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb";

async function main() {
  const key = process.env.HELIUS_API_KEY;
  if (!key) {
    console.log("[solana] HELIUS_API_KEY not set — skipping live pull.");
    console.log("[solana] Set HELIUS_API_KEY (free tier at https://helius.dev) and re-run to generate the report.");
    return;
  }
  mkdirSync(REPORT_DIR, { recursive: true });

  console.log(`[solana] fetching ${PAGE_SIZE} most-recent signatures for ${ADDRESS}`);
  const client = new HeliusClient({ apiKey: key });
  const sigs = await client.signaturesFor(ADDRESS, { limit: PAGE_SIZE });
  console.log(`[solana] got ${sigs.length} signatures`);

  // Aggregate per-signer fee paid. (Signer = first account in the txn's
  // account keys; we use signature->fee mapping for simplicity here.)
  // For a more analyst-grade view, fetch each tx and aggregate per-signer.
  const feeBySig = sigs.map((s) => ({
    sig: s.signature.slice(0, 12) + "…",
    slot: s.slot,
    err: s.err == null ? 0 : 1,
  }));

  // Concentration over slot density (which slots got the most txns).
  const slotCounts = new Map<number, number>();
  for (const s of sigs) slotCounts.set(s.slot, (slotCounts.get(s.slot) ?? 0) + 1);
  const slotRows = Array.from(slotCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([slot, n]) => ({ slot, count: n }));
  const suite = concentrationSuite(slotRows.map((r) => ({ value: r.count })));

  // Render charts.
  const svg = async (suffix: string, spec: Parameters<typeof saveChart>[0]) => {
    const out = resolve(REPORT_DIR, `${CHART_PREFIX}-${suffix}.svg`);
    await saveChart(spec, out);
    return `./${CHART_PREFIX}-${suffix}.svg`;
  };
  const top20 = slotRows.slice(0, 20);
  const chartTopSlots = await svg("top-slots", {
    type: "bar",
    data: top20.map((r, i) => ({ rank: i + 1, slot: r.slot, count: r.count })),
    x: "rank",
    y: "count",
    title: "Top 20 slots by signature count (live Helius)",
    subtitle: "Solana, last 200 signatures of " + ADDRESS.slice(0, 8) + "…",
    width: 720,
    height: 320,
  });
  const chartLorenz = await svg("lorenz", {
    type: "line",
    data: lorenzChartData(suite.lorenz),
    x: "p_groups",
    y: "p_value",
    title: "Slot concentration Lorenz curve",
    width: 720,
    height: 320,
  });

  // CSV.
  const csvAbs = resolve(REPORT_DIR, `${CHART_PREFIX}-signatures.csv`);
  const csvLines = ["signature_prefix,slot,error_flag"];
  for (const r of feeBySig) csvLines.push(`${r.sig},${r.slot},${r.err}`);
  writeFileSync(csvAbs, csvLines.join("\n"));
  const csvRel = `./${CHART_PREFIX}-signatures.csv`;

  const sections: ReportSection[] = [
    {
      heading: { en: "Executive summary", ja: "エグゼクティブサマリー" },
      body: {
        en:
          `- **${sigs.length} signatures** observed against \`${ADDRESS.slice(0, 12)}…\` in the live Helius pull.\n` +
          `- **${slotCounts.size} distinct slots** touched. Slot concentration HHI=\`${suite.hhi.toFixed(4)}\`, Gini=\`${suite.gini.toFixed(3)}\`.\n` +
          `- Failed txn rate: ${(feeBySig.filter((r) => r.err === 1).length / sigs.length * 100).toFixed(1)}%.`,
        ja:
          `- 対象アドレス \`${ADDRESS.slice(0, 12)}…\` に対して **${sigs.length} signatures** を live で取得。\n` +
          `- **${slotCounts.size} 個のスロット**にまたがる。slot 集中度 HHI=\`${suite.hhi.toFixed(4)}\`、Gini=\`${suite.gini.toFixed(3)}\`。\n` +
          `- 失敗 txn 比率: ${(feeBySig.filter((r) => r.err === 1).length / sigs.length * 100).toFixed(1)}%。`,
      },
    },
    {
      heading: { en: "Top 20 slots", ja: "上位20スロット" },
      chartPath: chartTopSlots,
      caption: {
        en: "Most-touched slots in the recent signature window.",
        ja: "観測ウィンドウで最も叩かれたスロット。",
      },
      downloads: [{ path: csvRel, label: { en: "Signatures CSV", ja: "signature 一覧 CSV" }, format: "csv" }],
    },
    {
      heading: { en: "Slot concentration", ja: "スロット集中度" },
      chartPath: chartLorenz,
      caption: {
        en: `Lorenz curve. HHI=${suite.hhi.toFixed(4)}, Gini=${suite.gini.toFixed(3)}.`,
        ja: `ローレンツ曲線。HHI=${suite.hhi.toFixed(4)}、Gini=${suite.gini.toFixed(3)}。`,
      },
    },
    {
      heading: { en: "Caveats", ja: "注意" },
      body: {
        en: `Helius free tier caps requests per month. This demo touches one address with one ${PAGE_SIZE}-signature pull — cheap enough to re-run frequently. For full account-key aggregation per-signer use \`enrichedTransactions\` (paid plans recommended).`,
        ja: `Helius の無料枠は月間リクエスト数に上限があります。このデモは 1 アドレス × ${PAGE_SIZE} 件 signature 取得で済むので、頻繁に再実行可能。signer 単位の集計まで踏み込むなら \`enrichedTransactions\` を使ってください（有料プラン推奨）。`,
      },
    },
    {
      heading: { en: "Reproducing", ja: "再現手順" },
      body: {
        en:
          "```bash\n" +
          "export HELIUS_API_KEY=...\n" +
          "pnpm exec tsx scripts/live-solana-demo.ts\n" +
          "open docs/reports/08-solana-live.html\n" +
          "```",
        ja:
          "```bash\n" +
          "export HELIUS_API_KEY=...\n" +
          "pnpm exec tsx scripts/live-solana-demo.ts\n" +
          "open docs/reports/08-solana-live.html\n" +
          "```",
      },
    },
  ];

  const outPath = resolve(REPORT_DIR, "08-solana-live.html");
  writeReport({
    title: { en: "Solana live snapshot", ja: "Solana live スナップショット" },
    outPath,
    locale: "both",
    brand: {
      name: "CHAINQ · SOLANA LIVE",
      accentColor: "#9945ff",
      footer: {
        en: "Authored by **chainq** via Helius RPC. Free-tier compatible. MIT.",
        ja: "**chainq** が Helius RPC 経由で生成。無料枠互換、API キーは環境変数で渡す。MIT。",
      },
    },
    summary: {
      en: `${sigs.length} live Solana signatures pulled in one Helius call against ${ADDRESS.slice(0, 12)}…. Slot-density concentration HHI=${suite.hhi.toFixed(4)}, Gini=${suite.gini.toFixed(3)}.`,
      ja: `Helius へ 1 コールで Solana の live signature を ${sigs.length} 件取得（対象 ${ADDRESS.slice(0, 12)}…）。slot 密度の集中度 HHI=${suite.hhi.toFixed(4)}、Gini=${suite.gini.toFixed(3)}。`,
    },
    frontmatter: {
      address: ADDRESS,
      signatures_pulled: sigs.length,
      distinct_slots: slotCounts.size,
      hhi: suite.hhi.toFixed(4),
      gini: suite.gini.toFixed(4),
      failed_rate: (feeBySig.filter((r) => r.err === 1).length / sigs.length).toFixed(4),
      pulled_at: new Date().toISOString(),
    },
    sections,
  });
  console.log(`[solana] report → ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
