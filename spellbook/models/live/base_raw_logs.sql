{{ config(materialized = 'view') }}

-- Raw EVM logs on Base. Produced verbatim by
--   `chainq pull --chain base --from N --to M`
-- and committed to `<CHAINQ_DATA_DIR>/base.logs.parquet`. In a CI build with
-- no live pull, the seed script emits a synthetic file with the same schema
-- so this model still compiles + tests.

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
FROM {{ parquet_source('base.logs') }}
