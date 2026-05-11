{{ config(materialized = 'view') }}

-- Top emitting contracts on Base for the current data window. Drives
-- the "who is making the most noise" question that every analyst hits
-- on day one. Materialised as a view over `base_raw_logs` so it stays
-- accurate as new pulls land.

SELECT
  address,
  COUNT(*)                    AS logs,
  COUNT(DISTINCT tx_hash)     AS transactions,
  COUNT(DISTINCT topic0)      AS distinct_event_signatures,
  MIN(block_number)           AS first_block,
  MAX(block_number)           AS last_block
FROM {{ ref('base_raw_logs') }}
GROUP BY 1
ORDER BY logs DESC
