#!/usr/bin/env tsx
/**
 * Generates small synthetic Parquet files so `chainq mcp serve` has
 * something to introspect on a fresh checkout.
 *
 * Output:
 *   data/dex.trades.parquet
 *   data/erc20.transfers.parquet
 *   data/filecoin.deals.parquet
 *
 * Not real data. Do not use for analysis.
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const OUT_DIR = resolve(process.argv[2] ?? "./data");

const ROWS_DEX = 10_000;
const ROWS_ERC20 = 20_000;
const ROWS_FILECOIN = 2_000;

const DEX_NAMES = ["uniswap_v3", "uniswap_v2", "curve", "balancer", "sushiswap"];
const TOKENS = ["WETH", "USDC", "USDT", "DAI", "WBTC", "ARB", "OP", "PEPE"];
const CHAINS = ["ethereum", "base", "polygon", "arbitrum", "optimism"];

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();

  // dex.trades --------------------------------------------------------------
  await conn.run(`
    CREATE TABLE dex_trades AS
    WITH base AS (
      SELECT range AS i FROM range(${ROWS_DEX})
    )
    SELECT
      TIMESTAMP '2026-01-01 00:00:00' + (i * INTERVAL '30 seconds') AS block_time,
      18000000 + i AS block_number,
      list_extract(${jsList(CHAINS)}, 1 + (i % ${CHAINS.length})) AS chain,
      list_extract(${jsList(DEX_NAMES)}, 1 + ((i * 7) % ${DEX_NAMES.length})) AS dex_name,
      '0x' || lpad(format('{:x}', i * 17), 64, '0') AS tx_hash,
      '0x' || lpad(format('{:x}', (i * 31) % 1000000), 40, '0') AS taker,
      list_extract(${jsList(TOKENS)}, 1 + (i % ${TOKENS.length})) AS token_in,
      list_extract(${jsList(TOKENS)}, 1 + ((i + 3) % ${TOKENS.length})) AS token_out,
      (1 + (i % 100)) * 1.5 AS amount_in,
      (1 + (i % 100)) * 0.0012 AS amount_out,
      (1 + (i % 100)) * 12.34 AS amount_usd
    FROM base;
  `);
  await conn.run(`COPY dex_trades TO '${resolve(OUT_DIR, "dex.trades.parquet")}' (FORMAT 'parquet')`);

  // erc20.transfers --------------------------------------------------------
  await conn.run(`
    CREATE TABLE erc20_transfers AS
    WITH base AS (SELECT range AS i FROM range(${ROWS_ERC20}))
    SELECT
      TIMESTAMP '2026-01-01 00:00:00' + (i * INTERVAL '12 seconds') AS block_time,
      18000000 + (i / 5)::BIGINT AS block_number,
      list_extract(${jsList(CHAINS)}, 1 + (i % ${CHAINS.length})) AS chain,
      '0x' || lpad(format('{:x}', i * 13), 64, '0') AS tx_hash,
      '0x' || lpad(format('{:x}', (i * 71) % 50), 40, '0') AS token,
      '0x' || lpad(format('{:x}', (i * 97) % 100000), 40, '0') AS from_addr,
      '0x' || lpad(format('{:x}', (i * 113) % 100000), 40, '0') AS to_addr,
      ((i % 1000) * 1000)::VARCHAR AS value
    FROM base;
  `);
  await conn.run(`COPY erc20_transfers TO '${resolve(OUT_DIR, "erc20.transfers.parquet")}' (FORMAT 'parquet')`);

  // filecoin.deals --------------------------------------------------------
  await conn.run(`
    CREATE TABLE filecoin_deals AS
    WITH base AS (SELECT range AS i FROM range(${ROWS_FILECOIN}))
    SELECT
      10000000 + i AS deal_id,
      'f1client' || (i % 100)::VARCHAR AS client,
      'f0' || (1000 + (i % 200))::VARCHAR AS provider,
      (1 << (24 + (i % 6)))::BIGINT AS piece_size_bytes,
      3500000 + i * 30 AS start_epoch,
      3500000 + i * 30 + 1051200 AS end_epoch,
      (i % 3 = 0) AS verified_deal
    FROM base;
  `);
  await conn.run(`COPY filecoin_deals TO '${resolve(OUT_DIR, "filecoin.deals.parquet")}' (FORMAT 'parquet')`);

  conn.disconnectSync();

  console.log(`wrote sample parquet files to ${OUT_DIR}`);
}

function jsList(items: string[]): string {
  return `[${items.map((x) => `'${x}'`).join(", ")}]`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// keep TypeScript happy when output path is interesting
void dirname;
