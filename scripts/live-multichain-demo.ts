/**
 * Multi-chain live snapshot — pulls real data from 8 EVM chains in
 * parallel through the same `chainq pull` code path, aggregates, and
 * writes a bilingual single-file HTML report.
 *
 * Run from the repo root (network required):
 *   pnpm exec tsx scripts/live-multichain-demo.ts
 */

import { pull, PUBLIC_ARCHIVES } from "../packages/snapshot/src/index.ts";
import { Engine } from "../packages/mcp-server/src/engine.ts";
import { saveChart } from "../packages/mcp-server/src/charts.ts";
import { writeReport, type ReportSection } from "../packages/mcp-server/src/report.ts";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPORT_DIR = resolve("docs/reports");
const CHART_PREFIX = "07-multichain";

// 8 chains: a mix of L1 + major L2 + newer L2. Block ranges chosen so each
// pull is small (~20-50 blocks) and finishes in a few seconds.
const TARGETS: Array<{ chain: string; from: number; to: number; label: string }> = [
  { chain: "ethereum",  from: 21000000, to: 21000020, label: "Ethereum L1" },
  { chain: "base",      from: 24000000, to: 24000049, label: "Base (OP Stack)" },
  { chain: "arbitrum",  from: 280000000, to: 280000049, label: "Arbitrum One" },
  { chain: "optimism",  from: 128000000, to: 128000049, label: "Optimism" },
  { chain: "polygon",   from: 65000000, to: 65000049, label: "Polygon PoS" },
  { chain: "linea",     from: 12000000, to: 12000049, label: "Linea (zkEVM)" },
  { chain: "scroll",    from: 9000000,  to: 9000049,  label: "Scroll (zkEVM)" },
  { chain: "unichain",  from: 10000000, to: 10000049, label: "Unichain (Uniswap L2)" },
];

interface ChainStats {
  chain: string;
  label: string;
  parquet: string;
  ok: boolean;
  rows: number;
  blocks: number;
  contracts: number;
  topic0s: number;
  txs: number;
  windowMs: number;
  pullElapsed: number;
  topEmitter: { address: string; logs: number } | null;
  error?: string;
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "chainq-multi-"));
  mkdirSync(REPORT_DIR, { recursive: true });

  // ---------- 1. Pull all 8 chains in parallel ----------
  console.log(`[multi] pulling ${TARGETS.length} chains in parallel from public Subsquid archives`);
  const pulls = await Promise.all(
    TARGETS.map(async (t): Promise<ChainStats> => {
      const archiveUrl = PUBLIC_ARCHIVES[t.chain];
      const parquet = join(tmp, `${t.chain}.logs.parquet`);
      const started = Date.now();
      try {
        const r = await pull({
          chain: t.chain,
          archiveUrl,
          fromBlock: t.from,
          toBlock: t.to,
          outDir: tmp,
        });
        return {
          chain: t.chain,
          label: t.label,
          parquet: r.outputPath,
          ok: true,
          rows: r.rows,
          blocks: 0,
          contracts: 0,
          topic0s: 0,
          txs: 0,
          windowMs: 0,
          pullElapsed: Date.now() - started,
          topEmitter: null,
        };
      } catch (err) {
        return {
          chain: t.chain,
          label: t.label,
          parquet,
          ok: false,
          rows: 0, blocks: 0, contracts: 0, topic0s: 0, txs: 0,
          windowMs: 0,
          pullElapsed: Date.now() - started,
          topEmitter: null,
          error: (err as Error).message,
        };
      }
    }),
  );
  for (const p of pulls) {
    console.log(`  ${p.ok ? "✓" : "✗"} ${p.chain.padEnd(10)} ${p.rows.toString().padStart(8)} rows  ${p.pullElapsed}ms${p.error ? "  ERROR: " + p.error.slice(0, 80) : ""}`);
  }

  // ---------- 2. Per-chain analytics over each pulled Parquet ----------
  const engine = new Engine({ dataDir: tmp, cacheDbPath: join(tmp, "c.db") });
  await engine.start();

  for (const p of pulls) {
    if (!p.ok || !existsSync(p.parquet)) continue;
    const stats = await engine.query(
      `SELECT COUNT(*) AS rows,
              COUNT(DISTINCT block_number) AS blocks,
              COUNT(DISTINCT address) AS contracts,
              COUNT(DISTINCT topic0) AS topic0s,
              COUNT(DISTINCT tx_hash) AS txs,
              (epoch(MAX(block_time)) - epoch(MIN(block_time))) * 1000 AS window_ms
       FROM read_parquet('${p.parquet}')`,
      { cacheLabel: null },
    );
    const s = stats.rows[0] as Record<string, unknown>;
    p.rows = Number(s["rows"]);
    p.blocks = Number(s["blocks"]);
    p.contracts = Number(s["contracts"]);
    p.topic0s = Number(s["topic0s"]);
    p.txs = Number(s["txs"]);
    p.windowMs = Number(s["window_ms"]);

    const top = await engine.query(
      `SELECT address, COUNT(*) AS n FROM read_parquet('${p.parquet}') GROUP BY 1 ORDER BY 2 DESC LIMIT 1`,
      { cacheLabel: null },
    );
    const t = top.rows[0] as Record<string, unknown> | undefined;
    if (t) p.topEmitter = { address: String(t["address"]), logs: Number(t["n"]) };
  }

  await engine.stop();

  const ok = pulls.filter((p) => p.ok);
  const failed = pulls.filter((p) => !p.ok);

  // ---------- 3. Charts (PNG + SVG via the new dual-format support) ----------
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

  const logsByChain = ok.map((p) => ({ chain: p.chain, logs: p.rows }));
  const chartLogs = await svg("logs-per-chain", {
    type: "bar",
    data: logsByChain,
    x: "chain",
    y: "logs",
    title: "Logs per chain (50 blocks each, live pull) / チェーン別ログ件数",
  });
  await png("logs-per-chain", {
    type: "bar",
    data: logsByChain,
    x: "chain",
    y: "logs",
    title: "Logs per chain (50 blocks each, live pull)",
  });

  const contractsByChain = ok.map((p) => ({ chain: p.chain, contracts: p.contracts }));
  const chartContracts = await svg("contracts-per-chain", {
    type: "bar",
    data: contractsByChain,
    x: "chain",
    y: "contracts",
    title: "Distinct contracts per chain (50 blocks each) / コントラクト数",
  });

  const txByChain = ok.map((p) => ({ chain: p.chain, txs: p.txs }));
  const chartTxs = await svg("txs-per-chain", {
    type: "bar",
    data: txByChain,
    x: "chain",
    y: "txs",
    title: "Distinct transactions per chain / 取引数",
  });

  // ---------- 4. CSV download for full per-chain stats ----------
  const csvPath = resolve(REPORT_DIR, `${CHART_PREFIX}-stats.csv`);
  const cols = ["chain", "label", "rows", "blocks", "contracts", "topic0s", "txs", "window_seconds", "pull_ms", "top_emitter"];
  const csvLines = [cols.join(",")];
  for (const p of pulls) {
    csvLines.push([
      p.chain, p.label, p.rows, p.blocks, p.contracts, p.topic0s, p.txs,
      (p.windowMs / 1000).toFixed(1),
      p.pullElapsed,
      p.topEmitter?.address ?? "",
    ].map((v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(","));
  }
  writeFileSync(csvPath, csvLines.join("\n"));

  // ---------- 5. Build sections ----------
  const totalLogs = ok.reduce((s, p) => s + p.rows, 0);
  const totalContracts = ok.reduce((s, p) => s + p.contracts, 0);
  const totalPullMs = pulls.reduce((s, p) => s + p.pullElapsed, 0);
  const maxPullMs = Math.max(...pulls.map((p) => p.pullElapsed));

  const sections: ReportSection[] = [];

  sections.push({
    heading: { en: "Executive summary", ja: "エグゼクティブサマリー" },
    body: {
      en:
        `- **${ok.length} of ${TARGETS.length} chains** pulled successfully in **${(maxPullMs / 1000).toFixed(1)}s** wall-clock (parallelised).\n` +
        `- **${totalLogs.toLocaleString()} log events** across **${totalContracts.toLocaleString()} distinct contracts**, all from public Subsquid archives — no API keys, no operated nodes.\n` +
        `- Same \`chainq pull\` code path for every chain. Adding the 9th chain is **one row in PUBLIC_ARCHIVES**.\n` +
        `- This report is itself the proof that 45-chain support is not aspirational: ${ok.length} chains were touched live to build it.`,
      ja:
        `- **${TARGETS.length} 中 ${ok.length} チェーン** を並列で pull、所要時間 **${(maxPullMs / 1000).toFixed(1)}s**（最も遅いプル）。\n` +
        `- **${totalLogs.toLocaleString()} ログ** を **${totalContracts.toLocaleString()} コントラクト** から取得。全て公開 Subsquid アーカイブ経由、API キーなし、RPC ノード運用なし。\n` +
        `- 全チェーンで同じ \`chainq pull\` コードパス。9 チェーン目を追加するのは **PUBLIC_ARCHIVES に 1 行追加するだけ**。\n` +
        `- このレポート自体が「45 チェーン対応は願望ではない」ことの証拠 — 生成のために ${ok.length} チェーンを live で叩いています。`,
    },
  });

  sections.push({
    heading: { en: "1. Per-chain log volume", ja: "1. チェーン別ログ件数" },
    chartPath: chartLogs,
    caption: {
      en: "Logs emitted in the 50-block window for each chain. Cross-chain variance reflects gas usage, contract density, and block time differences.",
      ja: "各チェーン直近50ブロックでのログ発行件数。チェーン間の差はガス使用量、コントラクト密度、ブロック時間の違いを反映しています。",
    },
    downloads: [
      { path: csvPath, label: { en: "All stats CSV", ja: "全統計 CSV" }, format: "csv" },
      { path: `./${CHART_PREFIX}-logs-per-chain.png`, label: { en: "PNG (1600w)", ja: "PNG (1600px)" }, format: "png" },
    ],
  });

  sections.push({
    heading: { en: "2. Distinct contracts per chain", ja: "2. チェーン別コントラクト数" },
    chartPath: chartContracts,
    caption: {
      en: "How many unique contracts emitted at least one event during the window.",
      ja: "ウィンドウ内で 1 つ以上のイベントを発行したユニークなコントラクト数。",
    },
  });

  sections.push({
    heading: { en: "3. Distinct transactions per chain", ja: "3. チェーン別取引数" },
    chartPath: chartTxs,
    caption: {
      en: "Unique transaction count. Combined with contract count, gives a rough activity profile per chain.",
      ja: "ユニークなトランザクション数。コントラクト数と組み合わせるとチェーンごとの大まかな活動プロファイルが見えます。",
    },
  });

  sections.push({
    heading: { en: "4. Per-chain detail", ja: "4. チェーン別詳細" },
    table: pulls.map((p) => ({
      chain: p.chain,
      label: p.label,
      status: p.ok ? "✓" : "✗",
      rows: p.rows,
      blocks: p.blocks,
      contracts: p.contracts,
      topic0s: p.topic0s,
      txs: p.txs,
      window_s: (p.windowMs / 1000).toFixed(1),
      pull_ms: p.pullElapsed,
      top_emitter: p.topEmitter ? `${p.topEmitter.address.slice(0, 10)}… (${p.topEmitter.logs})` : "—",
    })),
  });

  if (failed.length > 0) {
    sections.push({
      heading: { en: "Warning — pulls that failed", ja: "警告 — 失敗した pull" },
      body: {
        en: `${failed.length} of ${TARGETS.length} chains failed to pull. Reasons vary (block range not yet reached on younger chains, transient archive blip). The committed report will reflect this; CI re-runs the demo on every deploy so the live version may differ.`,
        ja: `${TARGETS.length} 中 ${failed.length} チェーンの pull に失敗しました。原因は様々（新しいチェーンで指定ブロックがまだ存在しない、archive の一時的な不調など）。コミット版はこの状態を反映、CI が毎デプロイで再実行するため live 版は異なる可能性があります。`,
      },
      table: failed.map((p) => ({ chain: p.chain, error: (p.error ?? "?").slice(0, 100) })),
    });
  }

  sections.push({
    heading: { en: "5. Methodology", ja: "5. メソドロジー" },
    body: {
      en:
        `**Targets**: 8 chains spanning L1 (Ethereum, Polygon), OP Stack L2 (Base, Optimism, Unichain), Arbitrum stack (Arbitrum One), and zkEVM L2 (Linea, Scroll).\n\n` +
        `**Pull**: \`chainq pull --chain <id> --from N --to N+49\` against each chain's public Subsquid archive in **parallel via \`Promise.all\`**. The slowest pull determined wall-clock time (${(maxPullMs / 1000).toFixed(1)}s); sequential would have been ~${(totalPullMs / 1000).toFixed(1)}s.\n\n` +
        `**Analytics**: per-chain DuckDB \`read_parquet\` + aggregate SELECTs (COUNT, COUNT DISTINCT). Same engine, same code path as the rest of chainq.\n\n` +
        `**Block windows**: 50 blocks each chain. Wall-clock window differs because block time differs (Ethereum 12s, Polygon 2s, Arbitrum 0.25s, etc.). The \`window_s\` column in the detail table makes this explicit.`,
      ja:
        `**対象**: 8 チェーン。L1（Ethereum, Polygon）、OP Stack L2（Base, Optimism, Unichain）、Arbitrum stack（Arbitrum One）、zkEVM L2（Linea, Scroll）を横断。\n\n` +
        `**pull**: 各チェーンに対し \`chainq pull --chain <id> --from N --to N+49\` を **\`Promise.all\` で並列実行**。所要時間は最も遅いプルが決定（${(maxPullMs / 1000).toFixed(1)}s）— 直列なら ${(totalPullMs / 1000).toFixed(1)}s 相当でした。\n\n` +
        `**分析**: チェーンごとに DuckDB \`read_parquet\` + 集約 SELECT（COUNT, COUNT DISTINCT）。エンジンもコードパスも他の chainq 機能と同一。\n\n` +
        `**ブロック範囲**: 各チェーン 50 ブロック。壁時計の長さはチェーンごとに違います（Ethereum 12秒/block, Polygon 2秒, Arbitrum 0.25秒など）。詳細テーブルの \`window_s\` 列で明示しています。`,
    },
  });

  sections.push({
    heading: { en: "Caveats", ja: "注意" },
    body: {
      en:
        `**Cross-chain comparison is shape, not magnitude.** A chain with 50× more logs in the same block window may simply have 50× shorter block times — not 50× more activity. Always normalize by the \`window_s\` column when ranking.\n\n` +
        `**Pull failures are common in CI.** The selected block ranges are arbitrary; if a chain has re-shard'd workers since the slug was first added, the pull will 404. The probe at \`scripts/probe-archives.ts\` validates the URL is reachable but not that every historical range still resolves.`,
      ja:
        `**チェーン間比較は「形」を見るためで、絶対量の比較ではありません。** 同じブロック窓でログが 50 倍出ているチェーンは、単にブロック時間が 1/50 なだけかもしれません — 活動量が 50 倍とは限らない。順位付けする時は必ず \`window_s\` で正規化してください。\n\n` +
        `**CI では pull 失敗が珍しくありません。** ここで選んだブロック範囲は任意の値です — slug 追加後に Subsquid 側で worker がリシャードされている場合、historical range が 404 することがあります。\`scripts/probe-archives.ts\` のプローブは URL の到達性は検証しますが、任意の historical range が引けるかまでは保証しません。`,
    },
  });

  sections.push({
    heading: { en: "Reproducing", ja: "再現手順" },
    body: {
      en:
        `\`\`\`bash\n` +
        `pnpm exec tsx scripts/live-multichain-demo.ts\n` +
        `open docs/reports/07-multichain-live.html\n` +
        `\`\`\`\n\n` +
        `Edit the \`TARGETS\` array to add more chains (any of the 43 in \`docs/SUPPORTED-CHAINS.md\`). Pulls run in parallel, so adding a 9th chain costs ~0 wall-clock time as long as the slowest pull doesn't change.`,
      ja:
        `\`\`\`bash\n` +
        `pnpm exec tsx scripts/live-multichain-demo.ts\n` +
        `open docs/reports/07-multichain-live.html\n` +
        `\`\`\`\n\n` +
        `\`TARGETS\` 配列を編集してチェーン追加可能（\`docs/SUPPORTED-CHAINS.md\` の 43 候補から）。pull は並列実行なので、9 チェーン目を足しても所要時間は最も遅いプルで決まり、ほぼゼロコスト。`,
    },
  });

  // ---------- 6. Write the report ----------
  const outPath = resolve(REPORT_DIR, "07-multichain-live.html");
  writeReport({
    title: {
      en: "Multi-chain live snapshot — 8 EVM chains in parallel",
      ja: "マルチチェーン live スナップショット — 8 EVM チェーン並列",
    },
    outPath,
    locale: "both",
    brand: {
      name: "CHAINQ · MULTI-CHAIN LIVE",
      accentColor: "#8b5cf6",
      footer: {
        en: "Authored by **chainq** with 8 parallel `chainq pull` calls. All data is real, pulled live from public Subsquid archives at build time. No vendor API keys. MIT.",
        ja: "**chainq** が 8 並列 `chainq pull` で生成。全データは公開 Subsquid アーカイブから build 時に live で取得した実 onchain データ。ベンダー API キーなし。MIT。",
      },
    },
    summary: {
      en: `Single self-contained report covering 8 EVM chains. The full \`chainq pull → DuckDB analytics → chart → bilingual HTML report\` pipeline executed end-to-end. ${ok.length} chains succeeded, ${failed.length} failed.`,
      ja: `8 EVM チェーンを 1 つの単一 HTML レポートに統合。\`chainq pull → DuckDB 分析 → チャート → バイリンガル HTML\` の全パイプラインが end-to-end で動作。成功 ${ok.length}、失敗 ${failed.length}。`,
    },
    frontmatter: {
      target_chains: TARGETS.length,
      successful_pulls: ok.length,
      failed_pulls: failed.length,
      total_logs: totalLogs,
      total_distinct_contracts: totalContracts,
      max_pull_ms: maxPullMs,
      total_pull_ms_sequential: totalPullMs,
      parallelism: TARGETS.length,
      pulled_at: new Date().toISOString(),
    },
    sections,
  });
  console.log(`[multi] report → ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
