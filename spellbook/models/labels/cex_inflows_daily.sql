{{ config(materialized = 'view') }}

-- Daily ERC-20 transfer volume INTO labelled centralized-exchange wallets.
-- Joins erc20.transfers to labels.addresses on the recipient. Useful as a
-- coarse sell-pressure signal and for tracking CEX deposit flows.

SELECT
  t.chain                                AS chain,
  t.token                                AS token,
  l.label                                AS label,
  date_trunc('day', t.block_time)        AS day,
  COUNT(*)                               AS transfer_count,
  SUM(t.value_raw)::DOUBLE AS raw_value
FROM {{ ref('erc20_transfers') }} AS t
JOIN {{ ref('labels_addresses') }} AS l
  ON l.address = t.to_addr
 AND l.chain   = t.chain
WHERE l.label LIKE 'cex_%'
GROUP BY 1, 2, 3, 4
ORDER BY 4 DESC, 1, 2
