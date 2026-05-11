{{ config(materialized = 'view') }}

-- Solana SPL token + native SOL transfers.
--
-- One row per transfer instruction (top-level or inner). Native SOL
-- transfers carry mint = NULL and amount in lamports (1e9 = 1 SOL).
-- This view reads the Parquet emitted by `pnpm seed` or `chainq pull`.

SELECT
  block_time,
  slot,
  signature,
  mint,
  from_account,
  to_account,
  amount,
  decimals
FROM {{ parquet_source('solana.transfers') }}
