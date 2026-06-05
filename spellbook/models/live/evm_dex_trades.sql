{{ config(materialized = 'view') }}

-- DEX swap events decoded from real logs, labelled via the `event_signatures`
-- registry. One row per on-chain swap event (Uniswap V2 / V3, etc.).
--
-- Amounts are kept as the raw `data` hex. Full per-DEX numeric decoding
-- (UniV2 = 4×uint256; UniV3 = int256/int256/uint160/uint128/int24) is a
-- follow-up: a uint256 exceeds DuckDB's 128-bit HUGEINT, so a faithful amount
-- needs a UDF / fixed-point handling rather than a lossy cast. We expose the
-- venue, pool, and raw payload now and decode amounts in a later milestone.

SELECT
  l.block_number,
  l.block_time,
  l.chain,
  l.tx_hash,
  l.log_index,
  l.address       AS pool,
  s.event_name,
  s.signature,
  l.data          AS amounts_raw_hex
FROM {{ ref('evm_raw_logs') }} AS l
JOIN {{ ref('event_signatures') }} AS s
  ON s.topic0 = l.topic0
WHERE s.domain = 'dex'
  AND s.event_name LIKE '%Swap'
