/**
 * @chainq/snapshot — pull and publish Parquet snapshots.
 *
 * The point: you don't need to run your own RPC or Ethereum node. Pull a
 * pre-built snapshot from a public source (Subsquid archive, a community
 * CDN, or Filecoin / IPFS) and chainq has data the moment the download
 * finishes.
 *
 * Default source for v0.0.x is the Subsquid public archive, which is itself
 * free for the chains chainq cares about.
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

import { streamSubsquid } from "@chainq/ingest-evm";

export interface PullOptions {
  /** Which chain we are pulling for — used for the output filename. */
  chain: string;
  /** Subsquid archive base URL. */
  archiveUrl: string;
  /** Inclusive starting block. */
  fromBlock: number;
  /** Inclusive ending block. */
  toBlock: number;
  /** Directory to write Parquet to (default ./data). */
  outDir?: string;
  /** Dataset to extract. v0.0.x supports "logs"; more to come. */
  dataset?: "logs";
  /** Max batches to fetch (safety cap). */
  maxBatches?: number;
  /** Filter for logs. */
  logFilter?: { address?: string[]; topic0?: string[] };
}

export interface PullResult {
  chain: string;
  outputPath: string;
  rows: number;
  fromBlock: number;
  toBlock: number;
}

/**
 * Stream from a Subsquid archive into a local Parquet file.
 */
export async function pull(opts: PullOptions): Promise<PullResult> {
  const outDir = resolve(opts.outDir ?? "./data");
  mkdirSync(outDir, { recursive: true });
  const outputPath = join(outDir, `${opts.chain}.logs.parquet`);

  // Stream logs.
  const rows: LogRow[] = [];
  let seenTo = opts.fromBlock;
  for await (const batch of streamSubsquid({
    archiveUrl: opts.archiveUrl,
    fromBlock: opts.fromBlock,
    toBlock: opts.toBlock,
    request: { logs: [opts.logFilter ?? {}] },
  })) {
    for (const log of batch.logs ?? []) {
      rows.push({
        block_number: Number(batch.header.number),
        block_time: new Date((Number(batch.header.timestamp) || 0) * 1000).toISOString(),
        chain: opts.chain,
        tx_hash: String(log["transactionHash"] ?? ""),
        log_index: Number(log["logIndex"] ?? 0),
        address: String(log["address"] ?? "").toLowerCase(),
        topic0: arrayAt(log["topics"], 0),
        topic1: arrayAt(log["topics"], 1),
        topic2: arrayAt(log["topics"], 2),
        topic3: arrayAt(log["topics"], 3),
        data: String(log["data"] ?? ""),
      });
    }
    seenTo = Math.max(seenTo, batch.header.number);
    if (opts.maxBatches && rows.length / 1000 >= opts.maxBatches) break;
  }

  // Write via DuckDB COPY for compactness.
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  await conn.run(`
    CREATE TABLE logs (
      block_number BIGINT,
      block_time   TIMESTAMP,
      chain        VARCHAR,
      tx_hash      VARCHAR,
      log_index    INTEGER,
      address      VARCHAR,
      topic0       VARCHAR,
      topic1       VARCHAR,
      topic2       VARCHAR,
      topic3       VARCHAR,
      data         VARCHAR
    )
  `);
  for (const r of rows) {
    await conn.run(
      `INSERT INTO logs VALUES (?, CAST(? AS TIMESTAMP), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        BigInt(r.block_number),
        r.block_time,
        r.chain,
        r.tx_hash,
        r.log_index,
        r.address,
        r.topic0 ?? null,
        r.topic1 ?? null,
        r.topic2 ?? null,
        r.topic3 ?? null,
        r.data,
      ],
    );
  }
  await conn.run(`COPY logs TO '${outputPath}' (FORMAT 'parquet', COMPRESSION 'zstd')`);
  conn.disconnectSync();

  return {
    chain: opts.chain,
    outputPath,
    rows: rows.length,
    fromBlock: opts.fromBlock,
    toBlock: seenTo,
  };
}

/**
 * Public Subsquid archives.
 *
 * Every entry points at a v2 archive URL of the form
 *   https://v2.archive.subsquid.io/network/<archive-slug>
 * and is reachable without any API key. Reachability is probed by
 * `scripts/probe-archives.ts` — the results live in
 * `docs/SUPPORTED-CHAINS.md`. An entry being present here means we know
 * the URL pattern; whether it is currently UP is what the probe records.
 *
 * Adding a chain: append a row, then run
 *   pnpm exec tsx scripts/probe-archives.ts --write
 */
export const PUBLIC_ARCHIVES: Record<string, string> = {
  // ---------- L1 EVM ----------
  ethereum:          "https://v2.archive.subsquid.io/network/ethereum-mainnet",
  bnb:               "https://v2.archive.subsquid.io/network/binance-mainnet",
  avalanche:         "https://v2.archive.subsquid.io/network/avalanche-mainnet",
  sonic:             "https://v2.archive.subsquid.io/network/sonic-mainnet",
  gnosis:            "https://v2.archive.subsquid.io/network/gnosis-mainnet",
  celo:              "https://v2.archive.subsquid.io/network/celo-mainnet",
  moonbeam:          "https://v2.archive.subsquid.io/network/moonbeam-mainnet",
  moonriver:         "https://v2.archive.subsquid.io/network/moonriver-mainnet",
  canto:             "https://v2.archive.subsquid.io/network/canto",
  bera:              "https://v2.archive.subsquid.io/network/berachain-mainnet",
  polygon:           "https://v2.archive.subsquid.io/network/polygon-mainnet",
  tron:              "https://v2.archive.subsquid.io/network/tron-mainnet",
  monad:             "https://v2.archive.subsquid.io/network/monad-mainnet",
  plume:             "https://v2.archive.subsquid.io/network/plume",

  // ---------- Ethereum L2 / rollups ----------
  base:              "https://v2.archive.subsquid.io/network/base-mainnet",
  arbitrum:          "https://v2.archive.subsquid.io/network/arbitrum-one",
  optimism:          "https://v2.archive.subsquid.io/network/optimism-mainnet",
  "arbitrum-nova":   "https://v2.archive.subsquid.io/network/arbitrum-nova",
  linea:             "https://v2.archive.subsquid.io/network/linea-mainnet",
  scroll:            "https://v2.archive.subsquid.io/network/scroll-mainnet",
  zksync:            "https://v2.archive.subsquid.io/network/zksync-mainnet",
  "polygon-zkevm":   "https://v2.archive.subsquid.io/network/polygon-zkevm-mainnet",
  mode:              "https://v2.archive.subsquid.io/network/mode-mainnet",
  blast:             "https://v2.archive.subsquid.io/network/blast-l2-mainnet",
  mantle:            "https://v2.archive.subsquid.io/network/mantle-mainnet",
  manta:             "https://v2.archive.subsquid.io/network/manta-pacific",
  metis:             "https://v2.archive.subsquid.io/network/metis-mainnet",
  zora:              "https://v2.archive.subsquid.io/network/zora-mainnet",
  taiko:             "https://v2.archive.subsquid.io/network/taiko-mainnet",
  unichain:          "https://v2.archive.subsquid.io/network/unichain-mainnet",
  soneium:           "https://v2.archive.subsquid.io/network/soneium-mainnet",
  ink:               "https://v2.archive.subsquid.io/network/ink-mainnet",
  abstract:          "https://v2.archive.subsquid.io/network/abstract-mainnet",
  cyber:             "https://v2.archive.subsquid.io/network/cyber-mainnet",
  merlin:            "https://v2.archive.subsquid.io/network/merlin-mainnet",
  hemi:              "https://v2.archive.subsquid.io/network/hemi-mainnet",
  shibarium:         "https://v2.archive.subsquid.io/network/shibarium",

  // ---------- App / gaming chains ----------
  dogechain:         "https://v2.archive.subsquid.io/network/dogechain-mainnet",
  "dfk-chain":       "https://v2.archive.subsquid.io/network/dfk-chain",
  beam:              "https://v2.archive.subsquid.io/network/beam-mainnet",
  flare:             "https://v2.archive.subsquid.io/network/flare-mainnet",

  // ---------- Misc EVM ----------
  okx:               "https://v2.archive.subsquid.io/network/xlayer-mainnet",
  hyperliquid:       "https://v2.archive.subsquid.io/network/hyperliquid-mainnet",
};

interface LogRow {
  block_number: number;
  block_time: string;
  chain: string;
  tx_hash: string;
  log_index: number;
  address: string;
  topic0?: string;
  topic1?: string;
  topic2?: string;
  topic3?: string;
  data: string;
}

function arrayAt(value: unknown, index: number): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const v = value[index];
  return typeof v === "string" ? v : undefined;
}
