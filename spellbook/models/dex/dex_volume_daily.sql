{{ config(materialized = 'view') }}

-- Daily DEX volume aggregate. Materialises `metric: dex_volume_usd` as a
-- queryable view so downstream models / BI tools can JOIN against it
-- without re-running the metric template every time.

SELECT
  chain,
  dex_name,
  date_trunc('day', block_time) AS day,
  COUNT(*)                       AS trade_count,
  COUNT(DISTINCT taker)          AS unique_traders,
  SUM(amount_usd)                AS volume_usd
FROM {{ ref('dex_trades') }}
WHERE amount_usd IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY 3, 1, 2
