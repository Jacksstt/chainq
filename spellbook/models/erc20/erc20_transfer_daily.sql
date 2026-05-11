{{ config(materialized = 'view') }}

SELECT
  chain,
  date_trunc('day', block_time) AS day,
  COUNT(*)                      AS transfer_count,
  COUNT(DISTINCT token)         AS distinct_tokens,
  COUNT(DISTINCT from_addr)     AS distinct_senders,
  COUNT(DISTINCT to_addr)       AS distinct_recipients
FROM {{ ref('erc20_transfers') }}
GROUP BY 1, 2
ORDER BY 1, 2
