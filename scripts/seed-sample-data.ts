#!/usr/bin/env tsx
/**
 * Generates small synthetic Parquet files so `chainq mcp serve` has
 * something to introspect on a fresh checkout.
 *
 * Output:
 *   data/dex.trades.parquet
 *   data/erc20.transfers.parquet
 *   data/filecoin.deals.parquet
 *   data/solana.transfers.parquet
 *   data/solana.dex.trades.parquet
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
const ROWS_SOLANA_TRANSFERS = 5_000;
const ROWS_SOLANA_DEX = 3_000;

const DEX_NAMES = ["uniswap_v3", "uniswap_v2", "curve", "balancer", "sushiswap"];
const TOKENS = ["WETH", "USDC", "USDT", "DAI", "WBTC", "ARB", "OP", "PEPE"];
const CHAINS = ["ethereum", "base", "polygon", "arbitrum", "optimism"];

// Fake 44-char base58-looking mint addresses. Not real keys.
const SOLANA_MINTS = [
  "So11111111111111111111111111111111111111112", // wrapped SOL pattern (43 chars + pad to 44)
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC-shaped
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT-shaped
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
];
const SOLANA_DEX_NAMES = ["jupiter", "orca_whirlpool", "raydium_amm", "meteora_dlmm", "phoenix"];
const SOLANA_ACCOUNTS = [
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  "2FPyTwcZLUg1MDrwsyoP4D6s1tM7hAkHYRjkNb5w6Pxk",
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
  "DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy",
  "GThUX1Atko4tqhN2NaiTazWSeFWMuiUiswQrAjV3zKWb",
  "8VJhE3HhCpf9F2HCqsuU5jZGmCfA1qpEjxWdv6Y4o9zN",
];

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

  // solana.transfers -------------------------------------------------------
  // 5,000 rows. ~10% native SOL (mint = NULL, decimals = 9), rest cycle
  // through SOLANA_MINTS with decimals = 6. slot increments by 2 starting at
  // 250_000_000. block_time is synthesised at 400ms cadence.
  await conn.run(`
    CREATE TABLE solana_transfers AS
    WITH base AS (SELECT range AS i FROM range(${ROWS_SOLANA_TRANSFERS}))
    SELECT
      TIMESTAMP '2026-01-01 00:00:00' + (i * INTERVAL '400 milliseconds') AS block_time,
      250000000 + (i * 2)::BIGINT AS slot,
      'sig' || lpad(format('{:x}', i * 19), 85, '1') AS signature,
      CASE
        WHEN (i % 10) = 0 THEN NULL
        ELSE list_extract(${jsList(SOLANA_MINTS)}, 1 + (i % ${SOLANA_MINTS.length}))
      END AS mint,
      list_extract(${jsList(SOLANA_ACCOUNTS)}, 1 + (i % ${SOLANA_ACCOUNTS.length})) AS from_account,
      list_extract(${jsList(SOLANA_ACCOUNTS)}, 1 + ((i + 1) % ${SOLANA_ACCOUNTS.length})) AS to_account,
      (1 + ((i * 7919) % 1000000000000))::VARCHAR AS amount,
      CASE WHEN (i % 10) = 0 THEN 9 ELSE 6 END AS decimals
    FROM base;
  `);
  await conn.run(`COPY solana_transfers TO '${resolve(OUT_DIR, "solana.transfers.parquet")}' (FORMAT 'parquet')`);

  // solana.dex.trades ------------------------------------------------------
  // 3,000 rows. dex_name cycles through SOLANA_DEX_NAMES. amount_usd is NULL
  // for ~5% of rows.
  await conn.run(`
    CREATE TABLE solana_dex_trades AS
    WITH base AS (SELECT range AS i FROM range(${ROWS_SOLANA_DEX}))
    SELECT
      TIMESTAMP '2026-01-01 00:00:00' + (i * INTERVAL '500 milliseconds') AS block_time,
      250000000 + (i * 3)::BIGINT AS slot,
      'sig' || lpad(format('{:x}', i * 23), 85, '2') AS signature,
      list_extract(${jsList(SOLANA_DEX_NAMES)}, 1 + (i % ${SOLANA_DEX_NAMES.length})) AS dex_name,
      list_extract(${jsList(SOLANA_ACCOUNTS)}, 1 + (i % ${SOLANA_ACCOUNTS.length})) AS trader,
      list_extract(${jsList(SOLANA_MINTS)}, 1 + (i % ${SOLANA_MINTS.length})) AS token_in_mint,
      list_extract(${jsList(SOLANA_MINTS)}, 1 + ((i + 2) % ${SOLANA_MINTS.length})) AS token_out_mint,
      CAST((1 + (i % 250)) * 1.25 AS DECIMAL(24,4)) AS amount_in,
      CAST((1 + (i % 250)) * 0.875 AS DECIMAL(24,4)) AS amount_out,
      CASE
        WHEN (i % 20) = 0 THEN NULL
        ELSE CAST((1 + (i % 250)) * 11.11 AS DECIMAL(23,2))
      END AS amount_usd
    FROM base;
  `);
  await conn.run(`COPY solana_dex_trades TO '${resolve(OUT_DIR, "solana.dex.trades.parquet")}' (FORMAT 'parquet')`);

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
