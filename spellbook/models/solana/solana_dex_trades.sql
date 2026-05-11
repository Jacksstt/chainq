{{ config(materialized = 'view') }}

-- Solana DEX swaps normalised across Jupiter, Orca Whirlpool, Raydium,
-- Meteora DLMM, and Phoenix.
--
-- One row per swap; `amount_usd` may be NULL when off-chain pricing was
-- unavailable. Reads the Parquet emitted by `pnpm seed` or `chainq pull`.

SELECT
  block_time,
  slot,
  signature,
  dex_name,
  trader,
  token_in_mint,
  token_out_mint,
  amount_in,
  amount_out,
  amount_usd
FROM {{ parquet_source('solana.dex.trades') }}
