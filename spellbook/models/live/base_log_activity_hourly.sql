{{ config(materialized = 'view') }}

-- Hourly aggregate over real Base log activity. Useful as a coarse
-- on-chain pulse signal: total logs, distinct contracts, distinct event
-- signatures, distinct transactions. Built from `base_raw_logs` so the
-- entire pipeline (live pull → spellbook → aggregate → metric) is exercised
-- against real data.

SELECT
  date_trunc('hour', block_time) AS hour,
  COUNT(*)                       AS logs,
  COUNT(DISTINCT address)        AS distinct_contracts,
  COUNT(DISTINCT topic0)         AS distinct_event_signatures,
  COUNT(DISTINCT tx_hash)        AS distinct_transactions
FROM {{ ref('base_raw_logs') }}
GROUP BY 1
ORDER BY 1
