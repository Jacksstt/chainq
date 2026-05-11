{{ config(materialized = 'view') }}

-- Derive ERC-20 Transfer events from raw Base logs. Each row in the
-- output is one Transfer event with the indexed `from` / `to` parameters
-- pulled out of topic1 / topic2 and the non-indexed `value` decoded from
-- the data payload. This is the **Spellbook v0.2 decoder pattern**:
-- start from the raw `base_logs` source, filter by event signature,
-- normalise into a curated table.
--
-- Topic0 for ERC-20 Transfer: keccak256("Transfer(address,address,uint256)")
--   = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef

SELECT
  block_number,
  block_time,
  chain,
  tx_hash,
  log_index,
  address                                                AS token,
  -- topic1 / topic2 are 32-byte zero-padded addresses; the low 20 bytes
  -- carry the actual address. `0x` + last 40 hex chars = lowercase addr.
  '0x' || substring(topic1, 27, 40)                      AS from_addr,
  '0x' || substring(topic2, 27, 40)                      AS to_addr,
  -- `data` is the ABI-encoded uint256 value. 0x + 64 hex chars.
  data                                                   AS value_raw_hex
FROM {{ ref('base_raw_logs') }}
WHERE topic0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  AND topic1 IS NOT NULL
  AND topic2 IS NOT NULL
