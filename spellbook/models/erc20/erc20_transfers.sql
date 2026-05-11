{{ config(materialized = 'view') }}

SELECT
  block_time,
  block_number,
  chain,
  tx_hash,
  token,
  from_addr,
  to_addr,
  TRY_CAST(value AS HUGEINT) AS value_raw
FROM {{ parquet_source('erc20.transfers') }}
