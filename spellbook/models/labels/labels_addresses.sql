{{ config(materialized = 'view') }}

-- Address → label registry. One row per (address, chain, label) assertion
-- with source and confidence.

SELECT
  address,
  chain,
  label,
  source,
  confidence
FROM {{ parquet_source('labels.addresses') }}
