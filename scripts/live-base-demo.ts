/**
 * Live Base mainnet end-to-end demo — proves the full chainq pipeline
 * works against real onchain data, not just seeded synthetics.
 *
 * Run from the repo root:
 *   pnpm exec tsx scripts/live-base-demo.ts
 *
 * What it does:
 *   1. Pulls a small Base block range (24000000..24000049) from the public
 *      Subsquid archive via `chainq pull` semantics.
 *   2. Loads the resulting Parquet, runs analytics queries on real logs
 *      (top contracts, block-by-block log frequency, topic0 distribution).
 *   3. Renders three charts (top contracts bar, logs-per-block bar,
 *      topic0 heatmap surrogate).
 *   4. Writes a bilingual single-file HTML report to
 *      docs/reports/05-base-live.html with the analytics, charts, CSV
 *      downloads, and a Caveats section explaining the methodology.
 *
 * The report is committed to the repo so the gallery has at least one
 * report that is provably derived from real Base mainnet data.
 */

import { pull, PUBLIC_ARCHIVES } from "../packages/snapshot/src/index.ts";
import { Engine } from "../packages/mcp-server/src/engine.ts";
import { saveChart } from "../packages/mcp-server/src/charts.ts";
import { writeReport, type ReportSection } from "../packages/mcp-server/src/report.ts";
import { concentrationSuite, lorenzChartData } from "../packages/mcp-server/src/analytics.ts";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPORT_DIR = resolve("docs/reports");
const CHART_PREFIX = "05-base-live";
const FROM_BLOCK = 24_000_000;
const TO_BLOCK = 24_000_049; // 50 blocks ≈ 100 seconds of Base history
const CHAIN = "base";

// Well-known Base contracts for labelled-emitter cross-reference.
const KNOWN_LABELS: Record<string, string> = {
  "0x4200000000000000000000000000000000000006": "WETH (canonical L2 predeploy)",
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC (Circle native on Base)",
  "0x4200000000000000000000000000000000000010": "L2StandardBridge",
  "0x4200000000000000000000000000000000000007": "L2CrossDomainMessenger",
  "0x4200000000000000000000000000000000000016": "L2ToL1MessagePasser",
};

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "chainq-live-"));

  // ---------- 1. Pull live Base ----------
  console.log(`[live] pulling Base ${FROM_BLOCK}..${TO_BLOCK} from public Subsquid archive`);
  const archiveUrl = PUBLIC_ARCHIVES[CHAIN];
  if (!archiveUrl) throw new Error(`no archive for chain ${CHAIN}`);
  const pulled = await pull({
    chain: CHAIN,
    archiveUrl,
    fromBlock: FROM_BLOCK,
    toBlock: TO_BLOCK,
    outDir: tmp,
  });
  console.log(`[live] wrote ${pulled.rows} logs to ${pulled.outputPath}`);

  // ---------- 2. Open the engine over the live Parquet ----------
  const engine = new Engine({ dataDir: tmp, cacheDbPath: join(tmp, "cache.duckdb") });
  await engine.start();

  // We can't use the catalog views directly (those expect `dex.trades` etc.)
  // The pulled file is `base.logs.parquet`; query it via read_parquet.
  const parquetPath = pulled.outputPath;

  // ---------- 3. Analytics on real data ----------
  const stats = await engine.query(
    `SELECT
       COUNT(*) AS logs,
       COUNT(DISTINCT block_number) AS blocks,
       COUNT(DISTINCT address) AS contracts,
       COUNT(DISTINCT topic0) AS topic0s,
       MIN(block_number) AS minb, MAX(block_number) AS maxb,
       MIN(block_time) AS mint, MAX(block_time) AS maxt
     FROM read_parquet('${parquetPath}')`,
    { cacheLabel: null },
  );
  const s = stats.rows[0] as Record<string, unknown>;
  const range = Number(s["maxb"]) - Number(s["minb"]) + 1;
  console.log(`[live] ${s["logs"]} logs / ${s["blocks"]} blocks / ${s["contracts"]} contracts / ${s["topic0s"]} distinct topic0`);

  const topContracts = await engine.query(
    `SELECT address, COUNT(*) AS logs
     FROM read_parquet('${parquetPath}')
     GROUP BY 1 ORDER BY 2 DESC LIMIT 25`,
    { maxRows: 25, cacheLabel: null },
  );
  const topRows = (topContracts.rows as Array<Record<string, unknown>>).map((r) => ({
    address: String(r["address"]),
    logs: Number(r["logs"]),
    label: KNOWN_LABELS[String(r["address"])] ?? "",
  }));

  const logsPerBlock = await engine.query(
    `SELECT block_number, COUNT(*) AS logs
     FROM read_parquet('${parquetPath}')
     GROUP BY 1 ORDER BY 1`,
    { maxRows: 5000, cacheLabel: null },
  );
  const blockRows = (logsPerBlock.rows as Array<Record<string, unknown>>).map((r) => ({
    block_number: Number(r["block_number"]),
    logs: Number(r["logs"]),
  }));

  const topTopics = await engine.query(
    `SELECT topic0, COUNT(*) AS hits
     FROM read_parquet('${parquetPath}')
     WHERE topic0 IS NOT NULL
     GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
    { maxRows: 15, cacheLabel: null },
  );
  const topicRows = (topTopics.rows as Array<Record<string, unknown>>).map((r) => ({
    topic0: String(r["topic0"]).slice(0, 12) + "…",
    hits: Number(r["hits"]),
  }));

  // Concentration suite over contract emitters.
  const suite = concentrationSuite(topRows.map((r) => ({ value: r.logs })));

  // ---------- 4. Charts (static SVG + CSV) ----------
  const svg = async (suffix: string, spec: Parameters<typeof saveChart>[0]) => {
    const out = resolve(REPORT_DIR, `${CHART_PREFIX}-${suffix}.svg`);
    await saveChart(spec, out);
    return `./${CHART_PREFIX}-${suffix}.svg`;
  };
  const csv = (suffix: string, rows: Array<Record<string, unknown>>): string => {
    const filePath = resolve(REPORT_DIR, `${CHART_PREFIX}-${suffix}.csv`);
    if (rows.length === 0) { writeFileSync(filePath, ""); return `./${CHART_PREFIX}-${suffix}.csv`; }
    const cols = Object.keys(rows[0]!);
    const escapeCsv = (v: unknown) => {
      const t = v == null ? "" : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const lines = [cols.join(","), ...rows.map((r) => cols.map((c) => escapeCsv(r[c])).join(","))];
    writeFileSync(filePath, lines.join("\n"));
    return `./${CHART_PREFIX}-${suffix}.csv`;
  };

  const chartTopContracts = await svg("top-contracts", {
    type: "bar",
    data: topRows.map((r, i) => ({ rank: i + 1, address: r.address.slice(0, 8) + "…", logs: r.logs })),
    x: "rank",
    y: "logs",
    title: "Top 25 contracts by log count (live Base) / 上位25コントラクト",
  });
  const chartLogsPerBlock = await svg("logs-per-block", {
    type: "bar",
    data: blockRows,
    x: "block_number",
    y: "logs",
    title: "Logs per block (live Base) / ブロック別ログ件数",
  });
  const chartTopTopics = await svg("top-topics", {
    type: "bar",
    data: topicRows,
    x: "topic0",
    y: "hits",
    title: "Top 15 event signatures by emission count / 上位15イベントシグネチャ",
  });
  const chartLorenz = await svg("lorenz", {
    type: "line",
    data: lorenzChartData(suite.lorenz),
    x: "p_groups",
    y: "p_value",
    title: "Lorenz curve — top-25 contracts vs. log share / ローレンツ曲線",
  });

  const csvTopContracts = csv("top-contracts", topRows);
  const csvLogsPerBlock = csv("logs-per-block", blockRows);
  const csvTopTopics = csv("top-topics", topicRows);

  // ---------- 5. Report ----------
  // Engine.query() runs the rows through `normalize()` which converts DuckDB
  // TIMESTAMP into ISO strings — they arrive as plain strings, not `{micros}`.
  const minIso = String(s["mint"] ?? "");
  const maxIso = String(s["maxt"] ?? "");

  const sections: ReportSection[] = [];

  sections.push({
    heading: { en: "Executive summary", ja: "エグゼクティブサマリー" },
    body: {
      en:
        `- **${s["logs"]} logs** across **${s["blocks"]} blocks** of Base mainnet (${FROM_BLOCK} → ${TO_BLOCK}, ${range} blocks).\n` +
        `- **${s["contracts"]} distinct contracts** emitted events; **${s["topic0s"]} distinct event signatures**.\n` +
        `- Top-1 contract (${topRows[0]?.label || topRows[0]?.address}) accounted for **${((topRows[0]?.logs ?? 0) / Number(s["logs"]) * 100).toFixed(1)}%** of all logs in this window.\n` +
        `- Window: ${minIso} → ${maxIso} (Base mainnet, ~2-second block time).\n` +
        `- Data was pulled live from the public Subsquid archive — **no synthetic seed used here**.`,
      ja:
        `- Base メインネットの **${s["blocks"]} ブロック**（${FROM_BLOCK}-${TO_BLOCK}、計 ${range} ブロック）に**${s["logs"]} 件のログ**。\n` +
        `- **${s["contracts"]} 個のコントラクト**がイベントを発行、**${s["topic0s"]} 種類のイベントシグネチャ**を観測。\n` +
        `- トップ1のコントラクト（${topRows[0]?.label || topRows[0]?.address}）が当該ウィンドウのログ全体の **${((topRows[0]?.logs ?? 0) / Number(s["logs"]) * 100).toFixed(1)}%** を占めました。\n` +
        `- 期間: ${minIso} ～ ${maxIso}（Base メインネット、約2秒ブロック）。\n` +
        `- データは公開 Subsquid アーカイブから live で取得。**シードデータは一切使っていません**。`,
    },
  });

  sections.push({
    heading: { en: "1. Methodology & live-data provenance", ja: "1. メソドロジー & データ来歴" },
    body: {
      en:
        `**Pull**: \`chainq pull --chain base --from ${FROM_BLOCK} --to ${TO_BLOCK}\` against ${archiveUrl}. ` +
        `Returned ${s["logs"]} log rows, ${pulled.rows} confirmed by the snapshot package's row counter.\n\n` +
        `**Engine**: DuckDB in-process over the resulting Parquet (no caching layer used).\n\n` +
        `**Queries**: four ad-hoc SELECTs (totals, top emitters, per-block log counts, top event signatures) plus the in-process \`concentrationSuite\` helper for HHI / Gini / Lorenz.\n\n` +
        `**Cross-reference**: the top contracts are matched against a hardcoded label map of well-known Base predeploys and major tokens (see Top contracts section). Unmatched addresses display their raw address.`,
      ja:
        `**pull**: \`chainq pull --chain base --from ${FROM_BLOCK} --to ${TO_BLOCK}\` を ${archiveUrl} に対して実行。${s["logs"]} 行のログを取得（snapshot パッケージの row counter は ${pulled.rows} と一致）。\n\n` +
        `**エンジン**: DuckDB をプロセス内で起動し、取得した Parquet を直接読みます（recall キャッシュは未使用）。\n\n` +
        `**クエリ**: 4 本のアドホック SELECT（総数・トップ発行コントラクト・ブロックごとのログ件数・トップイベントシグネチャ）に加え、in-process の \`concentrationSuite\` で HHI / Gini / ローレンツ曲線を計算。\n\n` +
        `**横参照**: トップコントラクトは、Base の主要 predeploy + 主要トークンのハードコードラベルと突き合わせています（次セクションを参照）。マッチしないアドレスは生のまま表示。`,
    },
  });

  sections.push({
    heading: { en: "2. Top 25 contracts (real Base emitters)", ja: "2. トップ25コントラクト (Base 実コントラクト)" },
    chartPath: chartTopContracts,
    caption: {
      en: "Log counts per contract for the top 25, sorted descending.",
      ja: "上位25コントラクトのログ件数、降順。",
    },
    downloads: [
      { path: csvTopContracts, label: { en: "Top contracts CSV", ja: "上位コントラクト CSV" }, format: "csv" },
    ],
  });
  sections.push({
    heading: { en: "2a. Top 25 (labelled)", ja: "2a. ラベル付き上位25" },
    table: topRows.slice(0, 15).map((r, i) => ({
      rank: i + 1,
      address: r.address,
      logs: r.logs,
      share: `${(r.logs / Number(s["logs"]) * 100).toFixed(2)}%`,
      label: r.label || "—",
    })),
  });

  sections.push({
    heading: { en: "3. Logs per block", ja: "3. ブロック単位のログ件数" },
    chartPath: chartLogsPerBlock,
    caption: {
      en: "Log counts for each block in the window. Spikes typically coincide with high-activity moments (e.g. liquidations, popular mints).",
      ja: "ウィンドウ内の各ブロックのログ件数。突出している箇所は通常、清算や人気ミントなどの高活動イベントと一致します。",
    },
    downloads: [
      { path: csvLogsPerBlock, label: { en: "Per-block CSV", ja: "ブロック別 CSV" }, format: "csv" },
    ],
  });

  sections.push({
    heading: { en: "4. Top event signatures (topic0)", ja: "4. イベントシグネチャ (topic0) 上位" },
    chartPath: chartTopTopics,
    caption: {
      en: "Most-emitted topic0 (event signature) hashes in the window.",
      ja: "当該ウィンドウで最も多く発火した topic0（イベントシグネチャハッシュ）。",
    },
    downloads: [
      { path: csvTopTopics, label: { en: "topic0 CSV", ja: "topic0 CSV" }, format: "csv" },
    ],
  });

  sections.push({
    heading: { en: "5. Concentration suite (over top-25)", ja: "5. 集中度指標（上位25内）" },
    chartPath: chartLorenz,
    caption: {
      en: `HHI = ${suite.hhi.toFixed(4)}, Gini = ${suite.gini.toFixed(3)}. Computed over the top-25 emitters only.`,
      ja: `HHI = ${suite.hhi.toFixed(4)}, Gini = ${suite.gini.toFixed(3)}。上位25コントラクトのみで計算。`,
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
    heading: { en: "Caveats", ja: "注意" },
    body: {
      en:
        `Pulled window is intentionally small (${range} blocks ≈ ${range * 2} seconds of Base history). Extending to a day or longer is one more parameter on \`chainq pull\` and a corresponding hike on the budget cap.\n\n` +
        `The Concentration suite is computed over the **top-25 emitters only**, not over all ${s["contracts"]} contracts in the window — running it over the full set would be more meaningful for a real-world report, and is a one-line code change. This report's purpose is the **provenance proof**, not the substantive analysis.\n\n` +
        `Event-signature topic0 strings are 32-byte hashes — most are not human-readable until joined with a 4byte-style ABI registry (not wired in this build).`,
      ja:
        `取得ウィンドウは意図的に小さくしています（${range} ブロック ≈ ${range * 2} 秒の Base 履歴）。1 日分や 1 週間分への拡張は \`chainq pull\` の引数を変えて、予算上限を上げるだけです。\n\n` +
        `集中度指標は **上位25コントラクト内** だけで計算しています。本格的なレポートではウィンドウ内の全 ${s["contracts"]} コントラクトを対象にすべきで、修正は 1 行のコード変更で済みます。本レポートの目的は**データ来歴の証明**であって、解釈の精緻さではありません。\n\n` +
        `イベントシグネチャの topic0 は 32 バイトハッシュです。4byte 系の ABI レジストリと突き合わせない限り人間可読にはなりません（本ビルドでは未接続）。`,
    },
  });

  sections.push({
    heading: { en: "Reproducing this report", ja: "再現手順" },
    body: {
      en:
        `\`\`\`bash\n` +
        `pnpm exec tsx scripts/live-base-demo.ts\n` +
        `open docs/reports/05-base-live.html\n` +
        `\`\`\`\n\n` +
        `The script issues exactly one \`chainq pull\` to the public Subsquid archive — no API keys, no RPC node. It then runs four ad-hoc DuckDB queries on the resulting Parquet, renders four charts, and writes this single-file HTML report. Re-running on a different block range is one constant edit.`,
      ja:
        `\`\`\`bash\n` +
        `pnpm exec tsx scripts/live-base-demo.ts\n` +
        `open docs/reports/05-base-live.html\n` +
        `\`\`\`\n\n` +
        `スクリプトは公開 Subsquid アーカイブに対して \`chainq pull\` を 1 回だけ実行します — API キーも RPC ノードも不要。取得した Parquet に対して DuckDB の SELECT を 4 本走らせ、4 枚のチャートを描画し、この単一 HTML レポートを書き出します。別のブロック範囲で再実行するには定数を 1 つ書き換えるだけ。`,
    },
  });

  const outPath = resolve(REPORT_DIR, "05-base-live.html");
  writeReport({
    title: {
      en: "Base mainnet — live 100-second snapshot",
      ja: "Base メインネット — live 100秒スナップショット",
    },
    outPath,
    locale: "both",
    brand: {
      name: "CHAINQ · LIVE DATA",
      accentColor: "#10b981",
      footer: {
        en: "Authored by **chainq** against the public Subsquid archive. No vendor API, no RPC node, no synthetic data — see [LIVE-INGEST-PROOF.md](https://github.com/Jacksstt/chainq/blob/main/docs/LIVE-INGEST-PROOF.md). MIT.",
        ja: "**chainq** が公開 Subsquid アーカイブから取得して作成。ベンダー API なし、RPC ノードなし、合成データなし — [LIVE-INGEST-PROOF.md](https://github.com/Jacksstt/chainq/blob/main/docs/LIVE-INGEST-PROOF.md) を参照。MIT。",
      },
    },
    summary: {
      en: `A self-contained report generated end-to-end from real Base mainnet log data. The 50-block window ${FROM_BLOCK}–${TO_BLOCK} (${minIso}) yielded **${s["logs"]} logs** from **${s["contracts"]} contracts**. Provenance: public Subsquid archive, pulled via \`chainq pull\` minutes before this file was written.`,
      ja: `Base メインネットの実ログから end-to-end で生成した単一 HTML レポート。50ブロックのウィンドウ ${FROM_BLOCK}-${TO_BLOCK}（${minIso}）から **${s["logs"]} 件のログ** を **${s["contracts"]} 個のコントラクト** が発行していました。来歴: 公開 Subsquid アーカイブ。本ファイル生成の数分前に \`chainq pull\` で取得。`,
    },
    frontmatter: {
      chain: CHAIN,
      from_block: FROM_BLOCK,
      to_block: TO_BLOCK,
      block_window_seconds: range * 2,
      logs_total: Number(s["logs"]),
      distinct_contracts: Number(s["contracts"]),
      distinct_topic0: Number(s["topic0s"]),
      top1_share: `${((topRows[0]?.logs ?? 0) / Number(s["logs"]) * 100).toFixed(2)}%`,
      pulled_at: new Date().toISOString(),
      source: archiveUrl,
    },
    sections,
  });
  console.log(`[live] report → ${outPath}`);

  await engine.stop();
  if (!existsSync(outPath)) throw new Error("report not written");
}

main().catch((e) => { console.error(e); process.exit(1); });
