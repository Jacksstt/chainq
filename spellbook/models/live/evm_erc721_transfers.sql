{{ config(materialized = 'view') }}

-- ERC-721 Transfer events decoded from real logs. ERC-721
-- `Transfer(address indexed from, address indexed to, uint256 indexed tokenId)`
-- has THREE indexed params, so the token id lands in topic3 and `data` is
-- empty — the discriminator against ERC-20 Transfer (same topic0).

SELECT
  block_number,
  block_time,
  chain,
  tx_hash,
  log_index,
  address                              AS collection,
  '0x' || substring(topic1, 27, 40)    AS from_addr,
  '0x' || substring(topic2, 27, 40)    AS to_addr,
  topic3                               AS token_id_hex
FROM {{ ref('evm_raw_logs') }}
WHERE topic0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND topic1 IS NOT NULL
  AND topic2 IS NOT NULL
  AND topic3 IS NOT NULL
