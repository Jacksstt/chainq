{{ config(materialized = 'view') }}

-- Raw Base logs joined against the `event_signatures` decode registry (a dbt
-- seed, the v0.4.0 single source of truth) so each row carries a
-- human-readable `event_name` (or NULL if the topic0 is not in the registry).
-- The registry keeps topic0 UNIQUE, so this LEFT JOIN is strictly
-- one-row-per-log.
--
-- NOTE: ERC-721 `Approval(address,address,uint256)` shares its keccak topic0
-- with ERC-20 Approval and is intentionally NOT a separate registry row.

SELECT
  l.block_number,
  l.block_time,
  l.chain,
  l.tx_hash,
  l.log_index,
  l.address,
  l.topic0,
  l.topic1,
  l.topic2,
  l.topic3,
  l.data,
  s.event_name,
  s.signature,
  s.domain
FROM {{ ref('base_raw_logs') }} AS l
LEFT JOIN {{ ref('event_signatures') }} AS s ON s.topic0 = l.topic0
