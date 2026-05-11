{{ config(materialized = 'view') }}

-- Solana SPL token + native SOL transfers.
--
-- One row per transfer instruction (top-level or inner). Native SOL
-- transfers carry mint = NULL and amount in lamports (1e9 = 1 SOL).
--
-- Placeholder shell. An operator wires this up to the real raw source
-- (e.g. {{ parquet_source('solana.raw_transfers') }} or a Helius enrichment
-- table) once ingestion is configured. The WHERE 1=0 guard keeps the model
-- compilable on a fresh checkout where no raw inputs exist yet.

SELECT
  CAST(NULL AS TIMESTAMP) AS block_time,
  CAST(NULL AS BIGINT)    AS slot,
  CAST(NULL AS VARCHAR)   AS signature,
  CAST(NULL AS VARCHAR)   AS mint,
  CAST(NULL AS VARCHAR)   AS from_account,
  CAST(NULL AS VARCHAR)   AS to_account,
  CAST(NULL AS VARCHAR)   AS amount,
  CAST(NULL AS INTEGER)   AS decimals
WHERE 1 = 0
