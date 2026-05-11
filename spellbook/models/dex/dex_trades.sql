{{ config(materialized = 'view') }}

SELECT
  block_time,
  block_number,
  chain,
  dex_name,
  tx_hash,
  taker,
  token_in,
  token_out,
  amount_in,
  amount_out,
  amount_usd
FROM {{ parquet_source('dex.trades') }}
