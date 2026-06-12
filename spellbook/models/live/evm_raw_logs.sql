{{ config(materialized = 'view') }}

-- Chain-agnostic raw EVM logs: the union of every `<chain>.logs.parquet`
-- pulled into the data dir. `base.logs.parquet` always exists (seed or
-- `chainq pull`); pulling more chains (e.g. `chainq pull --chain arbitrum`)
-- adds them automatically with no model change. The downstream `evm_*`
-- curated models build on this, so they are multi-chain by construction.

SELECT
  block_number,
  block_time,
  chain,
  tx_hash,
  log_index,
  address,
  topic0,
  topic1,
  topic2,
  topic3,
  data
FROM {{ parquet_glob('*.logs.parquet') }}
