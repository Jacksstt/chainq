{{ config(materialized = 'view') }}

-- Cross-chain bridge transfers across Across / Stargate / Hop / Wormhole / CCTP.

SELECT
  block_time,
  block_number,
  src_chain,
  dst_chain,
  bridge,
  sender,
  recipient,
  token,
  amount,
  amount_usd
FROM {{ parquet_source('bridge.transfers') }}
