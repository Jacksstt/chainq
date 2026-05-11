{{ config(materialized = 'view') }}

-- Daily USD reference prices.
-- One row per (chain, token, price_time). Day-aligned. Sourced from
-- upstream aggregators (Pyth / DefiLlama / Coingecko in production).

SELECT
  price_time,
  token,
  chain,
  price_usd,
  source
FROM {{ parquet_source('prices.usd') }}
