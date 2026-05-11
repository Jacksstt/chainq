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
// CHAINQ_SEED_SCALE=large bumps every table ~100x to enable real benchmarks.
const SCALE = process.env.CHAINQ_SEED_SCALE === "large" ? 100 : 1;

const ROWS_DEX = 10_000 * SCALE;
const ROWS_ERC20 = 20_000 * SCALE;
const ROWS_FILECOIN = 2_000 * SCALE;
const ROWS_SOLANA_TRANSFERS = 5_000 * SCALE;
const ROWS_SOLANA_DEX = 3_000 * SCALE;

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
      -- Synthetic piece sizes around real Filecoin sector sizes
      -- (mainnet uses 32 / 64 GiB sectors). Range: 32 GiB to 256 GiB.
      (1::HUGEINT << (35 + (i % 4)))::BIGINT AS piece_size_bytes,
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

  // prices.usd -------------------------------------------------------------
  // Daily USD reference prices for the eight DEX tokens across 60 days.
  // Models a smooth random-walk pattern with seeded jitter so percentiles
  // and aggregate joins produce believable numbers.
  await conn.run(`
    CREATE TABLE prices_usd AS
    WITH days AS (SELECT range AS d FROM range(60)),
         toks AS (SELECT unnest(${jsList(TOKENS)}) AS token, generate_series AS rank FROM generate_series(1, ${TOKENS.length})),
         joined AS (
           SELECT
             TIMESTAMP '2026-01-01 00:00:00' + (d * INTERVAL '1 day') AS price_time,
             token,
             rank,
             -- Base price per token (deterministic), plus a sine-wave drift.
             CASE token
               WHEN 'WETH' THEN 2300.0 + 50.0 * sin(d * 0.21)
               WHEN 'WBTC' THEN 45000.0 + 800.0 * sin(d * 0.18)
               WHEN 'USDC' THEN 1.0 + 0.002 * sin(d * 0.31)
               WHEN 'USDT' THEN 1.0 + 0.003 * sin(d * 0.29)
               WHEN 'DAI'  THEN 1.0 + 0.001 * sin(d * 0.27)
               WHEN 'ARB'  THEN 1.2 + 0.15 * sin(d * 0.23)
               WHEN 'OP'   THEN 2.4 + 0.20 * sin(d * 0.19)
               WHEN 'PEPE' THEN 0.000012 + 0.0000018 * sin(d * 0.33)
               ELSE 1.0
             END AS price_usd,
             'chainq:synthetic' AS source
           FROM days, toks
         )
    SELECT
      price_time,
      token,
      'ethereum' AS chain,
      ROUND(price_usd, 6) AS price_usd,
      source
    FROM joined;
  `);
  await conn.run(`COPY prices_usd TO '${resolve(OUT_DIR, "prices.usd.parquet")}' (FORMAT 'parquet')`);

  // labels.addresses -------------------------------------------------------
  // 200 synthetic labelled addresses across known categories. Used to
  // demo label-joined analyses (OFAC checks, exchange routing, MEV bots).
  await conn.run(`
    CREATE TABLE labels_addresses AS
    WITH base AS (SELECT range AS i FROM range(200))
    SELECT
      '0x' || lpad(format('{:x}', (i * 113) % 100000), 40, '0') AS address,
      list_extract(${jsList(CHAINS)}, 1 + (i % ${CHAINS.length})) AS chain,
      CASE (i % 8)
        WHEN 0 THEN 'cex_hot_wallet'
        WHEN 1 THEN 'cex_cold_wallet'
        WHEN 2 THEN 'dex_router'
        WHEN 3 THEN 'mev_bot'
        WHEN 4 THEN 'bridge_operator'
        WHEN 5 THEN 'sanctioned'
        WHEN 6 THEN 'contract_factory'
        ELSE        'eoa_whale'
      END AS label,
      CASE (i % 8)
        WHEN 0 THEN 'Binance'
        WHEN 1 THEN 'Coinbase Custody'
        WHEN 2 THEN 'Uniswap Router'
        WHEN 3 THEN 'jaredfromsubway.eth'
        WHEN 4 THEN 'Across Bridge'
        WHEN 5 THEN 'OFAC SDN List'
        WHEN 6 THEN 'Safe Factory'
        ELSE        'unknown whale'
      END AS source,
      CASE (i % 8)
        WHEN 5 THEN 1.0
        WHEN 3 THEN 0.85
        ELSE        0.7
      END AS confidence
    FROM base;
  `);
  await conn.run(`COPY labels_addresses TO '${resolve(OUT_DIR, "labels.addresses.parquet")}' (FORMAT 'parquet')`);

  // nft.trades --------------------------------------------------------------
  // One row per NFT sale across the major marketplaces. 100k rows by default
  // at 1× (100× at large scale). Marketplaces cycle through a known set; the
  // `collection_address` is a hash of `i % 50` to simulate 50 collections.
  const NFT_MARKETPLACES = ["opensea", "blur", "looksrare", "x2y2", "magiceden"];
  await conn.run(`
    CREATE TABLE nft_trades AS
    WITH base AS (SELECT range AS i FROM range(${ROWS_DEX}))
    SELECT
      TIMESTAMP '2026-01-01 00:00:00' + (i * INTERVAL '120 seconds') AS block_time,
      18000000 + (i / 10)::BIGINT                AS block_number,
      list_extract(${jsList(CHAINS)}, 1 + (i % ${CHAINS.length})) AS chain,
      list_extract(${jsList(NFT_MARKETPLACES)}, 1 + (i % ${NFT_MARKETPLACES.length})) AS marketplace,
      '0x' || lpad(format('{:x}', (i * 41) % 50), 40, '0')          AS collection_address,
      ((i * 7) % 10000)::BIGINT                                      AS token_id,
      '0x' || lpad(format('{:x}', (i * 31) % 100000), 40, '0')       AS seller,
      '0x' || lpad(format('{:x}', (i * 53) % 100000), 40, '0')       AS buyer,
      list_extract(${jsList(TOKENS)}, 1 + (i % ${TOKENS.length}))    AS currency,
      CAST((0.05 + (i % 200) * 0.025) AS DECIMAL(24,4))              AS price,
      CAST(CASE WHEN (i % 17) = 0 THEN NULL
                ELSE (0.05 + (i % 200) * 0.025) * 2300.0 END AS DECIMAL(23,2)) AS price_usd
    FROM base;
  `);
  await conn.run(`COPY nft_trades TO '${resolve(OUT_DIR, "nft.trades.parquet")}' (FORMAT 'parquet')`);

  // lending.events ----------------------------------------------------------
  // Deposit / borrow / repay / liquidate events across major lending protocols.
  const LENDING_PROTOCOLS = ["aave_v3", "compound_v3", "morpho_blue", "spark", "moonwell"];
  const LENDING_EVENTS = ["deposit", "borrow", "repay", "liquidate"];
  await conn.run(`
    CREATE TABLE lending_events AS
    WITH base AS (SELECT range AS i FROM range(${ROWS_ERC20}))
    SELECT
      TIMESTAMP '2026-01-01 00:00:00' + (i * INTERVAL '24 seconds') AS block_time,
      18000000 + (i / 6)::BIGINT                                     AS block_number,
      list_extract(${jsList(CHAINS)}, 1 + (i % ${CHAINS.length}))    AS chain,
      list_extract(${jsList(LENDING_PROTOCOLS)}, 1 + ((i * 5) % ${LENDING_PROTOCOLS.length})) AS protocol,
      list_extract(${jsList(LENDING_EVENTS)}, 1 + ((i * 3) % ${LENDING_EVENTS.length})) AS event_kind,
      '0x' || lpad(format('{:x}', (i * 67) % 100000), 40, '0')        AS user_addr,
      list_extract(${jsList(TOKENS)}, 1 + (i % ${TOKENS.length}))    AS asset,
      CAST((1 + (i % 50000)) * 1.0 AS DECIMAL(38,6))                  AS amount,
      CAST((1 + (i % 50000)) * 1.0 * 2.5 AS DECIMAL(23,2))           AS amount_usd
    FROM base;
  `);
  await conn.run(`COPY lending_events TO '${resolve(OUT_DIR, "lending.events.parquet")}' (FORMAT 'parquet')`);

  // bridge.transfers --------------------------------------------------------
  // Cross-chain message / token bridge events.
  const BRIDGES = ["across", "stargate", "hop", "wormhole", "cctp"];
  await conn.run(`
    CREATE TABLE bridge_transfers AS
    WITH base AS (SELECT range AS i FROM range(${ROWS_DEX}))
    SELECT
      TIMESTAMP '2026-01-01 00:00:00' + (i * INTERVAL '90 seconds') AS block_time,
      18000000 + (i / 8)::BIGINT                                    AS block_number,
      list_extract(${jsList(CHAINS)}, 1 + (i % ${CHAINS.length}))    AS src_chain,
      list_extract(${jsList(CHAINS)}, 1 + ((i + 1) % ${CHAINS.length})) AS dst_chain,
      list_extract(${jsList(BRIDGES)}, 1 + (i % ${BRIDGES.length})) AS bridge,
      '0x' || lpad(format('{:x}', (i * 79) % 100000), 40, '0')        AS sender,
      '0x' || lpad(format('{:x}', (i * 89) % 100000), 40, '0')        AS recipient,
      list_extract(${jsList(TOKENS)}, 1 + (i % ${TOKENS.length}))     AS token,
      CAST((10 + (i % 10000)) * 1.0 AS DECIMAL(38,6))                 AS amount,
      CAST((10 + (i % 10000)) * 1.0 * 1.2 AS DECIMAL(23,2))          AS amount_usd
    FROM base;
  `);
  await conn.run(`COPY bridge_transfers TO '${resolve(OUT_DIR, "bridge.transfers.parquet")}' (FORMAT 'parquet')`);

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
