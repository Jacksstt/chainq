{{ config(materialized = 'view') }}

-- Daily DEX volume re-priced via `prices.usd` join. Use this when the
-- on-chain `amount_usd` is missing or known to be stale. The join is on
-- (chain, token_out, day) — the day key requires the price feed to have
-- a per-day snapshot.

SELECT
  t.chain                                       AS chain,
  t.dex_name                                    AS dex_name,
  date_trunc('day', t.block_time)               AS day,
  COUNT(*)                                      AS trade_count,
  SUM(TRY_CAST(t.amount_out AS DOUBLE) * p.price_usd) AS volume_usd_priced
FROM {{ ref('dex_trades') }} AS t
JOIN {{ ref('prices_usd') }} AS p
  ON p.token = t.token_out
 AND p.chain = t.chain
 AND p.price_time = date_trunc('day', t.block_time)
GROUP BY 1, 2, 3
ORDER BY 3, 1, 2
