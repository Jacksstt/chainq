{{ config(materialized = 'view') }}

-- Solana DEX swap events, normalised across Jupiter, Orca Whirlpool,
-- Raydium, Meteora DLMM, and Phoenix.
--
-- One row per swap. `dex_name='jupiter'` rows are the aggregator
-- entrypoint, not the underlying venue. `amount_usd` may be NULL when
-- off-chain pricing was unavailable.
--
-- Placeholder shell. An operator wires this up to the per-DEX raw event
-- tables once ingestion is configured. The WHERE 1=0 guard keeps the
-- model compilable on a fresh checkout where no raw inputs exist yet.

SELECT
  CAST(NULL AS TIMESTAMP)      AS block_time,
  CAST(NULL AS BIGINT)         AS slot,
  CAST(NULL AS VARCHAR)        AS signature,
  CAST(NULL AS VARCHAR)        AS dex_name,
  CAST(NULL AS VARCHAR)        AS trader,
  CAST(NULL AS VARCHAR)        AS token_in_mint,
  CAST(NULL AS VARCHAR)        AS token_out_mint,
  CAST(NULL AS DECIMAL(24, 4)) AS amount_in,
  CAST(NULL AS DECIMAL(24, 4)) AS amount_out,
  CAST(NULL AS DECIMAL(23, 2)) AS amount_usd
WHERE 1 = 0
