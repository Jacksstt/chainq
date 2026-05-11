{{ config(materialized = 'view') }}

-- Normalised lending events across Aave v3 / Compound v3 / Morpho Blue / Spark / Moonwell.

SELECT
  block_time,
  block_number,
  chain,
  protocol,
  event_kind,
  user_addr,
  asset,
  amount,
  amount_usd
FROM {{ parquet_source('lending.events') }}
