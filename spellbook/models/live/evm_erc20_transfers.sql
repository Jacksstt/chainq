{{ config(materialized = 'view') }}

-- ERC-20 Transfer events decoded from real logs, across every chain in
-- `evm_raw_logs`. ERC-20 `Transfer(address indexed, address indexed, uint256)`
-- has exactly TWO indexed params, so topic3 is NULL and the value rides in
-- `data`. That is precisely what distinguishes it from ERC-721 Transfer
-- (identical topic0, THREE indexed params → topic3 set, empty data), which is
-- split out into `evm_erc721_transfers`.

SELECT
  block_number,
  block_time,
  chain,
  tx_hash,
  log_index,
  address                              AS token,
  '0x' || substring(topic1, 27, 40)    AS from_addr,
  '0x' || substring(topic2, 27, 40)    AS to_addr,
  data                                 AS value_raw_hex
FROM {{ ref('evm_raw_logs') }}
WHERE topic0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND topic1 IS NOT NULL
  AND topic2 IS NOT NULL
  AND topic3 IS NULL
  AND data IS NOT NULL
  AND data <> '0x'
