/**
 * Live Filecoin end-to-end demo — pulls a fresh batch of recent deals
 * from Filfox, runs the concentration suite on REAL provider data,
 * writes a bilingual single-file HTML report.
 *
 * Run from the repo root (network required):
 *   pnpm exec tsx scripts/live-filecoin-demo.ts
 */

import { fetchRecentDeals } from "../packages/ingest-filecoin/src/index.ts";
import { concentrationSuite, bucketize, lorenzChartData } from "../packages/mcp-server/src/analytics.ts";
import { saveChart } from "../packages/mcp-server/src/charts.ts";
import { writeReport, type ReportSection } from "../packages/mcp-server/src/report.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REPORT_DIR = resolve("docs/reports");
const CHART_PREFIX = "06-filecoin-live";
const PAGE_SIZE = 200;
const TIB = 1_099_511_627_776;

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });

  console.log(`[fc-live] fetching up to ${PAGE_SIZE} most-recent Filecoin deals from Filfox`);
  const deals = await fetchRecentDeals({}, PAGE_SIZE);
  console.log(`[fc-live] got ${deals.length} deals`);

  // Aggregate per-provider
  const byProvider = new Map<string, { provider: string; bytes: number; deals: number; verified: number }>();
  for (const d of deals) {
    const p = byProvider.get(d.provider) ?? { provider: d.provider, bytes: 0, deals: 0, verified: 0 };
    p.bytes += d.pieceSize;
    p.deals += 1;
    if (d.verifiedDeal) p.verified += 1;
    byProvider.set(d.provider, p);
  }
  const providers = Array.from(byProvider.values()).sort((a, b) => b.bytes - a.bytes);
  const totalBytes = providers.reduce((s, p) => s + p.bytes, 0);
  console.log(`[fc-live] ${providers.length} distinct providers, ${(totalBytes / TIB).toFixed(2)} TiB total`);

  const suite = concentrationSuite(providers.map((p) => ({ value: p.bytes })));
  const verifiedDeals = deals.filter((d) => d.verifiedDeal).length;
  const verifiedShare = verifiedDeals / deals.length;

  // Provider tiers (TiB-based)
  const TIER_SPECS = [
    { label: "<1 TiB",   min: 0,   max: 1   },
    { label: "1-10 TiB", min: 1,   max: 10  },
    { label: "10-50 TiB",min: 10,  max: 50  },
    { label: ">50 TiB",  min: 50,  max: Infinity },
  ];
  const providersWithTib = providers.map((p) => ({ ...p, tib: p.bytes / TIB }));
  const tiers = bucketize(providersWithTib, (p) => p.tib, TIER_SPECS);

  // ---------- charts ----------
  const top15 = providers.slice(0, 15);
  const svg = async (suffix: string, spec: Parameters<typeof saveChart>[0]) => {
    const out = resolve(REPORT_DIR, `${CHART_PREFIX}-${suffix}.svg`);
    await saveChart(spec, out);
    return `./${CHART_PREFIX}-${suffix}.svg`;
  };
  const csv = (suffix: string, rows: Array<Record<string, unknown>>): string => {
    const filePath = resolve(REPORT_DIR, `${CHART_PREFIX}-${suffix}.csv`);
    if (rows.length === 0) { writeFileSync(filePath, ""); return `./${CHART_PREFIX}-${suffix}.csv`; }
    const cols = Object.keys(rows[0]!);
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    writeFileSync(filePath, [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n"));
    return `./${CHART_PREFIX}-${suffix}.csv`;
  };

  const chartTop = await svg("top-providers", {
    type: "bar",
    data: top15.map((p, i) => ({ rank: i + 1, provider: p.provider, tib: Number((p.bytes / TIB).toFixed(2)) })),
    x: "rank",
    y: "tib",
    title: "Top 15 Filecoin providers (live Filfox) — TiB stored / 上位15プロバイダ",
  });
  const chartLorenz = await svg("lorenz", {
    type: "line",
    data: lorenzChartData(suite.lorenz),
    x: "p_groups",
    y: "p_value",
    title: "Lorenz curve — Filecoin storage concentration / ローレンツ曲線",
  });
  const chartTiers = await svg("tiers", {
    type: "bar",
    data: tiers.map((t) => ({ tier: t.label, count: t.count })),
    x: "tier",
    y: "count",
    title: "Provider count by tier (live Filfox) / 容量帯別プロバイダ数",
  });

  const csvProviders = csv("providers", providers.map((p, i) => ({
    rank: i + 1,
    provider: p.provider,
    tib: (p.bytes / TIB).toFixed(2),
    deals: p.deals,
    verified_deals: p.verified,
    share: `${(p.bytes / totalBytes * 100).toFixed(2)}%`,
  })));

  // ---------- report ----------
  const minEpoch = Math.min(...deals.map((d) => d.startEpoch));
  const maxEpoch = Math.max(...deals.map((d) => d.startEpoch));

  const sections: ReportSection[] = [];

  sections.push({
    heading: { en: "Executive summary", ja: "エグゼクティブサマリー" },
    body: {
      en:
        `- **${deals.length} most-recent Filecoin deals** from Filfox, ${providers.length} distinct storage providers, **${(totalBytes / TIB).toFixed(1)} TiB** total commitment.\n` +
        `- Top 1 provider holds **${(((providers[0]?.bytes ?? 0) / totalBytes) * 100).toFixed(1)}%** of committed bytes in this window.\n` +
        `- Top 10 share: **${((suite.topN[10] ?? 0) * 100).toFixed(1)}%**. HHI=\`${suite.hhi.toFixed(4)}\`, Gini=\`${suite.gini.toFixed(3)}\`.\n` +
        `- Filecoin Plus verified deals: **${(verifiedShare * 100).toFixed(1)}%** of the batch (${verifiedDeals} / ${deals.length}).\n` +
        `- Epoch range observed: ${minEpoch} – ${maxEpoch}. All data is live from \`filfox.info/api/v1/deal/list\`; no synthetic seed.`,
      ja:
        `- Filfox から取得した直近 **${deals.length} 件の Filecoin ディール**、ストレージプロバイダ ${providers.length} 社、計 **${(totalBytes / TIB).toFixed(1)} TiB** のコミット。\n` +
        `- トップ1プロバイダが当該ウィンドウのコミット容量の **${(((providers[0]?.bytes ?? 0) / totalBytes) * 100).toFixed(1)}%** を保持。\n` +
        `- 上位10のシェア: **${((suite.topN[10] ?? 0) * 100).toFixed(1)}%**。HHI=\`${suite.hhi.toFixed(4)}\`、Gini=\`${suite.gini.toFixed(3)}\`。\n` +
        `- Filecoin Plus 検証済みディール: **${(verifiedShare * 100).toFixed(1)}%**（${verifiedDeals} / ${deals.length} 件）。\n` +
        `- 観測した epoch 範囲: ${minEpoch} – ${maxEpoch}。データは全て \`filfox.info/api/v1/deal/list\` から live で取得、合成データなし。`,
    },
  });

  sections.push({
    heading: { en: "1. Top 15 providers (live)", ja: "1. トップ15プロバイダ（live データ）" },
    chartPath: chartTop,
    caption: { en: "TiB committed per provider in this batch.", ja: "本バッチで観測されたプロバイダ別 TiB コミット量。" },
    downloads: [{ path: csvProviders, label: { en: "All providers CSV", ja: "全プロバイダ CSV" }, format: "csv" }],
  });

  sections.push({
    heading: { en: "1a. Top 10 raw", ja: "1a. 上位10 生の数値" },
    table: providers.slice(0, 10).map((p, i) => ({
      rank: i + 1,
      provider: p.provider,
      tib: (p.bytes / TIB).toFixed(2),
      deals: p.deals,
      verified_deals: p.verified,
      share: `${(p.bytes / totalBytes * 100).toFixed(2)}%`,
    })),
  });

  sections.push({
    heading: { en: "2. Concentration suite", ja: "2. 集中度指標" },
    chartPath: chartLorenz,
    caption: {
      en: `HHI = ${suite.hhi.toFixed(4)}, Gini = ${suite.gini.toFixed(3)}. Computed over all ${providers.length} live providers.`,
      ja: `HHI = ${suite.hhi.toFixed(4)}, Gini = ${suite.gini.toFixed(3)}。live で観測された全 ${providers.length} プロバイダで計算。`,
    },
    table: [
      { metric: "top-1 share",  value: ((suite.topN[1]  ?? 0) * 100).toFixed(2) + "%" },
      { metric: "top-5 share",  value: ((suite.topN[5]  ?? 0) * 100).toFixed(2) + "%" },
      { metric: "top-10 share", value: ((suite.topN[10] ?? 0) * 100).toFixed(2) + "%" },
      { metric: "HHI",          value: suite.hhi.toFixed(4) },
      { metric: "Gini",         value: suite.gini.toFixed(3) },
    ],
  });

  sections.push({
    heading: { en: "3. Provider tier distribution", ja: "3. 容量帯別プロバイダ数" },
    chartPath: chartTiers,
    caption: {
      en: "Provider count bucketed by live TiB commitment within this batch.",
      ja: "本バッチ内で観測された TiB コミット量によるプロバイダ階層分布。",
    },
    table: tiers.map((t) => ({
      tier: t.label,
      providers: t.count,
      total_tib: (t.total / TIB).toFixed(2),
      share: `${(t.share * 100).toFixed(2)}%`,
    })),
  });

  sections.push({
    heading: { en: "Caveats", ja: "注意" },
    body: {
      en:
        `Filfox \`/deal/list\` returns the most recent ${deals.length} deals as of the API call moment — this is a **point-in-time live sample**, not a comprehensive epoch range. For canonical mainnet concentration use a wider pull.\n\n` +
        `Concentration in this small batch can swing significantly between calls. The HHI / Gini reported here is meaningful for the specific window observed and should not be extrapolated.`,
      ja:
        `Filfox \`/deal/list\` は API 呼び出し時点での直近 ${deals.length} 件を返します。ここで観測しているのは**特定時点のスナップショット**であり、特定の epoch 範囲を網羅したものではありません。本格的な評価にはより広いプルが必要です。\n\n` +
        `この小さいバッチでの集中度はコール間で振れます。ここで報告した HHI / Gini は観測ウィンドウに対してのみ意味があり、外挿には不適切です。`,
    },
  });

  sections.push({
    heading: { en: "Reproducing this report", ja: "再現手順" },
    body: {
      en:
        `\`\`\`bash\n` +
        `pnpm exec tsx scripts/live-filecoin-demo.ts\n` +
        `open docs/reports/06-filecoin-live.html\n` +
        `\`\`\`\n\n` +
        `One Filfox HTTP call, no API key. The numbers will differ from this committed version because Filfox returns the most recent ${deals.length} deals at the moment of the call — re-run to see the network's current shape.`,
      ja:
        `\`\`\`bash\n` +
        `pnpm exec tsx scripts/live-filecoin-demo.ts\n` +
        `open docs/reports/06-filecoin-live.html\n` +
        `\`\`\`\n\n` +
        `Filfox に HTTP コール 1 回、API キー不要。数字はコミット版とは異なります。Filfox がコール時点の直近 ${deals.length} 件を返すからです — 再実行で現在のネットワーク状態が見えます。`,
    },
  });

  const outPath = resolve(REPORT_DIR, "06-filecoin-live.html");
  writeReport({
    title: {
      en: "Filecoin mainnet — live concentration snapshot",
      ja: "Filecoin メインネット — live 集中度スナップショット",
    },
    outPath,
    locale: "both",
    brand: {
      name: "CHAINQ · LIVE DATA",
      accentColor: "#10b981",
      footer: {
        en: "Authored by **chainq** against Filfox public API. No vendor API key — see [LIVE-INGEST-PROOF.md](https://github.com/Jacksstt/chainq/blob/main/docs/LIVE-INGEST-PROOF.md). MIT.",
        ja: "**chainq** が Filfox 公開 API から取得して作成。ベンダー API キー不要 — [LIVE-INGEST-PROOF.md](https://github.com/Jacksstt/chainq/blob/main/docs/LIVE-INGEST-PROOF.md) を参照。MIT。",
      },
    },
    summary: {
      en: `End-to-end report from a live Filfox pull. ${deals.length} most-recent deals across ${providers.length} providers (${(totalBytes / TIB).toFixed(1)} TiB total). Filecoin Plus verified share: ${(verifiedShare * 100).toFixed(1)}%.`,
      ja: `Filfox からの live プルで生成。直近 ${deals.length} ディール、プロバイダ ${providers.length} 社、計 ${(totalBytes / TIB).toFixed(1)} TiB。Filecoin Plus 検証済み比率: ${(verifiedShare * 100).toFixed(1)}%。`,
    },
    frontmatter: {
      chain: "filecoin",
      source: "https://filfox.info/api/v1/deal/list",
      deals_total: deals.length,
      providers_total: providers.length,
      total_tib: (totalBytes / TIB).toFixed(2),
      verified_share: verifiedShare.toFixed(4),
      hhi: suite.hhi.toFixed(4),
      gini: suite.gini.toFixed(4),
      pulled_at: new Date().toISOString(),
    },
    sections,
  });
  console.log(`[fc-live] report → ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
